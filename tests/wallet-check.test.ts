import { blockhash, createKeyPairSignerFromPrivateKeyBytes, signTransaction, type Transaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { checkWalletSignature, runWalletSignatureCheck, walletCheckFailure } from '../src/mobile/wallet-check';

const lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n };

describe('external wallet signature check', () => {
  it.each(['signing', 'validation'] as const)('records a %s failure without logging the wallet payload', async phase => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
    const capture = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await expect(runWalletSignatureCheck(signer.address, { getLatestBlockhash: async () => lifetime }, async transaction => {
        if (phase === 'signing') throw Object.assign(new Error('secret-token'), { code: -3 });
        return transaction; // The expected signature is still absent.
      })).rejects.toThrow();
      const trace = capture.mock.calls.flat().join('\n');
      expect(trace).toContain(`phase=${phase}`);
      if (phase === 'signing') expect(trace).toContain('reason=not-signed protocolCode=-3');
      expect(trace).not.toContain('secret-token');
      expect(trace).not.toContain('event=success');
    } finally { capture.mockRestore(); }
  });
  it('fetches a fresh blockhash, validates the memo and never submits or records a pending transaction', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
    const rpc = { getLatestBlockhash: vi.fn(async () => lifetime), sendTransaction: vi.fn() };
    await runWalletSignatureCheck(signer.address, rpc, transaction => signTransaction([signer.keyPair], transaction));
    expect(rpc.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it('does not request a signature after a blockhash failure', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
    const sign = vi.fn();
    await expect(runWalletSignatureCheck(signer.address,
      { getLatestBlockhash: async () => { throw new Error('RPC offline'); } }, sign)).rejects.toThrow('RPC offline');
    expect(sign).not.toHaveBeenCalled();
  });
  it('distinguishes refusal from cancellation without exposing native payloads', () => {
    const message = walletCheckFailure(Object.assign(new Error('auth_token=secret'), { code: -3 }));
    expect(message).toMatch(/declined to sign/);
    expect(message).toMatch(/does not establish that you cancelled/);
    expect(message).not.toContain('secret');
  });
  it('verifies the expected signer without sending', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
    let calls = 0;
    await checkWalletSignature(signer.address, lifetime, transaction => {
      calls++;
      return signTransaction([signer.keyPair], transaction);
    });
    expect(calls).toBe(1);
  });
  it('rejects a different account', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
    const other = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(4));
    await expect(checkWalletSignature(signer.address, lifetime, async transaction =>
      ({ ...transaction, signatures: { [other.address]: new Uint8Array(64) } } as Transaction)))
      .rejects.toThrow(/invalid/);
  });
});
