import { describe, expect, it } from 'vitest';
import { filterWalletLog } from '../scripts/wallet-log-filter.mjs';

describe('wallet log capture filtering', () => {
  it('discards full native authorization params while retaining the milestone', () => {
    const line = '10-05 12:34:56.123 100 200 D SolanaMobileWalletAdapterModule: invoke `authorize` with params {auth_token: secret, accounts: [private-address]}';
    expect(filterWalletLog(line)).toBe('10-05 12:34:56.123 [NativeMWA] event=authorize-invoked');
    expect(filterWalletLog('10-05 12:34:56.123 100 200 E SolanaMobileWalletAdapterModule: Failed to invoke `authorize` with params secret'))
      .toBe('10-05 12:34:56.123 [NativeMWA] event=authorize-failed');
  });
  it('retains fixed JS trace fields and drops other JS data', () => {
    const prefix = '10-05 12:34:56.123 100 200 I ReactNativeJS: ';
    const trace = '[LifeboatWallet] trace=v1 attempt=1 event=failure elapsedMs=10001 phase=session reason=timeout';
    expect(filterWalletLog(prefix + trace)).toBe('10-05 12:34:56.123 ' + trace);
    expect(filterWalletLog(prefix + trace + ' token=secret')).toBeNull();
    expect(filterWalletLog(prefix + 'auth_token=secret')).toBeNull();
    expect(filterWalletLog(prefix + '[LifeboatWallet] trace=v1 attempt=1 event=failure elapsedMs=1 phase=session reason=secret')).toBeNull();
  });
  it('drops unknown native messages and unrelated tags', () => {
    expect(filterWalletLog('D SolanaMobileWalletAdapterModule: secret')).toBeNull();
    expect(filterWalletLog('D AnotherTag: invoke `authorize` with params secret')).toBeNull();
  });
  it('keeps transaction/signing milestones and discards appended payloads', () => {
    const prefix = '10-05 12:34:56.123 100 200 I ReactNativeJS: ';
    for (const trace of [
      '[LifeboatWalletSign] trace=v1 attempt=2 event=failure elapsedMs=90001 phase=signing reason=not-signed',
      '[LifeboatTransaction] trace=v1 attempt=1 event=failure elapsedMs=10000 stage=post-sign-height reason=blockhash-expired',
      '[LifeboatTransaction] trace=v1 attempt=1 event=program-error elapsedMs=123 instruction=0 custom=6001',
      '[LifeboatTransaction] trace=v1 attempt=1 event=signature-rejected elapsedMs=123 check=message-bytes',
      '[LifeboatTransaction] trace=v1 attempt=1 event=message-shape elapsedMs=123 side=returned length=414 consumed=414 version=v0 accounts=11 instructions=1 computeBudget=0',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=authorize-retry elapsedMs=123 reason=authorization-failed protocolCode=-1',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=authorization-saved elapsedMs=123',
      '[LifeboatTransaction] trace=v1 attempt=1 event=failure elapsedMs=123 stage=signing-start reason=wallet-not-signed',
    ]) {
      expect(filterWalletLog(prefix + trace)).toBe('10-05 12:34:56.123 ' + trace);
      expect(filterWalletLog(prefix + trace + ' payload=secret')).toBeNull();
    }
    expect(filterWalletLog('D SolanaMobileWalletAdapterModule: invoke `sign_transactions` with params {payloads:[secret]}'))
      .toBe('[NativeMWA] event=sign-transactions-invoked');
  });
});
