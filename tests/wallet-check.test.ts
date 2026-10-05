import { blockhash, createKeyPairSignerFromPrivateKeyBytes, signTransaction, type Transaction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { checkWalletSignature } from '../src/mobile/wallet-check';

const lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n };

describe('external wallet signature check', () => {
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
