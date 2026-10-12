export type RpcStatus = 'checking' | 'connected' | 'unreachable';

/** One startup ping: any block height answer means the configured RPC is reachable. */
export async function pingRpc(rpc: { getBlockHeight(): Promise<bigint> } | null): Promise<RpcStatus> {
  if (!rpc) return 'unreachable';
  try {
    await rpc.getBlockHeight();
    return 'connected';
  } catch {
    return 'unreachable';
  }
}
