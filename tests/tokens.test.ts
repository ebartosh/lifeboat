import { address, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import type { ChainAccount } from '../src/core/accounts';
import { associatedTokenAddress, createAssociatedTokenIdempotent, decodeTokenAccount, decodeTokenMint, metaplexMetadataAddress, onChainSymbol, TOKEN_METADATA_PROGRAM,
  TOKEN_2022_PROGRAM, TOKEN_PROGRAM, NATIVE_TOKEN_2022_MINT, tokenAccountRent, tokenAccountSize, transferAmounts } from '../src/core/tokens';
import { validateWithdrawalMint, withdrawalTokenState } from '../src/protocols/meteora/token-policy';
import { extendedBytes, feeConfigBytes, metadataBytes } from './fixtures/tokens';
import { tokenBytes, USDC, u64, pubkey } from './fixtures/meteora';
import { tokenSymbol } from '../src/core/format';
const owner=address('11111111111111111111111111111112');
const account=(data:Uint8Array,program=TOKEN_2022_PROGRAM):ChainAccount=>({owner:program,executable:false,data});
const mintBase=()=>{const d=new Uint8Array(82);d[44]=6;d[45]=1;return d;};
const feeMint=()=>decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[1,feeConfigBytes()]])));
describe('shared token infrastructure',()=>{
  it('validates classic and extension-free Token-2022 mint/account layouts',()=>{
    for(const program of [TOKEN_PROGRAM,TOKEN_2022_PROGRAM]) {
      const mint=decodeTokenMint(USDC,{...account(mintBase()),owner:program});
      expect(mint).toMatchObject({program,decimals:6,supply:0n,transferFee:null});
      const state=decodeTokenAccount({...account(tokenBytes(USDC,owner,123n)),owner:program});
      expect(state).toMatchObject({amount:123n,authority:owner,mint:USDC,withheldAmount:0n,frozen:false});
    }
  });
  it('decodes metadata and fee capabilities without adopting protocol policy',()=>{
    const pointer=new Uint8Array(64);pubkey(pointer,32,USDC);
    const mint=decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[18,pointer],[19,metadataBytes(USDC)],[1,feeConfigBytes()]])));
    expect(mint.extensions.map(e=>e.name)).toEqual(['MetadataPointer','TokenMetadata','TransferFeeConfig']);
    expect(mint.transferFee).toMatchObject({older:{epoch:0n,basisPoints:100,maximumFee:1000n},newer:{epoch:5n,basisPoints:200}});
    expect(()=>validateWithdrawalMint(mint)).not.toThrow();
    const unknown=decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[60000,new Uint8Array([1])]])));
    expect(unknown.extensions[0]?.known).toBe(false);
    expect(()=>validateWithdrawalMint(unknown)).toThrow(/Unknown extension 60000/);
    expect(()=>tokenAccountSize(unknown)).toThrow(/cannot determine/);
  });
  it.each(['owner','executable','length','initialized','option','padding','type','duplicate','header','payload','multisig','fee','metadata'])('rejects malformed %s mint data',kind=>{
    let a=account(extendedBytes(mintBase(),1,[[1,feeConfigBytes()]]));
    if(kind==='owner')a.owner=owner;if(kind==='executable')a.executable=true;
    if(kind==='length')a.data=new Uint8Array(100);if(kind==='initialized')a.data[45]=0;
    if(kind==='option')a.data[0]=2;if(kind==='padding')a.data[100]=1;if(kind==='type')a.data[165]=2;
    if(kind==='duplicate')a.data=extendedBytes(mintBase(),1,[[1,feeConfigBytes()],[1,feeConfigBytes()]]);
    if(kind==='header') {a.data=new Uint8Array(168);a.data.set(mintBase());a.data[165]=1;a.data[166]=1;}
    if(kind==='payload')a.data=a.data.slice(0,-1);
    if(kind==='multisig') {a.data=new Uint8Array(355);a.data.set(mintBase());a.data[165]=1;}
    if(kind==='fee')a.data=extendedBytes(mintBase(),1,[[1,feeConfigBytes(10001)]]);
    if(kind==='metadata')a.data=extendedBytes(mintBase(),1,[[19,metadataBytes(owner)]]);
    expect(()=>decodeTokenMint(USDC,a)).toThrow();
  });
  it('rejects malformed metadata Borsh and UTF-8 while tolerating zero trailing allocation',()=>{
    for(const mutate of [(d:Uint8Array)=>{d[68]=255;},(d:Uint8Array)=>{new DataView(d.buffer).setUint32(64,0xffffffff,true);},
      (d:Uint8Array)=>{d[d.length-1]=255;}]) {
      const d=metadataBytes(USDC);mutate(d);expect(()=>decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[19,d]])))).toThrow(/TokenMetadata/);
    }
    const data=extendedBytes(mintBase(),1,[[1,feeConfigBytes()]]),padded=new Uint8Array(data.length+8);padded.set(data);
    expect(decodeTokenMint(USDC,account(padded)).extensions).toHaveLength(1);
    padded[padded.length-1]=1;expect(()=>decodeTokenMint(USDC,account(padded))).toThrow();
  });
  it('describes frozen/delegated accounts and rejects them in the withdrawal policy',()=>{
    const d=tokenBytes(USDC,owner,123n);d[108]=2;
    expect(decodeTokenAccount(account(d)).frozen).toBe(true);
    expect(()=>withdrawalTokenState(account(d),decodeTokenMint(USDC,account(mintBase())),owner)).toThrow(/frozen/);
    d[108]=1;new DataView(d.buffer).setUint32(72,1,true);pubkey(d,76,owner);
    expect(decodeTokenAccount(account(d)).delegate).toBe(owner);
    expect(()=>withdrawalTokenState(account(d),decodeTokenMint(USDC,account(mintBase())),owner)).toThrow(/delegated/);
  });
  it.each(['owner','mint','authority','state','delegate option','native option','close authority','delegated amount','account extension','missing fee','unexpected fee'])('preserves %s token account validation',kind=>{
    let a=account(extendedBytes(tokenBytes(USDC,owner,123n),2,[[2,new Uint8Array(8)]]));
    const mint=feeMint();
    if(kind==='owner')a.owner=TOKEN_PROGRAM;if(kind==='mint')pubkey(a.data,0,owner);if(kind==='authority')pubkey(a.data,32,USDC);
    if(kind==='state')a.data[108]=0;if(kind==='delegate option')a.data[72]=2;if(kind==='native option')a.data[109]=2;
    if(kind==='close authority') {a.data[129]=1;pubkey(a.data,133,owner);}
    if(kind==='delegated amount')u64(a.data,121,1n);
    if(kind==='account extension')a.data=extendedBytes(tokenBytes(USDC,owner,123n),2,[[8,new Uint8Array([1])],[2,new Uint8Array(8)]]);
    if(kind==='missing fee')a.data=tokenBytes(USDC,owner,123n);
    expect(()=>withdrawalTokenState(a,kind==='unexpected fee'?decodeTokenMint(USDC,account(mintBase())):mint,owner)).toThrow();
  });
  it('excludes active and inactive hooks and named unsupported mint extensions',()=>{
    const hook=new Uint8Array(64);pubkey(hook,32,owner);
    const m=decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[14,hook]])));
    expect(m.transferHookProgram).toBe(owner);expect(()=>validateWithdrawalMint(m)).toThrow(/active transfer hook/);
    for(const [type,data] of [[14,new Uint8Array(64)],[6,new Uint8Array([2])],[12,new Uint8Array(32)],[26,new Uint8Array(33)]] as const)
      expect(()=>validateWithdrawalMint(decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[type,data]]))))).toThrow(/unsupported/);
  });
  it('rejects the native Token-2022 mint and unsupported native token accounts in DLMM',()=>{
    expect(()=>validateWithdrawalMint(decodeTokenMint(NATIVE_TOKEN_2022_MINT,account(mintBase())))).toThrow(/Native Token-2022/);
    const d=tokenBytes(USDC,owner,10n);d[109]=1;
    expect(()=>withdrawalTokenState(account(d),decodeTokenMint(USDC,account(mintBase())),owner)).toThrow(/unsupported native/);
  });
  it('keeps withheld fees separate from the spendable account amount',()=>{
    const withheld=new Uint8Array(8);u64(withheld,0,99n);
    const a=account(extendedBytes(tokenBytes(USDC,owner,123n),2,[[7,new Uint8Array()],[2,withheld]]));
    expect(withdrawalTokenState(a,feeMint(),owner)).toMatchObject({amount:123n,withheldAmount:99n});
  });
  it('derives different program-specific ATAs and idempotent account roles',async()=>{
    const classic=await associatedTokenAddress(owner,USDC,TOKEN_PROGRAM),modern=await associatedTokenAddress(owner,USDC,TOKEN_2022_PROGRAM);
    expect(classic).not.toBe(modern);
    const ix=createAssociatedTokenIdempotent(owner,owner,USDC,modern,TOKEN_2022_PROGRAM);
    expect([...ix.data!]).toEqual([1]);expect(ix.accounts?.map(a=>a.role)).toEqual([3,1,0,0,0,0]);
    expect(ix.accounts?.at(-1)?.address).toBe(TOKEN_2022_PROGRAM);
  });
  it('quotes rent for 165-byte SPL, 170-byte Token-2022 ATA and 182-byte fee ATA',async()=>{
    const rpc={getMinimumBalanceForRentExemption:vi.fn(async(size:number)=>BigInt(size)*6960n)};
    const classic=decodeTokenMint(USDC,{...account(mintBase()),owner:TOKEN_PROGRAM});
    const modern=decodeTokenMint(USDC,account(mintBase()));
    expect(tokenAccountSize(feeMint(),false)).toBe(178);expect(tokenAccountSize(modern,false)).toBe(165);
    for(const [mint,size] of [[classic,165],[modern,170],[feeMint(),182]] as const)
      expect(await tokenAccountRent(rpc,mint)).toEqual({size,rent:BigInt(size)*6960n});
    expect(rpc.getMinimumBalanceForRentExemption.mock.calls.map(c=>c[0])).toEqual([165,170,182]);
  });
  it('uses u64 bigint, ceiling rounding, epoch switching and per-transfer caps',()=>{
    const config=feeMint().transferFee;
    expect(transferAmounts(1n,config,0n)).toEqual({grossAmount:1n,transferFee:1n,netAmount:0n});
    expect(transferAmounts(0n,config,5n).transferFee).toBe(0n);
    expect(transferAmounts(101n,config,4n).transferFee).toBe(2n);
    expect(transferAmounts(101n,config,5n).transferFee).toBe(3n);
    expect(transferAmounts((1n<<64n)-1n,config,5n).transferFee).toBe(1000n);
    const full={older:{epoch:0n,maximumFee:10n,basisPoints:10000},newer:{epoch:0n,maximumFee:10n,basisPoints:10000},withheldAmount:0n};
    expect(transferAmounts(5n,full,0n).netAmount).toBe(0n);expect(transferAmounts(20n,full,0n).netAmount).toBe(10n);
    expect(transferAmounts(2n,null,0n).netAmount).toBe(2n);
    for(const amount of [-1n,1n<<64n])expect(()=>transferAmounts(amount,config,0n)).toThrow(/u64/);
  });
});
const MET=address('METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL');
// Metaplex MetadataV1 pads name to 32 bytes and symbol to 10 bytes with NUL.
const metaplex=(mint:Address=MET,symbol='MET',key=4,owner:Address=TOKEN_METADATA_PROGRAM):ChainAccount=>{
  const field=(text:string,size:number)=>{const b=new Uint8Array(4+size);new DataView(b.buffer).setUint32(0,size,true);b.set(Buffer.from(text,'utf8').subarray(0,size),4);return b;};
  const head=new Uint8Array(65);head[0]=key;pubkey(head,33,mint);
  return {owner,executable:false,data:Uint8Array.from([...head,...field('Meteora',32),...field(symbol,10),...field('',200)])};
};
describe('on-chain token symbols',()=>{
  const classic=decodeTokenMint(MET,{...account(mintBase()),owner:TOKEN_PROGRAM});
  it('derives the mainnet Metaplex metadata PDA',async()=>{
    expect(await metaplexMetadataAddress(MET)).toBe('7rdxkmahGZjAhmKxAaZqbC416Hv6TXzxb6JBNhhkKyV5');
  });
  it('reads the padded Metaplex symbol and the Token-2022 TokenMetadata symbol',()=>{
    expect(onChainSymbol(classic,metaplex())).toBe('MET');
    const extended=decodeTokenMint(USDC,account(extendedBytes(mintBase(),1,[[19,metadataBytes(USDC)]])));
    expect(onChainSymbol(extended,null)).toBe('FIX');
    expect(onChainSymbol(extended,metaplex(USDC,'OTHER'))).toBe('FIX');
  });
  it.each(['owner','key','mint','truncated','empty','hidden','utf8'])('ignores %s metadata without throwing',kind=>{
    let a=metaplex();
    if(kind==='owner')a=metaplex(MET,'MET',4,TOKEN_PROGRAM);if(kind==='key')a=metaplex(MET,'MET',6);
    if(kind==='mint')a=metaplex(USDC);if(kind==='truncated')a={...a,data:a.data.slice(0,80)};
    if(kind==='empty')a=metaplex(MET,'   ');if(kind==='hidden')a=metaplex(MET,'M'+String.fromCharCode(0x202e)+'ET');
    if(kind==='utf8'){a=metaplex();a.data[65+4+32+4]=0xff;}
    expect(onChainSymbol(classic,a)).toBeNull();
    expect(onChainSymbol(classic,undefined)).toBeNull();
  });
  it('keeps fixed labels for known mints and rejects imitations',()=>{
    expect(tokenSymbol(MET,'MET')).toBe('MET');
    expect(tokenSymbol(USDC,'FAKE')).toBe('USDC');
    for(const fake of ['USDC','wsol','SOL',null])expect(tokenSymbol(MET,fake)).toBe('METv…mWQL');
  });
});
