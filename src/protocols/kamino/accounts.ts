import { address, type Address } from "@solana/kit";
import type { ChainAccount } from "../../core/accounts";
import { VerificationError } from "../../core/errors";
import { ProgramInterface } from "../../core/program-interface";
import supportIdl from "./support.idl.json" with { type: "json" };
import type { Reserve } from "./state";

export const ZERO = address("11111111111111111111111111111111");
export const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const FARMS = address("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
export const SCOPE = address("HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ");
export const CLOCK = address("SysvarC1ock11111111111111111111111111111111");
export const SYSVAR = address("Sysvar1111111111111111111111111111111111111");
const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
export const support = new ProgramInterface(supportIdl);

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new VerificationError(`Kamino: ${message}`);
}
export function decode<T>(pi: ProgramInterface, name: string, account: ChainAccount | null | undefined, owner: Address): T {
  check(account && account.owner === owner && !account.executable, `${name} is missing or has invalid owner/type`);
  return pi.decodeAccount(name, account.data) as unknown as T;
}
export function verifyProgram(account: ChainAccount | null | undefined, name: string, upgradeable = true): void {
  check(account?.executable && (!upgradeable || account.owner === LOADER), `${name} program is missing or not executable under the expected loader`);
}
export type ClockState = { slot: bigint; unixTimestamp: bigint };
export type MintState = { mintAuthorityOption: number; mintAuthority: Address; supply: bigint; decimals: number; initialized: number; freezeAuthorityOption: number };
export type TokenState = { mint: Address; owner: Address; amount: bigint; state: number; delegateOption: number; closeAuthorityOption: number; nativeOption: number };
export function mintState(account: ChainAccount | null | undefined, decimals: number): MintState {
  const mint = decode<MintState>(support, "Mint", account, TOKEN);
  check(mint.initialized === 1 && mint.decimals === decimals, "mint decimals or initialization mismatch");
  check([0, 1].includes(mint.mintAuthorityOption) && [0, 1].includes(mint.freezeAuthorityOption), "invalid mint options");
  return mint;
}
export function tokenState(account: ChainAccount | null | undefined, mint: Address, owner: Address): TokenState {
  const token = decode<TokenState>(support, "TokenAccount", account, TOKEN);
  check(token.mint === mint && token.owner === owner && token.state === 1, "token account mint/authority mismatch or frozen/uninitialized account");
  check(token.delegateOption === 0 && token.closeAuthorityOption === 0, "delegated token accounts or alternate close authorities are unsupported");
  check(token.nativeOption === 0 || token.nativeOption === 1, "invalid native token option");
  return token;
}
export type DatedPrice = { price: { value: bigint; exp: bigint }; lastUpdatedSlot: bigint; unixTimestamp: bigint; index: number };
type ScopePrices = { prices: DatedPrice[] };
// KLend utils/prices/scope.rs and utils.rs at metadata.sourceCommit.
export function scopeChainPrice(prices: DatedPrice[], chain: readonly number[], clock: ClockState): { priceSf: bigint; timestamp: bigint } {
  const end = chain.indexOf(65535);
  const indices = end === -1 ? chain : chain.slice(0, end);
  check(chain.length === 4 && indices.length > 0 && !chain.every(i => i === 0)
    && indices.every(i => Number.isInteger(i) && i >= 0 && i < 512)
    && (end === -1 || chain.slice(end).every(i => i === 65535)), "unsupported Scope conversion chain");
  let value = 1n, exp = 0n, timestamp = clock.unixTimestamp;
  for (const index of indices) {
    const entry = prices[index];
    check(entry && entry.price.value > 0n && entry.price.value <= (1n << 64n) - 1n
      && entry.price.exp >= 0n && entry.price.exp <= 18n, "invalid Scope price");
    check(entry.lastUpdatedSlot <= clock.slot && entry.unixTimestamp <= clock.unixTimestamp, "oracle timestamp/slot is in the future");
    if (entry.unixTimestamp < timestamp) timestamp = entry.unixTimestamp;
    let next = entry.price.value, nextExp = entry.price.exp;
    if (exp + nextExp > 36n) {
      if (exp > 18n) { value /= 10n ** (exp - 18n); exp = 18n; }
      if (nextExp > 18n) { next /= 10n ** (nextExp - 18n); nextExp = 18n; }
    }
    value *= next;
    exp += nextExp;
    check(value < (1n << 256n), "Scope chain multiplication overflow");
  }
  const priceSf = value * (1n << 60n) / (10n ** exp);
  check(priceSf > 0n && priceSf < (1n << 128n), "Scope chain price rounds to zero or overflows Fraction");
  return { priceSf, timestamp };
}
export function verifyOracle(account: ChainAccount | null | undefined, reserve: Reserve, clock: ClockState): { ageSeconds: bigint; fresh: boolean } {
  const prices = decode<ScopePrices>(support, "OraclePrices", account, SCOPE);
  const info = reserve.config.tokenInfo;
  let oldest = clock.unixTimestamp;
  let fresh = true;
  for (const [chain, maxAge] of [[info.scopeConfiguration.priceChain, info.maxAgePriceSeconds], [info.scopeConfiguration.twapChain, info.maxAgeTwapSeconds]] as const) {
    const value = scopeChainPrice(prices.prices, chain, clock);
    if (value.timestamp < oldest) oldest = value.timestamp;
    if (clock.unixTimestamp - value.timestamp > maxAge) fresh = false;
  }
  return { ageSeconds: clock.unixTimestamp - oldest, fresh };
}

