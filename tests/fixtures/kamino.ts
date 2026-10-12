import { createHash } from "node:crypto";
import { address, blockhash, getAddressEncoder, signature, type Address, type Transaction } from "@solana/kit";
import type { ChainAccount, AccountFilter } from "../../src/core/accounts";
import type { SimulationResult } from "../../src/core/rpc";
import { KaminoAdapter } from "../../src/protocols/kamino/adapter";
import { CLOCK, FARMS, TOKEN, ZERO } from "../../src/protocols/kamino/accounts";
import { SF } from "../../src/protocols/kamino/math";
import captured from "./kamino/mainnet.json" with { type: "json" };
import { createTestSigner } from "./signer";

export const adapter = new KaminoAdapter();
export const POSITION = address("11111111111111111111111111111112");
export const USDC = address(adapter.metadata.tokens[0]!.reserve);
export const WSOL = address(adapter.metadata.tokens[1]!.reserve);
export const SLOT = BigInt(captured.provenance.slot);
export const u64 = (data: Uint8Array, offset: number, value: bigint) => new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(offset, value, true);
export const u128 = (data: Uint8Array, offset: number, value: bigint) => { u64(data, offset, value & ((1n << 64n) - 1n)); u64(data, offset + 8, value >> 64n); };
export const pubkey = (data: Uint8Array, offset: number, key: Address) => data.set(getAddressEncoder().encode(key), offset);
export function captureAccounts(): Map<Address, ChainAccount | null> {
  return new Map(captured.keys.map((key, index) => {
    const value = captured.accounts[index];
    return [address(key), value ? { owner: address(value.owner), executable: value.executable, data: new Uint8Array(Buffer.from(value.data, "base64")) } : null];
  }));
}
// Independent pinned Rust offsets, including explicit zero-copy padding. Not a production encoder.
export function obligationBytes(wallet: Address, reserve = USDC, deposit = 1_000_000_000n, debt = 100_000_000n,
  { borrowReserve = reserve, elevationGroup = 0 }: { borrowReserve?: Address; elevationGroup?: number } = {}): Uint8Array {
  const bytes = new Uint8Array(3344);
  bytes.set(createHash("sha256").update("account:Obligation").digest().subarray(0, 8));
  u64(bytes, 16, SLOT); bytes[25] = 63;
  pubkey(bytes, 32, adapter.marketAddress); pubkey(bytes, 64, wallet);
  if (deposit > 0n) {
    pubkey(bytes, 96, reserve); u64(bytes, 128, deposit); u128(bytes, 136, 1_000n * SF);
    u128(bytes, 1192, 1_000n * SF);
  }
  if (debt > 0n) {
    pubkey(bytes, 1208, borrowReserve); u64(bytes, 1240, SF); u128(bytes, 1296, debt * SF);
    u128(bytes, 1312, 100n * SF); u128(bytes, 1328, 100n * SF);
    u128(bytes, 2208, 100n * SF); u128(bytes, 2224, 100n * SF);
    bytes[2287] = 1;
  }
  u128(bytes, 2240, 800n * SF); u128(bytes, 2256, 900n * SF);
  bytes[2285] = elevationGroup;
  return bytes;
}
export function tokenBytes(wallet: Address, mint: Address, balance: bigint): Uint8Array {
  const data = new Uint8Array(165);
  pubkey(data, 0, mint); pubkey(data, 32, wallet); u64(data, 64, balance); data[108] = 1;
  return data;
}
export class FixtureRpc {
  accounts = captureAccounts();
  discovery: Address[] = [POSITION];
  simulations: Transaction[] = [];
  sent: Transaction[] = [];
  filters: readonly AccountFilter[] = [];
  simulationError: unknown = null;
  missingSimulationAccounts = false;
  blockHeight = 1n;
  finalAccounts: (ChainAccount | null)[] = [];
  rent = 2_039_280n;
  fee: bigint | null = 10_000n;
  async getMinimumBalanceForRentExemption() { return this.rent; }
  async getTransactionFee() { return this.fee; }
  async getAccount(key: Address) { return this.accounts.get(key) ?? null; }
  async getAccounts(keys: readonly Address[], minSlot?: bigint) {
    if (minSlot !== undefined && minSlot > SLOT) throw new Error("min context slot too high");
    return { slot: SLOT, accounts: keys.map(key => this.accounts.get(key) ?? null) };
  }
  async getProgramAccounts(_program: Address, _size: number, filters: readonly AccountFilter[]) {
    this.filters = filters;
    return { slot: SLOT, accounts: this.discovery.map(key => ({ address: key, account: this.accounts.get(key)! })) };
  }
  async getLatestBlockhash() { return { blockhash: blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 100n }; }
  async simulateTransaction(transaction: Transaction, keys?: readonly Address[]): Promise<SimulationResult> {
    this.simulations.push(transaction);
    return { error: this.simulationError, logs: [], ...(!keys || this.missingSimulationAccounts ? {} : {
      snapshot: { slot: SLOT, accounts: keys[2] !== adapter.marketAddress ? keys.map(key => {
        const source = this.accounts.get(key);
        if (!source) return null;
        const copy = { ...source, data: source.data.slice() };
        // Model successful refresh at the fixture bank; no Rust execution is claimed.
        u64(copy.data, 16, SLOT); copy.data[24] = 0; copy.data[25] = 63;
        return copy;
      }) : this.finalAccounts.length === 2 ? [...this.finalAccounts, ...keys.slice(2).map(key => this.accounts.get(key) ?? null)] : this.finalAccounts },
    }) };
  }
  async sendTransaction(transaction: Transaction) { this.sent.push(transaction); return signature("1".repeat(64)); }
  async getSignatureStatus() { return { confirmationStatus: "confirmed" as const, error: null }; }
  async getBlockHeight() { return this.blockHeight; }
}
export async function fixture(options: { reserve?: Address; deposit?: bigint; debt?: bigint; balance?: bigint; missingAta?: boolean } = {}) {
  const wallet = await createTestSigner();
  const rpc = new FixtureRpc();
  rpc.accounts.set(wallet.address, { owner: ZERO, executable: false, data: new Uint8Array(), lamports: 10_000_000_000n });
  rpc.accounts.set(ZERO, { owner: address("NativeLoader1111111111111111111111111111111"), executable: true, data: new Uint8Array() });
  const reserveKey = options.reserve ?? USDC;
  const reserve = adapter.programInterface.decodeAccount("Reserve", rpc.accounts.get(reserveKey)!.data);
  const liquidity = reserve.liquidity as { mintPubkey: Address; cumulativeBorrowRateBsf: { value: bigint[] } };
  const mint = liquidity.mintPubkey;
  const ata = await adapter.ata(wallet.address, mint);
  const obligation = obligationBytes(wallet.address, reserveKey, options.deposit, options.debt);
  // Match the recorded reserve's current borrow rate for the synthetic obligation.
  liquidity.cumulativeBorrowRateBsf.value.forEach((value, index) => u64(obligation, 1240 + index * 8, value));
  rpc.accounts.set(POSITION, { owner: adapter.programAddress, executable: false, data: obligation });
  if (!options.missingAta) rpc.accounts.set(ata, { owner: TOKEN, executable: false, data: tokenBytes(wallet.address, mint, options.balance ?? 1_000_000_000n) });
  const farm = reserve.farmCollateral as Address;
  const farmUser = await adapter.programInterface.derivePda("farmUser", { farm, obligation: POSITION });
  const user = new Uint8Array(920);
  user.set(createHash("sha256").update("account:UserState").digest().subarray(0, 8));
  pubkey(user, 16, farm); pubkey(user, 48, wallet.address); user[80] = 1; pubkey(user, 480, POSITION);
  rpc.accounts.set(farmUser, { owner: FARMS, executable: false, data: user });
  return { rpc, wallet, adapter, ata, mint, farm, farmUser, reserveKey, obligation, clock: rpc.accounts.get(CLOCK)! };
}

