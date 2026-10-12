import { address, type Address } from '@solana/kit';
import type { AccountSnapshot, ChainAccount } from '../../core/accounts';
import { tokenSymbol } from '../../core/format';
import { associatedTokenAddress, decodeTokenAccount, decodeTokenMint, metaplexMetadataAddress, onChainSymbol, TOKEN_2022_PROGRAM, TOKEN_PROGRAM,
  type TokenAccountState, type TokenMint, type TokenProgram } from '../../core/tokens';
import { check, CLOCK, decodeAccount, DISCRIMINATORS, hasDiscriminator, isClosedAccount, PROGRAM, rewardInitialized, SYSVAR,
  type PositionState, type Tick, type TickArrayState, type WhirlpoolState } from './codec';
import { positionAddress, positionBundleAddress, tickArrayAddress, whirlpoolAddress } from './instructions';
import { liquidityAmounts, owedAfterUpdate, tickArrayStartIndex, tickOffset, type OwedEstimate } from './math';
import { validateWithdrawalMint, withdrawalTokenState } from './token-policy';

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
type OwnedAccounts = { slot: bigint; accounts: readonly { address: Address; account: ChainAccount }[] };
export interface OrcaReader {
  getGenesisHash(): Promise<string>;
  getAccounts(addresses: readonly Address[], minContextSlot?: bigint): Promise<AccountSnapshot>;
  getTokenAccountsByOwner(owner: Address, filter: { programId: Address } | { mint: Address }, minContextSlot?: bigint): Promise<OwnedAccounts>;
}
export type Token = { mint: Address; decimals: number; symbol: string; ata: Address; token: TokenMint };
export type Reward = Token & { index: number; vault: Address; vaultAmount: bigint };
export type OrcaPosition = {
  address: Address; wallet: Address; poolAddress: Address; state: PositionState; pool: WhirlpoolState;
  slot: bigint; account: ChainAccount; accounts: Map<Address, ChainAccount | null>;
  positionMint: TokenMint; tokenAccount: Address; tickArrays: { lower: Address; upper: Address };
  /** False when a tick array uses a format the pinned interface does not describe (fees and rewards then come from simulation). */
  ticksKnown: boolean;
  liquidity: { a: bigint; b: bigint }; owed: OwedEstimate;
  tokens: Token[]; rewards: (Reward | null)[]; epoch: bigint; timestamp: bigint; rentRefund: bigint;
};
export type OrcaStatus = { address: Address; kind: 'position' | 'bundle'; poolAddress?: Address; reason?: string; position?: OrcaPosition };
const UPGRADEABLE_LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
const PROGRAMS: readonly TokenProgram[] = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM];
async function chunked(rpc: OrcaReader, keys: readonly Address[], minSlot: bigint) {
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
export class OrcaAdapter {
  async assertNetwork(rpc: Pick<OrcaReader, 'getGenesisHash'>) {
    check(await rpc.getGenesisHash() === MAINNET_GENESIS, 'select a Solana mainnet-beta RPC');
  }
  /** Positions are NFTs: the wallet's token accounts with amount 1 identify them, with no program-wide scan. */
  async getStatus(rpc: OrcaReader, wallet: Address): Promise<OrcaStatus[]> {
    await this.assertNetwork(rpc);
    const lists = await Promise.all(PROGRAMS.map(programId => rpc.getTokenAccountsByOwner(wallet, { programId })));
    const holdings = new Map<Address, Address>();
    for (const list of lists) for (const item of list.accounts) {
      try {
        const state = decodeTokenAccount(item.account);
        if (state.amount === 1n && state.authority === wallet && !holdings.has(state.mint)) holdings.set(state.mint, item.address);
      } catch { /* Not a token account this decoder accepts; it cannot hold a supported position. */ }
    }
    const minSlot = lists.reduce((slot, list) => list.slot > slot ? list.slot : slot, 0n);
    const mints = [...holdings.keys()];
    const derived = await Promise.all(mints.map(async mint => ({ mint, position: await positionAddress(mint), bundle: await positionBundleAddress(mint) })));
    const { slot, accounts } = await chunked(rpc, derived.flatMap(d => [d.position, d.bundle]), minSlot);
    const result: OrcaStatus[] = [];
    for (const { mint, position, bundle } of derived) {
      const owned = (key: Address, name: keyof typeof DISCRIMINATORS) => {
        const account = accounts.get(key); return !!account && account.owner === PROGRAM && hasDiscriminator(account.data, DISCRIMINATORS[name]);
      };
      if (owned(position, 'Position')) {
        try {
          const read = await this.readPosition(rpc, wallet, position, slot, holdings.get(mint));
          if (read) result.push({ address: position, kind: 'position', poolAddress: read.poolAddress, position: read });
        } catch (error) {
          let poolAddress: Address | undefined;
          try { poolAddress = decodeAccount<PositionState>('Position', accounts.get(position)).whirlpool; } catch { /* reported below */ }
          result.push({ address: position, kind: 'position', ...(poolAddress ? { poolAddress } : {}),
            reason: error instanceof Error ? error.message : 'Could not validate position accounts' });
        }
      } else if (owned(bundle, 'PositionBundle')) {
        result.push({ address: bundle, kind: 'bundle', reason: 'Position bundles are unsupported. Only single-position NFTs can be withdrawn here.' });
      }
    }
    return result;
  }
  async readPosition(rpc: OrcaReader, wallet: Address, key: Address, minSlot = 0n, holding?: Address): Promise<OrcaPosition | null> {
    await this.assertNetwork(rpc);
    const first = await rpc.getAccounts([key], minSlot); check(first.slot >= minSlot, 'stale position snapshot');
    if (isClosedAccount(first.accounts[0])) return null;
    const initial = decodeAccount<PositionState>('Position', first.accounts[0]);
    check(await positionAddress(initial.positionMint) === key, 'position PDA mismatch');
    const poolKey = initial.whirlpool;
    const second = await rpc.getAccounts([poolKey], first.slot); check(second.slot >= first.slot, 'stale pool snapshot');
    const initialPool = decodeAccount<WhirlpoolState>('Whirlpool', second.accounts[0]);
    const spacing = initialPool.tickSpacing;
    const lowerKey = await tickArrayAddress(poolKey, tickArrayStartIndex(initial.tickLowerIndex, spacing));
    const upperKey = await tickArrayAddress(poolKey, tickArrayStartIndex(initial.tickUpperIndex, spacing));
    const rewardSlots = initialPool.rewardInfos.filter(rewardInitialized);
    const mints = [initialPool.tokenMintA, initialPool.tokenMintB, ...rewardSlots.map(r => r.mint)];
    // Both possible ATAs are read with the mints, so ownership and balances come from one coherent snapshot.
    const atas = (await Promise.all([...new Set([...mints, initial.positionMint])].flatMap(mint =>
      PROGRAMS.map(async program => [`${mint}:${program}`, await associatedTokenAddress(wallet, mint, program)] as const)))).reduce(
      (map, [id, ata]) => map.set(id, ata), new Map<string, Address>());
    // Metaplex metadata is read in the same batch for display symbols only.
    const metadata = await Promise.all(mints.map(metaplexMetadataAddress));
    const keys = [...new Set([key, poolKey, PROGRAM, ...PROGRAMS, CLOCK, lowerKey, upperKey, initial.positionMint, ...mints, ...atas.values(),
      initialPool.tokenVaultA, initialPool.tokenVaultB, ...rewardSlots.map(r => r.vault), ...(holding ? [holding] : []), ...metadata])];
    const { slot, accounts } = await chunked(rpc, keys, second.slot);
    const account = accounts.get(key); if (isClosedAccount(account)) return null;
    check(account, 'position is missing from the snapshot');
    const state = decodeAccount<PositionState>('Position', account), pool = decodeAccount<WhirlpoolState>('Whirlpool', accounts.get(poolKey));
    check(state.whirlpool === poolKey && state.positionMint === initial.positionMint && state.tickLowerIndex === initial.tickLowerIndex
      && state.tickUpperIndex === initial.tickUpperIndex, 'position links/range changed during loading; refresh');
    check(pool.tokenMintA === initialPool.tokenMintA && pool.tokenMintB === initialPool.tokenMintB && pool.tokenVaultA === initialPool.tokenVaultA
      && pool.tokenVaultB === initialPool.tokenVaultB && pool.tickSpacing === spacing
      && pool.rewardInfos.every((r, i) => r.mint === initialPool.rewardInfos[i]!.mint && r.vault === initialPool.rewardInfos[i]!.vault),
    'pool dependencies changed during loading');
    check(await whirlpoolAddress(pool.whirlpoolsConfig, pool.tokenMintA, pool.tokenMintB, pool.tickSpacingSeed) === poolKey, 'pool PDA mismatch');
    check(pool.tokenMintA !== pool.tokenMintB, 'pool mints must differ');
    check(accounts.get(PROGRAM)?.executable && accounts.get(PROGRAM)?.owner === UPGRADEABLE_LOADER, 'Whirlpool program is not executable under the expected loader');
    for (const program of PROGRAMS) check(accounts.get(program)?.executable, 'token program is not executable');
    const clock = accounts.get(CLOCK); check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid Clock sysvar');
    const clockView = new DataView(clock.data.buffer, clock.data.byteOffset, 40);
    const epoch = clockView.getBigUint64(16, true), timestamp = clockView.getBigInt64(32, true);
    // The position NFT: the program burns it and closes its account (and a Token-2022 mint) on close.
    const positionMint = decodeTokenMint(state.positionMint, accounts.get(state.positionMint));
    check(positionMint.decimals === 0 && positionMint.supply === 1n, 'position mint is not a single NFT');
    const candidates = [...new Set([holding, atas.get(`${state.positionMint}:${positionMint.program}`)].filter((k): k is Address => !!k))];
    let tokenAccount = candidates.find(k => heldNft(accounts.get(k), state.positionMint, wallet));
    let nft = tokenAccount ? heldNft(accounts.get(tokenAccount), state.positionMint, wallet) : null;
    if (!tokenAccount) {
      // A position NFT outside the ATA: one mint-filtered lookup, then the account joins the snapshot.
      const owned = await rpc.getTokenAccountsByOwner(wallet, { mint: state.positionMint }, slot);
      const found = owned.accounts.find(item => heldNft(item.account, state.positionMint, wallet));
      check(found, 'position owner is not the connected wallet');
      tokenAccount = found.address; nft = heldNft(found.account, state.positionMint, wallet); accounts.set(found.address, found.account);
    }
    check(nft && nft.program === positionMint.program, 'position token program mismatch');
    check(!nft.frozen, 'This position is locked: its position token account is frozen.');
    check(!nft.closeAuthority || nft.closeAuthority === wallet, 'The position token account has a different close authority.');
    const tokens = mints.map((mint, i) => {
      const token = decodeTokenMint(mint, accounts.get(mint)); validateWithdrawalMint(token);
      const ata = atas.get(`${mint}:${token.program}`)!;
      if (accounts.get(ata)) withdrawalTokenState(accounts.get(ata), token, wallet);
      return { mint, ata, decimals: token.decimals, symbol: tokenSymbol(mint, onChainSymbol(token, accounts.get(metadata[i]!))), token };
    });
    withdrawalTokenState(accounts.get(pool.tokenVaultA), tokens[0]!.token, poolKey);
    withdrawalTokenState(accounts.get(pool.tokenVaultB), tokens[1]!.token, poolKey);
    const rewards = pool.rewardInfos.map((reward, index): Reward | null => {
      if (!rewardInitialized(reward)) {
        check(state.rewardInfos[index]!.amountOwed === 0n, 'position owes an uninitialized reward');
        return null;
      }
      const token = tokens.find(t => t.mint === reward.mint)!;
      return { ...token, index, vault: reward.vault, vaultAmount: withdrawalTokenState(accounts.get(reward.vault), token.token, poolKey).amount };
    });
    let ticksKnown = true, ticks: [Tick, Tick] | null = null;
    if (state.liquidity > 0n) {
      const arrays = [lowerKey, upperKey].map(k => accounts.get(k));
      for (const array of arrays) check(array && array.owner === PROGRAM && !array.executable && array.data.length >= 8, 'position tick array is missing');
      if (arrays.every(a => hasDiscriminator(a!.data, DISCRIMINATORS.TickArray))) {
        ticks = [[lowerKey, state.tickLowerIndex], [upperKey, state.tickUpperIndex]].map(([arrayKey, tick]) => {
          const array = decodeAccount<TickArrayState>('TickArray', accounts.get(arrayKey as Address));
          const start = tickArrayStartIndex(tick as number, spacing);
          check(array.whirlpool === poolKey && array.startTickIndex === start, 'tick array pool/start mismatch');
          return array.ticks[tickOffset(tick as number, start, spacing)]!;
        }) as [Tick, Tick];
      } else ticksKnown = false;
    }
    check(timestamp >= 0n, 'invalid Clock timestamp');
    const owed = ticks ? owedAfterUpdate(pool, state, ticks[0], ticks[1], BigInt(timestamp))
      : { feeA: state.feeOwedA, feeB: state.feeOwedB, rewards: state.rewardInfos.map(r => r.amountOwed) };
    const lamports = (k: Address) => accounts.get(k)?.lamports ?? 0n;
    return { address: key, wallet, poolAddress: poolKey, state, pool, slot, account, accounts, positionMint, tokenAccount,
      tickArrays: { lower: lowerKey, upper: upperKey }, ticksKnown, liquidity: liquidityAmounts(pool, state), owed,
      tokens: tokens.slice(0, 2), rewards, epoch, timestamp: BigInt(timestamp),
      rentRefund: (account.lamports ?? 0n) + lamports(tokenAccount) + (positionMint.program === TOKEN_2022_PROGRAM ? lamports(state.positionMint) : 0n) };
  }
}
