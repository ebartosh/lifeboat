import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

export async function createTestSigner() {
  return await createKeyPairSignerFromPrivateKeyBytes(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    false,
  );
}
