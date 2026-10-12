// Optional independent differential check. Install SDK only in the ignored cache:
// npm.cmd install --prefix .cache/meteora-reference --ignore-scripts --no-audit --no-fund @meteora-ag/dlmm@1.9.14
// node --import tsx scripts/verify-meteora-reference.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { meteoraFixture, POSITION } from '../tests/fixtures/meteora.ts';
import { MeteoraAdapter } from '../src/protocols/meteora/adapter.ts';
import { prepareWithdrawAll } from '../src/protocols/meteora/withdraw.ts';
import { dlmmInstruction, binArrayAddress } from '../src/protocols/meteora/instructions.ts';
import { PROGRAM } from '../src/protocols/meteora/codec.ts';
import tokenPools from '../tests/fixtures/meteora/token2022-pools.json' with {type:'json'};
const require = createRequire(new URL('../.cache/meteora-reference/package.json',import.meta.url));
const sdk = require('@meteora-ag/dlmm');
const { PublicKey,Connection } = require('@solana/web3.js');
const BN = require('bn.js');
const spl = require('@solana/spl-token');
assert.equal(require('./node_modules/@meteora-ag/dlmm/package.json').version,'1.9.14');
const program = sdk.createProgram(new Connection('https://api.mainnet-beta.solana.com'));
const pk = key => new PublicKey(key);
const report = [];
for (const capture of tokenPools.captures) {
  const pool=sdk.decodeAccount(program,'lbPair',Buffer.from(capture.accounts[0].data,'base64'));
  if(pool.pairType===3) assert.equal(sdk.deriveLbPairWithPresetParamWithIndexKey(pool.baseKey,pool.tokenXMint,pool.tokenYMint,pk(PROGRAM))[0].toBase58(),capture.pool);
  report.push({pool:capture.name,liveCapturedPda:'match'});
}
for (const options of [{width:70},{lower:-71,width:142,reward:true},{width:1400},{width:1,oneSided:true},{width:71,shares:false},
  {width:71,reward:true,token2022:true,reward2022:true,transferFee:true},{width:1,reward:true,token2022:true,reward2022:true}]) {
  const f = await meteoraFixture(options);
  const position = await new MeteoraAdapter().readPosition(f.rpc,f.signer.address,POSITION);
  const account = f.rpc.accounts.get(POSITION);
  const wrapped = sdk.wrapPosition(program,pk(POSITION),{...account,owner:pk(PROGRAM),data:Buffer.from(account.data)});
  assert.equal(wrapped.lowerBinId().toNumber(),position.state.lower_bin_id);
  assert.equal(wrapped.upperBinId().toNumber(),position.state.upper_bin_id);
  assert.deepEqual(wrapped.liquidityShares().slice(0,options.width).map(v=>BigInt(v.toString())),position.state.liquidity_shares);
  const pool = sdk.decodeAccount(program,'lbPair',Buffer.from(f.rpc.accounts.get(f.poolKey).data));
  const arrays = new Map([...position.binArrays].map(([index,key])=>[key,sdk.decodeAccount(program,'binArray',Buffer.from(f.rpc.accounts.get(key).data))]));
  const mint = t => spl.unpackMint(pk(t.mint),{...f.rpc.accounts.get(t.mint),owner:pk(t.token.program),data:Buffer.from(f.rpc.accounts.get(t.mint).data)},pk(t.token.program));
  const clock = {slot:new BN(100),epoch:new BN(0),unixTimestamp:new BN(100)};
  const result = await sdk.processPosition(program,pool,clock,wrapped,mint(position.tokens[0]),mint(position.tokens[1]),
    position.rewards[0]?mint(position.rewards[0]):null,position.rewards[1]?mint(position.rewards[1]):null,arrays);
  assert.equal(result.totalXAmount.toString(),position.bins.reduce((n,b)=>n+b.x,0n).toString());
  assert.equal(result.totalYAmount.toString(),position.bins.reduce((n,b)=>n+b.y,0n).toString());
  assert.equal(result.feeX.toString(),position.bins.reduce((n,b)=>n+b.feeX,0n).toString());
  assert.equal(result.feeY.toString(),position.bins.reduce((n,b)=>n+b.feeY,0n).toString());
  assert.equal(result.rewardOne.toString(),position.bins.reduce((n,b)=>n+b.rewards[0],0n).toString());
  const plan=await prepareWithdrawAll({rpc:f.rpc,wallet:f.signer.address,position:POSITION});
  // The DLMM instructions follow Compute Budget and ATA creation, one per action in order.
  const dlmm=plan.instructions.slice(-plan.step.actions.length);
  const names={remove:'removeLiquidityByRange2',fees:'claimFee2',reward:'claimReward2',close:'closePosition2'};
  for (const [i,action] of plan.step.actions.entries()) {
    const ix=dlmm[i],definition=program.idl.instructions.find(x=>x.name===names[action.kind]);
    for (const [index,account] of definition.accounts.entries()) {
      if (['tokenXProgram','tokenProgramX'].includes(account.name)) assert.equal(ix.accounts[index].address,f.rpc.accounts.get(position.tokens[0].mint).owner);
      if (['tokenYProgram','tokenProgramY'].includes(account.name)) assert.equal(ix.accounts[index].address,f.rpc.accounts.get(position.tokens[1].mint).owner);
    }
    const strict=Object.fromEntries(definition.accounts.map((a,j)=>[a.name,pk(ix.accounts[j].address)]));
    const method=action.kind==='remove'?program.methods.removeLiquidityByRange2(action.lower,action.upper,10000,{slices:[]})
      :action.kind==='fees'?program.methods.claimFee2(action.lower,action.upper,{slices:[]})
      :action.kind==='reward'?program.methods.claimReward2(new BN(action.rewardIndex),action.lower,action.upper,{slices:[]}):program.methods.closePosition2();
    const reference=await method.accountsStrict(strict).remainingAccounts(ix.accounts.slice(definition.accounts.length).map(a=>({pubkey:pk(a.address),isSigner:false,isWritable:true}))).instruction();
    assert.deepEqual(Buffer.from(ix.data),reference.data);
    assert.deepEqual(ix.accounts.map(a=>[a.address,!!(a.role&2),!!(a.role&1)]),reference.keys.map(a=>[a.pubkey.toBase58(),a.isSigner,a.isWritable]));
  }
  assert.equal((await binArrayAddress(f.poolKey,-2)),sdk.deriveBinArray(pk(f.poolKey),new BN(-2),pk(PROGRAM))[0].toBase58());
  report.push({options,decodedBins:position.bins.length,step:plan.step.id,amountsAndInstructions:'match'});
}
// Independently exercise all claim instruction arguments and account roles.
for (const [kind,name] of [['fees','claimFee2'],['reward','claimReward2']]) {
  const definition=program.idl.instructions.find(x=>x.name===name);
  const accounts=Object.fromEntries(definition.accounts.map(a=>[a.name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),POSITION]));
  accounts.program=PROGRAM;
  const ix=await dlmmInstruction(kind,accounts,-71,-2,1,[POSITION]);
  const strict=Object.fromEntries(definition.accounts.map((a,i)=>[a.name,pk(ix.accounts[i].address)]));
  const method=kind==='fees'?program.methods.claimFee2(-71,-2,{slices:[]}):program.methods.claimReward2(new BN(1),-71,-2,{slices:[]});
  const ref=await method.accountsStrict(strict).remainingAccounts([{pubkey:pk(POSITION),isSigner:false,isWritable:true}]).instruction();
  assert.deepEqual(Buffer.from(ix.data),ref.data);
  assert.deepEqual(ix.accounts.map(a=>[a.address,!!(a.role&2),!!(a.role&1)]),ref.keys.map(a=>[a.pubkey.toBase58(),a.isSigner,a.isWritable]));
  report.push({kind,instruction:'match'});
}
await mkdir('.cache/meteora-reference',{recursive:true});
await writeFile('.cache/meteora-reference/report.json',JSON.stringify({sdkVersion:'1.9.14',checks:report,networkCalls:0},null,2));
console.log(`Official SDK comparison passed: ${report.length} scenarios; no network calls.`);
