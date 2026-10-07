import { describe, expect, it } from 'vitest';
import { AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction,
  createTransactionMessage, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Instruction, type Transaction } from '@solana/kit';
import { instructionDiagnosticDetails } from '../src/core/instruction-diagnostics';
import { filterWalletLog } from '../scripts/wallet-log-filter.mjs';
import { createTestSigner } from './fixtures/signer';

const compute = address('ComputeBudget111111111111111111111111111111');
const system = address('11111111111111111111111111111111');
const memo = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ata = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const recipient = address('So11111111111111111111111111111111111111112');

function computeInstruction(opcode: 2 | 3, value: bigint): Instruction {
  const data = new Uint8Array(opcode === 2 ? 5 : 9);
  data[0] = opcode;
  if (opcode === 2) new DataView(data.buffer).setUint32(1, Number(value), true);
  else new DataView(data.buffer).setBigUint64(1, value, true);
  return { programAddress: compute, data };
}

async function setup() {
  const signer = await createTestSigner();
  const original: Instruction = { programAddress: ata, data: Uint8Array.of(1),
    accounts: [{ address: signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: recipient, role: AccountRole.WRITABLE }] };
  const transaction = (instructions: readonly Instruction[]) => compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(signer.address, message),
    message => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, message),
    message => appendTransactionMessageInstructions(instructions, message)));
  return { signer, original, transaction };
}

describe('wallet instruction diagnostics', () => {
  it('decodes added compute settings, SOL transfer and memo without exposing wallet addresses or memo content', async () => {
    const f = await setup();
    const transferData = new Uint8Array(12);
    new DataView(transferData.buffer).setUint32(0, 2, true);
    new DataView(transferData.buffer).setBigUint64(4, 12_345n, true);
    const addedRecipient = address('SysvarRent111111111111111111111111111111111');
    const transfer: Instruction = { programAddress: system, data: transferData, accounts: [
      { address: f.signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: addedRecipient, role: AccountRole.WRITABLE },
    ] };
    const lines = instructionDiagnosticDetails(f.transaction([f.original]), f.transaction([
      computeInstruction(2, 250_000n), computeInstruction(3, 9_007_199_254_740_993n), f.original,
      transfer, { programAddress: memo, data: new TextEncoder().encode('private memo auth_token=secret') },
    ]));
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain('kind=compute-limit opcode=2');
    expect(lines[1]).toContain('value=250000');
    expect(lines[2]).toContain('value=9007199254740993');
    expect(lines[3]).toContain('kind=ata-create-idempotent');
    expect(lines[3]).toContain('originalIndex=0');
    expect(lines[4]).toContain('kind=system-transfer opcode=2');
    expect(lines[4]).toMatch(/value=12345 secondary=none source=original-0 destination=added-\d+/);
    expect(lines[5]).toContain('kind=memo opcode=none');
    const combined = lines.join('\n');
    for (const secret of [f.signer.address, recipient, addedRecipient, 'private memo', 'auth_token', 'secret']) expect(combined).not.toContain(secret);
    for (const detail of lines) {
      const milestone = '[LifeboatTransaction] trace=v1 attempt=1 event=instruction-detail elapsedMs=10' + detail;
      expect(filterWalletLog('I ReactNativeJS: ' + milestone)).toBe(milestone);
      expect(filterWalletLog('I ReactNativeJS: ' + milestone + ' auth_token=secret')).toBeNull();
    }
  });

  it('does not label changed data, changed recipients or changed account roles as an original instruction', async () => {
    const f = await setup();
    const original = f.transaction([f.original]);
    for (const instruction of [
      { ...f.original, data: Uint8Array.of(2) },
      { ...f.original, accounts: [{ address: f.signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: system, role: AccountRole.WRITABLE }] },
      { ...f.original, accounts: [{ address: f.signer.address, role: AccountRole.WRITABLE_SIGNER }, { address: recipient, role: AccountRole.READONLY }] },
    ]) {
      expect(instructionDiagnosticDetails(original, f.transaction([instruction]))[1]).toContain('originalIndex=none');
    }
  });

  it('does not interpret malformed known instructions or print unknown program data', async () => {
    const f = await setup();
    const lines = instructionDiagnosticDetails(f.transaction([f.original]), f.transaction([
      { programAddress: compute, data: Uint8Array.of(3, 1) },
      { programAddress: system, data: Uint8Array.of(2) },
      { programAddress: recipient, data: new TextEncoder().encode('private payload') },
    ]));
    expect(lines[1]).toContain('kind=compute-unknown');
    expect(lines[2]).toContain('kind=system-unknown opcode=none');
    expect(lines[3]).toContain('kind=unknown');
    expect(lines.join('\n')).not.toContain('private payload');
    const invalid = { messageBytes: Uint8Array.of(255), signatures: {} } as unknown as Transaction;
    expect(instructionDiagnosticDetails(f.transaction([f.original]), invalid)).toEqual([]);
    const trailing = f.transaction([f.original]);
    const withTrailing = { ...trailing, messageBytes: new Uint8Array([...trailing.messageBytes, 0]) } as unknown as Transaction;
    expect(instructionDiagnosticDetails(trailing, withTrailing)).toEqual([]);
  });
});
