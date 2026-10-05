import { afterEach, expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { RewardsLoader, type RewardsState } from '../src/mobile/rewards-loader';
import { VerificationError } from '../src/core/errors';
import type { RewardsSnapshot } from '../src/operations/rewards';

const wallet = address('11111111111111111111111111111111');
const snapshot: RewardsSnapshot = { wallet, minerAddress: wallet, miner: null, ore: null,
  claimableSol: 0n, availableActions: [], fees: {}, readAt: 1 };
afterEach(() => vi.useRealTimers());

it('discards a late response after changing wallet/RPC', async () => {
  let resolve!: (value: RewardsSnapshot) => void;
  const publish = vi.fn<(state: RewardsState) => void>();
  const loader = new RewardsLoader(publish, () => new Promise(done => { resolve = done; }));
  const pending = loader.refresh('http://localhost', wallet);
  loader.reset(); resolve(snapshot); await pending;
  expect(publish.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'idle']);
});
it('does not let an older refresh overwrite the latest response', async () => {
  let resolve!: (value: RewardsSnapshot) => void;
  const publish = vi.fn();
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValueOnce({ ...snapshot, readAt: 2 });
  const loader = new RewardsLoader(publish, read);
  const old = loader.refresh('http://old', wallet);
  await loader.refresh('http://new', wallet);
  resolve(snapshot); await old;
  expect(publish).toHaveBeenLastCalledWith({ status: 'ready', snapshot: { ...snapshot, readAt: 2 } });
});
it('times out and ignores a late success', async () => {
  vi.useFakeTimers();
  let resolve!: (value: RewardsSnapshot) => void;
  const publish = vi.fn();
  const loader = new RewardsLoader(publish, () => new Promise(done => { resolve = done; }), 100);
  const pending = loader.refresh('http://localhost', wallet);
  await vi.advanceTimersByTimeAsync(101); await pending;
  resolve(snapshot); await Promise.resolve();
  expect(publish.mock.lastCall?.[0].status).toBe('error');
});
it.each([new Error('https://private-token'), new VerificationError('secret account detail')])(
  'does not reveal raw RPC errors', async error => {
    const publish = vi.fn();
    const loader = new RewardsLoader(publish, async () => { throw error; });
    await loader.refresh('http://localhost', wallet);
    const result = publish.mock.lastCall?.[0];
    expect(result.status).toBe('error');
    expect(result.message).not.toContain('secret');
    expect(result.message).not.toContain('private-token');
    expect(result.message).toContain(error instanceof VerificationError ? 'unsupported' : 'connection');
  });
