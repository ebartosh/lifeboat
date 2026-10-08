import type { Address, Instruction } from '@solana/kit';
import type { SimulationResult, TransactionRpc } from '../../core/rpc';
import { MeteoraAdapter, type MeteoraPosition, type MeteoraReader, type Token } from './adapter';
import { check, decodeAccount, decodePosition, isClosedAccount, TOKEN, type PoolState } from './codec';
import { binArrayIndex } from './math';
import { computeBudget, createAta, dlmmInstruction, type StepKind } from './instructions';
import { decodeTokenMint, tokenAccountRent, tokenAccountSize, transferAmounts } from '../../core/tokens';
import { sameWithdrawalMint, withdrawalTokenState } from './token-policy';
import { CLOCK, SYSVAR } from './codec';
export type MeteoraRpc = MeteoraReader & TransactionRpc & { getMinimumBalanceForRentExemption(size: number): Promise<bigint> };
export type WithdrawalStep = { id: string; kind: StepKind; lower: number; upper: number; rewardIndex?: number };
export type Receipt = Token & { amount: bigint; grossAmount: bigint; transferFee: bigint };
export type WithdrawPlan = {
  position: MeteoraPosition; step: WithdrawalStep; remainingSteps: number;
  instructions: Instruction[]; simulationAccounts: Address[]; ataRent: bigint; remainingAtaRent: bigint;
  rentRefund: bigint; receipts: Receipt[]; remainingReceipts: Receipt[];
  validateSimulation(result: SimulationResult): void;
};
export function withdrawalSteps(position: MeteoraPosition): WithdrawalStep[] {
  const steps: WithdrawalStep[] = [];
  for (const kind of ['remove','fees','reward'] as const) {
    const indices = kind === 'reward' ? [0,1] : [undefined];
    for (const rewardIndex of indices) {
      for (let lower = position.state.lower_bin_id; lower <= position.state.upper_bin_id; lower += 70) {
        const upper = Math.min(lower+69,position.state.upper_bin_id);
        const active = position.bins.filter(bin => bin.id >= lower && bin.id <= upper).some(bin => kind === 'remove' ? bin.share > 0n
          : kind === 'fees' ? bin.feeX > 0n || bin.feeY > 0n : bin.rewards[rewardIndex!]! > 0n);
        if (active) steps.push({ id:`${kind}:${lower}:${upper}${rewardIndex === undefined ? '' : ':'+rewardIndex}`,
          kind,lower,upper,...(rewardIndex === undefined ? {} : {rewardIndex}) });
      }
    }
  }
  steps.push({ id:'close',kind:'close',lower:0,upper:0 });
  return steps;
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
function stepTokens(position: MeteoraPosition, step: WithdrawalStep): Token[] {
  return step.kind === 'close' ? [] : step.kind === 'reward' ? [position.rewards[step.rewardIndex!]!] : position.tokens;
}
/** One fresh, conservative transaction. The caller re-plans after confirmation. */
export async function prepareWithdrawAll(input: { rpc: MeteoraRpc; wallet: Address; position: Address;
  adapter?: MeteoraAdapter; minSlot?: bigint }): Promise<WithdrawPlan | null> {
  const adapter = input.adapter ?? new MeteoraAdapter();
  const position = await adapter.readPosition(input.rpc,input.wallet,input.position,input.minSlot);
  if (!position) return null;
  const steps = withdrawalSteps(position), step = steps[0]!, tokens = stepTokens(position,step);
  const arrays: Address[] = [];
  if (step.kind !== 'close') for (let i = binArrayIndex(step.lower); i <= binArrayIndex(step.upper); i++) {
    const key = position.binArrays.get(i)!;
    check(position.accounts.get(key), 'required bin array is missing'); arrays.push(key);
  }
  const accountKeys: Record<string,Address> = {
    position:position.address,lb_pair:position.poolAddress,sender:input.wallet,rent_receiver:input.wallet,
    user_token_x:position.tokens[0]!.ata,user_token_y:position.tokens[1]!.ata,
    reserve_x:position.pool.reserve_x,reserve_y:position.pool.reserve_y,
    token_x_mint:position.tokens[0]!.mint,token_y_mint:position.tokens[1]!.mint,
    token_x_program:position.tokens[0]!.token.program,token_y_program:position.tokens[1]!.token.program,
    token_program_x:position.tokens[0]!.token.program,token_program_y:position.tokens[1]!.token.program,
    token_program:tokens[0]?.token.program ?? TOKEN,
    bin_array_bitmap_extension:position.bitmap,
  };
  if (step.kind === 'reward') {
    accountKeys.reward_vault = position.pool.reward_infos[step.rewardIndex!]!.vault;
    accountKeys.reward_mint = tokens[0]!.mint; accountKeys.user_token_account = tokens[0]!.ata;
  }
  if (step.kind === 'close') check(position.state.liquidity_shares.every(v => v === 0n)
    && position.state.fee_infos.every(f => f.fee_x_pending === 0n && f.fee_y_pending === 0n)
    && position.state.reward_infos.every(r => r.reward_pendings.every(v => v === 0n)), 'position cannot close until all liquidity, fees and rewards are cleared');
  const missing = [...new Map(tokens.filter(t => !position.accounts.get(t.ata)).map(t => [t.ata,t])).values()];
  const allMissing = [...new Map(steps.flatMap(s => stepTokens(position,s)).filter(t => !position.accounts.get(t.ata)).map(t => [t.ata,t])).values()];
  const rents = new Map<Address,bigint>(), rentBySize = new Map<number,bigint>();
  for (const token of allMissing) {
    const size = tokenAccountSize(token.token);
    let rent = rentBySize.get(size);
    if (rent === undefined) { rent = (await tokenAccountRent(input.rpc,token.token)).rent; rentBySize.set(size,rent); }
    rents.set(token.ata,rent);
  }
  const instructions = [computeBudget(),...missing.map(t => createAta(input.wallet,t.mint,t.ata,t.token.program)),
    await dlmmInstruction(step.kind,accountKeys,step.lower,step.upper,step.rewardIndex,arrays)];
  const vaults = step.kind === 'reward' ? [accountKeys.reward_vault!] : step.kind === 'close' ? [] : [position.pool.reserve_x,position.pool.reserve_y];
  const uniqueTokens = [...new Map(tokens.map(t => [t.mint,t])).values()];
  const simulationAccounts = [...new Set([position.address,position.poolAddress,...uniqueTokens.map(t => t.ata),...vaults,
    ...(step.kind === 'close' ? [] : [CLOCK,...uniqueTokens.map(t => t.mint)])])];
  const plan: WithdrawPlan = { position,step,remainingSteps:steps.length,instructions,simulationAccounts,
    ataRent:missing.reduce((n,t) => n+rents.get(t.ata)!,0n),remainingAtaRent:[...rents.values()].reduce((n,r) => n+r,0n),rentRefund:position.account.lamports ?? 0n,
    receipts:[],remainingReceipts:totalReceipts(position),validateSimulation(result) {
      check(result.error === null && (result.unitsConsumed === undefined || result.unitsConsumed <= 1_400_000n), 'simulation failed or exceeded compute budget');
      check(result.snapshot && result.snapshot.slot >= position.slot && result.snapshot.accounts.length === simulationAccounts.length, 'RPC must return fresh simulated accounts');
      const final = new Map(simulationAccounts.map((key,i) => [key,result.snapshot!.accounts[i]!]));
      const pool = decodeAccount<PoolState>('LbPair',final.get(position.poolAddress));
      check(pool.token_x_mint === position.pool.token_x_mint && pool.token_y_mint === position.pool.token_y_mint && pool.reserve_x === position.pool.reserve_x
        && pool.reserve_y === position.pool.reserve_y && pool.reward_infos.every((r,i) => r.mint === position.pool.reward_infos[i]?.mint && r.vault === position.pool.reward_infos[i]?.vault), 'simulated pool links mismatch');
      if (step.kind === 'close') check(isClosedAccount(final.get(position.address)), 'simulation did not close the position');
      else {
        const state = decodePosition(final.get(position.address));
        check(state.owner === input.wallet && state.lb_pair === position.poolAddress && state.lower_bin_id === position.state.lower_bin_id && state.upper_bin_id === position.state.upper_bin_id, 'simulated position links mismatch');
        for (let i = 0; i < state.liquidity_shares.length; i++) {
          const id = state.lower_bin_id+i, target = id >= step.lower && id <= step.upper;
          check(state.liquidity_shares[i] === (step.kind === 'remove' && target ? 0n : position.state.liquidity_shares[i]), 'simulation did not remove the exact selected liquidity range');
          if (target && step.kind === 'fees') check(state.fee_infos[i]!.fee_x_pending === 0n && state.fee_infos[i]!.fee_y_pending === 0n, 'simulation left unclaimed fees');
          if (target && step.kind === 'reward') check(state.reward_infos[i]!.reward_pendings[step.rewardIndex!] === 0n, 'simulation left unclaimed rewards');
        }
      }
      let epoch = position.epoch;
      if (step.kind !== 'close') {
        const clock = final.get(CLOCK);
        check(clock?.owner === SYSVAR && !clock.executable && clock.data.length === 40, 'invalid simulated Clock sysvar');
        epoch = new DataView(clock.data.buffer,clock.data.byteOffset,40).getBigUint64(16,true);
        check(epoch >= position.epoch, 'simulated epoch moved backwards');
      }
      // Pool vaults and mint supply move with other users' activity between the position read and a
      // later simulation, so receipts are measured on the wallet's own accounts (docs/meteora-operations.md).
      const receipts = new Map<Address,Receipt>();
      for (const vault of vaults) {
        const mint = vault === position.pool.reserve_x ? position.pool.token_x_mint : vault === position.pool.reserve_y ? position.pool.token_y_mint : tokens[0]!.mint;
        const token = uniqueTokens.find(t => t.mint === mint)!;
        const mintAfter = final.get(mint);
        check(mintAfter && !mintAfter.executable && sameWithdrawalMint(token.token,decodeTokenMint(mint,mintAfter)), 'simulation changed the mint configuration');
        withdrawalTokenState(final.get(vault),token.token,position.poolAddress);
        const recipientBefore = position.accounts.get(token.ata) ? withdrawalTokenState(position.accounts.get(token.ata),token.token,input.wallet) : null;
        const recipientAfter = withdrawalTokenState(final.get(token.ata),token.token,input.wallet);
        const net = recipientAfter.amount-(recipientBefore?.amount ?? 0n), withheld = recipientAfter.withheldAmount-(recipientBefore?.withheldAmount ?? 0n);
        check(net >= 0n && withheld >= 0n, 'simulation reduced the wallet token balance');
        const transfer = transferAmounts(net+withheld,token.token.transferFee,epoch);
        check(transfer.transferFee === withheld, 'simulated withheld transfer fee does not match the mint fee');
        receipts.set(mint,{...token,amount:transfer.netAmount,grossAmount:transfer.grossAmount,transferFee:transfer.transferFee});
      }
      plan.receipts = [...receipts.values()];
      plan.remainingReceipts = totalReceipts({...position,epoch});
    } };
  return plan;
}
