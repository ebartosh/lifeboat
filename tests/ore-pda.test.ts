import { AccountRole, address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { createOreAdapter } from "../src/protocols/ore-bundle.js";

const WALLET = address("11111111111111111111111111111111");

describe("ORE PDA and instruction resolution", () => {
  const ore = createOreAdapter();

  it("derives the Miner PDA matching the pinned Rust helper reference", async () => {
    expect(await ore.getMinerAddress(WALLET)).toBe("DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2");
  });

  it("derives the verified board PDA", async () => {
    expect(await ore.getBoardAddress()).toBe("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
  });

  it("builds ClaimSOL with source-verified account ordering and roles", async () => {
    const instruction = await ore.buildClaimSolInstruction(WALLET);
    expect(instruction.programAddress).toBe(ore.programAddress);
    expect(instruction.data).toEqual(Uint8Array.of(3));
    expect(instruction.accounts).toEqual([
      { address: WALLET, role: AccountRole.WRITABLE_SIGNER },
      { address: "BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi", role: AccountRole.WRITABLE },
      { address: "DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2", role: AccountRole.WRITABLE },
      { address: "11111111111111111111111111111111", role: AccountRole.READONLY },
      { address: ore.programAddress, role: AccountRole.READONLY },
    ]);
  });
});
