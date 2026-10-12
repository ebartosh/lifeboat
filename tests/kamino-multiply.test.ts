import { describe, expect, it } from "vitest";
import { kaminoEntries } from "../src/mobile/kamino-presentation";
import { kaminoOperationHint } from "../src/operations/kamino";
import { prepareRepay, prepareWithdraw } from "../src/protocols/kamino/operations";
import { adapter, POSITION, u64 } from "./fixtures/kamino";
import { inventoryFixture } from "./fixtures/kamino-inventory";

// A typical Multiply loop: JITOSOL collateral against WSOL debt in SOL eMode (group 2).
async function multiply(tag = 1n, elevationGroup = 2) {
  const f = await inventoryFixture(adapter.token("JITOSOL"), 100n, { debtToken: adapter.token("WSOL"), elevationGroup });
  u64(f.obligation, 8, tag);
  return { ...f, options: { adapter, rpc: f.rpc, wallet: f.wallet.address, position: POSITION } };
}

describe("Kamino Multiply (tag 1) positions", () => {
  it("plans repayment and withdrawal like any other position", async () => {
    const f = await multiply();
    expect((await adapter.loadPosition(f.rpc, f.wallet.address, POSITION)).state.tag).toBe(1n);
    expect(await prepareRepay({ ...f.options, token: "WSOL", amount: "all" })).not.toBeNull();
    expect(await prepareRepay({ ...f.options, token: "SOL", amount: "all" })).not.toBeNull();
    expect(await prepareWithdraw({ ...f.options, token: "JITOSOL", amount: "all" })).not.toBeNull();
  });

  it("explains the Multiply and eMode limits on every entry of the position", async () => {
    const f = await multiply();
    const entries = kaminoEntries(await adapter.getStatus(f.rpc, f.wallet.address));
    expect(entries.map(entry => entry.title)).toEqual(["Debt WSOL", "Collateral JITOSOL"]);
    for (const entry of entries) {
      expect(entry.context).toMatch(/^Kamino Multiply position\. .*does not swap or flash-loan/);
      expect(entry.context).toMatch(/Elevation group \(eMode\) 2: Kamino applies its 87% LTV/);
    }
    const vanilla = await multiply(0n, 0);
    expect(kaminoEntries(await adapter.getStatus(vanilla.rpc, vanilla.wallet.address)).every(entry => entry.context === undefined)).toBe(true);
  });

  it.each([2n, 3n])("still rejects tag %s positions", async tag => {
    const f = await multiply(tag);
    await expect(adapter.loadPosition(f.rpc, f.wallet.address, POSITION)).rejects.toThrow(/Multiply \(tag 1\)/);
    expect(kaminoOperationHint(new Error("only vanilla (tag 0) and Multiply (tag 1) positions are supported")))
      .toMatch(/outside the supported Kamino matrix/);
  });

  it("names the eMode new-loans block instead of a matrix restriction", () => {
    expect(kaminoOperationHint(new Error("this position's elevation group (eMode) has new loans disabled; Kamino allows collateral withdrawal only after the debt is repaid")))
      .toBe("This eMode group has new loans disabled. Repay the debt before withdrawing collateral.");
  });
});
