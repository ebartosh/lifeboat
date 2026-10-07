import { testWalletSigning } from './fixtures/signer';
import { AccountRole, address, blockhash, getAddressEncoder, getProgramDerivedAddress, getSignatureFromTransaction,
  type Address, type Transaction } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { claimOre, readOreRewards } from "../src/operations/ore.js";
import { formatOre } from "../src/core/format.js";
import { estimateOreClaim, type ChainAccount } from "../src/protocols/ore/adapter.js";
import { createOreAdapter } from "../src/protocols/ore-bundle.js";
import { createMinerFixture } from "./fixtures/miner.js";
import { createTreasuryFixture } from "./fixtures/treasury.js";
import { createTestSigner } from "./fixtures/signer.js";

const ore = createOreAdapter();
const system = address("11111111111111111111111111111111");
const token = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ataProgram = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const mint = address("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp");
const treasury = address("45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG");

async function fixture(rewards: bigint | null = 100n, refined = 12n) {
  const wallet = await createTestSigner();
  const accounts = new Map<Address, ChainAccount>([
    [ore.programAddress, { owner: system, executable: true, data: new Uint8Array() }],
    [treasury, { owner: ore.programAddress, executable: false, data: createTreasuryFixture() }],
  ]);
  if (rewards !== null) {
    const data = createMinerFixture(wallet.address);
    data.fill(0, 672, 688);
    const view = new DataView(data.buffer);
    view.setBigUint64(696, refined, true);
    view.setBigUint64(704, rewards, true);
    accounts.set(await ore.getMinerAddress(wallet.address), { owner: ore.programAddress, executable: false, data });
  }
  const rpc = {
    getAccount: vi.fn(async (key: Address) => accounts.get(key) ?? null),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash("11111111111111111111111111111111"), lastValidBlockHeight: 100n })),
    simulateTransaction: vi.fn(async (_tx: Transaction): Promise<{ error: unknown; logs: string[] }> => ({ error: null, logs: [] })),
    sendTransaction: vi.fn(async (tx: Transaction) => getSignatureFromTransaction(tx)),
    getSignatureStatus: vi.fn(async () => ({ confirmationStatus: "confirmed" as const, error: null })),
    getBlockHeight: vi.fn(async () => 1n),
  };

  return { wallet, accounts, rpc, options: { adapter: ore, wallet: wallet.address, rpc, signWithWallet: testWalletSigning(wallet) } };
}

describe("ClaimORE interface", () => {
  it("matches the pinned Rust payload, all 11 account addresses and roles", async () => {
    const encoder = getAddressEncoder();
    const deriveAta = async (owner: Address) => (await getProgramDerivedAddress({ programAddress: ataProgram,
      seeds: [encoder.encode(owner), encoder.encode(token), encoder.encode(mint)] }))[0];
    const ix = await ore.buildClaimOreInstruction(system);
    expect(ix.programAddress).toBe(ore.programAddress);
    expect(ix.data).toEqual(Uint8Array.of(4, 0x10, 0x27, 0, 0, 0, 0, 0, 0));
    expect(ix.accounts).toEqual([
      { address: system, role: AccountRole.WRITABLE_SIGNER },
      { address: "BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi", role: AccountRole.WRITABLE },
      { address: "DAZVMv5nFB4mGM5CRCt5h4xK8eoxMa4H5adtS3RQ4TK2", role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.WRITABLE },
      { address: await deriveAta(system), role: AccountRole.WRITABLE },
      { address: treasury, role: AccountRole.WRITABLE },
      { address: await deriveAta(treasury), role: AccountRole.WRITABLE },
      { address: system, role: AccountRole.READONLY },
      { address: token, role: AccountRole.READONLY },
      { address: ataProgram, role: AccountRole.READONLY },
      { address: ore.programAddress, role: AccountRole.READONLY },
    ]);
  });

  it("decodes Treasury and pending fixed-point rewards from independent byte fixtures", async () => {
    const f = await fixture(100n);
    f.accounts.get(treasury)!.data = createTreasuryFixture(1000n, 1000n, (1n << 48n) / 4n);
    const miner = (await ore.getStatus(f.rpc, f.wallet.address)).miner!;
    expect(miner).toMatchObject({ rewardsOre: 100n, refinedOre: 12n, rewardsFactor: 0n, lastClaimOreAt: -14n });
    expect(await ore.getOreClaimEstimate(f.rpc, miner)).toEqual({ refined: 37n, unrefined: 100n, fee: 10n, amount: 127n });
  });

  it.each(["missing", "owner", "length", "discriminator", "executable"])("rejects %s Treasury", async kind => {
    const f = await fixture();
    const account = f.accounts.get(treasury)!;
    if (kind === "missing") f.accounts.delete(treasury);
    if (kind === "owner") account.owner = system;
    if (kind === "length") account.data = account.data.slice(0, 47);
    if (kind === "discriminator") account.data[0] = 103;
    if (kind === "executable") account.executable = true;
    await expect(claimOre({ ...f.options, confirm: async () => true })).rejects.toThrow();
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("ORE reward arithmetic", () => {
  const quote = (rewardsOre: bigint, refinedOre = 0n, totalUnclaimed = 1000n, factor = 0n, minerFactor = 0n) =>
    estimateOreClaim({ rewardsOre, refinedOre, rewardsFactor: minerFactor },
      { totalUnclaimed, totalRefined: 1000n, rewardsFactor: factor });
  it("floors fractional pending rewards and fee without floating point", () => {
    expect(quote(19n, 2n, 1000n, 1n << 47n)).toEqual({ refined: 11n, unrefined: 19n, fee: 1n, amount: 29n });
    expect(quote(2n, 0n, 1000n, (1n << 47n) - 1n).refined).toBe(0n);
  });
  it("charges at least one gram and exempts the final unclaimed balance", () => {
    expect(quote(1n)).toEqual({ refined: 0n, unrefined: 1n, fee: 1n, amount: 0n });
    expect(quote(100n, 12n, 100n)).toEqual({ refined: 12n, unrefined: 100n, fee: 0n, amount: 112n });
    expect(quote(0n, 12n).fee).toBe(0n);
  });
  it("does not accrue rewards for an equal or lower treasury factor", () => {
    expect(quote(10n, 2n, 1000n, 3n, 4n).refined).toBe(2n);
    expect(quote(10n, 2n, 1000n, 4n, 4n).refined).toBe(2n);
  });
  it("rejects inconsistent snapshots", () => {
    expect(() => quote(100n, 0n, 99n)).toThrow(/inconsistent/);
    expect(() => quote(0n, 1001n)).toThrow(/inconsistent/);
  });
  it("formats 11 decimal places and large amounts exactly", () => {
    expect(formatOre(1n)).toBe("0.00000000001");
    expect(formatOre(123_456_789_012n)).toBe("1.23456789012");
    expect(formatOre(18_446_744_073_709_551_615n)).toBe("184467440.73709551615");
    expect(formatOre(0n)).toBe("0");
  });
});

describe("claim-ore operation", () => {
  it.each([null, 0n, 1n])("does not build or send for missing Miner or zero net payout (%s)", async rewards => {
    const f = await fixture(rewards, 0n);
    const build = vi.spyOn(ore, "buildClaimOreInstruction");
    try {
      const result = await claimOre({ ...f.options, confirm: async () => true });
      expect(build).not.toHaveBeenCalled();
      expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
      expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    } finally { build.mockRestore(); }
  });

  it.each([false, true])("uses one ClaimORE for absent/existing ATA (exists=%s)", async exists => {
    const f = await fixture();
    const recipient = await ore.getOreTokenAddress(f.wallet.address);
    if (exists) f.accounts.set(recipient, { owner: token, executable: false, data: new Uint8Array(165) });
    // No client-side create: the verified ClaimORE handler handles both branches.
    const result = await claimOre({ ...f.options, confirm: async () => true });
    expect(f.rpc.simulateTransaction).toHaveBeenCalledOnce();
    expect(f.rpc.sendTransaction).toHaveBeenCalledOnce();
    expect(Object.values(f.rpc.simulateTransaction.mock.calls[0]![0].signatures).some(s => s === null)).toBe(true);
    expect(Object.values(f.rpc.sendTransaction.mock.calls[0]![0].signatures).every(s => s !== null)).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(result).toMatchObject({ signature: getSignatureFromTransaction(f.rpc.sendTransaction.mock.calls[0]![0]), estimatedAmount: 102n });
  });

  it("does not sign or send after cancellation", async () => {
    const f = await fixture();
    const result = await claimOre({ ...f.options, confirm: async () => false });
    expect(f.rpc.simulateTransaction).toHaveBeenCalledOnce();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
  });

  it("does not confirm or send after failed simulation, with confirmation configured", async () => {
    const f = await fixture();
    f.rpc.simulateTransaction.mockResolvedValue({ error: "InsufficientFunds", logs: ["ATA rent unavailable"] });
    const confirm = vi.fn(async () => true);
    await expect(claimOre({ ...f.options, confirm })).rejects.toThrow(/ATA rent unavailable/);
    expect(confirm).not.toHaveBeenCalled();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("displays both available actions and the net ORE estimate", async () => {
    const f = await fixture();
    const result = await readOreRewards(f.options);
    expect(result.availableActions).toContain("claim-sol");
    expect(result.availableActions).toContain("claim-ore");
    expect(result.ore?.amount).toBe(102n);
  });
});
