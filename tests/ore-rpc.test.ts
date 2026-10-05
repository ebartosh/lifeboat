import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { address } from "@solana/kit";
import { expect, it } from "vitest";

import { SolanaRpcClient } from "../src/core/rpc.js";
import { createOreAdapter } from "../src/protocols/ore-bundle.js";

const WALLET = address("21EiCDdLHKdPw4acJ1HE7hrNuoiLPcFS1hSBHDp2DDKB");
const MINER = address("FXUhkNhtcySRLNgL3PiDN2dU5MzAjvQaauAdAKhaVs7B");
const PROGRAM = address("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");

it("reads a captured mainnet Miner through HTTP, SolanaRpcClient and the ORE adapter", async () => {
  const responses = new Map<string, string>([
    [MINER, readFileSync(new URL("./fixtures/rpc/ore-miner.json", import.meta.url), "utf8")],
    [PROGRAM, readFileSync(new URL("./fixtures/rpc/ore-program.json", import.meta.url), "utf8")],
  ]);
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const rpcRequest = JSON.parse(body);
    requests.push({ method: request.method, rpc: rpcRequest });
    const captured = responses.get(rpcRequest.params?.[0]);
    if (rpcRequest.method !== "getAccountInfo" || captured === undefined) {
      response.writeHead(400).end("Unexpected RPC request");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    // Echo the request ID without parsing/reserializing captured u64 JSON numbers.
    response.end(captured.replace(/"id"\s*:\s*1\b/, `"id":${JSON.stringify(rpcRequest.id)}`));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const endpoint = server.address();
    if (endpoint === null || typeof endpoint === "string") throw new Error("Missing test server port");
    const rpc = new SolanaRpcClient(`http://127.0.0.1:${endpoint.port}`);

    const account = await rpc.getAccount(MINER);
    expect(account?.owner).toBe(PROGRAM);
    expect(account?.executable).toBe(false);
    expect(account?.data).toBeInstanceOf(Uint8Array);
    expect(account?.data).toHaveLength(752);
    expect(account?.data.subarray(0, 8)).toEqual(Uint8Array.of(103, 0, 0, 0, 0, 0, 0, 0));

    const status = await createOreAdapter().getStatus(rpc, WALLET);
    // Fixed expectations independently read from the captured bytes using the
    // pinned Rust layout; see fixtures/rpc/README.md. No production decoder oracle.
    expect(status).toMatchObject({
      wallet: WALLET,
      minerAddress: MINER,
      miner: {
        address: MINER,
        authority: WALLET,
        rewardsSol: 0n,
        decoded: {
          autoReturn: 1n,
          checkpointId: 419_695n,
          checkpointFee: 10_000n,
          roundId: 419_695n,
          refinedOre: 2_511_967_530n,
          rewardsOre: 4_225_994_188_146n,
          lastClaimOreAt: 1_790_417_858n,
          lastClaimSolAt: 1_783_906_629n,
          lifetimeRewardsOre: 111_528_149_116_759n,
          lifetimeDeployed: 7_671_505_108_870n,
          lifetimeRewardsSol: 6_906_070_676_749n,
          rewardsFactor: { bits: [80, 188, 75, 248, 47, 221, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        },
      },
    });
    expect((status.miner?.decoded.cumulative as bigint[])[0]).toBe(117_203_015n);
    expect(requests).toEqual([MINER, PROGRAM, MINER].map(accountAddress => ({
      method: "POST",
      rpc: {
        jsonrpc: "2.0",
        id: expect.any(String),
        method: "getAccountInfo",
        params: [accountAddress, { commitment: "confirmed", encoding: "base64" }],
      },
    })));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
