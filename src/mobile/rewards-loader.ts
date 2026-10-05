import type { Address } from '@solana/kit';
import { VerificationError } from '../core/errors';
import type { RewardsSnapshot } from '../operations/rewards';

export type RewardsState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; snapshot: RewardsSnapshot }
  | { status: 'error'; message: string };

/** Invalidates pending responses on wallet/RPC changes and on timeout. */
export class RewardsLoader {
  private revision = 0;
  constructor(private readonly publish: (state: RewardsState) => void,
    private readonly read: (url: string, wallet: Address) => Promise<RewardsSnapshot>,
    private readonly timeoutMs = 20_000) {}

  reset() { this.revision++; this.publish({ status: 'idle' }); }
  dispose() { this.revision++; }

  async refresh(url: string, wallet: Address) {
    const revision = ++this.revision;
    this.publish({ status: 'loading' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = await Promise.race([
        this.read(url, wallet),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); }),
      ]);
      if (revision === this.revision) this.publish({ status: 'ready', snapshot });
    } catch (error) {
      if (revision === this.revision) this.publish({ status: 'error', message: error instanceof VerificationError
        ? 'ORE data is unsupported or failed validation. Check the RPC network.'
        : 'Could not read rewards. Check the RPC and connection, then try again.' });
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
