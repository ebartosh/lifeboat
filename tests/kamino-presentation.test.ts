import { describe, expect, it } from 'vitest';
import { kaminoEntries, riskFields } from '../src/mobile/kamino-presentation';
import { positionRisk } from '../src/protocols/kamino/math';
import type { Obligation } from '../src/protocols/kamino/state';
import { adapter, fixture, POSITION, WSOL } from './fixtures/kamino';

describe('Kamino explorer records', () => {
  it('preserves ATA repayment, native SOL repayment and collateral withdrawal requests', async () => {
    const f = await fixture({ reserve: WSOL });
    const positions = await adapter.getStatus(f.rpc, f.wallet.address);
    const entries = kaminoEntries(positions);
    expect(entries.flatMap(entry => entry.commands.map(command => command.title))).toEqual([
      'Repay WSOL', 'Repay with SOL', 'Withdraw WSOL',
    ]);
    expect(entries.flatMap(entry => entry.commands).map(command => command.request)).toEqual([
      { action: 'repay', position: POSITION, token: f.mint, reserve: WSOL },
      { action: 'repay', position: POSITION, token: 'SOL', reserve: WSOL },
      { action: 'withdraw', position: POSITION, token: f.mint, reserve: WSOL },
    ]);
    expect(kaminoEntries([...positions].reverse()).map(entry => entry.id)).toEqual(entries.map(entry => entry.id));
  });
  it('shows the stored risk values with their age on every entry of an indebted position', async () => {
    const f = await fixture();
    const entries = kaminoEntries(await adapter.getStatus(f.rpc, f.wallet.address));
    for (const entry of entries) expect(entry.risk).toBe('LTV 10.0% · Max LTV 80.0% · Liquidation LTV 90.0% · Health 9.00. '
      + 'Stored by Kamino less than a minute before this read; prices and interest may have moved since.');
    const free = await fixture({ debt: 0n });
    expect(kaminoEntries(await adapter.getStatus(free.rpc, free.wallet.address)).every(entry => entry.risk === undefined)).toBe(true);
  });
  it('rounds risk ratios toward liquidation', () => {
    const state = { depositedValueSf: 3n, borrowFactorAdjustedDebtValueSf: 1n, allowedBorrowValueSf: 2n, unhealthyBorrowValueSf: 2n } as Obligation;
    expect(riskFields(positionRisk(state)!)).toEqual([['LTV', '33.4%'], ['Max LTV', '66.6%'], ['Liquidation LTV', '66.6%'], ['Health', '2.00']]);
    expect(positionRisk({ ...state, borrowFactorAdjustedDebtValueSf: 0n })).toBeNull();
    expect(positionRisk({ ...state, depositedValueSf: 0n })).toBeNull();
  });
  it('retains restricted-position repayment candidates without enabling unsupported actions', () => {
    const entries = kaminoEntries([{ address: POSITION, reason: 'Unsupported collateral', repayments: [
      { token: 'SOL', reserve: WSOL }, { token: 'XYZ', reason: 'Unsupported reserve' },
    ] }]);
    expect(entries.flatMap(entry => entry.commands)).toHaveLength(1);
    expect(entries[1]!.commands[0]!.request).toEqual({ action: 'repay', position: POSITION, token: 'SOL', reserve: WSOL });
    expect(entries[2]!.reason).toBe('Unsupported reserve');
    expect(entries.every(entry => entry.value === undefined)).toBe(true);
    expect(kaminoEntries([])).toEqual([]);
  });
});
