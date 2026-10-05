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
    authorizationFailure: (error: unknown, retry: boolean) => record(retry ? 'authorize-retry' : 'authorize-rejected',
      ` reason=${walletConnectionReason(error)} protocolCode=${walletProtocolErrorCode(error) ?? 'unknown'}`),
    failure: (phase: SigningPhase, error: unknown) => record('failure', ` phase=${phase} reason=${walletConnectionReason(error)}`),
  };
}
