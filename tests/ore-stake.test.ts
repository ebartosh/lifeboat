import { testWalletSigning } from './fixtures/signer';
import { AccountRole, address, blockhash, getSignatureFromTransaction, type Address, type Transaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildClaim, buildWithdraw, estimateClaimable, oreAta, parseOreAmount, readStakePosition, stakePda, STAKE_PROGRAM,
  ORE_MINT } from '../src/protocols/ore-stake';
import { unstakeOre } from '../src/operations/unstake';
import { claimStakeRewards } from '../src/operations/stake-rewards';
import type { ChainAccount } from '../src/core/accounts';
import type { SimulationResult } from '../src/core/rpc';
import { stakeFixture, tokenFixture, treasuryFixture, type StakeFields } from './fixtures/stake';
import { createTestSigner } from './fixtures/signer';

const TREASURY = address('F3ajpARUkbMnYsrbAmgnsjyp991DVbGYRzfaVXy1Dfvu');
const ONE = 1n << 48n; // I80F48 1.0

async function setup(balance = 123_456_789_012n, fields: Omit<StakeFields, 'balance'> = {}, treasuryFactor = 0n) {
  const signer = await createTestSigner();
  const wallet = signer.address;
  const stake = await stakePda(wallet);
  const tokens = await oreAta(stake);
  const recipient = await oreAta(wallet);
  const rpc = {
    getAccount: vi.fn(async (key: Address): Promise<ChainAccount | null> => key === STAKE_PROGRAM
      ? { owner: STAKE_PROGRAM, executable: true, data: new Uint8Array() }
      : key === stake ? { owner: STAKE_PROGRAM, executable: false, data: stakeFixture(wallet, balance, fields) }
      : key === TREASURY ? { owner: STAKE_PROGRAM, executable: false, data: treasuryFixture(treasuryFactor) }
      : key === tokens ? { owner: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), executable: false, data: tokenFixture(stake, balance) }
      : null),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n })),
    simulateTransaction: vi.fn(async (_tx: Transaction, _accounts?: readonly Address[]): Promise<SimulationResult> =>
      ({ error: null, logs: [] })),
    getTransactionFee: vi.fn(async () => 5000n),
    getBlockHeight: vi.fn(async () => 1n),
    sendTransaction: vi.fn(async (tx: Transaction) => getSignatureFromTransaction(tx)),
    getSignatureStatus: vi.fn(async () => ({ confirmationStatus: 'confirmed' as const, error: null as unknown })),
  };
  return { signer, wallet, stake, tokens, recipient, rpc };
}

describe('ore-stake Withdraw', () => {
  it('derives distinct stake PDA and ATA and serializes exact SDK account order', async () => {
    const f = await setup();
    expect(f.stake).toBe('DThSezC8QhsMbRijYXVeTvMa6bWmhW1bhVQeQxfu3y14');
    expect(f.tokens).toBe('DPFv9Eu9NqxbKVfBxJknKUDzLH2CpJvDKctMi2qLbFkX');
    const position = (await readStakePosition(f.rpc, f.wallet))!;
    const ix = await buildWithdraw(position, 100_000_000_001n);
    expect(ix.programAddress).toBe(STAKE_PROGRAM);
    expect(ix.data).toEqual(Uint8Array.from([11, 1, 232, 118, 72, 23, 0, 0, 0]));
    expect(ix.accounts?.map(a => a.role)).toEqual([
      AccountRole.WRITABLE_SIGNER, AccountRole.READONLY, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.READONLY, AccountRole.READONLY,
      AccountRole.READONLY, AccountRole.READONLY,
    ]);
    expect(ix.accounts?.map(a => a.address)).toEqual([f.wallet, ORE_MINT, f.recipient, f.stake, f.tokens,
      'F3ajpARUkbMnYsrbAmgnsjyp991DVbGYRzfaVXy1Dfvu',
      '8dPF5obsJxPsZeecAFqJbSWPEw9FkR1XGyRSJbry8B21',
      '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', STAKE_PROGRAM]);
  });
  it('parses ORE exactly and rejects zero, excess precision and u64 overflow', () => {
    expect(parseOreAmount('1.00000000001')).toBe(100_000_000_001n);
    expect(parseOreAmount('0.00000000001')).toBe(1n);
    for (const value of ['0', '0.00000000000', '1.000000000001', '-1', '1e2', '184467441'])
      expect(() => parseOreAmount(value)).toThrow();
  });
  it('checks fresh balance and never signs when insufficient', async () => {
    const f = await setup(1n);
    const signWithWallet = vi.fn(testWalletSigning(f.signer));
    await expect(unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', signWithWallet,
      confirm: async () => true })).rejects.toThrow('Insufficient');
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(signWithWallet).not.toHaveBeenCalled();
  });
  it('cancels after simulation without signer or send', async () => {
    const f = await setup(); const signWithWallet = vi.fn(testWalletSigning(f.signer));
    const result = await unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', signWithWallet,
      confirm: async review => {
        expect(review).toMatchObject({ amount: 100_000_000_000n, recipient: f.recipient,
          wallet: f.wallet, feeLamports: 5000n, recipientExists: false });
        return false;
      } });
    expect(result.status).toBe('cancelled');
    expect(signWithWallet).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('simulation error never reaches approval or send', async () => {
    const f = await setup(); const confirm = vi.fn(async () => true);
    f.rpc.simulateTransaction.mockResolvedValue({ error: 'failure', logs: [] });
    await expect(unstakeOre({ rpc: f.rpc, wallet: f.wallet, amount: '1', signWithWallet: testWalletSigning(f.signer), confirm })).rejects.toThrow('simulation failed');
    expect(confirm).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('ore-stake recorded mainnet accounts', () => {
  // Unmodified getMultipleAccounts body; expectations were decoded independently (see fixtures/rpc/README.md).
  const body = JSON.parse(readFileSync(new URL('./fixtures/rpc/ore-stake.json', import.meta.url), 'utf8'));
  const keys = [STAKE_PROGRAM, '12jrW29HvC2e1sWt9VdeiVHyJsf4pndihiUneurymfpt', TREASURY,
    'D9X3T2mmGctvLTSe3z9n6YvZ2G59mDi52j2ZtFokyvrP', 'syAaZaKRQwUwmTU1AHRZFuYV321kPgNZyRh8KotDVSv'];
  const accounts = new Map<string, ChainAccount>(keys.map((key, i) => {
    const value = body.result.value[i];
    return [key, { owner: address(value.owner), executable: value.executable,
      data: Uint8Array.from(Buffer.from(value.data[0], 'base64')) }];
  }));
  const reader = { getAccount: async (key: Address) => accounts.get(key) ?? null };
  const wallet = address('EfixMV4qZLx7DRdQf8xADMLe5bsKzRZfumf2SfAkZusH');

  it('decodes the 120-byte Stake and 32-byte Treasury with 8-byte discriminators', async () => {
    const position = (await readStakePosition(reader, wallet))!;
    expect(position).toMatchObject({ stakeAddress: keys[1], stakeTokenAddress: keys[3], recipient: keys[4],
      recipientExists: true, balance: 7_427_708_297_624n, available: 7_427_708_297_624n,
      rewardsFactor: 14_138_660_205_406n, rewards: 511_369n, lifetimeRewards: 355_700_594_876n,
      // 511369 + floor((14329134405381 − 14138660205406) × 7427708297624 / 2^48)
      claimable: 5_026_843_770n });
  });
  it('rejects the former 113-byte layout and a foreign authority', async () => {
    const f = await setup();
    const real = f.rpc.getAccount.getMockImplementation()!;
    f.rpc.getAccount.mockImplementation(async key => key === f.stake
      ? { owner: STAKE_PROGRAM, executable: false, data: stakeFixture(f.wallet).subarray(0, 113) } : real(key));
    await expect(readStakePosition(f.rpc, f.wallet)).rejects.toThrow('unexpected owner, discriminator, layout');
    f.rpc.getAccount.mockImplementation(async key => key === f.stake ? accounts.get(keys[1])! : real(key));
    await expect(readStakePosition(f.rpc, f.wallet)).rejects.toThrow('authority');
  });
});

describe('ore-stake Claim', () => {
  it('mirrors update_rewards: recorded rewards plus the floored factor delta', () => {
    // Upstream test_update_rewards_basic_accrual: factor 1000/100 on a balance of 100 accrues 1000.
    expect(estimateClaimable({ balance: 100n, rewardsFactor: 0n, rewards: 0n, lifetimeRewards: 0n }, 10n * ONE)).toBe(1000n);
    expect(estimateClaimable({ balance: 3n, rewardsFactor: ONE, rewards: 7n, lifetimeRewards: 7n }, ONE + ONE / 2n)).toBe(8n);
    expect(estimateClaimable({ balance: 0n, rewardsFactor: 0n, rewards: 5n, lifetimeRewards: 5n }, 10n * ONE)).toBe(5n);
    expect(estimateClaimable({ balance: 100n, rewardsFactor: 2n * ONE, rewards: 5n, lifetimeRewards: 5n }, ONE)).toBe(5n);
  });
  it('serializes Claim 12 with u64::MAX and the exact SDK account order', async () => {
    const f = await setup(10n, { rewards: 5n });
    const ix = await buildClaim((await readStakePosition(f.rpc, f.wallet))!);
    expect(ix.programAddress).toBe(STAKE_PROGRAM);
    expect(ix.data).toEqual(Uint8Array.from([12, 255, 255, 255, 255, 255, 255, 255, 255]));
    expect(ix.accounts?.map(a => a.role)).toEqual([
      AccountRole.WRITABLE_SIGNER, AccountRole.READONLY, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE,
      AccountRole.WRITABLE, AccountRole.READONLY, AccountRole.READONLY,
      AccountRole.READONLY, AccountRole.READONLY,
    ]);
    expect(ix.accounts?.map(a => a.address)).toEqual([f.wallet, ORE_MINT, f.recipient, f.stake, TREASURY,
      'BHnZihpszx6e9rmN2ZQkABBUhwQ1AFYUUpjY6yrVzz3h', '8dPF5obsJxPsZeecAFqJbSWPEw9FkR1XGyRSJbry8B21',
      '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', STAKE_PROGRAM]);
  });

  function simulated(f: Awaited<ReturnType<typeof setup>>, after: StakeFields & { balance: bigint }) {
    f.rpc.simulateTransaction.mockImplementation(async (_tx, accounts) => {
      expect(accounts).toEqual([f.stake]);
      return { error: null, logs: [], snapshot: { slot: 1n, accounts: [{ owner: STAKE_PROGRAM, executable: false,
        data: stakeFixture(f.wallet, after.balance, after) }] } };
    });
  }
  it('reviews the payout measured on the simulated Stake account and keeps the staked balance', async () => {
    // Recorded 40, accrued 60 before review, 2 more vested during simulation.
    const f = await setup(100n, { rewardsFactor: ONE, rewards: 40n, lifetimeRewards: 900n }, ONE + ONE * 6n / 10n);
    simulated(f, { balance: 100n, rewards: 0n, lifetimeRewards: 962n, rewardsFactor: ONE * 162n / 100n });
    const signWithWallet = vi.fn(testWalletSigning(f.signer));
    const result = await claimStakeRewards({ rpc: f.rpc, wallet: f.wallet, signWithWallet, confirm: async review => {
      expect(review).toMatchObject({ action: 'claim-stake-rewards', amount: 102n, recipient: f.recipient,
        recipientExists: false, feeLamports: 5000n });
      return false;
    } });
    expect(result.status).toBe('cancelled');
    expect(signWithWallet).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('signs and sends after approval', async () => {
    const f = await setup(100n, { rewards: 40n });
    simulated(f, { balance: 100n, rewards: 0n, lifetimeRewards: 40n });
    const result = await claimStakeRewards({ rpc: f.rpc, wallet: f.wallet, signWithWallet: testWalletSigning(f.signer),
      confirm: async () => true });
    expect(result.status).toBe('confirmed'); expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('returns nothing-to-claim without simulating when no rewards have accrued', async () => {
    const f = await setup(100n, { rewardsFactor: ONE }, ONE);
    expect(await claimStakeRewards({ rpc: f.rpc, wallet: f.wallet, signWithWallet: testWalletSigning(f.signer),
      confirm: async () => true })).toEqual({ status: 'nothing-to-claim' });
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });
  it.each([
    ['a missing account snapshot', null],
    ['a changed staked balance', { balance: 99n, rewards: 0n, lifetimeRewards: 40n }],
    ['rewards left unclaimed', { balance: 100n, rewards: 1n, lifetimeRewards: 40n }],
    ['a lifetime total that decreased', { balance: 100n, rewards: 0n, lifetimeRewards: 39n }],
  ] as const)('never reaches approval with %s', async (_name, after) => {
    const f = await setup(100n, { rewards: 40n, lifetimeRewards: 40n });
    if (after) simulated(f, after);
    const confirm = vi.fn(async () => true);
    await expect(claimStakeRewards({ rpc: f.rpc, wallet: f.wallet, signWithWallet: testWalletSigning(f.signer), confirm }))
      .rejects.toThrow(/stake account/);
    expect(confirm).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('blocks signing when the fresh-blockhash simulation pays less than reviewed', async () => {
    const f = await setup(100n, { rewards: 40n, lifetimeRewards: 40n });
    let call = 0;
    f.rpc.getLatestBlockhash.mockImplementation(async () => ({ blockhash: blockhash('11111111111111111111111111111111'),
      lastValidBlockHeight: 100n + BigInt(call++) }));
    let lifetime = 50n;
    f.rpc.simulateTransaction.mockImplementation(async () => ({ error: null, logs: [], snapshot: { slot: 1n, accounts: [{
      owner: STAKE_PROGRAM, executable: false, data: stakeFixture(f.wallet, 100n, { rewards: 0n, lifetimeRewards: lifetime-- }) }] } }));
    const signWithWallet = vi.fn(testWalletSigning(f.signer));
    const confirm = vi.fn(async (review: { amount: bigint }) => { expect(review.amount).toBe(50n); return true; });
    await expect(claimStakeRewards({ rpc: f.rpc, wallet: f.wallet, signWithWallet, confirm }))
      .rejects.toThrow('fell below the reviewed amount');
    expect(confirm).toHaveBeenCalledTimes(1); expect(signWithWallet).not.toHaveBeenCalled();
  });
});
