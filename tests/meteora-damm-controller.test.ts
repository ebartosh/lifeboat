import { blockhash, signature } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ClaimController, type ClaimState } from '../src/mobile/claim-controller';
import { createPendingStore } from '../src/mobile/pending-store';
import type { LocalFile } from '../src/mobile/storage';
import { executeDammWithRpc, type DammReview } from '../src/operations/meteora-damm';
import { DammAdapter } from '../src/protocols/meteora-damm/adapter';
import { dammFixture } from './fixtures/meteora-damm';
import { testWalletSigning } from './fixtures/signer';

async function setup(options: Parameters<typeof dammFixture>[0] = {}) {
  const f = await dammFixture(options), files = new Map<LocalFile, string>();
  const store = createPendingStore({ read: async name => files.get(name) ?? null,
    write: async (name, text) => { files.set(name, text); }, remove: async name => { files.delete(name); } });
  const states: ClaimState[] = [];
  const deps = { store, execute: vi.fn(), status: vi.fn(async () => f.rpc.status), height: vi.fn(async () => f.rpc.height),
    damm: vi.fn((_url: string, position: Parameters<typeof executeDammWithRpc>[1], input: Parameters<typeof executeDammWithRpc>[2]) =>
      executeDammWithRpc(f.rpc, position, input)) };
  const controller = new ClaimController(deps, state => states.push(state));
  await controller.restore();
  const start = () => controller.start('https://example.com/rpc', f.wallet, 'meteora-damm-withdraw-all',
    { signWithWallet: testWalletSigning(f.signer) }, undefined, { position: f.positionKey });
  const review = async () => { await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('review')); return states.at(-1)!.review as DammReview; };
  return { ...f, files, store, states, deps, controller, start, review };
}

describe('Meteora DAMM v2 Withdraw all', () => {
  it('reviews one transaction, saves the signature before sending and confirms the closed position', async () => {
    const f = await setup({ rewards: 1, rewardPending: 5n });
    const operation = f.start(), review = await f.review();
    expect(review).toMatchObject({ action: 'meteora-damm-withdraw-all', position: f.positionKey, recipient: f.wallet, closes: true,
      holds: [], forfeited: [], ataRent: 0n, feeLamports: 5000n });
    expect(review.actions.map(a => a.kind)).toEqual(['fees', 'remove', 'reward', 'close']);
    expect(review.receipts.map(r => r.amount)).toEqual([100n, 200n, 5n]);
    expect(review.rentRefund).toBeGreaterThan(0n);
    const send = f.rpc.sendTransaction.bind(f.rpc);
    f.rpc.sendTransaction = async tx => {
      const pending = JSON.parse(f.files.get('pending.json')!);
      expect(pending).toMatchObject({ action: 'meteora-damm-withdraw-all', position: f.positionKey });
      return send(tx);
    };
    f.controller.answer(true); await operation;
    expect(f.rpc.sent).toHaveLength(1);
    expect(f.states.at(-1)?.phase).toBe('confirmed');
    expect(await f.store.load()).toBeNull();
    expect(await new DammAdapter().readPosition(f.rpc, f.wallet, f.positionKey)).toBeNull();
  });
  it('states the hold and the forfeited reward in the review', async () => {
    const f = await setup({ unlocked: 0n, permanent: 1n << 70n, feePending: [1n, 1n], rewards: 1, rewardPending: 3n, frozenRewardVault: true });
    const operation = f.start(), review = await f.review();
    expect(review.closes).toBe(false);
    expect(review.holdText).toMatch(/permanently locked/);
    expect(review.forfeited).toHaveLength(1);
    expect(review.actions.at(-1)).toEqual({ kind: 'reward', rewardIndex: 0, skipReward: true });
    f.controller.answer(false); await operation;
    expect(f.states.at(-1)?.phase).toBe('cancelled');
    expect(f.rpc.sent).toHaveLength(0);
  });
  it('explains a position that cannot be withdrawn and sends nothing', async () => {
    const f = await setup({ activationPoint: 5_000n });
    await f.start();
    expect(f.states.at(-1)).toMatchObject({ phase: 'error' });
    expect(f.states.at(-1)?.message).toMatch(/^This pool forbids liquidity removal until its activation point .* Nothing was sent\.$/);
    expect(f.rpc.simulations).toHaveLength(0);
  });
  it('restores an unknown result after a restart and only checks its status', async () => {
    const f = await setup();
    f.rpc.status = null;
    const operation = f.start(); await f.review(); f.controller.answer(true);
    f.rpc.sendTransaction = async () => { throw new Error('RPC disconnected'); };
    await operation;
    expect(f.states.at(-1)?.phase).toBe('unknown');
    const restarted = new ClaimController(f.deps, state => f.states.push(state));
    await restarted.restore();
    expect(f.states.at(-1)).toMatchObject({ phase: 'unknown', pending: { action: 'meteora-damm-withdraw-all', position: f.positionKey } });
    expect(restarted.locked).toBe(true);
    f.rpc.status = { confirmationStatus: 'confirmed', error: null, slot: 101n };
    await restarted.check();
    expect(f.states.at(-1)?.phase).toBe('confirmed');
    expect(restarted.locked).toBe(false);
  });
  it('rejects a pending DAMM record without its position', async () => {
    const f = await setup();
    const record = { version: 1, action: 'meteora-damm-withdraw-all', wallet: f.wallet, signature: signature('1'.repeat(64)),
      blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: '100', rpcUrl: 'https://example.com/rpc', createdAt: 1 };
    f.files.set('pending.json', JSON.stringify(record));
    await expect(f.store.load()).rejects.toThrow(/invalid/);
    f.files.set('pending.json', JSON.stringify({ ...record, position: f.positionKey }));
    expect(await f.store.load()).toMatchObject({ action: 'meteora-damm-withdraw-all', position: f.positionKey });
  });
});
