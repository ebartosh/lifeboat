// Optional independent differential check against the last Apache-2.0 Orca SDK. Install it only in the ignored cache
// (exact versions; @orca-so/common-sdk 0.6.10 is MIT):
// npm.cmd install --prefix .cache/orca-reference --ignore-scripts --no-audit --no-fund --save-exact @orca-so/whirlpools-sdk@0.13.16 @orca-so/common-sdk@0.6.10 @coral-xyz/anchor@0.29.0 @solana/web3.js@1.98.0 @solana/spl-token@0.4.12 decimal.js@10.5.0
// node --import tsx scripts/verify-orca-reference.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { orcaFixture, P, SOL, tickOffset, W } from '../tests/fixtures/orca.ts';
import { u128, u64, i32, Q64, USDC } from '../tests/fixtures/meteora.ts';
import { OrcaAdapter } from '../src/protocols/orca/adapter.ts';
import { decodeAccount, PROGRAM } from '../src/protocols/orca/codec.ts';
import { positionAddress, positionBundleAddress, tickArrayAddress, whirlpoolAddress } from '../src/protocols/orca/instructions.ts';
import { sqrtPriceFromTickIndex, tickArrayStartIndex } from '../src/protocols/orca/math.ts';
import { prepareWithdrawAll } from '../src/protocols/orca/withdraw.ts';
const require = createRequire(new URL('../.cache/orca-reference/package.json', import.meta.url));
const pkg = require('./node_modules/@orca-so/whirlpools-sdk/package.json');
assert.equal(pkg.version, '0.13.16'); assert.equal(pkg.license, 'Apache-2.0');
assert.equal(require('./node_modules/@orca-so/common-sdk/package.json').license, 'MIT');
const sdk = require('@orca-so/whirlpools-sdk');
const { Percentage } = require('@orca-so/common-sdk');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { Wallet } = require('@coral-xyz/anchor');
const BN = require('bn.js');
// No request is made: the connection only backs the Anchor program used to build instructions.
const ctx = sdk.WhirlpoolContext.from(new Connection('http://127.0.0.1:9'), new Wallet(Keypair.generate()), new PublicKey(PROGRAM));
const pk = key => new PublicKey(key), big = bn => BigInt(bn.toString()), report = [];
const info = account => ({ ...account, owner: pk(account.owner), data: Buffer.from(account.data), lamports: Number(account.lamports ?? 0) });
// Price math and PDAs over a spread of ticks, spacings and keys.
for (const tick of [-443636, -300000, -12345, -129, -1, 0, 1, 64, 777, 98765, 443636])
  assert.equal(sqrtPriceFromTickIndex(tick), big(sdk.PriceMath.tickIndexToSqrtPriceX64(tick)), `sqrt price ${tick}`);
for (const spacing of [1, 2, 4, 8, 16, 64, 96, 128, 256, 32896]) for (const tick of [-443636, -5633, -5632, -1, 0, 5631, 443636])
  assert.equal(tickArrayStartIndex(tick, spacing), sdk.TickUtil.getStartTickIndex(tick, spacing), `start ${tick}/${spacing}`);
report.push({ check: 'sqrt price and tick array start index', result: 'match' });
const scenarios = [{ rewards: 1 }, { rewards: 3, tick: -200 }, { rewards: 2, tick: 300, nft2022: true }, { liquidity: 0n, feeOwed: [4n, 5n], rewards: 1, rewardOwed: 3n },
  { rewards: 1, missingAta: true, token2022: true, transferFee: true, looseNft: true }];
for (const options of scenarios) {
  const f = await orcaFixture(options), pool = f.rpc.accounts.get(f.poolKey).data, pos = f.rpc.accounts.get(f.positionKey).data;
  // Exercise every growth-inside branch: outside growth on both ticks, time-based reward emissions, a nonzero checkpoint.
  u128(pool, W.sqrtPrice, big(sdk.PriceMath.tickIndexToSqrtPriceX64(options.tick ?? 0)));
  u64(pool, W.rewardTime, 40n); for (let i = 0; i < (options.rewards ?? 0); i++) u128(pool, W.reward(i) + 96, (7n + BigInt(i)) * Q64 / 3n);
  u128(pos, P.checkpointA, Q64 / 8n); u128(pos.subarray(P.reward(0)), 0, Q64 / 20n);
  const lowerArray = f.rpc.accounts.get(await tickArrayAddress(f.poolKey, -5632)).data, upperArray = f.rpc.accounts.get(await tickArrayAddress(f.poolKey, 0)).data;
  // Outside growth consistent with the price side, so growth inside stays above every checkpoint (as on chain).
  const tick = options.tick ?? 0;
  if (tick < 200) { u128(lowerArray, tickOffset(86) + 33, Q64 + 17n); u128(lowerArray, tickOffset(86) + 49, Q64 / 3n); u128(lowerArray, tickOffset(86) + 65, Q64 / 7n); }
  if (tick > -200) { u128(upperArray, tickOffset(2) + 33, Q64 / 4n); u128(upperArray, tickOffset(2) + 49, Q64 / 2n + 3n); u128(upperArray, tickOffset(2) + 65, Q64 / 9n); }
  const wp = sdk.ParsableWhirlpool.parse(pk(f.poolKey), info(f.rpc.accounts.get(f.poolKey)));
  const pd = sdk.ParsablePosition.parse(pk(f.positionKey), info(f.rpc.accounts.get(f.positionKey)));
  const ours = decodeAccount('Whirlpool', f.rpc.accounts.get(f.poolKey)), mine = decodeAccount('Position', f.rpc.accounts.get(f.positionKey));
  for (const key of ['tickSpacing', 'feeRate', 'protocolFeeRate', 'tickCurrentIndex']) assert.equal(ours[key], wp[key], key);
  for (const key of ['liquidity', 'sqrtPrice', 'feeGrowthGlobalA', 'feeGrowthGlobalB', 'rewardLastUpdatedTimestamp']) assert.equal(ours[key], big(wp[key]), key);
  for (const key of ['tokenMintA', 'tokenMintB', 'tokenVaultA', 'tokenVaultB', 'whirlpoolsConfig']) assert.equal(ours[key], wp[key].toBase58(), key);
  wp.rewardInfos.forEach((r, i) => { assert.equal(ours.rewardInfos[i].mint, r.mint.toBase58()); assert.equal(ours.rewardInfos[i].growthGlobalX64, big(r.growthGlobalX64));
    assert.equal(ours.rewardInfos[i].emissionsPerSecondX64, big(r.emissionsPerSecondX64)); });
  for (const key of ['liquidity', 'feeOwedA', 'feeOwedB', 'feeGrowthCheckpointA', 'feeGrowthCheckpointB']) assert.equal(mine[key], big(pd[key]), key);
  assert.equal(mine.tickLowerIndex, pd.tickLowerIndex); assert.equal(mine.positionMint, pd.positionMint.toBase58());
  pd.rewardInfos.forEach((r, i) => { assert.equal(mine.rewardInfos[i].amountOwed, big(r.amountOwed)); assert.equal(mine.rewardInfos[i].growthInsideCheckpoint, big(r.growthInsideCheckpoint)); });
  assert.equal(f.positionKey, sdk.PDAUtil.getPosition(pk(PROGRAM), pk(mine.positionMint)).publicKey.toBase58());
  assert.equal(await positionBundleAddress(mine.positionMint), sdk.PDAUtil.getPositionBundle(pk(PROGRAM), pk(mine.positionMint)).publicKey.toBase58());
  assert.equal(await whirlpoolAddress(ours.whirlpoolsConfig, USDC, SOL, ours.tickSpacingSeed),
    sdk.PDAUtil.getWhirlpool(pk(PROGRAM), pk(ours.whirlpoolsConfig), pk(USDC), pk(SOL), ours.tickSpacing).publicKey.toBase58());
  const position = await new OrcaAdapter().readPosition(f.rpc, f.signer.address, f.positionKey);
  const arrays = [position.tickArrays.lower, position.tickArrays.upper];
  for (const [i, start] of [-5632, 0].entries()) assert.equal(arrays[i], sdk.PDAUtil.getTickArray(pk(PROGRAM), pk(f.poolKey), start).publicKey.toBase58());
  const ticks = arrays.map((key, i) => sdk.ParsableTickArray.parse(pk(key), info(f.rpc.accounts.get(key))).ticks[i === 0 ? 86 : 2]);
  const extension = sdk.NO_TOKEN_EXTENSION_CONTEXT;
  if (mine.liquidity > 0n) {
    const quote = sdk.decreaseLiquidityQuoteByLiquidityWithParams({ liquidity: pd.liquidity, tickCurrentIndex: wp.tickCurrentIndex, sqrtPrice: wp.sqrtPrice,
      tickLowerIndex: pd.tickLowerIndex, tickUpperIndex: pd.tickUpperIndex, tokenExtensionCtx: extension, slippageTolerance: Percentage.fromFraction(0, 100) });
    assert.equal(position.liquidity.a, big(quote.tokenEstA)); assert.equal(position.liquidity.b, big(quote.tokenEstB));
    const fees = sdk.collectFeesQuote({ whirlpool: wp, position: pd, tickLower: ticks[0], tickUpper: ticks[1], tokenExtensionCtx: extension });
    assert.equal(position.owed.feeA, big(fees.feeOwedA)); assert.equal(position.owed.feeB, big(fees.feeOwedB));
    const rewards = sdk.collectRewardsQuote({ whirlpool: wp, position: pd, tickLower: ticks[0], tickUpper: ticks[1], tokenExtensionCtx: extension,
      timeStampInSeconds: new BN(position.timestamp.toString()) });
    rewards.rewardOwed.forEach((r, i) => { if (r) assert.equal(position.owed.rewards[i], big(r), `reward ${i}`); });
  }
  const plan = await prepareWithdrawAll({ rpc: f.rpc, wallet: f.signer.address, position: f.positionKey });
  const whirlpoolIxs = plan.instructions.filter(ix => ix.programAddress === PROGRAM);
  const [a, b] = position.tokens, wallet = pk(f.signer.address);
  for (const [i, item] of plan.step.actions.entries()) {
    const ix = whirlpoolIxs[i];
    const common = { whirlpool: pk(f.poolKey), position: pk(f.positionKey), positionTokenAccount: pk(position.tokenAccount), positionAuthority: wallet };
    const pair = { tokenMintA: pk(a.mint), tokenMintB: pk(b.mint), tokenOwnerAccountA: pk(a.ata), tokenOwnerAccountB: pk(b.ata),
      tokenVaultA: pk(ours.tokenVaultA), tokenVaultB: pk(ours.tokenVaultB), tokenProgramA: pk(a.token.program), tokenProgramB: pk(b.token.program) };
    const reward = item.kind === 'reward' ? position.rewards[item.rewardIndex] : null;
    const reference = item.kind === 'remove' ? sdk.WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, { ...common, ...pair, liquidityAmount: pd.liquidity,
      tokenMinA: new BN(0), tokenMinB: new BN(0), tickArrayLower: pk(arrays[0]), tickArrayUpper: pk(arrays[1]) })
      : item.kind === 'fees' ? sdk.WhirlpoolIx.collectFeesV2Ix(ctx.program, { ...common, ...pair })
      : item.kind === 'reward' ? sdk.WhirlpoolIx.collectRewardV2Ix(ctx.program, { ...common, rewardIndex: item.rewardIndex, rewardMint: pk(reward.mint),
        rewardOwnerAccount: pk(reward.ata), rewardVault: pk(reward.vault), rewardTokenProgram: pk(reward.token.program) })
      : (position.positionMint.program === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? sdk.WhirlpoolIx.closePositionWithTokenExtensionsIx : sdk.WhirlpoolIx.closePositionIx)(ctx.program,
        { receiver: wallet, position: pk(f.positionKey), positionMint: pk(mine.positionMint), positionTokenAccount: pk(position.tokenAccount), positionAuthority: wallet });
    const built = reference.instructions[0];
    assert.deepEqual(Buffer.from(ix.data), built.data, `${item.id} data`);
    assert.deepEqual(ix.accounts.map(x => [x.address, !!(x.role & 2), !!(x.role & 1)]), built.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), `${item.id} accounts`);
  }
  report.push({ options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, String(v)])), step: plan.step.id,
    decodersPdasAmountsFeesRewardsAndInstructions: 'match' });
}
await writeFile('.cache/orca-reference/report.json', JSON.stringify({ sdkVersion: pkg.version, license: pkg.license, checks: report, networkCalls: 0 }, null, 2));
console.log(`Official Apache-2.0 SDK comparison passed: ${report.length} checks; no network calls.`);
