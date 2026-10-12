import type { Address, Signature } from '@solana/kit';
import { NotSentError, OnChainFailure } from '../core/transaction';
import { VerificationError } from '../core/errors';
import type { PendingTransactionIdentity } from '../core/transaction';
import type { SignatureStatus } from '../core/rpc';
import type { Transaction } from '@solana/kit';
import type { OreAction, OreClaimOptions, OreClaimResult, OreClaimReview } from '../operations/ore';
import type { UnstakeReview } from '../operations/unstake';
import type { StakeRewardsResult, StakeRewardsReview } from '../operations/stake-rewards';
import { kaminoOperationHint, type KaminoRequest, type KaminoReview } from '../operations/kamino';
import type { SafeTransactionResult } from '../core/transaction';
import type { PendingClaim, PendingStore } from './pending-store';
import type { MeteoraExecutionInput, MeteoraOperation, MeteoraReview } from '../operations/meteora';
import type { OrcaExecutionInput, OrcaOperation, OrcaReview } from '../operations/orca';
import type { DammReview } from '../operations/meteora-damm';
import { unsentExpiryHint } from './operation-error';
import type { TokenChange, TransactionReceipt } from '../core/receipt';

export type ClaimState = {
  phase: 'idle' | 'preparing' | 'review' | 'signing' | 'sending' | 'checking' | 'unknown' | 'confirmed' | 'failed'
    | 'cancelled' | 'empty' | 'error' | 'blocked' | 'partial';
  review?: OreClaimReview | UnstakeReview | StakeRewardsReview | KaminoReview | MeteoraReview | OrcaReview | DammReview;
  operation?: WithdrawalOperation;
  pending?: PendingClaim;
  signature?: Signature;
  message?: string;
  /** Measured on the wallet's accounts after the result is known; absent while loading or if the RPC has no record. */
  receipt?: Omit<TransactionReceipt, 'tokens'> & { tokens: (TokenChange & { symbol?: string })[] };
};
type ClaimInput = Pick<OreClaimOptions, 'wallet' | 'signWithWallet' | 'confirm' | 'assertActive' | 'beforeSend'>;
/** Single-transaction actions recovered through the pending signature alone. */
export type SingleAction = OreAction | 'unstake' | 'claim-stake-rewards' | 'kamino-repay' | 'kamino-withdraw' | 'meteora-damm-withdraw-all';
export type DammRequest = { position: Address };
/** A multi-step withdrawal checkpoint. Meteora records predate the protocol field. */
export type WithdrawalOperation = MeteoraOperation | OrcaOperation;
export type WithdrawalProtocol = 'meteora' | 'orca';
export const operationProtocol = (operation: WithdrawalOperation): WithdrawalProtocol =>
  'protocol' in operation && operation.protocol === 'orca' ? 'orca' : 'meteora';
const withdrawalAction = (protocol: WithdrawalProtocol) => protocol === 'orca' ? 'orca-withdraw-all' as const : 'meteora-withdraw-all' as const;
const isWithdrawal = (action: PendingClaim['action'] | undefined) => action === 'meteora-withdraw-all' || action === 'orca-withdraw-all';
export type ClaimDependencies = {
  store: PendingStore;
  execute: (url: string, action: OreAction, input: ClaimInput) => Promise<OreClaimResult>;
  unstake?: (url: string, amount: string, input: ClaimInput & { confirm: (review: UnstakeReview) => Promise<boolean> }) => Promise<SafeTransactionResult>;
  stakeRewards?: (url: string, input: ClaimInput & { confirm: (review: StakeRewardsReview) => Promise<boolean> }) => Promise<StakeRewardsResult>;
  kamino?: (url: string, request: KaminoRequest, input: ClaimInput & { confirm: (review: KaminoReview) => Promise<boolean> }) => Promise<SafeTransactionResult>;
  damm?: (url: string, position: Address, input: ClaimInput & { confirm: (review: DammReview) => Promise<boolean> }) => Promise<SafeTransactionResult>;
  status: (pending: PendingClaim) => Promise<SignatureStatus | null>;
  height: (pending: PendingClaim) => Promise<bigint>;
  meteora?: (url: string, input: MeteoraExecutionInput) => Promise<{status:'confirmed'|'partial';operation:MeteoraOperation}>;
  meteoraClosed?: (operation: MeteoraOperation, minSlot?: bigint) => Promise<boolean>;
  orca?: (url: string, input: OrcaExecutionInput) => Promise<{status:'confirmed'|'partial';operation:OrcaOperation}>;
  orcaClosed?: (operation: OrcaOperation, minSlot?: bigint) => Promise<boolean>;
  receipt?: (url: string, wallet: Address, signatures: readonly Signature[]) => Promise<TransactionReceipt | null>;
};

/** One operation at a time. A persisted signature can only be checked, never resent. */
export class ClaimController {
  private busy = false;
  private ready = false;
  private foreground = true;
  private walletHandoff = false;
  private revision = 0;
  private pending: PendingClaim | null = null;
  private operation: WithdrawalOperation | null = null;
  private decision?: (approved: boolean) => void;
  private state: ClaimState = { phase: 'idle' };
  /** Token symbols from reviews in this session; the receipt itself only carries mints. */
  private readonly symbols = new Map<Address, string>();

  constructor(private readonly deps: ClaimDependencies, private readonly publish: (state: ClaimState) => void) {}
  private update(state: ClaimState) { this.state = state; this.publish(state); }
  /** Publishes `state`, then adds the receipt only if nothing has replaced that state. Failures are ignored. */
  private settle(state: ClaimState, url: string, wallet: Address, signatures: readonly Signature[]) {
    this.update(state);
    if (!this.deps.receipt || !signatures.length) return;
    void this.deps.receipt(url, wallet, signatures).then(receipt => {
      if (!receipt || this.state !== state) return;
      this.update({ ...state, receipt: { ...receipt, tokens: receipt.tokens.map(token => {
        const symbol = this.symbols.get(token.mint);
        return symbol === undefined ? token : { ...token, symbol };
      }) } });
    }, () => {});
  }
  get locked() { return !this.ready || this.busy || !!this.pending || !!this.operation || this.state.phase === 'blocked'; }
  private async loadOperation(): Promise<WithdrawalOperation | null> {
    const meteora = await this.deps.store.loadMeteora?.() ?? null, orca = await this.deps.store.loadOrca?.() ?? null;
    if (meteora && orca) throw new Error('Conflicting operation records');
    return meteora ?? orca;
  }
  private async saveOperation(operation: WithdrawalOperation) {
    if (operationProtocol(operation) === 'orca') await this.deps.store.saveOrca!(operation as OrcaOperation);
    else await this.deps.store.saveMeteora!(operation as MeteoraOperation);
  }
  private async clearOperation(operation: WithdrawalOperation) {
    if (operationProtocol(operation) === 'orca') await this.deps.store.clearOrca!(); else await this.deps.store.clearMeteora!();
  }

  async restore() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.pending = await this.deps.store.load();
      this.operation = await this.loadOperation();
      if (isWithdrawal(this.pending?.action) && (!this.operation || this.pending!.action !== withdrawalAction(operationProtocol(this.operation))
        || this.pending!.operationId !== this.operation.id
        || this.pending!.position !== this.operation.position || this.pending!.wallet !== this.operation.wallet || this.pending!.rpcUrl !== this.operation.rpcUrl
        || (this.operation.currentStep && this.operation.currentStep.id !== this.pending!.step?.id)
        || this.operation.completed.some(c => c.step.id === this.pending!.step?.id && c.signature !== this.pending!.signature))) throw new Error('Withdrawal checkpoint mismatch');
      if (this.pending && !isWithdrawal(this.pending.action) && this.operation) throw new Error('Conflicting operation records');
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

  startMeteora(url: string, wallet: Address, position: Address, signing: Pick<ClaimInput,'signWithWallet'>) {
    return this.startWithdrawal('meteora',url,wallet,position,signing);
  }
  startOrca(url: string, wallet: Address, position: Address, signing: Pick<ClaimInput,'signWithWallet'>) {
    return this.startWithdrawal('orca',url,wallet,position,signing);
  }
  async startWithdrawal(protocol: WithdrawalProtocol, url: string, wallet: Address, position: Address,
    signing: Pick<ClaimInput,'signWithWallet'>) {
    if (!this.ready || this.busy || this.pending || !this.foreground || this.state.phase === 'blocked') return;
    if (this.operation && (operationProtocol(this.operation) !== protocol || this.operation.wallet !== wallet
      || this.operation.position !== position || this.operation.rpcUrl !== url)) {
      this.update({phase:'partial',operation:this.operation,message:'Reconnect the saved wallet and use the saved RPC to resume this withdrawal.'}); return;
    }
    const store = this.deps.store;
    if (protocol === 'orca' ? !this.deps.orca || !store.saveOrca || !store.clearOrca
      : !this.deps.meteora || !store.saveMeteora || !store.clearMeteora) return;
    this.busy = true;
    const revision = ++this.revision;
    const assertActive = () => {
      if ((!this.foreground && !this.walletHandoff) || revision !== this.revision) throw new Error('Operation cancelled');
    };
    this.update({phase:'preparing',operation:this.operation ?? undefined});
    try {
      const id = `${protocol}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const operation: WithdrawalOperation = this.operation ?? (protocol === 'orca'
        ? {version:1,protocol:'orca',id,wallet,position,rpcUrl:url,createdAt:Date.now(),completed:[]}
        : {version:1,id,wallet,position,rpcUrl:url,createdAt:Date.now(),completed:[]});
      await this.saveOperation(operation); this.operation = operation;
      const input = {wallet,
        signWithWallet:async (transaction: Transaction) => {
          this.walletHandoff = true;
          try { const signed = await signing.signWithWallet(transaction);
            if (!this.foreground) throw new Error('Wallet did not return to app'); return signed; }
          finally { this.walletHandoff = false; }
        }, operation, assertActive,
        progress:(record: WithdrawalOperation) => this.update({phase:'preparing',operation:record}),
        confirm:(review: MeteoraReview | OrcaReview) => { assertActive();
          for (const token of [...review.receipts, ...review.remainingReceipts]) this.symbols.set(token.mint, token.symbol);
          return new Promise<boolean>(resolve => {
          this.decision = resolve; this.update({phase:'review',review,operation:this.operation ?? undefined});
        }); },
        beforeSend:async (identity: PendingTransactionIdentity, step: NonNullable<PendingClaim['step']>) => {
          assertActive();
          this.operation = {...this.operation!,currentStep:step} as WithdrawalOperation;
          await this.saveOperation(this.operation);
          const pending: PendingClaim = {...identity,version:1,action:withdrawalAction(protocol),position,operationId:operation.id,
            step,rpcUrl:url,createdAt:Date.now()};
          await this.deps.store.save(pending); this.pending = pending; assertActive();
          this.update({phase:'sending',pending,operation:this.operation});
        },
        confirmed:async (record: WithdrawalOperation) => {
          await this.saveOperation(record); this.operation = record;
          await this.deps.store.clear(); this.pending = null;
          this.update({phase:'preparing',operation:record});
        },
      };
      const result: {status:'confirmed'|'partial';operation:WithdrawalOperation} = protocol === 'orca'
        ? await this.deps.orca!(url,input as unknown as OrcaExecutionInput)
        : await this.deps.meteora!(url,input as unknown as MeteoraExecutionInput);
      if (result.status === 'confirmed') {
        await this.clearOperation(result.operation); this.operation = null;
        this.settle({phase:'confirmed',operation:result.operation,signature:result.operation.completed.at(-1)?.signature,
          message:'The final account state was checked. All liquidity, fees and rewards were withdrawn and the position is closed.'},
          url,wallet,result.operation.completed.map(c => c.signature));
      } else this.update({phase:result.operation.completed.length ? 'partial' : 'cancelled',operation:result.operation,
        message:'Signing cancelled. Confirmed steps are kept; resume to prepare the remaining steps.'});
    } catch (error) {
      try {
        this.pending = await this.deps.store.load() ?? this.pending;
        this.operation = await this.loadOperation() ?? this.operation;
      } catch { this.update({phase:'blocked',message:'Could not read the operation record. New submissions are blocked.'}); return; }
      if (this.pending && (error instanceof NotSentError || error instanceof OnChainFailure)) {
        try {
          await this.deps.store.clear(); this.pending = null;
          if (this.operation) { this.operation = {...this.operation,currentStep:undefined} as WithdrawalOperation; await this.saveOperation(this.operation); }
        } catch { this.update({phase:'blocked',message:'Could not persist the step result. Reload the operation record.'}); return; }
      }
      if (this.pending) this.update({phase:'unknown',pending:this.pending,operation:this.operation ?? undefined,
        message:'The step result is unknown. Check the saved signature before continuing. Resubmission is blocked.'});
      else this.update({phase:this.operation?.completed.length ? 'partial' : error instanceof OnChainFailure ? 'failed' : revision !== this.revision ? 'cancelled' : 'error',operation:this.operation ?? undefined,
        message:error instanceof OnChainFailure ? 'The step failed on-chain; a network fee may have been charged. Confirmed steps are kept.'
          : unsentExpiryHint(error, true) ?? (error instanceof Error ? error.message : 'Could not prepare the remaining withdrawal steps.')});
    } finally { this.busy = false; this.walletHandoff = false; this.decision = undefined; }
  }

  async endWithdrawal() {
    if (this.busy || this.pending || !this.operation) return;
    try { await this.clearOperation(this.operation); this.operation = null;
      this.update({phase:'idle'}); }
    catch { this.update({phase:'blocked',message:'Could not delete the operation checkpoint. Reload the operation record.'}); }
  }
  endMeteora() { return this.endWithdrawal(); }
  /** Hides a finished result. A pending signature, checkpoint or unreadable record holds the lock and stays shown. */
  dismiss() { if (!this.locked) this.update({ phase: 'idle' }); }

  async start(url: string, wallet: Address, action: SingleAction,
    signing: Pick<ClaimInput, 'signWithWallet'>, amount?: string,
    request?: KaminoRequest | DammRequest) {
    const kaminoRequest = action === 'kamino-repay' || action === 'kamino-withdraw' ? request as KaminoRequest | undefined : undefined;
    const dammRequest = action === 'meteora-damm-withdraw-all' ? request as DammRequest | undefined : undefined;
    if (this.locked || !this.foreground) return;
    this.busy = true;
    const revision = ++this.revision;
    const assertActive = () => {
      if ((!this.foreground && !this.walletHandoff) || revision !== this.revision) throw new Error('Operation cancelled');
    };
    this.update({ phase: 'preparing' });
    try {
      const input = { wallet,
        signWithWallet: async (transaction: Transaction) => {
          this.walletHandoff = true;
          try {
            const signed = await signing.signWithWallet(transaction);
            if (!this.foreground) throw new Error('Wallet did not return to app');
            return signed;
          }
          finally { this.walletHandoff = false; }
        },
        assertActive,
        confirm: (review: OreClaimReview | UnstakeReview | StakeRewardsReview | KaminoReview | DammReview) => {
          assertActive();
          if (review.action === 'meteora-damm-withdraw-all') for (const token of review.receipts) this.symbols.set(token.mint, token.symbol);
          return new Promise<boolean>(resolve => {
            this.decision = resolve;
            this.update({ phase: 'review', review });
          });
        },
        beforeSend: async (identity: PendingTransactionIdentity) => {
          assertActive();
          const pending: PendingClaim = { ...identity, version: 1, action, rpcUrl: url, createdAt: Date.now(),
            ...(kaminoRequest ? { position: kaminoRequest.position, token: kaminoRequest.token,
              ...(kaminoRequest.reserve ? { reserve: kaminoRequest.reserve } : {}) } : {}),
            ...(dammRequest ? { position: dammRequest.position } : {}) };
          await this.deps.store.save(pending);
          this.pending = pending;
          assertActive();
          this.update({ phase: 'sending', pending });
        },
      };
      const result = action === 'unstake'
        ? await this.deps.unstake!(url, amount ?? '', input)
        : action === 'claim-stake-rewards'
          ? await this.deps.stakeRewards!(url, input)
        : action === 'kamino-repay' || action === 'kamino-withdraw'
          ? await this.deps.kamino!(url, kaminoRequest!, input)
        : action === 'meteora-damm-withdraw-all'
          ? await this.deps.damm!(url, dammRequest!.position, input)
          : await this.deps.execute(url, action, input);
      if (result.status === 'confirmed') {
        await this.deps.store.clear(); this.pending = null;
        this.settle({ phase: 'confirmed', signature: result.signature }, url, wallet, [result.signature]);
      } else this.update({ phase: result.status === 'cancelled' ? 'cancelled' : 'empty' });
    } catch (error) {
      // A failed write may have completed before reporting failure. Re-read before allowing another operation.
      try { this.pending = await this.deps.store.load() ?? this.pending; }
      catch { this.update({ phase: 'blocked', message: 'Could not read the operation record. New submissions are blocked.' }); return; }
      if (this.pending && error instanceof NotSentError) {
        try {
          await this.deps.store.clear(); this.pending = null;
          this.update({ phase: revision !== this.revision ? 'cancelled' : 'error',
            message: unsentExpiryHint(error) ?? 'Nothing was sent. Prepare the operation again.' });
        } catch { this.update({ phase: 'unknown', pending: this.pending ?? undefined, message: 'Could not delete the record of an unsent operation. New submissions are blocked.' }); }
      } else if (this.pending && error instanceof OnChainFailure) {
        try {
          const signature = this.pending.signature;
          await this.deps.store.clear(); this.pending = null;
          this.settle({ phase: 'failed', signature, message: 'The transaction was confirmed with an error; a network fee may have been charged.' }, url, wallet, [signature]);
        } catch { this.update({ phase: 'unknown', pending: this.pending ?? undefined, message: 'Could not save the result. Check the status.' }); }
      } else if (this.pending) this.update({ phase: 'unknown', pending: this.pending,
        message: 'The result is unknown. Check the saved signature; do not repeat the operation.' });
      else this.update(revision !== this.revision ? { phase: 'cancelled' } : { phase: 'error',
        message: unsentExpiryHint(error) ?? (error instanceof Error && /Signing (account|wallet) changed|External wallet changed/.test(error.message)
          ? 'The external wallet account has changed. Reconnect it, refresh rewards and retry the operation.'
          : action === 'kamino-repay' || action === 'kamino-withdraw'
            ? kaminoOperationHint(error)
          : action === 'meteora-damm-withdraw-all' && error instanceof VerificationError
            ? `${error.message.replace(/^Meteora DAMM v2: /, '')} Nothing was sent.`
            : 'The operation was not sent. Check the RPC, balance and position state, then prepare it again.') });
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
        if (isWithdrawal(pending.action)) {
          if (!this.operation || !pending.step || pending.operationId !== this.operation.id) throw new Error('Missing withdrawal checkpoint');
          if (status.error === null && !this.operation.completed.some(c => c.step.id === pending.step!.id)) {
            this.operation = {...this.operation,currentStep:undefined,completed:[...this.operation.completed,
              {step:pending.step,signature:pending.signature,...(status.slot === undefined ? {} : {slot:status.slot.toString()})}]} as WithdrawalOperation;
          } else this.operation = {...this.operation,currentStep:undefined} as WithdrawalOperation;
          await this.saveOperation(this.operation);
          await this.deps.store.clear(); this.pending = null;
          // A confirmed close signature still needs a fresh account-state check.
          const record = this.operation;
          const closed = status.error === null && pending.step.actions.some(a => a.kind === 'close') && await (operationProtocol(record) === 'orca'
            ? this.deps.orcaClosed?.(record as OrcaOperation,status.slot) : this.deps.meteoraClosed?.(record as MeteoraOperation,status.slot));
          if (closed) {
            const operation = record; await this.clearOperation(operation); this.operation = null;
            this.settle({phase:'confirmed',operation,signature:pending.signature,message:'The final account state was checked. The selected position is closed.'},
              operation.rpcUrl,operation.wallet,operation.completed.map(c => c.signature));
          } else this.update({phase:'partial',operation:this.operation,signature:pending.signature,
            message:status.error === null ? 'The step is confirmed. Resume to re-read the position and prepare the remaining steps.'
              : 'The step failed on-chain; confirmed steps are kept. Resume to re-read the position.'});
          return;
        }
        await this.deps.store.clear(); this.pending = null;
        this.settle({ phase: status.error === null ? 'confirmed' : 'failed', signature: pending.signature,
          ...(status.error === null ? {} : { message: 'The transaction was confirmed with an error; a network fee may have been charged.' }) },
          pending.rpcUrl, pending.wallet, [pending.signature]);
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
