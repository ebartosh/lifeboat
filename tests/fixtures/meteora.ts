import { createHash } from 'node:crypto';
import { address, blockhash, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, type Address, type Transaction } from '@solana/kit';
import type { AccountFilter, ChainAccount } from '../../src/core/accounts';
import type { SignatureStatus, SimulationResult } from '../../src/core/rpc';
import { MAINNET_GENESIS } from '../../src/protocols/meteora/adapter';
import { ATA, CLOCK, PROGRAM, SYSVAR, TOKEN, WSOL, ZERO } from '../../src/protocols/meteora/codec';
import { ataAddress, binArrayAddress, integerBytes, keyBytes, pda } from '../../src/protocols/meteora/instructions';
import { createTestSigner } from './signer';
export const POSITION = address('11111111111111111111111111111112');
export const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const REWARD = address('11111111111111111111111111111114');
export const Q64 = 1n << 64n;
export const u64 = (d:Uint8Array,o:number,n:bigint) => new DataView(d.buffer,d.byteOffset,d.byteLength).setBigUint64(o,n,true);
export const u128 = (d:Uint8Array,o:number,n:bigint) => { u64(d,o,n & (Q64-1n)); u64(d,o+8,n >> 64n); };
export const i32 = (d:Uint8Array,o:number,n:number) => new DataView(d.buffer,d.byteOffset,d.byteLength).setInt32(o,n,true);
export const pubkey = (d:Uint8Array,o:number,key:Address) => d.set(keyBytes(key),o);
function bytes(name:string,size:number) {
  const d = new Uint8Array(size); d.set(createHash('sha256').update('account:'+name).digest().subarray(0,8)); return d;
}
export function tokenBytes(mint:Address,owner:Address,amount:bigint) {
  const d = new Uint8Array(165); pubkey(d,0,mint); pubkey(d,32,owner); u64(d,64,amount); d[108]=1;
  if (mint === WSOL) new DataView(d.buffer).setUint32(109,1,true);
  return d;
}
// Independent offsets from pinned Rust/Anchor layouts, not the production decoder.
export function positionBytes(wallet:Address,pool:Address,lower:number,width:number,shares=true) {
  const d = bytes('PositionV2',8120+Math.max(0,width-70)*112); pubkey(d,8,pool); pubkey(d,40,wallet);
  i32(d,7912,lower); i32(d,7916,lower+width-1);
  for(let i=0;i<width;i++) {
    const shareOffset = i<70 ? 72+i*16 : 8120+(i-70)*112;
    if (shares) u128(d,shareOffset,2n*Q64);
  }
  return d;
}
export function feeOffset(i:number) { return i<70 ? 4552+i*48 : 8120+(i-70)*112+64; }
export function rewardOffset(i:number) { return i<70 ? 1192+i*48 : 8120+(i-70)*112+16; }
export class MeteoraFixtureRpc {
  accounts = new Map<Address,ChainAccount|null>();
  slot = 100n; height = 1n; genesis = MAINNET_GENESIS;
  discoveries: {address:Address;account:ChainAccount}[] = [];
  filters: readonly AccountFilter[][] = [];
  sent: Transaction[] = []; simulations: Transaction[] = []; blockhashes = 0;
  status: SignatureStatus | null = {confirmationStatus:'confirmed',error:null,slot:100n};
  simulationError: unknown = null; missingSnapshot = false; staleSnapshot = false;
  mutateSimulation?: (accounts:Map<Address,ChainAccount|null>) => void;
  sendError = false; fee:bigint|null = 5000n;
  async getGenesisHash() { return this.genesis; }
  async getAccount(key:Address) { return this.accounts.get(key) ?? null; }
  async getAccounts(keys:readonly Address[],minSlot=0n) { if (minSlot>this.slot) throw new Error('Stale RPC'); return {slot:this.slot,accounts:keys.map(k=>this.accounts.get(k) ?? null)}; }
  async getProgramAccounts(_program:Address,_size:number,_filters:readonly AccountFilter[]):Promise<never> { throw new Error('Fixed-size discovery must not be used'); }
  async getProgramAccountsByFilters(_program:Address,filters:readonly AccountFilter[]) {
    this.filters=[...this.filters,[...filters]];
    return {slot:this.slot,accounts:this.discoveries.filter(item => filters.every(f => f.offset===0
      ? Buffer.from(item.account.data.subarray(0,8)).equals(Buffer.from((awaitDisc(f.bytes)))) : true))};
  }
  async getMinimumBalanceForRentExemption() { return 2_039_280n; }
  async getLatestBlockhash() {
    this.blockhashes++; return {blockhash:blockhash(address('11111111111111111111111111111111')),lastValidBlockHeight:100n};
  }
  async getTransactionFee() { return this.fee; }
  async getBlockHeight() { return this.height; }
  async getSignatureStatus() { return this.status; }
  private apply(tx:Transaction) {
    const accounts = new Map([...this.accounts].map(([k,v]) => [k,v ? {...v,data:v.data.slice()} : null]));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if(message.version !== 'legacy') throw new Error('Fixture only accepts legacy messages');
    for(const ix of message.instructions ?? []) {
      const program=message.staticAccounts[ix.programAddressIndex]!, keys=(ix.accountIndices ?? []).map(i=>message.staticAccounts[i]!);
      if(program===ATA) { if(!accounts.get(keys[1]!)) accounts.set(keys[1]!,{owner:TOKEN,executable:false,data:tokenBytes(keys[3]!,keys[2]!,0n)}); continue; }
      if(program!==PROGRAM) continue;
      const d=ix.data!,v=new DataView(d.buffer,d.byteOffset,d.byteLength);
      const kind = d[0]===204 ? 'remove' : d[0]===112 ? 'fees' : d[0]===190 ? 'reward' : 'close';
      const posKey = kind==='remove'||kind==='close' ? keys[0]! : keys[1]!;
      const pos=accounts.get(posKey)!;
      if(kind==='close') { accounts.set(posKey,null); continue; }
      const poolKey=kind==='remove' ? keys[1]! : keys[0]!;
      const pool=accounts.get(poolKey)!.data;
      const offset=kind==='reward' ? 16 : 8, lower=v.getInt32(offset,true),upper=v.getInt32(offset+4,true);
      const base=new DataView(pos.data.buffer).getInt32(7912,true);
      let x=0n,y=0n,r=0n;
      const reward=kind==='reward' ? Number(v.getBigUint64(8,true)) : 0;
      for(let id=lower;id<=upper;id++) {
        const i=id-base, shareOffset=i<70 ? 72+i*16 : 8120+(i-70)*112;
        const shareView=new DataView(pos.data.buffer),share=shareView.getBigUint64(shareOffset,true)|(shareView.getBigUint64(shareOffset+8,true)<<64n);
        const arrayKey=keys.find(k=>{
          const a=accounts.get(k); return a?.data.length===10136 && new DataView(a.data.buffer).getBigInt64(8,true)===BigInt(Math.floor(id/70));
        });
        const binOffset=56+(id-Math.floor(id/70)*70)*144;
        if(kind==='remove' && share>0n) {
          const b=accounts.get(arrayKey!)!.data,bv=new DataView(b.buffer);
          const supply=bv.getBigUint64(binOffset+32,true)|(bv.getBigUint64(binOffset+40,true)<<64n);
          const ax=share*bv.getBigUint64(binOffset,true)/supply,ay=share*bv.getBigUint64(binOffset+8,true)/supply;
          x+=ax;y+=ay;u64(b,binOffset,bv.getBigUint64(binOffset,true)-ax);u64(b,binOffset+8,bv.getBigUint64(binOffset+8,true)-ay);
          u128(b,binOffset+32,supply-share);u128(pos.data,shareOffset,0n);
          const fo=feeOffset(i); u64(pos.data,fo+32,shareView.getBigUint64(fo+32,true)+((share>>64n)*2n));
          const ro=rewardOffset(i); if(pool[35]===1) u64(pos.data,ro+32,shareView.getBigUint64(ro+32,true)+(share>>64n)*3n);
        } else if(kind==='fees') { const f=feeOffset(i); x+=shareView.getBigUint64(f+32,true);y+=shareView.getBigUint64(f+40,true);u64(pos.data,f+32,0n);u64(pos.data,f+40,0n); }
        else if(kind==='reward') {const ro=rewardOffset(i)+32+reward*8;r+=shareView.getBigUint64(ro,true);u64(pos.data,ro,0n);}
      }
      const transfer=(ata:Address,vault:Address,amount:bigint) => {
        const user=accounts.get(ata)!.data,source=accounts.get(vault)!.data;
        u64(user,64,new DataView(user.buffer).getBigUint64(64,true)+amount);
        u64(source,64,new DataView(source.buffer).getBigUint64(64,true)-amount);
      };
      if(kind==='remove') {transfer(keys[3]!,keys[5]!,x);transfer(keys[4]!,keys[6]!,y);}
      else if(kind==='fees') {transfer(keys[5]!,keys[3]!,x);transfer(keys[6]!,keys[4]!,y);}
      else transfer(keys[5]!,keys[3]!,r);
    }
    return accounts;
  }
  async simulateTransaction(tx:Transaction,keys?:readonly Address[]):Promise<SimulationResult> {
    this.simulations.push(tx);const accounts=this.apply(tx);this.mutateSimulation?.(accounts);
    return {error:this.simulationError,logs:[],unitsConsumed:200_000n,...(this.missingSnapshot ? {} : {snapshot:{slot:this.staleSnapshot?99n:this.slot,accounts:(keys??[]).map(k=>accounts.get(k)??null)}})};
  }
  async sendTransaction(tx:Transaction) { this.sent.push(tx);if(this.sendError) throw new Error('RPC disconnected');this.accounts=this.apply(tx);return getSignatureFromTransaction(tx); }
}
import { getBase58Encoder } from '@solana/kit';
const awaitDisc = (text:string) => getBase58Encoder().encode(text);
export async function meteoraFixture(options:{lower?:number;width?:number;shares?:boolean;reward?:boolean;oneSided?:boolean;missingAta?:boolean;wallet?:Address}={}) {
  const signer=await createTestSigner(),rpc=new MeteoraFixtureRpc();
  const wallet=options.wallet ?? signer.address;
  const lower=options.lower ?? -35,width=options.width ?? 70;
  const ordered=[USDC,WSOL].sort((a,b)=>Buffer.compare(Buffer.from(keyBytes(a)),Buffer.from(keyBytes(b))));
  const poolKey=await pda([...ordered.map(keyBytes),new Uint8Array([1,0])]);
  const reserveX=await pda([keyBytes(poolKey),keyBytes(USDC)]),reserveY=await pda([keyBytes(poolKey),keyBytes(WSOL)]);
  const rewardVault=await pda([keyBytes(poolKey),integerBytes(0n,8)]);
  const pool=bytes('LbPair',904);pool[73]=1;i32(pool,76,lower);pool[80]=1;i32(pool,24,-443636);i32(pool,28,443636);
  pubkey(pool,88,USDC);pubkey(pool,120,WSOL);pubkey(pool,152,reserveX);pubkey(pool,184,reserveY);
  if(options.reward) {pool[35]=1;pubkey(pool,264,REWARD);pubkey(pool,296,rewardVault);u64(pool,368,1n);}
  const set=(key:Address,data:Uint8Array,owner=PROGRAM,lamports=10_000_000n)=>rpc.accounts.set(key,{owner,executable:false,data,lamports});
  set(poolKey,pool);set(POSITION,positionBytes(wallet,poolKey,lower,width,options.shares!==false));
  set(reserveX,tokenBytes(USDC,poolKey,10_000_000n),TOKEN);set(reserveY,tokenBytes(WSOL,poolKey,10_000_000n),TOKEN);
  if(options.reward) set(rewardVault,tokenBytes(REWARD,poolKey,10_000_000n),TOKEN);
  for(const mint of [USDC,WSOL,...(options.reward?[REWARD]:[])]) {
    const data=new Uint8Array(82);data[44]=mint===USDC?6:9;data[45]=1;set(mint,data,TOKEN);
    if(!options.missingAta) set(await ataAddress(wallet,mint),tokenBytes(mint,wallet,1000n),TOKEN);
  }
  const clock=new Uint8Array(40);u64(clock,0,100n);u64(clock,32,100n);set(CLOCK,clock,SYSVAR);
  rpc.accounts.set(PROGRAM,{owner:address('BPFLoaderUpgradeab1e11111111111111111111111'),executable:true,data:new Uint8Array()});
  rpc.accounts.set(TOKEN,{owner:ZERO,executable:true,data:new Uint8Array()});
  for(let index=Math.floor(lower/70);index<=Math.floor((lower+width-1)/70);index++) {
    const data=bytes('BinArray',10136);new DataView(data.buffer).setBigInt64(8,BigInt(index),true);pubkey(data,24,poolKey);
    for(let i=0;i<70;i++) {const b=56+i*144;u64(data,b,100n);u64(data,b+8,options.oneSided?0n:200n);u128(data,b+32,4n*Q64);u128(data,b+80,2n*Q64);if(options.reward)u128(data,b+48,3n*Q64);}
    set(await binArrayAddress(poolKey,index),data);
  }
  rpc.discoveries=[{address:POSITION,account:rpc.accounts.get(POSITION)!}];
  return {rpc,signer,poolKey,reserveX,reserveY,rewardVault};
}
