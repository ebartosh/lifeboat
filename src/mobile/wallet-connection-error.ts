import { walletProtocolErrorCode } from '../core/wallet-errors';

export class WalletConnectionError extends Error {}

export function walletConnectionReason(error: unknown): string {
  const details = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown } : {};
  const message = typeof details.message === 'string' ? details.message : '';
  const protocolCode = walletProtocolErrorCode(error);
  if (details.code === 'ERROR_WALLET_NOT_FOUND') return 'wallet-not-found';
  if (details.code === 'ERROR_ASSOCIATION_CANCELLED' || /cancelled by user/i.test(message)) return 'cancelled';
  if (details.code === 'ERROR_SESSION_TIMEOUT' || /timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (protocolCode === -32602) return 'invalid-params';
  if (protocolCode === -32601) return 'method-not-found';
  if (protocolCode === -1) return 'authorization-failed';
  if (protocolCode === -3) return 'not-signed';
  return 'other';
}

/** Show the failed MWA step without exposing tokens or native request payloads. */
export function walletConnectionFailure(error: unknown, phase: 'session' | 'authorization' | 'return'): WalletConnectionError {
  if (error instanceof WalletConnectionError) return error;
  const details = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown } : {};
  const message = typeof details.message === 'string' ? details.message : '';
  if (details.code === 'ERROR_WALLET_NOT_FOUND') {
    return new WalletConnectionError('No compatible Android wallet was found. Install or update an MWA wallet, then retry.');
  }
  if (details.code === 'ERROR_ASSOCIATION_CANCELLED' || /cancelled by user/i.test(message)) {
    return new WalletConnectionError('Wallet connection cancelled. Return to Lifeboat and retry when ready.');
  }
  if (phase === 'session') {
    return new WalletConnectionError('The wallet opened but did not establish an MWA session. Unlock it, return to Lifeboat and retry. If this continues, update the wallet and check its MWA support.');
  }
  if (phase === 'authorization') {
    return new WalletConnectionError('The wallet did not authorize the connection. Check its connection request, then return to Lifeboat and retry.');
  }
  return new WalletConnectionError('The wallet session ended without a usable account in Lifeboat. Return to the app and retry the connection.');
}
