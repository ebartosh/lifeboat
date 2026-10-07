import { walletConnectionReason } from './wallet-connection-error';
import { walletProtocolErrorCode } from '../core/wallet-errors';

type ConnectionEvent = 'start' | 'session-ready' | 'authorize-start' | 'authorize-result'
  | 'session-closed' | 'foreground-wait' | 'success';
type ConnectionPhase = 'session' | 'authorization' | 'return';
type SigningEvent = 'start' | 'session-ready' | 'authorize-start' | 'authorize-retry' | 'authorize-rejected' | 'authorize-result'
  | 'account-check' | 'authorization-save' | 'authorization-saved' | 'sign-start' | 'sign-result' | 'session-closed' | 'foreground-wait' | 'success';
type SigningPhase = 'session' | 'authorization' | 'account' | 'storage' | 'signing' | 'close' | 'return';
let attempt = 0;

/** Fixed diagnostic fields only: never log wallet responses, tokens, or errors. */
export function startWalletConnectionTrace(state: string | null) {
  const id = ++attempt;
  const started = Date.now();
  const record = (event: ConnectionEvent | 'failure', detail = '') => {
    console.info(`[LifeboatWallet] trace=v1 attempt=${id} event=${event} elapsedMs=${Date.now() - started}${detail}`);
  };
  const initialState = state === 'active' || state === 'background' || state === 'inactive' ? state : 'unknown';
  record('start', ` state=${initialState}`);
  return {
    event: (event: ConnectionEvent) => record(event),
    failure: (phase: ConnectionPhase, error: unknown) => record('failure', ` phase=${phase} reason=${walletConnectionReason(error)}`),
  };
}

export function startWalletSigningTrace() {
  const id = ++attempt;
  const started = Date.now();
  const record = (event: SigningEvent | 'failure', detail = '') => {
    console.info(`[LifeboatWalletSign] trace=v1 attempt=${id} event=${event} elapsedMs=${Date.now() - started}${detail}`);
  };
  record('start');
  return {
    event: (event: SigningEvent) => record(event),
    capabilities: (value: unknown) => {
      const capabilities = (value ?? {}) as Record<string, unknown>;
      const features = Array.isArray(capabilities.features) ? capabilities.features : [];
      const versions = Array.isArray(capabilities.supported_transaction_versions) ? capabilities.supported_transaction_versions : [];
      const flag = (value: unknown) => value === true ? 'yes' : value === false ? 'no' : 'unknown';
      const limit = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
      // The SDK normalizes legacy capabilities; do not infer a negotiated version from these fields.
      console.info(`[LifeboatWalletSign] trace=v1 attempt=${id} event=capabilities elapsedMs=${Date.now() - started}` +
        ` signTransactions=${Array.isArray(capabilities.features) ? flag(features.includes('solana:signTransactions')) : 'unknown'}` +
        ` signAndSend=${flag(capabilities.supports_sign_and_send_transactions)}` +
        ` legacy=${Array.isArray(capabilities.supported_transaction_versions) ? flag(versions.includes('legacy')) : 'unknown'}` +
        ` v0=${Array.isArray(capabilities.supported_transaction_versions) ? flag(versions.includes(0)) : 'unknown'}` +
        ` maxTransactions=${limit(capabilities.max_transactions_per_request)}`);
    },
    capabilitiesFailure: (error: unknown) => {
      console.info(`[LifeboatWalletSign] trace=v1 attempt=${id} event=capabilities-failure elapsedMs=${Date.now() - started}` +
        ` reason=${walletConnectionReason(error)} protocolCode=${walletProtocolErrorCode(error) ?? 'unknown'}`);
    },
    authorizationFailure: (error: unknown, retry: boolean) => record(retry ? 'authorize-retry' : 'authorize-rejected',
      ` reason=${walletConnectionReason(error)} protocolCode=${walletProtocolErrorCode(error) ?? 'unknown'}`),
    failure: (phase: SigningPhase, error: unknown) => record('failure', ` phase=${phase} reason=${walletConnectionReason(error)}`),
  };
}

export function startWalletCheckTrace() {
  const id = ++attempt;
  const started = Date.now();
  const record = (event: 'start' | 'blockhash-start' | 'sign-start' | 'sign-result' | 'validation-start' | 'success' | 'failure', detail = '') =>
    console.info(`[LifeboatWalletCheck] trace=v1 attempt=${id} event=${event} elapsedMs=${Date.now() - started}${detail}`);
  record('start');
  return {
    event: (event: 'blockhash-start' | 'sign-start' | 'sign-result' | 'validation-start' | 'success') => record(event),
    failure: (phase: 'blockhash' | 'signing' | 'validation', error: unknown) => record('failure',
      ` phase=${phase} reason=${walletConnectionReason(error)} protocolCode=${walletProtocolErrorCode(error) ?? 'unknown'}`),
  };
}
