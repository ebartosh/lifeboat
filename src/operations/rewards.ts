import {
  appendTransactionMessageInstructions, compileTransaction, createTransactionMessage,
  pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import type { TransactionRpc } from '../core/rpc';
import { readOreRewards, type OreAction, type OreReadOptions, type OreRewards } from './ore';

export type RewardsSnapshot = OreRewards & {
  fees: Partial<Record<OreAction, bigint | null>>;
  readAt: number;
};

/** Read-only estimates. Does not load a key, simulate, sign or send. */
export async function readRewardsSnapshot(options: OreReadOptions & {
  rpc: OreReadOptions['rpc'] & Pick<TransactionRpc, 'getLatestBlockhash' | 'getTransactionFee'>;
}): Promise<RewardsSnapshot> {
  const rewards = await readOreRewards(options);
  const fees: RewardsSnapshot['fees'] = {};
  if (rewards.availableActions.length > 0) {
    try {
      const lifetime = await options.rpc.getLatestBlockhash();
      await Promise.all(rewards.availableActions.map(async action => {
        try {
          const instruction = action === 'claim-sol'
            ? await options.adapter.buildClaimSolInstruction(options.wallet)
            : await options.adapter.buildClaimOreInstruction(options.wallet);
          const message = pipe(createTransactionMessage({ version: 'legacy' }),
            message => setTransactionMessageFeePayer(options.wallet, message),
            message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
            message => appendTransactionMessageInstructions([instruction], message));
          fees[action] = await options.rpc.getTransactionFee?.(compileTransaction(message)) ?? null;
        } catch { fees[action] = null; }
      }));
    } catch { for (const action of rewards.availableActions) fees[action] = null; }
  }
  return { ...rewards, fees, readAt: Date.now() };
}
