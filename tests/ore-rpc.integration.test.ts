import { describe, expect, it } from "vitest";

import { SolanaRpcClient } from "../src/core/rpc.js";
import { createOreAdapter } from "../src/protocols/ore-bundle.js";

const integration = process.env.SOLANA_RPC_URL ? describe : describe.skip;

integration("ORE RPC integration", () => {
  it("finds the executable ORE program and owned board account", async () => {
    const rpc = new SolanaRpcClient(process.env.SOLANA_RPC_URL!);
    const ore = createOreAdapter();
    const program = await rpc.getAccount(ore.programAddress);
    expect(program).not.toBeNull();
    expect(program?.executable).toBe(true);

    const board = await rpc.getAccount(await ore.getBoardAddress());
    expect(board).not.toBeNull();
    expect(board?.owner).toBe(ore.programAddress);
    expect(board?.data[0]).toBe(105);
  });
});
