import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatLamports, formatOre } from '../core/format';
import { parseOreAmount, type StakePosition } from '../protocols/ore-stake';
import type { OreAction } from '../operations/ore';
import type { RewardsState } from './rewards-loader';
import { ActionButton } from './ActionButton';
import { AddressField, Amount, AmountInput, Body, DataRow, Dialog, Field, ListHeader, Note, Notice, PanePair, Panel,
  Section, readTime } from './Interface';
import { ui } from './theme';

type Entry = OreAction | 'stake' | 'stake-rewards';
export function OrePanel({ rewards, stake, stakeStatus, stakeMessage, disabled, claim, unstake, claimStakeRewards }: {
  rewards: RewardsState; stake: StakePosition | null; stakeStatus: 'idle' | 'loading' | 'ready' | 'error';
  stakeMessage: string; disabled: boolean; claim: (action: OreAction) => void; unstake: (amount: string) => void;
  claimStakeRewards: () => void;
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
  const staking = selected === 'stake' || selected === 'stake-rewards';
  const names = { 'claim-sol': 'SOL rewards', 'claim-ore': 'ORE rewards', stake: 'Direct staking', 'stake-rewards': 'Staking rewards' };
  const values = {
    'claim-sol': snapshot ? `${formatLamports(snapshot.claimableSol)} SOL` : 'Amount unknown',
    'claim-ore': snapshot?.ore ? `${formatOre(snapshot.ore.amount)} ORE` : 'Amount unknown',
    stake: stake ? `${formatOre(stake.available)} ORE` : 'Amount unknown',
    'stake-rewards': stake ? `≈${formatOre(stake.claimable)} ORE` : 'Amount unknown',
  };
  const available = selected === 'stake' ? !!stake && stake.available > 0n
    : selected === 'stake-rewards' ? !!stake && stake.claimable > 0n
      : !!snapshot?.availableActions.includes(selected);
  const present = staking ? !!stake : !!snapshot?.miner;
  const fees = !staking ? snapshot?.fees[selected] : undefined;
  // One explanation for an unavailable action, placed directly below it.
  const reason = disabled ? 'Actions are unavailable while another operation is running or being checked.'
    : !present ? 'Select an available position. If data has not loaded, refresh the list.'
      : !available ? 'No amount is available for this operation.' : '';
  function submit() {
    if (disabled || !stake) return;
    try {
      const parsed = parseOreAmount(amount);
      if (parsed > stake.available) throw new Error('Insufficient ORE in direct staking');
      setError(''); setForm(false); unstake(amount);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid amount'); }
  }
  const detailContent = <>
    <Amount hero value={values[selected]} />
    {staking && stake ? <>
      <AddressField label="Stake" value={stake.stakeAddress} />
      {selected === 'stake'
        ? <Note>Withdrawing does not claim staking rewards; claim them from Staking rewards. stORE positions require Unwrap, which is not supported here.</Note>
        : <Note>The estimate excludes ORE still vesting into the staking treasury. The exact payout is measured by simulation, and claiming keeps the staked balance.</Note>}
      <Note>The network fee and account creation costs will be shown after simulation.</Note>
    </> : !staking && snapshot?.miner ? <>
      <Section title="Costs · estimates">
        {selected === 'claim-ore' && snapshot.ore && <Field label="Protocol fee" values={[`${formatOre(snapshot.ore.fee)} ORE`]} />}
        <Field label="Network fee" values={[fees == null ? 'estimate unavailable' : `${formatLamports(fees)} SOL`]} />
        {selected === 'claim-ore' && snapshot.ore && <Note>The protocol fee is already deducted from the amount.</Note>}
        <Note>The network fee estimate excludes token account creation. Claim availability is checked by simulation.</Note>
      </Section>
      <AddressField label="Miner" value={snapshot.minerAddress} />
    </> : <Body>Details are unavailable. Wait for loading to finish or refresh the list.</Body>}
  </>;
  return <>
    <PanePair list={<Panel title="ORE · Positions"
      footer={snapshot ? readTime(snapshot.readAt) : undefined}>
      {(rewards.status === 'loading' || stakeStatus === 'loading') && <Notice>Loading ORE positions…</Notice>}
      {rewards.status === 'error' && <Notice error>{rewards.message}</Notice>}
      {stakeStatus === 'error' && <Notice error>{stakeMessage}</Notice>}
      {(snapshot?.miner || stake) && <View>
        <ListHeader left="Position" right="Amount" />
        {snapshot?.miner && (['claim-sol', 'claim-ore'] as const).map(id => <DataRow key={id}
          title={names[id]} kind="Rewards" values={[values[id]]} selected={selected === id} onPress={() => setSelected(id)} />)}
        {stake && (['stake', 'stake-rewards'] as const).map(id => <DataRow key={id} title={names[id]} kind="ORE staking"
          values={[values[id]]} selected={selected === id} onPress={() => setSelected(id)} />)}
      </View>}
      {stakeStatus === 'ready' && rewards.status === 'ready' && !stake && !snapshot?.miner &&
        <Notice>No ORE positions. No positions or rewards were found for this wallet.</Notice>}
    </Panel>} details={<Panel title={names[selected]}>
      <Amount hero value={values[selected]} />
      <View style={ui.commands}>
        {present && <ActionButton title="Details" onPress={() => setDetails(true)} />}
        <View style={ui.actions}>
          <ActionButton title={selected === 'stake' ? 'Withdraw ORE' : selected === 'stake-rewards' ? 'Claim rewards'
            : selected === 'claim-sol' ? 'Claim SOL' : 'Claim ORE'}
            variant="primary" disabled={disabled || !available} onPress={() => {
              if (selected === 'stake') { setAmount(''); setError(''); setForm(true); }
              else if (selected === 'stake-rewards') claimStakeRewards(); else claim(selected);
            }} />
        </View>
      </View>
      {!!reason && <Note>{reason}</Note>}
    </Panel>} />
    <Dialog visible={details} title={names[selected]} onClose={() => setDetails(false)}>{detailContent}</Dialog>
    <Dialog visible={form} title="Withdraw staked ORE" onClose={() => setForm(false)} closeLabel="Cancel"
      actions={<ActionButton title="Prepare ORE withdrawal" variant="primary" disabled={disabled || !amount.trim()} onPress={submit} />}>
      <Field label="Available" values={[values.stake]} />
      {stake && <AddressField label="Stake" value={stake.stakeAddress} />}
      <AmountInput label="Withdrawal amount, ORE" value={amount} keyboardType="decimal-pad" editable={!disabled}
        onChangeText={value => { setAmount(value); setError(''); }} placeholder="Enter amount" />
      {!!error && <Notice error>{error}</Notice>}
      <Note>Validation and simulation come first. Signing is requested in the next step.</Note>
    </Dialog>
  </>;
}
