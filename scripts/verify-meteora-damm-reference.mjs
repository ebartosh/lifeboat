// Optional independent differential check against the official MIT DAMM v2 SDK. Install it only in the ignored cache:
// npm.cmd install --prefix .cache/meteora-damm-reference --ignore-scripts --no-audit --no-fund --save-exact @meteora-ag/cp-amm-sdk@1.5.1
// node --import tsx scripts/verify-meteora-damm-reference.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { address } from '@solana/kit';
import capture from '../tests/fixtures/meteora-damm/mainnet.json' with { type: 'json' };
import { dammFixture } from '../tests/fixtures/meteora-damm.ts';
import { LIQUIDITY } from '../tests/fixtures/meteora-damm.ts';
import { decodeAccount, PROGRAM, SIZES } from '../src/protocols/meteora-damm/codec.ts';
import idl from '../src/protocols/meteora-damm/cp_amm.idl.json' with { type: 'json' };
import { eventAuthorityAddress, nftAccountAddress, positionAddress } from '../src/protocols/meteora-damm/instructions.ts';
import { pendingFees, pendingRewards, removalAmounts, vestingRelease } from '../src/protocols/meteora-damm/math.ts';
import metadata from '../src/protocols/meteora-damm/metadata.json' with { type: 'json' };
import { prepareWithdrawAll } from '../src/protocols/meteora-damm/withdraw.ts';
const require = createRequire(new URL('../.cache/meteora-damm-reference/package.json', import.meta.url));
const pkg = require('./node_modules/@meteora-ag/cp-amm-sdk/package.json');
assert.equal(pkg.version, metadata.sdkVersion); assert.equal(pkg.license, 'MIT');
const sdk = require('@meteora-ag/cp-amm-sdk');
const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');
// The SDK's bundled IDL is the one Lifeboat bundles.
assert.deepEqual(sdk.CpAmmIdl, idl);
// No request is made: the connection only backs the Anchor program used to build instructions.
const program = new sdk.CpAmm(new Connection('http://127.0.0.1:9'))._program;
const pk = key => new PublicKey(key), big = value => BigInt(value.toString()), report = [];
const bytes32 = value => Buffer.from(value).toString('hex');
assert.equal(sdk.derivePoolAuthority().toBase58(), idl.instructions.find(i => i.name === 'remove_all_liquidity').accounts[0].address);
assert.equal(PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], pk(PROGRAM))[0].toBase58(), await eventAuthorityAddress());

// Decoders, PDAs and amounts over the captured mainnet positions.
const now = BigInt(capture.provenance.clock.unixTimestamp), slot = BigInt(capture.provenance.clock.slot);
for (const c of capture.captures) {
  const accounts = new Map(c.keys.map((k, i) => [k, c.accounts[i] && { owner: address(c.accounts[i].owner), executable: false, data: new Uint8Array(Buffer.from(c.accounts[i].data, 'base64')) }]));
  const raw = key => Buffer.from(accounts.get(key).data);
  const position = decodeAccount('Position', accounts.get(c.position)), pool = decodeAccount('Pool', accounts.get(c.pool));
  const ref = program.coder.accounts.decode('position', raw(c.position)), refPool = program.coder.accounts.decode('pool', raw(c.pool));
  for (const [ours, theirs] of [['unlocked_liquidity', 'unlockedLiquidity'], ['vested_liquidity', 'vestedLiquidity'], ['permanent_locked_liquidity', 'permanentLockedLiquidity'],
    ['fee_a_pending', 'feeAPending'], ['fee_b_pending', 'feeBPending']]) assert.equal(position[ours], big(ref[theirs]), ours);
  assert.equal(position.nft_mint, ref.nftMint.toBase58()); assert.equal(position.pool, ref.pool.toBase58());
  assert.equal(bytes32(position.fee_a_per_token_checkpoint), bytes32(ref.feeAPerTokenCheckpoint));
  for (const key of ['cliffPoint', 'periodFrequency', 'cliffUnlockLiquidity', 'liquidityPerPeriod', 'totalReleasedLiquidity'])
    assert.equal(position.inner_vesting[key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())], big(ref.innerVesting[key]), key);
  ref.rewardInfos.forEach((r, i) => assert.equal(position.reward_infos[i].reward_pendings, big(r.rewardPendings)));
  for (const [ours, theirs] of [['token_a_mint', 'tokenAMint'], ['token_b_mint', 'tokenBMint'], ['token_a_vault', 'tokenAVault'], ['token_b_vault', 'tokenBVault']])
    assert.equal(pool[ours], refPool[theirs].toBase58(), ours);
  for (const [ours, theirs] of [['liquidity', 'liquidity'], ['sqrt_min_price', 'sqrtMinPrice'], ['sqrt_max_price', 'sqrtMaxPrice'], ['sqrt_price', 'sqrtPrice'],
    ['activation_point', 'activationPoint'], ['token_a_amount', 'tokenAAmount'], ['token_b_amount', 'tokenBAmount']]) assert.equal(pool[ours], big(refPool[theirs]), ours);
  for (const key of ['activationType', 'collectFeeMode', 'tokenAFlag', 'tokenBFlag', 'poolStatus']) assert.equal(pool[key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())], refPool[key], key);
  refPool.rewardInfos.forEach((r, i) => { const o = pool.reward_infos[i];
    assert.equal(o.initialized, r.initialized); assert.equal(o.mint, r.mint.toBase58()); assert.equal(o.vault, r.vault.toBase58());
    assert.equal(o.reward_rate, big(r.rewardRate)); assert.equal(o.reward_duration_end, big(r.rewardDurationEnd)); assert.equal(o.last_update_time, big(r.lastUpdateTime)); });
  assert.equal(await positionAddress(position.nft_mint), sdk.derivePositionAddress(ref.nftMint).toBase58());
  assert.equal(c.position, sdk.derivePositionAddress(ref.nftMint).toBase58());
  assert.equal(await nftAccountAddress(position.nft_mint), sdk.derivePositionNftAccount(ref.nftMint).toBase58());
  // Fees and rewards at the captured time, and removal amounts for the unlocked liquidity.
  const quote = sdk.getUnClaimLpFee(refPool, ref, new BN(now.toString())), fees = pendingFees(pool, position), rewards = pendingRewards(pool, position, now);
  assert.equal(fees.a, big(quote.feeTokenA)); assert.equal(fees.b, big(quote.feeTokenB));
  quote.rewards.forEach((r, i) => assert.equal(rewards[i], big(r), `reward ${i}`));
  const amounts = removalAmounts(pool, position.unlocked_liquidity), L = ref.unlockedLiquidity;
  assert.equal(amounts.a, big(sdk.getAmountAFromLiquidityDelta(refPool.sqrtPrice, refPool.sqrtMaxPrice, L, sdk.Rounding.Down, refPool.collectFeeMode, refPool.tokenAAmount, refPool.liquidity)));
  assert.equal(amounts.b, big(sdk.getAmountBFromLiquidityDelta(refPool.sqrtMinPrice, refPool.sqrtPrice, L, sdk.Rounding.Down, refPool.collectFeeMode, refPool.tokenBAmount, refPool.liquidity)));
  const point = pool.activation_type === 0 ? slot : now;
  for (const key of c.keys.filter(k => accounts.get(k)?.owner === PROGRAM && accounts.get(k).data.length === SIZES.Vesting)) {
    const vesting = decodeAccount('Vesting', accounts.get(key)), theirs = program.coder.accounts.decode('vesting', raw(key));
    assert.equal(vesting.position, theirs.position.toBase58());
    assert.equal(vestingRelease(vesting.inner_vesting, point), big(sdk.getAvailableVestingLiquidity(theirs, new BN(point.toString()))), 'vesting release');
  }
  report.push({ position: c.position, categories: c.categories, decodersPdaFeesRewardsAmountsVesting: 'match' });
}

// Instruction bytes and account roles for every action Lifeboat builds.
const scenarios = [{}, { rewards: 2, rewardPending: 3n, frozenRewardVault: true }, { missingAta: true, token2022: true, transferFee: true, rewards: 1, rewardPending: 1n },
  { vestings: [{ cliff: 500n, cliffUnlock: LIQUIDITY }, { cliff: 600n, frequency: 100n, cliffUnlock: 0n, perPeriod: LIQUIDITY, periods: 2 }] },
  { unlocked: 0n, permanent: LIQUIDITY, feePending: [1n, 2n] }, { nftInAta: true, compounding: true }];
for (const options of scenarios) {
  const f = await dammFixture(options), plan = await prepareWithdrawAll({ rpc: f.rpc, wallet: f.wallet, position: f.positionKey });
  const p = plan.position, own = plan.instructions.filter(ix => ix.programAddress === PROGRAM), wallet = pk(f.wallet);
  assert.equal(own.length, plan.actions.length);
  for (const [i, action] of plan.actions.entries()) {
    const base = { pool: pk(p.poolAddress), position: pk(p.address), positionNftAccount: pk(p.nftAccount) };
    const pair = { ...base, poolAuthority: sdk.derivePoolAuthority(), signer: wallet, tokenAAccount: pk(p.tokens[0].ata), tokenBAccount: pk(p.tokens[1].ata),
      tokenAVault: pk(p.pool.token_a_vault), tokenBVault: pk(p.pool.token_b_vault), tokenAMint: pk(p.tokens[0].mint), tokenBMint: pk(p.tokens[1].mint),
      tokenAProgram: sdk.getTokenProgram(p.pool.token_a_flag), tokenBProgram: sdk.getTokenProgram(p.pool.token_b_flag) };
    const reward = action.kind === 'reward' ? p.rewards[action.rewardIndex] : null;
    const method = action.kind === 'refresh' ? program.methods.refreshVesting().accountsPartial({ ...base, owner: wallet })
        .remainingAccounts(p.vestings.filter(v => v.release > 0n).map(v => ({ pubkey: pk(v.address), isSigner: false, isWritable: true })))
      : action.kind === 'fees' ? program.methods.claimPositionFee().accountsPartial(pair)
      : action.kind === 'remove' ? program.methods.removeAllLiquidity(new BN(0), new BN(0)).accountsPartial(pair)
      : action.kind === 'reward' ? program.methods.claimReward(action.rewardIndex, action.skipReward ? 1 : 0).accountsPartial({ ...base, signer: wallet,
        poolAuthority: sdk.derivePoolAuthority(), rewardVault: pk(reward.vault), rewardMint: pk(reward.mint), userTokenAccount: pk(reward.ata),
        tokenProgram: sdk.getTokenProgram(p.pool.reward_infos[action.rewardIndex].reward_token_flag) })
      : program.methods.closePosition().accountsPartial({ ...base, positionNftMint: pk(p.state.nft_mint), poolAuthority: sdk.derivePoolAuthority(),
        rentReceiver: wallet, owner: wallet, tokenProgram: pk('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') });
    const built = await method.instruction();
    assert.deepEqual(Buffer.from(own[i].data), built.data, `${action.kind} data`);
    assert.deepEqual(own[i].accounts.map(a => [a.address, !!(a.role & 2), !!(a.role & 1)]), built.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), `${action.kind} accounts`);
  }
  report.push({ options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, typeof v === 'object' ? 'set' : String(v)])),
    actions: plan.actions.map(a => a.kind).join(','), instructions: 'match' });
}
await writeFile('.cache/meteora-damm-reference/report.json', JSON.stringify({ sdkVersion: pkg.version, license: pkg.license, checks: report, networkCalls: 0 }, null, 2));
console.log(`Official SDK comparison passed: ${report.length} checks; no network calls.`);
