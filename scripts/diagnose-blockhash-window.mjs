import { createSolanaRpc } from '@solana/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Historical read-only probe. Block responses explicitly exclude transactions and rewards.
const [startIso, endIso] = process.argv.slice(2);
const start = Math.floor(Date.parse(startIso) / 1000);
const end = Math.floor(Date.parse(endIso) / 1000);
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 600) {
  throw new Error('Supply two UTC timestamps covering at most ten minutes');
}
const rpc = createSolanaRpc('https://api.mainnet.solana.com');
let requests = 0;
const cache = new Map();
async function send(request) {
  for (let retry = 0; retry < 4; retry++) {
    if (++requests > 80) throw new Error('Historical RPC probe request limit reached');
    await new Promise(resolve => setTimeout(resolve, 1_000));
    try { return await request.send({ abortSignal: AbortSignal.timeout(20_000) }); }
    catch (error) {
      if (error?.context?.statusCode !== 429 || retry === 3) throw error;
      const retryAfter = Number(error.context.headers?.get('retry-after'));
      const delay = Math.min(30_000, Math.max(10_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 10_000));
      console.log(`Public RPC rate limit; retrying read-only request after ${delay} ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
async function producedSlot(slot) {
  for (let offset = 0n; offset < 16n; offset++) {
    const candidate = slot + offset;
    if (cache.has(candidate)) return { slot: candidate, time: cache.get(candidate) };
    let value;
    try { value = await send(rpc.getBlockTime(candidate)); }
    catch (error) {
      if (error?.context?.code !== -32009 && error?.context?.code !== -32007 &&
          !/slot.*skipped|block.*not available/i.test(error?.message ?? '')) throw error;
      continue;
    }
    if (value !== null) { cache.set(candidate, Number(value)); return { slot: candidate, time: Number(value) }; }
  }
  throw new Error('Could not locate a produced block near the requested slot');
}
const anchor = await producedSlot(await send(rpc.getSlot({ commitment: 'confirmed' })));
if (anchor.time < end) throw new Error('Requested period has not completed');
const width = BigInt(Math.max(1024, Math.ceil((anchor.time - start) * 8 + 512)));
const lower = await producedSlot(anchor.slot > width ? anchor.slot - width : 0n);
if (lower.time >= start) throw new Error('Historical search bracket is too narrow');
async function atTime(target, low, high) {
  while (low + 1n < high) {
    const middle = await producedSlot((low + high) / 2n);
    if (middle.slot >= high) { high = (low + high) / 2n; continue; }
    if (middle.time < target) low = middle.slot;
    else high = middle.slot;
  }
  return producedSlot(high);
}
const first = await atTime(start, lower.slot, anchor.slot);
console.log(`Located start block: slot=${first.slot} time=${new Date(first.time * 1000).toISOString()}`);
const last = await atTime(end, first.slot, anchor.slot);
const blockOptions = { commitment: 'confirmed', transactionDetails: 'none', rewards: false, maxSupportedTransactionVersion: 0 };
const firstBlock = await send(rpc.getBlock(first.slot, blockOptions));
const lastBlock = await send(rpc.getBlock(last.slot, blockOptions));
if (firstBlock?.blockHeight == null || lastBlock?.blockHeight == null) throw new Error('Historical block heights are unavailable');
const blocks = Number(lastBlock.blockHeight - firstBlock.blockHeight);
const seconds = last.time - first.time;
if (blocks <= 0 || seconds <= 0) throw new Error('Historical timing is inconsistent');
const report = {
  provider: 'Solana public mainnet RPC', startIso, endIso,
  first: { slot: first.slot.toString(), blockHeight: firstBlock.blockHeight.toString(), blockTime: first.time },
  last: { slot: last.slot.toString(), blockHeight: lastBlock.blockHeight.toString(), blockTime: last.time },
  blocks, seconds, averageMsPerBlock: Math.round(1000 * seconds / blocks),
  estimated150BlockWindowMs: Math.round(150_000 * seconds / blocks), requests,
  note: 'Block times are estimates with second resolution; original transaction heights were not captured.',
};
const output = path.resolve('.cache', `blockhash-window-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
console.log(`Saved historical block timing: ${output}`);
