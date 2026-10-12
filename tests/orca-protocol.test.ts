import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AccountRole, getTransactionEncoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { PACKET_BUDGET } from '../src/core/packing';
import { tokenSymbol } from '../src/core/format';
import { executeSafeTransaction } from '../src/core/transaction';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/core/tokens';
import { validateOrcaStep } from '../src/mobile/pending-store';
import { executeOrcaWithRpc, type OrcaOperation } from '../src/operations/orca';
import { OrcaAdapter } from '../src/protocols/orca/adapter';
import { decodeAccount, DISCRIMINATORS, PROGRAM, type PositionState, type TickArrayState, type WhirlpoolState } from '../src/protocols/orca/codec';
import { INSTRUCTIONS, positionAddress, positionBundleAddress, tickArrayAddress, whirlpoolInstruction } from '../src/protocols/orca/instructions';
import { amountDeltaA, amountDeltaB, liquidityAmounts, sqrtPriceFromTickIndex, tickArrayStartIndex } from '../src/protocols/orca/math';
import { closeHold, prepareWithdrawAll, totalReceipts, withdrawalActions } from '../src/protocols/orca/withdraw';
import metadata from '../src/protocols/orca/metadata.json';
import { testWalletSigning } from './fixtures/signer';
import { CONFIG, disc, LOOSE_NFT_ACCOUNT, orcaFixture, P, POSITION_MINT, REWARD_VAULTS, REWARDS, SOL, TICK_ARRAY_WHIRLPOOL,
  tickOffset, VAULT_A, VAULT_B, W } from './fixtures/orca';
import { pubkey, Q64, u128, u64, USDC } from './fixtures/meteora';

const adapter = new OrcaAdapter();
const operation = (wallet: OrcaOperation['wallet'], position: OrcaOperation['position']): OrcaOperation =>
  ({ version: 1, protocol: 'orca', id: 'orca-test', wallet, position, rpcUrl: 'https://example.com', createdAt: 1, completed: [] });
async function approveAll(f: Awaited<ReturnType<typeof orcaFixture>>) {
  return executeOrcaWithRpc(f.rpc, { wallet: f.signer.address, signWithWallet: testWalletSigning(f.signer), operation: operation(f.signer.address, f.positionKey),
    confirm: async () => true, beforeSend: async () => {}, confirmed: async () => {} },
  options => executeSafeTransaction({ ...options, pollIntervalMs: 0, timeoutMs: 0 }));
}
describe('Orca pinned protocol', () => {
  it('pins the Apache-2.0 IDL hash, SDK release and source commit', () => {
    expect(createHash('sha256').update(readFileSync('src/protocols/orca/whirlpool.idl.json')).digest('hex')).toBe(metadata.idlSha256);
    expect(metadata.sourceCommit).toMatch(/^[a-f0-9]{40}$/); expect(metadata.programId).toBe(PROGRAM);
    expect(metadata.license).toBe('Apache-2.0'); expect(metadata.idlVersion).toBe('0.3.4');
  });
  it('recomputes every Anchor account and instruction discriminator', () => {
    for (const [name, value] of Object.entries(DISCRIMINATORS)) expect([...disc('account:' + name)]).toEqual(value);
    const snake = (name: string) => name.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    for (const [name, value] of Object.entries(INSTRUCTIONS)) expect([...disc('global:' + snake(name))]).toEqual(value);
  });
  it('decodes Whirlpool, Position and fixed TickArray bytes at independent offsets', async () => {
    const f = await orcaFixture({ rewards: 1, feeOwed: [7n, 9n] });
    const pool = decodeAccount<WhirlpoolState>('Whirlpool', f.rpc.accounts.get(f.poolKey));
    expect(pool).toMatchObject({ whirlpoolsConfig: CONFIG, tickSpacing: 64, tickSpacingSeed: [64, 0], liquidity: 5000n, sqrtPrice: Q64,
      tokenMintA: USDC, tokenVaultA: VAULT_A, feeGrowthGlobalA: 3n * Q64, tokenMintB: SOL, tokenVaultB: VAULT_B, rewardLastUpdatedTimestamp: 100n });
    expect(pool.rewardInfos[0]).toMatchObject({ mint: REWARDS[0], vault: REWARD_VAULTS[0], growthGlobalX64: 2n * Q64 });
    const position = decodeAccount<PositionState>('Position', f.rpc.accounts.get(f.positionKey));
    expect(position).toMatchObject({ whirlpool: f.poolKey, positionMint: POSITION_MINT, liquidity: 1000n, tickLowerIndex: -128, tickUpperIndex: 128,
      feeOwedA: 7n, feeOwedB: 9n });
    const array = decodeAccount<TickArrayState>('TickArray', f.rpc.accounts.get(await tickArrayAddress(f.poolKey, -5632)));
    expect(array.startTickIndex).toBe(-5632); expect(array.whirlpool).toBe(f.poolKey); expect(array.ticks[86]!.initialized).toBe(true);
    const data = f.rpc.accounts.get(f.positionKey)!.data;
    expect(() => decodeAccount('Position', { ...f.rpc.accounts.get(f.positionKey)!, data: data.slice(0, -1) })).toThrow(/truncated/);
    expect(() => decodeAccount('Position', { ...f.rpc.accounts.get(f.positionKey)!, data: Uint8Array.of(...data, 0) })).toThrow(/length/);
    data[0] = 0; expect(() => decodeAccount('Position', f.rpc.accounts.get(f.positionKey))).toThrow(/discriminator/);
    expect(TICK_ARRAY_WHIRLPOOL + 32).toBe(9988); expect(tickOffset(88)).toBe(TICK_ARRAY_WHIRLPOOL);
  });
  it('derives pinned PDAs and tick array start indexes, including negative ticks', async () => {
    expect(tickArrayStartIndex(-128, 64)).toBe(-5632); expect(tickArrayStartIndex(5631, 64)).toBe(0); expect(tickArrayStartIndex(-1, 1)).toBe(-88);
    expect(tickArrayStartIndex(-443636, 1)).toBe(-443696);
    expect(await positionAddress(POSITION_MINT)).not.toBe(await positionBundleAddress(POSITION_MINT));
  });
  it('ports the pinned tick and token math', () => {
    expect(sqrtPriceFromTickIndex(0)).toBe(Q64);
    expect(sqrtPriceFromTickIndex(-443636)).toBe(4295048016n);
    expect(sqrtPriceFromTickIndex(443636)).toBe(79226673515401279992447579055n);
    const lower = sqrtPriceFromTickIndex(-128), upper = sqrtPriceFromTickIndex(128);
    expect(amountDeltaA(upper, lower, 10n ** 12n)).toBe(amountDeltaA(lower, upper, 10n ** 12n));
    expect(amountDeltaB(lower, upper, Q64)).toBe(upper - lower);
    const position = { tickLowerIndex: -128, tickUpperIndex: 128, liquidity: 10n ** 12n };
    expect(liquidityAmounts({ tickCurrentIndex: -200, sqrtPrice: sqrtPriceFromTickIndex(-200) }, position).b).toBe(0n);
    expect(liquidityAmounts({ tickCurrentIndex: 200, sqrtPrice: sqrtPriceFromTickIndex(200) }, position).a).toBe(0n);
    expect(liquidityAmounts({ tickCurrentIndex: 0, sqrtPrice: Q64 }, { ...position, liquidity: 0n })).toEqual({ a: 0n, b: 0n });
  });
  it('treats an overflowing fee product as zero, as checked_mul_shift_right(..).unwrap_or(0) does on chain', async () => {
    const f = await orcaFixture();
    // A checkpoint above the growth inside wraps the delta near 2^128; liquidity × delta then overflows u128.
    u128(f.rpc.accounts.get(f.positionKey)!.data, P.checkpointA, 4n * Q64);
    const position = (await adapter.readPosition(f.rpc, f.signer.address, f.positionKey))!;
    expect(position.owed.feeA).toBe(0n); expect(position.owed.feeB).toBe(5000n);
  });
  it('builds exact instruction bytes and IDL account roles with no transfer-hook accounts', () => {
    const k = (n: number) => `1111111111111111111111111111111${'BCDEFGHJKLMNPQRS'[n]}` as never;
    const names = ['whirlpool', 'tokenProgramA', 'tokenProgramB', 'memoProgram', 'positionAuthority', 'position', 'positionTokenAccount',
      'tokenMintA', 'tokenMintB', 'tokenOwnerAccountA', 'tokenOwnerAccountB', 'tokenVaultA', 'tokenVaultB', 'tickArrayLower', 'tickArrayUpper'];
    const ix = whirlpoolInstruction('decreaseLiquidityV2', Object.fromEntries(names.map((n, i) => [n, k(i)])), { liquidity: (1n << 64n) + 5n });
    expect([...ix.data!]).toEqual([...INSTRUCTIONS.decreaseLiquidityV2, 5, 0, 0, 0, 0, 0, 0, 0, 1, ...new Array(7).fill(0), ...new Array(16).fill(0), 0]);
    expect(ix.accounts!.map(a => a.role)).toEqual([AccountRole.WRITABLE, 0, 0, 0, AccountRole.READONLY_SIGNER, AccountRole.WRITABLE, 0, 0, 0,
      AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE, AccountRole.WRITABLE]);
    expect([...whirlpoolInstruction('collectRewardV2', Object.fromEntries(['whirlpool', 'positionAuthority', 'position', 'positionTokenAccount',
      'rewardOwnerAccount', 'rewardMint', 'rewardVault', 'rewardTokenProgram', 'memoProgram'].map((n, i) => [n, k(i)])), { rewardIndex: 2 }).data!])
      .toEqual([...INSTRUCTIONS.collectRewardV2, 2, 0]);
    expect(() => whirlpoolInstruction('decreaseLiquidityV2', {}, { liquidity: 0n })).toThrow(/liquidity/);
    expect(() => whirlpoolInstruction('collectRewardV2', {}, { rewardIndex: 3 })).toThrow(/reward index/);
    expect(() => whirlpoolInstruction('collectFeesV2', {})).toThrow(/missing instruction account/);
  });
});
describe('Orca discovery and validation', () => {
  it('finds position NFTs from wallet token accounts without a program-wide scan', async () => {
    const f = await orcaFixture({ rewards: 2 });
    const statuses = await adapter.getStatus(f.rpc, f.signer.address);
    expect(statuses).toHaveLength(1); expect(statuses[0]).toMatchObject({ address: f.positionKey, kind: 'position', poolAddress: f.poolKey });
    expect(statuses[0]!.reason).toBeUndefined();
    expect(f.rpc.tokenQueries).toEqual([{ programId: TOKEN_PROGRAM }, { programId: TOKEN_2022_PROGRAM }]);
    const position = statuses[0]!.position!;
    expect(position.ticksKnown).toBe(true);
    expect(position.owed).toEqual({ feeA: 3000n, feeB: 5000n, rewards: [2000n, 2000n, 0n] });
    expect(position.rentRefund).toBe(2_394_240n + 2_039_280n);
  });
  it('finds a Token-2022 NFT outside its ATA and refunds the closed mint', async () => {
    const f = await orcaFixture({ nft2022: true, looseNft: true });
    const status = (await adapter.getStatus(f.rpc, f.signer.address))[0]!;
    expect(status.position?.tokenAccount).toBe(LOOSE_NFT_ACCOUNT);
    expect(status.position?.rentRefund).toBe(2_394_240n + 2_039_280n + 1_461_600n);
    const later = await adapter.readPosition(f.rpc, f.signer.address, f.positionKey);
    expect(later?.tokenAccount).toBe(LOOSE_NFT_ACCOUNT); expect(f.rpc.tokenQueries.at(-1)).toEqual({ mint: POSITION_MINT });
  });
  it('lists position bundles as unsupported', async () => {
    const f = await orcaFixture();
    const bundle = await positionBundleAddress(POSITION_MINT), data = new Uint8Array(72); data.set(disc('account:PositionBundle'));
    f.rpc.accounts.delete(f.positionKey); f.rpc.accounts.set(bundle, { owner: PROGRAM, executable: false, data, lamports: 1n });
    expect(await adapter.getStatus(f.rpc, f.signer.address)).toEqual([{ address: bundle, kind: 'bundle', reason: expect.stringMatching(/bundles are unsupported/) }]);
  });
  it.each(['network', 'locked', 'mint program', 'vault', 'pool', 'array', 'program', 'owner', 'close authority', 'uninitialized reward'])(
    'keeps a %s mismatch visible with a reason', async kind => {
      const f = await orcaFixture({ rewards: 1 }), pos = f.rpc.accounts.get(f.positionKey)!, pool = f.rpc.accounts.get(f.poolKey)!;
      if (kind === 'network') { f.rpc.genesis = 'devnet'; await expect(adapter.getStatus(f.rpc, f.signer.address)).rejects.toThrow(/mainnet/); return; }
      if (kind === 'locked') f.rpc.accounts.get(f.nftAccount)!.data[108] = 2;
      if (kind === 'mint program') f.rpc.accounts.get(USDC)!.owner = TOKEN_2022_PROGRAM;
      if (kind === 'vault') pubkey(f.rpc.accounts.get(VAULT_A)!.data, 32, VAULT_B);
      if (kind === 'pool') pool.data[W.seed] = 1;
      if (kind === 'array') pubkey(f.rpc.accounts.get(await tickArrayAddress(f.poolKey, 0))!.data, TICK_ARRAY_WHIRLPOOL, VAULT_A);
      if (kind === 'program') f.rpc.accounts.get(PROGRAM)!.executable = false;
      if (kind === 'owner') pubkey(f.rpc.accounts.get(f.nftAccount)!.data, 32, VAULT_A);
      if (kind === 'close authority') { const d = f.rpc.accounts.get(f.nftAccount)!.data; new DataView(d.buffer).setUint32(129, 1, true); pubkey(d, 133, VAULT_A); }
      if (kind === 'uninitialized reward') { pool.data.fill(0, W.reward(0), W.reward(0) + 32); u64(pos.data, P.reward(0) + 16, 1n); }
      const statuses = await adapter.getStatus(f.rpc, f.signer.address);
      if (kind === 'owner') { expect(statuses).toEqual([]); return; }
      expect(statuses[0]?.reason).toMatch({ locked: /locked/, 'mint program': /mismatch/, vault: /authority/, pool: /PDA/, array: /tick array/,
        program: /executable/, 'close authority': /close authority/, 'uninitialized reward': /uninitialized reward/ }[kind]!);
    });
});
describe('Orca withdrawal plan', () => {
  it('withdraws, collects and closes a position in one transaction', async () => {
    const f = await orcaFixture({ rewards: 1 });
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    expect(plan.step.id).toBe('remove,fees,reward:0,close'); expect(plan.remainingSteps).toBe(1); expect(plan.closeHold).toBeNull();
    expect(validateOrcaStep(plan.step)).toEqual(plan.step);
    const result = await approveAll(f);
    expect(result.status).toBe('confirmed'); expect(f.rpc.sent).toHaveLength(1);
    expect(f.rpc.accounts.get(f.positionKey)).toBeNull(); expect(f.rpc.accounts.get(f.nftAccount)).toBeNull();
  });
  it('measures receipts on the wallet accounts and matches the estimate', async () => {
    const f = await orcaFixture({ rewards: 1 });
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    f.rpc.removal = [plan.position.liquidity.a, plan.position.liquidity.b];
    const simulation = await f.rpc.simulateTransaction(await compile(f, plan.instructions), plan.simulationAccounts);
    plan.validateSimulation(simulation);
    expect(plan.receipts.map(r => [r.symbol, r.amount])).toEqual(totalReceipts(plan.position).map(r => [r.symbol, r.amount]));
  });
  it('splits three rewards with missing ATAs into packet-sized transactions', async () => {
    const f = await orcaFixture({ rewards: 3, missingAta: true, token2022: true, transferFee: true, nft2022: true });
    const result = await approveAll(f);
    expect(result.status).toBe('confirmed'); expect(f.rpc.sent.length).toBeGreaterThan(1);
    expect(f.rpc.sent.every(tx => getTransactionEncoder().encode(tx).length <= PACKET_BUDGET)).toBe(true);
    expect(result.operation.completed.at(-1)!.step.actions.at(-1)!.kind).toBe('close');
    expect(f.rpc.accounts.get(POSITION_MINT)).toBeNull();
  });
  it('reports Token-2022 transfer fees as withheld amounts', async () => {
    const f = await orcaFixture({ token2022: true, transferFee: true });
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    plan.validateSimulation(await f.rpc.simulateTransaction(await compile(f, plan.instructions), plan.simulationAccounts));
    const usdc = plan.receipts.find(r => r.mint === USDC)!;
    expect(usdc.transferFee).toBeGreaterThan(0n); expect(usdc.grossAmount).toBe(usdc.amount + usdc.transferFee);
    expect(totalReceipts(plan.position).find(r => r.mint === USDC)!.transferFee).toBeGreaterThan(0n);
  });
  it('defers the close when tick arrays use a format outside the pinned interface', async () => {
    const f = await orcaFixture({ rewards: 1, dynamicTicks: true });
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    expect(plan.position.ticksKnown).toBe(false); expect(plan.closeHold).toBe('after-removal');
    expect(plan.step.id).toBe('remove,fees,reward:0'); expect(plan.remainingSteps).toBe(2);
    const result = await approveAll(f);
    expect(result.status).toBe('confirmed'); expect(result.operation.completed.map(c => c.step.id)).toEqual(['remove,fees,reward:0', 'close']);
  });
  it('closes in the same transaction when no reward is initialized, whatever the tick array format', async () => {
    const f = await orcaFixture({ dynamicTicks: true });
    expect(closeHold((await adapter.readPosition(f.rpc, f.signer.address, f.positionKey))!)).toBeNull();
    expect((await approveAll(f)).operation.completed).toHaveLength(1);
  });
  it('keeps the position open when a reward vault holds less than owed and stops once nothing is collectable', async () => {
    const f = await orcaFixture({ rewards: 1, rewardVaultAmount: 500n });
    const position = (await adapter.readPosition(f.rpc, f.signer.address, f.positionKey))!;
    expect(closeHold(position)).toBe('reward-vault'); expect(withdrawalActions(position).map(a => a.id)).toEqual(['remove', 'fees', 'reward:0']);
    await expect(approveAll(f)).rejects.toThrow(/reward vault holds less/);
    expect(f.rpc.sent).toHaveLength(1); expect(f.rpc.accounts.get(f.positionKey)).not.toBeNull();
  });
  it('skips collecting a reward that owes nothing and has no emissions, and still collects one that emits', async () => {
    const f = await orcaFixture({ rewards: 1 });
    const pool = f.rpc.accounts.get(f.poolKey)!.data;
    u128(pool, W.reward(0) + 112, 0n);
    const settled = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    expect(settled.step.id).toBe('remove,fees,close'); expect(settled.remainingReceipts.map(r => r.mint)).toEqual([USDC, SOL]);
    expect((await approveAll(f)).status).toBe('confirmed');
    const emitting = await orcaFixture({ rewards: 1 });
    const data = emitting.rpc.accounts.get(emitting.poolKey)!.data;
    u128(data, W.reward(0) + 112, 0n); u128(data, W.reward(0) + 96, 1n);
    expect((await prepareWithdrawAll({ rpc: emitting.rpc, wallet: emitting.signer.address, position: emitting.positionKey }))!.step.id)
      .toBe('remove,fees,reward:0,close');
    const unknown = await orcaFixture({ rewards: 1, dynamicTicks: true });
    u128(unknown.rpc.accounts.get(unknown.poolKey)!.data, W.reward(0) + 112, 0n);
    expect((await prepareWithdrawAll({ rpc: unknown.rpc, wallet: unknown.signer.address, position: unknown.positionKey }))!.step.id)
      .toBe('remove,fees,reward:0');
  });
  it('names the ORCA reward mint without off-chain metadata', () => {
    expect(tokenSymbol('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE' as never)).toBe('ORCA');
  });
  it('closes an already empty position and collects stored fees without liquidity', async () => {
    const empty = await orcaFixture({ liquidity: 0n });
    expect((await prepareWithdrawAll({ rpc: empty.rpc, wallet: empty.signer.address, position: empty.positionKey }))!.step.id).toBe('close');
    const owed = await orcaFixture({ liquidity: 0n, feeOwed: [4n, 0n], rewards: 1, rewardOwed: 3n });
    expect((await prepareWithdrawAll({ rpc: owed.rpc, wallet: owed.signer.address, position: owed.positionKey }))!.step.id).toBe('fees,reward:0,close');
  });
  it('rejects simulations that do not empty the position or that reduce a wallet balance', async () => {
    const f = await orcaFixture();
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    const tx = await compile(f, plan.instructions);
    f.rpc.mutateSimulation = accounts => accounts.set(f.positionKey, f.rpc.accounts.get(f.positionKey)!);
    const validate = async () => plan.validateSimulation(await f.rpc.simulateTransaction(tx, plan.simulationAccounts));
    await expect(validate()).rejects.toThrow(/did not close/);
    f.rpc.mutateSimulation = accounts => u64(accounts.get(plan.position.tokens[0]!.ata)!.data, 64, 1n);
    await expect(validate()).rejects.toThrow(/reduced the wallet token balance/);
  });
  it('does not require reward collections to empty owed rewards in a step without close', async () => {
    const f = await orcaFixture({ rewards: 1, dynamicTicks: true });
    const plan = (await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey }))!;
    const tx = await compile(f, plan.instructions);
    f.rpc.mutateSimulation = accounts => u64(accounts.get(f.positionKey)!.data, P.reward(0) + 16, 9n);
    const validate = async () => plan.validateSimulation(await f.rpc.simulateTransaction(tx, plan.simulationAccounts));
    await expect(validate()).resolves.toBeUndefined();
    f.rpc.mutateSimulation = accounts => u128(accounts.get(f.positionKey)!.data, P.liquidity, 1n);
    await expect(validate()).rejects.toThrow(/remove all liquidity/);
  });
  it('blocks continuation when a confirmed removal is not visible', async () => {
    const f = await orcaFixture({ rewards: 1, dynamicTicks: true });
    const op = operation(f.signer.address, f.positionKey);
    op.completed = [{ step: { id: 'remove', actions: [{ id: 'remove', kind: 'remove' }] }, signature: '1'.repeat(64) as never }];
    await expect(executeOrcaWithRpc(f.rpc, { wallet: f.signer.address, signWithWallet: testWalletSigning(f.signer), operation: op,
      confirm: async () => true, beforeSend: async () => {}, confirmed: async () => {} })).rejects.toThrow(/not visible/);
    expect(f.rpc.sent).toHaveLength(0);
  });
});
async function compile(f: Awaited<ReturnType<typeof orcaFixture>>, instructions: Parameters<typeof executeSafeTransaction>[0]['instructions']) {
  const { appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage, pipe, setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash } = await import('@solana/kit');
  return compileTransaction(pipe(createTransactionMessage({ version: 'legacy' }), m => setTransactionMessageFeePayer(f.signer.address, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstructions(instructions!, m)));
}
