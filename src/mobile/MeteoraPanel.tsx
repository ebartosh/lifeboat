import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Address } from '@solana/kit';
import type { MeteoraStatus } from '../protocols/meteora/adapter';
import type { DammPosition, DammStatus } from '../protocols/meteora-damm/adapter';
import { formatUnits } from '../core/format';
import { WSOL } from '../protocols/meteora/codec';
import { totalReceipts } from '../protocols/meteora/withdraw';
import { removalAmounts } from '../protocols/meteora-damm/math';
import { estimatedReceipts, holdText, unlockText, withdrawalShape } from '../protocols/meteora-damm/withdraw';
import { ActionButton } from './ActionButton';
import { AddressField, Amount, Body, DataRow, Dialog, Field, ListHeader, Note, Notice, PanePair, Panel, Section,
  readTime } from './Interface';
import { colors, ui } from './theme';
type Entry = { kind: 'dlmm'; status: MeteoraStatus } | { kind: 'damm'; status: DammStatus };
const short = (value:string) => `${value.slice(0,4)}…${value.slice(-4)}`;
const amount = (token: { amount: bigint; decimals: number; symbol: string }) => `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`;
/** What Withdraw all recovers; a status only when it cannot recover everything. */
function row(entry: Entry): { values: string[]; status?: string } {
  if (entry.kind === 'dlmm') return entry.status.position && !entry.status.reason
    ? { values: totalReceipts(entry.status.position).map(amount) } : { values: [], status: 'Unavailable' };
  const p = entry.status.position; if (!p) return { values: [], status: 'Unavailable' };
  const shape = withdrawalShape(p), held = shape.holds.includes('vesting') ? 'Vesting' : shape.holds.includes('permanent') ? 'Locked' : 'Partial';
  if (shape.blocked) return { values: [], status: p.vested > 0n ? 'Vesting' : p.permanent > 0n ? 'Locked' : 'Unavailable' };
  return { values: estimatedReceipts(p, shape.actions).map(amount), ...(shape.closes ? {} : { status: held }) };
}
export function MeteoraPanel({positions,damm,loading,message,dammMessage,disabled,run,runDamm,readAt}: {
  positions:MeteoraStatus[] | null; damm:DammStatus[] | null; loading:boolean; message:string; dammMessage:string; disabled:boolean;
  run(position:Address):void; runDamm(position:Address):void; readAt?:number | null;
}) {
  const [selectedId,setSelectedId] = useState<Address | null>(null);
  const [details,setDetails] = useState(false);
  const entries: Entry[] | null = positions || damm ? [...(positions ?? []).map(status => ({ kind: 'dlmm' as const, status })),
    ...(damm ?? []).map(status => ({ kind: 'damm' as const, status }))] : null;
  const selected = selectedId ? entries?.find(e => e.status.address === selectedId) : entries?.[0];
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.status.address); },[selectedId,selected?.status.address]);
  const pair = (entry:Entry) => entry.status.position?.tokens.map(t => t.symbol).join(' / ') ?? 'Unavailable position';
  const busy = disabled ? 'Actions are unavailable while another operation is running or being checked.' : '';
  return <>
    <PanePair list={<Panel title="Meteora · Positions" footer={readAt && entries ? readTime(readAt) : undefined}>
      <Note>DLMM · DAMM v2 · withdraw all</Note>
      {loading && <Notice>Loading Meteora positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!!dammMessage && <Notice error>{dammMessage}</Notice>}
      {!loading && !message && !dammMessage && entries?.length === 0 && <Notice>No Meteora DLMM or DAMM v2 positions.</Notice>}
      {!!entries?.length && <View>
        <ListHeader left="Position" right="Amount" />
        {entries.map(entry => {
          const state = row(entry);
          return <DataRow key={entry.status.address} title={pair(entry)}
            titleColor={entry.status.position ? colors.token : undefined} kind={entry.kind === 'damm' ? 'DAMM v2' : 'DLMM'} address={short(entry.status.address)}
            values={state.values} {...(state.status ? { status: state.status } : {})}
            selected={selected?.status.address === entry.status.address} onPress={() => setSelectedId(entry.status.address)} />;
        })}
      </View>}
    </Panel>} details={<Panel title={selected ? pair(selected) : 'Details'} titleColor={selected?.status.position ? colors.token : undefined}>
      {selected ? selected.kind === 'damm'
        ? <DammDetails status={selected.status} busy={busy} disabled={disabled || loading || !!dammMessage} run={runDamm} details={() => setDetails(true)} />
        : <DlmmDetails status={selected.status} busy={busy} disabled={disabled || loading || !!message} run={run} details={() => setDetails(true)} />
        : <Body>{selectedId && entries && !loading ? 'The selected position is no longer available. Select another position.' : 'Select a position once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title={selected?.kind === 'damm' ? 'Meteora DAMM v2 position' : 'Meteora position'} subtitle={selected ? pair(selected) : undefined} onClose={() => setDetails(false)}>
      {selected && <>
        {!!selected.status.reason && <Notice>Restriction: {selected.status.reason}</Notice>}
        {selected.kind === 'dlmm' && selected.status.position && <Field label="Bins" values={[`${selected.status.position.state.lower_bin_id} to ${selected.status.position.state.upper_bin_id}`]} />}
        {selected.kind === 'damm' && selected.status.position && <Field label="Pool type" values={[selected.status.position.pool.collect_fee_mode === 2
          ? 'Compounding (constant product)' : 'Concentrated (one price range)']} />}
        <AddressField label="Position" value={selected.status.address} />
        {selected.status.poolAddress && <AddressField label="Pool" value={selected.status.poolAddress} />}
        {selected.status.position && <>
          {selected.kind === 'damm' && <AddressField label="Position NFT" value={selected.status.position.state.nft_mint} />}
          <AddressField label="Recipient" value={selected.status.position.wallet} />
          {([...selected.status.position.tokens,...selected.status.position.rewards] as ({ symbol: string; mint: Address } | null)[])
            .flatMap((t,i) => t ? [<AddressField key={i} label={`${t.symbol} mint`} value={t.mint} />] : [])}
          <Note>Amounts are estimates from the loaded state. Account state, receipts, fees and rent are checked again before each signature.</Note>
        </>}
      </>}
    </Dialog>
  </>;
}
function Commands({ disabled, onRun, details }: { disabled: boolean; onRun?: () => void; details(): void }) {
  return <View style={ui.commands}>
    <ActionButton title="Details" onPress={details} />
    <View style={ui.actions}>
      <ActionButton title="Withdraw all" variant="primary" disabled={disabled || !onRun} onPress={() => onRun?.()} />
    </View>
  </View>;
}
function DlmmDetails({ status, busy, disabled, run, details }: { status: MeteoraStatus; busy: string; disabled: boolean; run(position: Address): void; details(): void }) {
  const position = status.position;
  const sum = (pick:(bin:NonNullable<typeof position>['bins'][number]) => bigint) => position!.bins.reduce((n,b) => n+pick(b),0n);
  const reason = busy || (!position ? 'This position cannot be withdrawn here.' : '');
  const transferFees = !!position && position.tokens.concat(position.rewards.filter(t => t !== null)).some(t => t.token.transferFee);
  return <>
    {!!status.reason && <Notice>Restriction: {status.reason}</Notice>}
    {position && <>
      <View>
        <Text style={[ui.label, { color: colors.header }]}>{transferFees ? 'You receive · after transfer fees, est.' : 'You receive · est.'}</Text>
        {totalReceipts(position).map(token => <Amount key={token.mint} hero value={amount(token)} />)}
      </View>
      <Section title={transferFees ? 'Before transfer fees · estimates' : 'Breakdown · estimates'}>
        <Field label="Liquidity" values={position.tokens.map((token,i) =>
          `≈${formatUnits(sum(b => i === 0 ? b.x : b.y),token.decimals)} ${token.symbol}`)} />
        <Field label="Fees" values={position.tokens.map((token,i) =>
          `≈${formatUnits(sum(b => i === 0 ? b.feeX : b.feeY),token.decimals)} ${token.symbol}`)} />
        {position.rewards.map((token,i) => token && <Field key={i} label={`Reward ${i+1}`}
          values={[`≈${formatUnits(sum(b => b.rewards[i]!),token.decimals)} ${token.symbol}`]} />)}
        {position.rewards.every(r => !r) && <Note>No liquidity mining rewards are configured.</Note>}
        {transferFees && <Note>Transfer fees are estimated for the current epoch and each withdrawal step. Withheld fees are unavailable to spend.</Note>}
      </Section>
      {([...position.tokens,...position.rewards].some(t => t?.mint === WSOL)) && <Notice>WSOL is received as WSOL and stays wrapped.</Notice>}
    </>}
    <Commands disabled={disabled} details={details} {...(position ? { onRun: () => run(position.address) } : {})} />
    {position && <Note>Withdraw all removes this position’s liquidity, claims fees and rewards, and closes its empty account.</Note>}
    {!!reason && <Note>{reason}</Note>}
  </>;
}
function DammDetails({ status, busy, disabled, run, details }: { status: DammStatus; busy: string; disabled: boolean; run(position: Address): void; details(): void }) {
  const position = status.position, shape = position ? withdrawalShape(position) : null;
  const amounts = (p: DammPosition, liquidity: bigint) => {
    const { a, b } = removalAmounts(p.pool, liquidity);
    return [`≈${formatUnits(a,p.tokens[0].decimals)} ${p.tokens[0].symbol}`, `≈${formatUnits(b,p.tokens[1].decimals)} ${p.tokens[1].symbol}`];
  };
  const reason = busy || (!position ? 'This position cannot be withdrawn here.' : '');
  const transferFees = !!position && position.tokens.concat(position.rewards.filter(t => t !== null)).some(t => t.token.transferFee);
  const receipts = position && shape && !shape.blocked ? estimatedReceipts(position, shape.actions) : [];
  return <>
    {!!status.reason && <Notice>Restriction: {status.reason}</Notice>}
    {position && shape && <>
      {!shape.blocked && <View>
        <Text style={[ui.label, { color: colors.header }]}>{transferFees ? 'You receive · after transfer fees, est.' : 'You receive · est.'}</Text>
        {receipts.map(token => <Amount key={token.mint} hero value={amount(token)} />)}
        {!receipts.length && <Body>No tokens; the withdrawal closes the empty position and refunds its rent.</Body>}
      </View>}
      <Section title={transferFees ? 'Before transfer fees · estimates' : 'Breakdown · estimates'}>
        <Field label="Unlocked" values={amounts(position, position.unlocked)} />
        {position.vested > 0n && <Field label="Vesting" values={amounts(position, position.vested)} />}
        {position.permanent > 0n && <Field label="Permanently locked" values={amounts(position, position.permanent)} />}
        <Field label="Fees" values={position.tokens.map((token,i) =>
          `≈${formatUnits(i === 0 ? position.fees.a : position.fees.b,token.decimals)} ${token.symbol}`)} />
        {position.rewards.map(token => token && <Field key={token.index} label={`Reward ${token.index+1}`}
          values={[`≈${formatUnits(position.rewardAmounts[token.index]!,token.decimals)} ${token.symbol}`]} />)}
        {position.rewards.every(r => !r) && <Note>No liquidity mining rewards are configured.</Note>}
        {position.vested > 0n && unlockText(position) && <Note>More vesting liquidity unlocks at {unlockText(position)}.</Note>}
        {transferFees && <Note>Transfer fees are estimated for the current epoch and each transfer. Withheld fees are unavailable to spend.</Note>}
      </Section>
      {!!shape.blocked && <Notice>{shape.blocked}</Notice>}
      {!shape.blocked && !shape.closes && <Notice>The position stays open after the withdrawal. {holdText(position, shape.holds)}</Notice>}
      {!shape.blocked && !!shape.forfeited.length && <Notice>{shape.forfeited.map(t => t.symbol).join(', ')} reward vault is frozen. Withdraw all forfeits that pending reward so the principal can be withdrawn.</Notice>}
      {([...position.tokens,...position.rewards].some(t => t?.mint === WSOL)) && <Notice>WSOL is received as WSOL and stays wrapped.</Notice>}
    </>}
    <Commands disabled={disabled} details={details} {...(position && !shape?.blocked ? { onRun: () => run(position.address) } : {})} />
    {position && <Note>Withdraw all claims fees, removes all unlocked liquidity, claims rewards, and closes the position and burns its NFT when nothing remains locked. It is one transaction.</Note>}
    {!!reason && <Note>{reason}</Note>}
  </>;
}
