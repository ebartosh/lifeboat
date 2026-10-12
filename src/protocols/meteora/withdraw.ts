import type { Address, Instruction } from '@solana/kit';
import type { SimulationResult, TransactionRpc } from '../../core/rpc';
import { COMPUTE_BUDGET, PACKET_BUDGET, packTransactions } from '../../core/packing';
export { COMPUTE_BUDGET, PACKET_BUDGET };
import { MeteoraAdapter, type MeteoraPosition, type MeteoraReader, type Token } from './adapter';
import { check, decodeAccount, decodePosition, isClosedAccount, TOKEN, type PoolState } from './codec';
import { binArrayIndex, supportsLimitOrders } from './math';
import { dlmmInstruction, type StepKind } from './instructions';
import { decodeTokenMint, tokenAccountRent, tokenAccountSize, transferAmounts } from '../../core/tokens';
import { sameWithdrawalMint, withdrawalTokenState } from './token-policy';
import { CLOCK, SYSVAR } from './codec';
export type MeteoraRpc = MeteoraReader & TransactionRpc & { getMinimumBalanceForRentExemption(size: number): Promise<bigint> };
/** One DLMM instruction over at most 70 bins. */
export type WithdrawalAction = { id: string; kind: StepKind; lower: number; upper: number; rewardIndex?: number };
/** One transaction: consecutive actions in execution order. */
export type WithdrawalStep = { id: string; actions: WithdrawalAction[] };
export type Receipt = Token & { amount: bigint; grossAmount: bigint; transferFee: bigint };
export type WithdrawPlan = {
  position: MeteoraPosition; step: WithdrawalStep; remainingSteps: number;
  instructions: Instruction[]; simulationAccounts: Address[]; ataRent: bigint; remainingAtaRent: bigint;
  rentRefund: bigint; receipts: Receipt[]; remainingReceipts: Receipt[];
  validateSimulation(result: SimulationResult): void;
};
// Compute estimates scale with bins. Unsigned mainnet simulations on October 9, 2026 used up to 427k CU
// for remove and fee claim over one full 70-bin range (estimate 485k); reward claims are unmeasured.
function actionCompute(action: WithdrawalAction) {
  const bins = action.upper-action.lower+1;
  return action.kind === 'close' ? 30_000 : action.kind === 'remove' ? 20_000+5_000*bins
    : action.kind === 'fees' ? 10_000+1_500*bins : 10_000+2_000*bins;
}
export const stepId = (actions: readonly WithdrawalAction[]) => actions.map(a => a.id).join(',');
export function actionId(kind: StepKind, lower: number, upper: number, rewardIndex?: number) {
  return kind === 'close' ? 'close' : `${kind}:${lower}:${upper}${rewardIndex === undefined ? '' : ':'+rewardIndex}`;
}
/**
 * Every instruction needed to empty and close the position, in execution order. The close shares a
 * transaction with the last claims, so fees and rewards that accrue after the read must be claimed
 * too: fees for every range that holds liquidity, rewards while their emission period runs.
 */
export function withdrawalActions(position: MeteoraPosition): WithdrawalAction[] {
  const actions: WithdrawalAction[] = [];
  const rewards = supportsLimitOrders(position.pool) ? [] : position.rewards.flatMap((token,i) => token ? [i] : []);
  for (let lower = position.state.lower_bin_id; lower <= position.state.upper_bin_id; lower += 70) {
    const upper = Math.min(lower+69,position.state.upper_bin_id), bins = position.bins.filter(bin => bin.id >= lower && bin.id <= upper);
    const held = bins.some(bin => bin.share > 0n);
    const add = (kind: StepKind, active: boolean, rewardIndex?: number) => {
      if (active) actions.push({ id:actionId(kind,lower,upper,rewardIndex),kind,lower,upper,...(rewardIndex === undefined ? {} : {rewardIndex}) });
    };
    add('remove',held);
    add('fees',held || bins.some(bin => bin.feeX > 0n || bin.feeY > 0n));
    for (const i of rewards) add('reward',(held && position.pool.reward_infos[i]!.reward_duration_end > position.timestamp)
      || bins.some(bin => bin.rewards[i]! > 0n),i);
  }
  actions.push({ id:'close',kind:'close',lower:0,upper:0 });
  return actions;
}
export function totalReceipts(position: MeteoraPosition, kinds: readonly StepKind[] = ['remove','fees','reward']): Receipt[] {
  const receipts = new Map<Address,Receipt>();
  const add = (token: Token, gross: bigint) => {
    const transfer = transferAmounts(gross,token.token.transferFee,position.epoch), previous = receipts.get(token.mint);
    receipts.set(token.mint,{...token,amount:(previous?.amount ?? 0n)+transfer.netAmount,
      grossAmount:(previous?.grossAmount ?? 0n)+gross,transferFee:(previous?.transferFee ?? 0n)+transfer.transferFee});
  };
  for (const kind of kinds) {
    if (kind === 'close') continue;
    // Rounding and the maximum fee apply to each range instruction, not the sum of a position.
    for (let lower = position.state.lower_bin_id; lower <= position.state.upper_bin_id; lower += 70) {
      const bins = position.bins.filter(b => b.id >= lower && b.id <= lower+69);
      if (kind === 'reward') position.rewards.forEach((token,i) => { if (token) add(token,bins.reduce((n,b) => n+b.rewards[i]!,0n)); });
      else {
        add(position.tokens[0]!,bins.reduce((n,b) => n+(kind === 'remove' ? b.x : b.feeX),0n));
        add(position.tokens[1]!,bins.reduce((n,b) => n+(kind === 'remove' ? b.y : b.feeY),0n));
      }
    }
  }
  return [...receipts.values()];
}
function actionTokens(position: MeteoraPosition, action: WithdrawalAction): Token[] {
  return action.kind === 'close' ? [] : action.kind === 'reward' ? [position.rewards[action.rewardIndex!]!] : position.tokens;
}
async function actionInstruction(position: MeteoraPosition, wallet: Address, action: WithdrawalAction): Promise<Instruction> {
  const arrays: Address[] = [];
  if (action.kind !== 'close') for (let i = binArrayIndex(action.lower); i <= binArrayIndex(action.upper); i++) {
    const key = position.binArrays.get(i)!;
    check(position.accounts.get(key), 'required bin array is missing'); arrays.push(key);
  }
  const reward = action.kind === 'reward' ? position.rewards[action.rewardIndex!]! : undefined;
  const accountKeys: Record<string,Address> = {
    position:position.address,lb_pair:position.poolAddress,sender:wallet,rent_receiver:wallet,
    user_token_x:position.tokens[0]!.ata,user_token_y:position.tokens[1]!.ata,
    reserve_x:position.pool.reserve_x,reserve_y:position.pool.reserve_y,
    token_x_mint:position.tokens[0]!.mint,token_y_mint:position.tokens[1]!.mint,
    token_x_program:position.tokens[0]!.token.program,token_y_program:position.tokens[1]!.token.program,
    token_program_x:position.tokens[0]!.token.program,token_program_y:position.tokens[1]!.token.program,
    token_program:reward?.token.program ?? TOKEN,
    bin_array_bitmap_extension:position.bitmap,
  };
  if (reward) {
    accountKeys.reward_vault = position.pool.reward_infos[action.rewardIndex!]!.vault;
    accountKeys.reward_mint = reward.mint; accountKeys.user_token_account = reward.ata;
  }
  return dlmmInstruction(action.kind,accountKeys,action.lower,action.upper,action.rewardIndex,arrays);
}
type PackedStep = { step: WithdrawalStep; instructions: Instruction[]; tokens: Token[]; missing: Token[] };
/** Packs consecutive actions with the shared packer (src/core/packing.ts). */
async function packSteps(position: MeteoraPosition, wallet: Address, actions: readonly WithdrawalAction[]): Promise<PackedStep[]> {
  const packed = await packTransactions({ wallet, actions, instruction: action => actionInstruction(position,wallet,action),
    tokens: action => actionTokens(position,action), compute: actionCompute, exists: ata => !!position.accounts.get(ata),
    fail: message => { check(false,message); throw new Error(message); } });
  return packed.map(p => ({ step:{id:stepId(p.actions),actions:p.actions},instructions:p.instructions,tokens:p.tokens,missing:p.missing }));
}
/** One fresh transaction. The caller re-plans after confirmation. */
export async function prepareWithdrawAll(input: { rpc: MeteoraRpc; wallet: Address; position: Address;
  adapter?: MeteoraAdapter; minSlot?: bigint }): Promise<WithdrawPlan | null> {
  const adapter = input.adapter ?? new MeteoraAdapter();
  const position = await adapter.readPosition(input.rpc,input.wallet,input.position,input.minSlot);
  if (!position) return null;
  const actions = withdrawalActions(position);
  if (actions.length === 1) check(position.state.liquidity_shares.every(v => v === 0n)
    && position.state.fee_infos.every(f => f.fee_x_pending === 0n && f.fee_y_pending === 0n)
    && position.state.reward_infos.every(r => r.reward_pendings.every(v => v === 0n)), 'position cannot close until all liquidity, fees and rewards are cleared');
  const steps = await packSteps(position,input.wallet,actions), { step, instructions, tokens, missing } = steps[0]!;
  const allMissing = steps.flatMap(s => s.missing);
  const rents = new Map<Address,bigint>(), rentBySize = new Map<number,bigint>();
  for (const token of allMissing) {
    const size = tokenAccountSize(token.token);
    let rent = rentBySize.get(size);
    if (rent === undefined) { rent = (await tokenAccountRent(input.rpc,token.token)).rent; rentBySize.set(size,rent); }
    rents.set(token.ata,rent);
  }
  const closes = step.actions.some(a => a.kind === 'close');
  const vaults = [...new Set(step.actions.flatMap(a => a.kind === 'reward' ? [position.pool.reward_infos[a.rewardIndex!]!.vault]
    : a.kind === 'close' ? [] : [position.pool.reserve_x,position.pool.reserve_y]))];
  const simulationAccounts = [...new Set([position.address,position.poolAddress,CLOCK,...tokens.map(t => t.ata),...tokens.map(t => t.mint),...vaults])];
  const plan: WithdrawPlan = { position,step,remainingSteps:steps.length,instructions,simulationAccounts,
    ataRent:missing.reduce((n,t) => n+rents.get(t.ata)!,0n),remainingAtaRent:[...rents.values()].reduce((n,r) => n+r,0n),rentRefund:position.account.lamports ?? 0n,
    receipts:[],remainingReceipts:totalReceipts(position),validateSimulation(result) {
      check(result.error === null && (result.unitsConsumed === undefined || result.unitsConsumed <= 1_400_000n), 'simulation failed or exceeded compute budget');
      check(result.snapshot && result.snapshot.slot >= position.slot && result.snapshot.accounts.length === simulationAccounts.length, 'RPC must return fresh simulated accounts');
      const final = new Map(simulationAccounts.map((key,i) => [key,result.snapshot!.accounts[i]!]));
      const pool = decodeAccount<PoolState>('LbPair',final.get(position.poolAddress));
      check(pool.token_x_mint === position.pool.token_x_mint && pool.token_y_mint === position.pool.token_y_mint && pool.reserve_x === position.pool.reserve_x
        && pool.reserve_y === position.pool.reserve_y && pool.reward_infos.every((r,i) => r.mint === position.pool.reward_infos[i]?.mint && r.vault === position.pool.reward_infos[i]?.vault), 'simulated pool links mismatch');
      if (closes) check(isClosedAccount(final.get(position.address)), 'simulation did not close the position');
      else {
        const state = decodePosition(final.get(position.address));
        check(state.owner === input.wallet && state.lb_pair === position.poolAddress && state.lower_bin_id === position.state.lower_bin_id && state.upper_bin_id === position.state.upper_bin_id, 'simulated position links mismatch');
        const covers = (id: number, kind: StepKind, rewardIndex?: number) => step.actions.some(a => a.kind === kind && id >= a.lower && id <= a.upper && a.rewardIndex === rewardIndex);
        for (let i = 0; i < state.liquidity_shares.length; i++) {
          const id = state.lower_bin_id+i;
          check(state.liquidity_shares[i] === (covers(id,'remove') ? 0n : position.state.liquidity_shares[i]), 'simulation did not remove the exact selected liquidity range');
          if (covers(id,'fees')) check(state.fee_infos[i]!.fee_x_pending === 0n && state.fee_infos[i]!.fee_y_pending === 0n, 'simulation left unclaimed fees');
          for (const r of [0,1]) if (covers(id,'reward',r)) check(state.reward_infos[i]!.reward_pendings[r] === 0n, 'simulation left unclaimed rewards');
        }
      }
      const clock = final.get(CLOCK);
      check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid simulated Clock sysvar');
      const epoch = new DataView(clock.data.buffer,clock.data.byteOffset,40).getBigUint64(16,true);
      check(epoch >= position.epoch, 'simulated epoch moved backwards');
      for (const vault of vaults) {
        const mint = vault === position.pool.reserve_x ? position.pool.token_x_mint : vault === position.pool.reserve_y ? position.pool.token_y_mint
          : position.pool.reward_infos.find(r => r.vault === vault)!.mint;
        withdrawalTokenState(final.get(vault),tokens.find(t => t.mint === mint)!.token,position.poolAddress);
      }
      // Pool vaults and mint supply move with other users' activity between the position read and a
      // later simulation, so receipts are measured on the wallet's own accounts (docs/meteora-operations.md).
      // One transaction may pay a mint several times; each transfer rounds its own fee, so the withheld
      // increase is reported as measured rather than recomputed from the sum.
      plan.receipts = tokens.map(token => {
        const mintAfter = final.get(token.mint);
        check(mintAfter && !mintAfter.executable && sameWithdrawalMint(token.token,decodeTokenMint(token.mint,mintAfter)), 'simulation changed the mint configuration');
        const recipientBefore = position.accounts.get(token.ata) ? withdrawalTokenState(position.accounts.get(token.ata),token.token,input.wallet) : null;
        const recipientAfter = withdrawalTokenState(final.get(token.ata),token.token,input.wallet);
        const net = recipientAfter.amount-(recipientBefore?.amount ?? 0n), withheld = recipientAfter.withheldAmount-(recipientBefore?.withheldAmount ?? 0n);
        check(net >= 0n && withheld >= 0n, 'simulation reduced the wallet token balance');
        return {...token,amount:net,grossAmount:net+withheld,transferFee:withheld};
      });
      plan.remainingReceipts = totalReceipts({...position,epoch});
    } };
  return plan;
}
