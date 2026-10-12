import type { Address, Instruction } from '@solana/kit';
import type { SimulationResult, TransactionRpc } from '../../core/rpc';
import { packTransactions } from '../../core/packing';
import { decodeTokenMint, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, tokenAccountRent, tokenAccountSize, transferAmounts } from '../../core/tokens';
import { OrcaAdapter, type OrcaPosition, type OrcaReader, type Reward, type Token } from './adapter';
import { check, CLOCK, decodeAccount, isClosedAccount, MEMO, SYSVAR, type PositionState, type WhirlpoolState } from './codec';
import { whirlpoolInstruction, type StepKind } from './instructions';
import { sameWithdrawalMint, withdrawalTokenState } from './token-policy';

export type OrcaRpc = OrcaReader & TransactionRpc & { getMinimumBalanceForRentExemption(size: number): Promise<bigint> };
/** One Whirlpool instruction. Liquidity, fees and each reward are position-wide. */
export type WithdrawalAction = { id: string; kind: StepKind; rewardIndex?: number };
/** One transaction: consecutive actions in execution order. */
export type WithdrawalStep = { id: string; actions: WithdrawalAction[] };
export type Receipt = Token & { amount: bigint; grossAmount: bigint; transferFee: bigint };
/** Why the close is not part of this plan: it follows a re-read, or waits for a reward vault. */
export type CloseHold = 'after-removal' | 'reward-vault';
export type WithdrawPlan = {
  position: OrcaPosition; step: WithdrawalStep; remainingSteps: number; closeHold: CloseHold | null;
  instructions: Instruction[]; simulationAccounts: Address[]; ataRent: bigint; remainingAtaRent: bigint;
  rentRefund: bigint; receipts: Receipt[]; remainingReceipts: Receipt[];
  validateSimulation(result: SimulationResult): void;
};
// Per-instruction estimates; docs/orca-validation.md records the measured unsigned mainnet simulations.
const COMPUTE: Record<StepKind, number> = { remove: 120_000, fees: 80_000, reward: 60_000, close: 50_000 };
export const actionId = (kind: StepKind, rewardIndex?: number) => kind === 'reward' ? `reward:${rewardIndex}` : kind;
export const stepId = (actions: readonly WithdrawalAction[]) => actions.map(a => a.id).join(',');
const action = (kind: StepKind, rewardIndex?: number): WithdrawalAction =>
  ({ id: actionId(kind, rewardIndex), kind, ...(rewardIndex === undefined ? {} : { rewardIndex }) });
/**
 * The program closes only an empty position, and collect_reward pays at most the reward vault balance.
 * With liquidity, owed rewards are known only when both tick arrays use the pinned format.
 */
export function closeHold(position: OrcaPosition): CloseHold | null {
  const held = position.state.liquidity > 0n;
  for (const reward of position.rewards) {
    if (!reward) continue;
    if (held && !position.ticksKnown) return 'after-removal';
    const owed = held ? position.owed.rewards[reward.index]! : position.state.rewardInfos[reward.index]!.amountOwed;
    if (owed > reward.vaultAmount) return 'reward-vault';
  }
  return null;
}
/**
 * Nothing is owed and the reward emits nothing: growth inside can then change only through emissions,
 * so the owed amount stays exactly zero and collecting it would transfer nothing.
 */
export function rewardSettled(position: OrcaPosition, reward: Reward): boolean {
  if (position.pool.rewardInfos[reward.index]!.emissionsPerSecondX64 !== 0n) return false;
  if (position.state.liquidity > 0n && !position.ticksKnown) return false;
  return position.owed.rewards[reward.index] === 0n;
}
/** Every instruction needed to empty and close the position, in execution order. */
export function withdrawalActions(position: OrcaPosition): WithdrawalAction[] {
  const s = position.state, held = s.liquidity > 0n, actions: WithdrawalAction[] = [];
  if (held) actions.push(action('remove'));
  if (held || s.feeOwedA > 0n || s.feeOwedB > 0n) actions.push(action('fees'));
  const hold = closeHold(position);
  for (const reward of position.rewards) {
    if (!reward || rewardSettled(position, reward)) continue;
    const owed = held || s.rewardInfos[reward.index]!.amountOwed > 0n;
    // While a vault cannot pay in full, an empty vault would only transfer zero.
    if (owed && (hold !== 'reward-vault' || reward.vaultAmount > 0n)) actions.push(action('reward', reward.index));
  }
  if (!hold) actions.push(action('close'));
  check(actions.length, 'A reward vault holds less than this position is owed. The position can close once the vault is refilled.');
  return actions;
}
export function totalReceipts(position: OrcaPosition): Receipt[] {
  const receipts = new Map<Address, Receipt>();
  const add = (token: Token, gross: bigint) => {
    // Each transfer rounds its own fee, so per-transfer amounts are converted separately.
    const transfer = transferAmounts(gross, token.token.transferFee, position.epoch), previous = receipts.get(token.mint);
    receipts.set(token.mint, { ...token, amount: (previous?.amount ?? 0n) + transfer.netAmount,
      grossAmount: (previous?.grossAmount ?? 0n) + gross, transferFee: (previous?.transferFee ?? 0n) + transfer.transferFee });
  };
  const [a, b] = position.tokens as [Token, Token];
  add(a, position.liquidity.a); add(b, position.liquidity.b); add(a, position.owed.feeA); add(b, position.owed.feeB);
  for (const reward of position.rewards) if (reward && !rewardSettled(position, reward)) {
    const owed = position.owed.rewards[reward.index]!;
    add(reward, owed < reward.vaultAmount ? owed : reward.vaultAmount);
  }
  return [...receipts.values()];
}
function actionTokens(position: OrcaPosition, item: WithdrawalAction): Token[] {
  return item.kind === 'close' ? [] : item.kind === 'reward' ? [position.rewards[item.rewardIndex!]!] : position.tokens;
}
function actionInstruction(position: OrcaPosition, wallet: Address, item: WithdrawalAction): Instruction {
  const [a, b] = position.tokens as [Token, Token];
  const common = { whirlpool: position.poolAddress, positionAuthority: wallet, position: position.address,
    positionTokenAccount: position.tokenAccount, memoProgram: MEMO };
  const pair = { tokenProgramA: a.token.program, tokenProgramB: b.token.program, tokenMintA: a.mint, tokenMintB: b.mint,
    tokenOwnerAccountA: a.ata, tokenOwnerAccountB: b.ata, tokenVaultA: position.pool.tokenVaultA, tokenVaultB: position.pool.tokenVaultB };
  if (item.kind === 'remove') return whirlpoolInstruction('decreaseLiquidityV2', { ...common, ...pair,
    tickArrayLower: position.tickArrays.lower, tickArrayUpper: position.tickArrays.upper }, { liquidity: position.state.liquidity });
  if (item.kind === 'fees') return whirlpoolInstruction('collectFeesV2', { ...common, ...pair });
  if (item.kind === 'reward') {
    const reward = position.rewards[item.rewardIndex!]!;
    return whirlpoolInstruction('collectRewardV2', { ...common, rewardOwnerAccount: reward.ata, rewardMint: reward.mint,
      rewardVault: reward.vault, rewardTokenProgram: reward.token.program }, { rewardIndex: reward.index });
  }
  const close = { positionAuthority: wallet, receiver: wallet, position: position.address, positionMint: position.state.positionMint,
    positionTokenAccount: position.tokenAccount };
  return position.positionMint.program === TOKEN_2022_PROGRAM
    ? whirlpoolInstruction('closePositionWithTokenExtensions', { ...close, token2022Program: TOKEN_2022_PROGRAM })
    : whirlpoolInstruction('closePosition', { ...close, tokenProgram: TOKEN_PROGRAM });
}
/** One fresh transaction. The caller re-plans after confirmation. */
export async function prepareWithdrawAll(input: { rpc: OrcaRpc; wallet: Address; position: Address;
  adapter?: OrcaAdapter; minSlot?: bigint }): Promise<WithdrawPlan | null> {
  const adapter = input.adapter ?? new OrcaAdapter();
  const position = await adapter.readPosition(input.rpc, input.wallet, input.position, input.minSlot);
  if (!position) return null;
  const actions = withdrawalActions(position), hold = closeHold(position);
  const steps = await packTransactions({ wallet: input.wallet, actions, instruction: item => actionInstruction(position, input.wallet, item),
    tokens: item => actionTokens(position, item), compute: item => COMPUTE[item.kind], exists: ata => !!position.accounts.get(ata),
    fail: message => { check(false, message); throw new Error(message); } });
  const { actions: first, instructions, tokens, missing } = steps[0]!;
  const step: WithdrawalStep = { id: stepId(first), actions: first };
  const rents = new Map<Address, bigint>(), rentBySize = new Map<number, bigint>();
  for (const token of steps.flatMap(s => s.missing)) {
    const size = tokenAccountSize(token.token);
    let rent = rentBySize.get(size);
    if (rent === undefined) { rent = (await tokenAccountRent(input.rpc, token.token)).rent; rentBySize.set(size, rent); }
    rents.set(token.ata, rent);
  }
  const closes = first.some(a => a.kind === 'close'), removes = first.some(a => a.kind === 'remove'), collectsFees = first.some(a => a.kind === 'fees');
  const vaults = [...new Set(first.flatMap(a => a.kind === 'reward' ? [position.rewards[a.rewardIndex!]!.vault]
    : a.kind === 'close' ? [] : [position.pool.tokenVaultA, position.pool.tokenVaultB]))];
  const closed = closes ? [position.tokenAccount, ...(position.positionMint.program === TOKEN_2022_PROGRAM ? [position.state.positionMint] : [])] : [];
  const simulationAccounts = [...new Set([position.address, position.poolAddress, CLOCK, ...tokens.map(t => t.ata), ...tokens.map(t => t.mint), ...vaults, ...closed])];
  const plan: WithdrawPlan = { position, step, closeHold: hold, remainingSteps: steps.length + (hold === 'after-removal' ? 1 : 0), instructions, simulationAccounts,
    ataRent: missing.reduce((n, t) => n + rents.get(t.ata)!, 0n), remainingAtaRent: [...rents.values()].reduce((n, r) => n + r, 0n),
    rentRefund: position.rentRefund, receipts: [], remainingReceipts: totalReceipts(position), validateSimulation(result) {
      check(result.error === null && (result.unitsConsumed === undefined || result.unitsConsumed <= 1_400_000n), 'simulation failed or exceeded compute budget');
      check(result.snapshot && result.snapshot.slot >= position.slot && result.snapshot.accounts.length === simulationAccounts.length, 'RPC must return fresh simulated accounts');
      const final = new Map(simulationAccounts.map((key, i) => [key, result.snapshot!.accounts[i]!]));
      const pool = decodeAccount<WhirlpoolState>('Whirlpool', final.get(position.poolAddress));
      check(pool.tokenMintA === position.pool.tokenMintA && pool.tokenMintB === position.pool.tokenMintB && pool.tokenVaultA === position.pool.tokenVaultA
        && pool.tokenVaultB === position.pool.tokenVaultB && pool.rewardInfos.every((r, i) => r.mint === position.pool.rewardInfos[i]!.mint
        && r.vault === position.pool.rewardInfos[i]!.vault), 'simulated pool links mismatch');
      if (closes) for (const key of [position.address, ...closed]) check(isClosedAccount(final.get(key)), 'simulation did not close the position and its NFT accounts');
      else {
        const state = decodeAccount<PositionState>('Position', final.get(position.address));
        check(state.whirlpool === position.poolAddress && state.positionMint === position.state.positionMint
          && state.tickLowerIndex === position.state.tickLowerIndex && state.tickUpperIndex === position.state.tickUpperIndex, 'simulated position links mismatch');
        check(!removes || state.liquidity === 0n, 'simulation did not remove all liquidity');
        check(!collectsFees || (state.feeOwedA === 0n && state.feeOwedB === 0n), 'simulation left unclaimed fees');
        // Reward payouts are capped by vault balances that other users' collections change, so they are measured, not required.
      }
      const clock = final.get(CLOCK);
      check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid simulated Clock sysvar');
      const epoch = new DataView(clock.data.buffer, clock.data.byteOffset, 40).getBigUint64(16, true);
      check(epoch >= position.epoch, 'simulated epoch moved backwards');
      for (const vault of vaults) {
        const mint = vault === position.pool.tokenVaultA ? position.pool.tokenMintA : vault === position.pool.tokenVaultB ? position.pool.tokenMintB
          : position.rewards.find(r => r?.vault === vault)!.mint;
        withdrawalTokenState(final.get(vault), tokens.find(t => t.mint === mint)!.token, position.poolAddress);
      }
      // Receipts are measured on the wallet's own accounts; pool vaults move with other users' activity.
      plan.receipts = tokens.map(token => {
        const mintAfter = final.get(token.mint);
        check(mintAfter && !mintAfter.executable && sameWithdrawalMint(token.token, decodeTokenMint(token.mint, mintAfter)), 'simulation changed the mint configuration');
        const recipientBefore = position.accounts.get(token.ata) ? withdrawalTokenState(position.accounts.get(token.ata), token.token, input.wallet) : null;
        const recipientAfter = withdrawalTokenState(final.get(token.ata), token.token, input.wallet);
        const net = recipientAfter.amount - (recipientBefore?.amount ?? 0n), withheld = recipientAfter.withheldAmount - (recipientBefore?.withheldAmount ?? 0n);
        check(net >= 0n && withheld >= 0n, 'simulation reduced the wallet token balance');
        return { ...token, amount: net, grossAmount: net + withheld, transferFee: withheld };
      });
      plan.remainingReceipts = totalReceipts({ ...position, epoch });
    } };
  return plan;
}
