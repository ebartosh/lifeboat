import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { PositionStatus } from '../protocols/kamino/adapter';
import type { KaminoRequest } from '../operations/kamino';
import { ActionButton } from './ActionButton';
import { AddressField, AmountInput, Body, DataRow, Dialog, Notice, PanePair, Panel } from './Interface';
import { kaminoEntries, type KaminoEntry } from './kamino-presentation';
import { ui } from './theme';

export function KaminoPanel({ positions, loading, message, disabled, run }: {
  positions: PositionStatus[] | null; loading: boolean; message: string; disabled: boolean;
  run: (request: KaminoRequest) => void;
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
  function submit() {
    if (!form || disabled) return;
    const value = amount.trim();
    if (value !== 'all' && (!/^\d+(\.\d+)?$/.test(value) || !/[1-9]/.test(value))) {
      setError('Enter a positive amount using a decimal point, or all.'); return;
    }
    setForm(null); run({ ...form.request, amount: value });
  }
  return <>
    <PanePair list={<Panel title="Kamino / Entries">
      <Body>Main market · Lending positions</Body>
      {loading && <Notice>Loading Kamino positions…</Notice>}
      {!!message && <Notice error>{message}</Notice>}
      {!loading && !message && positions?.length === 0 && <Notice>No Kamino positions.</Notice>}
      {entries.map(entry => <DataRow key={entry.id} title={entry.title}
        kind={`${entry.kind} · ${entry.position.slice(0, 4)}…${entry.position.slice(-4)}`}
        value={entry.value} selected={selected?.id === entry.id} onPress={() => setSelectedId(entry.id)} />)}
    </Panel>} details={<Panel title={selected ? `Kamino / ${selected.title}` : 'Kamino / Details'}>
      {selected ? <>
        {!!selected.value && <Body selectable>{selected.value}</Body>}
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        <ActionButton title="Full details" onPress={() => setDetails(true)} />
        {!selected.commands.length && <Body>No operations are available for this entry.</Body>}
        {disabled && <Body>Actions are unavailable while another operation is running or being checked.</Body>}
        <View style={ui.commands}>{selected.commands.map((command, index) => <ActionButton key={command.title}
          title={command.title} disabled={disabled} variant={index === 0 ? 'primary' : 'secondary'} onPress={() => choose(command)} />)}</View>
      </> : <Body>{selectedId && !loading && positions ? 'The selected entry is no longer available. Select another entry.' : 'Select an entry once the list has loaded.'}</Body>}
    </Panel>} />
    <Dialog visible={details} title={selected?.title ?? 'Details unavailable'} onClose={() => setDetails(false)}>
      {selected && <>
        {!!selected.value && <Body selectable>{selected.value}</Body>}
        <AddressField label="Position" value={selected.position} />
        {selected.reserve && <AddressField label="Reserve" value={selected.reserve} />}
        {!!selected.reason && <Notice>Restriction: {selected.reason}</Notice>}
        <Body>This estimate is based on the loaded state. The amount, fees and operation availability are checked again before signing.</Body>
      </>}
    </Dialog>
    <Dialog visible={!!form} title={form?.title ?? 'Kamino operation'} onClose={() => setForm(null)} closeLabel="Cancel">
      {form && <>
        <AddressField label="Position" value={form.request.position} />
        {form.request.reserve && <AddressField label="Reserve" value={form.request.reserve} />}
        <AmountInput label={`Amount, ${form.symbol}`} value={amount} onChangeText={value => { setAmount(value); setError(''); }}
          editable={!disabled} placeholder="all or amount" />
        <Body>Enter a positive amount using a decimal point, or all for the full available amount. A precise estimate will appear after simulation.</Body>
        {!!error && <Notice error>{error}</Notice>}
        <ActionButton title="Prepare operation" variant="primary" disabled={disabled || !amount.trim()} onPress={submit} />
      </>}
    </Dialog>
  </>;
}
