import { address } from '@solana/kit';
import { describe,expect,it } from 'vitest';
import { SolanaRpcClient } from '../src/core/rpc';
import { MeteoraAdapter,validatePoolPda } from '../src/protocols/meteora/adapter';
import { decodeAccount,PROGRAM,type PoolState } from '../src/protocols/meteora/codec';
import capture from './fixtures/meteora/mainnet.json';
const integration=process.env.SOLANA_RPC_URL?describe:describe.skip;
integration('Meteora read-only RPC',()=>{
  it('validates mainnet, executable program and a live captured pool PDA',async()=>{
    const rpc=new SolanaRpcClient(process.env.SOLANA_RPC_URL!);await new MeteoraAdapter().assertNetwork(rpc);
    const key=address(capture.pool),snapshot=await rpc.getAccounts([PROGRAM,key]);expect(snapshot.accounts[0]?.executable).toBe(true);
    const pool=decodeAccount<PoolState>('LbPair',snapshot.accounts[1]);await validatePoolPda(key,pool);
  });
});
