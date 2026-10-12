import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage, getAddressDecoder,
  getAddressEncoder, getCompiledTransactionMessageDecoder, getProgramDerivedAddress, getTransactionEncoder, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, type Address, type Instruction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import type { ChainAccount } from '../src/core/accounts';
import { associatedTokenAddress, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/core/tokens';
import { executeSafeTransaction } from '../src/core/transaction';
import { DammAdapter } from '../src/protocols/meteora-damm/adapter';
import { decodeAccount, discriminator, PROGRAM, SIZES, type PoolState, type PositionState, type VestingState } from '../src/protocols/meteora-damm/codec';
import idl from '../src/protocols/meteora-damm/cp_amm.idl.json';
import { dammInstruction, eventAuthorityAddress, nftAccountAddress, positionAddress } from '../src/protocols/meteora-damm/instructions';
import { pendingFees, pendingRewards, removalAmounts, vestingRelease, vestingRemaining } from '../src/protocols/meteora-damm/math';
import metadata from '../src/protocols/meteora-damm/metadata.json';
import { estimatedReceipts, prepareWithdrawAll, withdrawalShape } from '../src/protocols/meteora-damm/withdraw';
import capture from './fixtures/meteora-damm/mainnet.json';
import { dammFixture, disc, LIQUIDITY, NFT_ACCOUNT, NFT_MINT, POOL, POOL_AT, POSITION_AT, REWARD_VAULTS, REWARDS, SOL, VESTINGS } from './fixtures/meteora-damm';
import { USDC } from './fixtures/meteora';
import { testWalletSigning } from './fixtures/signer';

const POOL_AUTHORITY = address('HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC');
const kinds = (plan: { actions: { kind: string; rewardIndex?: number; skipReward?: boolean }[] }) =>
  plan.actions.map(a => a.kind === 'reward' ? `reward:${a.rewardIndex}${a.skipReward ? ':skip' : ''}` : a.kind).join(',');
async function simulate(f: Awaited<ReturnType<typeof dammFixture>>, wallet = f.wallet) {
  const plan = await prepareWithdrawAll({ rpc: f.rpc, wallet, position: f.positionKey });
  const result = await f.rpc.simulateTransaction(await compile(wallet, plan.instructions), plan.simulationAccounts);
  plan.validateSimulation(result);
  return { plan, result };
}
async function compile(wallet: Address, instructions: readonly Instruction[]) {
  return compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }), m => setTransactionMessageFeePayer(wallet, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstructions(instructions, m)));
}

describe('pinned interface', () => {
  it('bundles the unmodified IDL with the recorded hash, program and discriminators', () => {
    const hash = createHash('sha256').update(readFileSync('src/protocols/meteora-damm/cp_amm.idl.json')).digest('hex');
    expect(hash).toBe(metadata.idlSha256);
    expect(idl.address).toBe(metadata.programId);
    expect(idl.metadata.version).toBe(metadata.idlVersion);
    for (const name of ['Pool', 'Position', 'Vesting'] as const) expect([...discriminator(name)]).toEqual([...disc('account:' + name)]);
    for (const name of ['remove_all_liquidity', 'claim_position_fee', 'claim_reward', 'close_position', 'refresh_vesting'])
      expect(idl.instructions.find(i => i.name === name)!.discriminator).toEqual([...disc('global:' + name)]);
  });
  it('derives the position PDA, event authority and the IDL pool authority', async () => {
    const derive = async (...seeds: Uint8Array[]) => (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds }))[0];
    const text = (value: string) => new TextEncoder().encode(value);
    expect(await derive(text('pool_authority'))).toBe(POOL_AUTHORITY);
    expect(await eventAuthorityAddress()).toBe(await derive(text('__event_authority')));
    expect(await positionAddress(NFT_MINT)).toBe(await derive(text('position'), new Uint8Array(getAddressEncoder().encode(NFT_MINT))));
  });
  it('builds exact instruction data and IDL account roles', async () => {
    const accounts = Object.fromEntries(['pool', 'position', 'token_a_account', 'token_b_account', 'token_a_vault', 'token_b_vault', 'token_a_mint',
      'token_b_mint', 'position_nft_account', 'signer', 'token_a_program', 'token_b_program', 'reward_vault', 'reward_mint', 'user_token_account',
      'token_program', 'position_nft_mint', 'rent_receiver', 'owner'].map((name, i) => [name, address(`1111111111111111111111111111111${'BCDEFGHJKLMNPQRSTUVW'[i]}`)]));
    const remove = await dammInstruction('remove', accounts);
    expect([...remove.data!]).toEqual([...disc('global:remove_all_liquidity'), ...new Uint8Array(16)]);
    expect(remove.accounts![0]).toEqual({ address: POOL_AUTHORITY, role: 0 });
    expect(remove.accounts!.map(a => a.role)).toEqual([0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0]);
    expect(remove.accounts!.at(-2)!.address).toBe(await eventAuthorityAddress());
    expect(remove.accounts!.at(-1)!.address).toBe(PROGRAM);
    const fees = await dammInstruction('fees', accounts);
    expect(fees.accounts!.map(a => a.role)).toEqual([0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0]);
    expect([...(await dammInstruction('reward', accounts, { rewardIndex: 1, skipReward: true })).data!]).toEqual([...disc('global:claim_reward'), 1, 1]);
    expect([...(await dammInstruction('reward', accounts, { rewardIndex: 0 })).data!].slice(8)).toEqual([0, 0]);
    await expect(dammInstruction('reward', accounts, { rewardIndex: 2 })).rejects.toThrow(/reward index/);
    const close = await dammInstruction('close', accounts);
    expect(close.accounts!.find(a => a.role === 2)!.address).toBe(accounts.owner);
    expect(close.accounts![7]!.address).toBe(TOKEN_2022_PROGRAM);
    const refresh = await dammInstruction('refresh', accounts, {}, VESTINGS);
    expect(refresh.accounts!.map(a => a.role)).toEqual([0, 1, 0, 0, 1, 1]);
    await expect(dammInstruction('fees', accounts, {}, VESTINGS)).rejects.toThrow(/vesting accounts/);
  });
});

describe('captured mainnet accounts', () => {
  const accounts = (c: typeof capture.captures[number]) => new Map<Address, ChainAccount | null>(c.keys.map((k, i) => {
    const a = c.accounts[i]; return [address(k), a ? { owner: address(a.owner), executable: a.executable, lamports: BigInt(a.lamports ?? 0), data: new Uint8Array(Buffer.from(a.data, 'base64')) } : null];
  }));
  it('covers the planned position states', () => {
    const covered = new Set(capture.captures.flatMap(c => c.categories));
    for (const category of ['unlocked', 'rewards', 'compounding', 'transfer-fee', 'permanent-lock', 'external-vesting-in-progress',
      'external-vesting-complete', 'inner-vesting-in-progress']) expect(covered).toContain(category);
  });
  for (const c of capture.captures) it(`decodes ${c.categories.join(' + ')} ${c.position}`, async () => {
    const map = accounts(c), position = decodeAccount<PositionState>('Position', map.get(address(c.position)));
    expect(await positionAddress(position.nft_mint)).toBe(c.position);
    expect(position.pool).toBe(c.pool);
    const raw = map.get(address(c.position))!.data, view = new DataView(raw.buffer, raw.byteOffset);
    // Independent byte offsets agree with the IDL-driven decoder.
    expect(position.unlocked_liquidity).toBe(view.getBigUint64(POSITION_AT.unlocked, true) | view.getBigUint64(POSITION_AT.unlocked + 8, true) << 64n);
    expect(position.permanent_locked_liquidity).toBe(view.getBigUint64(POSITION_AT.permanent, true) | view.getBigUint64(POSITION_AT.permanent + 8, true) << 64n);
    const pool = decodeAccount<PoolState>('Pool', map.get(address(c.pool))), poolRaw = map.get(address(c.pool))!.data;
    expect(pool.token_a_mint).toBe(getAddressDecoder().decode(poolRaw.subarray(POOL_AT.mintA, POOL_AT.mintA + 32)));
    expect(pool.token_b_vault).toBe(getAddressDecoder().decode(poolRaw.subarray(POOL_AT.vaultB, POOL_AT.vaultB + 32)));
    expect(pool.collect_fee_mode).toBe(poolRaw[POOL_AT.feeMode]);
    expect(pool.activation_point).toBe(new DataView(poolRaw.buffer, poolRaw.byteOffset).getBigUint64(POOL_AT.activationPoint, true));
    expect(c.categories.includes('compounding')).toBe(pool.collect_fee_mode === 2);
    expect(c.categories.includes('permanent-lock')).toBe(position.permanent_locked_liquidity > 0n);
    const vestings = c.keys.slice(2).map(k => map.get(address(k))).filter(a => a?.owner === PROGRAM && a.data.length === SIZES.Vesting)
      .map(a => decodeAccount<VestingState>('Vesting', a));
    for (const vesting of vestings) expect(vesting.position).toBe(c.position);
    if (vestings.length) expect(vestings.reduce((n, v) => n + vestingRemaining(v.inner_vesting), 0n))
      .toBe(position.vested_liquidity - vestingRemaining(position.inner_vesting));
    else expect(position.vested_liquidity).toBe(vestingRemaining(position.inner_vesting));
  });
  it('rejects wrong owners, discriminators and lengths', () => {
    const c = capture.captures[0]!, map = accounts(c), position = map.get(address(c.position))!;
    expect(() => decodeAccount('Position', { ...position, owner: TOKEN_PROGRAM })).toThrow(/owner/);
    expect(() => decodeAccount('Pool', position)).toThrow(/discriminator/);
    expect(() => decodeAccount('Position', { ...position, data: position.data.slice(0, 400) })).toThrow(/length/);
  });
});

describe('math', () => {
  const pool = (overrides: Partial<PoolState> = {}) => ({ sqrt_min_price: 1n << 63n, sqrt_max_price: 1n << 65n, sqrt_price: 3n << 63n,
    collect_fee_mode: 0, liquidity: 1n << 100n, token_a_amount: 1_000n, token_b_amount: 4_000n, ...overrides }) as PoolState;
  it('prices concentrated and compounding removals like the program, rounding down', () => {
    const liquidity = 123_456_789n << 64n, p = pool();
    expect(removalAmounts(p, liquidity)).toEqual({ a: liquidity * (p.sqrt_max_price - p.sqrt_price) / (p.sqrt_price * p.sqrt_max_price),
      b: liquidity * (p.sqrt_price - p.sqrt_min_price) >> 128n });
    expect(removalAmounts(p, liquidity)).toEqual({ a: 20576131n, b: 123456789n });
    expect(removalAmounts(pool({ sqrt_price: 1n << 65n }), liquidity).a).toBe(0n);
    expect(removalAmounts(pool({ sqrt_price: 1n << 63n }), liquidity).b).toBe(0n);
    expect(removalAmounts(pool({ collect_fee_mode: 2 }), 1n << 98n)).toEqual({ a: 250n, b: 1000n });
    expect(removalAmounts(pool({ collect_fee_mode: 2 }), 3n)).toEqual({ a: 0n, b: 0n });
  });
  it('accrues fees on total liquidity and rewards up to the reward end', () => {
    const bytes = (n: bigint) => Array.from({ length: 32 }, (_, i) => Number(n >> BigInt(8 * i) & 255n));
    const state = { unlocked_liquidity: 1n << 64n, vested_liquidity: 1n << 64n, permanent_locked_liquidity: 0n, fee_a_pending: 5n, fee_b_pending: 0n,
      fee_a_per_token_checkpoint: bytes(1n << 128n), fee_b_per_token_checkpoint: bytes(0n),
      reward_infos: [{ reward_per_token_checkpoint: bytes(0n), reward_pendings: 7n, total_claimed_rewards: 0n }, { reward_per_token_checkpoint: bytes(0n), reward_pendings: 0n, total_claimed_rewards: 0n }] } as unknown as PositionState;
    const p = { ...pool({ liquidity: 1n << 66n }), fee_a_per_liquidity: bytes(3n << 128n), fee_b_per_liquidity: bytes(1n << 127n),
      reward_infos: [{ initialized: 1, reward_duration_end: 150n, last_update_time: 100n, reward_rate: 2n << 64n, reward_per_token_stored: bytes(0n) },
        { initialized: 0, reward_duration_end: 0n, last_update_time: 0n, reward_rate: 0n, reward_per_token_stored: bytes(0n) }] } as unknown as PoolState;
    expect(pendingFees(p, state)).toEqual({ a: 5n + (2n << 65n), b: 1n << 64n });
    // 50 seconds (capped at the end) at 2 tokens/s, shared by 2^66 liquidity; the position holds 2^65 of it.
    expect(pendingRewards(p, state, 1_000n)).toEqual([7n + 50n, 0n]);
    expect(pendingRewards(p, state, 120n)).toEqual([7n + 20n, 0n]);
  });
  it('releases vesting by cliff and period', () => {
    const v = { cliff_point: 100n, period_frequency: 10n, cliff_unlock_liquidity: 50n, liquidity_per_period: 5n, total_released_liquidity: 50n, number_of_period: 4 };
    expect(vestingRelease(v, 99n)).toBe(0n);
    expect(vestingRelease(v, 125n)).toBe(10n);
    expect(vestingRelease(v, 10_000n)).toBe(20n);
    expect(vestingRemaining(v)).toBe(20n);
  });
});

describe('withdraw all', () => {
  it('discovers the NFT in its program account, an ATA or any other account, and ignores other NFTs', async () => {
    for (const [nftInAta, nftElsewhere] of [[false, false], [true, false], [false, true]]) {
      const f = await dammFixture({ nftInAta, nftElsewhere });
      f.rpc.accounts.set(address('1111111111111111111111111111111E'), { owner: TOKEN_2022_PROGRAM, executable: false, lamports: 1n,
        data: (await import('./fixtures/tokens')).extendedBytes((await import('./fixtures/meteora')).tokenBytes(SOL, f.wallet, 1n), 2, [[7, new Uint8Array()]]) });
      const status = await new DammAdapter().getStatus(f.rpc, f.wallet);
      expect(status).toHaveLength(1);
      expect(status[0]!.position!.nftAccount).toBe(nftInAta ? await associatedTokenAddress(f.wallet, NFT_MINT, TOKEN_2022_PROGRAM)
        : nftElsewhere ? NFT_ACCOUNT : await nftAccountAddress(NFT_MINT));
      expect(f.rpc.programQueries).toBe(0);
      // A fresh read finds the program and ATA accounts in its batch; any other account takes one mint-filtered lookup.
      f.rpc.tokenQueries = [];
      expect((await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey))!.nftAccount).toBe(status[0]!.position!.nftAccount);
      expect(f.rpc.tokenQueries).toEqual(nftElsewhere ? [{ mint: NFT_MINT }] : []);
    }
  });
  it('reports a position whose pool cannot be read as unavailable', async () => {
    const f = await dammFixture(); f.rpc.accounts.set(POOL, null);
    const [status] = await new DammAdapter().getStatus(f.rpc, f.wallet);
    expect(status!.position).toBeUndefined(); expect(status!.reason).toMatch(/Pool is missing/);
  });
  it('claims fees, removes everything and closes in one transaction with measured receipts', async () => {
    const f = await dammFixture({ feePending: [3n, 4n] });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove,close');
    expect(plan.closes).toBe(true);
    expect(plan.receipts.map(r => [r.mint, r.amount])).toEqual([[USDC, 103n], [SOL, 204n]]);
    expect(plan.ataRent).toBe(0n);
    expect(plan.rentRefund).toBe(3_730_560n + 2_074_080n + 3_841_920n);
    expect(plan.instructions[0]!.programAddress).toBe('ComputeBudget111111111111111111111111111111');
    expect(getTransactionEncoder().encode(await compile(f.wallet, plan.instructions)).length).toBeLessThanOrEqual(1100);
  });
  it('creates missing recipient accounts and measures their rent', async () => {
    const f = await dammFixture({ missingAta: true, rewards: 1, rewardPending: 9n });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove,reward:0,close');
    expect(plan.instructions.filter(i => i.programAddress === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')).toHaveLength(3);
    expect(plan.ataRent).toBe(3n * 2_039_280n);
    expect(plan.receipts.map(r => r.amount)).toEqual([100n, 200n, 9n]);
  });
  it('subtracts withheld transfer fees from receipts', async () => {
    const f = await dammFixture({ token2022: true, transferFee: true, epoch: 6n });
    const { plan } = await simulate(f);
    expect(plan.receipts[0]).toMatchObject({ mint: USDC, amount: 98n, grossAmount: 100n, transferFee: 2n });
    expect(estimatedReceipts(plan.position).length).toBe(2);
  });
  it('removes the unlocked part of a vesting position and keeps it open', async () => {
    const f = await dammFixture({ inner: { cliff: 900n, frequency: 100n, cliffUnlock: LIQUIDITY, perPeriod: LIQUIDITY, periods: 4, released: 0n } });
    const p = (await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey))!;
    expect(p.unlocked).toBe(3n * LIQUIDITY);
    expect(p.vested).toBe(3n * LIQUIDITY);
    expect(p.nextUnlock).toBe(1_100n);
    const { plan, result } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove');
    expect(plan.holds).toEqual(['vesting']);
    expect(plan.rentRefund).toBe(0n);
    expect(result.snapshot!.accounts.some(a => a === null)).toBe(false);
  });
  it('closes once inner vesting is complete, since removal refreshes it', async () => {
    const f = await dammFixture({ unlocked: 0n, inner: { cliff: 500n, cliffUnlock: LIQUIDITY } });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove,close');
  });
  it('refreshes matured separate vesting accounts and refunds the closed ones', async () => {
    const f = await dammFixture({ vestings: [{ cliff: 500n, cliffUnlock: LIQUIDITY }, { cliff: 600n, frequency: 100n, cliffUnlock: 0n, perPeriod: LIQUIDITY, periods: 2 }] });
    const { plan } = await simulate(f);
    expect(f.rpc.programQueries).toBe(1);
    expect(kinds(plan)).toBe('refresh,fees,remove,close');
    expect(plan.instructions.find(i => i.programAddress === PROGRAM)!.accounts!.slice(4).map(a => a.address)).toEqual(VESTINGS);
    expect(plan.rentRefund).toBe(3_730_560n + 2_074_080n + 3_841_920n + 2n * 2_171_520n);
  });
  it('keeps a position with vesting in progress open and blocks it when nothing is recoverable', async () => {
    const vesting = { cliff: 5_000n, cliffUnlock: LIQUIDITY };
    const open = await simulate(await dammFixture({ vestings: [vesting] }));
    expect(kinds(open.plan)).toBe('fees,remove'); expect(open.plan.holds).toEqual(['vesting']);
    const f = await dammFixture({ unlocked: 0n, vestings: [vesting] });
    const p = (await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey))!;
    expect(withdrawalShape(p).blocked).toMatch(/still vesting; more unlocks at 1970-01-01T01:23:20.000Z/);
    await expect(prepareWithdrawAll({ rpc: f.rpc, wallet: f.wallet, position: f.positionKey })).rejects.toThrow(/still vesting/);
  });
  it('recovers fees and rewards of a permanently locked position', async () => {
    const f = await dammFixture({ unlocked: 0n, permanent: LIQUIDITY, feePending: [5n, 0n], rewards: 2, rewardPending: 3n });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,reward:0,reward:1');
    expect(plan.holds).toEqual(['permanent']);
    expect(plan.receipts.map(r => r.amount)).toEqual([5n, 3n, 3n]);
    const empty = await dammFixture({ unlocked: 0n, permanent: LIQUIDITY });
    const p = (await new DammAdapter().readPosition(empty.rpc, empty.wallet, empty.positionKey))!;
    expect(withdrawalShape(p).blocked).toMatch(/permanently locked/);
  });
  it('forfeits a frozen reward vault with skip_reward so the position still closes', async () => {
    const f = await dammFixture({ rewards: 2, rewardPending: 4n, frozenRewardVault: true });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove,reward:0:skip,reward:1,close');
    expect(plan.forfeited.map(r => r.vault)).toEqual([REWARD_VAULTS[0]]);
    expect(plan.receipts.map(r => r.mint)).toEqual([USDC, SOL, REWARDS[1]]);
  });
  it('skips settled reward slots', async () => {
    const f = await dammFixture({ rewards: 1 });
    const { plan } = await simulate(f);
    expect(kinds(plan)).toBe('fees,remove,close');
  });
  it('blocks removal before activation and transfer-hook tokens', async () => {
    for (const [options, message] of [[{ activationPoint: 2_000n }, /activation point \(1970-01-01T00:33:20.000Z\)/], [{ token2022: true, hook: true }, /transfer hook/]] as const) {
      const f = await dammFixture(options);
      const p = (await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey))!;
      expect(withdrawalShape(p).blocked).toMatch(message);
      expect(withdrawalShape(p).actions).toEqual([]);
    }
  });
  it('leaves dust liquidity and a frozen NFT account open instead of failing the close', async () => {
    const dust = await simulate(await dammFixture({ unlocked: 1n, feePending: [1n, 0n] }));
    expect(kinds(dust.plan)).toBe('fees'); expect(dust.plan.holds).toEqual(['dust']);
    const frozen = await simulate(await dammFixture({ nftFrozen: true }));
    expect(kinds(frozen.plan)).toBe('fees,remove'); expect(frozen.plan.holds).toEqual(['nft']);
  });
  it('prices compounding pools from tracked reserves', async () => {
    const f = await dammFixture({ compounding: true });
    const p = (await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey))!;
    // A tenth of the pool's liquidity takes a tenth of each tracked reserve.
    expect(p.liquidity).toEqual({ a: 100_000n, b: 200_000n });
  });
  it('rejects a simulation that does not close the position or reduces a wallet balance', async () => {
    const f = await dammFixture();
    const plan = await prepareWithdrawAll({ rpc: f.rpc, wallet: f.wallet, position: f.positionKey });
    const result = await f.rpc.simulateTransaction(await compile(f.wallet, plan.instructions), plan.simulationAccounts);
    const index = plan.simulationAccounts.indexOf(f.positionKey);
    const open = { ...result, snapshot: { ...result.snapshot!, accounts: result.snapshot!.accounts.map((a, i) => i === index ? f.rpc.accounts.get(f.positionKey)! : a) } };
    expect(() => plan.validateSimulation(open)).toThrow(/did not close/);
    const ata = await associatedTokenAddress(f.wallet, USDC, TOKEN_PROGRAM), at = plan.simulationAccounts.indexOf(ata);
    const lower = { ...result, snapshot: { ...result.snapshot!, accounts: result.snapshot!.accounts.map((a, i) => {
      if (i !== at) return a; const data = a!.data.slice(); new DataView(data.buffer).setBigUint64(64, 1n, true); return { ...a!, data }; }) } };
    expect(() => plan.validateSimulation(lower)).toThrow(/reduced a wallet token balance/);
    expect(() => plan.validateSimulation({ ...result, error: { InstructionError: [2, { Custom: 6001 }] } })).toThrow(/simulation failed/);
  });
  it('requires the connected wallet to hold the NFT', async () => {
    const f = await dammFixture();
    await expect(new DammAdapter().readPosition(f.rpc, address('1111111111111111111111111111111F'), f.positionKey))
      .rejects.toThrow(/does not hold this position NFT/);
  });
  it('executes through the shared executor and lands a closed position', async () => {
    const f = await dammFixture({ rewards: 1, rewardPending: 2n });
    const plan = await prepareWithdrawAll({ rpc: f.rpc, wallet: f.wallet, position: f.positionKey });
    const result = await executeSafeTransaction({ rpc: f.rpc, wallet: f.wallet, signWithWallet: testWalletSigning(f.signer),
      instructions: plan.instructions, simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
      confirm: async () => true, sleep: async () => {} });
    expect(result.status).toBe('confirmed');
    expect(await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey)).toBeNull();
    const message = getCompiledTransactionMessageDecoder().decode(f.rpc.sent[0]!.messageBytes);
    if (message.version !== 'legacy') throw new Error('expected a legacy message');
    expect(message.instructions.filter(i => message.staticAccounts[i.programAddressIndex] === PROGRAM)).toHaveLength(4);
    expect(await new DammAdapter().getStatus(f.rpc, f.wallet)).toEqual([]);
  });
});
