import { createHash } from 'node:crypto';
import { address, blockhash, getAddressDecoder, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, type Address,
  type Transaction } from '@solana/kit';
import type { AccountFilter, ChainAccount } from '../../src/core/accounts';
import type { SignatureStatus, SimulationResult } from '../../src/core/rpc';
import { ASSOCIATED_TOKEN_PROGRAM, associatedTokenAddress, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../src/core/tokens';
import { MAINNET_GENESIS } from '../../src/protocols/meteora/adapter';
import { CLOCK, PROGRAM, SYSVAR, ZERO } from '../../src/protocols/meteora-damm/codec';
import { nftAccountAddress, positionAddress } from '../../src/protocols/meteora-damm/instructions';
import { createTestSigner } from './signer';
import { extendedBytes, feeConfigBytes } from './tokens';
import { pubkey, tokenBytes, u128, u64, USDC } from './meteora';

export const SOL = address('So11111111111111111111111111111111111111112');
export const POOL = address('11111111111111111111111111111112');
export const NFT_MINT = address('11111111111111111111111111111113');
export const VAULT_A = address('11111111111111111111111111111114');
export const VAULT_B = address('11111111111111111111111111111115');
export const REWARDS = ['11111111111111111111111111111116', '11111111111111111111111111111117'].map(k => address(k));
export const REWARD_VAULTS = ['11111111111111111111111111111118', '11111111111111111111111111111119'].map(k => address(k));
export const NFT_ACCOUNT = address('1111111111111111111111111111111A');
export const VESTINGS = ['1111111111111111111111111111111B', '1111111111111111111111111111111C'].map(k => address(k));
export const HOOK_PROGRAM = address('1111111111111111111111111111111D');
const Q128 = 1n << 128n;
/** Liquidity is Q64-scaled: this default is worth a few hundred units of each token. */
export const LIQUIDITY = 1_000n << 64n;
export const disc = (name: string) => createHash('sha256').update(name).digest().subarray(0, 8);
const bytes = (name: string, size: number) => { const d = new Uint8Array(size); d.set(disc('account:' + name)); return d; };
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const readU64 = (d: Uint8Array, o: number) => view(d).getBigUint64(o, true);
const readU128 = (d: Uint8Array, o: number) => readU64(d, o) | readU64(d, o + 8) << 64n;
const readU256 = (d: Uint8Array, o: number) => readU128(d, o) | readU128(d, o + 16) << 128n;
const u256 = (d: Uint8Array, o: number, n: bigint) => { u128(d, o, n & (Q128 - 1n)); u128(d, o + 16, n >> 128n); };
// Independent offsets from the pinned Rust layouts (bytemuck, no implicit padding), not the production decoder.
export const POOL_AT = { mintA: 168, mintB: 200, vaultA: 232, vaultB: 264, liquidity: 360, sqrtMin: 424, sqrtMax: 440, sqrtPrice: 456,
  activationPoint: 472, activationType: 480, flagA: 482, flagB: 483, feeMode: 484, feeA: 488, feeB: 520, amountA: 680, amountB: 688,
  layout: 696, reward: (i: number) => 728 + i * 192 };
export const REWARD_AT = { initialized: 0, flag: 1, mint: 16, vault: 48, durationEnd: 120, rate: 128, stored: 144, lastUpdate: 176 };
export const POSITION_AT = { pool: 8, mint: 40, checkpointA: 72, checkpointB: 104, feeA: 136, feeB: 144, unlocked: 152, vested: 168,
  permanent: 184, reward: (i: number) => 216 + i * 48, inner: 312 };
export const VESTING_AT = { position: 8, inner: 40 };
// InnerVesting: cliff_point u64, period_frequency u64, cliff_unlock u128, per_period u128, released u128, periods u16.
export type Schedule = { cliff: bigint; frequency?: bigint; cliffUnlock: bigint; perPeriod?: bigint; released?: bigint; periods?: number };
function writeSchedule(d: Uint8Array, o: number, s: Schedule) {
  u64(d, o, s.cliff); u64(d, o + 8, s.frequency ?? 0n); u128(d, o + 16, s.cliffUnlock); u128(d, o + 32, s.perPeriod ?? 0n);
  u128(d, o + 48, s.released ?? 0n); view(d).setUint16(o + 64, s.periods ?? 0, true);
}
function release(d: Uint8Array, o: number, point: bigint) {
  const cliff = readU64(d, o), frequency = readU64(d, o + 8), cliffUnlock = readU128(d, o + 16), per = readU128(d, o + 32);
  const released = readU128(d, o + 48), periods = BigInt(view(d).getUint16(o + 64, true));
  const total = cliffUnlock + per * periods;
  if (total === 0n) return { amount: 0n, done: true };
  let unlocked = 0n;
  if (point >= cliff) {
    if (frequency === 0n || per === 0n) unlocked = cliffUnlock;
    else { let n = (point - cliff) / frequency; if (n > periods) n = periods; unlocked = cliffUnlock + n * per; }
  }
  const amount = unlocked - released; u128(d, o + 48, released + amount);
  return { amount, done: released + amount === total };
}
export type DammFixtureOptions = { unlocked?: bigint; permanent?: bigint; inner?: Schedule; vestings?: Schedule[];
  feePending?: [bigint, bigint]; feeGrowth?: [bigint, bigint]; rewards?: number; rewardPending?: bigint; frozenRewardVault?: boolean;
  token2022?: boolean; transferFee?: boolean; hook?: boolean; missingAta?: boolean; activationPoint?: bigint; nftFrozen?: boolean;
  nftInAta?: boolean; nftElsewhere?: boolean; compounding?: boolean; price?: 'low' | 'mid' | 'high'; epoch?: bigint; wallet?: Address };
export class DammFixtureRpc {
  accounts = new Map<Address, ChainAccount | null>();
  slot = 100n; height = 1n; genesis = MAINNET_GENESIS; time = 1_000n;
  sent: Transaction[] = []; simulations: Transaction[] = []; programQueries = 0; tokenQueries: unknown[] = [];
  status: SignatureStatus | null = { confirmationStatus: 'confirmed', error: null, slot: 100n };
  simulationError: unknown = null; fee: bigint | null = 5000n;
  /** Fixed amounts paid by a full removal of the unlocked liquidity. */
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
  async getProgramAccounts(program: Address, size: number, filters: readonly AccountFilter[]) {
    this.programQueries++;
    const accounts = [...this.accounts].filter(([, a]) => a && a.owner === program && a.data.length === size
      && filters.every(f => getAddressDecoder().decode(a.data.subarray(f.offset, f.offset + 32)) === f.bytes));
    return { slot: this.slot, accounts: accounts.map(([address, account]) => ({ address, account: account! })) };
  }
  async getLatestBlockhash() { return { blockhash: blockhash(address('11111111111111111111111111111111')), lastValidBlockHeight: 100n }; }
  async getTransactionFee() { return this.fee; }
  async getBlockHeight() { return this.height; }
  async getSignatureStatus() { return this.status; }
  private apply(tx: Transaction) {
    const accounts = new Map([...this.accounts].map(([k, v]) => [k, v ? { ...v, data: v.data.slice() } : null]));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (message.version !== 'legacy') throw new Error('Fixture only accepts legacy messages');
    const data = (key: Address) => accounts.get(key)!.data;
    const transfer = (from: Address, to: Address, amount: bigint) => {
      if (amount === 0n) return;
      const source = data(from), user = data(to);
      if (source[108] === 2 || user[108] === 2) throw new Error('AccountFrozen');
      const mint = data(getAddressDecoder().decode(source.subarray(0, 32)));
      let fee = 0n;
      if (mint.length > 166 && view(mint).getUint16(166, true) === 1) {
        const epoch = readU64(data(CLOCK), 16), o = epoch >= readU64(mint, 260) ? 260 : 242;
        fee = (amount * BigInt(view(mint).getUint16(o + 16, true)) + 9999n) / 10000n;
        const cap = readU64(mint, o + 8); if (fee > cap) fee = cap;
        for (let i = 166; i < user.length; i += 4 + view(user).getUint16(i + 2, true))
          if (view(user).getUint16(i, true) === 2) { u64(user, i + 4, readU64(user, i + 4) + fee); break; }
      }
      if (readU64(source, 64) < amount) throw new Error('insufficient vault balance');
      u64(user, 64, readU64(user, 64) + amount - fee); u64(source, 64, readU64(source, 64) - amount);
    };
    const total = (pos: Uint8Array) => readU128(pos, POSITION_AT.unlocked) + readU128(pos, POSITION_AT.vested) + readU128(pos, POSITION_AT.permanent);
    const updateFee = (pool: Uint8Array, pos: Uint8Array) => {
      for (const [stored, checkpoint, pending] of [[POOL_AT.feeA, POSITION_AT.checkpointA, POSITION_AT.feeA], [POOL_AT.feeB, POSITION_AT.checkpointB, POSITION_AT.feeB]] as const) {
        const growth = readU256(pool, stored);
        u64(pos, pending, readU64(pos, pending) + (total(pos) * (growth - readU256(pos, checkpoint)) >> 128n)); u256(pos, checkpoint, growth);
      }
    };
    const point = (pool: Uint8Array) => pool[POOL_AT.activationType] === 0 ? readU64(data(CLOCK), 0) : readU64(data(CLOCK), 32);
    for (const ix of message.instructions ?? []) {
      const program = message.staticAccounts[ix.programAddressIndex]!, keys = (ix.accountIndices ?? []).map(i => message.staticAccounts[i]!);
      if (program === ASSOCIATED_TOKEN_PROGRAM) {
        if (!accounts.get(keys[1]!)) {
          const tokenProgram = keys[5]!, mint = data(keys[3]!), base = tokenBytes(keys[3]!, keys[2]!, 0n);
          // A native account records its rent-exempt reserve; its lamports are reserve plus balance.
          if (keys[3] === SOL) u64(base, 113, 2_039_280n);
          const exts: [number, Uint8Array][] = [[7, new Uint8Array()]];
          if (mint.length > 166 && view(mint).getUint16(166, true) === 1) exts.push([2, new Uint8Array(8)]);
          accounts.set(keys[1]!, { owner: tokenProgram, executable: false, lamports: 2_039_280n,
            data: tokenProgram === TOKEN_2022_PROGRAM ? extendedBytes(base, 2, exts) : base });
        }
        continue;
      }
      if (program !== PROGRAM) continue;
      const d = Uint8Array.from(ix.data!), name = Buffer.from(d.subarray(0, 8));
      const is = (n: string) => name.equals(disc('global:' + n));
      if (is('refresh_vesting')) {
        const pool = data(keys[0]!), pos = data(keys[1]!), now = point(pool);
        const add = (amount: bigint) => { u128(pos, POSITION_AT.vested, readU128(pos, POSITION_AT.vested) - amount); u128(pos, POSITION_AT.unlocked, readU128(pos, POSITION_AT.unlocked) + amount); };
        add(release(pos, POSITION_AT.inner, now).amount);
        for (const key of keys.slice(4)) {
          const vesting = data(key), result = release(vesting, VESTING_AT.inner, now); add(result.amount);
          if (result.done) accounts.set(key, null);
        }
      } else if (is('claim_position_fee')) {
        const pool = data(keys[1]!), pos = data(keys[2]!); updateFee(pool, pos);
        transfer(keys[5]!, keys[3]!, readU64(pos, POSITION_AT.feeA)); transfer(keys[6]!, keys[4]!, readU64(pos, POSITION_AT.feeB));
        u64(pos, POSITION_AT.feeA, 0n); u64(pos, POSITION_AT.feeB, 0n);
      } else if (is('remove_all_liquidity')) {
        const pool = data(keys[1]!), pos = data(keys[2]!);
        if (point(pool) < readU64(pool, POOL_AT.activationPoint)) throw new Error('PoolDisabled');
        const inner = release(pos, POSITION_AT.inner, point(pool)).amount;
        u128(pos, POSITION_AT.vested, readU128(pos, POSITION_AT.vested) - inner); u128(pos, POSITION_AT.unlocked, readU128(pos, POSITION_AT.unlocked) + inner);
        if (readU128(pos, POSITION_AT.unlocked) === 0n) throw new Error('InsufficientLiquidity');
        if (readU64(d, 8) !== 0n || readU64(d, 16) !== 0n) throw new Error('fixture expects zero thresholds');
        updateFee(pool, pos); u128(pos, POSITION_AT.unlocked, 0n);
        transfer(keys[5]!, keys[3]!, this.removal[0]); transfer(keys[6]!, keys[4]!, this.removal[1]);
      } else if (is('claim_reward')) {
        const pos = data(keys[2]!), index = d[8]!, skip = d[9] === 1, r = POSITION_AT.reward(index) + 32, pending = readU64(pos, r);
        if (data(keys[3]!)[108] === 2) { if (pending > 0n && !skip) throw new Error('RewardVaultFrozenSkipRequired'); }
        else transfer(keys[3]!, keys[5]!, pending);
        u64(pos, r, 0n);
      } else if (is('close_position')) {
        const pos = data(keys[3]!);
        const empty = total(pos) === 0n && readU64(pos, POSITION_AT.feeA) === 0n && readU64(pos, POSITION_AT.feeB) === 0n
          && [0, 1].every(i => readU64(pos, POSITION_AT.reward(i) + 32) === 0n);
        if (!empty) throw new Error('PositionIsNotEmpty');
        if (data(keys[1]!)[108] === 2) throw new Error('AccountFrozen');
        accounts.set(keys[3]!, null); accounts.set(keys[1]!, null); accounts.set(keys[0]!, null);
      } else throw new Error('unexpected DAMM v2 instruction');
    }
    return accounts;
  }
  async simulateTransaction(tx: Transaction, keys?: readonly Address[]): Promise<SimulationResult> {
    this.simulations.push(tx);
    let accounts: Map<Address, ChainAccount | null>, error = this.simulationError;
    try { accounts = this.apply(tx); } catch (e) { accounts = this.accounts; error = { fixture: (e as Error).message }; }
    return { error, logs: [], unitsConsumed: 90_000n, snapshot: { slot: this.slot, accounts: (keys ?? []).map(k => accounts.get(k) ?? null) } };
  }
  async sendTransaction(tx: Transaction) {
    this.sent.push(tx); this.accounts = this.apply(tx); return getSignatureFromTransaction(tx);
  }
}
const mintBytes = (decimals: number, supply = 1_000_000_000n) => { const d = new Uint8Array(82); u64(d, 36, supply); d[44] = decimals; d[45] = 1; return d; };
export async function dammFixture(options: DammFixtureOptions = {}) {
  const signer = await createTestSigner(), rpc = new DammFixtureRpc(), wallet = options.wallet ?? signer.address;
  const set = (key: Address, data: Uint8Array, owner: Address = PROGRAM, lamports = 10_000_000n) =>
    rpc.accounts.set(key, { owner, executable: false, data, lamports });
  const positionKey = await positionAddress(NFT_MINT), rewardCount = options.rewards ?? 0;
  const tokenA = options.token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  const pool = bytes('Pool', 1112);
  pubkey(pool, POOL_AT.mintA, USDC); pubkey(pool, POOL_AT.mintB, SOL); pubkey(pool, POOL_AT.vaultA, VAULT_A); pubkey(pool, POOL_AT.vaultB, VAULT_B);
  u128(pool, POOL_AT.liquidity, 10_000n << 64n);
  // A 1:1 range [0.5, 2] in Q64 square-root prices; the price sets where in the range the pool trades.
  const q64 = 1n << 64n;
  u128(pool, POOL_AT.sqrtMin, q64 * 7n / 10n); u128(pool, POOL_AT.sqrtMax, q64 * 14n / 10n);
  u128(pool, POOL_AT.sqrtPrice, options.price === 'low' ? q64 * 7n / 10n : options.price === 'high' ? q64 * 14n / 10n : q64);
  u64(pool, POOL_AT.activationPoint, options.activationPoint ?? 0n); pool[POOL_AT.activationType] = 1;
  pool[POOL_AT.flagA] = tokenA === TOKEN_2022_PROGRAM ? 1 : 0; pool[POOL_AT.flagB] = 0; pool[POOL_AT.feeMode] = options.compounding ? 2 : 0;
  u256(pool, POOL_AT.feeA, (options.feeGrowth?.[0] ?? 0n) * Q128 / (10n ** 18n)); u256(pool, POOL_AT.feeB, (options.feeGrowth?.[1] ?? 0n) * Q128 / (10n ** 18n));
  u64(pool, POOL_AT.amountA, 1_000_000n); u64(pool, POOL_AT.amountB, 2_000_000n); pool[POOL_AT.layout] = 1;
  for (let i = 0; i < rewardCount; i++) {
    const r = POOL_AT.reward(i); pool[r + REWARD_AT.initialized] = 1;
    pubkey(pool, r + REWARD_AT.mint, REWARDS[i]!); pubkey(pool, r + REWARD_AT.vault, REWARD_VAULTS[i]!);
    // Emissions ended at the last update, so the estimate equals the stored pending amount.
    u64(pool, r + REWARD_AT.durationEnd, 500n); u64(pool, r + REWARD_AT.lastUpdate, 500n);
  }
  set(POOL, pool, PROGRAM, 8_630_400n);
  const position = bytes('Position', 408);
  pubkey(position, POSITION_AT.pool, POOL); pubkey(position, POSITION_AT.mint, NFT_MINT);
  u128(position, POSITION_AT.unlocked, options.unlocked ?? LIQUIDITY); u128(position, POSITION_AT.permanent, options.permanent ?? 0n);
  u64(position, POSITION_AT.feeA, options.feePending?.[0] ?? 0n); u64(position, POSITION_AT.feeB, options.feePending?.[1] ?? 0n);
  for (let i = 0; i < rewardCount; i++) u64(position, POSITION_AT.reward(i) + 32, options.rewardPending ?? 0n);
  let vested = 0n;
  if (options.inner) { writeSchedule(position, POSITION_AT.inner, options.inner); vested += scheduleRemaining(options.inner); }
  for (const [i, schedule] of (options.vestings ?? []).entries()) {
    const vesting = bytes('Vesting', 184); pubkey(vesting, VESTING_AT.position, positionKey); writeSchedule(vesting, VESTING_AT.inner, schedule);
    set(VESTINGS[i]!, vesting, PROGRAM, 2_171_520n); vested += scheduleRemaining(schedule);
  }
  u128(position, POSITION_AT.vested, vested);
  set(positionKey, position, PROGRAM, 3_730_560n);
  set(NFT_MINT, mintBytes(0, 1n), TOKEN_2022_PROGRAM, 3_841_920n);
  const nftAccount = options.nftInAta ? await associatedTokenAddress(wallet, NFT_MINT, TOKEN_2022_PROGRAM)
    : options.nftElsewhere ? NFT_ACCOUNT : await nftAccountAddress(NFT_MINT);
  const nft = tokenBytes(NFT_MINT, wallet, 1n); if (options.nftFrozen) nft[108] = 2;
  set(nftAccount, extendedBytes(nft, 2, [[7, new Uint8Array()]]), TOKEN_2022_PROGRAM, 2_074_080n);
  const mints: [Address, number, Address][] = [[USDC, 6, tokenA], [SOL, 9, TOKEN_PROGRAM], ...REWARDS.slice(0, rewardCount).map(m => [m, 6, TOKEN_PROGRAM] as [Address, number, Address])];
  for (const [mint, decimals, program] of mints) {
    const exts: [number, Uint8Array][] = [];
    if (mint === USDC && options.transferFee) exts.push([1, feeConfigBytes()]);
    if (mint === USDC && options.hook) { const hook = new Uint8Array(64); pubkey(hook, 32, HOOK_PROGRAM); exts.push([14, hook]); }
    set(mint, exts.length ? extendedBytes(mintBytes(decimals), 1, exts) : mintBytes(decimals), program);
    if (!options.missingAta) {
      const ata = await associatedTokenAddress(wallet, mint, program as typeof TOKEN_PROGRAM), base = tokenBytes(mint, wallet, 1000n);
      const accountExts: [number, Uint8Array][] = [[7, new Uint8Array()]]; if (mint === USDC && options.transferFee) accountExts.push([2, new Uint8Array(8)]);
      set(ata, program === TOKEN_2022_PROGRAM ? extendedBytes(base, 2, accountExts) : base, program, 2_039_280n);
    }
  }
  const vault = (key: Address, mint: Address, amount: bigint, frozen = false) => {
    const program = rpc.accounts.get(mint)!.owner, base = tokenBytes(mint, address('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'), amount);
    if (frozen) base[108] = 2;
    set(key, program === TOKEN_2022_PROGRAM && options.transferFee ? extendedBytes(base, 2, [[2, new Uint8Array(8)]]) : base, program);
  };
  vault(VAULT_A, USDC, 10_000_000n); vault(VAULT_B, SOL, 10_000_000n);
  REWARDS.slice(0, rewardCount).forEach((mint, i) => vault(REWARD_VAULTS[i]!, mint, 10_000_000n, options.frozenRewardVault && i === 0));
  const clock = new Uint8Array(40); u64(clock, 0, rpc.slot); u64(clock, 16, options.epoch ?? 0n); u64(clock, 32, rpc.time); set(CLOCK, clock, SYSVAR);
  rpc.accounts.set(TOKEN_PROGRAM, { owner: ZERO, executable: true, data: new Uint8Array() });
  return { rpc, signer, wallet, positionKey, nftAccount };
}
function scheduleRemaining(s: Schedule) { return s.cliffUnlock + (s.perPeriod ?? 0n) * BigInt(s.periods ?? 0) - (s.released ?? 0n); }
