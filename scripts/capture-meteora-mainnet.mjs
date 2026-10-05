// Read-only: no transaction building, signing or submission methods.
import { mkdir,writeFile } from 'node:fs/promises';
import { address,getBase58Decoder } from '@solana/kit';
import { SolanaRpcClient } from '../src/core/rpc.ts';
import { MeteoraAdapter,validatePoolPda } from '../src/protocols/meteora/adapter.ts';
import { decodeAccount,discriminator,PROGRAM,TOKEN,WSOL,ZERO,mintDecimals,tokenState } from '../src/protocols/meteora/codec.ts';
import metadata from '../src/protocols/meteora/metadata.json' with {type:'json'};
const rpc=new SolanaRpcClient(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
await new MeteoraAdapter().assertNetwork(rpc);
const discovered=await rpc.getProgramAccountsByFilters(PROGRAM,[
  {offset:0,bytes:getBase58Decoder().decode(Uint8Array.from(discriminator('LbPair')))},
  {offset:88,bytes:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}, {offset:120,bytes:WSOL}]);
const eligible=discovered.accounts.find(a=>{const p=decodeAccount('LbPair',a.account);return p.token_mint_x_program_flag===0&&p.token_mint_y_program_flag===0&&p.bin_array_bitmap.some(v=>v!==0n);});
assertPool(eligible);
const poolKey=eligible.address;
function assertPool(value) { if(!value)throw new Error('No SPL USDC/WSOL pool found'); }
const first=await rpc.getAccounts([PROGRAM,poolKey]);
const pool=decodeAccount('LbPair',first.accounts[1]);await validatePoolPda(poolKey,pool);
const keys=[PROGRAM,poolKey,TOKEN,pool.token_x_mint,pool.token_y_mint,pool.reserve_x,pool.reserve_y,
  ...pool.reward_infos.filter(r=>r.mint!==ZERO).flatMap(r=>[r.mint,r.vault])];
const snapshot=await rpc.getAccounts(keys,first.slot);
const accounts=new Map(keys.map((k,i)=>[k,snapshot.accounts[i]]));
for(const mint of [pool.token_x_mint,pool.token_y_mint]) mintDecimals(accounts.get(mint));
tokenState(accounts.get(pool.reserve_x),pool.token_x_mint,poolKey);tokenState(accounts.get(pool.reserve_y),pool.token_y_mint,poolKey);
const capture={provenance:{source:'Solana mainnet-beta read-only getMultipleAccounts',sourceCommit:metadata.sourceCommit,
  discovery:'LbPair discriminator and USDC/WSOL mint filters; no dataSize',capturedAt:new Date().toISOString(),slot:snapshot.slot.toString()},pool:poolKey,keys,
  accounts:snapshot.accounts.map(a=>a?{owner:a.owner,executable:a.executable,lamports:a.lamports?.toString(),data:Buffer.from(a.data).toString('base64')}:null)};
await mkdir('tests/fixtures/meteora',{recursive:true});
await writeFile('tests/fixtures/meteora/mainnet.json',JSON.stringify(capture,null,2)+'\n');
console.log(`Read-only mainnet capture: ${keys.length} accounts, pool type ${pool.pair_type}, slot ${snapshot.slot}; no transactions.`);
