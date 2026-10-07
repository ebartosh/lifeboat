import type { Address } from '@solana/kit';
import { SolanaRpcClient } from '../core/rpc';
import { createOreAdapter } from '../protocols/ore-bundle';
import { claimOre, claimSol, readOreRewards, type OreClaimOptions } from './ore';
import { readRewardsSnapshot } from './rewards';

type ClaimInput = Pick<OreClaimOptions, 'wallet' | 'signWithWallet' | 'confirm' | 'onSimulated' | 'assertActive' | 'beforeSend'>;

/** One explicitly configured RPC endpoint; constructing a client performs no network calls. */
export function createOreClient(rpcUrl: string) {
  const rpc = new SolanaRpcClient(rpcUrl);
  const adapter = createOreAdapter();
  return {
    readRewards: (wallet: Address) => readOreRewards({ adapter, rpc, wallet }),
    readSnapshot: (wallet: Address) => readRewardsSnapshot({ adapter, rpc, wallet }),
    claimSol: (input: ClaimInput) => claimSol({ ...input, adapter, rpc }),
    claimOre: (input: ClaimInput) => claimOre({ ...input, adapter, rpc }),
  };
}
