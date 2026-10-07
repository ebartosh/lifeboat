import { getCompiledTransactionMessageDecoder, type Transaction } from '@solana/kit';
import { decodeLighthouseGuard, LIGHTHOUSE_PROGRAM } from './lighthouse';

type Message = ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>;
type LegacyMessage = Extract<Message, { version: 'legacy' | 0 }>;
type CompiledInstruction = LegacyMessage['instructions'][number];

const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKENS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const MEMOS = ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'];

function decode(transaction: Transaction): LegacyMessage {
  if (!(transaction.messageBytes instanceof Uint8Array) || transaction.messageBytes.length > 1232) throw new Error('Unsupported message');
  const [message, consumed] = getCompiledTransactionMessageDecoder().read(transaction.messageBytes, 0);
  if (consumed !== transaction.messageBytes.length || message.version === 1) throw new Error('Unsupported message');
  return message;
}

function account(message: LegacyMessage, index: number | undefined) {
  if (index === undefined || !Number.isInteger(index) || index < 0) return undefined;
  return message.staticAccounts[index]; // Lookup-table addresses remain unresolved.
}

function role(message: LegacyMessage, index: number) {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  return index < numSignerAccounts
    ? (index < numSignerAccounts - numReadonlySignerAccounts ? 'writable-signer' : 'readonly-signer')
    : (index < message.staticAccounts.length - numReadonlyNonSignerAccounts ? 'writable' : 'readonly');
}

function sameInstruction(left: LegacyMessage, a: CompiledInstruction, right: LegacyMessage, b: CompiledInstruction) {
  const program = account(left, a.programAddressIndex);
  if (!program || program !== account(right, b.programAddressIndex) || role(left, a.programAddressIndex) !== role(right, b.programAddressIndex)) return false;
  const aData = a.data ?? new Uint8Array();
  const bData = b.data ?? new Uint8Array();
  if (aData.length !== bData.length || !aData.every((byte, index) => byte === bData[index])) return false;
  const aAccounts = a.accountIndices ?? [];
  const bAccounts = b.accountIndices ?? [];
  return aAccounts.length === bAccounts.length && aAccounts.every((index, position) => {
    const address = account(left, index);
    return address !== undefined && address === account(right, bAccounts[position]) && role(left, index) === role(right, bAccounts[position]);
  });
}

function describe(program: string, instruction: CompiledInstruction) {
  const bytes = Uint8Array.from(instruction.data ?? []);
  const data = new DataView(bytes.buffer);
  let opcode: number | 'none' = bytes[0] ?? 'none';
  let kind = 'unknown';
  let value = 'none';
  let secondary = 'none';
  let source: number | undefined;
  let destination: number | undefined;
  if (program === COMPUTE) {
    kind = 'compute-unknown';
    if (bytes.length === 5 && (opcode === 1 || opcode === 2 || opcode === 4)) {
      kind = opcode === 1 ? 'compute-heap' : opcode === 2 ? 'compute-limit' : 'compute-data-limit';
      value = data.getUint32(1, true).toString();
    } else if (bytes.length === 9 && opcode === 3) {
      kind = 'compute-price'; value = data.getBigUint64(1, true).toString();
    }
  } else if (program === SYSTEM) {
    opcode = bytes.length >= 4 ? data.getUint32(0, true) : 'none';
    kind = 'system-unknown';
    if (opcode === 2 && bytes.length === 12) {
      kind = 'system-transfer'; value = data.getBigUint64(4, true).toString(); source = 0; destination = 1;
    } else if (opcode === 0 && bytes.length === 52) {
      kind = 'system-create-account'; value = data.getBigUint64(4, true).toString();
      secondary = data.getBigUint64(12, true).toString(); source = 0; destination = 1;
    }
  } else if (program === ATA) {
    kind = bytes.length === 0 || (bytes.length === 1 && opcode === 0) ? 'ata-create'
      : bytes.length === 1 && opcode === 1 ? 'ata-create-idempotent'
      : bytes.length === 1 && opcode === 2 ? 'ata-recover-nested' : 'ata-unknown';
  } else if (TOKENS.includes(program)) {
    kind = 'token-unknown';
    if (bytes.length === 9 && (opcode === 3 || opcode === 4)) {
      kind = opcode === 3 ? 'token-transfer' : 'token-approve'; value = data.getBigUint64(1, true).toString(); source = 0; destination = 1;
    } else if (bytes.length === 10 && (opcode === 12 || opcode === 13)) {
      kind = opcode === 12 ? 'token-transfer-checked' : 'token-approve-checked';
      value = data.getBigUint64(1, true).toString(); secondary = bytes[9].toString(); source = 0; destination = 2;
    } else if (bytes.length === 1 && opcode === 9) {
      kind = 'token-close-account'; source = 0; destination = 1;
    } else if (bytes.length === 1 && opcode === 5) kind = 'token-revoke';
    else if (bytes.length === 1 && opcode === 17) kind = 'token-sync-native';
  } else if (MEMOS.includes(program)) { kind = 'memo'; opcode = 'none'; }
  else if (program === LIGHTHOUSE_PROGRAM) {
    const guard = decodeLighthouseGuard(instruction.data);
    kind = guard ? `lighthouse-${guard.kind}` : 'lighthouse-unknown';
    if (guard) value = guard.assertions.length.toString();
    source = 0;
  }
  return { kind, opcode, value, secondary, source, destination };
}

/** Return only numeric/enum assertion details, using anonymous target-account references. */
export function lighthouseDiagnosticDetails(originalTx: Transaction, returnedTx: Transaction): string[] {
  try {
    const original = decode(originalTx), returned = decode(returnedTx);
    return returned.instructions.flatMap((ix, index) => {
      if (account(returned, ix.programAddressIndex) !== LIGHTHOUSE_PROGRAM) return [];
      const guard = decodeLighthouseGuard(ix.data);
      const target = account(returned, ix.accountIndices?.[0]);
      const originalIndex = target ? original.staticAccounts.indexOf(target) : -1;
      if (!guard || originalIndex < 0) return [];
      return guard.assertions.map((assertion, assertionIndex) => ` index=${index} assertion=${assertionIndex}`
        + ` kind=${guard.kind} encoding=${guard.encoding} field=${assertion.field}`
        + ` operator=${assertion.operator ?? 'none'} value=${assertion.value ?? 'none'} target=original-${originalIndex}`);
    });
  } catch { return []; }
}

/** Diagnostic descriptions only, never an acceptance policy. No wallet addresses, memo text or wire payloads. */
export function instructionDiagnosticDetails(originalTransaction: Transaction, returnedTransaction: Transaction): string[] {
  try {
    const original = decode(originalTransaction);
    const returned = decode(returnedTransaction);
    const lines: string[] = [];
    const reference = (message: LegacyMessage, index: number | undefined) => {
      if (index === undefined) return 'none';
      const address = account(message, index);
      if (!address) return 'unresolved';
      const originalIndex = original.staticAccounts.indexOf(address);
      return originalIndex >= 0 ? `original-${originalIndex}` : `added-${index}`;
    };
    for (const [side, message] of [['original', original], ['returned', returned]] as const) {
      for (const [index, instruction] of message.instructions.entries()) {
        const address = account(message, instruction.programAddressIndex);
        // A malformed program index could point at a wallet signer: never print it.
        const program = address && instruction.programAddressIndex >= message.header.numSignerAccounts ? address : 'unresolved';
        const detail = describe(program, instruction);
        const originalIndex = original.instructions.findIndex(candidate => sameInstruction(original, candidate, message, instruction));
        lines.push(` side=${side} index=${index} program=${program} kind=${detail.kind} opcode=${detail.opcode}`
          + ` dataLength=${instruction.data?.length ?? 0} accounts=${instruction.accountIndices?.length ?? 0}`
          + ` originalIndex=${originalIndex < 0 ? 'none' : originalIndex} value=${detail.value} secondary=${detail.secondary}`
          + ` source=${reference(message, instruction.accountIndices?.[detail.source ?? -1])}`
          + ` destination=${reference(message, instruction.accountIndices?.[detail.destination ?? -1])}`);
      }
    }
    return lines;
  } catch { return []; }
}
