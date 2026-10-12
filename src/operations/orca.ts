import type { Address, Signature } from '@solana/kit';
import { SolanaRpcClient } from '../core/rpc';
import { executeSafeTransaction, type PendingTransactionIdentity, type SafeTransactionOptions, type TransactionReview } from '../core/transaction';
import { OrcaAdapter, type OrcaStatus } from '../protocols/orca/adapter';
import { check } from '../protocols/orca/codec';
import { prepareWithdrawAll, type CloseHold, type OrcaRpc, type Receipt, type WithdrawalStep } from '../protocols/orca/withdraw';
export type OrcaOperation = {
  version: 1; protocol: 'orca'; id: string; wallet: Address; position: Address; rpcUrl: string; createdAt: number;
  completed: { step: WithdrawalStep; signature: Signature; slot?: string }[];
  currentStep?: WithdrawalStep;
};
export type OrcaReview = TransactionReview & {
  action: 'orca-withdraw-all'; operationId: string; position: Address; recipient: Address;
  step: WithdrawalStep; completedSteps: number; remainingSteps: number; receipts: Receipt[]; remainingReceipts: Receipt[];
  ataRent: bigint; remainingAtaRent: bigint; rentRefund: bigint; closeHold: CloseHold | null; estimatesComplete: boolean;
};
export type OrcaExecutionInput = Pick<SafeTransactionOptions,'wallet'|'signWithWallet'|'assertActive'> & {
  operation: OrcaOperation;
  confirm(review: OrcaReview): Promise<boolean>;
  beforeSend(identity: PendingTransactionIdentity, step: WithdrawalStep): Promise<void>;
  confirmed(operation: OrcaOperation): Promise<void>;
  progress?(operation: OrcaOperation): void;
};
export async function readOrcaPositions(url: string, wallet: Address): Promise<OrcaStatus[]> {
  return new OrcaAdapter().getStatus(new SolanaRpcClient(url), wallet);
}
export async function executeOrca(url: string, input: OrcaExecutionInput) {
  return executeOrcaWithRpc(new SolanaRpcClient(url), input);
}
export async function executeOrcaWithRpc(rpc: OrcaRpc, input: OrcaExecutionInput,
  executeStep = executeSafeTransaction): Promise<{status:'confirmed'|'partial'; operation:OrcaOperation}> {
  let operation = input.operation;
  check(operation.wallet === input.wallet, 'connected wallet does not match the saved operation');
  const adapter = new OrcaAdapter();
  // Bound the loop against RPCs presenting changing or inconsistent accounts.
  for (let i = 0; i < 20; i++) {
    input.assertActive?.();
    const minSlot = operation.completed.reduce((slot,c) => c.slot && BigInt(c.slot) > slot ? BigInt(c.slot) : slot,0n);
    const plan = await prepareWithdrawAll({rpc,wallet:input.wallet,position:operation.position,adapter,minSlot});
    input.assertActive?.();
    if (!plan) {
      check(operation.completed.some(c => c.step.actions.some(a => a.kind === 'close')), 'position is missing without a confirmed close step');
      return {status:'confirmed',operation};
    }
    // Removal, fee collection and close empty their state exactly. A reward collection may repeat
    // after a vault paid only part of what was owed.
    const confirmedActions = new Set(operation.completed.flatMap(c => c.step.actions.filter(a => a.kind !== 'reward').map(a => a.id)));
    check(!plan.step.actions.some(a => confirmedActions.has(a.id)), 'confirmed step effects are not visible; continuation is blocked');
    input.progress?.(operation);
    const result = await executeStep({rpc,wallet:input.wallet,signWithWallet:input.signWithWallet,
      assertActive:input.assertActive,instructions:plan.instructions,simulationAccounts:plan.simulationAccounts,
      validateSimulation:plan.validateSimulation,
      confirm:review => input.confirm({...review,action:'orca-withdraw-all',operationId:operation.id,position:operation.position,
        recipient:input.wallet,step:plan.step,completedSteps:operation.completed.length,remainingSteps:plan.remainingSteps,
        receipts:plan.receipts,remainingReceipts:plan.remainingReceipts,ataRent:plan.ataRent,remainingAtaRent:plan.remainingAtaRent,
        rentRefund:plan.rentRefund,closeHold:plan.closeHold,estimatesComplete:plan.position.ticksKnown || plan.position.state.liquidity === 0n}),
      beforeSend:identity => input.beforeSend(identity,plan.step),
    });
    if (result.status === 'cancelled') return {status:'partial',operation};
    operation = {...operation,currentStep:undefined,completed:[...operation.completed,{step:plan.step,signature:result.signature,
      ...(result.slot === undefined ? {} : {slot:result.slot.toString()})}]};
    // The durable checkpoint must precede clearing the pending signature.
    await input.confirmed(operation);
  }
  throw new Error('Orca: withdrawal exceeded the maximum number of steps');
}
