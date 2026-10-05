import { VerificationError } from "../../core/errors";
import type { ObligationLiquidity, Reserve, WithdrawalCaps } from "./state";

export const SF = 1n << 60n;
export const U64_MAX = (1n << 64n) - 1n;
export const ceilDiv = (a: bigint, b: bigint): bigint => {
  if (a < 0n || b <= 0n) throw new VerificationError("Invalid nonnegative integer ratio");
  return (a + b - 1n) / b;
};
export function parseAmount(value: string, decimals: number): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new VerificationError("Amount must be a positive decimal or all");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new VerificationError(`Amount has more than ${decimals} decimal places`);
  const amount = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= 0n || amount >= U64_MAX) throw new VerificationError("Amount must be positive and below the protocol's all sentinel");
  return amount;
}
export function totalSupplySf(reserve: Reserve): bigint {
  const l = reserve.liquidity;
  const total = l.totalAvailableAmount * SF + l.borrowedAmountSf - l.accumulatedProtocolFeesSf
    - l.accumulatedReferrerFeesSf - l.pendingReferrerFeesSf;
  if (total <= 0n || reserve.collateral.mintTotalSupply === 0n) throw new VerificationError("Reserve has no redeemable collateral supply");
  return total;
}
export function redeemAmount(collateral: bigint, reserve: Reserve): bigint {
  return collateral * totalSupplySf(reserve) / reserve.collateral.mintTotalSupply / SF;
}
export function collateralForAmount(amount: bigint, reserve: Reserve): bigint {
  // Ceil gives the requested underlying amount at the sampled exchange rate.
  return ceilDiv(amount * reserve.collateral.mintTotalSupply * SF, totalSupplySf(reserve));
}
export function debtSf(borrow: ObligationLiquidity, reserve: Reserve): bigint {
  const unpack = (limbs: bigint[]) => limbs.reduce((sum, limb, index) => sum | (limb << BigInt(index * 64)), 0n);
  const old = unpack(borrow.cumulativeBorrowRateBsf.value);
  const current = unpack(reserve.liquidity.cumulativeBorrowRateBsf.value);
  if (old <= 0n || current < old) throw new VerificationError("Invalid cumulative borrow rate");
  // U256 integer ratio; refreshed simulation supplies the authoritative current amount.
  return borrow.borrowedAmountSf * current / old;
}
export function remainingWithdrawalCap(cap: WithdrawalCaps, timestamp: bigint): bigint {
  if (cap.configIntervalLengthSeconds === 0n) return U64_MAX;
  if (cap.configCapacity < 0n) return 0n;
  if (timestamp < cap.lastIntervalStartTimestamp) throw new VerificationError("Withdrawal cap timestamp is in the future");
  const used = timestamp - cap.lastIntervalStartTimestamp >= cap.configIntervalLengthSeconds ? 0n : cap.currentTotal;
  const remaining = cap.configCapacity - used;
  return remaining > 0n ? remaining : 0n;
}

