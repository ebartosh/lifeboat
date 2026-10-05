import { describe, expect, it } from 'vitest';
import { walletProtocolErrorCode } from '../src/core/wallet-errors';
import { transactionFailureReason } from '../src/core/transaction-diagnostics';
import { walletConnectionReason } from '../src/mobile/wallet-connection-error';

describe('wallet protocol errors', () => {
  it('recognizes SDK, native and wrapped errors without using token-bearing messages', () => {
    for (const error of [
      { code: -1 },
      { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: -1 } },
      new Error('wrapper', { cause: { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: -1 } } }),
    ]) {
      expect(walletProtocolErrorCode(error)).toBe(-1);
      expect(walletConnectionReason(error)).toBe('authorization-failed');
    }
    expect(walletProtocolErrorCode({ code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: '-1' } })).toBeUndefined();
  });
  it('does not label a wallet refusal as a user cancellation', () => {
    expect(transactionFailureReason(new Error('signing failed', { cause: { code: -3 } }))).toBe('wallet-not-signed');
    expect(transactionFailureReason(new Error('Operation cancelled'))).toBe('cancelled');
  });
});
