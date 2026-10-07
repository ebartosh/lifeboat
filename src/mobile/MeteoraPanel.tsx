import { useEffect, useState } from 'react';
import type { Address } from '@solana/kit';
import type { MeteoraStatus } from '../protocols/meteora/adapter';
import { formatUnits } from '../core/format';
import { WSOL } from '../protocols/meteora/codec';
import { totalReceipts } from '../protocols/meteora/withdraw';
import { ActionButton } from './ActionButton';
import { AddressField, Body, DataRow, Dialog, Notice, PanePair, Panel } from './Interface';
export function MeteoraPanel({positions,loading,message,disabled,run}: {
  positions:MeteoraStatus[] | null; loading:boolean; message:string; disabled:boolean; run(position:Address):void;
}) {
  const [selectedId,setSelectedId] = useState<Address | null>(null);
  const [details,setDetails] = useState(false);
  const selected = selectedId ? positions?.find(p => p.address === selectedId) : positions?.[0];
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.address); },[selectedId,selected?.address]);
  const pair = (status:MeteoraStatus) => status.position?.tokens.map(t => t.symbol).join(' / ') ?? 'Unavailable position';
  const position = selected?.position;
  return <>
    <PanePair list={<Panel title="Meteora / Positions">
      <Body>DLMM · Selected position withdrawal</Body>
      {loading && <Notice>Loading Meteora positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!loading && !message && positions?.length === 0 && <Notice>No Meteora DLMM positions.</Notice>}
      {positions?.map(status => <DataRow key={status.address} title={pair(status)}
        kind={`DLMM · ${status.address.slice(0,4)}…${status.address.slice(-4)}`}
        value={status.reason ? 'Unavailable' : 'PositionV2'} selected={selected?.address === status.address}
        onPress={() => setSelectedId(status.address)} />)}
    </Panel>} details={<Panel title={selected ? `Meteora / ${pair(selected)}` : 'Meteora / Details'}>
      {selected ? <>
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <>
          {position.tokens.map((token,i) => <Body key={token.mint} selectable>
            Liquidity before transfer fees (estimate): ≈{formatUnits(position.bins.reduce((n,b) => n+(i === 0 ? b.x : b.y),0n),token.decimals)} {token.symbol}
          </Body>)}
          {position.tokens.map((token,i) => <Body key={token.mint} selectable>
            Fees before transfer fees (estimate): ≈{formatUnits(position.bins.reduce((n,b) => n+(i === 0 ? b.feeX : b.feeY),0n),token.decimals)} {token.symbol}
          </Body>)}
          {position.rewards.map((token,i) => token && <Body key={i} selectable>
            Reward {i+1} before transfer fees (estimate): ≈{formatUnits(position.bins.reduce((n,b) => n+b.rewards[i]!,0n),token.decimals)} {token.symbol}
          </Body>)}
          {position.rewards.every(r => !r) && <Body>No liquidity mining rewards are configured.</Body>}
          {totalReceipts(position).map(token => <Body key={token.mint} selectable>
            Wallet receipt after transfer fees (estimate): ≈{formatUnits(token.amount,token.decimals)} {token.symbol}
          </Body>)}
          {position.tokens.concat(position.rewards.filter(t => t !== null)).some(t => t.token.transferFee) &&
            <Body>Transfer fees are estimated for the current epoch and each withdrawal step. Withheld fees are unavailable to spend.</Body>}
          <Body>Withdraw all removes this position’s liquidity, claims fees and rewards, and closes its empty account.</Body>
          {([...position.tokens,...position.rewards].some(t => t?.mint === WSOL)) && <Notice>WSOL is received as WSOL and stays wrapped.</Notice>}
        </>}
        <ActionButton title="Full details" onPress={() => setDetails(true)} />
        <ActionButton title="Withdraw all" variant="primary" disabled={disabled || !position || loading || !!message}
          onPress={() => position && run(position.address)} />
        {disabled && <Body>Actions are unavailable while another operation is running or being checked.</Body>}
      </> : <Body>{selectedId && positions && !loading ? 'The selected position is no longer available. Select another position.' : 'Select a position once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title="Meteora position" onClose={() => setDetails(false)}>
      {selected && <>
        <AddressField label="Position" value={selected.address} />
        {selected.poolAddress && <AddressField label="Pool" value={selected.poolAddress} />}
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {position && <>
          <AddressField label="Recipient" value={position.wallet} />
          <Body>Bins: {position.state.lower_bin_id} to {position.state.upper_bin_id}</Body>
          {[...position.tokens,...position.rewards.filter(t => t !== null)].map((t,i) => <AddressField key={i} label={`${t.symbol} mint`} value={t.mint} />)}
          <Body>Amounts are estimates from the loaded state. Account state, receipts, fees and rent are checked again before each signature.</Body>
        </>}
      </>}
    </Dialog>
  </>;
}
