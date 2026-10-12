import { createHash } from 'node:crypto';
import { address, blockhash, getAddressDecoder, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, type Address,
  type Transaction } from '@solana/kit';
import type { ChainAccount } from '../../src/core/accounts';
import type { SignatureStatus, SimulationResult } from '../../src/core/rpc';
import { ASSOCIATED_TOKEN_PROGRAM, associatedTokenAddress, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../src/core/tokens';
import { MAINNET_GENESIS } from '../../src/protocols/orca/adapter';
import { CLOCK, PROGRAM, SYSVAR, ZERO } from '../../src/protocols/orca/codec';
import { positionAddress, tickArrayAddress, whirlpoolAddress } from '../../src/protocols/orca/instructions';
import { createTestSigner } from './signer';
import { extendedBytes, feeConfigBytes } from './tokens';
import { i32, pubkey, Q64, tokenBytes, u128, u64, USDC } from './meteora';

export const SOL = address('So11111111111111111111111111111111111111112');
export const CONFIG = address('2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ');
export const POSITION_MINT = address('11111111111111111111111111111112');
export const VAULT_A = address('11111111111111111111111111111113');
export const VAULT_B = address('11111111111111111111111111111114');
export const REWARDS = ['11111111111111111111111111111115', '11111111111111111111111111111116', '11111111111111111111111111111117'].map(k => address(k));
export const REWARD_VAULTS = ['11111111111111111111111111111118', '11111111111111111111111111111119', '1111111111111111111111111111111A'].map(k => address(k));
export const LOOSE_NFT_ACCOUNT = address('1111111111111111111111111111111B');
const LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
export const disc = (name: string) => createHash('sha256').update(name).digest().subarray(0, 8);
const bytes = (name: string, size: number) => { const d = new Uint8Array(size); d.set(disc('account:' + name)); return d; };
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const readU128 = (d: Uint8Array, o: number) => view(d).getBigUint64(o, true) | view(d).getBigUint64(o + 8, true) << 64n;
// Independent offsets from the pinned Rust/Anchor layouts, not the production decoder.
export const P = { whirlpool: 8, mint: 40, liquidity: 72, lower: 88, upper: 92, checkpointA: 96, feeA: 112, checkpointB: 120, feeB: 136,
  reward: (i: number) => 144 + i * 24 };
export const W = { config: 8, tickSpacing: 41, seed: 43, liquidity: 49, sqrtPrice: 65, tick: 81, mintA: 101, vaultA: 133, growthA: 165,
  mintB: 181, vaultB: 213, growthB: 245, rewardTime: 261, reward: (i: number) => 269 + i * 128 };
export const tickOffset = (i: number) => 12 + i * 113;
export const TICK_ARRAY_WHIRLPOOL = 12 + 88 * 113;
export type OrcaFixtureOptions = { liquidity?: bigint; rewards?: number; feeOwed?: [bigint, bigint]; rewardOwed?: bigint;
  dynamicTicks?: boolean; nft2022?: boolean; looseNft?: boolean; frozenNft?: boolean; token2022?: boolean; transferFee?: boolean;
  missingAta?: boolean; rewardVaultAmount?: bigint; epoch?: bigint; tick?: number; wallet?: Address };
export class OrcaFixtureRpc {
  accounts = new Map<Address, ChainAccount | null>();
  slot = 100n; height = 1n; genesis = MAINNET_GENESIS;
  sent: Transaction[] = []; simulations: Transaction[] = []; blockhashes = 0; tokenQueries: unknown[] = [];
  status: SignatureStatus | null = { confirmationStatus: 'confirmed', error: null, slot: 100n };
  simulationError: unknown = null; sendError = false; fee: bigint | null = 5000n;
  mutateSimulation?: (accounts: Map<Address, ChainAccount | null>) => void;
  // Fixed fixture amounts paid by a full liquidity removal.
  removal: [bigint, bigint] = [100n, 200n];
  async getGenesisHash() { return this.genesis; }
  async getAccount(key: Address) { return this.accounts.get(key) ?? null; }
  async getAccounts(keys: readonly Address[], minSlot = 0n) {
    if (minSlot > this.slot) throw new Error('Stale RPC');
    return { slot: this.slot, accounts: keys.map(k => this.accounts.get(k) ?? null) };
  }
  async getTokenAccountsByOwner(owner: Address, filter: { programId: Address } | { mint: Address }) {
    this.tokenQueries.push(filter);
    const accounts = [...this.accounts].filter(([, a]) => a && (a.owner === TOKEN_PROGRAM || a.owner === TOKEN_2022_PROGRAM) && a.data.length >= 165
      && getAddressDecoder().decode(a.data.subarray(32, 64)) === owner
      && ('programId' in filter ? a.owner === filter.programId : getAddressDecoder().decode(a.data.subarray(0, 32)) === filter.mint));
    return { slot: this.slot, accounts: accounts.map(([address, account]) => ({ address, account: account! })) };
  }
  async getMinimumBalanceForRentExemption(size = 165) { return 2_039_280n + BigInt(size - 165) * 6960n; }
  async getLatestBlockhash() { this.blockhashes++; return { blockhash: blockhash(address('11111111111111111111111111111111')), lastValidBlockHeight: 100n }; }
  async getTransactionFee() { return this.fee; }
  async getBlockHeight() { return this.height; }
  async getSignatureStatus() { return this.status; }
  private apply(tx: Transaction) {
    const accounts = new Map([...this.accounts].map(([k, v]) => [k, v ? { ...v, data: v.data.slice() } : null]));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (message.version !== 'legacy') throw new Error('Fixture only accepts legacy messages');
    const transfer = (from: Address, to: Address, amount: bigint) => {
      const source = accounts.get(from)!.data, user = accounts.get(to)!.data;
      const mint = accounts.get(getAddressDecoder().decode(source.subarray(0, 32)))!.data;
      let fee = 0n;
      if (mint.length > 166 && view(mint).getUint16(166, true) === 1) {
        const epoch = view(accounts.get(CLOCK)!.data).getBigUint64(16, true), o = epoch >= view(mint).getBigUint64(260, true) ? 260 : 242;
        fee = (amount * BigInt(view(mint).getUint16(o + 16, true)) + 9999n) / 10000n;
        const cap = view(mint).getBigUint64(o + 8, true); if (fee > cap) fee = cap;
        for (let i = 166; i < user.length; i += 4 + view(user).getUint16(i + 2, true))
          if (view(user).getUint16(i, true) === 2) { u64(user, i + 4, view(user).getBigUint64(i + 4, true) + fee); break; }
      }
      if (view(source).getBigUint64(64, true) < amount) throw new Error('insufficient vault balance');
      u64(user, 64, view(user).getBigUint64(64, true) + amount - fee); u64(source, 64, view(source).getBigUint64(64, true) - amount);
    };
    for (const ix of message.instructions ?? []) {
      const program = message.staticAccounts[ix.programAddressIndex]!, keys = (ix.accountIndices ?? []).map(i => message.staticAccounts[i]!);
      if (program === ASSOCIATED_TOKEN_PROGRAM) {
        if (!accounts.get(keys[1]!)) {
          const tokenProgram = keys[5]!, mint = accounts.get(keys[3]!)!.data, base = tokenBytes(keys[3]!, keys[2]!, 0n);
          const hasFee = mint.length > 166 && view(mint).getUint16(166, true) === 1;
          const exts: [number, Uint8Array][] = [[7, new Uint8Array()]]; if (hasFee) exts.push([2, new Uint8Array(8)]);
          accounts.set(keys[1]!, { owner: tokenProgram, executable: false, lamports: 2_039_280n,
            data: tokenProgram === TOKEN_2022_PROGRAM ? extendedBytes(base, 2, exts) : base });
        }
        continue;
      }
      if (program !== PROGRAM) continue;
      const d = Uint8Array.from(ix.data!), name = Buffer.from(d.subarray(0, 8));
      const is = (n: string) => name.equals(disc('global:' + n));
      if (is('decrease_liquidity_v2')) {
        const pool = accounts.get(keys[0]!)!.data, pos = accounts.get(keys[5]!)!.data, liquidity = readU128(pos, P.liquidity);
        if (readU128(d, 8) !== liquidity) throw new Error('fixture expects full removal');
        u64(pos, P.feeA, view(pos).getBigUint64(P.feeA, true) + ((liquidity * (readU128(pool, W.growthA) - readU128(pos, P.checkpointA))) >> 64n));
        u64(pos, P.feeB, view(pos).getBigUint64(P.feeB, true) + ((liquidity * (readU128(pool, W.growthB) - readU128(pos, P.checkpointB))) >> 64n));
        u128(pos, P.checkpointA, readU128(pool, W.growthA)); u128(pos, P.checkpointB, readU128(pool, W.growthB));
        for (let i = 0; i < 3; i++) if (pool.subarray(W.reward(i), W.reward(i) + 32).some(b => b !== 0)) {
          const growth = readU128(pool, W.reward(i) + 112), r = P.reward(i);
          u64(pos, r + 16, view(pos).getBigUint64(r + 16, true) + ((liquidity * (growth - readU128(pos, r))) >> 64n)); u128(pos, r, growth);
        }
        u128(pos, P.liquidity, 0n);
        transfer(keys[11]!, keys[9]!, this.removal[0]); transfer(keys[12]!, keys[10]!, this.removal[1]);
      } else if (is('collect_fees_v2')) {
        const pos = accounts.get(keys[2]!)!.data;
        transfer(keys[7]!, keys[6]!, view(pos).getBigUint64(P.feeA, true)); transfer(keys[9]!, keys[8]!, view(pos).getBigUint64(P.feeB, true));
        u64(pos, P.feeA, 0n); u64(pos, P.feeB, 0n);
      } else if (is('collect_reward_v2')) {
        const pos = accounts.get(keys[2]!)!.data, r = P.reward(d[8]!), owed = view(pos).getBigUint64(r + 16, true);
        const vault = view(accounts.get(keys[6]!)!.data).getBigUint64(64, true), amount = owed < vault ? owed : vault;
        transfer(keys[6]!, keys[4]!, amount); u64(pos, r + 16, owed - amount);
      } else if (is('close_position') || is('close_position_with_token_extensions')) {
        const pos = accounts.get(keys[2]!)!.data;
        const empty = readU128(pos, P.liquidity) === 0n && view(pos).getBigUint64(P.feeA, true) === 0n && view(pos).getBigUint64(P.feeB, true) === 0n
          && [0, 1, 2].every(i => view(pos).getBigUint64(P.reward(i) + 16, true) === 0n);
        if (!empty) throw new Error('ClosePositionNotEmpty');
        accounts.set(keys[2]!, null); accounts.set(keys[4]!, null);
        if (is('close_position_with_token_extensions')) accounts.set(keys[3]!, null);
      } else throw new Error('unexpected Whirlpool instruction');
    }
    return accounts;
  }
  async simulateTransaction(tx: Transaction, keys?: readonly Address[]): Promise<SimulationResult> {
    this.simulations.push(tx);
    let accounts: Map<Address, ChainAccount | null>, error = this.simulationError;
    try { accounts = this.apply(tx); } catch (e) { accounts = this.accounts; error = { fixture: (e as Error).message }; }
    this.mutateSimulation?.(accounts);
    return { error, logs: [], unitsConsumed: 150_000n, snapshot: { slot: this.slot, accounts: (keys ?? []).map(k => accounts.get(k) ?? null) } };
  }
  async sendTransaction(tx: Transaction) {
    this.sent.push(tx); if (this.sendError) throw new Error('RPC disconnected');
    this.accounts = this.apply(tx); return getSignatureFromTransaction(tx);
  }
}
const mintBytes = (decimals: number, supply = 1_000_000_000n) => { const d = new Uint8Array(82); u64(d, 36, supply); d[44] = decimals; d[45] = 1; return d; };
export async function orcaFixture(options: OrcaFixtureOptions = {}) {
  const signer = await createTestSigner(), rpc = new OrcaFixtureRpc(), wallet = options.wallet ?? signer.address;
  const set = (key: Address, data: Uint8Array, owner: Address = PROGRAM, lamports = 10_000_000n) => rpc.accounts.set(key, { owner, executable: false, data, lamports });
  const seed = [64, 0], poolKey = await whirlpoolAddress(CONFIG, USDC, SOL, seed), positionKey = await positionAddress(POSITION_MINT);
  const liquidity = options.liquidity ?? 1000n, rewardCount = options.rewards ?? 0, tick = options.tick ?? 0;
  const pool = bytes('Whirlpool', 653);
  pubkey(pool, W.config, CONFIG); pool[40] = 255; view(pool).setUint16(W.tickSpacing, 64, true); pool.set(seed, W.seed);
  u128(pool, W.liquidity, 5000n); u128(pool, W.sqrtPrice, Q64); i32(pool, W.tick, tick);
  pubkey(pool, W.mintA, USDC); pubkey(pool, W.vaultA, VAULT_A); u128(pool, W.growthA, 3n * Q64);
  pubkey(pool, W.mintB, SOL); pubkey(pool, W.vaultB, VAULT_B); u128(pool, W.growthB, 5n * Q64); u64(pool, W.rewardTime, 100n);
  for (let i = 0; i < rewardCount; i++) { pubkey(pool, W.reward(i), REWARDS[i]!); pubkey(pool, W.reward(i) + 32, REWARD_VAULTS[i]!); u128(pool, W.reward(i) + 112, 2n * Q64); }
  set(poolKey, pool);
  const position = bytes('Position', 216);
  pubkey(position, P.whirlpool, poolKey); pubkey(position, P.mint, POSITION_MINT); u128(position, P.liquidity, liquidity);
  i32(position, P.lower, -128); i32(position, P.upper, 128);
  u64(position, P.feeA, options.feeOwed?.[0] ?? 0n); u64(position, P.feeB, options.feeOwed?.[1] ?? 0n);
  for (let i = 0; i < rewardCount; i++) u64(position, P.reward(i) + 16, options.rewardOwed ?? 0n);
  set(positionKey, position, PROGRAM, 2_394_240n);
  const nftProgram = options.nft2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  set(POSITION_MINT, mintBytes(0, 1n), nftProgram, 1_461_600n);
  const nftAccount = options.looseNft ? LOOSE_NFT_ACCOUNT : await associatedTokenAddress(wallet, POSITION_MINT, nftProgram);
  const nft = tokenBytes(POSITION_MINT, wallet, 1n); if (options.frozenNft) nft[108] = 2;
  set(nftAccount, nft, nftProgram, 2_039_280n);
  for (const [start, index] of [[-5632, -128], [0, 128]] as const) {
    const array = bytes(options.dynamicTicks ? 'DynamicTickArray' : 'TickArray', options.dynamicTicks ? 4000 : 9988);
    if (!options.dynamicTicks) {
      i32(array, 8, start); array[tickOffset((index - start) / 64)] = 1; pubkey(array, TICK_ARRAY_WHIRLPOOL, poolKey);
    }
    set(await tickArrayAddress(poolKey, start), array);
  }
  const mints: [Address, number][] = [[USDC, 6], [SOL, 9], ...REWARDS.slice(0, rewardCount).map(m => [m, 6] as [Address, number])];
  for (const [mint, decimals] of mints) {
    const fee = mint === USDC && options.token2022, program = fee ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
    set(mint, fee && options.transferFee ? extendedBytes(mintBytes(decimals), 1, [[1, feeConfigBytes()]]) : mintBytes(decimals), program);
    if (!options.missingAta) {
      const ata = await associatedTokenAddress(wallet, mint, program), base = tokenBytes(mint, wallet, 1000n);
      const exts: [number, Uint8Array][] = [[7, new Uint8Array()]]; if (fee && options.transferFee) exts.push([2, new Uint8Array(8)]);
      set(ata, program === TOKEN_2022_PROGRAM ? extendedBytes(base, 2, exts) : base, program, 2_039_280n);
    }
  }
  const vault = (key: Address, mint: Address, amount: bigint) => {
    const program = rpc.accounts.get(mint)!.owner, base = tokenBytes(mint, poolKey, amount);
    set(key, program === TOKEN_2022_PROGRAM && options.transferFee ? extendedBytes(base, 2, [[2, new Uint8Array(8)]]) : base, program);
  };
  vault(VAULT_A, USDC, 10_000_000n); vault(VAULT_B, SOL, 10_000_000n);
  REWARDS.slice(0, rewardCount).forEach((mint, i) => vault(REWARD_VAULTS[i]!, mint, options.rewardVaultAmount ?? 10_000_000n));
  const clock = new Uint8Array(40); u64(clock, 0, 100n); u64(clock, 16, options.epoch ?? 0n); u64(clock, 32, 100n); set(CLOCK, clock, SYSVAR);
  rpc.accounts.set(PROGRAM, { owner: LOADER, executable: true, data: new Uint8Array() });
  rpc.accounts.set(TOKEN_PROGRAM, { owner: ZERO, executable: true, data: new Uint8Array() });
  rpc.accounts.set(TOKEN_2022_PROGRAM, { owner: ZERO, executable: true, data: new Uint8Array() });
  return { rpc, signer, wallet, poolKey, positionKey, nftAccount };
}
