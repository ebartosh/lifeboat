import { describe, expect, it } from 'vitest';
import { createWalletIdentity } from '../src/mobile/wallet-identity';

describe('wallet application identity', () => {
  it('does not invent a website when no project URI is configured', () => {
    expect(createWalletIdentity()).toEqual({ name: 'Lifeboat' });
    expect(createWalletIdentity('  ')).toEqual({ name: 'Lifeboat' });
  });
  it('uses the explicitly configured HTTPS project page', () => {
    expect(createWalletIdentity(' https://lifeboat.example/app ')).toEqual({
      name: 'Lifeboat', uri: 'https://lifeboat.example/app',
    });
  });
  it.each(['http://lifeboat.example', 'https://localhost', 'https://127.0.0.1',
    'https://192.168.1.1', 'https://10.0.0.1', 'https://172.16.0.1',
    'https://user:secret@lifeboat.example', 'https://lifeboat.example?token=secret',
    'https://lifeboat.example#secret', 'not a URI'])('rejects unsuitable URLs without echoing their contents', value => {
    expect(() => createWalletIdentity(value)).toThrow(/public HTTPS/);
    try { createWalletIdentity(value); } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
