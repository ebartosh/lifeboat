import { testWalletSigning } from './fixtures/signer';
import { address, blockhash, getSignatureFromTransaction, type Transaction, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { claimSol, claimOre, readOreRewards } from '../src/operations/ore';
import type { ChainAccount } from '../src/core/accounts';
import { createOreAdapter } from '../src/protocols/ore-bundle';
import { createMinerFixture } from './fixtures/miner';
import { createTreasuryFixture } from './fixtures/treasury';
import { createTestSigner } from './fixtures/signer';
import { createOreClient } from '../src/operations/client';
import { readRewardsSnapshot } from '../src/operations/rewards';

async function setup(rewards: bigint | null = 123n) {
  const signer = await createTestSigner();
  const adapter = createOreAdapter();
  const accounts = new Map<Address, ChainAccount>([
    [adapter.programAddress, { owner: address('11111111111111111111111111111111'), executable: true, data: new Uint8Array() }],
    [await adapter.getTreasuryAddress(), { owner: adapter.programAddress, executable: false, data: createTreasuryFixture() }],
  ]);
  if (rewards !== null) accounts.set(await adapter.getMinerAddress(signer.address), {
    owner: adapter.programAddress, executable: false, data: createMinerFixture(signer.address, rewards),
  });
  const sequence: string[] = [];
  const rpc = {
    getAccount: async (key: Address) => accounts.get(key) ?? null,
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n })),
    simulateTransaction: vi.fn(async () => { sequence.push('simulate'); return { error: null, logs: ['ok'], unitsConsumed: 50n }; }),
    getTransactionFee: vi.fn(async () => 5000n),
    getBlockHeight: vi.fn(async () => 1n),
    sendTransaction: vi.fn(async (tx: Transaction) => { sequence.push('send'); return getSignatureFromTransaction(tx); }),
    getSignatureStatus: vi.fn(async () => ({ error: null, confirmationStatus: 'confirmed' as const })),
  };
  const signWithWallet = vi.fn(async transaction => { sequence.push('sign'); return testWalletSigning(signer)(transaction); });
  return { adapter, rpc, wallet: signer.address, signWithWallet, sequence };
}

describe('mobile ORE operations', () => {
  it('estimates fees with unsigned transactions and never accesses a signer or sends', async () => {
    const f = await setup();
    const result = await readRewardsSnapshot(f);
    expect(result.fees).toEqual({ 'claim-sol': 5000n, 'claim-ore': 5000n });
    for (const call of vi.mocked(f.rpc.getTransactionFee).mock.calls) {
      const transaction = (call as unknown as [import('@solana/kit').Transaction])[0];
      expect(Object.values(transaction.signatures)).toEqual([null]);
    }
    expect(f.signWithWallet).not.toHaveBeenCalled();
    expect(f.rpc.simulateTransaction).not.toHaveBeenCalled();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('preserves rewards when fee estimation is unavailable', async () => {
    const f = await setup();
    f.rpc.getTransactionFee.mockRejectedValue(new Error('fee unavailable'));
    const result = await readRewardsSnapshot(f);
    expect(result.claimableSol).toBe(123n);
    expect(result.fees).toEqual({ 'claim-sol': null, 'claim-ore': null });
  });
  it('does not fetch a blockhash or fees for a missing Miner', async () => {
    const f = await setup(null);
    expect((await readRewardsSnapshot(f)).fees).toEqual({});
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });
  it('requires an explicit HTTP(S) endpoint without exposing its contents in errors', () => {
    for (const endpoint of ['', 'secret', 'file:///secret', 'ws://localhost:1234']) {
      expect(() => createOreClient(endpoint)).toThrow('RPC URL must be a valid HTTP or HTTPS URL');
    }
    expect(() => createOreClient(' https://example.com/rpc ')).not.toThrow();
  });
  it('reads rewards using an address only, without private key access', async () => {
    const f = await setup();
    const result = await readOreRewards({ adapter: f.adapter, rpc: f.rpc, wallet: f.wallet });
    expect(result.claimableSol).toBe(123n);
    expect(result.availableActions).toEqual(['claim-sol', 'claim-ore']);
    expect(f.signWithWallet).not.toHaveBeenCalled();
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });
  it.each([null, 0n])('does not build SOL transactions for missing/empty Miner (%s)', async rewards => {
    const f = await setup(rewards);
    const build = vi.spyOn(f.adapter, 'buildClaimSolInstruction');
    const confirm = vi.fn(async () => true);
    expect((await claimSol({ ...f, confirm })).status).toBe('nothing-to-claim');
    expect(build).not.toHaveBeenCalled();
    expect(f.rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(f.signWithWallet).not.toHaveBeenCalled();
  });
  it('returns structured SOL review and requests a wallet signature only after approval', async () => {
    const f = await setup();
    const result = await claimSol({ ...f, confirm: async review => {
      f.sequence.push('confirm');
      expect(f.signWithWallet).not.toHaveBeenCalled();
      expect(review).toMatchObject({ action: 'claim-sol', amount: 123n, decimals: 9,
        feeLamports: 5000n, recipient: f.wallet, simulation: { error: null, unitsConsumed: 50n } });
      return true;
    } });
    expect(result).toMatchObject({ status: 'confirmed', estimatedAmount: 123n });
    expect(f.sequence).toEqual(['simulate', 'confirm', 'sign', 'send']);
  });
  it.each([claimSol, claimOre])('cancellation never requests a wallet signature or sends', async claim => {
    const f = await setup();
    expect((await claim({ ...f, confirm: async () => false })).status).toBe('cancelled');
    expect(f.signWithWallet).not.toHaveBeenCalled();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('failed simulation never requests a wallet signature, confirms or sends', async () => {
    const f = await setup();
    f.rpc.simulateTransaction.mockRejectedValue(new Error('offline'));
    const confirm = vi.fn(async () => true);
    await expect(claimSol({ ...f, confirm })).rejects.toThrow(/simulation RPC/);
    expect(confirm).not.toHaveBeenCalled();
    expect(f.signWithWallet).not.toHaveBeenCalled();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
