import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { ProgramInterface } from "../src/core/program-interface.js";
import oreIdl from "../src/protocols/ore/ore.idl.json" with { type: "json" };
import { createMinerFixture } from "./fixtures/miner.js";

const WALLET = address("11111111111111111111111111111111");

describe("ProgramInterface", () => {
  it("encodes and decodes strict one-byte booleans", () => {
    const boolInterface = new ProgramInterface({
      address: WALLET, metadata: { name: "test", version: "1", spec: "0.1.0" },
      instructions: [{ name: "flag", discriminator: [8], accounts: [], args: [{ name: "value", type: "bool" }] }],
      accounts: [{ name: "Flag", discriminator: [9] }],
      types: [{ name: "Flag", serialization: "borsh", type: { kind: "struct", fields: [{ name: "value", type: "bool" }] } }],
    });
    for (const value of [false, true]) {
      expect(boolInterface.encodeInstruction("flag", { value })).toEqual(Uint8Array.of(8, Number(value)));
      expect(boolInterface.decodeAccount("Flag", Uint8Array.of(9, Number(value)))).toEqual({ value });
    }
    for (const value of [0, 1, 1n, "true", null]) expect(() => boolInterface.encodeInstruction("flag", { value })).toThrow(/boolean/);
    expect(() => boolInterface.decodeAccount("Flag", Uint8Array.of(9, 2))).toThrow(/bool/);
  });
  const programInterface = new ProgramInterface(oreIdl);

  it("encodes ClaimSOL against the independent Rust/Steel byte oracle", () => {
    expect(programInterface.encodeInstruction("claimSol", {})).toEqual(Uint8Array.of(3));
  });

  it("decodes the full Miner fixture and rewards_sol through the schema", () => {
    const decoded = programInterface.decodeAccount("Miner", createMinerFixture(WALLET));
    expect(programInterface.getAccountSize("Miner")).toBe(752);
    expect(decoded.authority).toBe(WALLET);
    expect(decoded.autoReturn).toBe(1n);
    expect(decoded.roundId).toBe(91n);
    expect(decoded.rewardsSol).toBe(184_200_000n);
    expect((decoded.deployed as bigint[])[2]).toBe(7_000_000n);
    expect(((decoded.rewardsFactor as { bits: number[] }).bits)[0]).toBe(0x2a);
    expect(decoded.lastClaimOreAt).toBe(-14n);
    expect(decoded.lifetimeRewardsSol).toBe(18n);
  });

  it.each([
    ["truncated", createMinerFixture(WALLET).subarray(0, 751)],
    ["oversized", new Uint8Array(753)],
    ["wrong discriminator", (() => { const data = createMinerFixture(WALLET); data[0] = 102; return data; })()],
    ["nonzero Steel header padding", (() => { const data = createMinerFixture(WALLET); data[1] = 1; return data; })()],
  ])("rejects %s Miner data", (_name, data) => {
    expect(() => programInterface.decodeAccount("Miner", data)).toThrow(/length|discriminator/);
  });

  it("rejects unsupported interface specifications", () => {
    const unsupported = structuredClone(oreIdl) as unknown as { metadata: { spec: string } };
    unsupported.metadata.spec = "9.9.9";
    expect(() => new ProgramInterface(unsupported)).toThrow(/0\.1\.0/);
  });
});
