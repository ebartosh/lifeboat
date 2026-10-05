import type { Address, Signature } from '@solana/kit';
import { NotSentError, OnChainFailure } from '../core/transaction';
import type { PendingTransactionIdentity } from '../core/transaction';
import type { SignatureStatus } from '../core/rpc';
import type { Transaction } from '@solana/kit';
import type { OreAction, OreClaimOptions, OreClaimResult, OreClaimReview } from '../operations/ore';
import type { UnstakeReview } from '../operations/unstake';
import { kaminoOperationHint, type KaminoRequest, type KaminoReview } from '../operations/kamino';
import type { SafeTransactionResult } from '../core/transaction';
import type { PendingClaim, PendingStore } from './pending-store';
import type { MeteoraExecutionInput, MeteoraOperation, MeteoraReview } from '../operations/meteora';

export type ClaimState = {
  phase: 'idle' | 'preparing' | 'review' | 'signing' | 'sending' | 'checking' | 'unknown' | 'confirmed' | 'failed'
    | 'cancelled' | 'empty' | 'error' | 'blocked' | 'partial';
  review?: OreClaimReview | UnstakeReview | KaminoReview | MeteoraReview;
  operation?: MeteoraOperation;
  pending?: PendingClaim;
  signature?: Signature;
  message?: string;
};
type ClaimInput = Pick<OreClaimOptions, 'wallet' | 'getSigner' | 'signWithWallet' | 'confirm' | 'assertActive' | 'beforeSend'>;
export type ClaimDependencies = {
  store: PendingStore;
  execute: (url: string, action: OreAction, input: ClaimInput) => Promise<OreClaimResult>;
  unstake?: (url: string, amount: string, input: ClaimInput & { confirm: (review: UnstakeReview) => Promise<boolean> }) => Promise<SafeTransactionResult>;
  kamino?: (url: string, request: KaminoRequest, input: ClaimInput & { confirm: (review: KaminoReview) => Promise<boolean> }) => Promise<SafeTransactionResult>;
  status: (pending: PendingClaim) => Promise<SignatureStatus | null>;
  height: (pending: PendingClaim) => Promise<bigint>;
  meteora?: (url: string, input: MeteoraExecutionInput) => Promise<{status:'confirmed'|'partial';operation:MeteoraOperation}>;
  meteoraClosed?: (operation: MeteoraOperation, minSlot?: bigint) => Promise<boolean>;
};

/** One operation at a time. A persisted signature can only be checked, never resent. */
export class ClaimController {
  private busy = false;
  private ready = false;
  private foreground = true;
  private walletHandoff = false;
  private revision = 0;
  private pending: PendingClaim | null = null;
  private operation: MeteoraOperation | null = null;
  private decision?: (approved: boolean) => void;
  private state: ClaimState = { phase: 'idle' };

  constructor(private readonly deps: ClaimDependencies, private readonly publish: (state: ClaimState) => void) {}
  private update(state: ClaimState) { this.state = state; this.publish(state); }
  get locked() { return !this.ready || this.busy || !!this.pending || !!this.operation || this.state.phase === 'blocked'; }

  async restore() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.pending = await this.deps.store.load();
      this.operation = await this.deps.store.loadMeteora?.() ?? null;
      if (this.pending?.action === 'meteora-withdraw-all' && (!this.operation || this.pending.operationId !== this.operation.id
        || this.pending.position !== this.operation.position || this.pending.wallet !== this.operation.wallet || this.pending.rpcUrl !== this.operation.rpcUrl
        || (this.operation.currentStep && this.operation.currentStep.id !== this.pending.step?.id)
        || this.operation.completed.some(c => c.step.id === this.pending!.step?.id && c.signature !== this.pending!.signature))) throw new Error('Meteora checkpoint mismatch');
      if (this.pending && this.pending.action !== 'meteora-withdraw-all' && this.operation) throw new Error('Conflicting operation records');
      this.ready = true;
      this.update(this.pending ? { phase: 'unknown', pending: this.pending,
        operation:this.operation ?? undefined,message: 'An operation is pending. Check its status; it will not be sent again.' }
        : this.operation ? {phase:'partial',operation:this.operation,message:'A withdrawal was interrupted. Resume to re-read the position and prepare the remaining steps.'} : { phase: 'idle' });
    } catch { this.update({ phase: 'blocked', message: 'Could not read the operation record. New submissions are blocked.' }); }
    finally { this.busy = false; }
  }

  setForeground(active: boolean) {
    this.foreground = active;
    if (!active && !this.walletHandoff) { this.revision++; this.answer(false); }
  }
  invalidate() { this.revision++; this.answer(false); }
  answer(approved: boolean) {
    const resolve = this.decision;
    this.decision = undefined;
    if (resolve) this.update({ phase: approved && this.foreground ? 'signing' : 'cancelled',operation:this.operation ?? undefined });
    resolve?.(approved && this.foreground);
  }

  async startMeteora(url: string, wallet: Address, position: Address,
    signing: Pick<ClaimInput,'getSigner'|'signWithWallet'>) {
    if (!this.ready || this.busy || this.pending || !this.foreground || this.state.phase === 'blocked') return;
    if (this.operation && (this.operation.wallet !== wallet || this.operation.position !== position || this.operation.rpcUrl !== url)) {
      this.update({phase:'partial',operation:this.operation,message:'Reconnect the saved wallet and use the saved RPC to resume this withdrawal.'}); return;
    }
    if (!this.deps.meteora || !this.deps.store.saveMeteora || !this.deps.store.clearMeteora) return;
    this.busy = true;
    const revision = ++this.revision;
    const assertActive = () => {
      if ((!this.foreground && !this.walletHandoff) || revision !== this.revision) throw new Error('Operation cancelled');
    };
    this.update({phase:'preparing',operation:this.operation ?? undefined});
    try {
      const operation: MeteoraOperation = this.operation ?? {version:1,id:`meteora-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        wallet,position,rpcUrl:url,createdAt:Date.now(),completed:[]};
      await this.deps.store.saveMeteora(operation); this.operation = operation;
      const result = await this.deps.meteora(url,{wallet,getSigner:signing.getSigner,
        signWithWallet:signing.signWithWallet ? async transaction => {
          this.walletHandoff = true;
          try { const signed = await signing.signWithWallet!(transaction);
            if (!this.foreground) throw new Error('Wallet did not return to app'); return signed; }
          finally { this.walletHandoff = false; }
        } : undefined, operation, assertActive,
        progress:record => this.update({phase:'preparing',operation:record}),
        confirm:review => { assertActive(); return new Promise<boolean>(resolve => {
          this.decision = resolve; this.update({phase:'review',review,operation:this.operation ?? undefined});
        }); },
        beforeSend:async (identity,step) => {
          assertActive();
          this.operation = {...this.operation!,currentStep:step};
          await this.deps.store.saveMeteora!(this.operation);
          const pending: PendingClaim = {...identity,version:1,action:'meteora-withdraw-all',position,operationId:operation.id,
            step,rpcUrl:url,createdAt:Date.now()};
          await this.deps.store.save(pending); this.pending = pending; assertActive();
          this.update({phase:'sending',pending,operation:this.operation});
        },
        confirmed:async record => {
          await this.deps.store.saveMeteora!(record); this.operation = record;
          await this.deps.store.clear(); this.pending = null;
          this.update({phase:'preparing',operation:record});
        },
      });
      if (result.status === 'confirmed') {
        await this.deps.store.clearMeteora(); this.operation = null;
        this.update({phase:'confirmed',operation:result.operation,signature:result.operation.completed.at(-1)?.signature,
          message:'The final account state was checked. All liquidity, fees and rewards were withdrawn and the position is closed.'});
      } else this.update({phase:result.operation.completed.length ? 'partial' : 'cancelled',operation:result.operation,
        message:'Signing cancelled. Confirmed steps are kept; resume to prepare the remaining steps.'});
    } catch (error) {
      try {
        this.pending = await this.deps.store.load() ?? this.pending;
        this.operation = await this.deps.store.loadMeteora?.() ?? this.operation;
      } catch { this.update({phase:'blocked',message:'Could not read the operation record. New submissions are blocked.'}); return; }
      if (this.pending && (error instanceof NotSentError || error instanceof OnChainFailure)) {
        try {
          await this.deps.store.clear(); this.pending = null;
          if (this.operation) { this.operation = {...this.operation,currentStep:undefined}; await this.deps.store.saveMeteora!(this.operation); }
        } catch { this.update({phase:'blocked',message:'Could not persist the step result. Reload the operation record.'}); return; }
      }
      if (this.pending) this.update({phase:'unknown',pending:this.pending,operation:this.operation ?? undefined,
        message:'The step result is unknown. Check the saved signature before continuing. Resubmission is blocked.'});
      else this.update({phase:this.operation?.completed.length ? 'partial' : error instanceof OnChainFailure ? 'failed' : revision !== this.revision ? 'cancelled' : 'error',operation:this.operation ?? undefined,
        message:error instanceof OnChainFailure ? 'The step failed on-chain; a network fee may have been charged. Confirmed steps are kept.'
          : error instanceof Error ? error.message : 'Could not prepare the remaining withdrawal steps.'});
    } finally { this.busy = false; this.walletHandoff = false; this.decision = undefined; }
  }

  async endMeteora() {
    if (this.busy || this.pending || !this.operation) return;
    try { await this.deps.store.clearMeteora!(); this.operation = null;
      this.update({phase:'idle'}); }
    catch { this.update({phase:'blocked',message:'Could not delete the operation checkpoint. Reload the operation record.'}); }
  }

  async start(url: string, wallet: Address, action: OreAction | 'unstake' | 'kamino-repay' | 'kamino-withdraw',
    signing: Pick<ClaimInput, 'getSigner' | 'signWithWallet'> | NonNullable<ClaimInput['getSigner']>, amount?: string,
    kaminoRequest?: KaminoRequest) {
    if (this.locked || !this.foreground) return;
    this.busy = true;
    const revision = ++this.revision;
    const assertActive = () => {
      if ((!this.foreground && !this.walletHandoff) || revision !== this.revision) throw new Error('Operation cancelled');
    };
    this.update({ phase: 'preparing' });
    try {
      const signingOptions = typeof signing === 'function' ? { getSigner: signing } : signing;
      const input = { wallet, ...signingOptions,
        signWithWallet: signingOptions.signWithWallet ? async (transaction: Transaction) => {
          this.walletHandoff = true;
          try {
            const signed = await signingOptions.signWithWallet!(transaction);
            if (!this.foreground) throw new Error('Wallet did not return to app');
            return signed;
          }
          finally { this.walletHandoff = false; }
        } : undefined,
        assertActive,
        confirm: (review: OreClaimReview | UnstakeReview | KaminoReview) => {
          assertActive();
          return new Promise<boolean>(resolve => {
            this.decision = resolve;
            this.update({ phase: 'review', review });
          });
        },
        beforeSend: async (identity: PendingTransactionIdentity) => {
          assertActive();
          const pending: PendingClaim = { ...identity, version: 1, action, rpcUrl: url, createdAt: Date.now(),
            ...(kaminoRequest ? { position: kaminoRequest.position, token: kaminoRequest.token,
              ...(kaminoRequest.reserve ? { reserve: kaminoRequest.reserve } : {}) } : {}) };
          await this.deps.store.save(pending);
          this.pending = pending;
          assertActive();
          this.update({ phase: 'sending', pending });
        },
      };
      const result = action === 'unstake'
        ? await this.deps.unstake!(url, amount ?? '', input)
        : action === 'kamino-repay' || action === 'kamino-withdraw'
          ? await this.deps.kamino!(url, kaminoRequest!, input)
          : await this.deps.execute(url, action, input);
      if (result.status === 'confirmed') {
        await this.deps.store.clear(); this.pending = null;
        this.update({ phase: 'confirmed', signature: result.signature });
      } else this.update({ phase: result.status === 'cancelled' ? 'cancelled' : 'empty' });
    } catch (error) {
      // A failed write may have completed before reporting failure. Re-read before allowing another operation.
      try { this.pending = await this.deps.store.load() ?? this.pending; }
      catch { this.update({ phase: 'blocked', message: 'Could not read the operation record. New submissions are blocked.' }); return; }
      if (this.pending && error instanceof NotSentError) {
        try {
          await this.deps.store.clear(); this.pending = null;
          this.update({ phase: revision !== this.revision ? 'cancelled' : 'error', message: 'Nothing was sent. Prepare the operation again.' });
        } catch { this.update({ phase: 'unknown', pending: this.pending ?? undefined, message: 'Could not delete the record of an unsent operation. New submissions are blocked.' }); }
      } else if (this.pending && error instanceof OnChainFailure) {
        try {
          const signature = this.pending.signature;
          await this.deps.store.clear(); this.pending = null;
        this.update({ phase: 'failed', signature, message: 'The transaction was confirmed with an error; a network fee may have been charged.' });
        } catch { this.update({ phase: 'unknown', pending: this.pending ?? undefined, message: 'Could not save the result. Check the status.' }); }
      } else if (this.pending) this.update({ phase: 'unknown', pending: this.pending,
        message: 'The result is unknown. Check the saved signature; do not repeat the operation.' });
      else this.update(revision !== this.revision ? { phase: 'cancelled' } : { phase: 'error',
        message: error instanceof Error && /Signing (account|wallet) changed|External wallet changed/.test(error.message)
          ? 'The external wallet account has changed. Reconnect it, refresh rewards and retry the operation.'
          : action === 'kamino-repay' || action === 'kamino-withdraw'
            ? kaminoOperationHint(error)
            : 'The operation was not sent. Check the RPC, balance and position state, then prepare it again.' });
    } finally { this.walletHandoff = false; this.decision = undefined; this.busy = false; }
  }

  async check() {
    if (this.busy || !this.pending || !this.foreground) return;
    this.busy = true;
    const pending = this.pending;
    this.update({ phase: 'checking', pending,operation:this.operation ?? undefined });
    try {
      const status = await this.deps.status(pending);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        if (pending.action === 'meteora-withdraw-all') {
          if (!this.operation || !pending.step || pending.operationId !== this.operation.id) throw new Error('Missing Meteora checkpoint');
          if (status.error === null && !this.operation.completed.some(c => c.step.id === pending.step!.id)) {
            this.operation = {...this.operation,currentStep:undefined,completed:[...this.operation.completed,
              {step:pending.step,signature:pending.signature,...(status.slot === undefined ? {} : {slot:status.slot.toString()})}]};
          } else this.operation = {...this.operation,currentStep:undefined};
          await this.deps.store.saveMeteora!(this.operation);
          await this.deps.store.clear(); this.pending = null;
          // A confirmed close signature still needs a fresh account-state check.
          if (status.error === null && pending.step.kind === 'close' && await this.deps.meteoraClosed?.(this.operation,status.slot)) {
            const operation = this.operation; await this.deps.store.clearMeteora!(); this.operation = null;
            this.update({phase:'confirmed',operation,signature:pending.signature,message:'The final account state was checked. The selected position is closed.'});
          } else this.update({phase:'partial',operation:this.operation,signature:pending.signature,
            message:status.error === null ? 'The step is confirmed. Resume to re-read the position and prepare the remaining steps.'
              : 'The step failed on-chain; confirmed steps are kept. Resume to re-read the position.'});
          return;
        }
        await this.deps.store.clear(); this.pending = null;
        this.update({ phase: status.error === null ? 'confirmed' : 'failed', signature: pending.signature,
          ...(status.error === null ? {} : { message: 'The transaction was confirmed with an error; a network fee may have been charged.' }) });
      } else {
        const expired = await this.deps.height(pending) > pending.lastValidBlockHeight;
        this.update({ phase: 'unknown', pending,operation:this.operation ?? undefined,message: expired
          ? 'The blockhash has expired, but the RPC has not confirmed the result. This does not prove that no payout occurred. Resubmission is blocked.'
          : 'No confirmation yet. Check the status later; the operation will not be sent again.' });
      }
    } catch { this.update(this.pending ? { phase:'unknown',pending:this.pending,operation:this.operation ?? undefined,
      message:'Could not check the result. Check the status again.' } : this.operation ? {phase:'partial',operation:this.operation,
        message:'The step is confirmed, but the final state could not be checked. Resume to re-read the position.'}
      : {phase:'blocked',message:'Could not persist the result. Reload the operation record.'}); }
    finally { this.busy = false; }
  }
}
