import { createKeyPairSignerFromBytes } from '@solana/kit';
import { ConfigurationError } from './errors';

/** Parse without filesystem access or including key material in errors. */
export async function parseKeypair(contents: string) {
  let value: unknown;
  try { value = JSON.parse(contents); } catch {
    throw new ConfigurationError('Keypair must be valid JSON');
  }
  if (!Array.isArray(value) || value.length !== 64 ||
      value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new ConfigurationError('Keypair must contain exactly 64 byte values');
  }
  try {
    return await createKeyPairSignerFromBytes(new Uint8Array(value), false);
  } catch {
    throw new ConfigurationError('Keypair public and private parts must match');
  }
}
