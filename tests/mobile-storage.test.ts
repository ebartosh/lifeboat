import { describe, expect, it, vi } from 'vitest';
import { LocalSettings, type LocalFile } from '../src/mobile/storage';

function setup() {
  const data = new Map<LocalFile, string>();
  const files = {
    read: vi.fn(async (name: LocalFile) => data.get(name) ?? null),
    write: vi.fn(async (name: LocalFile, contents: string) => { data.set(name, contents); }),
    remove: vi.fn(async (name: LocalFile) => { data.delete(name); }),
  };
  return { data, files, settings: new LocalSettings(files) };
}

describe('RPC settings', () => {
  it('validates RPC without exposing its secret and persists across instances', async () => {
    const f = setup();
    expect(await f.settings.readRpc()).toBe('');
    await f.settings.saveRpc(' https://example.com/private-token ');
    expect(await new LocalSettings(f.files).readRpc()).toBe('https://example.com/private-token');
    await expect(f.settings.saveRpc('file:///private-token')).rejects.toThrow('HTTP or HTTPS');
    expect(await f.settings.readRpc()).toBe('https://example.com/private-token');
  });
  it('detects corrupted persisted data', async () => {
    const f = setup();
    f.data.set('rpc.txt', 'bad');
    await expect(f.settings.readRpc()).rejects.toThrow();
  });
});
