import { testWalletSigning } from './fixtures/signer';
import { address, blockhash, getSignatureFromTransaction, signTransaction, type Address, type Transaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ClaimController, type ClaimState } from '../src/mobile/claim-controller';
import { createPendingStore } from '../src/mobile/pending-store';
import type { LocalFile } from '../src/mobile/storage';
import type { SignatureStatus } from '../src/core/rpc';
import { claimOreRewards } from '../src/operations/ore';
import { createOreAdapter } from '../src/protocols/ore-bundle';
import { createMinerFixture } from './fixtures/miner';
import { createTreasuryFixture } from './fixtures/treasury';
import { createTestSigner } from './fixtures/signer';
import { signWithAdditions } from './fixtures/wallet-additions';

async function setup() {
  const signer = await createTestSigner();
  const adapter = createOreAdapter();
  const miner = await adapter.getMinerAddress(signer.address);
  const treasury = await adapter.getTreasuryAddress();
  const files = new Map<LocalFile, string>();
  const io = {
    read: vi.fn(async (name: LocalFile) => files.get(name) ?? null),
    write: vi.fn(async (name: LocalFile, text: string) => { files.set(name, text); }),
    remove: vi.fn(async (name: LocalFile) => { files.delete(name); }),
  };
  const store = createPendingStore(io);
  const rpc = {
    getAccount: vi.fn(async (key: Address) => key === adapter.programAddress
      ? { owner: adapter.programAddress, executable: true, data: new Uint8Array() }
      : key === miner ? { owner: adapter.programAddress, executable: false, data: createMinerFixture(signer.address) }
      : key === treasury ? { owner: adapter.programAddress, executable: false, data: createTreasuryFixture() } : null),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n })),
    simulateTransaction: vi.fn(async () => ({ error: null as unknown, logs: [] as string[] })),
    getTransactionFee: vi.fn(async () => 5000n),
    getBlockHeight: vi.fn(async () => 1n),
    sendTransaction: vi.fn(async (tx: Transaction) => {
      expect((await store.load())?.signature).toBe(getSignatureFromTransaction(tx));
      return getSignatureFromTransaction(tx);
    }),
    getSignatureStatus: vi.fn(async (): Promise<SignatureStatus | null> => ({ error: null, confirmationStatus: 'confirmed' })),
  };
  const states: ClaimState[] = [];
  const publish = (state: ClaimState) => { states.push(state); };
  const deps = { store,
    execute: vi.fn(async (_url, action, input) => claimOreRewards(action, { adapter, rpc, ...input })),
    status: vi.fn(async pending => rpc.getSignatureStatus()),
    height: vi.fn(async pending => rpc.getBlockHeight()),
  } satisfies ConstructorParameters<typeof ClaimController>[0];
  const controller = new ClaimController(deps, publish);
  await controller.restore();
  const signWithWallet = vi.fn(testWalletSigning(signer));
  const start = (action: 'claim-sol' | 'claim-ore' = 'claim-sol') =>
    controller.start('https://example.com/secret', signer.address, action, { signWithWallet });
  const review = async () => { await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('review')); };
  return { controller, deps, rpc, store, io, files, states, start, review, signWithWallet, signer };
}

describe('mobile claim lifecycle with real test-key signing', () => {
  it('resumes an external wallet handoff and sends only after returning to foreground', async () => {
    const f = await setup();
    const signWithWallet = vi.fn(async (transaction: Transaction) => {
      f.controller.setForeground(false);
      f.controller.setForeground(true);
      return signTransaction([f.signer.keyPair], transaction);
    });
    const operation = f.controller.start('https://example.com/secret', f.signer.address,
      'claim-sol', { signWithWallet });
    await f.review(); f.controller.answer(true); await operation;
    expect(signWithWallet).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('does not send if the external wallet never returns to foreground', async () => {
    const f = await setup();
    const operation = f.controller.start('https://example.com/secret', f.signer.address,
      'claim-sol', { signWithWallet: async transaction => {
        f.controller.setForeground(false);
        return signTransaction([f.signer.keyPair], transaction);
      } });
    await f.review(); f.controller.answer(true); await operation;
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('explains an account change before any send', async () => {
    const f = await setup();
    const operation = f.controller.start('https://example.com/secret', f.signer.address,
      'claim-ore', { signWithWallet: async () => { throw new Error('Signing account changed'); } });
    await f.review(); f.controller.answer(true); await operation;
    expect(f.states.at(-1)).toMatchObject({ phase: 'error' });
    expect(f.states.at(-1)?.message).toContain('The external wallet account has changed');
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['claim-sol', 'claim-ore'] as const)('persists before sending and confirms %s once', async action => {
    const f = await setup(); const operation = f.start(action); await f.review();
    expect(f.signWithWallet).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.review).toMatchObject({ action, feeLamports: 5000n });
    await f.start(action); // double tap cannot start another preparation
    f.controller.answer(true); f.controller.answer(true);
    await operation;
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(f.states.at(-1)?.phase).toBe('confirmed');
    expect(await f.store.load()).toBeNull();
    expect(f.controller.locked).toBe(false);
  });
  it('cancels without requesting a wallet signature or sending', async () => {
    const f = await setup(); const operation = f.start(); await f.review();
    f.controller.answer(false); await operation;
    expect(f.states.at(-1)?.phase).toBe('cancelled');
    expect(f.signWithWallet).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('backgrounding invalidates approval and a late approve cannot revive it', async () => {
    const f = await setup(); const operation = f.start(); await f.review();
    f.controller.setForeground(false); f.controller.setForeground(true); f.controller.answer(true);
    await operation;
    expect(f.states.at(-1)?.phase).toBe('cancelled');
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('staying in the background after wallet signing prevents send', async () => {
    const f = await setup();
    f.signWithWallet.mockImplementation(async transaction => { f.controller.setForeground(false); return testWalletSigning(f.signer)(transaction); });
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe('error');
  });
  it('explains expiry during the second fee review and clears the unsent signature', async () => {
    const f = await setup();
    const signWithWallet = vi.fn((tx: Transaction) => signWithAdditions(tx, f.signer));
    f.rpc.getTransactionFee.mockResolvedValueOnce(5000n).mockResolvedValue(29000n);
    const operation = f.controller.start('https://example.com/secret', f.signer.address, 'claim-sol', {signWithWallet});
    await f.review(); f.controller.answer(true);
    await vi.waitFor(() => expect(f.states.at(-1)?.review?.walletChanges).toBeDefined());
    f.rpc.getBlockHeight.mockResolvedValue(101n); f.controller.answer(true); await operation;
    expect(signWithWallet).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.io.write.mock.calls.some(([name]) => name === 'pending.json')).toBe(true);
    expect(await f.store.load()).toBeNull();
    expect(f.states.at(-1)).toMatchObject({phase:'error',message:expect.stringContaining('Transaction expired. Nothing was sent')});
    expect(f.states.at(-1)?.message).toContain('Check the details before approving');
    expect(f.controller.locked).toBe(false);
  });
  it('rejects expiry after confirmation without requesting a wallet signature', async () => {
    const f = await setup(); const operation = f.start(); await f.review();
    f.rpc.getBlockHeight.mockResolvedValue(101n); f.controller.answer(true); await operation;
    expect(f.signWithWallet).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe('error');
    expect(f.states.at(-1)?.message).toMatch(/Transaction expired\. Nothing was sent/);
    expect(f.states.at(-1)?.message).toContain('without long pauses');
    expect(f.controller.locked).toBe(false);
  });
  it('storage failure prevents send', async () => {
    const f = await setup(); f.io.write.mockRejectedValueOnce(new Error('disk full'));
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled(); expect(f.states.at(-1)?.phase).toBe('error');
  });
  it('backgrounding after persistence still prevents the network send', async () => {
    const f = await setup();
    f.io.write.mockImplementationOnce(async (name, contents) => {
      f.files.set(name, contents); f.controller.setForeground(false);
    });
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe('cancelled'); expect(await f.store.load()).toBeNull();
  });
  it('a changed RPC signature is not accepted as the transaction identity', async () => {
    const f = await setup();
    f.rpc.sendTransaction.mockResolvedValue(('1'.repeat(64)) as import('@solana/kit').Signature);
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.states.at(-1)?.phase).toBe('unknown');
    expect((await f.store.load())?.signature).not.toBe('1'.repeat(64));
    expect(f.rpc.getSignatureStatus).not.toHaveBeenCalled();
  });
  it('status connection failure preserves the journal and never exposes endpoint secrets', async () => {
    const f = await setup(); f.rpc.sendTransaction.mockRejectedValue(new Error('lost'));
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    f.rpc.getSignatureStatus.mockRejectedValue(new Error('https://example.com/secret'));
    await f.controller.check();
    expect(await f.store.load()).not.toBeNull(); expect(f.states.at(-1)?.phase).toBe('unknown');
    expect(f.states.at(-1)?.message).not.toContain('secret');
  });
  it('a write that persisted before failing is safely cleared when send was never attempted', async () => {
    const f = await setup(); f.io.write.mockImplementationOnce(async (name, contents) => {
      f.files.set(name, contents); throw new Error('late storage failure');
    });
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe('error'); expect(f.controller.locked).toBe(false);
  });
  it('lost response restores the local signature on restart and only checks status', async () => {
    const f = await setup(); f.rpc.sendTransaction.mockRejectedValue(new Error('lost response with secret'));
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    const pending = await f.store.load(); expect(pending).not.toBeNull();
    expect(f.states.at(-1)?.phase).toBe('unknown');
    const states: ClaimState[] = [];
    const restarted = new ClaimController(f.deps, state => states.push(state));
    await restarted.restore();
    await restarted.start('https://another-rpc', address('11111111111111111111111111111111'), 'claim-ore', { signWithWallet: f.signWithWallet });
    await restarted.check();
    expect(f.deps.status).toHaveBeenCalledWith(pending);
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.phase).toBe('confirmed'); expect(await f.store.load()).toBeNull();
  });
  it('restores an unfinished unstake and blocks another send until its signature is checked', async () => {
    const f = await setup();
    const pending = { version: 1 as const, action: 'unstake' as const,
      wallet: f.signer.address, signature: ('1'.repeat(64)) as import('@solana/kit').Signature,
      blockhash: blockhash('11111111111111111111111111111111'),
      lastValidBlockHeight: 100n, rpcUrl: 'https://example.com', createdAt: Date.now() };
    await f.store.save(pending);
    const states: ClaimState[] = [];
    const restarted = new ClaimController(f.deps, state => states.push(state));
    await restarted.restore();
    await restarted.start('https://example.com', f.signer.address, 'unstake', { signWithWallet: f.signWithWallet }, '1');
    expect(states.at(-1)?.phase).toBe('unknown');
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    await restarted.check();
    expect(f.deps.status).toHaveBeenCalledWith(pending);
    expect(states.at(-1)?.phase).toBe('confirmed');
  });
  it('keeps an expired missing status unknown instead of enabling a new send', async () => {
    const f = await setup(); f.rpc.sendTransaction.mockRejectedValue(new Error('lost'));
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    f.rpc.getSignatureStatus.mockResolvedValue(null); f.rpc.getBlockHeight.mockResolvedValue(101n);
    await f.controller.check(); await f.start();
    expect(f.states.at(-1)?.phase).toBe('unknown'); expect(f.controller.locked).toBe(true);
    expect(f.states.at(-1)?.message).toContain('Resubmission is blocked');
    expect(f.states.at(-1)?.message).not.toMatch(/Nothing was sent|without long pauses/);
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('distinguishes confirmed on-chain failure from unknown transport failure', async () => {
    const f = await setup(); f.rpc.getSignatureStatus.mockResolvedValue({ confirmationStatus: 'confirmed', error: { InstructionError: [0, 'error'] } });
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.states.at(-1)?.phase).toBe('failed'); expect(await f.store.load()).toBeNull();
  });
  it('does not clear the persisted signature if writing the final result fails', async () => {
    const f = await setup(); f.io.remove.mockRejectedValueOnce(new Error('disk error'));
    const operation = f.start(); await f.review(); f.controller.answer(true); await operation;
    expect(f.states.at(-1)?.phase).toBe('unknown'); expect(await f.store.load()).not.toBeNull();
    await f.controller.check(); expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('blocks startup with a corrupt journal', async () => {
    const f = await setup(); f.files.set('pending.json', '{secret');
    await f.controller.restore(); await f.start();
    expect(f.states.at(-1)?.phase).toBe('blocked'); expect(f.deps.execute).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.message).not.toContain('secret');
  });
  it('simulation failure never reaches review or signer', async () => {
    const f = await setup(); f.rpc.simulateTransaction.mockResolvedValue({ error: 'failure', logs: ['secret'] });
    await f.start(); expect(f.states.at(-1)?.phase).toBe('error');
    expect(f.signWithWallet).not.toHaveBeenCalled(); expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
