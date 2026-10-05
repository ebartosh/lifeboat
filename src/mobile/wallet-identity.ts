import { WalletConnectionError } from './wallet-connection-error';

/** The URI must identify the user's own project, not a borrowed wallet website. */
export function createWalletIdentity(configuredUri?: string): { name: string; uri?: string } {
  const value = configuredUri?.trim();
  if (!value) return { name: 'Lifeboat' };
  try {
    const uri = new URL(value);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.search || uri.hash ||
        !uri.hostname.includes('.') || uri.hostname.endsWith('.local') || uri.hostname.endsWith('.localhost') ||
        /^(127\.|10\.|192\.168\.|0\.)/.test(uri.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(uri.hostname)) {
      throw new Error();
    }
    return { name: 'Lifeboat', uri: uri.href };
  } catch {
    throw new WalletConnectionError('Configure a public HTTPS wallet identity URI without credentials, query parameters or a fragment.');
  }
}
