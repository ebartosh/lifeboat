import {
  appendTransactionMessageInstructions,
  blockhash as toBlockhash,
  getTransactionEncoder,
  getTransactionDecoder,
  compileTransaction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  partiallySignTransaction,
  getSignatureFromTransaction,
  type Instruction,
  type Address,
  type KeyPairSigner,
  type Signature,
  type Transaction,
} from "@solana/kit";

import { errorMessage, SimulationError, TransactionError } from "./errors";
import type { LatestBlockhash, SimulationResult, TransactionRpc } from "./rpc";
import { startTransactionTrace } from './transaction-diagnostics';
import { checkSignedTransaction, checkTransactionSignatures } from './signed-transaction';
import { validateWalletTransactionChanges, type WalletTransactionChanges } from './wallet-transaction-policy';

export type SafeTransactionResult =
  | { status: "cancelled" }
  | { status: "confirmed"; signature: Signature; slot?: bigint };

export type SafeTransactionOptions = {
  rpc: TransactionRpc;
  wallet: Address;
  signWithWallet: (unsigned: Transaction) => Promise<Transaction>;
  additionalSigners?: readonly KeyPairSigner[];
  instruction?: Instruction;
  instructions?: readonly Instruction[];
  simulationAccounts?: readonly Address[];
  validateSimulation?: (simulation: SimulationResult) => void | Promise<void>;
  beforeSimulation?: (transaction: Transaction) => Promise<void>;
  confirm: (review: TransactionReview) => Promise<boolean>;
  onSimulated?: (review: TransactionReview) => void;
  assertActive?: () => void;
  beforeSend?: (transaction: PendingTransactionIdentity) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export type PendingTransactionIdentity = {
  signature: Signature;
  wallet: Address;
  blockhash: string;
  lastValidBlockHeight: bigint;
};

export class OnChainFailure extends TransactionError {}
export class NotSentError extends TransactionError {}
/** The lifetime ended before any submission attempt; a new preparation is safe. */
export class UnsentTransactionExpiredError extends TransactionError {}

export type TransactionReview = {
  wallet: Address;
  simulation: SimulationResult;
  feeLamports: bigint | null;
  lastValidBlockHeight: bigint;
  walletChanges?: WalletTransactionChanges;
};

/** Wire size of a legacy transaction paid by `wallet`; the blockhash value does not change it. */
export function legacyTransactionSize(wallet: Address, instructions: readonly Instruction[]): number {
  return getTransactionEncoder().encode(compileTransaction(pipe(
    createTransactionMessage({ version: "legacy" }),
    message => setTransactionMessageFeePayer(wallet, message),
    message => setTransactionMessageLifetimeUsingBlockhash({ blockhash: toBlockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n }, message),
    message => appendTransactionMessageInstructions(instructions, message),
  ))).length;
}

function copyTransaction(transaction: Transaction): Transaction {
  return { ...transaction, ...getTransactionDecoder().decode(getTransactionEncoder().encode(transaction)) };
}

function describeRpcValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function executeSafeTransaction(options: SafeTransactionOptions): Promise<SafeTransactionResult> {
  const trace = startTransactionTrace();
  try { return await executeTracedTransaction(options, trace); }
  catch (error) { trace.failure(error); throw error; }
}

async function executeTracedTransaction(options: SafeTransactionOptions, trace: ReturnType<typeof startTransactionTrace>): Promise<SafeTransactionResult> {
  // Capture execution context before yielding to caller callbacks.
  const { rpc, wallet, signWithWallet, confirm } = options;
  const additionalSigners = options.additionalSigners ?? [];
  const assertActive = options.assertActive ?? (() => {});
  assertActive();
  if (typeof signWithWallet !== 'function') {
    throw new TransactionError('An external wallet signing method is required');
  }
  if ((options.instruction === undefined) === (options.instructions === undefined)) {
    throw new TransactionError("Supply exactly one instruction or one instruction list");
  }
  // Detach the message from caller-owned buffers before simulation/confirmation callbacks.
  const instructions = (options.instructions ?? [options.instruction!]).map(instruction => ({
    ...instruction,
    ...(instruction.data === undefined ? {} : { data: Uint8Array.from(instruction.data) }),
    ...(instruction.accounts === undefined ? {} : { accounts: instruction.accounts.map(account => ({ ...account })) }),
  }));
  if (instructions.length === 0) throw new TransactionError("Cannot execute an empty transaction");
  const expectedSigners = [wallet, ...additionalSigners.map(signer => signer.address)];
  if (new Set(expectedSigners).size !== expectedSigners.length) throw new TransactionError('Duplicate transaction signer');
  const compile = (lifetime: LatestBlockhash): Transaction => {
    const transaction = compileTransaction(pipe(
      createTransactionMessage({ version: "legacy" }),
      message => setTransactionMessageFeePayer(wallet, message),
      message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      message => appendTransactionMessageInstructions(instructions, message),
    ));
    if (Object.keys(transaction.signatures).length !== expectedSigners.length ||
        expectedSigners.some(signer => !(signer in transaction.signatures))) {
      throw new TransactionError('Transaction signers differ from the configured wallet and temporary signers');
    }
    if (getTransactionEncoder().encode(transaction).length > 1232) {
      throw new TransactionError("Transaction exceeds Solana's 1232-byte limit; this position is not supported without lookup tables");
    }
    return transaction;
  };
  const simulate = async (transaction: Transaction, label: string): Promise<SimulationResult> => {
    await options.beforeSimulation?.(copyTransaction(transaction));
    let simulation: SimulationResult;
    try {
      simulation = await rpc.simulateTransaction(copyTransaction(transaction), options.simulationAccounts);
    } catch (error) {
      throw new SimulationError(`${label} simulation RPC request failed: ${errorMessage(error)}`, { cause: error });
    }
    if (simulation.error !== null) {
      trace.programError(simulation.error);
      const logSuffix = simulation.logs.length === 0 ? "" : `\n${simulation.logs.join("\n")}`;
      throw new SimulationError(`${label} simulation failed: ${describeRpcValue(simulation.error)}${logSuffix}`);
    }
    return simulation;
  };

  // This lifetime serves simulation and review only. After approval the same instructions
  // receive a fresh blockhash, so review time does not consume the signing and landing window.
  trace.event('blockhash-start');
  let blockhash = { ...await rpc.getLatestBlockhash() };
  trace.event('message-build');
  let unsignedTransaction = compile(blockhash);
  trace.messageShape('original', unsignedTransaction);
  trace.event('simulation-start');
  const simulation = await simulate(unsignedTransaction, 'Transaction');
  trace.event('simulation-validation');
  await options.validateSimulation?.(simulation);
  trace.event('fee-read');
  let review: TransactionReview = { wallet, simulation,
    feeLamports: await rpc.getTransactionFee?.(copyTransaction(unsignedTransaction)) ?? null,
    lastValidBlockHeight: blockhash.lastValidBlockHeight };
  options.onSimulated?.(review);
  assertActive();

  trace.event('review-wait');
  if (!(await confirm(review))) {
    trace.event('cancelled');
    return { status: "cancelled" };
  }
  assertActive();

  trace.event('review-approved');
  trace.event('lifetime-refresh');
  const fresh = { ...await rpc.getLatestBlockhash() };
  // A lagging RPC node may return an older blockhash; keep whichever lifetime lasts longer.
  if (fresh.lastValidBlockHeight > blockhash.lastValidBlockHeight) {
    blockhash = fresh;
    unsignedTransaction = compile(blockhash);
    assertActive();
    // The approved simulation does not cover a new message: repeat every precondition and
    // postcondition before the wallet sees it. Failure here sends nothing.
    trace.event('fresh-simulation-start');
    const freshSimulation = await simulate(unsignedTransaction, 'Fresh-blockhash');
    trace.event('fresh-simulation-validation');
    await options.validateSimulation?.(freshSimulation);
    const feeLamports = await rpc.getTransactionFee?.(copyTransaction(unsignedTransaction)) ?? null;
    // Only the lifetime changed, so the fee should not; never sign for more than was approved.
    if (review.feeLamports !== null && (feeLamports === null || feeLamports > review.feeLamports)) {
      throw new TransactionError('The network fee changed after approval; nothing was sent. Prepare and confirm again');
    }
    review = { ...review, simulation: freshSimulation, feeLamports, lastValidBlockHeight: blockhash.lastValidBlockHeight };
    assertActive();
  }
  trace.event('pre-sign-height');
  const currentBlockHeight = await rpc.getBlockHeight();
  if (currentBlockHeight > blockhash.lastValidBlockHeight) {
    throw new UnsentTransactionExpiredError("The simulated transaction blockhash expired before signing; prepare and confirm again");
  }

  let signedTransaction;
  trace.event('signing-start');
  try {
    assertActive();
    const partlySigned = additionalSigners.length
      ? await partiallySignTransaction(additionalSigners.map(extra => extra.keyPair), unsignedTransaction)
      : copyTransaction(unsignedTransaction);
    signedTransaction = await signWithWallet(copyTransaction(partlySigned));
    assertActive();
  } catch (error) {
    throw new TransactionError(`Transaction signing failed: ${errorMessage(error)}`, { cause: error });
  }
  trace.event('signing-result');
  trace.event('signature-validation');
  if (signedTransaction) trace.messageShape('returned', signedTransaction);
  let signatureFailure = await checkSignedTransaction(unsignedTransaction, signedTransaction, expectedSigners);
  const walletChanges = signedTransaction && (signatureFailure === 'message-length' || signatureFailure === 'message-bytes')
    ? validateWalletTransactionChanges(unsignedTransaction, signedTransaction) : null;
  if (walletChanges) {
    trace.instructionDetails(unsignedTransaction, signedTransaction);
    // A wallet changing compute/guard instructions invalidates signatures from temporary
    // accounts. Re-sign only the application's configured temporary keys after policy checks.
    if (additionalSigners.length) signedTransaction = await partiallySignTransaction(additionalSigners.map(extra => extra.keyPair), signedTransaction);
    signatureFailure = await checkTransactionSignatures(signedTransaction, expectedSigners);
  }
  if (signatureFailure) {
    if (signedTransaction && (signatureFailure === 'message-length' || signatureFailure === 'message-bytes')) {
      trace.instructionDetails(unsignedTransaction, signedTransaction);
    }
    trace.signatureRejected(signatureFailure);
    throw new TransactionError(`Signed transaction message or signature is invalid (${signatureFailure})`);
  }
  trace.event('post-sign-height');
  if (await rpc.getBlockHeight() > blockhash.lastValidBlockHeight) {
    throw new UnsentTransactionExpiredError('The simulated transaction blockhash expired before sending; prepare and confirm again');
  }
  assertActive();
  if (walletChanges) {
    trace.event('wallet-simulation-start');
    await options.beforeSimulation?.(copyTransaction(signedTransaction));
    let returnedSimulation: SimulationResult;
    try { returnedSimulation = await rpc.simulateTransaction(copyTransaction(signedTransaction), options.simulationAccounts); }
    catch (error) { throw new SimulationError(`Wallet transaction simulation RPC request failed: ${errorMessage(error)}`, { cause: error }); }
    if (returnedSimulation.error !== null) {
      trace.programError(returnedSimulation.error);
      throw new SimulationError('Wallet transaction simulation failed; nothing was sent');
    }
    if (walletChanges.computeUnitLimit !== null && returnedSimulation.unitsConsumed !== undefined
      && returnedSimulation.unitsConsumed > BigInt(walletChanges.computeUnitLimit)) {
      throw new SimulationError('Wallet transaction exceeded its compute limit; nothing was sent');
    }
    trace.event('wallet-simulation-validation');
    await options.validateSimulation?.(returnedSimulation);
    const feeLamports = await rpc.getTransactionFee?.(copyTransaction(signedTransaction));
    if (feeLamports == null || feeLamports < 0n) throw new TransactionError('Could not determine the wallet transaction fee; nothing was sent');
    if (feeLamports < walletChanges.priorityFeeLamports) throw new TransactionError('Wallet transaction fee estimate is inconsistent; nothing was sent');
    const updatedReview: TransactionReview = { ...review, simulation: returnedSimulation, feeLamports, walletChanges };
    options.onSimulated?.(updatedReview);
    assertActive();
    trace.event('wallet-review-wait');
    if (!await confirm(updatedReview)) { trace.event('cancelled'); return { status: 'cancelled' }; }
    assertActive();
    trace.event('wallet-review-approved');
  }
  const signature = getSignatureFromTransaction(signedTransaction);
  try {
    trace.event('pending-save');
    await options.beforeSend?.({ signature, wallet, blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight });
    assertActive();
    trace.event('pre-send-height');
    if (await rpc.getBlockHeight() > blockhash.lastValidBlockHeight) {
      throw new UnsentTransactionExpiredError('The simulated transaction blockhash expired before sending; prepare and confirm again');
    }
    assertActive();
  } catch (error) {
    // This process knows sendTransaction has not been called. After a crash the saved
    // identity remains conservative/unknown, because that fact cannot be recovered.
    throw new NotSentError('Transaction was not sent; prepare and confirm again', { cause: error });
  }
  trace.event('send-start');
  if (await rpc.sendTransaction(signedTransaction) !== signature) {
    throw new TransactionError('RPC returned a different transaction signature');
  }
  trace.event('send-result');

  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  trace.event('confirmation-start');
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    assertActive();
    const status = await rpc.getSignatureStatus(signature);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.error !== null) {
        trace.programError(status.error);
        throw new OnChainFailure('Transaction failed on-chain');
      }
      trace.event('confirmed');
      return { status: "confirmed", signature, ...(status.slot === undefined ? {} : { slot: status.slot }) };
    }
    if ((await rpc.getBlockHeight()) > blockhash.lastValidBlockHeight) {
      throw new TransactionError(`Transaction ${signature} expired before confirmation`);
    }
    if (now() >= deadline) break;
    await sleep(pollIntervalMs);
  }

  throw new TransactionError(`Timed out waiting for transaction ${signature} to confirm`);
}
