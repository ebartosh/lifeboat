import { blockhash, signature } from '@solana/kit';
import { expect, it } from 'vitest';
import { createPendingStore } from '../src/mobile/pending-store';
import { POSITION, USDC } from './fixtures/kamino';
import { createTestSigner } from './fixtures/signer';

it('restores a Kamino pending signature and blocks overwriting it', async () => {
  const data = new Map<string, string>();
  const store = createPendingStore({
    read: async name => data.get(name) ?? null,
    write: async (name, value) => { data.set(name, value); },
    remove: async name => { data.delete(name); },
  });
  const signer = await createTestSigner();
  const record = { version: 1 as const, action: 'kamino-repay' as const,
    position: POSITION, reserve: USDC, token: 'USDC', wallet: signer.address,
    rpcUrl: 'https://example.com/rpc', signature: signature('1'.repeat(64)),
    blockhash: blockhash('11111111111111111111111111111111'),
    lastValidBlockHeight: 100n, createdAt: Date.now() };
  await store.save(record);
  expect(await store.load()).toEqual(record);
  await expect(store.save(record)).rejects.toThrow(/already pending/);
  data.set('pending.json', JSON.stringify({ ...record, lastValidBlockHeight: '100', reserve: undefined }));
  await expect(store.load()).rejects.toThrow(/invalid/);
});
