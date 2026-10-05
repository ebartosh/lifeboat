import { describe, expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { LocalSettings, type LocalFile } from '../src/mobile/storage';
import key from './fixtures/runtime-keypair.json';

function setup() {
  const data = new Map<LocalFile, string>();
  const files = {
    read: vi.fn(async (name: LocalFile) => data.get(name) ?? null),
    write: vi.fn(async (name: LocalFile, contents: string) => { data.set(name, contents); }),
    remove: vi.fn(async (name: LocalFile) => { data.delete(name); }),
  };
  return { data, files, settings: new LocalSettings(files) };
}

describe('local prototype settings', () => {
  it('imports, reloads, lazily obtains a signer and deletes a public test key', async () => {
    const f = setup();
    expect(await f.settings.readWallet()).toBeNull();
    const wallet = await f.settings.importWallet(JSON.stringify(key));
    const reloaded = new LocalSettings(f.files);
    expect(await reloaded.readWallet()).toBe(wallet);
    expect((await reloaded.getSigner(wallet)).address).toBe(wallet);
    await expect(reloaded.getSigner(address('11111111111111111111111111111111'))).rejects.toThrow('changed');
    await reloaded.deleteWallet();
    expect(await reloaded.readWallet()).toBeNull();
    await expect(reloaded.getSigner(wallet)).rejects.toThrow('missing');
  });
  it.each(['secret-invalid-json', '[]', JSON.stringify(Array(64).fill(256)),
    JSON.stringify([...key.slice(0, 32), ...Array(32).fill(0)])])('invalid replacement preserves the original key (%#)', async contents => {
    const f = setup();
    const wallet = await f.settings.importWallet(JSON.stringify(key));
    f.files.write.mockClear();
    await expect(f.settings.importWallet(contents)).rejects.toThrow();
    expect(f.files.write).not.toHaveBeenCalled();
    expect(await f.settings.readWallet()).toBe(wallet);
  });
  it('propagates storage failures instead of reporting a successful import/delete', async () => {
    const f = setup();
    f.files.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.settings.importWallet(JSON.stringify(key))).rejects.toThrow('disk full');
    expect(await f.settings.readWallet()).toBeNull();
    await f.settings.importWallet(JSON.stringify(key));
    f.files.remove.mockRejectedValueOnce(new Error('unavailable'));
    await expect(f.settings.deleteWallet()).rejects.toThrow();
    expect(await f.settings.readWallet()).not.toBeNull();
  });
  it('validates RPC without exposing its secret and persists across instances', async () => {
    const f = setup();
    expect(await f.settings.readRpc()).toBe('');
    await f.settings.saveRpc(' https://example.com/private-token ');
    expect(await new LocalSettings(f.files).readRpc()).toBe('https://example.com/private-token');
    await expect(f.settings.saveRpc('file:///private-token')).rejects.toThrow('HTTP or HTTPS');
    expect(await f.settings.readRpc()).toBe('https://example.com/private-token');
    await f.settings.deleteWallet();
    expect(await f.settings.readRpc()).toBe('https://example.com/private-token');
  });
  it('detects corrupted persisted data', async () => {
    const f = setup();
    f.data.set('wallet.json', 'bad'); f.data.set('rpc.txt', 'bad');
    await expect(f.settings.readWallet()).rejects.toThrow();
    await expect(f.settings.readRpc()).rejects.toThrow();
  });
});
