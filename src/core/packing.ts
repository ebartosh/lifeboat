import { address, type Address, type Instruction } from '@solana/kit';
import { legacyTransactionSize } from './transaction';
import { createAssociatedTokenIdempotent, type TokenMint } from './tokens';

// Room left for a wallet's Compute Budget price and Lighthouse guards within Solana's 1232-byte packet.
export const PACKET_BUDGET = 1232 - 132;
// Below the 1.4M transaction limit, so an underestimate still leaves room.
export const COMPUTE_BUDGET = 1_200_000;
/** SetComputeUnitLimit at the transaction maximum; the plan's own estimate stays below COMPUTE_BUDGET. */
export function computeBudget(): Instruction {
  const data = new Uint8Array(5); data[0] = 2;
  new DataView(data.buffer).setUint32(1, 1_400_000, true);
  return { programAddress: address('ComputeBudget111111111111111111111111111111'), data };
}
export const COMPUTE_ATA = 40_000;
export type PackedToken = { mint: Address; ata: Address; token: TokenMint };
export type PackedTransaction<A, T extends PackedToken> = { actions: A[]; instructions: Instruction[]; tokens: T[]; missing: T[] };
/**
 * Greedily packs consecutive actions into as few transactions as the packet and compute budgets allow.
 * Missing ATAs are created once, in the first transaction that pays into them.
 */
export async function packTransactions<A, T extends PackedToken>(input: { wallet: Address; actions: readonly A[];
  instruction(action: A): Promise<Instruction> | Instruction; tokens(action: A): T[]; compute(action: A): number;
  exists(ata: Address): boolean; fail(message: string): never }): Promise<PackedTransaction<A, T>[]> {
  const { wallet } = input, created = new Set<Address>(), packed: PackedTransaction<A, T>[] = [];
  type Draft = { actions: A[]; atas: Instruction[]; program: Instruction[]; missing: T[]; compute: number };
  let current: Draft | null = null;
  const finish = () => {
    if (!current) return;
    const tokens = [...new Map(current.actions.flatMap(a => input.tokens(a)).map(t => [t.mint, t])).values()];
    packed.push({ actions: current.actions, instructions: [computeBudget(), ...current.atas, ...current.program], tokens, missing: current.missing });
    for (const token of current.missing) created.add(token.ata);
    current = null;
  };
  for (const action of input.actions) {
    const instruction = await input.instruction(action);
    for (let attempt = 0; attempt < 2; attempt++) {
      const base: Draft = current ?? { actions: [], atas: [], program: [], missing: [], compute: 0 };
      const missing = [...new Map(input.tokens(action).filter(t => !input.exists(t.ata) && !created.has(t.ata)
        && !base.missing.some(m => m.ata === t.ata)).map(t => [t.ata, t])).values()];
      const next: Draft = { actions: [...base.actions, action],
        atas: [...base.atas, ...missing.map(t => createAssociatedTokenIdempotent(wallet, wallet, t.mint, t.ata, t.token.program))],
        program: [...base.program, instruction], missing: [...base.missing, ...missing],
        compute: base.compute + input.compute(action) + missing.length * COMPUTE_ATA };
      const fits = next.compute <= COMPUTE_BUDGET && legacyTransactionSize(wallet, [computeBudget(), ...next.atas, ...next.program]) <= PACKET_BUDGET;
      if (fits || !current) { if (!fits) input.fail('a single withdrawal instruction exceeds the transaction limits'); current = next; break; }
      finish();
    }
  }
  finish();
  return packed;
}
