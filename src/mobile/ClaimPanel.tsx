import { useEffect, useState } from 'react';
import { formatLamports, formatOre, formatUnits, groupDigits } from '../core/format';
import type { ClaimController, ClaimState } from './claim-controller';
import { ActionButton } from './ActionButton';
import { AddressField, Body, Dialog, Field, Note, Notice, Panel, Section } from './Interface';
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
const sol = (lamports: bigint) => `${formatLamports(lamports)} SOL`;
const units = (amount: bigint, decimals: number) => groupDigits(formatUnits(amount, decimals));
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
  const meteora = review?.action === 'meteora-withdraw-all' ? review : null;
  const subtitle = state.phase === 'review' && review ? (meteora
    ? `${actionName(meteora.action)} · step ${meteora.completedSteps + 1} of ≈${meteora.completedSteps + meteora.remainingSteps}`
    : actionName(review.action)) : undefined;
  const resumable = !!state.operation && ['partial','cancelled','error','failed'].includes(state.phase);
  const actions = state.phase === 'review' && review
    ? <ActionButton title={review.walletChanges ? 'Send transaction' : 'Sign and send'} variant="primary" onPress={() => controller.answer(true)} />
    : state.phase === 'unknown' ? <ActionButton title="Check status" onPress={() => void controller.check()} variant="primary" />
      : resumable && resumeMeteora ? <ActionButton title="Resume withdrawal" variant="primary" onPress={() => resumeMeteora(state.operation!)} />
        : undefined;
  return <>
    {state.phase !== 'idle' && <Panel title="Operation · Status">
      <Notice>{titles[state.phase]}</Notice>
      {dismissed && <ActionButton title="Operation details" onPress={() => setDismissed(false)} />}
    </Panel>}
    <Dialog visible={state.phase !== 'idle' && !dismissed} title={titles[state.phase]} subtitle={subtitle} onClose={close}
      closeLabel={state.phase === 'review' ? 'Cancel' : state.phase === 'preparing' ? 'Cancel preparation' : 'Close'} actions={actions}>
      {state.phase === 'review' && review ? <>
        <Notice success>Simulation succeeded</Notice>
        {review.action === 'meteora-withdraw-all' ? <>
          <Section title={`This step · ${review.step.kind === 'remove' ? 'Remove 100% liquidity' : review.step.kind === 'fees' ? 'Claim fees'
            : review.step.kind === 'reward' ? `Claim reward ${review.step.rewardIndex!+1}` : 'Close empty position'}`} divider={false}>
            {!!review.receipts.length && <Field label="You receive" values={review.receipts.map(token =>
              `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`)} />}
            <Field label="Network fee" values={[review.feeLamports === null ? 'estimate unavailable' : sol(review.feeLamports)]} />
            <Field label="ATA rent" values={[sol(review.ataRent)]} />
            {review.step.kind !== 'close' && <Field label="Bins" values={[`${review.step.lower} to ${review.step.upper}`]} />}
            {!!review.receipts.length && <Note>Receipts after transfer fees · simulation estimate</Note>}
            {review.receipts.filter(token => token.transferFee > 0n).map(token => <Note key={token.mint} selectable>
              Gross transfer: {units(token.grossAmount,token.decimals)} {token.symbol} · Withheld transfer fee: {units(token.transferFee,token.decimals)} {token.symbol}
            </Note>)}
          </Section>
          <Section title={`Remaining, including this step · ${review.completedSteps} confirmed`}>
            <Field label="Receipts" values={review.remainingReceipts.map(token => `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`)} />
            <Field label="Network fees" values={[review.feeLamports === null ? 'unavailable'
              : `≈${formatLamports(review.feeLamports*BigInt(review.remainingSteps))} SOL`]} />
            <Field label="ATA rent" values={[`≈${sol(review.remainingAtaRent)}`]} />
            <Field label="Rent refund" values={[`≈${sol(review.rentRefund)}`]} />
            <Note>Receipts after transfer fees. The rent refund is paid when the empty position closes.</Note>
            {review.remainingReceipts.some(token => token.token.transferFee) &&
              <Note>Future transfer fees use the simulated epoch and may change before later steps. Withheld fees are unavailable to spend.</Note>}
          </Section>
          <Notice>Pool tokens are received unchanged. WSOL stays wrapped.</Notice>
          <Section title="Accounts">
            <Field label="Operation" values={[review.operationId]} />
            <AddressField label="Position" value={review.position} />
            <AddressField label="Recipient" value={review.recipient} />
            {review.remainingReceipts.map(token => <AddressField key={token.mint} label={`${token.symbol} mint`} value={token.mint} />)}
          </Section>
          <Note>Each step requires a separate signature after a fresh state read and simulation. Cancelling keeps confirmed steps.</Note>
        </> : <>
          <Section title="Amount" divider={false}>
            <Field label="Estimate" values={[`≈${formatUnits(review.amount, 'decimals' in review ? review.decimals : 11)} ${'token' in review ? review.token : review.action === 'claim-sol' ? 'SOL' : 'ORE'}`]} />
          </Section>
          <Section title="Costs">
            <Field label="Network fee" values={[review.feeLamports === null ? 'estimate unavailable' : sol(review.feeLamports)]} />
            {review.action === 'claim-ore' && review.ore && <Field label="Protocol fee" values={[`${formatOre(review.ore.fee)} ORE`]} />}
            {'nativeSol' in review && review.nativeSol && <>
              <Field label="SOL to wrap" values={[sol(review.nativeSol.wrap)]} />
              <Field label="Temporary account rent" values={[sol(review.nativeSol.rent)]} />
              <Field label="Simulated refund" values={[review.nativeSol.refund == null ? 'estimate unavailable' : sol(review.nativeSol.refund)]} />
            </>}
            {review.action === 'claim-ore' && review.ore && <Note>The protocol fee is already deducted.</Note>}
            {'createsAta' in review && review.createsAta && <Note>The recipient token account will be created with additional rent in SOL.</Note>}
            {review.action === 'unstake' && <Note>{review.recipientExists
              ? 'No additional token account creation costs are expected.'
              : 'The recipient token account is missing. The program will create it using SOL; rent is charged in addition to the network fee.'}</Note>}
            {review.action === 'claim-ore' && <Note>If the token account is missing, its creation will require additional SOL.</Note>}
          </Section>
          <Section title="Accounts">
            <AddressField label="Wallet" value={review.wallet} />
            <AddressField label={review.action === 'repay' ? 'Source' : 'Recipient'} value={review.recipient} />
            {'position' in review && <><AddressField label="Position" value={review.position} /><AddressField label="Reserve" value={review.reserve} /></>}
          </Section>
        </>}
        {review.walletChanges ? <>
          <Notice>The wallet updated the transaction. Its signed version passed validation and simulation.</Notice>
          <Body>Priority fee included above: {formatLamports(review.walletChanges.priorityFeeLamports)} SOL</Body>
          <Note>Confirm the updated network fee to send. No additional wallet signature is needed.</Note>
        </> : <Note>The operation will be signed in your wallet. Any permitted wallet changes require another review before sending.</Note>}
      </> : <>
        <Notice>{titles[state.phase]}</Notice>
        {!!state.message && <Body accessibilityLiveRegion="polite">{state.message}</Body>}
        {state.operation && <>
          <Field label="Operation" values={[state.operation.id]} />
          <Body accessibilityLiveRegion="polite">Confirmed steps: {state.operation.completed.length}</Body>
          {state.operation.currentStep && <Field label="Current step" values={[state.operation.currentStep.kind]} />}
          <AddressField label="Position" value={state.operation.position} />
          <AddressField label="Recipient" value={state.operation.wallet} />
          {resumable && <>
            <ActionButton title="End withdrawal" onPress={() => void controller.endMeteora()} />
            <Note>Ending stops future steps. Tokens already withdrawn remain in the wallet; remaining assets stay in the position.</Note>
          </>}
        </>}
        {running && <Body>Wait for the result. Resubmission is blocked.</Body>}
        {signature && <AddressField label="Signature" value={signature} />}
        {state.pending && <>
          <Body>{actionName(state.pending.action)}</Body>
          <AddressField label="Wallet" value={state.pending.wallet} />
          {state.pending.position && <AddressField label="Position" value={state.pending.position} />}
          {state.pending.reserve && <AddressField label="Reserve" value={state.pending.reserve} />}
          <Note>Status is checked through the saved RPC. Closing this dialog does not cancel the transaction.</Note>
        </>}
        {state.phase === 'blocked' && <ActionButton title="Reload operation record" onPress={() => void controller.restore()} />}
      </>}
    </Dialog>
  </>;
}
