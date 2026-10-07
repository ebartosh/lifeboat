import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkRuntime } from './fixtures/runtime.js';

test('Node oracle: PDA, codecs, signing and wire bytes', async () => {
  const checks = await checkRuntime();
  assert.equal(checks.length, 13);
  for (const check of checks) assert.equal(check.passed, true, check.name);
});
