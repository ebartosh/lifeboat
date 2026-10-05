import {
  createSolanaRpc,
  getBase64Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  type Address,
  type Blockhash,
  type Signature,
  type Transaction,
  type TransactionMessageBytesBase64,
} from "@solana/kit";

import { ConfigurationError, errorMessage, TransactionError } from "./errors";
import type { AccountFilter, AccountSnapshot, ChainAccount, LendingReader } from "./accounts";

export type LatestBlockhash = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

export type SimulationResult = {
  error: unknown | null;
  logs: readonly string[];
  unitsConsumed?: bigint;
  snapshot?: AccountSnapshot;
};

export type SignatureStatus = {
  slot?: bigint;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  error: unknown | null;
};

export interface TransactionRpc {
  getTransactionFee?(transaction: Transaction): Promise<bigint | null>;
  getLatestBlockhash(): Promise<LatestBlockhash>;
  simulateTransaction(transaction: Transaction, accounts?: readonly Address[]): Promise<SimulationResult>;
  sendTransaction(transaction: Transaction): Promise<Signature>;
  getSignatureStatus(transactionSignature: Signature): Promise<SignatureStatus | null>;
  getBlockHeight(): Promise<bigint>;
}

export class SolanaRpcClient implements TransactionRpc, LendingReader {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  private async request<T>(request: { send(options: { abortSignal: AbortSignal }): Promise<T> }): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([request.send({ abortSignal: controller.signal }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('RPC request timed out')); }, 20_000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  constructor(rpcUrl: string) {
    const url = rpcUrl.trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch { throw new ConfigurationError('RPC URL must be a valid HTTP or HTTPS URL'); }
    this.rpc = createSolanaRpc(url);
  }

  async getAccount(accountAddress: Address): Promise<ChainAccount | null> {
    const response = await this.request(this.rpc
      .getAccountInfo(accountAddress, { commitment: "confirmed", encoding: "base64" }));
    if (response.value === null) return null;
    return {
      lamports: response.value.lamports,
      owner: response.value.owner,
      executable: response.value.executable,
      data: Uint8Array.from(getBase64Encoder().encode(response.value.data[0])),
    };
  }

  async getAccounts(addresses: readonly Address[], minContextSlot?: bigint): Promise<AccountSnapshot> {
    const response = await this.request(this.rpc.getMultipleAccounts([...addresses], {
      commitment: "confirmed", encoding: "base64",
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    }));
    return { slot: response.context.slot, accounts: response.value.map(account => account === null ? null : ({
      lamports: account.lamports, owner: account.owner, executable: account.executable,
      data: Uint8Array.from(getBase64Encoder().encode(account.data[0])),
    })) };
  }

  async getProgramAccounts(program: Address, size: number, filters: readonly AccountFilter[]) {
    const response = await this.request(this.rpc.getProgramAccounts(program, {
      commitment: "confirmed", encoding: "base64", withContext: true,
      filters: [{ dataSize: BigInt(size) }, ...filters.map(filter => ({
        memcmp: { offset: BigInt(filter.offset), bytes: filter.bytes as Address, encoding: "base58" as const },
      }))],
    }));
    return { slot: response.context.slot, accounts: response.value.map(item => ({
      address: item.pubkey, account: { owner: item.account.owner, executable: item.account.executable,
        data: Uint8Array.from(getBase64Encoder().encode(item.account.data[0])),
      },
    })) };
  }

  async getGenesisHash(): Promise<string> {
    return await this.request(this.rpc.getGenesisHash());
  }

  /** Variable-size accounts (for example, extended DLMM PositionV2). */
  async getProgramAccountsByFilters(program: Address, filters: readonly AccountFilter[]) {
    const response = await this.request(this.rpc.getProgramAccounts(program, {
      commitment: 'confirmed', encoding: 'base64', withContext: true,
      filters: filters.map(filter => ({ memcmp: { offset: BigInt(filter.offset),
        bytes: filter.bytes as Address, encoding: 'base58' as const } })),
    }));
    return { slot: response.context.slot, accounts: response.value.map(item => ({
      address: item.pubkey, account: { lamports: item.account.lamports, owner: item.account.owner,
        executable: item.account.executable, data: Uint8Array.from(getBase64Encoder().encode(item.account.data[0])) },
    })) };
  }

  async getMinimumBalanceForRentExemption(size: number): Promise<bigint> {
    return await this.request(this.rpc.getMinimumBalanceForRentExemption(BigInt(size), { commitment: "confirmed" }));
  }

  async getLatestBlockhash(): Promise<LatestBlockhash> {
    const response = await this.request(this.rpc.getLatestBlockhash({ commitment: "confirmed" }));
    return response.value;
  }

  async simulateTransaction(transaction: Transaction, accounts?: readonly Address[]): Promise<SimulationResult> {
    const wireTransaction = getBase64EncodedWireTransaction(transaction);
    const config = {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
    } as const;
    const response = accounts === undefined
      ? await this.request(this.rpc.simulateTransaction(wireTransaction, config))
      : await this.request(this.rpc.simulateTransaction(wireTransaction, { ...config,
        accounts: { addresses: [...accounts], encoding: "base64" },
      }));
    return {
      error: response.value.err,
      logs: response.value.logs ?? [],
      ...(response.value.unitsConsumed === undefined ? {} : { unitsConsumed: response.value.unitsConsumed }),
      ...(response.value.accounts == null ? {} : { snapshot: { slot: response.context.slot,
        accounts: response.value.accounts.map(account => account === null ? null : ({
          lamports: account.lamports,
          owner: account.owner, executable: account.executable,
          data: Uint8Array.from(getBase64Encoder().encode(account.data[0])),
        })),
      } }),
    };
  }

  async sendTransaction(transaction: Transaction): Promise<Signature> {
    const wireTransaction = getBase64EncodedWireTransaction(transaction);
    try {
      return await this.request(this.rpc
        .sendTransaction(wireTransaction, {
          encoding: "base64",
          maxRetries: 3n,
          preflightCommitment: "confirmed",
          skipPreflight: false,
        }));
    } catch (error) {
      throw new TransactionError(`RPC rejected the transaction: ${errorMessage(error)}`, { cause: error });
    }
  }

  async getTransactionFee(transaction: Transaction): Promise<bigint | null> {
    return (await this.request(this.rpc.getFeeForMessage(getBase64Decoder().decode(transaction.messageBytes) as TransactionMessageBytesBase64,
      { commitment: "confirmed" }))).value;
  }

  async getSignatureStatus(transactionSignature: Signature): Promise<SignatureStatus | null> {
    const response = await this.request(this.rpc
      .getSignatureStatuses([transactionSignature], { searchTransactionHistory: true }));
    const status = response.value[0];
    if (status === null || status === undefined) return null;
    return { confirmationStatus: status.confirmationStatus, error: status.err, slot: status.slot };
  }

  async getBlockHeight(): Promise<bigint> {
    return await this.request(this.rpc.getBlockHeight({ commitment: "confirmed" }));
  }
}
