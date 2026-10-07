// Offline differential check against the isolated official clients; no application dependencies.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { decodeTokenMint, decodeTokenAccount, associatedTokenAddress, createAssociatedTokenIdempotent,
  tokenAccountSize, transferAmounts, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/core/tokens.ts';
import { extendedBytes, feeConfigBytes, metadataBytes } from '../tests/fixtures/tokens.ts';
import { tokenBytes, USDC, REWARD, u64 } from '../tests/fixtures/meteora.ts';
const require=createRequire(new URL('../.cache/meteora-reference/package.json',import.meta.url));
const spl=require('@solana/spl-token'),sdk=require('@meteora-ag/dlmm'),{PublicKey}=require('@solana/web3.js'),BN=require('bn.js');
assert.equal(require('./node_modules/@solana/spl-token/package.json').version,'0.4.15');
assert.equal(require('./node_modules/@meteora-ag/dlmm/package.json').version,'1.9.14');
const pk=a=>new PublicKey(a);
const base=new Uint8Array(82);base[44]=6;base[45]=1;u64(base,36,9007199254740993n);
const info=(data,program)=>({owner:pk(program),data:Buffer.from(data),executable:false,lamports:1000000});
const chainInfo=(data,program)=>({owner:program,data,executable:false,lamports:1000000n});
let mintChecks=0,accountChecks=0,feeChecks=0,ataChecks=0;
for(const program of [TOKEN_PROGRAM,TOKEN_2022_PROGRAM]) {
  for(const entries of program===TOKEN_PROGRAM?[[]]:[[],[[18,new Uint8Array(64)]],[[19,metadataBytes(USDC)]],[[1,feeConfigBytes()]],
    [[18,new Uint8Array(64)],[19,metadataBytes(USDC)],[1,feeConfigBytes()]]]) {
    const data=entries.length?extendedBytes(base,1,entries):base;
    const ours=decodeTokenMint(USDC,chainInfo(data,program)),ref=spl.unpackMint(pk(USDC),info(data,program),pk(program));
    assert.equal(ours.supply,ref.supply);assert.equal(ours.decimals,ref.decimals);
    assert.deepEqual(ours.extensions.map(e=>e.type),spl.getExtensionTypes(ref.tlvData));
    const required=program===TOKEN_PROGRAM?[]:[spl.ExtensionType.ImmutableOwner,...(ours.transferFee?[spl.ExtensionType.TransferFeeAmount]:[])];
    assert.equal(tokenAccountSize(ours),spl.getAccountLen(required));mintChecks++;
    const withheld=new Uint8Array(8);u64(withheld,0,99n);
    const accountEntries=program===TOKEN_PROGRAM?[]:[[7,new Uint8Array()],...(ours.transferFee?[[2,withheld]]:[])];
    const raw=tokenBytes(USDC,REWARD,9007199254740993n),accountData=accountEntries.length?extendedBytes(raw,2,accountEntries):raw;
    const accountOurs=decodeTokenAccount(chainInfo(accountData,program)),accountRef=spl.unpackAccount(pk(REWARD),info(accountData,program),pk(program));
    assert.equal(accountOurs.amount,accountRef.amount);assert.equal(accountOurs.mint,accountRef.mint.toBase58());
    assert.equal(accountOurs.authority,accountRef.owner.toBase58());
    assert.equal(accountOurs.withheldAmount,spl.getTransferFeeAmount(accountRef)?.withheldAmount??0n);accountChecks++;
  }
  const ours=await associatedTokenAddress(REWARD,USDC,program),ref=spl.getAssociatedTokenAddressSync(pk(USDC),pk(REWARD),true,pk(program));
  assert.equal(ours,ref.toBase58());
  const ix=createAssociatedTokenIdempotent(REWARD,REWARD,USDC,ours,program),reference=spl.createAssociatedTokenAccountIdempotentInstruction(pk(REWARD),ref,pk(REWARD),pk(USDC),pk(program));
  assert.deepEqual(Buffer.from(ix.data),reference.data);
  assert.equal(ix.programAddress,reference.programId.toBase58());
  assert.deepEqual(ix.accounts.map(a=>[a.address,!!(a.role&2),!!(a.role&1)]),reference.keys.map(a=>[a.pubkey.toBase58(),a.isSigner,a.isWritable]));ataChecks++;
}
for(const bps of [0,1,37,100,9999,10000])for(const cap of [0n,1n,10n,(1n<<64n)-1n]) {
  const data=extendedBytes(base,1,[[1,feeConfigBytes(bps,10000-bps,cap)]]);
  const ours=decodeTokenMint(USDC,chainInfo(data,TOKEN_2022_PROGRAM)),ref=spl.unpackMint(pk(USDC),info(data,TOKEN_2022_PROGRAM),pk(TOKEN_2022_PROGRAM));
  const config=spl.getTransferFeeConfig(ref);
  for(const epoch of [0n,4n,5n])for(const gross of [0n,1n,2n,99n,100n,101n,10000n,(1n<<64n)-1n]) {
    const actual=transferAmounts(gross,ours.transferFee,epoch),expected=spl.calculateEpochFee(config,epoch,gross);
    assert.equal(actual.transferFee,expected);assert.equal(actual.netAmount,gross-expected);
    const meteora=sdk.calculateTransferFeeExcludedAmount(new BN(gross.toString()),ref,Number(epoch));
    assert.equal(actual.netAmount,BigInt(meteora.amount.toString()));assert.equal(actual.transferFee,BigInt(meteora.transferFee.toString()));feeChecks++;
  }
}
const report={tokenClientVersion:'0.4.15',dlmmVersion:'1.9.14',mintChecks,accountChecks,ataChecks,feeChecks,networkCalls:0};
await mkdir('.cache/token-reference',{recursive:true});
await writeFile('.cache/token-reference/report.json',JSON.stringify(report,null,2));
console.log(`Official token comparison passed: ${JSON.stringify(report)}`);
