import { testWalletSigning } from './fixtures/signer';
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  blockhash,
  signature,
  getSignatureFromTransaction,
  getBase58Decoder,
  signTransaction,
  AccountRole,
  type Signature,
  type Transaction,
} from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SignatureStatus, SimulationResult, TransactionRpc } from "../src/core/rpc.js";
import { executeSafeTransaction } from "../src/core/transaction.js";
import { createTestSigner } from "./fixtures/signer.js";

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

class FakeTransactionRpc implements TransactionRpc {
  transactionSignature = signature("1".repeat(64));
  simulation: SimulationResult = { error: null, logs: [] };
  status: SignatureStatus | null = { confirmationStatus: "confirmed", error: null };
  blockHeight = 1n;
  sendCalls = 0;
  simulateCalls = 0;
  unsignedHadNullSignature = false;
  sentWasFullySigned = false;
  simulatedMessage?: Uint8Array;
  sentMessage?: Uint8Array;

  async getLatestBlockhash() {
    return { blockhash: blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 100n };
  }

  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    this.simulateCalls += 1;
    this.simulatedMessage = Uint8Array.from(transaction.messageBytes);
    this.unsignedHadNullSignature = Object.values(transaction.signatures).some(value => value === null);
    return this.simulation;
  }

  async sendTransaction(transaction: Transaction): Promise<Signature> {
    this.transactionSignature = getSignatureFromTransaction(transaction);
    this.sendCalls += 1;
    this.sentMessage = Uint8Array.from(transaction.messageBytes);
    this.sentWasFullySigned = Object.values(transaction.signatures).every(value => value !== null);
    return this.transactionSignature;
  }

  async getSignatureStatus(): Promise<SignatureStatus | null> {
    return this.status;
  }

  async getBlockHeight(): Promise<bigint> {
    return this.blockHeight;
  }
}

async function executeWith(rpc: FakeTransactionRpc, confirm: () => Promise<boolean>) {
  const signer = await createTestSigner();
  return await executeSafeTransaction({
    rpc,
    wallet: signer.address, signWithWallet: testWalletSigning(signer),
    instruction: { programAddress: address("11111111111111111111111111111111") },
    confirm,
    pollIntervalMs: 0,
    sleep: async () => undefined,
  });
}

describe("safe transaction execution", () => {
  it('identifies wallet rejection without logging its payload or sending', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    const walletError = Object.assign(new Error('private wallet payload secret-token'), { code: -3 });
    await expect(executeSafeTransaction({ rpc, wallet: signer.address,
      signWithWallet: async () => { throw walletError; },
      instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true })).rejects.toMatchObject({ cause: walletError });
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/stage=signing-start reason=wallet-not-signed/);
    expect(trace).not.toContain('private wallet payload');
    expect(trace).not.toContain('secret-token');
    expect(trace).not.toContain(signer.address);
    expect(rpc.sendCalls).toBe(0);
  });
  it('identifies blockhash expiry after wallet signing without sending', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    await expect(executeSafeTransaction({ rpc, wallet: signer.address,
      signWithWallet: async transaction => {
        const signed = await signTransaction([signer.keyPair], transaction);
        rpc.blockHeight = 101n;
        return signed;
      }, instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true })).rejects.toThrow(/expired before sending/);
    expect(vi.mocked(console.info).mock.calls.flat().join('\n')).toMatch(/stage=post-sign-height reason=blockhash-expired/);
    expect(rpc.sendCalls).toBe(0);
  });
  it('diagnoses a wallet converting legacy to v0 while still rejecting the changed message', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    await expect(executeSafeTransaction({ rpc, wallet: signer.address,
      signWithWallet: async transaction => {
        // Version 0 adds a version byte and the empty address-table lookup list.
        const messageBytes = new Uint8Array(transaction.messageBytes.length + 2);
        messageBytes[0] = 0x80;
        messageBytes.set(transaction.messageBytes, 1);
        return signTransaction([signer.keyPair], { ...transaction, messageBytes } as unknown as Transaction);
      }, instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true })).rejects.toThrow(/message-length/);
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/side=original .*version=legacy/);
    expect(trace).toMatch(/side=returned .*version=v0/);
    expect(trace).toMatch(/check=message-length/);
    expect(trace).not.toContain(signer.address);
    expect(rpc.sendCalls).toBe(0);
  });
  it('records numeric program errors without simulation logs or request data', async () => {
    const rpc = new FakeTransactionRpc();
    rpc.simulation = { error: { InstructionError: [0, { Custom: 6001 }] }, logs: ['secret-token private-address'] };
    await expect(executeWith(rpc, async () => true)).rejects.toThrow(/simulation failed/);
    const trace = vi.mocked(console.info).mock.calls.flat().join('\n');
    expect(trace).toMatch(/event=program-error .*instruction=0 custom=6001/);
    expect(trace).toMatch(/stage=simulation-start reason=simulation-error/);
    expect(trace).not.toContain('secret-token');
    expect(trace).not.toContain('private-address');
    expect(rpc.sendCalls).toBe(0);
  });
  it('signs a temporary account and wallet without changing the simulated message', async () => {
    const wallet = await createTestSigner();
    const temporary = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8));
    const instruction = { programAddress: address('11111111111111111111111111111111'),
      accounts: [{ address: temporary.address, role: AccountRole.WRITABLE_SIGNER }] };
    const rpc = new FakeTransactionRpc();
    const result = await executeSafeTransaction({ rpc, wallet: wallet.address,
      additionalSigners: [temporary], instruction,
      signWithWallet: transaction => signTransaction([wallet.keyPair], transaction),
      confirm: async () => true });
    expect(result.status).toBe('confirmed');
    expect(rpc.sentWasFullySigned).toBe(true);
    expect(rpc.sentMessage).toEqual(rpc.simulatedMessage);
  });
  it('rejects an external wallet that drops the temporary signature', async () => {
    const wallet = await createTestSigner();
    const temporary = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8));
    const rpc = new FakeTransactionRpc();
    await expect(executeSafeTransaction({ rpc, wallet: wallet.address, additionalSigners: [temporary],
      instruction: { programAddress: address('11111111111111111111111111111111'),
        accounts: [{ address: temporary.address, role: AccountRole.WRITABLE_SIGNER }] },
      signWithWallet: async transaction => {
        const signed = await signTransaction([wallet.keyPair], transaction);
        return { ...signed, signatures: { ...signed.signatures, [temporary.address]: null } } as Transaction;
      }, confirm: async () => true })).rejects.toThrow(/invalid/);
    expect(rpc.sendCalls).toBe(0);
  });
  it('accepts an external signature for the exact simulated message', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    const result = await executeSafeTransaction({ rpc, wallet: signer.address,
      signWithWallet: transaction => signTransaction([signer.keyPair], transaction),
      instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true });
    expect(result.status).toBe('confirmed');
    expect(rpc.sentMessage).toEqual(rpc.simulatedMessage);
    expect(rpc.sendCalls).toBe(1);
  });
  it('rejects a wallet response that changes the message or signer', async () => {
    const signer = await createTestSigner();
    const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8));
    for (const signWithWallet of [
      async (transaction: Transaction) => {
        const signed = await signTransaction([signer.keyPair], transaction);
        return { ...signed, messageBytes: Uint8Array.from(signed.messageBytes, (byte, i) => i === 0 ? byte ^ 1 : byte) } as unknown as Transaction;
      },
      async (transaction: Transaction) => ({ ...transaction,
        signatures: { [other.address]: new Uint8Array(64) } } as Transaction),
    ]) {
      const rpc = new FakeTransactionRpc();
      await expect(executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet,
        instruction: { programAddress: address('11111111111111111111111111111111') },
        confirm: async () => true })).rejects.toThrow(/invalid/);
      expect(rpc.sendCalls).toBe(0);
    }
  });
  it('does not contact a wallet after cancellation or blockhash expiry', async () => {
    const signer = await createTestSigner();
    let calls = 0;
    for (const expired of [false, true]) {
      const rpc = new FakeTransactionRpc();
      if (expired) rpc.blockHeight = 101n;
      const result = executeSafeTransaction({ rpc, wallet: signer.address,
        signWithWallet: async transaction => { calls++; return signTransaction([signer.keyPair], transaction); },
        instruction: { programAddress: address('11111111111111111111111111111111') },
        confirm: async () => expired });
      if (expired) await expect(result).rejects.toThrow(/expired/);
      else await expect(result).resolves.toEqual({ status: 'cancelled' });
      expect(rpc.sendCalls).toBe(0);
    }
    expect(calls).toBe(0);
  });
  it('rejects external signing with an unrequested account after confirmation', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8));
    await expect(executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet: testWalletSigning(other),
      instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true })).rejects.toThrow(/not a signer/);
    expect(rpc.sendCalls).toBe(0);
  });
  it('rechecks expiry after asynchronously signing with the wallet', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    await expect(executeSafeTransaction({ rpc, wallet: signer.address,
      signWithWallet: async transaction => { rpc.blockHeight = 101n; return testWalletSigning(signer)(transaction); },
      instruction: { programAddress: address('11111111111111111111111111111111') },
      confirm: async () => true })).rejects.toThrow(/expired before sending/);
    expect(rpc.sendCalls).toBe(0);
  });
  it('does not expose the original message to simulation callbacks', async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    await executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet: testWalletSigning(signer),
      instruction: { programAddress: address('11111111111111111111111111111111') },
      beforeSimulation: async transaction => { (transaction.messageBytes as unknown as Uint8Array).fill(0); },
      confirm: async () => true });
    expect(rpc.sentMessage).toEqual(rpc.simulatedMessage);
    expect(rpc.sentMessage?.some(byte => byte !== 0)).toBe(true);
  });
  it("keeps the complete simulated multi-instruction message even when caller buffers change during confirmation", async () => {
    const rpc = new FakeTransactionRpc();
    const signer = await createTestSigner();
    const data = Uint8Array.of(1, 2, 3);
    const instructions = [{ programAddress: address("11111111111111111111111111111111"), data },
      { programAddress: address("11111111111111111111111111111111"), data: Uint8Array.of(4) }];
    await executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet: testWalletSigning(signer), instructions, confirm: async () => { data[0] = 99; instructions.reverse(); return true; } });
    expect(rpc.sentMessage).toEqual(rpc.simulatedMessage);
  });
  it("rejects empty, ambiguous and oversized transactions before simulation", async () => {
    const rpc = new FakeTransactionRpc(); const signer = await createTestSigner();
    const instruction = { programAddress: address("11111111111111111111111111111111"), data: new Uint8Array(1400) };
    for (const options of [{ instructions: [] }, { instruction, instructions: [instruction] }, { instructions: [instruction] }]) {
      await expect(executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet: testWalletSigning(signer), ...options, confirm: async () => true })).rejects.toThrow();
    }
    expect(rpc.simulateCalls).toBe(0); expect(rpc.sendCalls).toBe(0);
  });
  it("simulates with placeholder signatures, then signs and sends after approval", async () => {
    const rpc = new FakeTransactionRpc();
    const result = await executeWith(rpc, async () => true);
    expect(result).toEqual({ status: "confirmed", signature: rpc.transactionSignature });
    expect(rpc.unsignedHadNullSignature).toBe(true);
    expect(rpc.sentWasFullySigned).toBe(true);
    expect(rpc.sendCalls).toBe(1);
  });

  it("does not send when confirmation is declined", async () => {
    const rpc = new FakeTransactionRpc();
    await expect(executeWith(rpc, async () => false)).resolves.toEqual({ status: "cancelled" });
    expect(rpc.simulateCalls).toBe(1);
    expect(rpc.sendCalls).toBe(0);
  });

  it("does not request confirmation or send when simulation fails", async () => {
    const rpc = new FakeTransactionRpc();
    rpc.simulation = { error: { InstructionError: [0, "InvalidAccountData"] }, logs: ["Program failed"] };
    let confirmationCalls = 0;
    await expect(executeWith(rpc, async () => { confirmationCalls += 1; return true; })).rejects.toThrow(
      /simulation failed/,
    );
    expect(confirmationCalls).toBe(0);
    expect(rpc.sendCalls).toBe(0);
  });

  it("does not sign or send an expired simulated transaction", async () => {
    const rpc = new FakeTransactionRpc();
    rpc.blockHeight = 101n;
    await expect(executeWith(rpc, async () => true)).rejects.toThrow(/expired before signing/);
    expect(rpc.sendCalls).toBe(0);
  });

  describe("blockhash refresh after approval", () => {
    const lifetime = (fill: number, lastValidBlockHeight: bigint) =>
      ({ blockhash: blockhash(getBase58Decoder().decode(new Uint8Array(32).fill(fill))), lastValidBlockHeight });
    class RefreshingRpc extends FakeTransactionRpc {
      lifetimes = [lifetime(1, 100n), lifetime(2, 250n)];
      fees: (bigint | null)[] = [5_000n, 5_000n];
      simulations: SimulationResult[] = [];
      simulatedMessages: Uint8Array[] = [];
      private calls = { blockhash: 0, fee: 0, simulation: 0 };
      override async getLatestBlockhash() {
        return this.lifetimes[Math.min(this.calls.blockhash++, this.lifetimes.length - 1)]!;
      }
      async getTransactionFee() { return this.fees[Math.min(this.calls.fee++, this.fees.length - 1)]!; }
      override async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
        this.simulatedMessages.push(Uint8Array.from(transaction.messageBytes));
        await super.simulateTransaction(transaction);
        return this.simulations[this.calls.simulation++] ?? this.simulation;
      }
    }
    async function executeRefreshing(rpc: RefreshingRpc, confirm: () => Promise<boolean> = async () => true) {
      const signer = await createTestSigner();
      const signWithWallet = vi.fn(testWalletSigning(signer));
      const validateSimulation = vi.fn();
      const result = executeSafeTransaction({ rpc, wallet: signer.address, signWithWallet, validateSimulation,
        instruction: { programAddress: address("11111111111111111111111111111111") },
        confirm, pollIntervalMs: 0, sleep: async () => undefined });
      return { result, signWithWallet, validateSimulation };
    }

    it("signs a freshly simulated message so review time does not consume its lifetime", async () => {
      const rpc = new RefreshingRpc();
      // The review outlasts the provisional lifetime (100) but not the refreshed one (250).
      const run = await executeRefreshing(rpc, async () => { rpc.blockHeight = 150n; return true; });
      expect(await run.result).toEqual({ status: "confirmed", signature: rpc.transactionSignature });
      expect(rpc.simulatedMessages).toHaveLength(2);
      expect(run.validateSimulation).toHaveBeenCalledTimes(2);
      expect(rpc.simulatedMessages[1]).not.toEqual(rpc.simulatedMessages[0]);
      expect(rpc.sentMessage).toEqual(rpc.simulatedMessages[1]);
    });

    it("sends nothing when the fresh simulation fails after approval", async () => {
      const rpc = new RefreshingRpc();
      rpc.simulations = [{ error: null, logs: [] }, { error: { InstructionError: [0, "Custom"] }, logs: [] }];
      const run = await executeRefreshing(rpc);
      await expect(run.result).rejects.toThrow(/Fresh-blockhash simulation failed/);
      expect(run.signWithWallet).not.toHaveBeenCalled();
      expect(rpc.sendCalls).toBe(0);
    });

    it("sends nothing when the network fee rises after approval", async () => {
      const rpc = new RefreshingRpc();
      rpc.fees = [5_000n, 10_000n];
      const run = await executeRefreshing(rpc);
      await expect(run.result).rejects.toThrow(/network fee changed after approval/);
      expect(run.signWithWallet).not.toHaveBeenCalled();
      expect(rpc.sendCalls).toBe(0);
    });

    it("keeps the reviewed lifetime when a lagging RPC returns an older blockhash", async () => {
      const rpc = new RefreshingRpc();
      rpc.lifetimes = [lifetime(1, 100n), lifetime(2, 90n)];
      const run = await executeRefreshing(rpc);
      await expect(run.result).resolves.toMatchObject({ status: "confirmed" });
      expect(rpc.simulatedMessages).toHaveLength(1);
      expect(rpc.sentMessage).toEqual(rpc.simulatedMessages[0]);
    });
  });

  it("reports on-chain failure", async () => {
    const rpc = new FakeTransactionRpc();
    rpc.status = { confirmationStatus: "confirmed", error: "AccountNotFound" };
    await expect(executeWith(rpc, async () => true)).rejects.toThrow(/failed on-chain/);
  });

  it("times out while polling an unconfirmed signature", async () => {
    const rpc = new FakeTransactionRpc();
    rpc.status = null;
    let currentTime = 0;
    const signer = await createTestSigner();
    await expect(executeSafeTransaction({
      rpc,
      wallet: signer.address, signWithWallet: testWalletSigning(signer),
      instruction: { programAddress: address("11111111111111111111111111111111") },
      confirm: async () => true,
      pollIntervalMs: 0,
      timeoutMs: 2,
      sleep: async () => undefined,
      now: () => currentTime++,
    })).rejects.toThrow(/Timed out/);
  });
});
