import { createHash } from "node:crypto";
import { address, type Address } from "@solana/kit";
import type { ChainAccount } from "../../src/core/accounts";
import type { TokenDefinition } from "../../src/protocols/kamino/adapter";
import type { Reserve } from "../../src/protocols/kamino/state";
import { CLOCK, FARMS, SCOPE, ZERO, TOKEN } from "../../src/protocols/kamino/accounts";
import { adapter, fixture, obligationBytes, POSITION, SLOT, pubkey, tokenBytes, u64 } from "./kamino";
import inventory from "./kamino/inventory.json" with { type: "json" };

export function inventoryAccounts(): Map<Address, ChainAccount | null> {
  return new Map(inventory.batches.flatMap(b => b.keys.map((key, i) => {
    const a = b.accounts[i];
    return [address(key), a ? { owner: address(a.owner), executable: a.executable, data: new Uint8Array(Buffer.from(a.data, "base64")) } : null] as const;
  })));
}

// Public reserve/dependency bytes with synthetic wallet/obligation/farm users.
// Slots are normalized into the old fixture's modeled bank. No BPF is executed.
// `debtToken` borrows from a second reserve; `elevationGroup` sets the obligation's eMode id.
export async function inventoryFixture(token: TokenDefinition, debt = 100n,
  { debtToken = token, elevationGroup = 0 }: { debtToken?: TokenDefinition; elevationGroup?: number } = {}) {
  const f = await fixture();
  for (const [key, value] of inventoryAccounts()) f.rpc.accounts.set(key, value);
  const clock = f.rpc.accounts.get(CLOCK)!;
  u64(clock.data, 0, SLOT);
  for (const [key, a] of f.rpc.accounts) {
    if (!a || a.executable) continue;
    if (a.owner === adapter.programAddress && a.data.length === 8624) u64(a.data, 16, SLOT);
    if (a.owner === SCOPE) for (let index = 0; index < 512; index++) u64(a.data, 40 + index * 56 + 16, SLOT);
    // The remaining reserve fields and external mint/vault/farm bytes stay public.
    if (key === POSITION) f.rpc.accounts.delete(key);
  }
  const reserveKey = address(token.reserve), mint = address(token.mint);
  const reserve = adapter.programInterface.decodeAccount("Reserve", f.rpc.accounts.get(reserveKey)!.data) as unknown as Reserve;
  const debtKey = address(debtToken.reserve), debtMint = address(debtToken.mint);
  const debtReserve = adapter.programInterface.decodeAccount("Reserve", f.rpc.accounts.get(debtKey)!.data) as unknown as Reserve;
  const obligation = obligationBytes(f.wallet.address, reserveKey, 1_000n, debt, { borrowReserve: debtKey, elevationGroup });
  debtReserve.liquidity.cumulativeBorrowRateBsf.value.forEach((v, i) => u64(obligation, 1240 + i * 8, v));
  f.rpc.accounts.set(POSITION, { owner: adapter.programAddress, executable: false, data: obligation });
  const ata = await adapter.ata(f.wallet.address, mint);
  const debtAta = await adapter.ata(f.wallet.address, debtMint);
  f.rpc.accounts.set(debtAta, { owner: TOKEN, executable: false, data: tokenBytes(f.wallet.address, debtMint, 10_000n) });
  f.rpc.accounts.set(ata, { owner: TOKEN, executable: false, data: tokenBytes(f.wallet.address, mint, 10_000n) });
  for (const farm of new Set([reserve.farmDebt, reserve.farmCollateral, debtReserve.farmDebt, debtReserve.farmCollateral])) {
    if (farm === ZERO) continue;
    const key = await adapter.programInterface.derivePda("farmUser", { farm, obligation: POSITION });
    const data = new Uint8Array(920);
    data.set(createHash("sha256").update("account:UserState").digest().subarray(0, 8));
    pubkey(data, 16, farm); pubkey(data, 48, f.wallet.address); data[80] = 1; pubkey(data, 480, POSITION);
    f.rpc.accounts.set(key, { owner: FARMS, executable: false, data });
  }
  return { ...f, reserveKey, reserveState: reserve, mint, ata, debtKey, debtAta, obligation, clock };
}

