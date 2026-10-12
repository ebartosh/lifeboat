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

/** Display only: groups the whole part of a decimal string, e.g. 1284.5 -> 1,284.5. */
export function groupDigits(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function abbreviateAddress(value: Address): string {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const knownSymbols = new Map<string, string>([['So11111111111111111111111111111111111111112', 'WSOL'],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'], ['orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', 'ORCA']]);
const reservedSymbols = new Set(['SOL', ...knownSymbols.values()]);
/** Known mints keep fixed labels. Other mints use their on-chain metadata symbol, never off-chain metadata.
 * Without one, or when it imitates a known token, the abbreviated mint address is shown. */
export function tokenSymbol(mint: Address, onChain?: string | null): string {
  const known = knownSymbols.get(mint);
  if (known) return known;
  return onChain && !reservedSymbols.has(onChain.toUpperCase()) ? onChain : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
