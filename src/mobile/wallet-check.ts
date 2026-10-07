import {
  address, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage,
  pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Transaction,
} from '@solana/kit';
import { checkSignedTransaction } from '../core/signed-transaction';
import type { LatestBlockhash, TransactionRpc } from '../core/rpc';
import { startWalletCheckTrace } from './wallet-diagnostics';
import { walletConnectionReason } from './wallet-connection-error';

const memoProgram = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
class WalletCheckValidationError extends Error {}

/** Requests one wallet signature over a harmless memo transaction, without sending it. */
export async function checkWalletSignature(wallet: Address, lifetime: LatestBlockhash,
  sign: (transaction: Transaction) => Promise<Transaction>): Promise<void> {
  const unsigned = compileTransaction(pipe(
    createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(wallet, message),
    message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    message => appendTransactionMessageInstructions([{
      programAddress: memoProgram, data: new TextEncoder().encode('Lifeboat wallet check'),
    }], message),
  ));
  const signed = await sign(unsigned);
  const failure = await checkSignedTransaction(unsigned, signed, [wallet]);
  if (failure) {
    throw new WalletCheckValidationError(`Wallet returned an invalid signature or changed transaction (${failure})`);
  }
}

/** This path has no submission API and never saves a pending transaction. */
export async function runWalletSignatureCheck(wallet: Address, rpc: Pick<TransactionRpc, 'getLatestBlockhash'>,
  sign: (transaction: Transaction) => Promise<Transaction>, onSigning?: () => void): Promise<void> {
  const trace = startWalletCheckTrace();
  let phase: 'blockhash' | 'signing' | 'validation' = 'blockhash';
  try {
    trace.event('blockhash-start');
    const lifetime = await rpc.getLatestBlockhash();
    await checkWalletSignature(wallet, lifetime, async transaction => {
      phase = 'signing';
      onSigning?.();
      trace.event('sign-start');
      const signed = await sign(transaction);
      trace.event('sign-result');
      phase = 'validation';
      trace.event('validation-start');
      return signed;
    });
    trace.event('success');
  } catch (error) { trace.failure(phase, error); throw error; }
}

/** Never expose raw wallet errors, which may contain request payloads. */
export function walletCheckFailure(error: unknown): string {
  if (error instanceof WalletCheckValidationError) return 'The wallet returned an invalid signature or changed memo transaction. Nothing was sent.';
  const reason = walletConnectionReason(error);
  if (reason === 'not-signed') return 'The wallet declined to sign the memo. This does not establish that you cancelled. Nothing was sent.';
  if (reason === 'authorization-failed') return 'The wallet did not authorize the signature check. Nothing was sent.';
  if (reason === 'cancelled') return 'Wallet signature check cancelled. Nothing was sent.';
  if (reason === 'timeout') return 'Wallet signature check timed out. Return to Lifeboat and retry. Nothing was sent.';
  return 'Wallet signature check failed. Check the network and wallet, then retry. Nothing was sent.';
}
