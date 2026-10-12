import type { Address } from '@solana/kit';
import type { AccountFilter, AccountSnapshot, ChainAccount } from '../../core/accounts';
import { tokenSymbol } from '../../core/format';
import { associatedTokenAddress, decodeTokenAccount, decodeTokenMint, metaplexMetadataAddress, onChainSymbol, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
  type TokenAccountState, type TokenMint, type TokenProgram } from '../../core/tokens';
import { MAINNET_GENESIS } from '../meteora/adapter';
import { check, CLOCK, decodeAccount, discriminator, hasDiscriminator, isClosedAccount, PROGRAM, SIZES, SYSVAR,
  type PoolState, type PositionState, type VestingState } from './codec';
import { nftAccountAddress, positionAddress } from './instructions';
import { nextUnlock, pendingFees, pendingRewards, removalAmounts, vestingDone, vestingRelease, vestingRemaining } from './math';

type OwnedAccounts = { slot: bigint; accounts: readonly { address: Address; account: ChainAccount }[] };
export interface DammReader {
  getGenesisHash(): Promise<string>;
  getAccounts(addresses: readonly Address[], minContextSlot?: bigint): Promise<AccountSnapshot>;
  getTokenAccountsByOwner(owner: Address, filter: { programId: Address } | { mint: Address }, minContextSlot?: bigint): Promise<OwnedAccounts>;
  getProgramAccounts(program: Address, size: number, filters: readonly AccountFilter[]): Promise<OwnedAccounts>;
}
export type Token = { mint: Address; decimals: number; symbol: string; ata: Address; token: TokenMint;
  /** The wallet's associated account before the withdrawal; null when it must be created. */
  before: TokenAccountState | null };
export type Reward = Token & { index: number; vault: Address; vaultFrozen: boolean };
export type Vesting = { address: Address; state: VestingState; lamports: bigint; release: bigint; closes: boolean };
export type DammPosition = {
  address: Address; wallet: Address; poolAddress: Address; state: PositionState; pool: PoolState; slot: bigint;
  nftAccount: Address; nftLocked: string | null;
  /** Slot or Unix timestamp, following the pool's activation type. */
  currentPoint: bigint; timestamp: bigint; epoch: bigint; activated: boolean;
  vestings: Vesting[];
  /** Liquidity after the matured vesting is released at the current point. */
  unlocked: bigint; vested: bigint; permanent: bigint; nextUnlock: bigint | null;
  liquidity: { a: bigint; b: bigint }; fees: { a: bigint; b: bigint }; rewardAmounts: bigint[];
  tokens: [Token, Token]; rewards: (Reward | null)[];
  /** Lamports of the position, its NFT account and NFT mint, refunded when the position closes. */
  closeRefund: bigint;
};
export type DammStatus = { address: Address; poolAddress?: Address; reason?: string; position?: DammPosition };
const programFlag = (flag: number): TokenProgram => { check(flag === 0 || flag === 1, 'invalid token program flag'); return flag ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM; };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not validate position accounts';
async function read(rpc: DammReader, keys: readonly Address[], minSlot: bigint) {
  const result = new Map<Address, ChainAccount | null>();
  let slot = minSlot;
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100), snapshot = await rpc.getAccounts(part, slot);
    check(snapshot.slot >= slot && snapshot.accounts.length === part.length, 'invalid account snapshot');
    slot = snapshot.slot; part.forEach((key, j) => result.set(key, snapshot.accounts[j] ?? null));
  }
  return { slot, accounts: result };
}
function heldNft(account: ChainAccount | null | undefined, mint: Address, wallet: Address): TokenAccountState | null {
  if (!account) return null;
  try { const state = decodeTokenAccount(account); return state.mint === mint && state.authority === wallet && state.amount === 1n ? state : null; }
  catch { return null; }
}
type Entry = { key: Address; holding?: Address | undefined; position?: ChainAccount | null };
export class DammAdapter {
  async assertNetwork(rpc: Pick<DammReader, 'getGenesisHash'>) {
    check(await rpc.getGenesisHash() === MAINNET_GENESIS, 'select a Solana mainnet-beta RPC');
  }
  /** Position NFTs are Token-2022 accounts holding one token; their mints derive the position PDAs. */
  async getStatus(rpc: DammReader, wallet: Address): Promise<DammStatus[]> {
    const [, list] = await Promise.all([this.assertNetwork(rpc), rpc.getTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM })]);
    const holdings = new Map<Address, Address>();
    for (const item of list.accounts) {
      try {
        const state = decodeTokenAccount(item.account);
        if (state.amount === 1n && state.authority === wallet && !holdings.has(state.mint)) holdings.set(state.mint, item.address);
      } catch { /* Not a token account this decoder accepts; it cannot hold a position NFT the program accepts. */ }
    }
    const derived = await Promise.all([...holdings].map(async ([mint, holding]) => ({ key: await positionAddress(mint), holding })));
    const { slot, accounts } = await read(rpc, derived.map(d => d.key), list.slot);
    const entries = derived.filter(d => { const a = accounts.get(d.key); return !!a && a.owner === PROGRAM && hasDiscriminator(a.data, discriminator('Position')); })
      .map(d => ({ ...d, position: accounts.get(d.key) }));
    return (await this.load(rpc, wallet, entries, slot)).map(({ key, result, poolAddress }) => result instanceof Error
      ? { address: key, ...(poolAddress ? { poolAddress } : {}), reason: result.message }
      : { address: key, poolAddress: result.poolAddress, position: result });
  }
  /** A fresh read of one position, or null once it is closed. */
  async readPosition(rpc: DammReader, wallet: Address, key: Address, minSlot = 0n): Promise<DammPosition | null> {
    const [, first] = await Promise.all([this.assertNetwork(rpc), rpc.getAccounts([key], minSlot)]);
    check(first.slot >= minSlot, 'stale position snapshot');
    if (isClosedAccount(first.accounts[0])) return null;
    const [loaded] = await this.load(rpc, wallet, [{ key, position: first.accounts[0] }], first.slot);
    if (loaded!.result instanceof Error) throw loaded!.result;
    return loaded!.result;
  }
  /** Pools in one read, then every mint, wallet account, NFT and reward vault in one more. */
  private async load(rpc: DammReader, wallet: Address, entries: readonly Entry[], minSlot: bigint) {
    const states = entries.map(entry => { try {
      const state = decodeAccount<PositionState>('Position', entry.position);
      return { entry, state };
    } catch (error) { return { entry, error: error as Error }; } });
    const pools = await read(rpc, [...new Set(states.flatMap(s => s.state ? [s.state.pool] : []))], minSlot);
    const prepared = await Promise.all(states.map(async item => {
      if (!item.state) return { ...item, keys: [] as Address[] };
      try {
        check(await positionAddress(item.state.nft_mint) === item.entry.key, 'position PDA mismatch');
        const pool = decodeAccount<PoolState>('Pool', pools.accounts.get(item.state.pool));
        const programs = [programFlag(pool.token_a_flag), programFlag(pool.token_b_flag)];
        const rewards = pool.reward_infos.map(r => r.initialized ? { mint: r.mint, vault: r.vault, program: programFlag(r.reward_token_flag) } : null);
        const mints = [{ mint: pool.token_a_mint, program: programs[0]! }, { mint: pool.token_b_mint, program: programs[1]! },
          ...rewards.flatMap(r => r ? [r] : [])];
        const atas = await Promise.all(mints.map(m => associatedTokenAddress(wallet, m.mint, m.program)));
        // Metaplex metadata is read in the same batch for display symbols only.
        const metadata = await Promise.all(mints.map(m => metaplexMetadataAddress(m.mint)));
        const nftAccounts = item.entry.holding ? [item.entry.holding]
          : [await nftAccountAddress(item.state.nft_mint), await associatedTokenAddress(wallet, item.state.nft_mint, TOKEN_2022_PROGRAM)];
        const keys = [item.entry.key, item.state.nft_mint, ...mints.map(m => m.mint), ...atas, ...rewards.flatMap(r => r ? [r.vault] : []), ...nftAccounts, ...metadata];
        return { ...item, pool, mints, atas, metadata, rewards, nftAccounts, keys };
      } catch (error) { return { ...item, error: error as Error, keys: [] as Address[] }; }
    }));
    const { slot, accounts } = await read(rpc, [...new Set([CLOCK, ...prepared.flatMap(p => p.keys)])], pools.slot);
    const clock = accounts.get(CLOCK);
    check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid Clock sysvar');
    const clockView = new DataView(clock.data.buffer, clock.data.byteOffset, 40);
    const clockSlot = clockView.getBigUint64(0, true), epoch = clockView.getBigUint64(16, true), timestamp = clockView.getBigInt64(32, true);
    check(timestamp >= 0n, 'invalid Clock timestamp');
    const results: { key: Address; poolAddress?: Address; result: DammPosition | Error }[] = [];
    for (const item of prepared) {
      const key = item.entry.key, poolAddress = item.state?.pool;
      if (item.error || !item.state || !item.pool) { results.push({ key, ...(poolAddress ? { poolAddress } : {}), result: item.error ?? new Error('position is missing') }); continue; }
      try {
        const account = accounts.get(key);
        // The position must not have changed between the discovery and the batched read.
        const state = decodeAccount<PositionState>('Position', account);
        check(state.pool === item.state.pool && state.nft_mint === item.state.nft_mint, 'position changed during loading; refresh');
        results.push({ key, poolAddress: state.pool, result: await this.build(rpc, wallet, key, state, item.pool, item, accounts,
          { slot, clockSlot, epoch, timestamp: BigInt(timestamp) }) });
      } catch (error) { results.push({ key, poolAddress, result: error instanceof Error ? error : new Error(errorText(error)) }); }
    }
    return results;
  }
  private async build(rpc: DammReader, wallet: Address, key: Address, state: PositionState, pool: PoolState,
    item: { entry: Entry; mints?: { mint: Address; program: TokenProgram }[]; atas?: Address[]; metadata?: Address[]; rewards?: ({ mint: Address; vault: Address; program: TokenProgram } | null)[]; nftAccounts?: Address[] },
    accounts: Map<Address, ChainAccount | null>, chain: { slot: bigint; clockSlot: bigint; epoch: bigint; timestamp: bigint }): Promise<DammPosition> {
    const nftAccount = item.nftAccounts!.find(k => heldNft(accounts.get(k), state.nft_mint, wallet));
    let nft = nftAccount ? heldNft(accounts.get(nftAccount), state.nft_mint, wallet) : null, nftKey = nftAccount;
    let nftLamports = nftAccount ? accounts.get(nftAccount)?.lamports ?? 0n : 0n;
    if (!nftKey) {
      // A position NFT outside the known accounts: one mint-filtered lookup.
      const owned = await rpc.getTokenAccountsByOwner(wallet, { mint: state.nft_mint }, chain.slot);
      const found = owned.accounts.find(entry => heldNft(entry.account, state.nft_mint, wallet));
      check(found, 'the connected wallet does not hold this position NFT');
      nftKey = found.address; nft = heldNft(found.account, state.nft_mint, wallet); nftLamports = found.account.lamports ?? 0n;
    }
    check(nft && nftKey, 'the connected wallet does not hold this position NFT');
    const tokens = item.mints!.map((m, i): Token => {
      const token = decodeTokenMint(m.mint, accounts.get(m.mint));
      check(token.program === m.program, 'pool token program flag does not match the mint');
      const ata = item.atas![i]!, existing = accounts.get(ata);
      let before: TokenAccountState | null = null;
      if (existing) {
        before = decodeTokenAccount(existing);
        check(before.mint === m.mint && before.authority === wallet, 'recipient token account mismatch');
      }
      return { mint: m.mint, decimals: token.decimals, symbol: tokenSymbol(m.mint, onChainSymbol(token, accounts.get(item.metadata![i]!))), ata, token, before };
    });
    let next = 2;
    const rewards = item.rewards!.map((r, index): Reward | null => {
      if (!r) { check(state.reward_infos[index]!.reward_pendings === 0n, 'position owes an uninitialized reward'); return null; }
      const token = tokens[next++]!, vault = decodeTokenAccount(accounts.get(r.vault));
      check(vault.mint === r.mint, 'reward vault mint mismatch');
      return { ...token, index, vault: r.vault, vaultFrozen: vault.frozen };
    });
    const currentPoint = pool.activation_type === 0 ? chain.clockSlot : pool.activation_type === 1 ? chain.timestamp : -1n;
    check(currentPoint >= 0n, 'invalid pool activation type');
    // Separate vesting accounts exist only when the position vests more than its inner schedule.
    const innerRemaining = vestingRemaining(state.inner_vesting);
    check(state.vested_liquidity >= innerRemaining, 'position vesting is inconsistent');
    let vestings: Vesting[] = [];
    if (state.vested_liquidity > innerRemaining) {
      const found = await rpc.getProgramAccounts(PROGRAM, SIZES.Vesting, [{ offset: 8, bytes: key }]);
      vestings = found.accounts.map(({ address, account }) => {
        const vesting = decodeAccount<VestingState>('Vesting', account);
        check(vesting.position === key, 'vesting account belongs to another position');
        const release = vestingRelease(vesting.inner_vesting, currentPoint);
        return { address, state: vesting, lamports: account.lamports ?? 0n, release,
          closes: vestingDone({ ...vesting.inner_vesting, total_released_liquidity: vesting.inner_vesting.total_released_liquidity + release }) };
      }).sort((a, b) => a.address < b.address ? -1 : 1);
      check(vestings.reduce((n, v) => n + vestingRemaining(v.state.inner_vesting), 0n) === state.vested_liquidity - innerRemaining,
        'vesting accounts do not match the position; refresh');
    }
    const release = vestingRelease(state.inner_vesting, currentPoint) + vestings.reduce((n, v) => n + v.release, 0n);
    const unlocked = state.unlocked_liquidity + release, vested = state.vested_liquidity - release;
    const unlocks = [nextUnlock(state.inner_vesting, currentPoint), ...vestings.map(v => nextUnlock(v.state.inner_vesting, currentPoint))]
      .filter((p): p is bigint => p !== null);
    const nftLocked = nft.frozen ? 'The position NFT account is frozen, so the NFT cannot be burned.'
      : nft.closeAuthority && nft.closeAuthority !== wallet ? 'The position NFT account has a different close authority.' : null;
    return { address: key, wallet, poolAddress: state.pool, state, pool, slot: chain.slot, nftAccount: nftKey, nftLocked,
      currentPoint, timestamp: chain.timestamp, epoch: chain.epoch, activated: currentPoint >= pool.activation_point,
      vestings, unlocked, vested, permanent: state.permanent_locked_liquidity, nextUnlock: unlocks.length ? unlocks.reduce((a, b) => a < b ? a : b) : null,
      liquidity: removalAmounts(pool, unlocked), fees: pendingFees(pool, state), rewardAmounts: pendingRewards(pool, state, chain.timestamp),
      tokens: [tokens[0]!, tokens[1]!], rewards,
      closeRefund: (accounts.get(key)?.lamports ?? 0n) + nftLamports + (accounts.get(state.nft_mint)?.lamports ?? 0n) };
  }
}
