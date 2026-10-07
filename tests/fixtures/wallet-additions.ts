import { address, compileTransaction, decompileTransactionMessage, getCompiledTransactionMessageDecoder,
  partiallySignTransaction, AccountRole, type Instruction, type KeyPairSigner, type Transaction } from '@solana/kit';

export const COMPUTE = address('ComputeBudget111111111111111111111111111111');
export const LIGHTHOUSE = address('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
export function computeSetting(opcode: 2 | 3, value: bigint): Instruction {
  const data = new Uint8Array(opcode === 2 ? 5 : 9); data[0] = opcode;
  const view = new DataView(data.buffer);
  if (opcode === 2) view.setUint32(1, Number(value), true); else view.setBigUint64(1, value, true);
  return { programAddress: COMPUTE, data };
}
// Independent legacy Borsh fixture: assert lamports >= 0 and data length >= 0.
// 1 opcode + 1 log level + 4 vector length + 2 * (1 tag + 8 value + 1 operator).
export function accountGuard(target: KeyPairSigner['address']): Instruction {
  const data = new Uint8Array(26); data[0] = 6; data[1] = 4;
  new DataView(data.buffer).setUint32(2, 2, true);
  data[6] = 0; data[15] = 4; data[16] = 1; data[25] = 4;
  return { programAddress: LIGHTHOUSE, data, accounts: [{ address: target, role: AccountRole.READONLY }] };
}
export function tokenGuard(target: KeyPairSigner['address']): Instruction {
  const data = new Uint8Array(16); data[0] = 10;
  new DataView(data.buffer).setUint32(2, 1, true); data[6] = 2; data[15] = 4;
  return { programAddress: LIGHTHOUSE, data, accounts: [{ address: target, role: AccountRole.READONLY }] };
}
export function walletMessage(original: Transaction, transform: (instructions: readonly Instruction[]) => readonly Instruction[]): Transaction {
  const decoded = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(original.messageBytes));
  return compileTransaction({ ...decoded, instructions: [...transform(decoded.instructions)] });
}
export async function signWithAdditions(original: Transaction, signer: KeyPairSigner, limit = 240_000n, price = 100_000n): Promise<Transaction> {
  const modified = walletMessage(original, instructions => [
    ...instructions.filter(ix => ix.programAddress !== COMPUTE),
    computeSetting(2, limit), computeSetting(3, price), accountGuard(signer.address),
  ]);
  // Model an MWA wallet preserving stale pre-signatures from temporary accounts.
  return partiallySignTransaction([signer.keyPair], { ...modified, signatures: { ...modified.signatures, ...original.signatures } });
}
