import { address, type Address } from '@solana/kit';
import { expect,it } from 'vitest';
import type { ChainAccount } from '../src/core/accounts';
import capture from './fixtures/meteora/mainnet.json';
import { validatePoolPda } from '../src/protocols/meteora/adapter';
import { decodeAccount,mintDecimals,PROGRAM,tokenState,type PoolState } from '../src/protocols/meteora/codec';
it('decodes the captured mainnet pool, validates its PDA and links ordinary SPL mints/reserves',async()=>{
  const accounts=new Map<Address,ChainAccount|null>(capture.keys.map((k,i)=>{
    const value=capture.accounts[i];return [address(k),value?{owner:address(value.owner),executable:value.executable,lamports:BigInt(value.lamports!),data:new Uint8Array(Buffer.from(value.data,'base64'))}:null];
  }));
  expect(accounts.get(PROGRAM)?.executable).toBe(true);
  const poolKey=address(capture.pool),pool=decodeAccount<PoolState>('LbPair',accounts.get(poolKey));
  await validatePoolPda(poolKey,pool);expect(mintDecimals(accounts.get(pool.token_x_mint))).toBe(6);expect(mintDecimals(accounts.get(pool.token_y_mint))).toBe(9);
  expect(tokenState(accounts.get(pool.reserve_x),pool.token_x_mint,poolKey).amount).toBeGreaterThanOrEqual(0n);
  expect(tokenState(accounts.get(pool.reserve_y),pool.token_y_mint,poolKey).amount).toBeGreaterThanOrEqual(0n);
});
