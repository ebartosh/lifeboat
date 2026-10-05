import type { Address, Instruction } from '@solana/kit';
import type { SimulationResult, TransactionRpc } from '../../core/rpc';
import { MeteoraAdapter, type MeteoraPosition, type MeteoraReader, type Token } from './adapter';
import { check, decodeAccount, decodePosition, isClosedAccount, PROGRAM, TOKEN, tokenState, type PoolState } from './codec';
import { binArrayIndex } from './math';
import { computeBudget, createAta, dlmmInstruction, type StepKind } from './instructions';
export type MeteoraRpc = MeteoraReader & TransactionRpc & { getMinimumBalanceForRentExemption(size: number): Promise<bigint> };
export type WithdrawalStep = { id: string; kind: StepKind; lower: number; upper: number; rewardIndex?: number };
export type Receipt = Token & { amount: bigint };
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
export function totalReceipts(position: MeteoraPosition): Receipt[] {
  const receipts = new Map<Address,Receipt>();
  const add = (token: Token, amount: bigint) => {
    const previous = receipts.get(token.mint); receipts.set(token.mint,{...token,amount:(previous?.amount ?? 0n)+amount});
  };
  add(position.tokens[0]!,position.bins.reduce((n,b) => n+b.x+b.feeX,0n));
  add(position.tokens[1]!,position.bins.reduce((n,b) => n+b.y+b.feeY,0n));
  position.rewards.forEach((token,i) => { if (token) add(token,position.bins.reduce((n,b) => n+b.rewards[i]!,0n)); });
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
    token_x_program:PROGRAM,token_y_program:PROGRAM,token_program_x:PROGRAM,token_program_y:PROGRAM,token_program:PROGRAM,
    bin_array_bitmap_extension:position.bitmap,
  };
  // Only ordinary SPL Token is admitted by the adapter.
  for (const name of ['token_x_program','token_y_program','token_program_x','token_program_y','token_program']) accountKeys[name] = TOKEN;
  if (step.kind === 'reward') {
    accountKeys.reward_vault = position.pool.reward_infos[step.rewardIndex!]!.vault;
    accountKeys.reward_mint = tokens[0]!.mint; accountKeys.user_token_account = tokens[0]!.ata;
  }
  if (step.kind === 'close') check(position.state.liquidity_shares.every(v => v === 0n)
    && position.state.fee_infos.every(f => f.fee_x_pending === 0n && f.fee_y_pending === 0n)
    && position.state.reward_infos.every(r => r.reward_pendings.every(v => v === 0n)), 'position cannot close until all liquidity, fees and rewards are cleared');
  const missing = [...new Map(tokens.filter(t => !position.accounts.get(t.ata)).map(t => [t.ata,t])).values()];
  const allMissing = new Set(steps.flatMap(s => stepTokens(position,s)).filter(t => !position.accounts.get(t.ata)).map(t => t.ata));
  const rent = allMissing.size ? await input.rpc.getMinimumBalanceForRentExemption(165) : 0n;
  const instructions = [computeBudget(),...missing.map(t => createAta(input.wallet,t.mint,t.ata)),
    await dlmmInstruction(step.kind,accountKeys,step.lower,step.upper,step.rewardIndex,arrays)];
  const vaults = step.kind === 'reward' ? [accountKeys.reward_vault!] : step.kind === 'close' ? [] : [position.pool.reserve_x,position.pool.reserve_y];
  const uniqueTokens = [...new Map(tokens.map(t => [t.mint,t])).values()];
  const simulationAccounts = [...new Set([position.address,position.poolAddress,...uniqueTokens.map(t => t.ata),...vaults])];
  const plan: WithdrawPlan = { position,step,remainingSteps:steps.length,instructions,simulationAccounts,
    ataRent:rent*BigInt(missing.length),remainingAtaRent:rent*BigInt(allMissing.size),rentRefund:position.account.lamports ?? 0n,
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
      plan.receipts = uniqueTokens.map(token => {
        const before = position.accounts.get(token.ata) ? tokenState(position.accounts.get(token.ata),token.mint,input.wallet).amount : 0n;
        const after = tokenState(final.get(token.ata),token.mint,input.wallet).amount;
        check(after >= before, 'simulation reduced the recipient balance');
        return {...token,amount:after-before};
      });
      for (const vault of vaults) {
        const mint = vault === position.pool.reserve_x ? position.pool.token_x_mint : vault === position.pool.reserve_y ? position.pool.token_y_mint : tokens[0]!.mint;
        const before = tokenState(position.accounts.get(vault),mint,position.poolAddress).amount;
        const after = tokenState(final.get(vault),mint,position.poolAddress).amount;
        check(before >= after && before-after === plan.receipts.find(t => t.mint === mint)?.amount, 'simulated vault transfer does not match the recipient receipt');
      }
    } };
  return plan;
}
