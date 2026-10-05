import { useEffect, useState } from 'react';
import { formatLamports, formatOre, formatUnits } from '../core/format';
import type { ClaimController, ClaimState } from './claim-controller';
import { ActionButton } from './ActionButton';
import { AddressField, Body, Dialog, Notice, Panel } from './Interface';
import type { MeteoraOperation } from '../operations/meteora';

const titles: Record<ClaimState['phase'], string> = {
  idle: 'Operations', preparing: 'Preparing and simulating…', review: 'Confirm operation',
  signing: 'Signing operation…', sending: 'Sending and awaiting confirmation…',
  checking: 'Checking status…', unknown: 'Result unknown', confirmed: 'Confirmed',
  failed: 'Transaction error', cancelled: 'Operation cancelled',
  empty: 'No rewards available', error: 'Error: operation not sent', blocked: 'Error: submission blocked',
  partial: 'Withdrawal incomplete',
};
function actionName(action: string) {
  return action === 'meteora-withdraw-all' ? 'Meteora · Withdraw all' : action === 'unstake' ? 'Withdraw ORE' : action === 'claim-sol' ? 'Claim SOL'
    : action === 'claim-ore' ? 'Claim ORE' : action === 'repay' || action === 'kamino-repay'
      ? 'Kamino repayment' : 'Kamino withdrawal';
}
export function ClaimPanel({ state, controller, resumeMeteora }: { state: ClaimState; controller: ClaimController;
  resumeMeteora?: (operation:MeteoraOperation) => void }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [state.phase]);
  const review = state.review;
  const running = ['signing', 'sending', 'checking'].includes(state.phase);
  const close = state.phase === 'review' ? () => controller.answer(false)
    : state.phase === 'preparing' ? () => controller.invalidate()
      : running ? undefined : () => setDismissed(true);
  const signature = state.pending?.signature ?? state.signature;
  return <>
    {state.phase !== 'idle' && <Panel title="Operation / Status">
      <Notice>{titles[state.phase]}</Notice>
      {dismissed && <ActionButton title="Operation details" onPress={() => setDismissed(false)} />}
    </Panel>}
    <Dialog visible={state.phase !== 'idle' && !dismissed} title={titles[state.phase]} onClose={close}
      closeLabel={state.phase === 'review' ? 'Cancel' : state.phase === 'preparing' ? 'Cancel preparation' : 'Close'}>
      {state.phase === 'review' && review ? <>
        <Body>{actionName(review.action)}</Body>
        {review.action === 'meteora-withdraw-all' ? <>
          <Body>Operation: {review.operationId}</Body>
          <AddressField label="Position" value={review.position} />
          <AddressField label="Recipient" value={review.recipient} />
          <Body>Confirmed steps: {review.completedSteps} · Remaining steps (estimate): {review.remainingSteps}</Body>
          <Body>Next step: {review.step.kind === 'remove' ? 'Remove 100% liquidity' : review.step.kind === 'fees' ? 'Claim fees'
            : review.step.kind === 'reward' ? `Claim reward ${review.step.rewardIndex!+1}` : 'Close empty position'}
            {review.step.kind !== 'close' ? ` · Bins ${review.step.lower} to ${review.step.upper}` : ''}</Body>
          {review.remainingReceipts.map(token => <Body key={token.mint} selectable>
            Remaining receipts (estimate): ≈{formatUnits(token.amount,token.decimals)} {token.symbol}
          </Body>)}
          {review.receipts.map(token => <Body key={token.mint} selectable>
            This step (simulation estimate): ≈{formatUnits(token.amount,token.decimals)} {token.symbol}
          </Body>)}
          {review.remainingReceipts.map(token => <AddressField key={token.mint} label={`${token.symbol} mint`} value={token.mint} />)}
          <Body>Network fee, this step: {review.feeLamports === null ? 'estimate unavailable' : `${formatLamports(review.feeLamports)} SOL`}</Body>
          <Body>Remaining network fees (estimate): {review.feeLamports === null ? 'unavailable' : `≈${formatLamports(review.feeLamports*BigInt(review.remainingSteps))} SOL`}</Body>
          <Body>ATA rent, this step: {formatLamports(review.ataRent)} SOL</Body>
          <Body>Remaining ATA rent (estimate): ≈{formatLamports(review.remainingAtaRent)} SOL</Body>
          <Body>Position rent refund on close (estimate): ≈{formatLamports(review.rentRefund)} SOL</Body>
          <Notice>Pool tokens are received unchanged. WSOL stays wrapped.</Notice>
          <Body>Each step requires a separate signature after a fresh state read and simulation. Cancelling keeps confirmed steps.</Body>
          <Notice>Simulation succeeded</Notice>
        </> : <>
        <Body selectable>Amount (estimate): ≈{formatUnits(review.amount, 'decimals' in review ? review.decimals : 11)} {'token' in review ? review.token : review.action === 'claim-sol' ? 'SOL' : 'ORE'}</Body>
        <AddressField label="Wallet" value={review.wallet} />
        <AddressField label={review.action === 'repay' ? 'Source' : 'Recipient'} value={review.recipient} />
        {'position' in review && <><AddressField label="Position" value={review.position} /><AddressField label="Reserve" value={review.reserve} /></>}
        {review.action === 'claim-ore' && review.ore && <Body>Protocol fee: {formatOre(review.ore.fee)} ORE (already deducted)</Body>}
        <Body>Network fee: {review.feeLamports === null ? 'estimate unavailable' : `${formatLamports(review.feeLamports)} SOL`}</Body>
        <Notice>Simulation succeeded</Notice>
        {'nativeSol' in review && review.nativeSol && <><Body>SOL to wrap: {formatLamports(review.nativeSol.wrap)} SOL</Body>
          <Body>Temporary account rent: {formatLamports(review.nativeSol.rent)} SOL</Body>
          <Body>Simulated refund: {review.nativeSol.refund == null ? 'estimate unavailable' : `${formatLamports(review.nativeSol.refund)} SOL`}</Body></>}
        {'createsAta' in review && review.createsAta && <Body>The recipient token account will be created with additional rent in SOL.</Body>}
        {review.action === 'unstake' && <Body>{review.recipientExists
          ? 'No additional token account creation costs are expected.'
          : 'The recipient token account is missing. The program will create it using SOL; rent is charged in addition to the network fee.'}</Body>}
        {review.action === 'claim-ore' && <Body>If the token account is missing, its creation will require additional SOL.</Body>}
        </>}
        <Body>The same message that passed simulation will be signed.</Body>
        <ActionButton title="Sign and send" variant="primary" onPress={() => controller.answer(true)} />
      </> : <>
        <Notice>{titles[state.phase]}</Notice>
        {!!state.message && <Body accessibilityLiveRegion="polite">{state.message}</Body>}
        {state.operation && <>
          <Body>Operation: {state.operation.id}</Body>
          <Body accessibilityLiveRegion="polite">Confirmed steps: {state.operation.completed.length}</Body>
          <AddressField label="Position" value={state.operation.position} />
          <AddressField label="Recipient" value={state.operation.wallet} />
          {state.operation.currentStep && <Body>Current step: {state.operation.currentStep.kind}</Body>}
          {['partial','cancelled','error','failed'].includes(state.phase) && <>
            {resumeMeteora && <ActionButton title="Resume withdrawal" variant="primary" onPress={() => resumeMeteora(state.operation!)} />}
            <ActionButton title="End withdrawal" onPress={() => void controller.endMeteora()} />
            <Body>Ending stops future steps. Tokens already withdrawn remain in the wallet; remaining assets stay in the position.</Body>
          </>}
        </>}
        {running && <Body>Wait for the result. Resubmission is blocked.</Body>}
        {signature && <AddressField label="Signature" value={signature} />}
        {state.pending && <>
          <Body>{actionName(state.pending.action)}</Body>
          <AddressField label="Wallet" value={state.pending.wallet} />
          {state.pending.position && <AddressField label="Position" value={state.pending.position} />}
          {state.pending.reserve && <AddressField label="Reserve" value={state.pending.reserve} />}
          <Body>Status is checked through the saved RPC. Closing this dialog does not cancel the transaction.</Body>
        </>}
        {state.phase === 'unknown' && <ActionButton title="Check status" onPress={() => void controller.check()} variant="primary" />}
        {state.phase === 'blocked' && <ActionButton title="Reload operation record" onPress={() => void controller.restore()} />}
      </>}
    </Dialog>
  </>;
}
