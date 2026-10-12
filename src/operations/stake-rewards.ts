import type { Address } from '@solana/kit';
import type { AccountReader } from '../core/accounts';
import { VerificationError } from '../core/errors';
import type { TransactionRpc } from '../core/rpc';
import { executeSafeTransaction, type SafeTransactionOptions, type SafeTransactionResult,
  type TransactionReview } from '../core/transaction';
import { buildClaim, parseStakeAccount, readStakePosition } from '../protocols/ore-stake';

export type StakeRewardsReview = TransactionReview & {
  action: 'claim-stake-rewards'; amount: bigint; recipient: Address; recipientExists: boolean;
};
export type StakeRewardsResult = SafeTransactionResult | { status: 'nothing-to-claim' };

export async function claimStakeRewards(options: {
  rpc: AccountReader & TransactionRpc; wallet: Address;
  signWithWallet: SafeTransactionOptions['signWithWallet'];
  confirm: (review: StakeRewardsReview) => Promise<boolean>;
  assertActive?: SafeTransactionOptions['assertActive'];
  beforeSend?: SafeTransactionOptions['beforeSend'];
  execute?: (options: SafeTransactionOptions) => Promise<SafeTransactionResult>;
}): Promise<StakeRewardsResult> {
  const { rpc, wallet, execute = executeSafeTransaction } = options;
  // Read immediately before building; a displayed position is never trusted for execution.
  const position = await readStakePosition(rpc, wallet);
  if (!position || position.claimable === 0n) return { status: 'nothing-to-claim' };
  const instruction = await buildClaim(position);
  // The payout is measured on the wallet's own Stake account: rewards accrued during the claim
  // raise lifetime_rewards, and a full claim leaves rewards at zero.
  let reviewed: bigint | null = null;
  const validateSimulation: SafeTransactionOptions['validateSimulation'] = simulation => {
    const account = simulation.snapshot?.accounts[0];
    if (!account) throw new VerificationError('Simulation did not return the stake account');
    const after = parseStakeAccount(account, wallet);
    if (after.balance !== position.balance || after.rewards !== 0n || after.lifetimeRewards < position.lifetimeRewards) {
      throw new VerificationError('Simulation changed the stake account unexpectedly');
    }
    const amount = position.rewards + after.lifetimeRewards - position.lifetimeRewards;
    if (amount === 0n) throw new VerificationError('Simulation shows no staking rewards to claim');
    if (reviewed !== null && amount < reviewed) throw new VerificationError('The simulated payout fell below the reviewed amount');
    reviewed ??= amount;
  };
  const describe = (review: TransactionReview): StakeRewardsReview => ({ ...review, action: 'claim-stake-rewards',
    amount: reviewed!, recipient: position.recipient, recipientExists: position.recipientExists });
  return execute({ rpc, wallet, signWithWallet: options.signWithWallet, instruction,
    simulationAccounts: [position.stakeAddress], validateSimulation,
    assertActive: options.assertActive, beforeSend: options.beforeSend,
    confirm: review => options.confirm(describe(review)) });
}
