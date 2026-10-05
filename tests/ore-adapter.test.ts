import { address, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { createOreAdapter } from "../src/protocols/ore-bundle.js";
import type { AccountReader, ChainAccount } from "../src/protocols/ore/adapter.js";
import { createMinerFixture } from "./fixtures/miner.js";

const WALLET = address("11111111111111111111111111111111");

class MapReader implements AccountReader {
  constructor(readonly accounts: Map<Address, ChainAccount>) {}
  async getAccount(accountAddress: Address): Promise<ChainAccount | null> {
    return this.accounts.get(accountAddress) ?? null;
  }
}

function readerForMiner(options?: { executable?: boolean; owner?: Address; authority?: Address }): MapReader {
  const ore = createOreAdapter();
  const minerAddress = address("DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2");
  return new MapReader(new Map([
    [ore.programAddress, { owner: address("11111111111111111111111111111111"), executable: options?.executable ?? true, data: new Uint8Array() }],
    [minerAddress, {
      owner: options?.owner ?? ore.programAddress,
      executable: false,
      data: createMinerFixture(options?.authority ?? WALLET),
    }],
  ]));
}

describe("ORE adapter", () => {
  const ore = createOreAdapter();

  it("loads the verified semantic manifest", () => {
    expect(ore.manifest).toMatchObject({ protocol: "ore", displayName: "ORE", verified: true });
    expect(ore.claimSolAction).toMatchObject({ id: "claim-sol", instruction: "claimSol", label: "Claim SOL" });
  });

  it("verifies and decodes a Miner position", async () => {
    const status = await ore.getStatus(readerForMiner(), WALLET);
    expect(status.miner?.authority).toBe(WALLET);
    expect(status.miner?.rewardsSol).toBe(184_200_000n);
  });

  it("reports a missing Miner without decoding", async () => {
    const reader = readerForMiner();
    reader.accounts.delete(address("DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2"));
    expect((await ore.getStatus(reader, WALLET)).miner).toBeNull();
  });

  it("rejects a missing or non-executable program", async () => {
    await expect(ore.getStatus(new MapReader(new Map()), WALLET)).rejects.toThrow(/not found/);
    await expect(ore.getStatus(readerForMiner({ executable: false }), WALLET)).rejects.toThrow(/not executable/);
  });

  it("rejects wrong ownership and authority", async () => {
    await expect(
      ore.getStatus(readerForMiner({ owner: address("11111111111111111111111111111111") }), WALLET),
    ).rejects.toThrow(/not owned/);
    await expect(
      ore.getStatus(readerForMiner({ authority: address("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi") }), WALLET),
    ).rejects.toThrow(/authority/);
  });
});
