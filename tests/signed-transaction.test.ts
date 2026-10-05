import { describe, expect, it } from 'vitest';
import { appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage,
  getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  signTransaction, type Transaction } from '@solana/kit';
import { getTransactionDecoder as getMwaTransactionDecoder } from '@solana/transactions';
import { checkSignedTransaction } from '../src/core/signed-transaction';
import { createTestSigner } from './fixtures/signer';

async function setup() {
  const signer = await createTestSigner();
  const unsigned = compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(signer.address, message),
    message => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n,
    }, message),
    message => appendTransactionMessageInstructions([], message)));
  const signed = await signTransaction([signer.keyPair], unsigned);
  return { signer, unsigned, signed };
}

describe('signed transaction validation', () => {
  it('accepts the wire decoder used by the MWA Kit wrapper', async () => {
    const f = await setup();
    const decoded = getMwaTransactionDecoder().decode(getTransactionEncoder().encode(f.signed));
    expect(await checkSignedTransaction(f.unsigned, decoded, [f.signer.address])).toBeNull();
  });
  it('distinguishes message mutation from cryptographically invalid signatures', async () => {
    const f = await setup();
    const messageBytes = Uint8Array.from(f.signed.messageBytes);
    messageBytes[messageBytes.length - 1] ^= 1;
    expect(await checkSignedTransaction(f.unsigned, { ...f.signed, messageBytes } as unknown as Transaction, [f.signer.address]))
      .toBe('message-bytes');
    const invalid = { ...f.signed, signatures: { [f.signer.address]: new Uint8Array(64).fill(1) } } as unknown as Transaction;
    expect(await checkSignedTransaction(f.unsigned, invalid, [f.signer.address])).toBe('signature-verify');
  });
  it('distinguishes malformed responses while preserving strict signer requirements', async () => {
    const f = await setup();
    const validate = (signed: Transaction | undefined) => checkSignedTransaction(f.unsigned, signed, [f.signer.address]);
    expect(await validate(undefined)).toBe('missing-transaction');
    expect(await validate({ ...f.signed, signatures: {} } as Transaction)).toBe('signer-set');
    expect(await validate({ ...f.signed, messageBytes: [] } as unknown as Transaction)).toBe('message-type');
    expect(await validate({ ...f.signed, messageBytes: f.signed.messageBytes.slice(1) } as unknown as Transaction)).toBe('message-length');
    expect(await validate({ ...f.signed, signatures: { [f.signer.address]: null } })).toBe('signature-type');
    expect(await validate({ ...f.signed, signatures: { [f.signer.address]: new Uint8Array(63) } } as unknown as Transaction))
      .toBe('signature-length');
  });
});
