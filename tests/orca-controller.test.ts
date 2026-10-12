import { getSignatureFromTransaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { executeSafeTransaction } from '../src/core/transaction';
import { ClaimController, type ClaimState } from '../src/mobile/claim-controller';
import { createPendingStore } from '../src/mobile/pending-store';
import type { LocalFile } from '../src/mobile/storage';
import { executeOrcaWithRpc } from '../src/operations/orca';
import { OrcaAdapter } from '../src/protocols/orca/adapter';
import { orcaFixture, type OrcaFixtureOptions } from './fixtures/orca';
import { testWalletSigning } from './fixtures/signer';
// A reward with a tick array format outside the pinned interface closes in a second step.
const TWO_STEPS: OrcaFixtureOptions = { rewards: 1, dynamicTicks: true };
async function setup(options: OrcaFixtureOptions = {}) {
  const f = await orcaFixture(options), files = new Map<LocalFile, string>();
  const io = { read: vi.fn(async (n: LocalFile) => files.get(n) ?? null), write: vi.fn(async (n: LocalFile, v: string) => { files.set(n, v); }),
    remove: vi.fn(async (n: LocalFile) => { files.delete(n); }) };
  const store = createPendingStore(io), states: ClaimState[] = [];
  const executeStep = vi.fn(async (opts: Parameters<typeof executeSafeTransaction>[0]) => executeSafeTransaction({ ...opts, pollIntervalMs: 0, timeoutMs: 0 }));
  const deps = { store, execute: vi.fn(async (): Promise<never> => { throw new Error('ORE is not invoked in this fixture'); }),
    orca: vi.fn(async (_url: string, input: Parameters<typeof executeOrcaWithRpc>[1]) => executeOrcaWithRpc(f.rpc, input, executeStep)),
    orcaClosed: vi.fn(async (op, minSlot) => await new OrcaAdapter().readPosition(f.rpc, op.wallet, op.position, minSlot) === null),
    status: vi.fn(async () => f.rpc.getSignatureStatus()), height: vi.fn(async () => f.rpc.getBlockHeight()),
  } satisfies ConstructorParameters<typeof ClaimController>[0];
  let controller = new ClaimController(deps, s => states.push(s)); await controller.restore();
  const start = () => controller.startOrca('https://example.com', f.signer.address, f.positionKey, { signWithWallet: testWalletSigning(f.signer) });
  const review = async () => vi.waitFor(() => expect(states.at(-1)?.phase).toBe('review'));
  const approveAll = async (promise: Promise<void>) => {
    let done = false; void promise.finally(() => { done = true; });
    while (!done) { if (states.at(-1)?.phase === 'review') controller.answer(true); await new Promise(resolve => setTimeout(resolve, 1)); }
    await promise;
  };
  const restart = async () => { controller = new ClaimController(deps, s => states.push(s)); await controller.restore(); return controller; };
  return { ...f, files, io, store, states, deps, start, review, approveAll, restart, get controller() { return controller; } };
}
describe('durable Orca controller', () => {
  it('persists each signature before sending and each checkpoint before clearing pending', async () => {
    const f = await setup(TWO_STEPS);
    const send = f.rpc.sendTransaction.bind(f.rpc);
    f.rpc.sendTransaction = async tx => {
      const pending = await f.store.load(), op = await f.store.loadOrca!();
      expect(pending?.signature).toBe(getSignatureFromTransaction(tx)); expect(pending?.operationId).toBe(op?.id);
      expect(pending?.action).toBe('orca-withdraw-all'); expect(pending?.position).toBe(f.positionKey);
      return send(tx);
    };
    await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('confirmed'); expect(f.states.at(-1)?.operation?.completed).toHaveLength(2);
    expect(await f.store.load()).toBeNull(); expect(await f.store.loadOrca!()).toBeNull();
    expect(f.files.has('meteora-operation.json')).toBe(false); expect(f.controller.locked).toBe(false);
  });
  it('restores confirmed partial progress and prepares only the remaining step', async () => {
    const f = await setup(TWO_STEPS); const running = f.start(); await f.review(); f.controller.answer(true);
    await vi.waitFor(() => expect(f.states.at(-1)?.operation?.completed).toHaveLength(1));
    await f.review(); f.controller.answer(false); await running;
    expect(f.states.at(-1)?.phase).toBe('partial'); await f.restart(); expect(f.states.at(-1)?.phase).toBe('partial');
    expect(f.states.at(-1)?.operation).toMatchObject({ protocol: 'orca' });
    await f.approveAll(f.start()); expect(f.rpc.sent).toHaveLength(2); expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('checks an unknown signature after restart and resumes without repeating it', async () => {
    const f = await setup(TWO_STEPS); f.rpc.status = null; await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('unknown'); expect(f.rpc.sent).toHaveLength(1);
    await f.restart(); expect(f.controller.locked).toBe(true); await f.start(); expect(f.rpc.sent).toHaveLength(1);
    f.rpc.status = { confirmationStatus: 'confirmed', error: null, slot: 100n }; await f.controller.check();
    expect(f.states.at(-1)?.phase).toBe('partial'); expect((await f.store.loadOrca!())?.completed).toHaveLength(1);
    await f.approveAll(f.start()); expect(f.rpc.sent).toHaveLength(2); expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('announces completion only after the final state shows the position closed', async () => {
    const f = await setup(); f.rpc.status = null; await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('unknown'); f.rpc.status = { confirmationStatus: 'confirmed', error: null, slot: 100n };
    f.deps.orcaClosed.mockRejectedValueOnce(new Error('RPC unavailable'));
    await f.controller.check(); expect(f.states.at(-1)?.phase).toBe('partial'); expect(await f.store.load()).toBeNull();
    await f.restart(); await f.approveAll(f.start()); expect(f.states.at(-1)?.phase).toBe('confirmed'); expect(f.rpc.sent).toHaveLength(1);
  });
  it('keeps confirmed steps after an on-chain failure', async () => {
    const f = await setup(); f.rpc.status = { confirmationStatus: 'confirmed', error: { InstructionError: [0, 'Custom'] }, slot: 100n };
    f.rpc.sendTransaction = async tx => { f.rpc.sent.push(tx); return getSignatureFromTransaction(tx); };
    await f.approveAll(f.start()); expect(f.states.at(-1)?.phase).toBe('failed');
    expect(await f.store.load()).toBeNull(); expect((await f.store.loadOrca!())?.completed).toHaveLength(0);
  });
  it('ends an interrupted withdrawal and removes only its checkpoint', async () => {
    const f = await setup(TWO_STEPS); const running = f.start(); await f.review(); f.controller.answer(true);
    await vi.waitFor(() => expect(f.states.at(-1)?.operation?.completed).toHaveLength(1));
    await f.review(); f.controller.answer(false); await running;
    await f.controller.endWithdrawal(); expect(await f.store.loadOrca!()).toBeNull(); expect(f.states.at(-1)?.phase).toBe('idle');
  });
  it('blocks corrupted, conflicting or mismatched records rather than allowing another submission', async () => {
    const f = await setup(); f.files.set('orca-operation.json', '{}'); await f.restart();
    expect(f.states.at(-1)?.phase).toBe('blocked'); await f.start(); expect(f.rpc.sent).toHaveLength(0);
    const both = await setup(TWO_STEPS); const running = both.start(); await both.review(); both.controller.answer(false); await running;
    expect(both.files.has('orca-operation.json')).toBe(true);
    both.files.set('meteora-operation.json', JSON.stringify({ version: 1, id: 'm', wallet: both.signer.address, position: both.positionKey,
      rpcUrl: 'https://example.com', createdAt: 1, completed: [] }));
    await both.restart(); expect(both.states.at(-1)?.phase).toBe('blocked'); expect(both.controller.locked).toBe(true);
  });
  it('refuses to resume an Orca checkpoint as a Meteora withdrawal', async () => {
    const f = await setup(TWO_STEPS); const running = f.start(); await f.review(); f.controller.answer(true);
    await vi.waitFor(() => expect(f.states.at(-1)?.operation?.completed).toHaveLength(1));
    await f.review(); f.controller.answer(false); await running;
    await f.controller.startMeteora('https://example.com', f.signer.address, f.positionKey, { signWithWallet: testWalletSigning(f.signer) });
    expect(f.states.at(-1)?.message).toMatch(/Reconnect the saved wallet/); expect(f.rpc.sent).toHaveLength(1);
  });
});
