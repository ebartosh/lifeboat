import { address, type Address } from '@solana/kit';
import { SolanaRpcClient } from '../core/rpc';
import { executeSafeTransaction, type SafeTransactionOptions, type TransactionReview } from '../core/transaction';
import { KaminoAdapter, type PositionStatus } from '../protocols/kamino/adapter';
import { prepareOperation } from '../protocols/kamino/operations';
import type { NativeSolEstimate } from '../protocols/kamino/native-sol';

// Pinned mainnet-beta genesis hash from Solana's ClusterType::MainnetBeta.
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export type KaminoAction = 'repay' | 'withdraw';
export type KaminoRequest = { action: KaminoAction; position: Address; token: string; amount: string; reserve?: string };
export type KaminoReview = TransactionReview & {
  action: KaminoAction; position: Address; reserve: Address; token: string;
  amount: bigint; decimals: number; recipient: Address; createsAta: boolean;
  nativeSol?: NativeSolEstimate;
};

export function kaminoOperationHint(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/mainnet-beta/i.test(message)) return 'Select a Solana mainnet-beta RPC for Kamino.';
  if (/amount|decimal|precision|u64/i.test(message) && !/simulat/i.test(message)) return 'Enter all or a positive amount within the selected token precision.';
  if (/insufficient SOL|wrapping/i.test(message)) return 'Insufficient SOL for repayment, rent and fees. Add funds or reduce the amount.';
  if (/insufficient.*ATA|missing source ATA/i.test(message)) return 'Insufficient tokens in the wallet ATA. Add funds to cover interest or reduce the amount.';
  if (/Scope.*stale|stale.*Scope/i.test(message)) return 'The Scope price is stale. Refresh the position later; debt repayment may still be available.';
  if (/maximum LTV/i.test(message)) return 'Repay part of the debt or reduce the withdrawal amount.';
  if (/liquidity|withdrawal cap/i.test(message)) return 'Reduce the withdrawal amount or wait for liquidity or the limit to recover.';
  if (/farm.*missing|farm initialization/i.test(message)) return 'The position requires a farm account, which the app does not create.';
  if (/unsupported|only vanilla|elevation|1232-byte/i.test(message)) return 'The position is outside the supported Kamino matrix; check the reserves and restrictions.';
  if (/blockhash|expired before signing/i.test(message)) return 'The blockhash has expired. Refresh the position and prepare the operation again.';
  return 'The operation was not sent. Refresh the position, check the RPC and balance, then prepare it again.';
}

async function assertMainnet(rpc: SolanaRpcClient) {
  if (await rpc.getGenesisHash() !== MAINNET_GENESIS) {
    throw new Error('Kamino is only available through a Solana mainnet-beta RPC');
  }
}

export async function readKaminoPositions(url: string, wallet: Address): Promise<PositionStatus[]> {
  const rpc = new SolanaRpcClient(url);
  await assertMainnet(rpc);
  return new KaminoAdapter().getStatus(rpc, wallet);
}

export async function executeKamino(url: string, request: KaminoRequest, input: {
  wallet: Address;
  getSigner?: SafeTransactionOptions['getSigner'];
  signWithWallet?: SafeTransactionOptions['signWithWallet'];
  confirm: (review: KaminoReview) => Promise<boolean>;
  assertActive?: SafeTransactionOptions['assertActive'];
  beforeSend?: SafeTransactionOptions['beforeSend'];
}) {
  const rpc = new SolanaRpcClient(url);
  await assertMainnet(rpc);
  input.assertActive?.();
  const plan = await prepareOperation({ ...request, adapter: new KaminoAdapter(), rpc,
    wallet: input.wallet, position: address(request.position) });
  if (!plan) throw new Error('The selected debt or collateral is missing; no transaction was created');
  input.assertActive?.();
  return executeSafeTransaction({
    ...input, rpc, instructions: plan.instructions, simulationAccounts: plan.simulationAccounts,
    additionalSigners: plan.additionalSigners,
    validateSimulation: plan.validateSimulation,
    ...(plan.beforeSimulation ? { beforeSimulation: plan.beforeSimulation } : {}),
    confirm: review => input.confirm({ ...review, action: request.action, position: request.position,
      reserve: plan.reserve, token: plan.token, amount: plan.estimate, decimals: plan.decimals,
      recipient: plan.recipient, createsAta: plan.createsAta,
      ...(plan.nativeSol ? { nativeSol: plan.nativeSol } : {}) }),
  });
}
