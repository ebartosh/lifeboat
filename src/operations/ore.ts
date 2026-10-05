import type { Address } from '@solana/kit';
import type { AccountReader } from '../core/accounts';
import type { TransactionRpc } from '../core/rpc';
import { executeSafeTransaction, type SafeTransactionOptions, type SafeTransactionResult,
  type TransactionReview } from '../core/transaction';
import type { OreAdapter, OreClaimEstimate, OreStatus } from '../protocols/ore/adapter';

export type OreAction = 'claim-sol' | 'claim-ore';
export type OreReadOptions = { adapter: OreAdapter; rpc: AccountReader; wallet: Address };
export type OreRewards = OreStatus & {
  claimableSol: bigint;
  ore: OreClaimEstimate | null;
  availableActions: OreAction[];
};

/** A read-only snapshot; never asks for a signer. Amounts are base units, not floating point. */
export async function readOreRewards({ adapter, rpc, wallet }: OreReadOptions): Promise<OreRewards> {
  const status = await adapter.getStatus(rpc, wallet);
  const ore = status.miner ? await adapter.getOreClaimEstimate(rpc, status.miner) : null;
  return { ...status, claimableSol: status.miner?.rewardsSol ?? 0n, ore,
    availableActions: [
      ...(status.miner && status.miner.rewardsSol > 0n ? ['claim-sol' as const] : []),
      ...(ore && ore.amount > 0n ? ['claim-ore' as const] : []),
    ] };
}

export type OreClaimReview = TransactionReview & {
  action: OreAction;
  amount: bigint;
  decimals: 9 | 11;
  recipient: Address;
  ore: OreClaimEstimate | null;
};
export type OreClaimResult =
  | { status: 'nothing-to-claim'; reason: 'missing-miner' | 'zero-payout' }
  | (SafeTransactionResult & { action: OreAction; estimatedAmount: bigint });
export type OreClaimOptions = Omit<OreReadOptions, 'rpc'> & {
  rpc: AccountReader & TransactionRpc;
  getSigner?: SafeTransactionOptions['getSigner'];
  signWithWallet?: SafeTransactionOptions['signWithWallet'];
  confirm: (review: OreClaimReview) => Promise<boolean>;
  onSimulated?: (review: OreClaimReview) => void;
  execute?: (options: SafeTransactionOptions) => Promise<SafeTransactionResult>;
  assertActive?: SafeTransactionOptions['assertActive'];
  beforeSend?: SafeTransactionOptions['beforeSend'];
};

/** Verification and simulation always precede user approval and local signing. */
export async function claimOreRewards(action: OreAction, options: OreClaimOptions): Promise<OreClaimResult> {
  const { adapter, rpc, wallet, getSigner, signWithWallet, confirm, onSimulated, execute = executeSafeTransaction } = options;
  const status = await adapter.getStatus(rpc, wallet);
  if (!status.miner) return { status: 'nothing-to-claim', reason: 'missing-miner' };
  const estimate = action === 'claim-ore' ? await adapter.getOreClaimEstimate(rpc, status.miner) : null;
  const amount = estimate ? estimate.amount : status.miner.rewardsSol;
  if (amount === 0n) return { status: 'nothing-to-claim', reason: 'zero-payout' };
  const instruction = action === 'claim-sol'
    ? await adapter.buildClaimSolInstruction(wallet) : await adapter.buildClaimOreInstruction(wallet);
  const recipient = action === 'claim-sol' ? wallet : await adapter.getOreTokenAddress(wallet);
  const describe = (review: TransactionReview): OreClaimReview => ({ ...review, action, amount,
    decimals: action === 'claim-sol' ? 9 : 11, recipient, ore: estimate ? { ...estimate } : null });
  const result = await execute({ rpc, wallet, getSigner, signWithWallet, instruction,
    assertActive: options.assertActive, beforeSend: options.beforeSend,
    confirm: review => confirm(describe(review)), onSimulated: review => onSimulated?.(describe(review)) });
  return { ...result, action, estimatedAmount: amount };
}

export const claimSol = (options: OreClaimOptions) => claimOreRewards('claim-sol', options);
export const claimOre = (options: OreClaimOptions) => claimOreRewards('claim-ore', options);
