import { type Address } from '@solana/kit';
import { keyBytes } from '../../src/protocols/meteora/instructions';
// Independent fixtures following the official Token-2022 TLV/POD wire layout.
export function extendedBytes(base: Uint8Array, kind: 1 | 2, entries: readonly [number, Uint8Array][]) {
  const d = new Uint8Array(166 + entries.reduce((n,[,v]) => n+4+v.length,0));
  d.set(base); d[165]=kind; let offset=166;
  for (const [type,payload] of entries) {
    const v = new DataView(d.buffer); v.setUint16(offset,type,true); v.setUint16(offset+2,payload.length,true);
    d.set(payload,offset+4); offset+=4+payload.length;
  }
  return d;
}
export function feeConfigBytes(olderBps=100, newerBps=200, maximum=1000n, newerEpoch=5n) {
  const d=new Uint8Array(108),v=new DataView(d.buffer);
  v.setBigUint64(80,maximum,true);v.setUint16(88,olderBps,true);
  v.setBigUint64(90,newerEpoch,true);v.setBigUint64(98,maximum,true);v.setUint16(106,newerBps,true);
  return d;
}
export function metadataBytes(mint: Address) {
  const strings=['Fixture token','FIX','https://example.com/token.json','network','test'].map(s=>Buffer.from(s,'utf8'));
  const d=new Uint8Array(64+4+strings.reduce((n,s)=>n+4+s.length,0)); d.set(keyBytes(mint),32);
  let offset=64;
  strings.forEach((s,i)=>{
    if(i===3) {new DataView(d.buffer).setUint32(offset,1,true);offset+=4;}
    new DataView(d.buffer).setUint32(offset,s.length,true);offset+=4;d.set(s,offset);offset+=s.length;
  });return d;
}
