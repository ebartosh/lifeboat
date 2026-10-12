import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { PositionStatus } from '../protocols/kamino/adapter';
import type { KaminoRequest } from '../operations/kamino';
import { ActionButton } from './ActionButton';
import { AddressField, Amount, AmountInput, Body, DataRow, Dialog, ListHeader, Note, Notice, PanePair, Panel,
  readTime } from './Interface';
import { kaminoEntries, type KaminoEntry } from './kamino-presentation';
import { ui } from './theme';

export function KaminoPanel({ positions, loading, message, disabled, run, readAt }: {
  positions: PositionStatus[] | null; loading: boolean; message: string; disabled: boolean;
  run: (request: KaminoRequest) => void; readAt?: number | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [form, setForm] = useState<KaminoEntry['commands'][number] | null>(null);
  const [amount, setAmount] = useState('all');
  const [error, setError] = useState('');
  const entries = kaminoEntries(positions ?? []);
  const selected = selectedId ? entries.find(item => item.id === selectedId) : entries[0];
  useEffect(() => {
    if (selectedId === null && selected) setSelectedId(selected.id);
  }, [selectedId, selected?.id]);
  // Selection is an identity, never an array index; an open form owns its request.
  function choose(command: KaminoEntry['commands'][number]) {
    setForm(command); setAmount('all'); setError('');
  }
  // Native SOL wraps from the wallet's lamports; only a token ATA can be spent whole.
  const fromBalance = form?.request.action === 'repay' && form.request.token !== 'SOL';
  function submit() {
    if (!form || disabled) return;
    const value = amount.trim();
    if (value === 'balance' && !fromBalance) { setError('Wallet balance repayment needs a token account; enter an amount or all.'); return; }
    if (value !== 'all' && value !== 'balance' && (!/^\d+(\.\d+)?$/.test(value) || !/[1-9]/.test(value))) {
      setError(`Enter a positive amount using a decimal point, or all${fromBalance ? ' or balance' : ''}.`); return;
    }
    setForm(null); run({ ...form.request, amount: value });
  }
  const reason = !selected ? '' : disabled ? 'Actions are unavailable while another operation is running or being checked.'
    : !selected.commands.length ? 'No operations are available for this position.' : '';
  return <>
    <PanePair list={<Panel title="Kamino · Positions" footer={readAt && positions ? readTime(readAt) : undefined}>
      <Note>Main market · lending positions</Note>
      {loading && <Notice>Loading Kamino positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!loading && !message && positions?.length === 0 && <Notice>No Kamino positions.</Notice>}
      {!!entries.length && <View>
        <ListHeader left="Position" right="Amount" />
        {entries.map(entry => <DataRow key={entry.id} title={entry.title} kind={entry.kind}
          address={`${entry.position.slice(0, 4)}…${entry.position.slice(-4)}`}
          values={entry.value ? [entry.value] : []} {...(entry.commands.length ? {} : { status: 'Unavailable' })} selected={selected?.id === entry.id} onPress={() => setSelectedId(entry.id)} />)}
      </View>}
    </Panel>} details={<Panel title={selected ? selected.title : 'Details'}>
      {selected ? <>
        {!!selected.value && <Amount hero value={selected.value} />}
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {!!selected.context && <Note>{selected.context}</Note>}
        {!!selected.risk && <Note>{selected.risk}</Note>}
        <View style={ui.commands}>
          <ActionButton title="Details" onPress={() => setDetails(true)} />
          {/* The first command is primary and goes rightmost, as in the dialog footer. */}
          {!!selected.commands.length && <View style={ui.actions}>
            {selected.commands.map((command, index) => ({ command, index })).reverse().map(({ command, index }) =>
              <ActionButton key={command.title} title={command.title} disabled={disabled}
                variant={index === 0 ? 'primary' : 'secondary'} onPress={() => choose(command)} />)}
          </View>}
        </View>
        {!!reason && <Note>{reason}</Note>}
      </> : <Body>{selectedId && !loading && positions ? 'The selected position is no longer available. Select another position.' : 'Select a position once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title={selected?.title ?? 'Details unavailable'} onClose={() => setDetails(false)}>
      {selected && <>
        {!!selected.value && <Amount hero value={selected.value} />}
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        {!!selected.context && <Note>{selected.context}</Note>}
        {!!selected.risk && <Note>{selected.risk}</Note>}
        <AddressField label="Position" value={selected.position} />
        {selected.reserve && <AddressField label="Reserve" value={selected.reserve} />}
        <Note>This estimate is based on the loaded state. The amount, fees and operation availability are checked again before signing.</Note>
      </>}
    </Dialog>
    <Dialog visible={!!form} title={form?.title ?? 'Kamino operation'} onClose={() => setForm(null)} closeLabel="Cancel"
      actions={<ActionButton title="Prepare operation" variant="primary" disabled={disabled || !amount.trim()} onPress={submit} />}>
      {form && <>
        <AmountInput label={`Amount, ${form.symbol}`} value={amount} onChangeText={value => { setAmount(value); setError(''); }}
          editable={!disabled} placeholder="all or amount" />
        {form.request.action === 'repay' && <View style={ui.commands}>
          <ActionButton title="Full debt" variant="quiet" disabled={disabled}
            onPress={() => { setAmount('all'); setError(''); }} />
          {fromBalance && <ActionButton title="Wallet balance" variant="quiet" disabled={disabled}
            onPress={() => { setAmount('balance'); setError(''); }} />}
        </View>}
        {!!error && <Notice error>{error}</Notice>}
        <Note>{fromBalance ? 'If the wallet balance exceeds the debt, only the debt is repaid. ' : ''}A precise estimate will appear after simulation.</Note>
        <AddressField label="Position" value={form.request.position} />
        {form.request.reserve && <AddressField label="Reserve" value={form.request.reserve} />}
      </>}
    </Dialog>
  </>;
}
