import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatLamports, formatOre } from '../core/format';
import { parseOreAmount, type StakePosition } from '../protocols/ore-stake';
import type { OreAction } from '../operations/ore';
import type { RewardsState } from './rewards-loader';
import { ActionButton } from './ActionButton';
import { AddressField, AmountInput, Body, DataRow, Dialog, Notice, PanePair, Panel } from './Interface';
import { ui } from './theme';

type Entry = OreAction | 'stake';
export function OrePanel({ rewards, stake, stakeStatus, stakeMessage, disabled, claim, unstake }: {
  rewards: RewardsState; stake: StakePosition | null; stakeStatus: 'idle' | 'loading' | 'ready' | 'error';
  stakeMessage: string; disabled: boolean; claim: (action: OreAction) => void; unstake: (amount: string) => void;
}) {
  const [selectedId, setSelected] = useState<Entry | null>(null);
  const [details, setDetails] = useState(false);
  const [form, setForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const snapshot = rewards.status === 'ready' ? rewards.snapshot : null;
  const selected = selectedId ?? (snapshot?.miner ? 'claim-sol' : stake ? 'stake' : 'claim-sol');
  useEffect(() => {
    if (selectedId === null && (snapshot?.miner || stake)) setSelected(selected);
  }, [selectedId, selected, snapshot, stake]);
  const names = { 'claim-sol': 'SOL rewards', 'claim-ore': 'ORE rewards', stake: 'Direct staking' };
  const values = {
    'claim-sol': snapshot ? `${formatLamports(snapshot.claimableSol)} SOL` : 'Amount unknown',
    'claim-ore': snapshot?.ore ? `${formatOre(snapshot.ore.amount)} ORE` : 'Amount unknown',
    stake: stake ? `${formatOre(stake.available)} ORE` : 'Amount unknown',
  };
  const available = selected === 'stake' ? !!stake && stake.available > 0n
    : !!snapshot?.availableActions.includes(selected);
  const present = selected === 'stake' ? !!stake : !!snapshot?.miner;
  const fees = selected !== 'stake' ? snapshot?.fees[selected] : undefined;
  function submit() {
    if (disabled || !stake) return;
    try {
      const parsed = parseOreAmount(amount);
      if (parsed > stake.available) throw new Error('Insufficient ORE in direct staking');
      setError(''); setForm(false); unstake(amount);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid amount'); }
  }
  const detailContent = <>
    <Body selectable>{values[selected]}</Body>
    {selected === 'stake' && stake ? <>
      <AddressField label="Stake" value={stake.stakeAddress} />
      <Body>Rewards are claimed separately. stORE positions require Unwrap, which is not supported here.</Body>
      <Body>The network fee and account creation costs will be shown after simulation.</Body>
    </> : selected !== 'stake' && snapshot?.miner ? <>
      <AddressField label="Miner" value={snapshot.minerAddress} />
      {selected === 'claim-ore' && snapshot.ore && <Body>Protocol fee: {formatOre(snapshot.ore.fee)} ORE (already deducted)</Body>}
      <Body>Network fee: {fees == null ? 'estimate unavailable' : `${formatLamports(fees)} SOL`}</Body>
      <Body>The network fee estimate excludes token account creation. Claim availability is checked by simulation.</Body>
    </> : <Body>Details are unavailable. Wait for loading to finish or refresh the list.</Body>}
  </>;
  return <>
    <PanePair list={<Panel title="ORE / Entries">
      {(rewards.status === 'loading' || stakeStatus === 'loading') && <Notice>Loading ORE positions…</Notice>}
      {rewards.status === 'error' && <Notice error>{rewards.message}</Notice>}
      {stakeStatus === 'error' && <Notice error>{stakeMessage}</Notice>}
      {snapshot?.miner && (['claim-sol', 'claim-ore'] as const).map(id => <DataRow key={id}
        title={names[id]} kind="Rewards" value={values[id]} selected={selected === id} onPress={() => setSelected(id)} />)}
      {stake && <DataRow title={names.stake} kind="ORE staking" value={values.stake}
        selected={selected === 'stake'} onPress={() => setSelected('stake')} />}
      {stakeStatus === 'ready' && rewards.status === 'ready' && !stake && !snapshot?.miner &&
        <Notice>No ORE positions. No positions or rewards were found for this wallet.</Notice>}
      {snapshot && <Body>Read at {new Date(snapshot.readAt).toLocaleTimeString('en-US')}</Body>}
    </Panel>} details={<Panel title={`ORE / ${names[selected]}`}>
      <Body selectable>{values[selected]}</Body>
      {!present && <Body>Select an available entry. If data has not loaded, refresh the list.</Body>}
      {present && <ActionButton title="Full details" onPress={() => setDetails(true)} />}
      {!available && <Body>{present ? 'No amount is available for this operation.' : 'The operation is unavailable without position data.'}</Body>}
      {disabled && <Body>Actions are unavailable while another operation is running or being checked.</Body>}
      <ActionButton title={selected === 'stake' ? 'Withdraw ORE' : selected === 'claim-sol' ? 'Claim SOL' : 'Claim ORE'}
        variant="primary" disabled={disabled || !available} onPress={() => {
          if (selected === 'stake') { setAmount(''); setError(''); setForm(true); } else claim(selected);
        }} />
    </Panel>} />
    <Dialog visible={details} title={names[selected]} onClose={() => setDetails(false)}>{detailContent}</Dialog>
    <Dialog visible={form} title="Withdraw staked ORE" onClose={() => setForm(false)} closeLabel="Cancel">
      <Body>Available: {values.stake}</Body>
      {stake && <AddressField label="Stake" value={stake.stakeAddress} />}
      <AmountInput label="Withdrawal amount, ORE" value={amount} keyboardType="decimal-pad" editable={!disabled}
        onChangeText={value => { setAmount(value); setError(''); }} placeholder="Enter amount" />
      {!!error && <Notice error>{error}</Notice>}
      <Body>Validation and simulation come first. Signing is requested in the next step.</Body>
      <View style={ui.commands}><ActionButton title="Prepare ORE withdrawal" variant="primary"
        disabled={disabled || !amount.trim()} onPress={submit} /></View>
    </Dialog>
  </>;
}
