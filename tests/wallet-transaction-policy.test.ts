import { AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction,
  createTransactionMessage, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, type Transaction } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeLighthouseGuard } from '../src/core/lighthouse';
import { validateWalletTransactionChanges } from '../src/core/wallet-transaction-policy';
import { checkSignedTransaction, checkTransactionSignatures } from '../src/core/signed-transaction';
import { accountGuard, tokenGuard, computeSetting, signWithAdditions, walletMessage, COMPUTE, LIGHTHOUSE } from './fixtures/wallet-additions';
import { createTestSigner } from './fixtures/signer';

async function setup() {
  const signer = await createTestSigner();
  const instructions = [{ programAddress: address('11111111111111111111111111111111'), data: Uint8Array.of(7),
    accounts: [{ address: signer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: address('So11111111111111111111111111111111111111112'), role: AccountRole.WRITABLE }] },
    { programAddress: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data: Uint8Array.of(17) }];
  const tx = compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }),
    m => setTransactionMessageFeePayer(signer.address, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstructions(instructions, m)));
  return { signer, tx };
}

describe('bounded wallet transaction changes', () => {
  it('accepts unchanged operations plus compute settings and parsed Lighthouse postconditions, while the default validator remains strict', async () => {
    const f = await setup(); const signed = await signWithAdditions(f.tx, f.signer);
    expect(validateWalletTransactionChanges(f.tx, signed)).toEqual({ computeUnitLimit: 240000, priorityFeeLamports: 24000n, assertionCount: 1 });
    expect(await checkSignedTransaction(f.tx, signed, [f.signer.address])).toBe('message-length');
    expect(await checkTransactionSignatures(signed, [f.signer.address])).toBeNull();
    const mixed = walletMessage(f.tx, ix => [...ix, accountGuard(f.signer.address), tokenGuard(f.signer.address)]);
    expect(validateWalletTransactionChanges(f.tx, mixed)?.assertionCount).toBe(2);
  });
  it.each(['data', 'recipient', 'role', 'order', 'duplicate', 'missing', 'transfer', 'memo', 'unknown-guard', 'new-target', 'early-guard'])(
    'rejects %s changes', async kind => {
      const f = await setup();
      const returned = walletMessage(f.tx, input => {
        const ix = input.map(i => ({ ...i }));
        if (kind === 'data') ix[0].data = Uint8Array.of(8);
        if (kind === 'recipient') ix[0].accounts = [...ix[0].accounts!.slice(0, 1), { address: LIGHTHOUSE, role: AccountRole.WRITABLE }];
        if (kind === 'role') ix[0].accounts = ix[0].accounts!.map(a => ({ ...a, role: a.address === f.signer.address ? a.role : AccountRole.READONLY }));
        if (kind === 'order') ix.reverse();
        if (kind === 'duplicate') ix.push(ix[0]);
        if (kind === 'missing') ix.pop();
        if (kind === 'transfer') ix.push({ ...input[0], data: Uint8Array.of(2) });
        if (kind === 'memo') ix.push({ programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Uint8Array.of(1) });
        if (kind === 'unknown-guard') ix.push({ ...accountGuard(f.signer.address), data: Uint8Array.of(0) });
        if (kind === 'new-target') ix.push(accountGuard(address('SysvarRent111111111111111111111111111111111')));
        if (kind === 'early-guard') ix.unshift(accountGuard(f.signer.address));
        return ix;
      });
      expect(validateWalletTransactionChanges(f.tx, returned)).toBeNull();
    });
  it('rejects changed blockhash, signer metadata, trailing bytes and packet overflow', async () => {
    const f = await setup(); const signed = await signWithAdditions(f.tx, f.signer);
    const message = getCompiledTransactionMessageDecoder().decode(signed.messageBytes);
    const encoded = (m: typeof message) => ({ ...signed, messageBytes: getCompiledTransactionMessageEncoder().encode(m) } as Transaction);
    expect(validateWalletTransactionChanges(f.tx, encoded({ ...message, lifetimeToken: address('So11111111111111111111111111111111111111112') }))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, encoded({ ...message, header: { ...message.header, numReadonlySignerAccounts: 1 } }))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, { ...signed, messageBytes: new Uint8Array([...signed.messageBytes, 0]) } as unknown as Transaction)).toBeNull();
    const oversized = walletMessage(f.tx, ix => [...ix, ...Array.from({ length: 30 }, () => accountGuard(f.signer.address))]);
    expect(validateWalletTransactionChanges(f.tx, oversized)).toBeNull();
  });
  it('bounds priority fees using integer ceiling and rejects duplicated/unknown compute settings', async () => {
    const f = await setup();
    const tx = (limit: bigint, price: bigint) => walletMessage(f.tx, ix => [...ix, computeSetting(2, limit), computeSetting(3, price)]);
    expect(validateWalletTransactionChanges(f.tx, tx(1n, 1n))?.priorityFeeLamports).toBe(1n);
    expect(validateWalletTransactionChanges(f.tx, tx(1_000_000n, 200_000n))?.priorityFeeLamports).toBe(200000n);
    expect(validateWalletTransactionChanges(f.tx, tx(1_000_000n, 200_001n))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, tx(1_400_001n, 0n))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, tx(0n, 0n))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, walletMessage(f.tx, ix => [...ix, computeSetting(3, 1n)]))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, walletMessage(f.tx, ix => [...ix, computeSetting(2, 1n), computeSetting(2, 2n)]))).toBeNull();
    expect(validateWalletTransactionChanges(f.tx, walletMessage(f.tx, ix => [...ix, { programAddress: COMPUTE, data: Uint8Array.of(1, 0, 0, 0, 0) }]))).toBeNull();
  });
});

describe('Lighthouse assertion payloads', () => {
  it('decodes legacy Borsh and compact vectors and consumes the entire payload', async () => {
    const f = await setup(); const legacy = Uint8Array.from(accountGuard(f.signer.address).data!);
    expect(decodeLighthouseGuard(legacy)).toMatchObject({ kind: 'account-info', encoding: 'borsh', assertions: [
      { field: 'lamports', value: 0n, operator: 4 }, { field: 'data-length', value: 0n, operator: 4 },
    ] });
    expect(decodeLighthouseGuard(Uint8Array.from([6, 0, 2, ...legacy.subarray(6)]))?.encoding).toBe('compact');
    expect(decodeLighthouseGuard(tokenGuard(f.signer.address).data)?.kind).toBe('token-account');
    for (const invalid of [legacy.subarray(0, -1), new Uint8Array([...legacy, 0]), Uint8Array.of(6, 7, 0),
      Uint8Array.of(6, 0, 0), Uint8Array.of(6, 0, 0x81, 0, 8), Uint8Array.of(0, 0, 1), Uint8Array.of(6, 0, 1, 255)]) {
      expect(decodeLighthouseGuard(invalid)).toBeNull();
    }
    const invalidOperator = legacy.slice(); invalidOperator[15] = 8;
    expect(decodeLighthouseGuard(invalidOperator)).toBeNull();
  });
});
