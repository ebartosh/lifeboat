// Unsigned, read-only validation. There is no signing material and send is blocked.
// SOLANA_RPC_URL (optional), ORCA_POOLS (comma-separated), ORCA_PER_CATEGORY (default 1).
import { writeFile } from 'node:fs/promises';
import { createSolanaRpc, getBase64Encoder, getTransactionEncoder, compileTransaction, createTransactionMessage, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions } from '@solana/kit';
import { SolanaRpcClient } from '../src/core/rpc.ts';
import { decodeTokenAccount, TOKEN_PROGRAM } from '../src/core/tokens.ts';
import { executeSafeTransaction } from '../src/core/transaction.ts';
import { OrcaAdapter } from '../src/protocols/orca/adapter.ts';
import { decodeAccount, DISCRIMINATORS, hasDiscriminator, PROGRAM } from '../src/protocols/orca/codec.ts';
import { tickArrayAddress } from '../src/protocols/orca/instructions.ts';
import { tickArrayStartIndex } from '../src/protocols/orca/math.ts';
import { prepareWithdrawAll } from '../src/protocols/orca/withdraw.ts';
const url=process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
// Public RPCs rate-limit bursts: retry HTTP 429 with backoff instead of failing the read.
const baseFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{for(let i=0;;i++){const response=await baseFetch(...args);
  if(response.status!==429||i>=8)return response;await new Promise(resolve=>setTimeout(resolve,1000*2**Math.min(i,4)));}};
const rpc=new SolanaRpcClient(url),raw=createSolanaRpc(url);
rpc.sendTransaction=async()=>{throw new Error('Submission is disabled for read-only integration verification');};
await new OrcaAdapter().assertNetwork(rpc);
const pools=(process.env.ORCA_POOLS||'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ,Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE').split(',');
const perCategory=Number(process.env.ORCA_PER_CATEGORY||1),maxAttempts=Number(process.env.ORCA_MAX_ATTEMPTS||40);
const pause=()=>new Promise(resolve=>setTimeout(resolve,400));
const bytes=data=>Uint8Array.from(getBase64Encoder().encode(data[0]));
const attempts=[],passed=new Map();
// Rewritten after every attempt, so an interrupted run keeps its evidence.
const save=()=>writeFile('.cache/orca-mainnet-simulation.json',JSON.stringify({unsigned:true,submitted:false,rpc:url.replace(/\?.*$/,''),attempts},null,2));
for(const pool of pools) {
  const whirlpool=decodeAccount('Whirlpool',await rpc.getAccount(pool));
  const found=await raw.getProgramAccounts(PROGRAM,{encoding:'base64',withContext:true,filters:[{dataSize:216n},{memcmp:{offset:8n,bytes:pool,encoding:'base58'}}]}).send();
  let positions=found.value.map(item=>({address:item.pubkey,state:decodeAccount('Position',{owner:item.account.owner,executable:false,data:bytes(item.account.data)})}));
  // ORCA_DYNAMIC=1 keeps positions with a tick array outside the pinned fixed format (8-byte discriminator reads only).
  const dynamic=process.env.ORCA_DYNAMIC==='1';
  if(dynamic) {
    const starts=new Map();
    for(const p of positions.filter(p=>p.state.liquidity>0n)) for(const t of [p.state.tickLowerIndex,p.state.tickUpperIndex]) {
      const start=tickArrayStartIndex(t,whirlpool.tickSpacing); if(!starts.has(start))starts.set(start,await tickArrayAddress(pool,start));
    }
    const keys=[...starts.values()],fixed=new Set();
    for(let i=0;i<keys.length;i+=100) {
      const part=keys.slice(i,i+100),res=await raw.getMultipleAccounts(part,{encoding:'base64',dataSlice:{offset:0,length:8}}).send();
      res.value.forEach((a,j)=>{if(a&&hasDiscriminator(bytes(a.data),DISCRIMINATORS.TickArray))fixed.add(part[j]);});
    }
    positions=positions.filter(p=>p.state.liquidity>0n&&[p.state.tickLowerIndex,p.state.tickUpperIndex].some(t=>!fixed.has(starts.get(tickArrayStartIndex(t,whirlpool.tickSpacing)))));
    console.log(`${positions.length} positions use a tick array outside the pinned format in ${pool}`);
  }
  const category=s=>(dynamic?'dynamic-':'')+(s.liquidity===0n?'empty':whirlpool.tickCurrentIndex>=s.tickLowerIndex&&whirlpool.tickCurrentIndex<s.tickUpperIndex?'in-range':'out-of-range');
  for(const item of positions.sort((a,b)=>a.address<b.address?-1:1)) {
    const kind=category(item.state);
    if((passed.get(kind)??0)>=perCategory)continue;
    if(attempts.length>=maxAttempts)break;
    if(['empty','in-range','out-of-range'].map(k=>(dynamic?'dynamic-':'')+k).filter(k=>!dynamic||k!=='dynamic-empty').every(k=>(passed.get(k)??0)>=perCategory))break;
    try {
      await pause();
      // Public RPCs throttle getTokenLargestAccounts; a mint-filtered token-account scan finds the NFT holder instead.
      const nftProgram=(await rpc.getAccount(item.state.positionMint))?.owner;
      if(!nftProgram)continue;
      const holders=await raw.getProgramAccounts(nftProgram,{encoding:'base64',filters:[{memcmp:{offset:0n,bytes:item.state.positionMint,encoding:'base58'}},
        ...(nftProgram===TOKEN_PROGRAM?[{dataSize:165n}]:[])]}).send();
      const holding=holders.map(h=>decodeTokenAccount({owner:h.account.owner,executable:false,data:bytes(h.account.data)})).find(t=>t.amount===1n);
      if(!holding)continue;
      const wallet=holding.authority;
      const plan=await prepareWithdrawAll({rpc,wallet,position:item.address,minSlot:BigInt(found.context.slot)});
      if(!plan)continue;
      const record={pool,position:item.address,category:kind,positionNft:plan.position.positionMint.program,ticksKnown:plan.position.ticksKnown,
        closeHold:plan.closeHold,actions:plan.step.id,remainingSteps:plan.remainingSteps,
        bytes:getTransactionEncoder().encode(compileTransaction(pipe(createTransactionMessage({version:'legacy'}),m=>setTransactionMessageFeePayer(wallet,m),
          m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:'11111111111111111111111111111111',lastValidBlockHeight:0n},m),
          m=>appendTransactionMessageInstructions(plan.instructions,m)))).length};
      const result=await executeSafeTransaction({rpc,wallet,signWithWallet:async()=>{throw new Error('Signing disabled');},
        instructions:plan.instructions,simulationAccounts:plan.simulationAccounts,validateSimulation:plan.validateSimulation,
        confirm:async review=>{Object.assign(record,{unitsConsumed:review.simulation.unitsConsumed?.toString(),feeLamports:review.feeLamports?.toString(),
          snapshotSlot:review.simulation.snapshot.slot.toString(),
          receipts:plan.receipts.map(t=>({mint:t.mint,tokenProgram:t.token.program,grossAmount:t.grossAmount.toString(),transferFee:t.transferFee.toString(),netAmount:t.amount.toString()})),
          estimates:plan.remainingReceipts.map(t=>({mint:t.mint,netAmount:t.amount.toString()}))});return false;}});
      if(result.status!=='cancelled')throw new Error('Unexpected execution result');
      attempts.push(record);passed.set(kind,(passed.get(kind)??0)+1);await save();
      console.log(`Unsigned mainnet simulation passed: ${kind} ${item.address}: ${plan.step.id}; ${record.unitsConsumed} CU, ${record.bytes} bytes; no signature or submission.`);
    } catch(error) { attempts.push({pool,position:item.address,category:kind,error:error.message.split('\n')[0]});
      console.log(`Skipped ${kind} ${item.address}: ${attempts.at(-1).error}`);await save(); }
  }
}
await save();
if(!passed.size)throw new Error(`No usable mainnet simulation in ${attempts.length} checked public positions; inspect the report.`);
console.log(`Passed categories: ${JSON.stringify(Object.fromEntries(passed))}; report: .cache/orca-mainnet-simulation.json`);
