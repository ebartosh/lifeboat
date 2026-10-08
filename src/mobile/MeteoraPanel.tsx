import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Address } from '@solana/kit';
import type { MeteoraStatus } from '../protocols/meteora/adapter';
import { formatUnits } from '../core/format';
import { WSOL } from '../protocols/meteora/codec';
import { totalReceipts } from '../protocols/meteora/withdraw';
import { ActionButton } from './ActionButton';
import { AddressField, Amount, Body, DataRow, Dialog, Field, ListHeader, Note, Notice, PanePair, Panel, Section,
  readTime } from './Interface';
import { colors, ui } from './theme';
export function MeteoraPanel({positions,loading,message,disabled,run,readAt}: {
  positions:MeteoraStatus[] | null; loading:boolean; message:string; disabled:boolean; run(position:Address):void;
  readAt?:number | null;
}) {
  const [selectedId,setSelectedId] = useState<Address | null>(null);
  const [details,setDetails] = useState(false);
  const selected = selectedId ? positions?.find(p => p.address === selectedId) : positions?.[0];
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.address); },[selectedId,selected?.address]);
  const pair = (status:MeteoraStatus) => status.position?.tokens.map(t => t.symbol).join(' / ') ?? 'Unavailable position';
  const position = selected?.position;
  const short = (value:string) => `${value.slice(0,4)}…${value.slice(-4)}`;
  const sum = (pick:(bin:NonNullable<typeof position>['bins'][number]) => bigint) => position!.bins.reduce((n,b) => n+pick(b),0n);
  const reason = disabled ? 'Actions are unavailable while another operation is running or being checked.'
    : !position ? 'This position cannot be withdrawn here.' : '';
  return <>
    <PanePair list={<Panel title="Meteora · Positions" footer={readAt && positions ? readTime(readAt) : undefined}>
      <Note>DLMM · selected position withdrawal</Note>
      {loading && <Notice>Loading Meteora positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!loading && !message && positions?.length === 0 && <Notice>No Meteora DLMM positions.</Notice>}
      {!!positions?.length && <View>
        <ListHeader left="Pair" right="Status" />
        {positions.map(status => <DataRow key={status.address} title={pair(status)}
          titleColor={status.position ? colors.token : undefined} kind="DLMM" address={short(status.address)}
          value={status.reason ? 'Unavailable' : 'PositionV2'} valueColor={status.reason ? colors.danger : colors.ok}
          selected={selected?.address === status.address} onPress={() => setSelectedId(status.address)} />)}
      </View>}
    </Panel>} details={<Panel title={selected ? pair(selected) : 'Details'} titleColor={position ? colors.token : undefined}>
      {selected ? <>
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <>
          <View>
            <Text style={[ui.label, { color: colors.header }]}>You receive · after transfer fees, est.</Text>
            {totalReceipts(position).map(token => <Amount key={token.mint} hero value={`≈${formatUnits(token.amount,token.decimals)} ${token.symbol}`} />)}
          </View>
          <Section title="Before transfer fees · estimates">
            <Field label="Liquidity" values={position.tokens.map((token,i) =>
              `≈${formatUnits(sum(b => i === 0 ? b.x : b.y),token.decimals)} ${token.symbol}`)} />
            <Field label="Fees" values={position.tokens.map((token,i) =>
              `≈${formatUnits(sum(b => i === 0 ? b.feeX : b.feeY),token.decimals)} ${token.symbol}`)} />
            {position.rewards.map((token,i) => token && <Field key={i} label={`Reward ${i+1}`}
              values={[`≈${formatUnits(sum(b => b.rewards[i]!),token.decimals)} ${token.symbol}`]} />)}
            {position.rewards.every(r => !r) && <Note>No liquidity mining rewards are configured.</Note>}
            {position.tokens.concat(position.rewards.filter(t => t !== null)).some(t => t.token.transferFee) &&
              <Note>Transfer fees are estimated for the current epoch and each withdrawal step. Withheld fees are unavailable to spend.</Note>}
          </Section>
          {([...position.tokens,...position.rewards].some(t => t?.mint === WSOL)) && <Notice>WSOL is received as WSOL and stays wrapped.</Notice>}
        </>}
        <View style={ui.commands}>
          <ActionButton title="Full details" onPress={() => setDetails(true)} />
          <View style={ui.actions}>
            <ActionButton title="Withdraw all" variant="primary" disabled={disabled || !position || loading || !!message}
              onPress={() => position && run(position.address)} />
          </View>
        </View>
        {position && <Note>Withdraw all removes this position’s liquidity, claims fees and rewards, and closes its empty account.</Note>}
        {!!reason && <Note>{reason}</Note>}
      </> : <Body>{selectedId && positions && !loading ? 'The selected position is no longer available. Select another position.' : 'Select a position once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title="Meteora position" subtitle={selected ? pair(selected) : undefined} onClose={() => setDetails(false)}>
      {selected && <>
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <Field label="Bins" values={[`${position.state.lower_bin_id} to ${position.state.upper_bin_id}`]} />}
        <AddressField label="Position" value={selected.address} />
        {selected.poolAddress && <AddressField label="Pool" value={selected.poolAddress} />}
        {position && <>
          <AddressField label="Recipient" value={position.wallet} />
          {[...position.tokens,...position.rewards.filter(t => t !== null)].map((t,i) => <AddressField key={i} label={`${t.symbol} mint`} value={t.mint} />)}
          <Note>Amounts are estimates from the loaded state. Account state, receipts, fees and rent are checked again before each signature.</Note>
        </>}
      </>}
    </Dialog>
  </>;
}
