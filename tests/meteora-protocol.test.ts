import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { address, getTransactionEncoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { MeteoraAdapter } from '../src/protocols/meteora/adapter';
import { decodeAccount, decodePosition, LEGACY_DISCRIMINATOR, PROGRAM, TOKEN_2022, ZERO, type PoolState } from '../src/protocols/meteora/codec';
import { prepareWithdrawAll, withdrawalSteps } from '../src/protocols/meteora/withdraw';
import { binArrayIndex, estimateBins, Q64 } from '../src/protocols/meteora/math';
import { ataAddress, binArrayAddress, dlmmInstruction } from '../src/protocols/meteora/instructions';
import { executeMeteoraWithRpc, type MeteoraOperation } from '../src/operations/meteora';
import metadata from '../src/protocols/meteora/metadata.json';
import { feeOffset, i32, meteoraFixture, POSITION, pubkey, REWARD, rewardOffset, u64, u128, USDC } from './fixtures/meteora';
const adapter = new MeteoraAdapter();
const operation = (wallet: ReturnType<typeof address>):MeteoraOperation => ({version:1,id:'test-operation',wallet,position:POSITION,rpcUrl:'https://example.com',createdAt:1,completed:[]});
describe('Meteora pinned protocol',()=>{
  it('pins the exact upstream IDL hash, version and source commit',()=>{
    expect(createHash('sha256').update(readFileSync('src/protocols/meteora/dlmm.idl.json')).digest('hex')).toBe(metadata.idlSha256);
    expect(metadata.sourceCommit).toMatch(/^[a-f0-9]{40}$/);expect(metadata.idlVersion).toBe('0.12.0');expect(metadata.programId).toBe(PROGRAM);
  });
  it('decodes 1400-bin extensions without a data-size discovery filter and uses negative bin-array indices',async()=>{
    const f=await meteoraFixture({width:1400,lower:-71});
    const statuses=await adapter.getStatus(f.rpc,f.signer.address);
    expect(statuses[0]?.reason).toBeUndefined();expect(statuses[0]?.position?.state.liquidity_shares).toHaveLength(1400);
    expect(f.rpc.filters).toHaveLength(2);expect(f.rpc.filters[0]).toHaveLength(2);
    expect(f.rpc.filters[0]?.map(x=>x.offset)).toEqual([0,40]);
    expect(binArrayIndex(-71)).toBe(-2);expect(binArrayIndex(-1)).toBe(-1);
    expect(withdrawalSteps(statuses[0]!.position!).filter(s=>s.kind==='remove')).toHaveLength(20);
  });
  it('rejects truncated, invalid-range and incorrect discriminator position bytes',async()=>{
    const f=await meteoraFixture({width:71});const account=f.rpc.accounts.get(POSITION)!;
    expect(()=>decodePosition({...account,data:account.data.slice(0,-1)})).toThrow(/length/);
    i32(account.data,7916,2000);expect(()=>decodePosition(account)).toThrow(/range/);
    account.data[0]=0;expect(()=>decodePosition(account)).toThrow(/discriminator/);
  });
  it('rejects hidden assets in extra allocated bins outside the current position range',async()=>{
    const f=await meteoraFixture({width:71,shares:false});const account=f.rpc.accounts.get(POSITION)!;
    i32(account.data,7916,-35);u64(account.data,rewardOffset(70)+32,1n);
    expect(()=>decodePosition(account)).toThrow(/outside its range/);
  });
  it('keeps legacy and unsupported positions visible with explicit reasons',async()=>{
    const f=await meteoraFixture();const legacy=address('11111111111111111111111111111113');
    const data=new Uint8Array(7560);data.set(LEGACY_DISCRIMINATOR);pubkey(data,40,f.signer.address);
    f.rpc.discoveries.push({address:legacy,account:{owner:PROGRAM,executable:false,data}});
    u64(f.rpc.accounts.get(POSITION)!.data,7992,101n);
    const statuses=await adapter.getStatus(f.rpc,f.signer.address);
    expect(statuses.map(s=>s.reason)).toEqual([expect.stringMatching(/active.*lock/),expect.stringMatching(/Legacy/)]);
  });
  it.each(['network','owner','fee recipient','mint','reserve','array','pool','program','reward mint','missing array'])(
    'rejects unsupported or mismatched %s',async kind=>{
      const f=await meteoraFixture({reward:true}),pos=f.rpc.accounts.get(POSITION)!,pool=f.rpc.accounts.get(f.poolKey)!;
      if(kind==='network')f.rpc.genesis='devnet';
      if(kind==='owner')pubkey(pos.data,40,ZERO);
      if(kind==='fee recipient')pubkey(pos.data,8001,ZERO===f.signer.address?REWARD:REWARD);
      if(kind==='mint')f.rpc.accounts.get(USDC)!.owner=TOKEN_2022;
      if(kind==='reserve')pubkey(f.rpc.accounts.get(f.reserveX)!.data,32,ZERO);
      if(kind==='array')pubkey(f.rpc.accounts.get(await binArrayAddress(f.poolKey,-1))!.data,24,ZERO);
      if(kind==='pool')pool.data[73]=2;
      if(kind==='program')f.rpc.accounts.get(PROGRAM)!.executable=false;
      if(kind==='reward mint')f.rpc.accounts.get(REWARD)!.owner=TOKEN_2022;
      if(kind==='missing array')f.rpc.accounts.delete(await binArrayAddress(f.poolKey,-1));
      await expect(adapter.readPosition(f.rpc,f.signer.address,POSITION)).rejects.toThrow(/Meteora/);
    });
  it('uses bigint per-bin rounding, one-sided liquidity and Q64 fees/rewards',async()=>{
    const f=await meteoraFixture({width:1,reward:true,oneSided:true});
    const p=await adapter.readPosition(f.rpc,f.signer.address,POSITION);
    expect(p!.bins[0]).toMatchObject({x:50n,y:0n,feeX:4n,feeY:0n,rewards:[6n,0n]});
    const state=decodePosition(f.rpc.accounts.get(POSITION)),pool=decodeAccount<PoolState>('LbPair',f.rpc.accounts.get(f.poolKey));
    const bin={amount_x:(1n<<63n)+1n,amount_y:0n,liquidity_supply:3n*Q64,fee_amount_x_per_token_stored:2n*Q64,
      fee_amount_y_per_token_stored:0n,fulfilled_order_amount_x:0n,fulfilled_order_amount_y:3n,limit_order_fee_ask_side:0n,limit_order_fee_bid_side:0n};
    const values=estimateBins(state,pool,new Map([[state.lower_bin_id,bin]]),100n);
    expect(values[0]!.x).toBe(2n*((1n<<63n)+1n)/3n);
    pool.reward_infos[0]!.reward_rate=15n*Q64;pool.reward_infos[0]!.reward_duration_end=110n;pool.reward_infos[0]!.last_update_time=99n;
    expect(estimateBins(state,pool,new Map([[state.lower_bin_id,bin]]),100n)[0]!.rewards[0]).toBe(6n+2n/3n);
  });
  it('builds exact range data, 10000 bps, empty hook slices and writable remaining arrays',async()=>{
    const keys={position:POSITION,lb_pair:POSITION,sender:POSITION,bin_array_bitmap_extension:PROGRAM,user_token_x:POSITION,user_token_y:POSITION,
      reserve_x:POSITION,reserve_y:POSITION,token_x_mint:POSITION,token_y_mint:POSITION,token_x_program:PROGRAM,token_y_program:PROGRAM};
    const ix=await dlmmInstruction('remove',keys,-71,-2,0,[POSITION]);
    expect([...ix.data!]).toEqual([204,2,195,145,53,145,145,205,185,255,255,255,254,255,255,255,16,39,0,0,0,0]);
    expect(ix.accounts!.at(-1)).toEqual({address:POSITION,role:1});expect(ix.accounts![2]!.role).toBe(0);
  });
  it('creates only the required ATAs, quotes rent and verifies simulation changes',async()=>{
    const f=await meteoraFixture({width:1,missingAta:true,oneSided:true});
    const plan=await prepareWithdrawAll({rpc:f.rpc,wallet:f.signer.address,position:POSITION});
    expect(plan!.ataRent).toBe(4_078_560n);expect(plan!.instructions).toHaveLength(4);
    expect(plan!.remainingReceipts.map(t=>t.amount)).toEqual([54n,0n]);
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,getSigner:async()=>f.signer,operation:operation(f.signer.address),
      confirm:async review=>{expect(review.receipts.every(t=>t.amount>=0n)).toBe(true);return true;},beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.status).toBe('confirmed');expect(result.operation.completed.map(c=>c.step.kind)).toEqual(['remove','fees','close']);
    expect(f.rpc.blockhashes).toBe(3);expect(f.rpc.simulations).toHaveLength(3);
    expect(f.rpc.sent.every(tx=>getTransactionEncoder().encode(tx).length<=1232)).toBe(true);
    expect(f.rpc.accounts.get(POSITION)).toBeNull();
  });
  it('claims fee-only and reward-only ranges before closing, including an extended bin',async()=>{
    const f=await meteoraFixture({width:71,shares:false,reward:true});const d=f.rpc.accounts.get(POSITION)!.data;
    u64(d,feeOffset(70)+32,7n);u64(d,rewardOffset(70)+32,9n);
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,getSigner:async()=>f.signer,operation:operation(f.signer.address),
      confirm:async()=>true,beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.operation.completed.map(c=>c.step.kind)).toEqual(['fees','reward','close']);
  });
  it('closes an already empty position without creating ATAs',async()=>{
    const f=await meteoraFixture({shares:false,missingAta:true});
    const plan=await prepareWithdrawAll({rpc:f.rpc,wallet:f.signer.address,position:POSITION});
    expect(plan!.step.kind).toBe('close');expect(plan!.ataRent).toBe(0n);expect(plan!.instructions).toHaveLength(2);
  });
  it('accepts only null or the exact zero-lamport system tombstone as a closed account',async()=>{
    const f=await meteoraFixture({shares:false});
    f.rpc.mutateSimulation=accounts=>accounts.set(POSITION,{owner:ZERO,lamports:0n,executable:false,data:new Uint8Array()});
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,getSigner:async()=>f.signer,operation:operation(f.signer.address),
      confirm:async()=>true,beforeSend:async()=>{},confirmed:async()=>{}});
    expect(result.status).toBe('confirmed');
    f.rpc.accounts.set(POSITION,{owner:ZERO,lamports:1n,executable:false,data:new Uint8Array()});
    await expect(adapter.readPosition(f.rpc,f.signer.address,POSITION)).rejects.toThrow(/owner/);
    f.rpc.accounts.set(POSITION,{owner:ZERO,lamports:0n,executable:false,data:new Uint8Array()});
    expect(await adapter.readPosition(f.rpc,f.signer.address,POSITION)).toBeNull();
  });
  it.each(['missing','stale','wrong recipient','compute','shares'])('blocks invalid %s simulation snapshots',async kind=>{
    const f=await meteoraFixture({width:1});
    if(kind==='missing')f.rpc.missingSnapshot=true;if(kind==='stale')f.rpc.staleSnapshot=true;
    if(kind==='wrong recipient')f.rpc.mutateSimulation=accounts=>pubkey(accounts.get(f.reserveX)!.data,32,ZERO);
    if(kind==='shares')f.rpc.mutateSimulation=accounts=>u128(accounts.get(POSITION)!.data,72,Q64);
    const plan=await prepareWithdrawAll({rpc:f.rpc,wallet:f.signer.address,position:POSITION});
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,getSigner:async()=>f.signer,operation:operation(f.signer.address),
      confirm:async()=>true,beforeSend:async()=>{},confirmed:async()=>{}},async opts=>{
        // Use the shared executor, with a compute overflow injected only in this case.
        const {executeSafeTransaction}=await import('../src/core/transaction');
        if(kind==='compute')opts.validateSimulation=async sim=>plan!.validateSimulation({...sim,unitsConsumed:1_400_001n});
        return executeSafeTransaction(opts);
      }).catch(e=>e);
    expect(result).toBeInstanceOf(Error);expect(f.rpc.sent).toHaveLength(0);
  });
  it('freshly plans multiple arrays/transactions and all rewards before a checked close',async()=>{
    const f=await meteoraFixture({width:142,reward:true});const completed:MeteoraOperation[]=[];
    const result=await executeMeteoraWithRpc(f.rpc,{wallet:f.signer.address,getSigner:async()=>f.signer,operation:operation(f.signer.address),
      confirm:async()=>true,beforeSend:async()=>{},confirmed:async op=>{completed.push(op);}});
    expect(result.status).toBe('confirmed');expect(result.operation.completed.map(c=>c.step.kind)).toEqual(['remove','remove','remove','fees','fees','fees','reward','reward','reward','close']);
    expect(completed).toHaveLength(10);expect(f.rpc.blockhashes).toBe(10);
  });
  it('stops on cancellation and resumes from confirmed state without repeating a step',async()=>{
    const f=await meteoraFixture({width:1});let saved=operation(f.signer.address),reviews=0;
    const input={wallet:f.signer.address,getSigner:async()=>f.signer,operation:saved,confirm:async()=>++reviews===1,
      beforeSend:async()=>{},confirmed:async(op:MeteoraOperation)=>{saved=op;}};
    expect((await executeMeteoraWithRpc(f.rpc,input)).status).toBe('partial');expect(f.rpc.sent).toHaveLength(1);
    const final=await executeMeteoraWithRpc(f.rpc,{...input,operation:saved,confirm:async()=>true});
    expect(final.operation.completed.map(c=>c.step.kind)).toEqual(['remove','fees','close']);expect(f.rpc.sent).toHaveLength(3);
  });
});
