import type { Address } from '@solana/kit';
import { SolanaRpcClient } from '../core/rpc';
import { executeSafeTransaction, type SafeTransactionOptions, type SafeTransactionResult, type TransactionReview } from '../core/transaction';
import { DammAdapter, type DammStatus, type Reward } from '../protocols/meteora-damm/adapter';
import { holdText, prepareWithdrawAll, type DammRpc, type Hold, type Receipt, type WithdrawalAction } from '../protocols/meteora-damm/withdraw';

export type DammReview = TransactionReview & {
  action: 'meteora-damm-withdraw-all'; position: Address; recipient: Address; actions: WithdrawalAction[];
  receipts: Receipt[]; ataRent: bigint; rentRefund: bigint; closes: boolean; holds: Hold[]; holdText: string | null;
  forfeited: Reward[];
};
export type DammExecutionInput = Pick<SafeTransactionOptions, 'wallet' | 'signWithWallet' | 'assertActive' | 'beforeSend'> & {
  confirm(review: DammReview): Promise<boolean>;
};
export async function readDammPositions(url: string, wallet: Address): Promise<DammStatus[]> {
  return new DammAdapter().getStatus(new SolanaRpcClient(url), wallet);
}
export async function executeDamm(url: string, position: Address, input: DammExecutionInput) {
  return executeDammWithRpc(new SolanaRpcClient(url), position, input);
}
/** One transaction and one approval. A pending signature is recovered like any single transaction. */
export async function executeDammWithRpc(rpc: DammRpc, position: Address, input: DammExecutionInput,
  executeStep = executeSafeTransaction): Promise<SafeTransactionResult> {
  input.assertActive?.();
  const plan = await prepareWithdrawAll({ rpc, wallet: input.wallet, position });
  input.assertActive?.();
  return executeStep({ rpc, wallet: input.wallet, signWithWallet: input.signWithWallet,
    ...(input.assertActive ? { assertActive: input.assertActive } : {}), ...(input.beforeSend ? { beforeSend: input.beforeSend } : {}),
    instructions: plan.instructions, simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
    confirm: review => input.confirm({ ...review, action: 'meteora-damm-withdraw-all', position, recipient: input.wallet,
      actions: plan.actions, receipts: plan.receipts, ataRent: plan.ataRent, rentRefund: plan.rentRefund, closes: plan.closes,
      holds: plan.holds, holdText: holdText(plan.position, plan.holds), forfeited: plan.forfeited }) });
}
