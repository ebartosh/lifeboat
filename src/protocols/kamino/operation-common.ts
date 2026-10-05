import {
  address, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage,
  pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  getTransactionEncoder, type Address, type Instruction, type KeyPairSigner, type Transaction,
} from "@solana/kit";
import type { LendingReader } from "../../core/accounts";
import type { SimulationResult, TransactionRpc } from "../../core/rpc";
import { SimulationError } from "../../core/errors";
import { KaminoAdapter, type Position } from "./adapter";
import { FARMS, ZERO, check, decode } from "./accounts";
import type { NativeSolEstimate, NativeSolRpc } from "./native-sol";
import type { LendingMarket, Obligation, Reserve } from "./state";

export type KaminoRpc = LendingReader & TransactionRpc & NativeSolRpc;
export type OperationPlan = {
  instructions: readonly Instruction[]; simulationAccounts: readonly Address[];
  estimate: bigint; token: string; decimals: number; reserve: Address; recipient: Address; createsAta: boolean;
  collateralAmount?: bigint;
  nativeSol?: NativeSolEstimate;
  additionalSigners?: readonly KeyPairSigner[];
  beforeSimulation?: (transaction: Transaction) => Promise<void>;
  validateSimulation: (result: SimulationResult) => void;
};

// Fixed compute limit; no priority fee or external landing service.
export function computeBudget(): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, 1_400_000, true);
  return { programAddress: address("ComputeBudget111111111111111111111111111111"), data };
}

export async function refreshPreview(adapter: KaminoAdapter, rpc: KaminoRpc, wallet: Address, position: Position): Promise<Position> {
  if (!position.repayment) check([...position.reserves.values()].every(r => r.oracleFresh), "Scope price/TWAP is stale; wait for the oracle publisher and retry");
  const instructions = [computeBudget(), ...await adapter.refreshInstructions(position)];
  const blockhash = await rpc.getLatestBlockhash();
  const message = pipe(createTransactionMessage({ version: "legacy" }),
    m => setTransactionMessageFeePayer(wallet, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(instructions, m));
  const transaction = compileTransaction(message);
  check(getTransactionEncoder().encode(transaction).length <= 1232, "position refresh exceeds transaction size limit");
  const keys = [position.address, ...position.reserves.keys()];
  const result = await rpc.simulateTransaction(transaction, keys);
  if (result.error !== null) throw new SimulationError(`Kamino refresh simulation failed: ${JSON.stringify(result.error)}\n${result.logs.join("\n")}`);
  check(result.snapshot && result.snapshot.accounts.length === keys.length && result.snapshot.slot >= position.slot,
    "RPC must return fresh simulated accounts for the refresh preview");
  const state = decode<Obligation>(adapter.programInterface, "Obligation", result.snapshot.accounts[0], adapter.programAddress);
  check(state.owner === position.wallet && state.lendingMarket === adapter.marketAddress, "simulated position links mismatch");
  check(state.lastUpdate.stale === 0 && state.lastUpdate.slot === result.snapshot.slot, "simulated position was not refreshed");
  const reserves = new Map(position.reserves);
  keys.slice(1).forEach((key, index) => {
    const previous = reserves.get(key)!;
    const state = decode<Reserve>(adapter.programInterface, "Reserve", result.snapshot!.accounts[index + 1], adapter.programAddress);
    check(state.lendingMarket === adapter.marketAddress && state.liquidity.mintPubkey === previous.state.liquidity.mintPubkey,
      "simulated reserve links mismatch");
    check(state.lastUpdate.stale === 0 && state.lastUpdate.slot === result.snapshot!.slot, "simulated reserve was not refreshed");
    reserves.set(key, { ...previous, state });
  });
  adapter.validateRefreshedPosition(position, state, reserves);
  return { ...position, state, reserves, slot: result.snapshot.slot };
}

export type PreparationOptions = {
  adapter: KaminoAdapter; rpc: KaminoRpc; wallet: Address; position: Address;
  token: string; amount: string; reserve?: string;
};

export async function operationFarms(adapter: KaminoAdapter, position: Position, farm: Address) {
  const farmUser = farm === ZERO ? adapter.programAddress : await adapter.programInterface.derivePda("farmUser", { farm, obligation: position.address });
  check(farm === ZERO || position.accounts.get(farmUser), "required farm user is missing; farm initialization is outside MVP");
  return { obligationFarmUserState: farmUser, reserveFarmState: farm === ZERO ? adapter.programAddress : farm, farmsProgram: FARMS };
}

// Both operations return position, wallet token account, market, then reserves.
export function validateSimulationSnapshot(adapter: KaminoAdapter, position: Position, simulationAccounts: readonly Address[], result: SimulationResult) {
  check(result.snapshot && result.snapshot.accounts.length === simulationAccounts.length && result.snapshot.slot >= position.slot,
    "RPC must return fresh final simulated position and token account");
  adapter.validateMarket(decode<LendingMarket>(adapter.programInterface, "LendingMarket", result.snapshot.accounts[2], adapter.programAddress));
  for (const [index, key] of [...position.reserves.keys()].entries()) {
    const reserve = decode<Reserve>(adapter.programInterface, "Reserve", result.snapshot.accounts[index + 3], adapter.programAddress);
    adapter.validatePositionReserve(reserve, key, position.state, position.repayment);
    adapter.validateReserveDependencies(position, key, reserve);
  }
  return result.snapshot.accounts;
}

