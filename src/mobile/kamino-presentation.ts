import type { KaminoRequest } from '../operations/kamino';
import { formatUnits } from '../core/format';
import { borrows, deposits, WSOL_MINT, type PositionStatus } from '../protocols/kamino/adapter';
import { SF, ceilDiv, debtSf, redeemAmount } from '../protocols/kamino/math';

export type KaminoEntry = {
  id: string; title: string; kind: string; value?: string; position: string; reserve?: string; reason?: string;
  commands: { title: string; symbol: string; request: Omit<KaminoRequest, 'amount'> }[];
};
/** Presentation only: keep raw request identifiers and the existing integer estimates. */
export function kaminoEntries(positions: PositionStatus[]): KaminoEntry[] {
  return positions.flatMap(item => {
    if (!item.position) {
      const candidates = item.repayments ?? [];
      return [{ id: `${item.address}:status`, title: 'Position unavailable', kind: 'Status',
        position: item.address, reason: item.reason ?? 'Position data unavailable', commands: [] },
      ...candidates.map(candidate => ({
        id: `${item.address}:repay:${candidate.reserve ?? candidate.token}:${candidate.token}`,
        title: `Debt ${candidate.token}`, kind: 'Recheck', position: item.address,
        reserve: candidate.reserve, reason: candidate.reason,
        commands: !candidate.reason && candidate.reserve ? [{ title: `Repay ${candidate.token}`, symbol: candidate.token,
          request: { action: 'repay' as const, position: item.address, token: candidate.token, reserve: candidate.reserve } }] : [],
      }))];
    }
    const position = item.position;
    const entries: KaminoEntry[] = [];
    for (const leg of borrows(position.state)) {
      const reserve = position.reserves.get(leg.borrowReserve);
      const token = reserve?.token;
      entries.push({ id: `${item.address}:repay:${leg.borrowReserve}`, title: token ? `Debt ${token.symbol}` : 'Unsupported debt',
        kind: 'Borrow', position: item.address, reserve: leg.borrowReserve,
        value: token && reserve ? `≈${formatUnits(ceilDiv(debtSf(leg, reserve.state), SF), token.decimals)} ${token.symbol}` : undefined,
        reason: token ? undefined : 'Unsupported reserve',
        commands: token ? [{ title: `Repay ${token.symbol}`, symbol: token.symbol,
          request: { action: 'repay', position: item.address, token: token.mint, reserve: token.reserve } },
        ...(token.mint === WSOL_MINT ? [{ title: 'Repay with SOL', symbol: 'SOL',
          request: { action: 'repay' as const, position: item.address, token: 'SOL', reserve: token.reserve } }] : [])] : [],
      });
    }
    for (const leg of deposits(position.state)) {
      const reserve = position.reserves.get(leg.depositReserve);
      const token = reserve?.token;
      entries.push({ id: `${item.address}:withdraw:${leg.depositReserve}`, title: token ? `Collateral ${token.symbol}` : 'Unsupported collateral',
        kind: 'Collateral', position: item.address, reserve: leg.depositReserve,
        value: token && reserve ? `≈${formatUnits(redeemAmount(leg.depositedAmount, reserve.state), token.decimals)} ${token.symbol}` : undefined,
        reason: token ? undefined : 'Unsupported reserve',
        commands: token ? [{ title: `Withdraw ${token.symbol}`, symbol: token.symbol,
          request: { action: 'withdraw', position: item.address, token: token.mint, reserve: token.reserve } }] : [],
      });
    }
    if (!entries.length) entries.push({ id: `${item.address}:empty`, title: 'Empty position', kind: 'Position',
      position: item.address, reason: 'This position has no debt or collateral', commands: [] });
    return entries;
  });
}
