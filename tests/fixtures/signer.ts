import { createKeyPairSignerFromPrivateKeyBytes, signTransaction, type KeyPairSigner, type Transaction } from "@solana/kit";

export async function createTestSigner() {
  return await createKeyPairSignerFromPrivateKeyBytes(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    false,
  );
}

/** Emulates an external wallet response using public test signing material. */
export const testWalletSigning = (signer: KeyPairSigner) => (transaction: Transaction) =>
  signTransaction([signer.keyPair], transaction);
