// Local Android RPC fixture. Read-only by default; --claims enables mock submission.
// No requests are forwarded to Solana; no BPF code is executed.
// Run: node --import tsx scripts/serve-test-rpc.mjs
// adb reverse tcp:8899 tcp:8899; use http://127.0.0.1:8899/rewards in the app.
import { createServer } from 'node:http';
import { createOreAdapter } from '../src/protocols/ore-bundle.ts';
import { createMinerFixture } from '../tests/fixtures/miner.ts';
import { createTreasuryFixture } from '../tests/fixtures/treasury.ts';
import fixture from '../src/diagnostics/runtime-fixture.json' with { type: 'json' };
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage,
  getTransactionDecoder, getSignatureFromTransaction, getPublicKeyFromAddress, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, verifySignature } from '@solana/kit';

const adapter = createOreAdapter();
const walletArg = process.argv.find(arg => arg.startsWith('--wallet='));
const testWallet = walletArg ? address(walletArg.slice('--wallet='.length)) : address(fixture.address);
const miner = await adapter.getMinerAddress(testWallet);
const treasury = await adapter.getTreasuryAddress();
// Optional mock submission accepts ONLY valid signatures of the selected public test
// wallet and exactly the bundled claim messages. It does not execute BPF or contact a network.
const claimsEnabled = process.argv.includes('--claims');
const known = new Map();
const counts = { simulations: 0, sends: 0, sol: 0, ore: 0 };
const expected = await Promise.all(['claim-sol', 'claim-ore'].map(async action => {
  const ix = action === 'claim-sol' ? await adapter.buildClaimSolInstruction(testWallet)
    : await adapter.buildClaimOreInstruction(testWallet);
  return compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(testWallet, message),
    message => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, message),
    message => appendTransactionMessageInstructions([ix], message))).messageBytes;
}));
const account = (data, executable = false) => ({ data: [Buffer.from(data).toString('base64'), 'base64'],
  executable, owner: adapter.programAddress, lamports: 1_000_000, rentEpoch: 0, space: data.length });

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/stats') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ...counts, uniqueTransactions: known.size })); return;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 65536) { response.writeHead(413).end(); return; }
  }
  try {
    const { id, method, params } = JSON.parse(body);
    let result;
    const mode = request.url;
    if (process.argv.includes('--trace')) console.log(`${method} ${mode}`);
    if (mode === '/error') { response.writeHead(503).end(); return; }
    if (method === 'getAccountInfo') {
      const key = params[0];
      const value = key === adapter.programAddress ? account(new Uint8Array(), true)
        : key === miner && mode !== '/empty' ? account(mode === '/unsupported'
          ? new Uint8Array(1) : createMinerFixture(testWallet))
        : key === treasury ? account(createTreasuryFixture()) : null;
      result = { context: { slot: 1 }, value };
    } else if (method === 'getLatestBlockhash') {
      result = { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } };
    } else if (method === 'getFeeForMessage') result = { context: { slot: 1 }, value: 5000 };
    else if (claimsEnabled && method === 'getBlockHeight') result = 1;
    else if (claimsEnabled && (method === 'simulateTransaction' || method === 'sendTransaction')) {
      const tx = getTransactionDecoder().decode(Buffer.from(params[0], 'base64'));
      const index = expected.findIndex(bytes => Buffer.from(bytes).equals(Buffer.from(tx.messageBytes)));
      if (index === -1 || Object.keys(tx.signatures).length !== 1 || !(testWallet in tx.signatures)) throw new Error();
      if (method === 'simulateTransaction') {
        counts.simulations++;
        result = { context: { slot: 1 }, value: { err: mode === '/claim-simulation-error' ? 'fixture error' : null,
          logs: ['Local fixture only; no BPF execution'], unitsConsumed: 5000 } };
      } else {
        const bytes = tx.signatures[testWallet];
        if (!bytes || !await verifySignature(await getPublicKeyFromAddress(testWallet), bytes, tx.messageBytes)) throw new Error();
        const id = getSignatureFromTransaction(tx);
        known.set(id, mode === '/claim-failed' ? { InstructionError: [0, 'fixture error'] } : null);
        counts.sends++; counts[index === 0 ? 'sol' : 'ore']++;
        if (mode === '/claim-lost') { request.socket.destroy(); return; }
        result = id;
      }
    } else if (claimsEnabled && method === 'getSignatureStatuses') {
      result = { context: { slot: 1 }, value: params[0].map(id => known.has(id)
        ? { slot: 1, confirmations: 1, confirmationStatus: 'confirmed', err: known.get(id), status: known.get(id) === null ? { Ok: null } : { Err: known.get(id) } } : null) };
    }
    else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Read-only fixture: method not allowed' } }));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  } catch { response.writeHead(400).end(); }
}).listen(8899, '127.0.0.1', () => console.log(`Local test RPC: localhost:8899; mock claims ${claimsEnabled ? `enabled for ${testWallet}` : 'disabled'}`));
