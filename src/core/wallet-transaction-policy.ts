import { getCompiledTransactionMessageDecoder, getTransactionEncoder, type Transaction } from '@solana/kit';
import { decodeLighthouseGuard, LIGHTHOUSE_PROGRAM } from './lighthouse';

export const MAX_WALLET_PRIORITY_FEE_LAMPORTS = 200_000n;
export const COMPUTE_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export type WalletTransactionChanges = { computeUnitLimit: number | null; priorityFeeLamports: bigint; assertionCount: number };
type Message = Extract<ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>, { version: 'legacy' }>;
type Ix = Message['instructions'][number];

function decode(transaction: Transaction): Message {
  if (getTransactionEncoder().encode(transaction).length > 1232) throw new Error('Message size');
  const [message, consumed] = getCompiledTransactionMessageDecoder().read(transaction.messageBytes, 0);
  if (message.version !== 'legacy' || consumed !== transaction.messageBytes.length) throw new Error('Message format');
  const h = message.header;
  if (h.numSignerAccounts < 1 || h.numReadonlySignerAccounts > h.numSignerAccounts || h.numReadonlyNonSignerAccounts > message.staticAccounts.length - h.numSignerAccounts
    || new Set(message.staticAccounts).size !== message.staticAccounts.length) throw new Error('Message accounts');
  for (const ix of message.instructions) {
    if (!message.staticAccounts[ix.programAddressIndex] || (ix.accountIndices ?? []).some(index => !message.staticAccounts[index])) throw new Error('Message indices');
  }
  return message;
}

function role(message: Message, index: number) {
  const h = message.header;
  return index < h.numSignerAccounts ? (index < h.numSignerAccounts - h.numReadonlySignerAccounts ? 3 : 2)
    : (index < message.staticAccounts.length - h.numReadonlyNonSignerAccounts ? 1 : 0);
}
function sameIx(a: Message, x: Ix, b: Message, y: Ix) {
  const xd = x.data ?? new Uint8Array(), yd = y.data ?? new Uint8Array();
  const xa = x.accountIndices ?? [], ya = y.accountIndices ?? [];
  return a.staticAccounts[x.programAddressIndex] === b.staticAccounts[y.programAddressIndex]
    && xd.length === yd.length && xd.every((byte, i) => byte === yd[i])
    && xa.length === ya.length && xa.every((index, i) => a.staticAccounts[index] === b.staticAccounts[ya[i]]);
}
function compute(ix: Ix): { kind: 'limit'; value: number } | { kind: 'price'; value: bigint } {
  if (ix.accountIndices?.length) throw new Error('Compute accounts');
  const bytes = Uint8Array.from(ix.data ?? []), view = new DataView(bytes.buffer);
  if (bytes[0] === 2 && bytes.length === 5) {
    const value = view.getUint32(1, true); if (value < 1 || value > 1_400_000) throw new Error('Compute limit');
    return { kind: 'limit', value };
  }
  if (bytes[0] === 3 && bytes.length === 9) return { kind: 'price', value: view.getBigUint64(1, true) };
  throw new Error('Compute instruction');
}

/** Permit only equivalent operations, bounded compute settings and read-only Lighthouse guards on existing accounts. */
export function validateWalletTransactionChanges(originalTx: Transaction, returnedTx: Transaction): WalletTransactionChanges | null {
  try {
    const original = decode(originalTx), returned = decode(returnedTx);
    if (original.lifetimeToken !== returned.lifetimeToken || original.staticAccounts[0] !== returned.staticAccounts[0]
      || original.header.numSignerAccounts !== returned.header.numSignerAccounts) return null;
    const originalSet = new Set(original.staticAccounts);
    for (const [index, account] of original.staticAccounts.entries()) {
      const target = returned.staticAccounts.indexOf(account);
      if (target < 0 || role(original, index) !== role(returned, target)
        || (index < original.header.numSignerAccounts && index !== target)) return null;
    }
    for (const [index, account] of returned.staticAccounts.entries()) {
      if (!originalSet.has(account) && ((account !== COMPUTE_PROGRAM && account !== LIGHTHOUSE_PROGRAM) || role(returned, index) !== 0)) return null;
    }
    const core = original.instructions.filter(ix => original.staticAccounts[ix.programAddressIndex] !== COMPUTE_PROGRAM);
    if (core.length === 0) return null;
    let originalHadLimit = false;
    for (const ix of original.instructions) if (original.staticAccounts[ix.programAddressIndex] === COMPUTE_PROGRAM) {
      const setting = compute(ix);
      originalHadLimit = originalHadLimit || setting.kind === 'limit';
    }
    let coreIndex = 0, limit: number | null = null, price: bigint | null = null, assertionCount = 0;
    for (const ix of returned.instructions) {
      const program = returned.staticAccounts[ix.programAddressIndex];
      if (program === COMPUTE_PROGRAM) {
        const setting = compute(ix);
        if (setting.kind === 'limit') { if (limit !== null) return null; limit = setting.value; }
        else { if (price !== null) return null; price = setting.value; }
      } else if (coreIndex < core.length && sameIx(original, core[coreIndex], returned, ix)) coreIndex++;
      else if (program === LIGHTHOUSE_PROGRAM && coreIndex === core.length) {
        const indices = ix.accountIndices ?? [];
        if (indices.length !== 1 || !originalSet.has(returned.staticAccounts[indices[0]]) || !decodeLighthouseGuard(ix.data)) return null;
        if (++assertionCount > 8) return null;
      } else return null;
    }
    if (coreIndex !== core.length || (originalHadLimit && limit === null) || (price !== null && limit === null)) return null;
    const priorityFeeLamports = (BigInt(limit ?? 0) * (price ?? 0n) + 999_999n) / 1_000_000n;
    if (priorityFeeLamports > MAX_WALLET_PRIORITY_FEE_LAMPORTS) return null;
    return { computeUnitLimit: limit, priorityFeeLamports, assertionCount };
  } catch { return null; }
}
