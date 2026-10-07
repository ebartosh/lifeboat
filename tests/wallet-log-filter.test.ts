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
      '[LifeboatWalletSign] trace=v1 attempt=2 event=capabilities elapsedMs=123 signTransactions=yes signAndSend=no legacy=yes v0=no maxTransactions=unknown',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=capabilities-failure elapsedMs=123 reason=method-not-found protocolCode=-32601',
      '[LifeboatWalletCheck] trace=v1 attempt=3 event=success elapsedMs=456',
      '[LifeboatWalletCheck] trace=v1 attempt=3 event=failure elapsedMs=456 phase=signing reason=not-signed protocolCode=-3',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=failure elapsedMs=90001 phase=signing reason=not-signed',
      '[LifeboatTransaction] trace=v1 attempt=1 event=failure elapsedMs=10000 stage=post-sign-height reason=blockhash-expired',
      '[LifeboatTransaction] trace=v1 attempt=1 event=program-error elapsedMs=123 instruction=0 custom=6001',
      '[LifeboatTransaction] trace=v1 attempt=1 event=signature-rejected elapsedMs=123 check=message-bytes',
      '[LifeboatTransaction] trace=v1 attempt=1 event=message-shape elapsedMs=123 side=returned length=414 consumed=414 version=v0 accounts=11 instructions=1 computeBudget=0',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=authorize-retry elapsedMs=123 reason=authorization-failed protocolCode=-1',
      '[LifeboatWalletSign] trace=v1 attempt=2 event=authorization-saved elapsedMs=123',
      '[LifeboatTransaction] trace=v1 attempt=1 event=failure elapsedMs=123 stage=signing-start reason=wallet-not-signed',
      '[LifeboatTransaction] trace=v1 attempt=1 event=wallet-simulation-start elapsedMs=123',
      '[LifeboatTransaction] trace=v1 attempt=1 event=wallet-review-wait elapsedMs=123',
      '[LifeboatTransaction] trace=v1 attempt=1 event=failure elapsedMs=123 stage=wallet-simulation-start reason=simulation-error',
      '[LifeboatTransaction] trace=v1 attempt=1 event=guard-detail elapsedMs=123 index=3 assertion=0 kind=account-info encoding=borsh field=lamports operator=4 value=1000 target=original-0',
      '[LifeboatTransaction] trace=v1 attempt=1 event=instruction-detail elapsedMs=123 side=returned index=3 program=L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 kind=lighthouse-account-info opcode=6 dataLength=26 accounts=1 originalIndex=none value=2 secondary=none source=original-0 destination=none',
    ]) {
      expect(filterWalletLog(prefix + trace)).toBe('10-05 12:34:56.123 ' + trace);
      expect(filterWalletLog(prefix + trace + ' payload=secret')).toBeNull();
    }
    expect(filterWalletLog('D SolanaMobileWalletAdapterModule: invoke `sign_transactions` with params {payloads:[secret]}'))
      .toBe('[NativeMWA] event=sign-transactions-invoked');
    expect(filterWalletLog('D SolanaMobileWalletAdapterModule: invoke `get_capabilities` with params secret'))
      .toBe('[NativeMWA] event=capabilities-invoked');
    expect(filterWalletLog('I ReactNativeJS: [LifeboatWalletSign] trace=v1 attempt=2 event=capabilities elapsedMs=123 signTransactions=secret signAndSend=no legacy=yes v0=no maxTransactions=unknown')).toBeNull();
  });
});
