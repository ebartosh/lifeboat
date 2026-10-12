import { testWalletSigning } from './fixtures/signer';
import { address, getSignatureFromTransaction, signTransaction } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { ClaimController, type ClaimState } from '../src/mobile/claim-controller';
import { createPendingStore } from '../src/mobile/pending-store';
import type { LocalFile } from '../src/mobile/storage';
import { executeMeteoraWithRpc } from '../src/operations/meteora';
import { MeteoraAdapter } from '../src/protocols/meteora/adapter';
import { executeSafeTransaction } from '../src/core/transaction';
import { meteoraFixture, POSITION } from './fixtures/meteora';
// 142 bins with a reward pack into two transactions; one-range positions need one.
const TWO_STEPS={width:142,reward:true};
async function setup(options:Parameters<typeof meteoraFixture>[0]={width:1}) {
  const f=await meteoraFixture(options),files=new Map<LocalFile,string>();
  const io={read:vi.fn(async(n:LocalFile)=>files.get(n)??null),write:vi.fn(async(n:LocalFile,v:string)=>{files.set(n,v);}),remove:vi.fn(async(n:LocalFile)=>{files.delete(n);})};
  const store=createPendingStore(io),states:ClaimState[]=[];
  const executeStep=vi.fn(async(opts:Parameters<typeof executeSafeTransaction>[0])=>executeSafeTransaction({...opts,pollIntervalMs:0,timeoutMs:0}));
  const deps={store,execute:vi.fn(async():Promise<never>=>{throw new Error('ORE is not invoked in this fixture');}),
    meteora:vi.fn(async(_url:string,input:Parameters<typeof executeMeteoraWithRpc>[1])=>executeMeteoraWithRpc(f.rpc,input,executeStep)),
    meteoraClosed:vi.fn(async(op,minSlot)=>await new MeteoraAdapter().readPosition(f.rpc,op.wallet,op.position,minSlot)===null),
    status:vi.fn(async()=>f.rpc.getSignatureStatus()),height:vi.fn(async()=>f.rpc.getBlockHeight())
  } satisfies ConstructorParameters<typeof ClaimController>[0];
  let controller=new ClaimController(deps,s=>states.push(s));await controller.restore();
  const start=()=>controller.startMeteora('https://example.com',f.signer.address,POSITION,{signWithWallet: testWalletSigning(f.signer)});
  const review=async()=>vi.waitFor(()=>expect(states.at(-1)?.phase).toBe('review'));
  const approveAll=async(promise:Promise<void>)=>{
    let done=false;void promise.finally(()=>{done=true;});
    while(!done) {if(states.at(-1)?.phase==='review')controller.answer(true);await new Promise(resolve=>setTimeout(resolve,1));}await promise;
  };
  const restart=async()=>{controller=new ClaimController(deps,s=>states.push(s));await controller.restore();return controller;};
  return {...f,files,io,store,states,deps,executeStep,start,review,approveAll,restart,get controller(){return controller;}};
}
describe('durable Meteora controller',()=>{
  it('persists each signature before sending and each checkpoint before clearing pending',async()=>{
    const f=await setup(TWO_STEPS);
    const send=f.rpc.sendTransaction.bind(f.rpc);
    f.rpc.sendTransaction=async tx=>{
      const pending=await f.store.load(),op=await f.store.loadMeteora!();
      expect(pending?.signature).toBe(getSignatureFromTransaction(tx));expect(pending?.operationId).toBe(op?.id);
      expect(pending?.position).toBe(POSITION);return send(tx);
    };
    await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('confirmed');expect(f.states.at(-1)?.operation?.completed).toHaveLength(2);
    expect(await f.store.load()).toBeNull();expect(await f.store.loadMeteora!()).toBeNull();
    const events=f.io.write.mock.calls.map(c=>c[0]);expect(events.filter(n=>n==='pending.json')).toHaveLength(2);
    expect(f.controller.locked).toBe(false);
  });
  it('restores confirmed partial progress and prepares only remaining steps',async()=>{
    const f=await setup(TWO_STEPS);const running=f.start();await f.review();f.controller.answer(true);
    await vi.waitFor(()=>expect(f.states.at(-1)?.review?.action==='meteora-withdraw-all'&&f.states.at(-1)?.review && 'step' in f.states.at(-1)!.review!).toBe(true));
    await vi.waitFor(()=>expect(f.states.at(-1)?.operation?.completed).toHaveLength(1));
    await f.review();f.controller.answer(false);await running;
    expect(f.states.at(-1)?.phase).toBe('partial');await f.restart();expect(f.states.at(-1)?.phase).toBe('partial');
    await f.approveAll(f.start());expect(f.rpc.sent).toHaveLength(2);expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('restores Token-2022 unknown results and resumes only after signature resolution',async()=>{
    const f=await setup({...TWO_STEPS,token2022:true,reward2022:true,transferFee:true,missingAta:true});
    f.rpc.status=null;await f.approveAll(f.start());expect(f.states.at(-1)?.phase).toBe('unknown');
    await f.restart();expect(f.controller.locked).toBe(true);await f.start();expect(f.rpc.sent).toHaveLength(1);
    f.rpc.status={confirmationStatus:'confirmed',error:null,slot:100n};await f.controller.check();
    expect((await f.store.loadMeteora!())?.completed).toHaveLength(1);
    await f.approveAll(f.start());expect(f.states.at(-1)?.phase).toBe('confirmed');
    expect(f.rpc.sent).toHaveLength(2);expect(await f.store.loadMeteora!()).toBeNull();
  });
  it('blocks unknown signatures after expiry, RPC failure, wallet change and restart',async()=>{
    const f=await setup();f.rpc.sendError=true;await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('unknown');expect(f.rpc.sent).toHaveLength(1);
    f.rpc.status=null;f.rpc.height=101n;await f.restart();await f.controller.check();
    expect(f.states.at(-1)?.message).toMatch(/does not prove/);expect(f.controller.locked).toBe(true);
    await f.controller.startMeteora('https://example.com',address('11111111111111111111111111111113'),POSITION,{signWithWallet: testWalletSigning(f.signer)});
    await f.start();expect(f.rpc.sent).toHaveLength(1);
    f.deps.status.mockRejectedValueOnce(new Error('RPC down'));await f.controller.check();expect(f.states.at(-1)?.phase).toBe('unknown');
    expect(await f.store.load()).not.toBeNull();
  });
  it('checks an unknown successful signature then resumes without repeating it',async()=>{
    const f=await setup(TWO_STEPS);f.rpc.status=null;await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('unknown');expect(f.rpc.sent).toHaveLength(1);
    f.rpc.status={confirmationStatus:'confirmed',error:null,slot:100n};await f.restart();await f.controller.check();
    expect(f.states.at(-1)?.phase).toBe('partial');expect((await f.store.loadMeteora!())?.completed).toHaveLength(1);
    await f.approveAll(f.start());expect(f.rpc.sent).toHaveLength(2);expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('does not duplicate a checkpoint if a crash occurs after saving confirmation and before clearing pending',async()=>{
    const f=await setup(TWO_STEPS);let failed=false;
    f.io.remove.mockImplementation(async name=>{if(name==='pending.json'&&!failed){failed=true;throw new Error('disk error');}f.files.delete(name);});
    await f.approveAll(f.start());expect(f.states.at(-1)?.phase).toBe('unknown');expect(f.rpc.sent).toHaveLength(1);
    await f.restart();await f.controller.check();expect((await f.store.loadMeteora!())?.completed).toHaveLength(1);
    await f.approveAll(f.start());expect(f.rpc.sent).toHaveLength(2);
  });
  it('announces completion only after checking final state, even after a recovered close',async()=>{
    const f=await setup({shares:false});f.rpc.status=null;await f.approveAll(f.start());
    expect(f.states.at(-1)?.phase).toBe('unknown');f.rpc.status={confirmationStatus:'confirmed',error:null,slot:100n};
    f.deps.meteoraClosed.mockRejectedValueOnce(new Error('RPC unavailable'));
    await f.controller.check();expect(f.states.at(-1)?.phase).toBe('partial');expect(await f.store.load()).toBeNull();
    await f.restart();await f.approveAll(f.start());expect(f.states.at(-1)?.phase).toBe('confirmed');expect(f.rpc.sent).toHaveLength(1);
  });
  it('keeps confirmed steps after an on-chain failure and permits a fresh re-read',async()=>{
    const f=await setup();f.rpc.status={confirmationStatus:'confirmed',error:{InstructionError:[0,'Custom']},slot:100n};
    // Model failed transactions atomically: do not apply their effects.
    f.rpc.sendTransaction=async tx=>{f.rpc.sent.push(tx);return getSignatureFromTransaction(tx);};
    await f.approveAll(f.start());expect(f.states.at(-1)?.phase).toBe('failed');expect(f.states.at(-1)?.message).toMatch(/failed on-chain/);
    expect(await f.store.load()).toBeNull();expect((await f.store.loadMeteora!())?.completed).toHaveLength(0);
  });
  it('blocks corrupted or mismatched operation records rather than allowing another submission',async()=>{
    const f=await setup();f.files.set('meteora-operation.json','{}');await f.restart();expect(f.states.at(-1)?.phase).toBe('blocked');
    expect(f.controller.locked).toBe(true);await f.start();expect(f.rpc.sent).toHaveLength(0);
  });
  it('cancels before signing on wallet invalidation and handles external signature rejection',async()=>{
    const f=await setup();const running=f.start();await f.review();f.controller.invalidate();await running;
    expect(f.rpc.sent).toHaveLength(0);expect(f.states.at(-1)?.phase).toBe('cancelled');
    const rejected=f.controller.startMeteora('https://example.com',f.signer.address,POSITION,{signWithWallet:async()=>{throw new Error('User rejected');}});
    await f.approveAll(rejected);expect(f.rpc.sent).toHaveLength(0);expect(f.states.at(-1)?.message).toMatch(/rejected/);
  });
  it('allows MWA foreground handoff for every step and verifies wallet signatures',async()=>{
    const f=await setup(TWO_STEPS);const sign=vi.fn(async tx=>{f.controller.setForeground(false);f.controller.setForeground(true);return signTransaction([f.signer.keyPair],tx);});
    await f.approveAll(f.controller.startMeteora('https://example.com',f.signer.address,POSITION,{signWithWallet:sign}));
    expect(sign).toHaveBeenCalledTimes(2);expect(f.states.at(-1)?.phase).toBe('confirmed');
  });
  it('stops an expired pre-signature blockhash without sending or creating a pending signature',async()=>{
    const f=await setup();const running=f.start();await f.review();f.rpc.height=101n;f.controller.answer(true);await running;
    expect(f.rpc.sent).toHaveLength(0);expect(await f.store.load()).toBeNull();
    expect(f.states.at(-1)?.message).toMatch(/This step expired before sending/);
    expect(f.states.at(-1)?.message).toContain('Resume the withdrawal');
    expect(f.states.at(-1)?.message).toContain('without long pauses');
  });
  it('keeps confirmed progress when the next step expires and explains how to resume',async()=>{
    const f=await setup(TWO_STEPS);const running=f.start();await f.review();f.controller.answer(true);
    await vi.waitFor(()=>expect(f.states.at(-1)?.operation?.completed).toHaveLength(1));
    await f.review();f.rpc.height=101n;f.controller.answer(true);await running;
    expect(f.rpc.sent).toHaveLength(1);expect(await f.store.load()).toBeNull();
    expect((await f.store.loadMeteora!())?.completed).toHaveLength(1);
    expect(f.states.at(-1)?.phase).toBe('partial');
    expect(f.states.at(-1)?.message).toContain('Confirmed steps are kept. Resume the withdrawal');
    expect(f.states.at(-1)?.message).not.toContain('Nothing was sent');
  });
});
