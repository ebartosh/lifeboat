import { createSolanaRpc } from '@solana/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Read-only public RPC probe: no wallet, simulation, signing or submission API is used.
const rpc = createSolanaRpc('https://api.mainnet.solana.com');
const started = Date.now();
const samples = [];
const send = request => request.send({ abortSignal: AbortSignal.timeout(20_000) });
for (let index = 0; index < 3; index++) {
  const before = Date.now();
  const latest = await send(rpc.getLatestBlockhash({ commitment: 'confirmed' }));
  const height = await send(rpc.getBlockHeight({ commitment: 'confirmed' }));
  const sample = {
    index, at: new Date().toISOString(), elapsedMs: Date.now() - started,
    requestMs: Date.now() - before,
    contextSlot: latest.context.slot.toString(),
    lastValidBlockHeight: latest.value.lastValidBlockHeight.toString(),
    currentBlockHeight: height.toString(),
    remainingBlocks: (latest.value.lastValidBlockHeight - height).toString(),
  };
  samples.push(sample);
  console.log(JSON.stringify(sample));
  if (index < 2) await new Promise(resolve => setTimeout(resolve, 5_000));
}
const output = path.resolve('.cache', `blockhash-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const first = samples[0], last = samples.at(-1);
const blocks = Number(BigInt(last.currentBlockHeight) - BigInt(first.currentBlockHeight));
const elapsedMs = last.elapsedMs - first.elapsedMs;
const timing = blocks > 0 ? { observedBlocks: blocks, observedElapsedMs: elapsedMs,
  observedMsPerBlock: Math.round(elapsedMs / blocks),
  estimated150BlockWindowMs: Math.round(150 * elapsedMs / blocks) } : null;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ provider: 'Solana public mainnet RPC', commitment: 'confirmed',
  note: 'Current read-only samples cannot reconstruct a previous transaction lifetime.', samples, timing }, null, 2));
console.log(JSON.stringify({ timing }));
console.log(`Saved numeric blockhash diagnostics: ${output}`);
