import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkRuntime, testKeypairJson } from '../src/diagnostics/runtime.js';
import { parseKeypair } from '../src/core/wallet.js';

test('Node oracle: PDA, codecs, signing and wire bytes', async () => {
  const checks = await checkRuntime(testKeypairJson());
  assert.equal(checks.length, 13);
  for (const check of checks) assert.equal(check.passed, true, check.name);
});

test('reject malformed or mismatched keypairs without leaking contents', async () => {
  for (const value of ['secret-invalid-json', '{}', '[]', JSON.stringify(Array(64).fill(256)),
    JSON.stringify(Array(64).fill(1.5))]) {
    await assert.rejects(parseKeypair(value), error => {
      assert(!String(error).includes(value));
      return true;
    });
  }
  const mismatch = JSON.parse(testKeypairJson());
  mismatch[63] ^= 1;
  await assert.rejects(parseKeypair(JSON.stringify(mismatch)), /must match/);
});
