// Local UI fixture and simulations only. No request is forwarded. Submission is
// always rejected; this server cannot send anything to Solana. No BPF execution.
import { createServer } from 'node:http';
import { address,getBase58Encoder,getTransactionDecoder } from '@solana/kit';
import { meteoraFixture } from '../tests/fixtures/meteora.ts';
import { MAINNET_GENESIS } from '../src/protocols/meteora/adapter.ts';
const walletArg=process.argv.find(a=>a.startsWith('--wallet='));
const f=await meteoraFixture({width:142,reward:true,missingAta:true,wallet:walletArg?address(walletArg.slice(9)):undefined});
const encode = a => a?{owner:a.owner,executable:a.executable,lamports:Number(a.lamports??2_039_280n),
  data:[Buffer.from(a.data).toString('base64'),'base64'],rentEpoch:0,space:a.data.length}:null;
let simulations=0;
createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/stats'){res.setHeader('content-type','application/json');res.end(JSON.stringify({simulations,sends:0}));return;}
  let body='';for await(const c of req){body+=c;if(body.length>100000){res.writeHead(413).end();return;}}
  let id=null;
  try {
    const call=JSON.parse(body);id=call.id;const p=call.params??[];let result;
    const snapshot = value => ({context:{slot:100},value});
    if(call.method==='getGenesisHash')result=MAINNET_GENESIS;
    else if(call.method==='getMultipleAccounts')result=snapshot(p[0].map(k=>encode(f.rpc.accounts.get(k))));
    else if(call.method==='getAccountInfo')result=snapshot(encode(f.rpc.accounts.get(p[0])));
    else if(call.method==='getProgramAccounts') {
      const filters=p[1]?.filters??[];
      result=snapshot(f.rpc.discoveries.filter(a=>a.account.owner===p[0]&&filters.every(filter=>{
        if(filter.dataSize!==undefined)throw new Error('Fixed-size discovery is not permitted');
        const expected=getBase58Encoder().encode(filter.memcmp.bytes),offset=filter.memcmp.offset;
        return Buffer.from(a.account.data.subarray(offset,offset+expected.length)).equals(Buffer.from(expected));
      })).map(a=>({pubkey:a.address,account:encode(a.account)})));
    } else if(call.method==='getLatestBlockhash')result=snapshot({blockhash:'11111111111111111111111111111111',lastValidBlockHeight:100});
    else if(call.method==='getMinimumBalanceForRentExemption')result=2_039_280;
    else if(call.method==='getFeeForMessage')result=snapshot(5000);
    else if(call.method==='getBlockHeight')result=1;
    else if(call.method==='simulateTransaction'){
      const tx=getTransactionDecoder().decode(Buffer.from(p[0],'base64'));
      const sim=await f.rpc.simulateTransaction(tx,p[1]?.accounts?.addresses??[]);simulations++;
      result=snapshot({err:sim.error,logs:['Local fixture simulation; no BPF execution'],unitsConsumed:Number(sim.unitsConsumed),accounts:sim.snapshot.accounts.map(encode)});
    } else throw new Error('Read-only fixture: method not allowed');
    res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id,result}));
  }catch{res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:'Read-only fixture: request rejected'}}));}
}).listen(8899,'127.0.0.1',()=>console.log('Read-only Meteora fixture RPC: localhost:8899. Submission disabled.'));
