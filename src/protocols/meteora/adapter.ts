import { address, getAddressEncoder, getBase58Decoder, type Address } from '@solana/kit';
import type { AccountFilter, ChainAccount, LendingReader } from '../../core/accounts';
import { check, CLOCK, SYSVAR, decodeAccount, decodePosition, discriminator, hasDiscriminator, LEGACY_DISCRIMINATOR,
  mintDecimals, isClosedAccount, PROGRAM, TOKEN, tokenState, WSOL, ZERO, type Bin, type BinArray, type PoolState, type PositionState } from './codec';
import { ataAddress, binArrayAddress, integerBytes, keyBytes, pda } from './instructions';
import { binArrayIndex, estimateBins, type BinEstimate } from './math';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export interface MeteoraReader extends Pick<LendingReader,'getAccount'|'getAccounts'> {
  getGenesisHash(): Promise<string>;
  getProgramAccountsByFilters(program: Address, filters: readonly AccountFilter[]): Promise<{
    slot: bigint; accounts: readonly { address: Address; account: ChainAccount }[] } >;
}
export type Token = { mint: Address; decimals: number; symbol: string; ata: Address };
export type MeteoraPosition = { address: Address; wallet: Address; poolAddress: Address; state: PositionState; pool: PoolState;
  slot: bigint; account: ChainAccount; accounts: Map<Address, ChainAccount | null>; binArrays: Map<number, Address>;
  bins: BinEstimate[]; tokens: Token[]; rewards: (Token | null)[]; bitmap: Address };
export type MeteoraStatus = { address: Address; poolAddress?: Address; reason?: string; position?: MeteoraPosition };
const known = new Map<string, string>([[WSOL,'WSOL'], ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','USDC']]);
function symbol(mint: Address) { return known.get(mint) ?? `${mint.slice(0,4)}…${mint.slice(-4)}`; }
export async function validatePoolPda(key: Address, pool: PoolState) {
  const ordered = [pool.token_x_mint, pool.token_y_mint].sort((a,b) => {
    const x = getAddressEncoder().encode(a), y = getAddressEncoder().encode(b);
    return x.findIndex((v,i) => v !== y[i]) < 0 ? 0 : (() => { const i = x.findIndex((v,j) => v !== y[j]); return x[i]! - y[i]!; })();
  }).map(keyBytes);
  let seeds: (Uint8Array | string)[];
  if (pool.pair_type === 0) seeds = [...ordered, Uint8Array.from(pool.bin_step_seed), ...(pool.require_base_factor_seed ? [Uint8Array.from(pool.base_factor_seed)] : [])];
  else if (pool.pair_type === 1) seeds = [keyBytes(pool.base_key), ...ordered, Uint8Array.from(pool.bin_step_seed)];
  else if (pool.pair_type === 2) seeds = [keyBytes(address('MFGQxwAmB91SwuYX36okv2Qmdc9aMuHTwWGUrp4AtB1')), ...ordered];
  else if (pool.pair_type === 3) {
    const preset = await pda(['preset_parameter2', Uint8Array.from(pool.bin_step_seed)]);
    seeds = [keyBytes(preset), ...ordered];
  } else throw new Error('Meteora: unknown pool PDA type');
  check(await pda(seeds) === key, 'pool PDA mismatch');
}
export class MeteoraAdapter {
  async assertNetwork(rpc: Pick<MeteoraReader,'getGenesisHash'>) {
    check(await rpc.getGenesisHash() === MAINNET_GENESIS, 'select a Solana mainnet-beta RPC');
  }
  async getStatus(rpc: MeteoraReader, wallet: Address): Promise<MeteoraStatus[]> {
    await this.assertNetwork(rpc);
    const result: MeteoraStatus[] = [];
    // Discriminator + owner, deliberately no dataSize filter. Legacy positions remain visible.
    for (const disc of [discriminator('PositionV2'), LEGACY_DISCRIMINATOR]) {
      const discovery = await rpc.getProgramAccountsByFilters(PROGRAM, [
        { offset: 0, bytes: getBase58Decoder().decode(Uint8Array.from(disc)) }, { offset: 40, bytes: wallet },
      ]);
      for (const item of discovery.accounts) {
        if (result.some(p => p.address === item.address)) continue;
        if (hasDiscriminator(item.account.data, LEGACY_DISCRIMINATOR)) {
          result.push({ address: item.address, reason: 'Legacy positions are unsupported. PositionV2 is required.' }); continue;
        }
        let poolAddress: Address | undefined;
        try {
          poolAddress = decodePosition(item.account).lb_pair;
          const position = await this.readPosition(rpc, wallet, item.address, discovery.slot);
          if (position) result.push({ address: item.address, poolAddress, position });
        } catch (error) { result.push({ address: item.address, poolAddress, reason: error instanceof Error ? error.message : 'Could not validate position accounts' }); }
      }
    }
    return result;
  }
  async readPosition(rpc: MeteoraReader, wallet: Address, key: Address, minSlot = 0n): Promise<MeteoraPosition | null> {
    await this.assertNetwork(rpc);
    const first = await rpc.getAccounts([key], minSlot); check(first.slot >= minSlot, 'stale position snapshot');
    if (isClosedAccount(first.accounts[0])) return null;
    const initial = decodePosition(first.accounts[0]); check(initial.owner === wallet, 'position owner is not the connected wallet');
    const poolKey = initial.lb_pair;
    const second = await rpc.getAccounts([poolKey], first.slot); check(second.slot >= first.slot, 'stale pool snapshot');
    const initialPool = decodeAccount<PoolState>('LbPair', second.accounts[0]);
    const arrayKeys = new Map<number, Address>();
    for (let index = binArrayIndex(initial.lower_bin_id); index <= binArrayIndex(initial.upper_bin_id); index++) arrayKeys.set(index, await binArrayAddress(poolKey,index));
    const bitmapKey = await pda(['bitmap',keyBytes(poolKey)]);
    const mints = [initialPool.token_x_mint, initialPool.token_y_mint, ...initialPool.reward_infos.filter(r => r.mint !== ZERO).map(r => r.mint)];
    const atas = await Promise.all(mints.map(mint => ataAddress(wallet,mint)));
    const keys = [...new Set([key,poolKey,PROGRAM,TOKEN,CLOCK,bitmapKey,...arrayKeys.values(), ...mints, ...atas,
      initialPool.reserve_x, initialPool.reserve_y, ...initialPool.reward_infos.filter(r => r.mint !== ZERO).map(r => r.vault)])];
    const snapshot = await rpc.getAccounts(keys,second.slot); check(snapshot.slot >= second.slot && snapshot.accounts.length === keys.length, 'invalid account snapshot');
    const accounts = new Map(keys.map((key,i) => [key,snapshot.accounts[i]!]));
    const account = accounts.get(key); if (isClosedAccount(account)) return null;
    check(account,'position is missing from the snapshot');
    const state = decodePosition(account), pool = decodeAccount<PoolState>('LbPair',accounts.get(poolKey));
    check(state.owner === wallet && state.lb_pair === poolKey && state.lower_bin_id === initial.lower_bin_id && state.upper_bin_id === initial.upper_bin_id, 'position links/range changed during loading; refresh');
    check(pool.token_x_mint === initialPool.token_x_mint && pool.token_y_mint === initialPool.token_y_mint && pool.reserve_x === initialPool.reserve_x && pool.reserve_y === initialPool.reserve_y
      && pool.reward_infos.every((r,i) => r.mint === initialPool.reward_infos[i]?.mint && r.vault === initialPool.reward_infos[i]?.vault), 'pool dependencies changed during loading');
    check(accounts.get(PROGRAM)?.executable && accounts.get(PROGRAM)?.owner === address('BPFLoaderUpgradeab1e11111111111111111111111'), 'DLMM program is not executable under the expected loader');
    check(accounts.get(TOKEN)?.executable, 'SPL Token program is not executable');
    const clock = accounts.get(CLOCK); check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid Clock sysvar');
    const clockView = new DataView(clock.data.buffer,clock.data.byteOffset,40), slot = clockView.getBigUint64(0,true), timestamp = clockView.getBigInt64(32,true);
    check([0,1].includes(pool.activation_type), 'unknown lock activation type');
    check(state.lock_release_point <= (pool.activation_type === 0 ? slot : timestamp), 'This position has an active liquidity lock.');
    check(state.fee_owner === ZERO || state.fee_owner === wallet, 'This position has a separate fee recipient.');
    check(pool.token_mint_x_program_flag === 0 && pool.token_mint_y_program_flag === 0, 'Token-2022 pool tokens are unsupported.');
    check(state.lower_bin_id >= pool.parameters.min_bin_id && state.upper_bin_id <= pool.parameters.max_bin_id, 'position exceeds pool bin bounds');
    await validatePoolPda(poolKey,pool);
    const tokens = await Promise.all(mints.map(async mint => {
      const ata = await ataAddress(wallet,mint), decimals = mintDecimals(accounts.get(mint));
      if (accounts.get(ata)) tokenState(accounts.get(ata),mint,wallet);
      return { mint,ata,decimals,symbol:symbol(mint) };
    }));
    for (const [reserve,mint] of [[pool.reserve_x,pool.token_x_mint],[pool.reserve_y,pool.token_y_mint]] as const) {
      check(await pda([keyBytes(poolKey),keyBytes(mint)]) === reserve, 'reserve PDA mismatch'); tokenState(accounts.get(reserve),mint,poolKey);
    }
    const rewards = await Promise.all(pool.reward_infos.map(async (reward,i) => {
      if (reward.mint === ZERO) return null;
      check(await pda([keyBytes(poolKey),integerBytes(BigInt(i),8)]) === reward.vault, 'reward vault PDA mismatch');
      tokenState(accounts.get(reward.vault),reward.mint,poolKey);
      return tokens.find(t => t.mint === reward.mint)!;
    }));
    const bitmapAccount = accounts.get(bitmapKey);
    if (bitmapAccount) check(decodeAccount<{lb_pair: Address}>('BinArrayBitmapExtension',bitmapAccount).lb_pair === poolKey, 'bitmap pool mismatch');
    const bins = new Map<number,Bin>();
    for (const [index,arrayKey] of arrayKeys) {
      const arrayAccount = accounts.get(arrayKey); if (!arrayAccount) continue;
      const array = decodeAccount<BinArray>('BinArray',arrayAccount);
      check(array.index === BigInt(index) && array.lb_pair === poolKey, 'bin array index/pool mismatch');
      array.bins.forEach((bin,i) => bins.set(index*70+i,bin));
    }
    const estimates = estimateBins(state,pool,bins,timestamp);
    for (const bin of estimates) check(bins.has(bin.id) || (!bin.share && !bin.feeX && !bin.feeY && bin.rewards.every(v => v === 0n)), 'active position bin array is missing');
    return { address:key,wallet,poolAddress:poolKey,state,pool,slot:snapshot.slot,account,accounts,binArrays:arrayKeys,
      bins:estimates,tokens:tokens.slice(0,2),rewards,bitmap:bitmapAccount ? bitmapKey : PROGRAM };
  }
}
