import { describe, expect, it } from "vitest";
import { adapter, fixture, POSITION, USDC, WSOL, captureAccounts, pubkey, u64 } from "./fixtures/kamino";
import { ZERO, SCOPE, support } from "../src/protocols/kamino/accounts";
import { SF, U64_MAX, ceilDiv, collateralForAmount, parseAmount, redeemAmount, remainingWithdrawalCap } from "../src/protocols/kamino/math";
import type { Reserve } from "../src/protocols/kamino/state";
import { TOKEN_2022_PROGRAM } from '../src/core/tokens';

describe("pinned KLend account interface", () => {
  it("decodes independently captured market/reserve/Scope/Farms accounts and exact sizes", () => {
    const accounts = captureAccounts();
    expect(adapter.programInterface.getAccountSize("Obligation")).toBe(3344);
    expect(adapter.programInterface.getAccountFieldOffset("Obligation", "owner")).toBe(64);
    expect(adapter.programInterface.getAccountSize("Reserve")).toBe(8624);
    expect(adapter.programInterface.getAccountSize("LendingMarket")).toBe(4664);
    const r = adapter.programInterface.decodeAccount("Reserve", accounts.get(USDC)!.data);
    expect(r.lendingMarket).toBe(adapter.marketAddress);
    expect(r.liquidity).toMatchObject({ mintDecimals: 6n, mintPubkey: adapter.metadata.tokens[0]!.mint });
    expect(support.getAccountSize("FarmState")).toBe(8336);
    expect(support.getAccountSize("UserState")).toBe(920);
    expect(support.getAccountSize("OraclePrices")).toBe(28712);
  });
  it.each([USDC, WSOL])("loads a supported position with real linked accounts for %s", async reserve => {
    const f = await fixture({ reserve });
    const p = await adapter.loadPosition(f.rpc, f.wallet.address, POSITION);
    expect(p.reserves.get(reserve)?.oracleFresh).toBe(true);
    expect(p.state.deposits[0]?.depositedAmount).toBe(1_000_000_000n);
    const status = await adapter.getStatus(f.rpc, f.wallet.address);
    expect(status[0]?.reason).toBeUndefined();
    expect(f.rpc.filters).toEqual([{ offset: 64, bytes: f.wallet.address }]);
  });
  it.each([
    ["wrong account owner", (f: Awaited<ReturnType<typeof fixture>>) => { f.rpc.accounts.get(POSITION)!.owner = ZERO; }, /owner/],
    ["wrong wallet", (f: Awaited<ReturnType<typeof fixture>>) => { pubkey(f.obligation, 64, ZERO); }, /owner/],
    ["wrong market", (f: Awaited<ReturnType<typeof fixture>>) => { pubkey(f.obligation, 32, ZERO); }, /market/],
    ["unsupported tag", (f: Awaited<ReturnType<typeof fixture>>) => { u64(f.obligation, 8, 2n); }, /vanilla/],
    ["elevation group", (f: Awaited<ReturnType<typeof fixture>>) => { f.obligation[2285] = 1; }, /elevation/],
    ["wrong reserve link", (f: Awaited<ReturnType<typeof fixture>>) => { pubkey(f.rpc.accounts.get(USDC)!.data, 32, ZERO); }, /market/],
    ["wrong mint", (f: Awaited<ReturnType<typeof fixture>>) => { pubkey(f.rpc.accounts.get(USDC)!.data, 128, ZERO); }, /mint/],
    ["Token-2022 mint", (f: Awaited<ReturnType<typeof fixture>>) => { f.rpc.accounts.get(f.mint)!.owner = TOKEN_2022_PROGRAM; }, /owner/],
    ["Token-2022 ATA", (f: Awaited<ReturnType<typeof fixture>>) => { f.rpc.accounts.get(f.ata)!.owner = TOKEN_2022_PROGRAM; }, /owner/],
    ["wrong oracle owner", (f: Awaited<ReturnType<typeof fixture>>) => {
      for (const a of f.rpc.accounts.values()) if (a?.owner === SCOPE && !a.executable) a.owner = ZERO;
    }, /owner/],
    ["frozen ATA", (f: Awaited<ReturnType<typeof fixture>>) => { f.rpc.accounts.get(f.ata)!.data[108] = 2; }, /frozen/],
    ["wrong farm delegatee", (f: Awaited<ReturnType<typeof fixture>>) => { pubkey(f.rpc.accounts.get(f.farmUser)!.data, 480, ZERO); }, /farm user/],
  ] as const)("rejects %s before operation construction", async (_name, mutate, error) => {
    const f = await fixture(); mutate(f);
    await expect(adapter.loadPosition(f.rpc, f.wallet.address, POSITION)).rejects.toThrow(error);
    expect(f.rpc.simulations).toHaveLength(0);
    expect(f.rpc.sent).toHaveLength(0);
  });
  it("reports unsupported positions without hiding other entries", async () => {
    const f = await fixture(); f.obligation[2285] = 1;
    expect((await adapter.getStatus(f.rpc, f.wallet.address))[0]?.reason).toMatch(/elevation/);
  });
  it("rejects truncated data, unknown discriminators and integer argument overflow", async () => {
    const f = await fixture();
    expect(() => adapter.programInterface.decodeAccount("Obligation", f.obligation.slice(1))).toThrow(/length/);
    f.obligation[0] = 0;
    expect(() => adapter.programInterface.decodeAccount("Obligation", f.obligation)).toThrow(/discriminator/);
    for (const value of [-1n, 1n << 64n]) expect(() => adapter.programInterface.encodeInstruction("repayObligationLiquidityV2", { liquidityAmount: value })).toThrow(/range/);
  });
});
describe("integer amounts and rounding", () => {
  it("matches withdrawal-cap reset, disabled and negative-accumulator boundaries", () => {
    const cap = { configCapacity: 100n, currentTotal: -20n, lastIntervalStartTimestamp: 1000n, configIntervalLengthSeconds: 60n };
    expect(remainingWithdrawalCap(cap, 1059n)).toBe(120n);
    expect(remainingWithdrawalCap(cap, 1060n)).toBe(100n);
    expect(remainingWithdrawalCap({ ...cap, configCapacity: -1n }, 1060n)).toBe(0n);
    expect(remainingWithdrawalCap({ ...cap, currentTotal: 101n }, 1059n)).toBe(0n);
    expect(remainingWithdrawalCap({ ...cap, configIntervalLengthSeconds: 0n }, 1059n)).toBe(U64_MAX);
    expect(() => remainingWithdrawalCap(cap, 999n)).toThrow(/future/);
  });
  it("parses token decimals without floats and rejects ambiguous/overflow amounts", () => {
    expect(parseAmount("1234567890.123456", 6)).toBe(1234567890123456n);
    expect(parseAmount("0.000000001", 9)).toBe(1n);
    for (const amount of ["0", "-1", "1e2", "+1", "01", "1.0000001", "NaN", "18446744073709551615"])
      expect(() => parseAmount(amount, 6)).toThrow();
    expect(ceilDiv(SF + 1n, SF)).toBe(2n);
  });
  it("ceil collateral conversion followed by floor redemption covers requested base units", () => {
    const r = adapter.programInterface.decodeAccount("Reserve", captureAccounts().get(USDC)!.data) as unknown as Reserve;
    const collateral = collateralForAmount(100_000_001n, r);
    expect(redeemAmount(collateral, r)).toBeGreaterThanOrEqual(100_000_001n);
    expect(redeemAmount(collateral - 1n, r)).toBeLessThan(100_000_001n);
  });
});

