import { AccountRole } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { prepareRepay, prepareWithdraw } from "../src/protocols/kamino/operations";
import type { LendingMarket } from "../src/protocols/kamino/state";
import { SF } from "../src/protocols/kamino/math";
import { adapter, POSITION, u128 } from "./fixtures/kamino";
import { inventoryFixture } from "./fixtures/kamino-inventory";

// Recorded main market: group 2 is SOL eMode (WSOL debt, 87% LTV), group 1 has USDC debt.
const SOL_EMODE = 2;
const WSOL = adapter.token("WSOL");
const EMODE_ONLY = ["adraSOL", "picoSOL", "nxSOL", "strongSOL", "hubSOL", "cgntSOL", "cdcSOL", "bnSOL", "laineSOL", "bonkSOL", "lanternSOL"];
const field = (name: string) => adapter.programInterface.getAccountFieldOffset("Obligation", name);

async function position(collateral: string, elevationGroup: number, debtToken = WSOL) {
  const f = await inventoryFixture(adapter.token(collateral), 100n, { debtToken, elevationGroup });
  const options = { adapter, rpc: f.rpc, wallet: f.wallet.address, position: POSITION };
  return { ...f, options };
}

describe("Kamino elevation group (eMode) positions", () => {
  it("uses the group's LTV instead of the reserve's when sizing a withdrawal", async () => {
    const sized = async (elevationGroup: number) => {
      const f = await position("JITOSOL", elevationGroup);
      // 100 SF of headroom: 500 allowed borrow value against 400 adjusted debt.
      u128(f.obligation, field("allowedBorrowValueSf"), 500n * SF);
      u128(f.obligation, field("borrowFactorAdjustedDebtValueSf"), 400n * SF);
      return (await prepareWithdraw({ ...f.options, token: "JITOSOL", amount: "all" }))!.collateralAmount;
    };
    // floor(100 / 0.87) of 1000 collateral worth 1000, versus the reserve's 63% LTV.
    expect(await sized(SOL_EMODE)).toBe(114n);
    expect(await sized(0)).toBe(158n);
  });

  it("reviews withdrawal with the refreshed position's own risk values", async () => {
    const f = await position("JITOSOL", SOL_EMODE);
    u128(f.obligation, field("depositedValueSf"), 1000n * SF);
    u128(f.obligation, field("borrowFactorAdjustedDebtValueSf"), 400n * SF);
    u128(f.obligation, field("allowedBorrowValueSf"), 870n * SF);
    u128(f.obligation, field("unhealthyBorrowValueSf"), 910n * SF);
    const plan = await prepareWithdraw({ ...f.options, token: "JITOSOL", amount: "all" });
    expect(plan!.risk).toEqual({ ltvPermille: 400n, maxLtvPermille: 870n, liquidationLtvPermille: 910n, healthCenti: 227n });
  });

  it.each(EMODE_ONLY)("withdraws eMode-only %s collateral inside its group and rejects it outside", async symbol => {
    const inside = await position(symbol, SOL_EMODE);
    const plan = await prepareWithdraw({ ...inside.options, token: symbol, amount: "0.000000001" });
    expect(plan?.collateralAmount).toBeGreaterThan(0n);
    const outside = await position(symbol, 0);
    await expect(adapter.loadPosition(outside.rpc, outside.wallet.address, POSITION))
      .rejects.toThrow(/only inside its elevation group/);
  });

  it("blocks withdrawal with debt when the group has new loans disabled", async () => {
    const f = await position("JITOSOL", SOL_EMODE);
    const market = f.rpc.accounts.get(adapter.marketAddress)!;
    // ElevationGroup is 72 bytes; allowNewLoans follows u16 bonus, id, ltv and threshold.
    market.data[adapter.programInterface.getAccountFieldOffset("LendingMarket", "elevationGroups") + 72 * (SOL_EMODE - 1) + 5] = 0;
    const decoded = adapter.programInterface.decodeAccount("LendingMarket", market.data) as unknown as LendingMarket;
    expect(decoded.elevationGroups[SOL_EMODE - 1]).toMatchObject({ id: SOL_EMODE, allowNewLoans: 0 });
    await expect(prepareWithdraw({ ...f.options, token: "JITOSOL", amount: "all" })).rejects.toThrow(/new loans disabled/);
  });

  it("repays eMode debt with every collateral reserve as a trailing writable account", async () => {
    const repayAccounts = async (collateral: string, elevationGroup: number) => {
      const f = await position(collateral, elevationGroup);
      const plan = (await prepareRepay({ ...f.options, token: "WSOL", amount: "all" }))!;
      return { accounts: plan.instructions.at(-1)!.accounts!, reserve: f.reserveKey };
    };
    const vanilla = await repayAccounts("JITOSOL", 0);
    const emode = await repayAccounts("JITOSOL", SOL_EMODE);
    expect(emode.accounts).toHaveLength(vanilla.accounts.length + 1);
    expect(emode.accounts.at(-1)).toEqual({ address: emode.reserve, role: AccountRole.WRITABLE });
    // eMode-only collateral is a refresh dependency for repayment, not a transfer target.
    const restricted = await repayAccounts("hubSOL", SOL_EMODE);
    expect(restricted.accounts.at(-1)).toEqual({ address: restricted.reserve, role: AccountRole.WRITABLE });
  });

  it.each([
    ["debt outside the group's debt reserve", "JITOSOL", 1, /debt reserve/],
    ["collateral outside the group", "ETH", SOL_EMODE, /outside its elevation group/],
    ["a group the market does not configure", "JITOSOL", 30, /elevation group \(eMode\) configuration/],
  ] as const)("rejects %s", async (_name, collateral, group, error) => {
    const f = await position(collateral, group);
    await expect(adapter.loadPosition(f.rpc, f.wallet.address, POSITION)).rejects.toThrow(error);
    expect(f.rpc.simulations).toHaveLength(0);
  });
});
