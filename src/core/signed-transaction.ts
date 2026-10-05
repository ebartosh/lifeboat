import { getPublicKeyFromAddress, verifySignature, type Address, type Transaction } from '@solana/kit';

export type SignatureCheckFailure = 'missing-transaction' | 'signer-set' | 'message-type'
  | 'message-length' | 'message-bytes' | 'signature-type' | 'signature-length' | 'signature-verify';

/** Accept only signatures over the exact message approved after simulation. */
export async function checkSignedTransaction(unsigned: Transaction, signed: Transaction | undefined,
  expectedSigners: readonly Address[]): Promise<SignatureCheckFailure | null> {
  if (!signed) return 'missing-transaction';
  if (!signed.signatures || Object.keys(signed.signatures).length !== expectedSigners.length ||
      expectedSigners.some(signer => !(signer in signed.signatures))) return 'signer-set';
  if (!(signed.messageBytes instanceof Uint8Array)) return 'message-type';
  if (signed.messageBytes.length !== unsigned.messageBytes.length) return 'message-length';
  if (!signed.messageBytes.every((byte, index) => byte === unsigned.messageBytes[index])) return 'message-bytes';
  for (const signer of expectedSigners) {
    const bytes = signed.signatures[signer];
    if (!(bytes instanceof Uint8Array)) return 'signature-type';
    if (bytes.length !== 64) return 'signature-length';
    if (!await verifySignature(await getPublicKeyFromAddress(signer), bytes, signed.messageBytes)) return 'signature-verify';
  }
  return null;
}
