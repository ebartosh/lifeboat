import type { Address, Signature } from '@solana/kit';
import { SolanaRpcClient } from '../core/rpc';
import { executeSafeTransaction, type PendingTransactionIdentity, type SafeTransactionOptions, type TransactionReview } from '../core/transaction';
import { MeteoraAdapter, type MeteoraStatus } from '../protocols/meteora/adapter';
import { check } from '../protocols/meteora/codec';
import { prepareWithdrawAll, type MeteoraRpc, type Receipt, type WithdrawalStep } from '../protocols/meteora/withdraw';
export type MeteoraOperation = {
  version: 1; id: string; wallet: Address; position: Address; rpcUrl: string; createdAt: number;
  completed: { step: WithdrawalStep; signature: Signature; slot?: string }[];
  currentStep?: WithdrawalStep;
};
export type MeteoraReview = TransactionReview & {
  action: 'meteora-withdraw-all'; operationId: string; position: Address; recipient: Address;
  step: WithdrawalStep; completedSteps: number; remainingSteps: number; receipts: Receipt[]; remainingReceipts: Receipt[];
  ataRent: bigint; remainingAtaRent: bigint; rentRefund: bigint;
};
export type MeteoraExecutionInput = Pick<SafeTransactionOptions,'wallet'|'getSigner'|'signWithWallet'|'assertActive'> & {
  operation: MeteoraOperation;
  confirm(review: MeteoraReview): Promise<boolean>;
  beforeSend(identity: PendingTransactionIdentity, step: WithdrawalStep): Promise<void>;
  confirmed(operation: MeteoraOperation): Promise<void>;
  progress?(operation: MeteoraOperation): void;
};
export async function readMeteoraPositions(url: string, wallet: Address): Promise<MeteoraStatus[]> {
  return new MeteoraAdapter().getStatus(new SolanaRpcClient(url),wallet);
}
export async function executeMeteora(url: string, input: MeteoraExecutionInput) {
  return executeMeteoraWithRpc(new SolanaRpcClient(url),input);
}
export async function executeMeteoraWithRpc(rpc: MeteoraRpc, input: MeteoraExecutionInput,
  executeStep = executeSafeTransaction): Promise<{status:'confirmed'|'partial'; operation:MeteoraOperation}> {
  let operation = input.operation;
  check(operation.wallet === input.wallet, 'connected wallet does not match the saved operation');
  const adapter = new MeteoraAdapter();
  // Bound the loop against RPCs presenting changing or inconsistent accounts.
  for (let i = 0; i < 100; i++) {
    input.assertActive?.();
    const minSlot = operation.completed.reduce((slot,c) => c.slot && BigInt(c.slot) > slot ? BigInt(c.slot) : slot,0n);
    const plan = await prepareWithdrawAll({rpc,wallet:input.wallet,position:operation.position,adapter,minSlot});
    input.assertActive?.();
    if (!plan) {
      check(operation.completed.some(c => c.step.kind === 'close'), 'position is missing without a confirmed close step');
      return {status:'confirmed',operation};
    }
    check(!operation.completed.some(c => c.step.id === plan.step.id), 'confirmed step effects are not visible; continuation is blocked');
    input.progress?.(operation);
    const result = await executeStep({rpc,wallet:input.wallet,getSigner:input.getSigner,signWithWallet:input.signWithWallet,
      assertActive:input.assertActive,instructions:plan.instructions,simulationAccounts:plan.simulationAccounts,
      validateSimulation:plan.validateSimulation,
      confirm:review => input.confirm({...review,action:'meteora-withdraw-all',operationId:operation.id,position:operation.position,
        recipient:input.wallet,step:plan.step,completedSteps:operation.completed.length,remainingSteps:plan.remainingSteps,
        receipts:plan.receipts,remainingReceipts:plan.remainingReceipts,ataRent:plan.ataRent,remainingAtaRent:plan.remainingAtaRent,rentRefund:plan.rentRefund}),
      beforeSend:identity => input.beforeSend(identity,plan.step),
    });
    if (result.status === 'cancelled') return {status:'partial',operation};
    operation = {...operation,currentStep:undefined,completed:[...operation.completed,{step:plan.step,signature:result.signature,
      ...(result.slot === undefined ? {} : {slot:result.slot.toString()})}]};
    // The durable checkpoint must precede clearing the pending signature.
    await input.confirmed(operation);
  }
  throw new Error('Meteora: withdrawal exceeded the maximum number of steps');
}
