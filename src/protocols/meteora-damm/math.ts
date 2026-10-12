import { COMPOUNDING, NUM_REWARDS, u256, type InnerVesting, type PoolState, type PositionState } from './codec';

// Port of the pinned program's arithmetic; every operation rounds down like the on-chain helpers.
const U64_MAX = (1n << 64n) - 1n;
const LIQUIDITY_SCALE = 128n, TOTAL_REWARD_SCALE = 192n;

export const totalLiquidity = (s: PositionState) => s.unlocked_liquidity + s.vested_liquidity + s.permanent_locked_liquidity;

/** remove_liquidity amounts before transfer fees (`get_amounts_for_modify_liquidity`, Rounding::Down). */
export function removalAmounts(pool: PoolState, liquidity: bigint): { a: bigint; b: bigint } {
  if (liquidity === 0n) return { a: 0n, b: 0n };
  if (pool.collect_fee_mode === COMPOUNDING) {
    if (pool.liquidity === 0n) return { a: 0n, b: 0n };
    return { a: liquidity * pool.token_a_amount / pool.liquidity, b: liquidity * pool.token_b_amount / pool.liquidity };
  }
  const { sqrt_min_price: min, sqrt_max_price: max, sqrt_price: price } = pool;
  if (price === 0n || max === 0n || price > max || price < min) return { a: 0n, b: 0n };
  return { a: liquidity * (max - price) / (price * max), b: liquidity * (price - min) >> 128n };
}

/** Position::update_fee against the pool's current fee per liquidity. */
export function pendingFees(pool: PoolState, s: PositionState): { a: bigint; b: bigint } {
  const liquidity = totalLiquidity(s);
  const accrued = (stored: number[], checkpoint: number[]) => {
    const delta = u256(stored) - u256(checkpoint);
    return liquidity > 0n && delta > 0n ? liquidity * delta >> LIQUIDITY_SCALE : 0n;
  };
  return { a: s.fee_a_pending + accrued(pool.fee_a_per_liquidity, s.fee_a_per_token_checkpoint),
    b: s.fee_b_pending + accrued(pool.fee_b_per_liquidity, s.fee_b_per_token_checkpoint) };
}

/** Pool::update_rewards at `now` (seconds), then Position::update_position_reward, per slot. */
export function pendingRewards(pool: PoolState, s: PositionState, now: bigint): bigint[] {
  const liquidity = totalLiquidity(s), anyInitialized = pool.reward_infos.some(r => r.initialized !== 0);
  return Array.from({ length: NUM_REWARDS }, (_, i) => {
    const reward = pool.reward_infos[i]!, user = s.reward_infos[i]!;
    if (!anyInitialized || reward.initialized === 0) return user.reward_pendings;
    let stored = u256(reward.reward_per_token_stored);
    const end = now < reward.reward_duration_end ? now : reward.reward_duration_end;
    if (pool.liquidity > 0n && end > reward.last_update_time) stored += ((end - reward.last_update_time) * reward.reward_rate << LIQUIDITY_SCALE) / pool.liquidity;
    const delta = stored - u256(user.reward_per_token_checkpoint);
    return user.reward_pendings + (delta > 0n ? liquidity * delta >> TOTAL_REWARD_SCALE : 0n);
  });
}

/** InnerVesting::get_max_unlocked_liquidity. */
function maxUnlocked(v: InnerVesting, point: bigint): bigint {
  if (point < v.cliff_point) return 0n;
  if (v.period_frequency === 0n || v.liquidity_per_period === 0n) return v.cliff_unlock_liquidity;
  let period = (point - v.cliff_point) / v.period_frequency;
  if (period > BigInt(v.number_of_period)) period = BigInt(v.number_of_period);
  return v.cliff_unlock_liquidity + period * v.liquidity_per_period;
}
/** Liquidity a refresh releases at `point` (get_new_release_liquidity). */
export function vestingRelease(v: InnerVesting, point: bigint): bigint {
  const released = maxUnlocked(v, point) - v.total_released_liquidity;
  return released > 0n ? released : 0n;
}
/** Liquidity still vesting after every release (calculate_remaining_vested_liquidity). */
export const vestingRemaining = (v: InnerVesting) => vestingRelease(v, U64_MAX);
export const vestingDone = (v: InnerVesting) =>
  v.total_released_liquidity === v.cliff_unlock_liquidity + v.liquidity_per_period * BigInt(v.number_of_period);
/** The first point at which more liquidity unlocks, or null when nothing more will. */
export function nextUnlock(v: InnerVesting, point: bigint): bigint | null {
  if (vestingRemaining(v) === 0n) return null;
  if (point < v.cliff_point) return v.cliff_point;
  if (v.period_frequency === 0n || v.liquidity_per_period === 0n) return null;
  const period = (point - v.cliff_point) / v.period_frequency + 1n;
  return period > BigInt(v.number_of_period) ? null : v.cliff_point + period * v.period_frequency;
}
