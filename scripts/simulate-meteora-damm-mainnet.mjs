// Unsigned, read-only validation of Meteora DAMM v2 Withdraw all on live public positions.
// There is no signing material and submission is blocked. Writes .cache/meteora-damm-mainnet-simulation.json and,
// with DAMM_CAPTURE=1, tests/fixtures/meteora-damm/mainnet.json (raw accounts of the simulated positions).
// node --import tsx scripts/simulate-meteora-damm-mainnet.mjs
// SOLANA_RPC_URL (optional), DAMM_PER_CATEGORY (default 1), DAMM_POOLS_PER_SOURCE (default 6).
import { mkdir, writeFile } from 'node:fs/promises';
import { createSolanaRpc, getBase58Decoder, getBase64Encoder, getTransactionEncoder, compileTransaction, createTransactionMessage, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions } from '@solana/kit';
import { SolanaRpcClient } from '../src/core/rpc.ts';
import { decodeTokenAccount, TOKEN_2022_PROGRAM } from '../src/core/tokens.ts';
import { executeSafeTransaction } from '../src/core/transaction.ts';
import { DammAdapter } from '../src/protocols/meteora-damm/adapter.ts';
import { CLOCK, COMPOUNDING, decodeAccount, PROGRAM, SIZES } from '../src/protocols/meteora-damm/codec.ts';
import { vestingRemaining } from '../src/protocols/meteora-damm/math.ts';
import { prepareWithdrawAll, withdrawalShape } from '../src/protocols/meteora-damm/withdraw.ts';
import metadata from '../src/protocols/meteora-damm/metadata.json' with { type: 'json' };

const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const baseFetch = globalThis.fetch;
// Public RPCs rate-limit bursts: retry HTTP 429 with backoff instead of failing the read.
globalThis.fetch = async (...args) => { for (let i = 0; ; i++) { const response = await baseFetch(...args);
  if (response.status !== 429 || i >= 8) return response; await new Promise(r => setTimeout(r, 1000 * 2 ** Math.min(i, 4))); } };
const rpc = new SolanaRpcClient(url), raw = createSolanaRpc(url), adapter = new DammAdapter();
rpc.sendTransaction = async () => { throw new Error('Submission is disabled for read-only integration verification'); };
await adapter.assertNetwork(rpc);
const perCategory = Number(process.env.DAMM_PER_CATEGORY || 1), poolsPerSource = Number(process.env.DAMM_POOLS_PER_SOURCE || 6);
const bytes = data => Uint8Array.from(getBase64Encoder().encode(data[0]));
const pause = () => new Promise(r => setTimeout(r, 300));
const memcmp = (offset, value) => ({ memcmp: { offset: BigInt(offset), bytes: value, encoding: 'base58' } });
const keysOnly = { encoding: 'base64', dataSlice: { offset: 0, length: 0 } };
// Pools by source; byte offsets follow the pinned layout (tests/meteora-damm-protocol.test.ts checks them).
const pools = new Map();
const addPools = async (source, filters, limit = poolsPerSource) => {
  const found = await raw.getProgramAccounts(PROGRAM, { ...keysOnly, filters: [{ dataSize: BigInt(SIZES.Pool) }, ...filters] }).send();
  for (const item of found.sort((a, b) => a.pubkey < b.pubkey ? -1 : 1).slice(0, limit)) pools.set(item.pubkey, source);
  console.log(`${source}: ${found.length} pools, sampling ${Math.min(limit, found.length)}`);
};
await addPools('rewards', [memcmp(728, '2')]);
await addPools('compounding', [memcmp(484, '3')]);
// PYUSD (TransferFeeConfig) and BERN (nonzero transfer fee) as Token-2022 transfer-fee mints.
for (const mint of ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo'])
  for (const offset of [168, 200]) await addPools('transfer-fee', [memcmp(offset, mint)], 3);
const candidates = new Map();
for (const pool of pools.keys()) {
  await pause();
  const found = await raw.getProgramAccounts(PROGRAM, { encoding: 'base64', filters: [{ dataSize: BigInt(SIZES.Position) }, memcmp(8, pool)] }).send();
  for (const item of found.slice(0, 200)) candidates.set(item.pubkey, { source: pools.get(pool), data: bytes(item.account.data) });
}
// Positions with separate vesting accounts.
const vestings = await raw.getProgramAccounts(PROGRAM, { encoding: 'base64', filters: [{ dataSize: BigInt(SIZES.Vesting) }] }).send();
for (const item of vestings.slice(0, 40)) {
  const vesting = decodeAccount('Vesting', { owner: PROGRAM, executable: false, data: bytes(item.account.data) });
  if (!candidates.has(vesting.position)) candidates.set(vesting.position, { source: 'vesting-account' });
}
// Inner vesting has no exact-match filter; schedules of 3, 100 and 365 periods are rare enough to list (number_of_period, offset 376).
for (const periods of [3, 100, 365]) {
  await pause();
  const found = await raw.getProgramAccounts(PROGRAM, { ...keysOnly, filters: [{ dataSize: BigInt(SIZES.Position) }, memcmp(376, getBase58Decoder().decode(Uint8Array.of(periods & 255, periods >> 8)))] }).send();
  for (const item of found) if (!candidates.has(item.pubkey)) candidates.set(item.pubkey, { source: 'inner-vesting' });
}
for (const position of (process.env.DAMM_POSITIONS || '').split(',').filter(Boolean)) candidates.set(position, { source: 'listed' });
console.log(`${candidates.size} candidate positions; ${vestings.length} vesting accounts on the program`);
const clockData = (await rpc.getAccount(CLOCK)).data, clock = new DataView(clockData.buffer, clockData.byteOffset, 40);
const now = { slot: clock.getBigUint64(0, true), time: clock.getBigInt64(32, true) };
function categories(p) {
  const result = [], s = p.state, shape = withdrawalShape(p);
  if (shape.blocked) return [`blocked`];
  if (p.vestings.length) result.push(p.vested > 0n ? 'external-vesting-in-progress' : 'external-vesting-complete');
  else if (s.vested_liquidity > 0n) result.push(p.vested > 0n ? 'inner-vesting-in-progress' : 'inner-vesting-complete');
  if (p.permanent > 0n) result.push('permanent-lock');
  if (!result.length) result.push(s.unlocked_liquidity > 0n ? 'unlocked' : 'empty');
  if (p.rewards.some(r => r)) result.push('rewards');
  if (p.pool.collect_fee_mode === COMPOUNDING) result.push('compounding');
  if ([...p.tokens, ...p.rewards.filter(r => r)].some(t => t.token.transferFee)) result.push('transfer-fee');
  if (shape.forfeited.length) result.push('frozen-reward-vault');
  return result;
}
const attempts = [], passed = new Map(), captures = [];
const save = () => writeFile('.cache/meteora-damm-mainnet-simulation.json', JSON.stringify({ unsigned: true, submitted: false,
  rpc: url.replace(/\?.*$/, ''), sourceCommit: metadata.sourceCommit, idlSha256: metadata.idlSha256, attempts }, null, 2));
await mkdir('.cache', { recursive: true });
for (const [position, candidate] of [...candidates].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
  try {
    if (candidate.data) {
      // Pre-filter on the raw account: skip categories that already passed.
      const s = decodeAccount('Position', { owner: PROGRAM, executable: false, data: candidate.data });
      const guess = s.vested_liquidity > vestingRemaining(s.inner_vesting) ? 'external-vesting' : s.vested_liquidity > 0n ? 'inner-vesting'
        : s.permanent_locked_liquidity > 0n ? 'permanent-lock' : s.unlocked_liquidity > 0n ? 'unlocked' : 'empty';
      const wanted = [guess, candidate.source].some(k => [...passed.keys()].filter(c => c.startsWith(k)).reduce((n, c) => n + passed.get(c), 0) < perCategory);
      if (!wanted) continue;
    }
    await pause();
    const state = decodeAccount('Position', await rpc.getAccount(position));
    const holders = await raw.getProgramAccounts(TOKEN_2022_PROGRAM, { encoding: 'base64', filters: [memcmp(0, state.nft_mint)] }).send();
    const holding = holders.map(h => decodeTokenAccount({ owner: h.account.owner, executable: false, data: bytes(h.account.data) })).find(t => t.amount === 1n);
    if (!holding) continue;
    const wallet = holding.authority, read = await adapter.readPosition(rpc, wallet, position);
    if (!read) continue;
    const kinds = categories(read);
    if (kinds.every(k => (passed.get(k) ?? 0) >= perCategory)) continue;
    const record = { position, pool: read.poolAddress, wallet, source: candidate.source, categories: kinds,
      activation: read.pool.activation_type === 0 ? 'slot' : 'timestamp', unlocked: read.unlocked.toString(), vested: read.vested.toString(),
      permanent: read.permanent.toString(), vestingAccounts: read.vestings.length };
    if (kinds[0] === 'blocked') { record.blocked = withdrawalShape(read).blocked; attempts.push(record); await save(); continue; }
    const plan = await prepareWithdrawAll({ rpc, wallet, position, adapter });
    Object.assign(record, { actions: plan.actions.map(a => a.kind === 'reward' ? `reward:${a.rewardIndex}${a.skipReward ? ':skip' : ''}` : a.kind).join(','),
      closes: plan.closes, holds: plan.holds, rentRefund: plan.rentRefund.toString(),
      bytes: getTransactionEncoder().encode(compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }), m => setTransactionMessageFeePayer(wallet, m),
        m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0n }, m),
        m => appendTransactionMessageInstructions(plan.instructions, m)))).length });
    const result = await executeSafeTransaction({ rpc, wallet, signWithWallet: async () => { throw new Error('Signing disabled'); },
      instructions: plan.instructions, simulationAccounts: plan.simulationAccounts, validateSimulation: plan.validateSimulation,
      confirm: async review => { Object.assign(record, { unitsConsumed: review.simulation.unitsConsumed?.toString(), feeLamports: review.feeLamports?.toString(),
        ataRent: plan.ataRent.toString(), snapshotSlot: review.simulation.snapshot.slot.toString(),
        receipts: plan.receipts.map(t => ({ mint: t.mint, tokenProgram: t.token.program, grossAmount: t.grossAmount.toString(), transferFee: t.transferFee.toString(), netAmount: t.amount.toString() })),
        estimates: plan.estimates.map(t => ({ mint: t.mint, grossAmount: t.grossAmount.toString(), netAmount: t.amount.toString() })) }); return false; } });
    if (result.status !== 'cancelled') throw new Error('Unexpected execution result');
    attempts.push(record); for (const k of kinds) passed.set(k, (passed.get(k) ?? 0) + 1); await save();
    if (process.env.DAMM_CAPTURE === '1' && captures.length < 8) {
      const keys = [position, read.poolAddress, read.state.nft_mint, ...new Set([...read.tokens, ...read.rewards.filter(r => r)].map(t => t.mint)),
        ...read.rewards.filter(r => r).map(r => r.vault), ...read.vestings.map(v => v.address)];
      const snapshot = await rpc.getAccounts(keys);
      captures.push({ categories: kinds, position, pool: read.poolAddress, slot: snapshot.slot.toString(), keys,
        accounts: snapshot.accounts.map(a => a ? { owner: a.owner, executable: a.executable, lamports: a.lamports?.toString(), data: Buffer.from(a.data).toString('base64') } : null) });
    }
    console.log(`Unsigned simulation passed: ${kinds.join('+')} ${position}: ${record.actions}; ${record.unitsConsumed} CU, ${record.bytes} bytes; nothing signed or sent.`);
  } catch (error) {
    attempts.push({ position, source: candidate.source, error: error.message.split('\n')[0] });
    console.log(`Skipped ${position}: ${attempts.at(-1).error}`); await save();
  }
}
await save();
if (process.env.DAMM_CAPTURE === '1') {
  await mkdir('tests/fixtures/meteora-damm', { recursive: true });
  await writeFile('tests/fixtures/meteora-damm/mainnet.json', JSON.stringify({ provenance: { source: 'Solana mainnet-beta read-only getMultipleAccounts',
    sourceCommit: metadata.sourceCommit, capturedAt: new Date().toISOString(), clock: { slot: now.slot.toString(), unixTimestamp: now.time.toString() } }, captures }, null, 2) + '\n');
}
if (!passed.size) throw new Error(`No usable mainnet simulation in ${attempts.length} positions; inspect the report.`);
console.log(`Passed categories: ${JSON.stringify(Object.fromEntries(passed))}; report: .cache/meteora-damm-mainnet-simulation.json`);
