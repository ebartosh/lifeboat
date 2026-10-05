import type { Address } from "@solana/kit";

export function formatLamports(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

export function formatOre(amount: bigint): string {
  return formatUnits(amount, 11);
}

export function formatUnits(lamports: bigint, decimals: number): string {
  const units = 10n ** BigInt(decimals);
  const sign = lamports < 0n ? "-" : "";
  const absolute = lamports < 0n ? -lamports : lamports;
  const whole = absolute / units;
  const fractional = (absolute % units).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractional.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fractional}`;
}

export function abbreviateAddress(value: Address): string {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
