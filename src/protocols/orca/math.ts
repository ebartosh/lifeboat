import { check, NUM_REWARDS, rewardInitialized, TICK_ARRAY_SIZE, type PositionState, type Tick, type WhirlpoolState } from './codec';

// Port of the pinned program's math (programs/whirlpool/src/math, manager); see docs/orca-interface-provenance.md.
const U64 = (1n << 64n) - 1n, U128 = 1n << 128n;
const wrap = (value: bigint) => ((value % U128) + U128) % U128;
const shift96 = (a: bigint, b: bigint) => (a * b) >> 96n;
const POSITIVE = [79236085330515764027303304731n, 79244008939048815603706035061n, 79259858533276714757314932305n,
  79291567232598584799939703904n, 79355022692464371645785046466n, 79482085999252804386437311141n,
  79736823300114093921829183326n, 80248749790819932309965073892n, 81282483887344747381513967011n,
  83390072131320151908154831281n, 87770609709833776024991924138n, 97234110755111693312479820773n,
  119332217159966728226237229890n, 179736315981702064433883588727n, 407748233172238350107850275304n,
  2098478828474011932436660412517n, 55581415166113811149459800483533n, 38992368544603139932233054999993551n];
const NEGATIVE = [18444899583751176498n, 18443055278223354162n, 18439367220385604838n, 18431993317065449817n,
  18417254355718160513n, 18387811781193591352n, 18329067761203520168n, 18212142134806087854n, 17980523815641551639n,
  17526086738831147013n, 16651378430235024244n, 15030750278693429944n, 12247334978882834399n, 8131365268884726200n,
  3584323654723342297n, 696457651847595233n, 26294789957452057n, 37481735321082n];
/** tick_math::sqrt_price_from_tick_index (Q64.64). */
export function sqrtPriceFromTickIndex(tick: number): bigint {
  check(Number.isInteger(tick) && tick >= -443636 && tick <= 443636, 'tick index out of bounds');
  if (tick >= 0) {
    let ratio = tick & 1 ? 79232123823359799118286999567n : 79228162514264337593543950336n;
    POSITIVE.forEach((factor, i) => { if (tick & (2 << i)) ratio = shift96(ratio, factor); });
    return ratio >> 32n;
  }
  const abs = -tick;
  let ratio = abs & 1 ? 18445821805675392311n : 18446744073709551616n;
  NEGATIVE.forEach((factor, i) => { if (abs & (2 << i)) ratio = (ratio * factor) >> 64n; });
  return ratio;
}
/** token_math::get_amount_delta_a without rounding up (liquidity removal). */
export function amountDeltaA(price0: bigint, price1: bigint, liquidity: bigint): bigint {
  const [lower, upper] = price0 < price1 ? [price0, price1] : [price1, price0];
  check(lower > 0n, 'invalid sqrt price');
  const result = ((liquidity * (upper - lower)) << 64n) / (upper * lower);
  check(result <= U64, 'token amount exceeds u64');
  return result;
}
/** token_math::get_amount_delta_b without rounding up (liquidity removal). */
export function amountDeltaB(price0: bigint, price1: bigint, liquidity: bigint): bigint {
  const [lower, upper] = price0 < price1 ? [price0, price1] : [price1, price0];
  const product = liquidity * (upper - lower);
  check(product < U128, 'token amount multiplication overflow');
  return product >> 64n;
}
/** liquidity_manager::calculate_liquidity_token_deltas for removing all of `liquidity`. */
export function liquidityAmounts(pool: Pick<WhirlpoolState, 'tickCurrentIndex' | 'sqrtPrice'>, position: Pick<PositionState, 'tickLowerIndex' | 'tickUpperIndex' | 'liquidity'>) {
  if (position.liquidity === 0n) return { a: 0n, b: 0n };
  const lower = sqrtPriceFromTickIndex(position.tickLowerIndex), upper = sqrtPriceFromTickIndex(position.tickUpperIndex);
  if (pool.tickCurrentIndex < position.tickLowerIndex) return { a: amountDeltaA(lower, upper, position.liquidity), b: 0n };
  if (pool.tickCurrentIndex < position.tickUpperIndex) return { a: amountDeltaA(pool.sqrtPrice, upper, position.liquidity),
    b: amountDeltaB(lower, pool.sqrtPrice, position.liquidity) };
  return { a: 0n, b: amountDeltaB(lower, upper, position.liquidity) };
}
/** Floor division start index of the fixed 88-tick array containing `tick`. */
export function tickArrayStartIndex(tick: number, tickSpacing: number) {
  check(Number.isInteger(tickSpacing) && tickSpacing > 0, 'invalid tick spacing');
  const width = TICK_ARRAY_SIZE * tickSpacing;
  return Math.floor(tick / width) * width;
}
/** TickArray::get_tick offset; usable ticks are multiples of the spacing. */
export function tickOffset(tick: number, start: number, tickSpacing: number) {
  const offset = Math.floor((tick - start) / tickSpacing);
  check(tick % tickSpacing === 0 && offset >= 0 && offset < TICK_ARRAY_SIZE, 'tick is not in its tick array');
  return offset;
}
/** bit_math::checked_mul_shift_right: overflow yields None, which the position update treats as zero. */
function mulShiftRight(liquidity: bigint, growth: bigint): bigint {
  const product = liquidity * growth;
  return product >= U128 ? 0n : product >> 64n;
}
/** whirlpool_manager::next_whirlpool_reward_infos at `timestamp`. */
export function nextRewardGrowths(pool: WhirlpoolState, timestamp: bigint): bigint[] {
  const last = pool.rewardLastUpdatedTimestamp;
  check(timestamp >= last, 'clock is behind the pool reward timestamp');
  return pool.rewardInfos.map(reward => {
    if (pool.liquidity === 0n || timestamp === last || !rewardInitialized(reward)) return reward.growthGlobalX64;
    // bit_math::checked_mul_div: an overflowing product or quotient halts this reward's growth.
    const product = (timestamp - last) * reward.emissionsPerSecondX64, delta = product / pool.liquidity;
    return wrap(reward.growthGlobalX64 + (product < U128 && delta < U128 ? delta : 0n));
  });
}
function growthInside(current: number, lower: Tick, lowerIndex: number, upper: Tick, upperIndex: number, global: bigint,
  outside: (tick: Tick) => bigint) {
  const below = !lower.initialized ? global : current < lowerIndex ? wrap(global - outside(lower)) : outside(lower);
  const above = !upper.initialized ? 0n : current < upperIndex ? outside(upper) : wrap(global - outside(upper));
  return wrap(global - below - above);
}
export type OwedEstimate = { feeA: bigint; feeB: bigint; rewards: bigint[] };
/**
 * Fees and rewards owed after the position's next update, as decrease_liquidity computes them
 * (liquidity_manager::_calculate_modify_liquidity and position_manager). Wrapping u64 additions
 * follow the program; a fee or reward u64 overflow is outside any realistic position.
 */
export function owedAfterUpdate(pool: WhirlpoolState, position: PositionState, lower: Tick, upper: Tick, timestamp: bigint): OwedEstimate {
  if (position.liquidity === 0n) return { feeA: position.feeOwedA, feeB: position.feeOwedB, rewards: position.rewardInfos.map(r => r.amountOwed) };
  const current = pool.tickCurrentIndex, li = position.tickLowerIndex, ui = position.tickUpperIndex;
  const insideA = growthInside(current, lower, li, upper, ui, pool.feeGrowthGlobalA, t => t.feeGrowthOutsideA);
  const insideB = growthInside(current, lower, li, upper, ui, pool.feeGrowthGlobalB, t => t.feeGrowthOutsideB);
  const growths = nextRewardGrowths(pool, timestamp);
  const add = (owed: bigint, delta: bigint) => (owed + delta) & U64;
  return {
    feeA: add(position.feeOwedA, mulShiftRight(position.liquidity, wrap(insideA - position.feeGrowthCheckpointA))),
    feeB: add(position.feeOwedB, mulShiftRight(position.liquidity, wrap(insideB - position.feeGrowthCheckpointB))),
    rewards: Array.from({ length: NUM_REWARDS }, (_, i) => {
      const owed = position.rewardInfos[i]!;
      // tick_manager::next_reward_growths_inside leaves uninitialized rewards at zero growth.
      const inside = rewardInitialized(pool.rewardInfos[i]!)
        ? growthInside(current, lower, li, upper, ui, growths[i]!, t => t.rewardGrowthsOutside[i]!) : 0n;
      return add(owed.amountOwed, mulShiftRight(position.liquidity, wrap(inside - owed.growthInsideCheckpoint)));
    }),
  };
}
