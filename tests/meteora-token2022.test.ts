import { address, blockhash } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { MeteoraAdapter } from '../src/protocols/meteora/adapter';
import { prepareWithdrawAll, totalReceipts } from '../src/protocols/meteora/withdraw';
import { TOKEN, TOKEN_2022, WSOL, ZERO } from '../src/protocols/meteora/codec';
import { ataAddress, integerBytes, keyBytes, pda } from '../src/protocols/meteora/instructions';
import { executeMeteoraWithRpc, type MeteoraOperation } from '../src/operations/meteora';
import { decodeTokenAccount } from '../src/core/tokens';
import { extendedBytes, metadataBytes } from './fixtures/tokens';
import { feeOffset, meteoraFixture, POSITION, pubkey, REWARD, rewardOffset, u64, USDC } from './fixtures/meteora';
import { testWalletSigning } from './fixtures/signer';
const adapter=new MeteoraAdapter();
const op=(wallet:ReturnType<typeof address>):MeteoraOperation=>({version:1,id:'token2022',wallet,position:POSITION,rpcUrl:'https://example.com',createdAt:1,completed:[]});
describe('Meteora Token-2022 withdrawal',()=>{
  it.each([false,true])('handles a mixed pair and Token-2022 rewards with transfer fees=%s',async transferFee=>{
    const f=await meteoraFixture({width:1,reward:true,token2022:true,reward2022:true,transferFee,missingAta:true});
    const position=await adapter.readPosition(f.rpc,f.signer.address,POSITION);
    expect(position?.tokens.map(t=>t.token.program)).toEqual([TOKEN_2022,TOKEN]);
    expect(position?.rewards[0]?.token.program).toBe(TOKEN_2022);
    const plan=(await prepareWithdrawAll({rpc:f.rpc,wallet:f.signer.address,position:POSITION}))!;
    expect(plan.instructions.slice(1,-1).map(i=>i.accounts?.at(-1)?.address)).toEqual([TOKEN_2022,TOKEN]);
    expect(plan.instructions.at(-1)?.accounts?.slice(10,12).map(a=>a.address)).toEqual([TOKEN_2022,TOKEN]);
    expect(f.rpc.rentSizes).toContain(transferFee?182:170);expect(f.rpc.rentSizes).toContain(165);
    const reviewKinds:string[]=[];
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async review=>{
        reviewKinds.push(review.step.kind);
        for(const receipt of review.receipts) {
          expect(receipt.amount).toBe(receipt.grossAmount-receipt.transferFee);
          if(transferFee && receipt.mint!==WSOL)expect(receipt.transferFee).toBe(1n);
        }return true;
      },beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.status).toBe('confirmed');expect(reviewKinds).toEqual(['remove','fees','reward','close']);
    for(const mint of [USDC,REWARD]) {
      const state=decodeTokenAccount(f.rpc.accounts.get(await ataAddress(f.signer.address,mint,TOKEN_2022)));
      expect(state.withheldAmount).toBe(transferFee?(mint===USDC?2n:1n):0n);
      expect(state.amount).toBe((mint===USDC?54n:6n)-state.withheldAmount);
    }
  });
  it('supports Token-2022 on either side and both sides independently',async()=>{
    for(const both of [false,true]) {
      const f=await meteoraFixture({width:1,token2022:both});
      const mint=f.rpc.accounts.get(WSOL)!;mint.owner=TOKEN_2022;
      f.rpc.accounts.get(f.poolKey)!.data[881]=1;
      // Synthetic mint ownership; the classic mainnet WSOL mint never changes program.
      f.rpc.accounts.get(f.reserveY)!.owner=TOKEN_2022;f.rpc.accounts.get(f.reserveY)!.data[109]=0;
      const old=await ataAddress(f.signer.address,WSOL),modern=await ataAddress(f.signer.address,WSOL,TOKEN_2022);
      const a=f.rpc.accounts.get(old)!;a.owner=TOKEN_2022;a.data[109]=0;f.rpc.accounts.set(modern,a);f.rpc.accounts.delete(old);
      const p=await adapter.readPosition(f.rpc,f.signer.address,POSITION);
      expect(p?.tokens.map(t=>t.token.program)).toEqual([both?TOKEN_2022:TOKEN,TOKEN_2022]);
    }
  });
  it('allows combined metadata pointer and TokenMetadata without fetching metadata URLs',async()=>{
    const f=await meteoraFixture({width:1,token2022:true});const mint=f.rpc.accounts.get(USDC)!;
    const pointer=new Uint8Array(64);pubkey(pointer,32,USDC);
    mint.data=extendedBytes(mint.data,1,[[18,pointer],[19,metadataBytes(USDC)]]);
    expect((await adapter.getStatus(f.rpc,f.signer.address))[0]?.reason).toBeUndefined();
  });
  it.each(['hook','unknown','memo','cpi guard','flag','mint program','fee amount missing','frozen'])('disables unsupported %s dependencies with a reason',async kind=>{
    const f=await meteoraFixture({width:1,token2022:true,transferFee:true});
    const mint=f.rpc.accounts.get(USDC)!,reserve=f.rpc.accounts.get(f.reserveX)!;
    if(kind==='hook') {const hook=new Uint8Array(64);pubkey(hook,32,REWARD);mint.data=extendedBytes(mint.data.subarray(0,82),1,[[14,hook]]);}
    if(kind==='unknown')mint.data=extendedBytes(mint.data.subarray(0,82),1,[[65000,new Uint8Array()]]);
    if(kind==='memo'||kind==='cpi guard')reserve.data=extendedBytes(reserve.data.subarray(0,165),2,[[kind==='memo'?8:11,new Uint8Array([1])],[2,new Uint8Array(8)]]);
    if(kind==='flag')f.rpc.accounts.get(f.poolKey)!.data[880]=9;
    if(kind==='mint program')mint.owner=ZERO;
    if(kind==='fee amount missing')reserve.data=reserve.data.slice(0,165);
    if(kind==='frozen')reserve.data[108]=2;
    const status=(await adapter.getStatus(f.rpc,f.signer.address))[0]!;
    expect(status.position).toBeUndefined();expect(status.reason).toMatch(/unsupported|mismatch|does not match|owner|frozen/);
  });
  it('revalidates mint program discovery against the final coherent snapshot',async()=>{
    const f=await meteoraFixture({width:1});const original=f.rpc.getAccounts.bind(f.rpc);let reads=0;
    f.rpc.getAccounts=async(keys,minSlot)=>{if(++reads===4)f.rpc.accounts.get(USDC)!.owner=TOKEN_2022;return original(keys,minSlot);};
    await expect(adapter.readPosition(f.rpc,f.signer.address,POSITION)).rejects.toThrow(/mint program changed/);
  });
  it('applies fees separately to liquidity, fee claims, rewards and 70-bin chunks',async()=>{
    const f=await meteoraFixture({width:71,token2022:true,transferFee:true,reward:true,reward2022:true});
    const p=(await adapter.readPosition(f.rpc,f.signer.address,POSITION))!;
    const x=totalReceipts(p).find(t=>t.mint===USDC)!;
    // Liquidity: ceil(3500*1%) + ceil(50*1%). Fees: ceil(280*1%) + ceil(4*1%).
    expect(x).toMatchObject({grossAmount:3834n,transferFee:40n,amount:3794n});
    const reward=totalReceipts(p).find(t=>t.mint===REWARD)!;
    expect(reward).toMatchObject({grossAmount:426n,transferFee:6n,amount:420n});
  });
  it.each(['net','reduced','withheld','mint','recipient program','account extension'])('blocks incorrect simulated %s before review/signing',async kind=>{
    const f=await meteoraFixture({width:1,token2022:true,transferFee:true});
    const ata=await ataAddress(f.signer.address,USDC,TOKEN_2022);
    f.rpc.mutateSimulation=accounts=>{
      const recipient=accounts.get(ata)!;
      if(kind==='net')u64(recipient.data,64,1200n); // net receipt with too little withheld fee
      if(kind==='reduced')u64(recipient.data,64,999n);
      if(kind==='withheld')u64(recipient.data,174,0n);
      if(kind==='mint')accounts.get(USDC)!.data[258]=2;
      if(kind==='recipient program')recipient.owner=TOKEN;
      if(kind==='account extension')recipient.data=extendedBytes(recipient.data.slice(0,165),2,[[8,new Uint8Array([1])],[2,new Uint8Array(8)]]);
    };
    let reviewed=false;
    await expect(executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async()=>{reviewed=true;return true;},beforeSend:async()=>{},confirmed:async()=>{}})).rejects.toThrow();
    expect(reviewed).toBe(false);expect(f.rpc.sent).toHaveLength(0);
  });
  it('accepts other users changing vaults, supply and harvested fees between approval and the fresh simulation',async()=>{
    const f=await meteoraFixture({width:1,token2022:true,transferFee:true});
    let height=100n;f.rpc.getLatestBlockhash=async()=>{f.rpc.blockhashes++;height+=10n;return {blockhash:blockhash(address('11111111111111111111111111111111')),lastValidBlockHeight:height};};
    let simulations=0;
    f.rpc.mutateSimulation=accounts=>{
      if(++simulations===1)return; // Swaps, mints and fee harvests land while the user reviews.
      for(const vault of [f.reserveX,f.reserveY]) {const d=accounts.get(vault)!.data;u64(d,64,new DataView(d.buffer,d.byteOffset).getBigUint64(64,true)+5_000n);}
      const mint=accounts.get(USDC)!.data;u64(mint,36,123_456n);u64(mint,234,77n);
      u64(accounts.get(f.reserveX)!.data,170,9n);
    };
    let reviewed:bigint|undefined;
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async review=>{reviewed??=review.receipts.find(t=>t.mint===USDC)?.amount;return true;},beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.status).toBe('confirmed');expect(reviewed).toBe(49n);
    expect(f.rpc.simulations.length).toBeGreaterThan(result.operation.completed.length);
  });
  it('uses the simulated epoch for fee checks and refreshes estimates at rollover',async()=>{
    const f=await meteoraFixture({width:3,token2022:true,transferFee:true,epoch:4n});
    const base=f.rpc.simulateTransaction.bind(f.rpc);
    f.rpc.simulateTransaction=async(tx,keys)=>{u64(f.rpc.accounts.get((await import('../src/protocols/meteora/codec')).CLOCK)!.data,16,5n);return base(tx,keys);};
    let first=true;
    await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async review=>{if(first){expect(review.receipts.find(t=>t.mint===USDC)).toMatchObject({grossAmount:150n,transferFee:3n,amount:147n});first=false;}return true;},beforeSend:async()=>{},confirmed:async()=>{}});
  });
  it('preserves pre-existing withheld balances and counts only new spendable receipts',async()=>{
    const f=await meteoraFixture({width:1,token2022:true,transferFee:true});
    const ata=await ataAddress(f.signer.address,USDC,TOKEN_2022);
    u64(f.rpc.accounts.get(ata)!.data,174,99n);u64(f.rpc.accounts.get(f.reserveX)!.data,170,100n);
    let seen=false;
    await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async review=>{if(!seen){expect(review.receipts.find(t=>t.mint===USDC)).toMatchObject({grossAmount:50n,transferFee:1n,amount:49n});seen=true;}return true;},beforeSend:async()=>{},confirmed:async()=>{}});
    expect(decodeTokenAccount(f.rpc.accounts.get(ata))).toMatchObject({amount:1052n,withheldAmount:101n});
    expect(decodeTokenAccount(f.rpc.accounts.get(f.reserveX))).toMatchObject({withheldAmount:100n});
  });
  it('uses the independent Token-2022 reward program for reward index 1',async()=>{
    const f=await meteoraFixture({width:1,shares:false,reward:true,reward2022:true,transferFee:true});
    const pool=f.rpc.accounts.get(f.poolKey)!.data,secondVault=await pda([keyBytes(f.poolKey),integerBytes(1n,8)]);
    pool.set(pool.slice(264,408),408);pool.fill(0,264,408);pubkey(pool,440,secondVault);
    f.rpc.accounts.set(secondVault,f.rpc.accounts.get(f.rewardVault)!);f.rpc.accounts.delete(f.rewardVault);
    u64(f.rpc.accounts.get(POSITION)!.data,rewardOffset(0)+40,101n);
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),
      confirm:async review=>{if(review.step.kind==='reward'){expect(review.step.rewardIndex).toBe(1);expect(review.receipts[0]).toMatchObject({mint:REWARD,grossAmount:101n,transferFee:2n,amount:99n});}return true;},beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.operation.completed.map(c=>c.step.kind)).toEqual(['reward','close']);
  });
  it('handles fee-only, reward-only and empty Token-2022 positions',async()=>{
    for(const kind of ['fees','reward','close'] as const) {
      const f=await meteoraFixture({width:1,shares:false,token2022:true,reward:true,reward2022:true,transferFee:true,missingAta:true});
      if(kind==='fees')u64(f.rpc.accounts.get(POSITION)!.data,feeOffset(0)+32,101n);
      if(kind==='reward')u64(f.rpc.accounts.get(POSITION)!.data,rewardOffset(0)+32,101n);
      const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:op(f.signer.address),confirm:async()=>true,beforeSend:async()=>{},confirmed:async()=>{}});
      expect(result.operation.completed.map(c=>c.step.kind)).toEqual(kind==='close'?['close']:[kind,'close']);
      if(kind==='close')expect(f.rpc.rentSizes).toHaveLength(0);
    }
  });
  it('resumes after confirmed steps with a fresh epoch and preserves withheld balances',async()=>{
    const f=await meteoraFixture({width:3,reward:true,token2022:true,reward2022:true,transferFee:true});
    let saved=op(f.signer.address),count=0;
    const input={wallet:f.signer.address,signWithWallet:testWalletSigning(f.signer),operation:saved,confirm:async()=>++count===1,beforeSend:async()=>{},confirmed:async(o:MeteoraOperation)=>{saved=o;}};
    expect((await executeMeteoraWithRpc(f.rpc,input)).status).toBe('partial');
    u64(f.rpc.accounts.get((await import('../src/protocols/meteora/codec')).CLOCK)!.data,16,5n);
    const final=await executeMeteoraWithRpc(f.rpc,{...input,operation:saved,confirm:async()=>true});
    expect(final.operation.completed.map(c=>c.step.kind)).toEqual(['remove','fees','reward','close']);
    expect(f.rpc.sent).toHaveLength(4);
    const state=decodeTokenAccount(f.rpc.accounts.get(await ataAddress(f.signer.address,USDC,TOKEN_2022)));
    expect(state).toMatchObject({amount:1159n,withheldAmount:3n});
  });
});
