import {
  address, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage,
  pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Transaction,
} from '@solana/kit';
import { checkSignedTransaction } from '../core/signed-transaction';
import type { LatestBlockhash } from '../core/rpc';

const memoProgram = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

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
    throw new Error(`Wallet returned an invalid signature or changed transaction (${failure})`);
  }
}
