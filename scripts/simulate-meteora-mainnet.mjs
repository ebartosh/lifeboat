// Unsigned, read-only validation. There is no signing material and send is blocked.
import { readFile,writeFile } from 'node:fs/promises';
import { appendTransactionMessageInstructions,compileTransaction,createTransactionMessage,getBase58Decoder,getTransactionEncoder,pipe,
  setTransactionMessageFeePayer,setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import { SolanaRpcClient } from '../src/core/rpc.ts';
import { executeSafeTransaction } from '../src/core/transaction.ts';
import { MeteoraAdapter } from '../src/protocols/meteora/adapter.ts';
import { decodePosition,discriminator,PROGRAM } from '../src/protocols/meteora/codec.ts';
import { prepareWithdrawAll } from '../src/protocols/meteora/withdraw.ts';
const capture=JSON.parse(await readFile('tests/fixtures/meteora/mainnet.json','utf8'));
const rpc=new SolanaRpcClient(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
rpc.sendTransaction=async()=>{throw new Error('Submission is disabled for read-only integration verification');};
await new MeteoraAdapter().assertNetwork(rpc);
const pool=process.env.METEORA_POOL||capture.pool,limit=Number(process.env.METEORA_POSITIONS||1);
const found=await rpc.getProgramAccountsByFilters(PROGRAM,[
  {offset:0,bytes:getBase58Decoder().decode(Uint8Array.from(discriminator('PositionV2')))}, {offset:8,bytes:pool}]);
const attempts=[];let passed=0;
for(const item of found.accounts.slice(0,Math.max(5,limit*3))) {
  try {
    const state=decodePosition(item.account),plan=await prepareWithdrawAll({rpc,wallet:state.owner,position:item.address,minSlot:found.slot});
    if(!plan)continue;
    const result=await executeSafeTransaction({rpc,wallet:state.owner,signWithWallet:async()=>{throw new Error('Signing disabled');},
      instructions:plan.instructions,simulationAccounts:plan.simulationAccounts,validateSimulation:plan.validateSimulation,
      confirm:async review=>{attempts.push({position:item.address,actions:plan.step.id,remainingSteps:plan.remainingSteps,
        bytes:getTransactionEncoder().encode(compileTransaction(pipe(createTransactionMessage({version:'legacy'}),m=>setTransactionMessageFeePayer(state.owner,m),
          m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:'11111111111111111111111111111111',lastValidBlockHeight:0n},m),
          m=>appendTransactionMessageInstructions(plan.instructions,m)))).length,
        unitsConsumed:review.simulation.unitsConsumed?.toString(),feeLamports:review.feeLamports?.toString(),
        receipts:plan.receipts.map(t=>({mint:t.mint,tokenProgram:t.token.program,grossAmount:t.grossAmount.toString(),transferFee:t.transferFee.toString(),netAmount:t.amount.toString()})),snapshotSlot:review.simulation.snapshot.slot.toString()});return false;}});
    if(result.status!=='cancelled')throw new Error('Unexpected execution result');
    console.log(`Unsigned mainnet simulation passed: ${plan.step.id}; ${attempts.at(-1).unitsConsumed} CU, ${attempts.at(-1).bytes} bytes; no signature or submission.`);
    if(++passed>=limit)break;
  }catch(error){attempts.push({position:item.address,error:error.message});}
}
if(passed){await writeFile('.cache/meteora-mainnet-simulation.json',JSON.stringify({unsigned:true,submitted:false,attempts},null,2));process.exit(0);}
await writeFile('.cache/meteora-mainnet-simulation.json',JSON.stringify({unsigned:true,submitted:false,attempts},null,2));
throw new Error(`No usable mainnet simulation in ${attempts.length} checked public positions; inspect the report.`);
