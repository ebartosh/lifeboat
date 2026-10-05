import { check, ZERO, type Bin, type PoolState, type PositionState } from './codec';
export const Q64 = 1n << 64n;
export type BinEstimate = { id: number; share: bigint; x: bigint; y: bigint; feeX: bigint; feeY: bigint; rewards: bigint[] };
const delta = (a: bigint, b: bigint) => a > b ? a - b : 0n;
export function binArrayIndex(bin: number) { return Math.floor(bin / 70); }
export function supportsLimitOrders(pool: PoolState) {
  check([0,1,2].includes(pool.parameters.function_type), 'unknown pool function type');
  return pool.parameters.function_type === 2 || (pool.parameters.function_type === 0 && pool.reward_infos.every(r => r.mint === ZERO));
}
/** SDK processPosition / Rust DynamicPosition: floor each bin before summing. */
export function estimateBins(position: PositionState, pool: PoolState, bins: Map<number, Bin>, timestamp: bigint): BinEstimate[] {
  const limitOrders = supportsLimitOrders(pool);
  return position.liquidity_shares.map((share, i) => {
    const id = position.lower_bin_id + i, bin = bins.get(id), fee = position.fee_infos[i]!, reward = position.reward_infos[i]!;
    check(!share || (bin && bin.liquidity_supply >= share), 'bin liquidity supply is smaller than the position share');
    const scaled = share >> 64n;
    const x = bin?.liquidity_supply ? share * bin.amount_x / bin.liquidity_supply : 0n;
    const y = bin?.liquidity_supply ? share * bin.amount_y / bin.liquidity_supply : 0n;
    const feeX = fee.fee_x_pending + (scaled * delta(bin?.fee_amount_x_per_token_stored ?? 0n, fee.fee_x_per_token_complete) >> 64n);
    const feeY = fee.fee_y_pending + (scaled * delta(bin?.fee_amount_y_per_token_stored ?? 0n, fee.fee_y_per_token_complete) >> 64n);
    const rewards = pool.reward_infos.map((info, j) => {
      if (info.mint === ZERO || limitOrders) { check(reward.reward_pendings[j] === 0n, 'pending rewards have no valid reward configuration'); return 0n; }
      let stored = !bin ? 0n : j === 0 ? bin.fulfilled_order_amount_x | bin.fulfilled_order_amount_y << 64n
        : bin.limit_order_fee_ask_side | bin.limit_order_fee_bid_side << 64n;
      if (id === pool.active_id && bin && bin.liquidity_supply >> 64n) {
        stored += info.reward_rate * delta(timestamp < info.reward_duration_end ? timestamp : info.reward_duration_end, info.last_update_time)
          / 15n / (bin.liquidity_supply >> 64n);
      }
      return reward.reward_pendings[j]! + (scaled * delta(stored, reward.reward_per_token_completes[j]!) >> 64n);
    });
    for (const amount of [x,y,feeX,feeY,...rewards]) check(amount >= 0n && amount < 1n << 64n, 'per-bin amount exceeds u64');
    return { id, share, x, y, feeX, feeY, rewards };
  });
}
