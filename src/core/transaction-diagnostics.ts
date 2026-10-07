import type { SignatureCheckFailure } from './signed-transaction';
import { getCompiledTransactionMessageDecoder, type Transaction } from '@solana/kit';
import { walletProtocolErrorCode } from './wallet-errors';
import { instructionDiagnosticDetails, lighthouseDiagnosticDetails } from './instruction-diagnostics';

type TransactionEvent = 'start' | 'blockhash-start' | 'message-build' | 'simulation-start'
  | 'simulation-validation' | 'fee-read' | 'review-wait' | 'review-approved' | 'cancelled'
  | 'pre-sign-height' | 'signing-start' | 'signing-result' | 'signature-validation'
  | 'post-sign-height' | 'pending-save' | 'pre-send-height' | 'send-start' | 'send-result'
  | 'confirmation-start' | 'confirmed' | 'wallet-simulation-start' | 'wallet-simulation-validation'
  | 'wallet-review-wait' | 'wallet-review-approved';
let attempt = 0;

/** Classify errors locally; raw messages, RPC URLs, and payloads never enter logs. */
export function transactionFailureReason(error: unknown): string {
  const protocolCode = walletProtocolErrorCode(error);
  if (protocolCode === -3) return 'wallet-not-signed';
  if (protocolCode === -1) return 'authorization-failed';
  if (protocolCode === -32602) return 'invalid-params';
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const details = current as { code?: unknown; message?: unknown; cause?: unknown };
    const message = typeof details.message === 'string' ? details.message : '';
    if (/not signed|declined to sign/i.test(message)) return 'wallet-not-signed';
    if (/user rejected|cancelled/i.test(message)) return 'cancelled';
    if (/blockhash.*expired|expired.*confirmation/i.test(message)) return 'blockhash-expired';
    if (/message or signature is invalid/i.test(message)) return 'invalid-signature';
    if (/account changed|wallet changed/i.test(message)) return 'account-changed';
    if (/did not return/i.test(message)) return 'foreground-timeout';
    if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
    if (/429|too many requests/i.test(message)) return 'rate-limited';
    if (/403|forbidden/i.test(message)) return 'rpc-forbidden';
    if (/insufficient|not enough/i.test(message)) return 'insufficient-funds';
    if (/simulation failed/i.test(message)) return 'simulation-error';
    if (/failed on-chain/i.test(message)) return 'on-chain-error';
    if (/different transaction signature/i.test(message)) return 'rpc-signature-mismatch';
    current = details.cause;
  }
  return 'other';
}

export function startTransactionTrace() {
  const id = ++attempt;
  const started = Date.now();
  let stage: TransactionEvent = 'start';
  const record = (event: TransactionEvent | 'failure' | 'program-error' | 'signature-rejected' | 'message-shape' | 'instruction-detail' | 'guard-detail', detail = '') => {
    console.info(`[LifeboatTransaction] trace=v1 attempt=${id} event=${event} elapsedMs=${Date.now() - started}${detail}`);
  };
  record('start');
  return {
    event: (event: TransactionEvent) => { stage = event; record(event); },
    failure: (error: unknown) => record('failure', ` stage=${stage} reason=${transactionFailureReason(error)}`),
    signatureRejected: (check: SignatureCheckFailure) => record('signature-rejected', ` check=${check}`),
    instructionDetails: (original: Transaction, returned: Transaction) => {
      for (const detail of instructionDiagnosticDetails(original, returned)) record('instruction-detail', detail);
      for (const detail of lighthouseDiagnosticDetails(original, returned)) record('guard-detail', detail);
    },
    messageShape: (side: 'original' | 'returned', transaction: Transaction) => {
      // Read only structure. Never emit addresses, amounts, instruction data, or signatures.
      try {
        const [message, consumed] = getCompiledTransactionMessageDecoder().read(transaction.messageBytes, 0);
        const version = message.version === 'legacy' ? 'legacy' : message.version === 0 ? 'v0' : 'v1';
        const instructions = 'instructions' in message ? message.instructions : [];
        const computeBudget = instructions.filter(instruction =>
          message.staticAccounts[instruction.programAddressIndex] === 'ComputeBudget111111111111111111111111111111').length;
        record('message-shape', ` side=${side} length=${transaction.messageBytes.length} consumed=${consumed} version=${version}`
          + ` accounts=${message.staticAccounts.length} instructions=${instructions.length} computeBudget=${computeBudget}`);
      } catch {
        record('message-shape', ` side=${side} length=${transaction.messageBytes?.length ?? 0} consumed=0 version=unknown accounts=0 instructions=0 computeBudget=0`);
      }
    },
    programError: (error: unknown) => {
      const instructionError = typeof error === 'object' && error !== null
        ? (error as { InstructionError?: unknown }).InstructionError : undefined;
      if (!Array.isArray(instructionError)) return;
      const [index, details] = instructionError;
      const custom = typeof details === 'object' && details !== null ? details.Custom : undefined;
      if (Number.isSafeInteger(index) && index >= 0 && Number.isSafeInteger(custom) && custom >= 0) {
        record('program-error', ` instruction=${index} custom=${custom}`);
      }
    },
  };
}
