import { describe, expect, it } from 'vitest';
import { kaminoEntries } from '../src/mobile/kamino-presentation';
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
