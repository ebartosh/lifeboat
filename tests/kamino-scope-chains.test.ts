import { expect, it } from "vitest";
import { scopeChainPrice, verifyOracle, type DatedPrice, decode, support, SYSVAR, CLOCK } from "../src/protocols/kamino/accounts";
import { SF } from "../src/protocols/kamino/math";
import { adapter, u64 } from "./fixtures/kamino";
import { inventoryFixture } from "./fixtures/kamino-inventory";
import type { ClockState } from "../src/protocols/kamino/accounts";

const clock = { slot: 100n, unixTimestamp: 1000n };
const price = (value: bigint, exp: bigint, timestamp = 990n): DatedPrice => ({ price: { value, exp }, lastUpdatedSlot: 99n, unixTimestamp: timestamp, index: 0 });
it("multiplies Scope conversion prices then floors Fraction once, using the oldest component", () => {
  const prices = [price(123n, 2n, 980n), price(250n, 2n)];
  expect(scopeChainPrice(prices, [0, 1, 65535, 65535], clock)).toEqual({ priceSf: 123n * 250n * SF / 10000n, timestamp: 980n });
  expect(scopeChainPrice(prices, [1, 65535, 65535, 65535], clock).priceSf).toBe(5n * SF / 2n);
});
it("applies KLend's exponent reduction to 18 before a product would exceed exponent 36", () => {
  const prices = [price(1000000000000000001n, 18n), price(1000000000000000001n, 18n)];
  expect(scopeChainPrice(prices, [0, 1, 0, 65535], clock).priceSf).toBe(SF + 3n);
  expect(scopeChainPrice(prices, [0, 1, 0, 1], clock).priceSf).toBe(SF + 4n);
});
it.each([[65535,65535,65535,65535], [0,0,0,0], [0,65535,1,65535], [512,65535,65535,65535]])("rejects invalid chain %s", (...chain) => {
  expect(() => scopeChainPrice([price(1n, 0n)], chain, clock)).toThrow(/chain/);
});
it.each([price(0n,0n), price(1n,19n), price(1n,0n,1001n), { ...price(1n,0n), lastUpdatedSlot: 101n }])("rejects invalid second component %#", bad => {
  expect(() => scopeChainPrice([price(1n,0n), bad], [0,1,65535,65535], clock)).toThrow();
});
it("rejects chains rounding to zero or overflowing Fraction", () => {
  expect(() => scopeChainPrice([price(1n,18n)], [0,0,65535,65535], clock)).toThrow(/zero/);
  expect(() => scopeChainPrice([price((1n<<64n)-1n,0n)], [0,0,65535,65535], clock)).toThrow(/overflows/);
});
it("requires freshness of every conversion component for spot and TWAP", async () => {
  const f = await inventoryFixture(adapter.token("dSOL"));
  const r = f.reserveState, feed = f.rpc.accounts.get(r.config.tokenInfo.scopeConfiguration.priceFeed)!;
  const c = decode<ClockState>(support, "Clock", f.rpc.accounts.get(CLOCK), SYSVAR);
  expect(verifyOracle(feed, r, c).fresh).toBe(true);
  const conversion = r.config.tokenInfo.scopeConfiguration.priceChain[0]!;
  u64(feed.data, 40 + conversion * 56 + 24, c.unixTimestamp - r.config.tokenInfo.maxAgePriceSeconds - 1n);
  expect(verifyOracle(feed, r, c).fresh).toBe(false);
});

