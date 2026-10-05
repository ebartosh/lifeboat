const SOLANA_MAINNET_RPC = 'https://api.mainnet.solana.com';
const HELIUS_MAINNET_RPC = 'https://mainnet.helius-rpc.com/';

export function getDefaultRpcUrl(): string {
  // Local read-only fixture servers are available only in development bundles.
  const fixture = process.env.EXPO_PUBLIC_LIFEBOAT_TEST_RPC;
  if (typeof __DEV__ !== 'undefined' && __DEV__ && fixture) {
    const url = new URL(fixture);
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Test RPC must use localhost HTTP');
    return fixture;
  }
  return SOLANA_MAINNET_RPC;
}

export function getHeliusRpcUrl(apiKey = process.env.EXPO_PUBLIC_HELIUS_API_KEY): string | null {
  const key = apiKey?.trim();
  return key ? `${HELIUS_MAINNET_RPC}?api-key=${encodeURIComponent(key)}` : null;
}
