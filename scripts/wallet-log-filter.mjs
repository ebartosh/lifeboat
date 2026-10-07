/** Allow only known milestones. The native MWA SDK logs full authorize params. */
export function filterWalletLog(line) {
  const timestamp = line.match(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)?.[0];
  const prefix = timestamp ? `${timestamp} ` : '';
  if (/\bReactNativeJS\b/.test(line)) {
    const trace = line.match(/\[LifeboatWallet\] trace=v1 attempt=\d+ event=(?:start|session-ready|authorize-start|authorize-result|session-closed|foreground-wait|success|failure) elapsedMs=\d+(?: state=(?:active|background|inactive|unknown))?(?: phase=(?:session|authorization|return) reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other))?(?=\s*$)/)?.[0]
      ?? line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=(?:start|session-ready|authorize-start|authorize-retry|authorize-result|account-check|sign-start|sign-result|session-closed|foreground-wait|success|failure) elapsedMs=\d+(?: phase=(?:session|authorization|account|signing|close|return) reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other))?(?=\s*$)/)?.[0]
      ?? line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=(?:start|blockhash-start|message-build|simulation-start|simulation-validation|fee-read|review-wait|review-approved|cancelled|pre-sign-height|signing-start|signing-result|signature-validation|post-sign-height|pending-save|pre-send-height|send-start|send-result|confirmation-start|confirmed|wallet-simulation-start|wallet-simulation-validation|wallet-review-wait|wallet-review-approved|failure|program-error|signature-rejected) elapsedMs=\d+(?: stage=(?:start|blockhash-start|message-build|simulation-start|simulation-validation|fee-read|review-wait|review-approved|cancelled|pre-sign-height|signing-start|signing-result|signature-validation|post-sign-height|pending-save|pre-send-height|send-start|send-result|confirmation-start|confirmed|wallet-simulation-start|wallet-simulation-validation|wallet-review-wait|wallet-review-approved) reason=(?:cancelled|authorization-failed|invalid-params|blockhash-expired|invalid-signature|account-changed|foreground-timeout|timeout|rate-limited|rpc-forbidden|insufficient-funds|simulation-error|on-chain-error|rpc-signature-mismatch|other))?(?: instruction=\d+ custom=\d+)?(?: check=(?:missing-transaction|signer-set|message-type|message-length|message-bytes|signature-type|signature-length|signature-verify))?(?=\s*$)/)?.[0];
    const shape = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=message-shape elapsedMs=\d+ side=(?:original|returned) length=\d+ consumed=\d+ version=(?:legacy|v0|v1|unknown) accounts=\d+ instructions=\d+ computeBudget=\d+(?=\s*$)/)?.[0];
    const authorization = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=authorize-(?:retry|rejected) elapsedMs=\d+ reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other) protocolCode=(?:-?\d+|unknown)(?=\s*$)/)?.[0];
    const saved = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=authorization-(?:save|saved) elapsedMs=\d+(?=\s*$)/)?.[0];
    const storageFailure = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=failure elapsedMs=\d+ phase=storage reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other)(?=\s*$)/)?.[0];
    const notSigned = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=failure elapsedMs=\d+ stage=signing-start reason=wallet-not-signed(?=\s*$)/)?.[0];
    const instruction = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=instruction-detail elapsedMs=\d+ side=(?:original|returned) index=\d+ program=(?:[1-9A-HJ-NP-Za-km-z]{32,44}|unresolved) kind=(?:unknown|memo|lighthouse-(?:unknown|account-info|token-account)|compute-(?:unknown|heap|limit|data-limit|price)|system-(?:unknown|transfer|create-account)|ata-(?:unknown|create|create-idempotent|recover-nested)|token-(?:unknown|transfer|approve|transfer-checked|approve-checked|close-account|revoke|sync-native)) opcode=(?:\d+|none) dataLength=\d+ accounts=\d+ originalIndex=(?:\d+|none) value=(?:\d+|none) secondary=(?:\d+|none) source=(?:original-\d+|added-\d+|none|unresolved) destination=(?:original-\d+|added-\d+|none|unresolved)(?=\s*$)/)?.[0];
    const guard = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=guard-detail elapsedMs=\d+ index=\d+ assertion=\d+ kind=(?:account-info|token-account) encoding=(?:borsh|compact) field=(?:lamports|data-length|owner|known-owner|rent-epoch|is-signer|is-writable|executable|data-hash|mint|amount|delegate|state|is-native|delegated-amount|close-authority|owner-is-derived) operator=(?:\d+|none) value=(?:\d+|none) target=original-\d+(?=\s*$)/)?.[0];
    const capabilities = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=capabilities elapsedMs=\d+ signTransactions=(?:yes|no|unknown) signAndSend=(?:yes|no|unknown) legacy=(?:yes|no|unknown) v0=(?:yes|no|unknown) maxTransactions=(?:\d+|unknown)(?=\s*$)/)?.[0];
    const capabilitiesFailure = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=capabilities-failure elapsedMs=\d+ reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other) protocolCode=(?:-?\d+|unknown)(?=\s*$)/)?.[0];
    const walletCheck = line.match(/\[LifeboatWalletCheck\] trace=v1 attempt=\d+ event=(?:start|blockhash-start|sign-start|sign-result|validation-start|success|failure) elapsedMs=\d+(?: phase=(?:blockhash|signing|validation) reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other) protocolCode=(?:-?\d+|unknown))?(?=\s*$)/)?.[0];
    const milestone = trace ?? shape ?? authorization ?? saved ?? storageFailure ?? notSigned ?? instruction ?? guard ?? capabilities ?? capabilitiesFailure ?? walletCheck;
    return milestone ? prefix + milestone : null;
  }
  if (!/\bSolanaMobileWalletAdapterModule\b/.test(line)) return null;
  const events = [
    [/Failed to invoke `get_capabilities`/, 'capabilities-failed'],
    [/invoke `get_capabilities`/, 'capabilities-invoked'],
    [/startSession with config/, 'session-start'],
    [/Failed to invoke `authorize`/, 'authorize-failed'],
    [/invoke `authorize`/, 'authorize-invoked'],
    [/invoke `reauthorize`/, 'reauthorize-invoked'],
    [/Failed to invoke `sign_transactions`/, 'sign-transactions-failed'],
    [/invoke `sign_transactions`/, 'sign-transactions-invoked'],
    [/Timed out waiting for local association to be ready/, 'session-timeout'],
    [/Failed establishing local association with wallet/, 'session-failed'],
    [/Found no installed wallet/, 'wallet-not-found'],
    [/Local association cancelled by user/, 'session-cancelled'],
    [/Failed to start session/, 'session-start-failed'],
    [/Timed out waiting for local association to close/, 'session-close-timeout'],
    [/Failed to end session/, 'session-close-failed'],
    [/endSession/, 'session-end'],
  ];
  const event = events.find(([pattern]) => pattern.test(line))?.[1];
  return event ? `${prefix}[NativeMWA] event=${event}` : null;
}
