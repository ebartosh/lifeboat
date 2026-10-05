import type { Address } from '@solana/kit';
import type { AccountReader } from '../core/accounts';
import type { TransactionRpc } from '../core/rpc';
import { executeSafeTransaction, type SafeTransactionOptions, type TransactionReview } from '../core/transaction';
import { buildWithdraw, parseOreAmount, readStakePosition, type StakePosition } from '../protocols/ore-stake';

export type UnstakeReview = TransactionReview & {
  action: 'unstake'; amount: bigint; recipient: Address; recipientExists: boolean;
};

export async function unstakeOre(options: {
  rpc: AccountReader & TransactionRpc; wallet: Address; amount: string;
  getSigner?: SafeTransactionOptions['getSigner'];
  signWithWallet?: SafeTransactionOptions['signWithWallet'];
  confirm: (review: UnstakeReview) => Promise<boolean>;
  assertActive?: SafeTransactionOptions['assertActive'];
  beforeSend?: SafeTransactionOptions['beforeSend'];
}) {
  const amount = parseOreAmount(options.amount);
  // Read immediately before building; a displayed position is never trusted for execution.
  const position = await readStakePosition(options.rpc, options.wallet);
  if (!position || amount > position.available) throw new Error('Insufficient ORE in direct staking');
  const instruction = await buildWithdraw(position, amount);
  const describe = (review: TransactionReview): UnstakeReview => ({ ...review,
    action: 'unstake', amount, recipient: position.recipient, recipientExists: position.recipientExists });
  return executeSafeTransaction({ ...options, instruction,
    confirm: review => options.confirm(describe(review)) });
}

export type { StakePosition };
