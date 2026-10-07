import { describe, expect, it, vi } from 'vitest';
import { createKeyPairSignerFromPrivateKeyBytes, type Transaction } from '@solana/kit';
import { ExternalWallet, type ExternalConnection, type WalletAdapter } from '../src/mobile/external-wallet';
import type { LocalFile } from '../src/mobile/storage';

async function setup() {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
  const connection: ExternalConnection = { version: 1, address: signer.address, authToken: 'test-token' };
  const files = new Map<string, string>([['wallet.json', '[1,2,3]']]);
  const io = {
    read: vi.fn(async (name: LocalFile) => files.get(name) ?? null),
    write: vi.fn(async (name: LocalFile, value: string) => { files.set(name, value); }),
    remove: vi.fn(async (name: LocalFile) => { files.delete(name); }),
  };
  const adapter: WalletAdapter = {
    connect: vi.fn(async () => connection),
    sign: vi.fn(async (connected, transaction: Transaction) => ({ transaction, connection: connected })),
    disconnect: vi.fn(async () => undefined),
  };
  return { signer, connection, files, io, adapter, wallet: new ExternalWallet(io, adapter) };
}

describe('external wallet authorization', () => {
  it('restores external authorization without accessing the legacy local key', async () => {
    const f = await setup();
    expect(await f.wallet.read()).toBeNull();
    await expect(f.wallet.connect()).resolves.toEqual(f.connection);
    expect(await new ExternalWallet(f.io, f.adapter).read()).toEqual(f.connection);
    expect(f.files.get('wallet.json')).toBe('[1,2,3]');
    expect(f.io.read).not.toHaveBeenCalledWith('wallet.json');
    expect(f.io.write).not.toHaveBeenCalledWith('wallet.json', expect.anything());
    expect(f.io.remove).not.toHaveBeenCalled();
    expect(await f.wallet.read()).toEqual(f.connection);
  });
  it('never reads or deletes a legacy key through signing, cancellation, disconnect or forget', async () => {
    const f = await setup();
    f.files.set('wallet.json', 'corrupt legacy key');
    f.files.set('wallet.json.tmp', 'interrupted legacy write');
    f.files.set('pending.json', 'existing pending record');
    await f.wallet.connect();
    await f.wallet.sign(f.signer.address, {} as Transaction);
    vi.mocked(f.adapter.connect).mockRejectedValueOnce(new Error('Connection cancelled'));
    await expect(f.wallet.connect()).rejects.toThrow('cancelled');
    expect(await f.wallet.read()).toEqual(f.connection);
    await f.wallet.disconnect();
    await f.wallet.forget();
    expect(await f.wallet.read()).toBeNull();
    expect(f.files.get('wallet.json')).toBe('corrupt legacy key');
    expect(f.files.get('wallet.json.tmp')).toBe('interrupted legacy write');
    expect(f.files.get('pending.json')).toBe('existing pending record');
    for (const name of ['wallet.json', 'wallet.json.tmp']) {
      expect(f.io.read).not.toHaveBeenCalledWith(name);
      expect(f.io.write).not.toHaveBeenCalledWith(name, expect.anything());
      expect(f.io.remove).not.toHaveBeenCalledWith(name);
    }
  });
  it('does not sign with a different or missing connected account', async () => {
    const f = await setup();
    await f.wallet.connect();
    const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(4));
    await expect(f.wallet.sign(other.address, {} as Transaction)).rejects.toThrow(/changed/);
    expect(f.adapter.sign).not.toHaveBeenCalled();
    await f.wallet.disconnect();
    expect(await f.wallet.read()).toBeNull();
  });
  it('does not report a successful connection if saving authorization fails', async () => {
    const f = await setup();
    f.io.write.mockRejectedValueOnce(new Error('disk error'));
    await expect(f.wallet.connect()).rejects.toThrow(/disk error/);
    expect(f.files.has('external-wallet.json')).toBe(false);
    expect(f.files.get('wallet.json')).toBe('[1,2,3]');
    expect(f.io.remove).not.toHaveBeenCalled();
  });
  it('persists a renewed authorization after signing for the same account', async () => {
    const f = await setup();
    await f.wallet.connect();
    const renewed = { ...f.connection, authToken: 'renewed-token' };
    vi.mocked(f.adapter.sign).mockResolvedValueOnce({ transaction: {} as Transaction, connection: renewed });
    await f.wallet.sign(f.signer.address, {} as Transaction);
    expect(await f.wallet.read()).toEqual(renewed);
  });
  it('does not pass a saved token to an explicit new connection and preserves it on cancellation', async () => {
    const f = await setup();
    await f.wallet.connect();
    vi.mocked(f.adapter.connect).mockClear();
    vi.mocked(f.adapter.connect).mockRejectedValueOnce(new Error('Connection cancelled'));
    await expect(f.wallet.connect()).rejects.toThrow(/cancelled/);
    expect(f.adapter.connect).toHaveBeenCalledExactlyOnceWith();
    expect(await f.wallet.read()).toEqual(f.connection);
  });
  it('retains the renewed token even when the following signature request fails', async () => {
    const f = await setup();
    await f.wallet.connect();
    const renewed = { ...f.connection, authToken: 'renewed-before-signing' };
    vi.mocked(f.adapter.sign).mockImplementationOnce(async (_connection, _transaction, onAuthorized) => {
      await onAuthorized!(renewed);
      throw new Error('Wallet did not sign');
    });
    await expect(f.wallet.sign(f.signer.address, {} as Transaction)).rejects.toThrow(/did not sign/);
    expect(await f.wallet.read()).toEqual(renewed);
    await f.wallet.sign(f.signer.address, {} as Transaction);
    expect(vi.mocked(f.adapter.sign).mock.calls[1][0]).toEqual(renewed);
  });
  it('does not persist renewal for another account', async () => {
    const f = await setup();
    await f.wallet.connect();
    const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(4));
    vi.mocked(f.adapter.sign).mockImplementationOnce(async (_connection, _transaction, onAuthorized) => {
      await onAuthorized!({ ...f.connection, address: other.address });
      throw new Error('Should not reach signing');
    });
    await expect(f.wallet.sign(f.signer.address, {} as Transaction)).rejects.toThrow(/Signing wallet changed/);
    expect(await f.wallet.read()).toEqual(f.connection);
  });
});
