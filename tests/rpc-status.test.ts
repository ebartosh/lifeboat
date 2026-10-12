import { describe, expect, it } from 'vitest';
import { pingRpc } from '../src/mobile/rpc-status';

describe('startup RPC ping', () => {
  it('reports a reachable RPC when it returns a block height', async () => {
    await expect(pingRpc({ getBlockHeight: async () => 1n })).resolves.toBe('connected');
  });
  it('reports an unreachable RPC when the request fails or times out', async () => {
    await expect(pingRpc({ getBlockHeight: async () => { throw new Error('RPC request timed out'); } }))
      .resolves.toBe('unreachable');
  });
  it('reports an unreachable RPC when none is configured', async () => {
    await expect(pingRpc(null)).resolves.toBe('unreachable');
  });
});
