import { addSignersToInstruction, type Address, type KeyPairSigner, type Transaction } from "@solana/kit";
import type { ChainAccount } from "../../core/accounts";
import { ProgramInterface } from "../../core/program-interface";
import { check, support, TOKEN, ZERO } from "./accounts";
import { ceilDiv, SF, U64_MAX } from "./math";
import type { Reserve } from "./state";
import systemIdl from "./system.idl.json" with { type: "json" };

export interface NativeSolRpc {
  getMinimumBalanceForRentExemption(size: number): Promise<bigint>;
  getTransactionFee(transaction: Transaction): Promise<bigint | null>;
}
export type NativeSolEstimate = {
  wrap: bigint; buffer: bigint; rent: bigint; fee?: bigint; refund?: bigint; debit?: bigint;
};
const system = new ProgramInterface(systemIdl);

// Upper-rounded compounding at the highest curve rate plus host rate for five
// minutes (600 legacy slots / 300 TrueApr seconds). See provenance for limits.
export function fullRepaymentWrap(debtSf: bigint, reserve: Reserve): bigint {
  const config = reserve.config;
  check(config.interestRateBasis === 0 || config.interestRateBasis === 1, "unsupported interest rate basis");
  const maxBps = config.borrowRateCurve.points.reduce((max, point) => {
    const rate = BigInt(point.borrowRateBps);
    return rate > max ? rate : max;
  }, 0n) + BigInt(config.hostFixedInterestRateBps);
  const units = config.interestRateBasis === 0 ? 600 : 300;
  const year = config.interestRateBasis === 0 ? 63_072_000n : 31_536_000n;
  const step = SF + ceilDiv(maxBps * SF, 10_000n * year);
  let factor = SF;
  for (let index = 0; index < units; index++) factor = ceilDiv(factor * step, SF);
  const owed = ceilDiv(debtSf, SF);
  // One extra lamport covers rounding even for a debt of only a few lamports.
  const wrap = owed + ceilDiv(owed * (factor - SF), SF) + 1n;
  check(wrap <= U64_MAX, "SOL wrapping amount exceeds u64");
  return wrap;
}

export function walletLamports(account: ChainAccount | null | undefined): bigint {
  check(account && account.owner === ZERO && !account.executable && account.data.length === 0
    && account.lamports !== undefined && account.lamports >= 0n, "SOL wallet must be a System-owned account with a lamport balance");
  return account.lamports;
}

export async function nativeSolInstructions(wallet: Address, temporary: KeyPairSigner, mint: Address, wrap: bigint, rent: bigint) {
  check(wrap > 0n && rent > 0n && wrap + rent <= U64_MAX, "SOL amount plus rent exceeds u64 or is invalid");
  // CreateAccount both funds and allocates. InitializeAccount3 derives the native
  // token amount from lamports minus rent, so a separate SyncNative is unnecessary.
  const create = addSignersToInstruction([temporary], await system.buildInstruction("createAccount", {
    lamports: wrap + rent, space: BigInt(support.getAccountSize("TokenAccount")), owner: TOKEN,
  }, { payer: wallet, account: temporary.address }));
  const initialize = await support.buildInstruction("initializeAccount3", { owner: wallet }, { account: temporary.address, mint });
  const close = await support.buildInstruction("closeAccount", {}, { account: temporary.address, destination: wallet, owner: wallet });
  return { setup: [create, initialize], close };
}

