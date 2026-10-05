/** Allow only known milestones. The native MWA SDK logs full authorize params. */
export function filterWalletLog(line) {
  const timestamp = line.match(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)?.[0];
  const prefix = timestamp ? `${timestamp} ` : '';
  if (/\bReactNativeJS\b/.test(line)) {
    const trace = line.match(/\[LifeboatWallet\] trace=v1 attempt=\d+ event=(?:start|session-ready|authorize-start|authorize-result|session-closed|foreground-wait|success|failure) elapsedMs=\d+(?: state=(?:active|background|inactive|unknown))?(?: phase=(?:session|authorization|return) reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other))?(?=\s*$)/)?.[0]
      ?? line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=(?:start|session-ready|authorize-start|authorize-retry|authorize-result|account-check|sign-start|sign-result|session-closed|foreground-wait|success|failure) elapsedMs=\d+(?: phase=(?:session|authorization|account|signing|close|return) reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other))?(?=\s*$)/)?.[0]
      ?? line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=(?:start|blockhash-start|message-build|simulation-start|simulation-validation|fee-read|review-wait|review-approved|cancelled|pre-sign-height|signing-start|signing-result|signature-validation|post-sign-height|pending-save|pre-send-height|send-start|send-result|confirmation-start|confirmed|failure|program-error|signature-rejected) elapsedMs=\d+(?: stage=(?:start|blockhash-start|message-build|simulation-start|simulation-validation|fee-read|review-wait|review-approved|cancelled|pre-sign-height|signing-start|signing-result|signature-validation|post-sign-height|pending-save|pre-send-height|send-start|send-result|confirmation-start|confirmed) reason=(?:cancelled|authorization-failed|invalid-params|blockhash-expired|invalid-signature|account-changed|foreground-timeout|timeout|rate-limited|rpc-forbidden|insufficient-funds|simulation-error|on-chain-error|rpc-signature-mismatch|other))?(?: instruction=\d+ custom=\d+)?(?: check=(?:missing-transaction|signer-set|message-type|message-length|message-bytes|signature-type|signature-length|signature-verify))?(?=\s*$)/)?.[0];
    const shape = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=message-shape elapsedMs=\d+ side=(?:original|returned) length=\d+ consumed=\d+ version=(?:legacy|v0|v1|unknown) accounts=\d+ instructions=\d+ computeBudget=\d+(?=\s*$)/)?.[0];
    const authorization = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=authorize-(?:retry|rejected) elapsedMs=\d+ reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other) protocolCode=(?:-?\d+|unknown)(?=\s*$)/)?.[0];
    const saved = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=authorization-(?:save|saved) elapsedMs=\d+(?=\s*$)/)?.[0];
    const storageFailure = line.match(/\[LifeboatWalletSign\] trace=v1 attempt=\d+ event=failure elapsedMs=\d+ phase=storage reason=(?:wallet-not-found|cancelled|timeout|invalid-params|method-not-found|authorization-failed|not-signed|other)(?=\s*$)/)?.[0];
    const notSigned = line.match(/\[LifeboatTransaction\] trace=v1 attempt=\d+ event=failure elapsedMs=\d+ stage=signing-start reason=wallet-not-signed(?=\s*$)/)?.[0];
    const milestone = trace ?? shape ?? authorization ?? saved ?? storageFailure ?? notSigned;
    return milestone ? prefix + milestone : null;
  }
  if (!/\bSolanaMobileWalletAdapterModule\b/.test(line)) return null;
  const events = [
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
