import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { abbreviateAddress, formatLamports, formatOre, formatUnits, groupDigits } from '../core/format';
import { operationProtocol, type ClaimController, type ClaimState, type WithdrawalOperation } from './claim-controller';
import { ActionButton } from './ActionButton';
import { AddressField, Body, Dialog, Field, Note, Notice, Panel, Section } from './Interface';
import type { WithdrawalStep } from '../protocols/meteora/withdraw';
import type { WithdrawalStep as OrcaStep } from '../protocols/orca/withdraw';
import type { DammReview } from '../operations/meteora-damm';
import kamino from '../protocols/kamino/metadata.json' with { type: 'json' };
import { ORE_MINT } from '../protocols/ore-stake';
import { medium, ui } from './theme';
import { riskFields } from './kamino-presentation';

const titles: Record<ClaimState['phase'], string> = {
  idle: 'Operations', preparing: 'Preparing and simulating…', review: 'Confirm operation',
  signing: 'Signing operation…', sending: 'Sending and awaiting confirmation…',
  checking: 'Checking status…', unknown: 'Result unknown', confirmed: 'Confirmed',
  failed: 'Transaction error', cancelled: 'Operation cancelled',
  empty: 'No rewards available', error: 'Error: operation not sent', blocked: 'Error: submission blocked',
  partial: 'Withdrawal incomplete',
};
function actionName(action: string) {
  return action === 'meteora-withdraw-all' ? 'Meteora · Withdraw all' : action === 'orca-withdraw-all' ? 'Orca · Withdraw all'
    : action === 'meteora-damm-withdraw-all' ? 'Meteora DAMM v2 · Withdraw all'
    : action === 'unstake' ? 'Withdraw ORE'
    : action === 'claim-stake-rewards' ? 'Claim staking rewards' : action === 'claim-sol' ? 'Claim SOL'
    : action === 'claim-ore' ? 'Claim ORE' : action === 'repay' || action === 'kamino-repay'
      ? 'Kamino repayment' : 'Kamino withdrawal';
}
function stepActions(step: WithdrawalStep | OrcaStep) {
  return step.actions.map(a => 'lower' in a ? a.kind === 'close' ? 'Close empty position' : `${a.kind === 'remove' ? 'Remove 100% liquidity'
    : a.kind === 'fees' ? 'Claim fees' : `Claim reward ${a.rewardIndex!+1}`} · bins ${a.lower} to ${a.upper}`
    : a.kind === 'close' ? 'Close empty position and burn its NFT' : a.kind === 'remove' ? 'Remove 100% liquidity'
      : a.kind === 'fees' ? 'Collect fees' : `Collect reward ${a.rewardIndex!+1}`);
}
function dammActions(review: DammReview) {
  return review.actions.map(a => a.kind === 'refresh' ? 'Release matured vesting' : a.kind === 'fees' ? 'Claim fees'
    : a.kind === 'remove' ? 'Remove all unlocked liquidity' : a.kind === 'close' ? 'Close position and burn its NFT'
      : a.skipReward ? `Forfeit reward ${a.rewardIndex!+1} (frozen vault)` : `Claim reward ${a.rewardIndex!+1}`);
}
const withdrawalName = (operation: WithdrawalOperation) => actionName(`${operationProtocol(operation)}-withdraw-all`);
const sol = (lamports: bigint) => `${formatLamports(lamports)} SOL`;
const units = (amount: bigint, decimals: number) => groupDigits(formatUnits(amount, decimals));
const signed = (amount: bigint, decimals: number) => `${amount > 0n ? '+' : ''}${units(amount, decimals)}`;
const knownSymbols = new Map<string, string>([[ORE_MINT, 'ORE'], ...kamino.tokens.map(t => [t.mint, t.symbol] as const)]);
function Receipt({ receipt }: { receipt: NonNullable<ClaimState['receipt']> }) {
  const plural = receipt.transactions > 1;
  return <Section title={plural ? `On-chain result · ${receipt.transactions} transactions` : 'On-chain result'}>
    {!!receipt.tokens.length && <Field label="Token balance changes" values={receipt.tokens.map(token =>
      `${signed(token.amount, token.decimals)} ${token.symbol ?? knownSymbols.get(token.mint) ?? abbreviateAddress(token.mint)}`)} />}
    <Field label="SOL balance change" values={[`${signed(receipt.solChange, 9)} SOL`]} />
    <Field label={plural ? 'Network fees' : 'Network fee'} values={[sol(receipt.feeLamports)]} />
    <Note>Read from the confirmed {plural ? 'transactions' : 'transaction'} through the saved RPC. The SOL change includes network fees and account rent.</Note>
  </Section>;
}
export function ClaimPanel({ state, controller, resumeWithdrawal }: { state: ClaimState; controller: ClaimController;
  resumeWithdrawal?: (operation:WithdrawalOperation) => void }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [state.phase]);
  const review = state.review;
  const running = ['signing', 'sending', 'checking'].includes(state.phase);
  const close = state.phase === 'review' ? () => controller.answer(false)
    : state.phase === 'preparing' ? () => controller.invalidate()
      : running ? undefined : () => setDismissed(true);
  const signature = state.pending?.signature ?? state.signature;
  const withdrawal = review?.action === 'meteora-withdraw-all' || review?.action === 'orca-withdraw-all' ? review : null;
  // A withdrawal that is one transaction ending in the close has no step count to show.
  const singleStep = !!withdrawal && withdrawal.completedSteps === 0 && withdrawal.remainingSteps === 1
    && withdrawal.step.actions.some(a => a.kind === 'close');
  const subtitle = state.phase === 'review' && review ? (withdrawal && !singleStep
    ? `${actionName(withdrawal.action)} · step ${withdrawal.completedSteps + 1} of ≈${withdrawal.completedSteps + withdrawal.remainingSteps}`
    : actionName(review.action)) : undefined;
  const resumable = !!state.operation && ['partial','cancelled','error','failed'].includes(state.phase);
  const actions = state.phase === 'review' && review
    ? <ActionButton title={review.walletChanges ? 'Send transaction' : 'Sign and send'} variant="primary" onPress={() => controller.answer(true)} />
    : state.phase === 'unknown' ? <ActionButton title="Check status" onPress={() => void controller.check()} variant="primary" />
      : resumable && resumeWithdrawal ? <ActionButton title="Resume withdrawal" variant="primary" onPress={() => resumeWithdrawal(state.operation!)} />
        : undefined;
  const confirmedSteps = state.operation?.completed.length ?? 0;
  const subject = state.operation ? `${withdrawalName(state.operation)} · ${confirmedSteps} ${confirmedSteps === 1 ? 'step' : 'steps'} confirmed`
    : state.pending ? [actionName(state.pending.action), state.pending.token].filter(Boolean).join(' · ')
      : subtitle ?? (review ? actionName(review.action) : '');
  return <>
    {/* Rendered above the positions: while it holds the lock, every tab's actions are disabled. */}
    {state.phase !== 'idle' && <Panel title="Operation · Status">
      <Notice current><Text style={styles.strong}>{titles[state.phase]}</Text>{subject ? `\n${subject}` : ''}</Notice>
      {controller.locked && <Body>Other actions are blocked until this operation is finished.</Body>}
      {/* The open dialog holds these commands; the panel shows them only after it is closed. */}
      {dismissed && <View style={ui.commands}>
        <ActionButton title="Info" onPress={() => setDismissed(false)} />
        {!controller.locked && <ActionButton title="Close" onPress={() => controller.dismiss()} />}
        {!!actions && <View style={[ui.actions, styles.shrink]}>{actions}</View>}
      </View>}
    </Panel>}
    <Dialog visible={state.phase !== 'idle' && !dismissed} title={titles[state.phase]} subtitle={subtitle} onClose={close}
      closeLabel={state.phase === 'review' ? 'Cancel' : state.phase === 'preparing' ? 'Cancel preparation' : 'Close'} actions={actions}>
      {state.phase === 'review' && review ? <>
        <Notice success>Simulation succeeded</Notice>
        {review.action === 'meteora-withdraw-all' || review.action === 'orca-withdraw-all' ? <>
          <Section title="This step" divider={false}>
            <Field label="Actions" values={stepActions(review.step)} />
            {!!review.receipts.length && <Field label="You receive" values={review.receipts.map(token =>
              `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`)} />}
            <Field label="Network fee" values={[review.feeLamports === null ? 'estimate unavailable' : sol(review.feeLamports)]} />
            <Field label="ATA rent" values={[sol(review.ataRent)]} />
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
          {review.action === 'orca-withdraw-all' && !review.estimatesComplete &&
            <Note>Fees and rewards accrued since the position's last update are not estimated: a tick array uses a format the pinned interface does not describe. This step's receipts are measured by simulation.</Note>}
          {review.action === 'orca-withdraw-all' && review.closeHold === 'after-removal' &&
            <Note>The position closes in a later step, after the removal is confirmed and the owed rewards can be read exactly.</Note>}
          {review.action === 'orca-withdraw-all' && review.closeHold === 'reward-vault' &&
            <Notice>A reward vault holds less than this position is owed. The position stays open, without liquidity, until the vault is refilled.</Notice>}
          <Notice>Pool tokens are received unchanged. WSOL stays wrapped.</Notice>
          <Section title="Accounts">
            <Field label="Operation" values={[review.operationId]} />
            <AddressField label="Position" value={review.position} />
            <AddressField label="Recipient" value={review.recipient} />
            {review.remainingReceipts.map(token => <AddressField key={token.mint} label={`${token.symbol} mint`} value={token.mint} />)}
          </Section>
          <Note>Each step requires a separate signature after a fresh state read and simulation. Cancelling keeps confirmed steps.</Note>
        </> : review.action === 'meteora-damm-withdraw-all' ? <>
          <Section title="This transaction" divider={false}>
            <Field label="Actions" values={dammActions(review)} />
            {!!review.receipts.length && <Field label="You receive" values={review.receipts.map(token =>
              `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`)} />}
            <Field label="Network fee" values={[review.feeLamports === null ? 'estimate unavailable' : sol(review.feeLamports)]} />
            <Field label="ATA rent" values={[sol(review.ataRent)]} />
            <Field label="Rent refund" values={[sol(review.rentRefund)]} />
            {!!review.receipts.length && <Note>Receipts after transfer fees · simulation estimate</Note>}
            {review.receipts.filter(token => token.transferFee > 0n).map(token => <Note key={token.mint} selectable>
              Gross transfer: {units(token.grossAmount,token.decimals)} {token.symbol} · Withheld transfer fee: {units(token.transferFee,token.decimals)} {token.symbol}
            </Note>)}
          </Section>
          {!!review.forfeited.length && <Notice>{review.forfeited.map(t => t.symbol).join(', ')} reward vault is frozen. Its pending reward is forfeited so the rest of the withdrawal can proceed.</Notice>}
          {!review.closes && <Notice>The position stays open.{review.holdText ? ` ${review.holdText}` : ''}</Notice>}
          <Notice>Pool tokens are received unchanged. WSOL stays wrapped.</Notice>
          <Section title="Accounts">
            <AddressField label="Position" value={review.position} />
            <AddressField label="Recipient" value={review.recipient} />
            {review.receipts.map(token => <AddressField key={token.mint} label={`${token.symbol} mint`} value={token.mint} />)}
          </Section>
        </> : <>
          <Section title="Amount" divider={false}>
            <Field label={review.action === 'claim-stake-rewards' ? 'At least' : 'Estimate'} values={[`${review.action === 'claim-stake-rewards' ? '' : '≈'}${formatUnits(review.amount, 'decimals' in review ? review.decimals : 11)} ${'token' in review ? review.token : review.action === 'claim-sol' ? 'SOL' : 'ORE'}`]} />
            {review.action === 'claim-stake-rewards' && <Note>Every reward accrued when the transaction executes is claimed, so the payout cannot be lower than shown.</Note>}
          </Section>
          {'risk' in review && review.risk && <Section title="Position before withdrawal">
            {riskFields(review.risk).map(([label, value]) => <Field key={label} label={label} values={[value]} />)}
            <Note>Kamino's values after refreshing interest and Scope prices. The withdrawal raises the LTV; Kamino rejects it above the max LTV.</Note>
          </Section>}
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
            {(review.action === 'unstake' || review.action === 'claim-stake-rewards') && <Note>{review.recipientExists
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
          {state.operation.currentStep && <Field label="Current step" values={stepActions(state.operation.currentStep)} />}
          <AddressField label="Position" value={state.operation.position} />
          <AddressField label="Recipient" value={state.operation.wallet} />
          {resumable && <>
            <ActionButton title="End withdrawal" onPress={() => void controller.endWithdrawal()} />
            <Note>Ending stops future steps. Tokens already withdrawn remain in the wallet; remaining assets stay in the position.</Note>
          </>}
        </>}
        {running && <Body>Wait for the result. Resubmission is blocked.</Body>}
        {state.receipt && <Receipt receipt={state.receipt} />}
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
const styles = StyleSheet.create({ strong: { fontFamily: medium }, shrink: { flexShrink: 1, minWidth: 0 } });
