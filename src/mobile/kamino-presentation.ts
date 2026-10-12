import type { KaminoRequest } from '../operations/kamino';
import { formatUnits } from '../core/format';
import { borrows, deposits, MULTIPLY_TAG, WSOL_MINT, type Position, type PositionStatus } from '../protocols/kamino/adapter';
import { SF, ceilDiv, debtSf, positionRisk, redeemAmount, type PositionRisk } from '../protocols/kamino/math';

export type KaminoEntry = {
  id: string; title: string; kind: string; value?: string; position: string; reserve?: string; reason?: string;
  context?: string; risk?: string;
  commands: { title: string; symbol: string; request: Omit<KaminoRequest, 'amount'> }[];
};
/** Explains why limits differ from the reserve's own and what Lifeboat can unwind. */
function positionContext(position: Position): string | undefined {
  const notes: string[] = [];
  if (position.state.tag === MULTIPLY_TAG) notes.push('Kamino Multiply position. Lifeboat repays only from funds '
    + 'already in the wallet; it does not swap or flash-loan to unwind leverage.');
  const group = position.state.elevationGroup;
  if (group !== 0) notes.push(`Elevation group (eMode) ${group}: Kamino applies its `
    + `${position.market.elevationGroups[group - 1]!.ltvPct}% LTV to all collateral.`);
  return notes.length ? notes.join(' ') : undefined;
}
const permille = (value: bigint) => `${value / 10n}.${value % 10n}%`;
/** Kamino's own risk values; the caller states where they come from. */
export function riskFields(risk: PositionRisk): [label: string, value: string][] {
  return [['LTV', permille(risk.ltvPermille)], ['Max LTV', permille(risk.maxLtvPermille)],
    ['Liquidation LTV', permille(risk.liquidationLtvPermille)],
    ['Health', `${risk.healthCenti / 100n}.${String(risk.healthCenti % 100n).padStart(2, '0')}`]];
}
// Values change only when someone refreshes the position on-chain; slots are ~0.4 s.
function storedRisk(position: Position): string | undefined {
  const risk = positionRisk(position.state);
  if (!risk) return undefined;
  const minutes = Number(position.slot - position.state.lastUpdate.slot) * 0.4 / 60;
  const age = minutes < 1 ? 'less than a minute' : minutes < 120 ? `≈${Math.round(minutes)} min` : `≈${Math.round(minutes / 60)} h`;
  return `${riskFields(risk).map(([label, value]) => `${label} ${value}`).join(' · ')}. Stored by Kamino ${age} before this read; prices and interest may have moved since.`;
}
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
    const context = positionContext(position);
    const risk = storedRisk(position);
    for (const leg of borrows(position.state)) {
      const reserve = position.reserves.get(leg.borrowReserve);
      const token = reserve?.token;
      entries.push({ id: `${item.address}:repay:${leg.borrowReserve}`, title: token ? `Debt ${token.symbol}` : 'Unsupported debt',
        kind: 'Borrow', position: item.address, reserve: leg.borrowReserve, context, risk,
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
        kind: 'Collateral', position: item.address, reserve: leg.depositReserve, context, risk,
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
