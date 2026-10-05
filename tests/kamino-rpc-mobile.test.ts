import { createServer } from 'node:http';
import { address } from '@solana/kit';
import { expect, it } from 'vitest';
import { SolanaRpcClient } from '../src/core/rpc';
import { MAINNET_GENESIS } from '../src/operations/kamino';

it('reads Kamino discovery and a slot-bound account graph through one RPC endpoint', async () => {
  const program = address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
  const position = address('11111111111111111111111111111112');
  const account = { lamports: 1, owner: program, executable: false, rentEpoch: 0,
    data: [Buffer.from([1, 2, 3]).toString('base64'), 'base64'] };
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const rpcRequest = JSON.parse(body);
    calls.push({ method: rpcRequest.method, params: rpcRequest.params });
    const result = rpcRequest.method === 'getGenesisHash' ? MAINNET_GENESIS
      : rpcRequest.method === 'getProgramAccounts' ? { context: { slot: 100 },
        value: [{ pubkey: position, account }] }
      : rpcRequest.method === 'getMultipleAccounts' ? { context: { slot: 101 }, value: [account] }
      : null;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpcRequest.id, result }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = server.address();
    if (!endpoint || typeof endpoint === 'string') throw new Error('Missing port');
    const rpc = new SolanaRpcClient(`http://127.0.0.1:${endpoint.port}`);
    expect(await rpc.getGenesisHash()).toBe(MAINNET_GENESIS);
    const found = await rpc.getProgramAccounts(program, 3, [{ offset: 64, bytes: position }]);
    expect(found.slot).toBe(100n);
    expect(found.accounts[0]?.account.data).toEqual(Uint8Array.of(1, 2, 3));
    const graph = await rpc.getAccounts([position], found.slot);
    expect(graph.slot).toBe(101n);
    expect(graph.accounts[0]?.owner).toBe(program);
    expect(calls.map(call => call.method)).toEqual(['getGenesisHash', 'getProgramAccounts', 'getMultipleAccounts']);
    expect(calls[1]?.params?.[1]).toMatchObject({ withContext: true,
      filters: [{ dataSize: 3 }, { memcmp: { offset: 64, bytes: position, encoding: 'base58' } }] });
    expect(calls[2]?.params?.[1]).toMatchObject({ minContextSlot: 100 });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
  }
});
