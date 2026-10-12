import type { Address, Instruction } from '@solana/kit';
import { computeBudget, PACKET_BUDGET } from '../../core/packing';
import type { SimulationResult, TransactionRpc } from '../../core/rpc';
import { createAssociatedTokenIdempotent, decodeTokenAccount, transferAmounts } from '../../core/tokens';
import { legacyTransactionSize } from '../../core/transaction';
import { DammAdapter, type DammPosition, type DammReader, type Reward, type Token } from './adapter';
import { check, decodeAccount, isClosedAccount, type PositionState } from './codec';
import { dammInstruction, type ActionKind } from './instructions';
import { totalLiquidity } from './math';

export type DammRpc = DammReader & TransactionRpc;
export type WithdrawalAction = { kind: ActionKind; rewardIndex?: number; skipReward?: boolean };
export type Receipt = Token & { amount: bigint; grossAmount: bigint; transferFee: bigint };
/** Why the position stays open after this withdrawal. */
export type Hold = 'vesting' | 'permanent' | 'dust' | 'nft';
export type WithdrawalShape = { actions: WithdrawalAction[]; closes: boolean; holds: Hold[];
  /** Rewards whose vault is frozen: claiming with skip_reward forfeits them so the rest can proceed. */
  forfeited: Reward[]; blocked: string | null };
export type WithdrawPlan = WithdrawalShape & {
  position: DammPosition; instructions: Instruction[]; simulationAccounts: Address[];
  /** Position, NFT account and NFT mint when closed, plus vesting accounts the refresh closes. */
  rentRefund: bigint; estimates: Receipt[];
  /** Measured by simulation. */
  receipts: Receipt[]; ataRent: bigint;
  validateSimulation(result: SimulationResult): void;
};
const pointName = (p: DammPosition, point: bigint) => p.pool.activation_type === 0 ? `slot ${point}` : new Date(Number(point) * 1000).toISOString();
export const unlockText = (p: DammPosition) => p.nextUnlock === null ? null : pointName(p, p.nextUnlock);

/**
 * Everything recoverable now, in the official SDK order. Removal takes only unlocked liquidity; the close
 * joins only when the program's is_empty() will hold after the preceding instructions.
 */
export function withdrawalShape(p: DammPosition): WithdrawalShape {
  const s = p.state, held = totalLiquidity(s) > 0n, actions: WithdrawalAction[] = [], holds: Hold[] = [], forfeited: Reward[] = [];
  if (p.vestings.some(v => v.release > 0n)) actions.push({ kind: 'refresh' });
  // Fees must be claimed before a close even when none are visible yet: a swap before landing adds some.
  if (held || s.fee_a_pending > 0n || s.fee_b_pending > 0n) actions.push({ kind: 'fees' });
  let removes = false;
  if (p.unlocked > 0n) {
    if (!p.activated) return { actions: [], closes: false, holds, forfeited, blocked:
      `This pool forbids liquidity removal until its activation point (${pointName(p, p.pool.activation_point)}).` };
    // remove_all_liquidity fails with AmountIsZero when the liquidity is worth less than one unit of either token.
    if (p.liquidity.a > 0n || p.liquidity.b > 0n) { actions.push({ kind: 'remove' }); removes = true; } else holds.push('dust');
  }
  let rewardsPay = false;
  for (const reward of p.rewards) {
    if (!reward || !rewardClaimable(p, reward.index)) continue;
    actions.push({ kind: 'reward', rewardIndex: reward.index, skipReward: reward.vaultFrozen });
    if (reward.vaultFrozen) forfeited.push(reward); else if (p.rewardAmounts[reward.index]! > 0n) rewardsPay = true;
  }
  if (p.vested > 0n) holds.push('vesting');
  if (p.permanent > 0n) holds.push('permanent');
  if (p.nftLocked) holds.push('nft');
  const closes = !holds.length && (p.unlocked === 0n || removes);
  if (closes) actions.push({ kind: 'close' });
  const transfers = [...(actions.some(a => a.kind === 'fees' || a.kind === 'remove') ? p.tokens : []),
    ...actions.flatMap(a => a.kind === 'reward' && !a.skipReward ? [p.rewards[a.rewardIndex!]!] : [])];
  // The program transfers without extra hook accounts, so a hook-enabled transfer always fails.
  const hooked = transfers.find(t => t.token.transferHookProgram);
  if (hooked) return { actions: [], closes: false, holds, forfeited, blocked: `${hooked.symbol} uses a transfer hook, which DAMM v2 withdrawals cannot pass.` };
  const useful = closes || removes || actions.some(a => a.kind === 'refresh') || p.fees.a > 0n || p.fees.b > 0n || rewardsPay || forfeited.length > 0;
  return { actions: useful ? actions : [], closes, holds, forfeited, blocked: useful ? null : holdText(p, holds) ?? 'Nothing can be withdrawn from this position now.' };
}
/** A slot that can still pay: something is pending or emissions continue for this position's liquidity. */
function rewardClaimable(p: DammPosition, index: number) {
  const reward = p.pool.reward_infos[index]!, user = p.state.reward_infos[index]!;
  if (user.reward_pendings > 0n || p.rewardAmounts[index]! > 0n) return true;
  if (totalLiquidity(p.state) === 0n) return false;
  return !(reward.reward_duration_end <= reward.last_update_time
    && user.reward_per_token_checkpoint.every((b, i) => b === reward.reward_per_token_stored[i]));
}
export function holdText(p: DammPosition, holds: readonly Hold[]): string | null {
  const parts = holds.map(hold => hold === 'vesting' ? `Some liquidity is still vesting${unlockText(p) ? `; more unlocks at ${unlockText(p)}` : ''}.`
    : hold === 'permanent' ? 'Some liquidity is permanently locked and can never be withdrawn; only its fees and rewards can be claimed.'
    : hold === 'dust' ? 'The unlocked liquidity is worth less than one unit of either token, so the program cannot remove it.'
    : p.nftLocked!);
  return parts.length ? parts.join(' ') : null;
}
function transferTokens(p: DammPosition, actions: readonly WithdrawalAction[]): Token[] {
  const tokens = new Map<Address, Token>();
  for (const a of actions) {
    const list = a.kind === 'fees' || a.kind === 'remove' ? p.tokens : a.kind === 'reward' ? [p.rewards[a.rewardIndex!]!] : [];
    for (const t of list) tokens.set(t.ata, t);
  }
  return [...tokens.values()];
}
/** Gross amounts from the loaded state; each transfer's fee is rounded separately, as the program transfers. */
export function estimatedReceipts(p: DammPosition, actions = withdrawalShape(p).actions): Receipt[] {
  const receipts = new Map<Address, Receipt>();
  const add = (token: Token, gross: bigint) => {
    if (gross === 0n) return;
    const transfer = transferAmounts(gross, token.token.transferFee, p.epoch), previous = receipts.get(token.mint);
    receipts.set(token.mint, { ...token, amount: (previous?.amount ?? 0n) + transfer.netAmount,
      grossAmount: (previous?.grossAmount ?? 0n) + gross, transferFee: (previous?.transferFee ?? 0n) + transfer.transferFee });
  };
  const has = (kind: ActionKind) => actions.some(a => a.kind === kind);
  if (has('fees')) { add(p.tokens[0], p.fees.a); add(p.tokens[1], p.fees.b); }
  if (has('remove')) { add(p.tokens[0], p.liquidity.a); add(p.tokens[1], p.liquidity.b); }
  for (const a of actions) if (a.kind === 'reward' && !a.skipReward) add(p.rewards[a.rewardIndex!]!, p.rewardAmounts[a.rewardIndex!]!);
  return [...receipts.values()];
}
async function actionInstruction(p: DammPosition, wallet: Address, a: WithdrawalAction): Promise<Instruction> {
  const [ta, tb] = p.tokens, base = { pool: p.poolAddress, position: p.address, position_nft_account: p.nftAccount };
  if (a.kind === 'refresh') return dammInstruction('refresh', { ...base, owner: wallet }, {}, p.vestings.filter(v => v.release > 0n).map(v => v.address));
  if (a.kind === 'fees' || a.kind === 'remove') return dammInstruction(a.kind, { ...base, signer: wallet,
    token_a_account: ta.ata, token_b_account: tb.ata, token_a_vault: p.pool.token_a_vault, token_b_vault: p.pool.token_b_vault,
    token_a_mint: ta.mint, token_b_mint: tb.mint, token_a_program: ta.token.program, token_b_program: tb.token.program });
  if (a.kind === 'reward') {
    const reward = p.rewards[a.rewardIndex!]!;
    return dammInstruction('reward', { ...base, signer: wallet, reward_vault: reward.vault, reward_mint: reward.mint,
      user_token_account: reward.ata, token_program: reward.token.program }, { rewardIndex: reward.index, skipReward: a.skipReward ?? false });
  }
  return dammInstruction('close', { ...base, position_nft_mint: p.state.nft_mint, rent_receiver: wallet, owner: wallet });
}
/** One transaction: Compute Budget, missing recipient accounts, then the DAMM v2 instructions. */
export async function prepareWithdrawAll(input: { rpc: DammRpc; wallet: Address; position: Address;
  adapter?: DammAdapter; minSlot?: bigint }): Promise<WithdrawPlan> {
  const adapter = input.adapter ?? new DammAdapter(), wallet = input.wallet;
  const p = await adapter.readPosition(input.rpc, wallet, input.position, input.minSlot);
  check(p, 'the position is already closed');
  const shape = withdrawalShape(p);
  if (shape.blocked) check(false, shape.blocked);
  const tokens = transferTokens(p, shape.actions), missing = tokens.filter(t => !t.before);
  const instructions = [computeBudget(), ...missing.map(t => createAssociatedTokenIdempotent(wallet, wallet, t.mint, t.ata, t.token.program)),
    ...await Promise.all(shape.actions.map(a => actionInstruction(p, wallet, a)))];
  check(legacyTransactionSize(wallet, instructions) <= PACKET_BUDGET, 'the withdrawal does not fit in one transaction');
  const closed = shape.closes ? [p.address, p.nftAccount, p.state.nft_mint] : [];
  const simulationAccounts = [...new Set([...tokens.map(t => t.ata), ...(shape.closes ? closed : [p.address])])];
  const refunded = p.vestings.filter(v => v.release > 0n && v.closes).reduce((n, v) => n + v.lamports, 0n);
  const plan: WithdrawPlan = { ...shape, position: p, instructions, simulationAccounts, rentRefund: (shape.closes ? p.closeRefund : 0n) + refunded,
    estimates: estimatedReceipts(p, shape.actions), receipts: [], ataRent: 0n, validateSimulation(result) {
      check(result.error === null, 'simulation failed');
      check(result.snapshot && result.snapshot.slot >= p.slot && result.snapshot.accounts.length === simulationAccounts.length, 'RPC must return fresh simulated accounts');
      const final = new Map(simulationAccounts.map((key, i) => [key, result.snapshot!.accounts[i]!]));
      if (shape.closes) for (const key of closed) check(isClosedAccount(final.get(key)), 'simulation did not close the position and its NFT');
      else {
        const state = decodeAccount<PositionState>('Position', final.get(p.address));
        const has = (kind: ActionKind) => shape.actions.some(a => a.kind === kind);
        check(!has('remove') || state.unlocked_liquidity === 0n, 'simulation did not remove the unlocked liquidity');
        check(!has('fees') || (state.fee_a_pending === 0n && state.fee_b_pending === 0n), 'simulation left unclaimed fees');
        check(shape.actions.every(a => a.kind !== 'reward' || state.reward_infos[a.rewardIndex!]!.reward_pendings === 0n), 'simulation left unclaimed rewards');
      }
      // Receipts are the wallet's own balance changes; pool vaults move with other users' activity.
      let ataRent = 0n;
      plan.receipts = tokens.map(token => {
        const after = decodeTokenAccount(final.get(token.ata));
        check(after.mint === token.mint && after.authority === wallet, 'simulated recipient account mismatch');
        const net = after.amount - (token.before?.amount ?? 0n), withheld = after.withheldAmount - (token.before?.withheldAmount ?? 0n);
        check(net >= 0n && withheld >= 0n, 'simulation reduced a wallet token balance');
        if (!token.before) ataRent += after.nativeReserve ?? final.get(token.ata)!.lamports ?? 0n;
        return { ...token, amount: net, grossAmount: net + withheld, transferFee: withheld };
      }).filter(r => r.grossAmount > 0n);
      plan.ataRent = ataRent;
    } };
  return plan;
}
