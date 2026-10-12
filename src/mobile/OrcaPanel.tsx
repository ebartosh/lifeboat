import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Address } from '@solana/kit';
import type { OrcaStatus } from '../protocols/orca/adapter';
import { formatUnits } from '../core/format';
import { WSOL } from '../protocols/orca/codec';
import { closeHold, totalReceipts } from '../protocols/orca/withdraw';
import { ActionButton } from './ActionButton';
import { AddressField, Amount, Body, DataRow, Dialog, Field, ListHeader, Note, Notice, PanePair, Panel, Section,
  readTime } from './Interface';
import { colors, ui } from './theme';
export function OrcaPanel({positions,loading,message,disabled,run,readAt}: {
  positions:OrcaStatus[] | null; loading:boolean; message:string; disabled:boolean; run(position:Address):void;
  readAt?:number | null;
}) {
  const [selectedId,setSelectedId] = useState<Address | null>(null);
  const [details,setDetails] = useState(false);
  const selected = selectedId ? positions?.find(p => p.address === selectedId) : positions?.[0];
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.address); },[selectedId,selected?.address]);
  const pair = (status:OrcaStatus) => status.position?.tokens.map(t => t.symbol).join(' / ')
    ?? (status.kind === 'bundle' ? 'Position bundle' : 'Unavailable position');
  const position = selected?.position;
  const short = (value:string) => `${value.slice(0,4)}…${value.slice(-4)}`;
  // Rows show what Withdraw all recovers; a status only when it cannot recover everything.
  const amounts = (status:OrcaStatus) => status.position ? totalReceipts(status.position).map(token =>
    `≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`) : [];
  const limit = (status:OrcaStatus) => status.reason || !status.position ? 'Unavailable'
    : closeHold(status.position) === 'reward-vault' ? 'Partial' : undefined;
  const hold = position ? closeHold(position) : null;
  // Gross and net amounts differ only for Token-2022 transfer fees; otherwise the breakdown adds up to the receipt.
  const transferFees = !!position && position.tokens.concat(position.rewards.filter(t => t !== null)).some(t => t.token.transferFee);
  const reason = disabled ? 'Actions are unavailable while another operation is running or being checked.'
    : !position ? 'This position cannot be withdrawn here.' : '';
  return <>
    <PanePair list={<Panel title="Orca · Positions" footer={readAt && positions ? readTime(readAt) : undefined}>
      <Note>Whirlpools · withdraw all</Note>
      {loading && <Notice>Loading Orca positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!loading && !message && positions?.length === 0 && <Notice>No Orca Whirlpool positions.</Notice>}
      {!!positions?.length && <View>
        <ListHeader left="Position" right="Amount" />
        {positions.map(status => <DataRow key={status.address} title={pair(status)}
          titleColor={status.position ? colors.token : undefined} kind="Whirlpool" address={short(status.address)}
          values={amounts(status)} {...(limit(status) ? { status: limit(status)! } : {})}
          selected={selected?.address === status.address} onPress={() => setSelectedId(status.address)} />)}
      </View>}
    </Panel>} details={<Panel title={selected ? pair(selected) : 'Details'} titleColor={position ? colors.token : undefined}>
      {selected ? <>
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <>
          <View>
            <Text style={[ui.label, { color: colors.header }]}>{transferFees ? 'You receive · after transfer fees, est.' : 'You receive · est.'}</Text>
            {totalReceipts(position).map(token => <Amount key={token.mint} hero value={`≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`} />)}
          </View>
          <Section title={transferFees ? 'Before transfer fees · estimates' : 'Breakdown · estimates'}>
            <Field label="Liquidity" values={position.tokens.map((token,i) =>
              `≈${formatUnits(i === 0 ? position.liquidity.a : position.liquidity.b,token.decimals)} ${token.symbol}`)} />
            <Field label="Fees" values={position.tokens.map((token,i) =>
              `${position.ticksKnown ? '≈' : '≥'}${formatUnits(i === 0 ? position.owed.feeA : position.owed.feeB,token.decimals)} ${token.symbol}`)} />
            {position.rewards.map(token => token && <Field key={token.index} label={`Reward ${token.index+1}`}
              values={[`${position.ticksKnown ? '≈' : '≥'}${formatUnits(position.owed.rewards[token.index]!,token.decimals)} ${token.symbol}`]} />)}
            {position.rewards.every(r => !r) && <Note>No liquidity mining rewards are configured.</Note>}
            {!position.ticksKnown && <Note>Fees and rewards accrued since the position's last update are not estimated here; the review measures them by simulation.</Note>}
            {transferFees && <Note>Transfer fees are estimated for the current epoch and each transfer. Withheld fees are unavailable to spend.</Note>}
          </Section>
          {hold === 'reward-vault' && <Notice>A reward vault holds less than this position is owed. Liquidity and fees can be withdrawn; the position closes once the vault is refilled.</Notice>}
          {([...position.tokens,...position.rewards].some(t => t?.mint === WSOL)) && <Notice>WSOL is received as WSOL and stays wrapped.</Notice>}
        </>}
        <View style={ui.commands}>
          <ActionButton title="Details" onPress={() => setDetails(true)} />
          <View style={ui.actions}>
            <ActionButton title="Withdraw all" variant="primary" disabled={disabled || !position || loading || !!message}
              onPress={() => position && run(position.address)} />
          </View>
        </View>
        {position && <Note>Withdraw all removes this position’s liquidity, collects fees and rewards, and closes the position and its NFT.</Note>}
        {!!reason && <Note>{reason}</Note>}
      </> : <Body>{selectedId && positions && !loading ? 'The selected position is no longer available. Select another position.' : 'Select a position once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title="Orca position" subtitle={selected ? pair(selected) : undefined} onClose={() => setDetails(false)}>
      {selected && <>
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <Field label="Ticks" values={[`${position.state.tickLowerIndex} to ${position.state.tickUpperIndex}`,
          `Current ${position.pool.tickCurrentIndex}`]} />}
        <AddressField label={selected.kind === 'bundle' ? 'Position bundle' : 'Position'} value={selected.address} />
        {selected.poolAddress && <AddressField label="Pool" value={selected.poolAddress} />}
        {position && <>
          <AddressField label="Position NFT" value={position.state.positionMint} />
          <AddressField label="Recipient" value={position.wallet} />
          {[...position.tokens,...position.rewards.filter(t => t !== null)].map((t,i) => <AddressField key={i} label={`${t.symbol} mint`} value={t.mint} />)}
          <Note>Amounts are estimates from the loaded state. Account state, receipts, fees and rent are checked again before each signature.</Note>
        </>}
      </>}
    </Dialog>
  </>;
}
