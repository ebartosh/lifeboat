import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import idl from './dlmm.idl.json';
import { check, PROGRAM, TOKEN } from './codec';
import { associatedTokenAddress, createAssociatedTokenIdempotent, type TokenProgram } from '../../core/tokens';
const encoder = getAddressEncoder();
export function integerBytes(value: bigint, size: number) {
  const output = new Uint8Array(size);
  for (let i = 0; i < size; i++) output[i] = Number(value >> BigInt(i * 8) & 255n);
  return output;
}
export async function pda(seeds: readonly (Uint8Array | string)[], program = PROGRAM) {
  return (await getProgramDerivedAddress({ programAddress: program, seeds:[...seeds] }))[0];
}
export const keyBytes = (key: Address) => Uint8Array.from(encoder.encode(key));
export const binArrayAddress = (pool: Address, index: number) => pda(['bin_array', keyBytes(pool), integerBytes(BigInt(index), 8)]);
export const ataAddress = (wallet: Address, mint: Address, program: TokenProgram = TOKEN) => associatedTokenAddress(wallet, mint, program);
export const createAta = (wallet: Address, mint: Address, ata: Address, program: TokenProgram = TOKEN) =>
  createAssociatedTokenIdempotent(wallet, wallet, mint, ata, program);
export { computeBudget } from '../../core/packing';
export type StepKind = 'remove' | 'fees' | 'reward' | 'close';
const names = { remove: 'remove_liquidity_by_range2', fees: 'claim_fee2', reward: 'claim_reward2', close: 'close_position2' };
/** Exact Anchor Borsh arguments and IDL account order; empty transfer-hook slices. */
export async function dlmmInstruction(kind: StepKind, accounts: Record<string, Address>, lower = 0, upper = 0, reward = 0,
  binArrays: readonly Address[] = []): Promise<Instruction> {
  const definition = idl.instructions.find(item => item.name === names[kind])!;
  const args = kind === 'close' ? new Uint8Array() : new Uint8Array(kind === 'reward' ? 20 : kind === 'remove' ? 14 : 12);
  const view = new DataView(args.buffer); const offset = kind === 'reward' ? 8 : 0;
  if (kind !== 'close') {
    check(Number.isInteger(lower) && Number.isInteger(upper) && lower <= upper && upper - lower < 70, 'invalid instruction range');
    if (kind === 'reward') { check(reward === 0 || reward === 1, 'invalid reward index'); view.setBigUint64(0, BigInt(reward), true); }
    view.setInt32(offset, lower, true); view.setInt32(offset + 4, upper, true);
    if (kind === 'remove') view.setUint16(8, 10_000, true);
    // RemainingAccountsInfo.slices = Vec::new(): four zero bytes, not a slice for bin arrays.
  }
  const resolved: Record<string,Address> = { ...accounts, event_authority: await pda(['__event_authority']), program: PROGRAM };
  const data = new Uint8Array(8 + args.length); data.set(definition.discriminator); data.set(args, 8);
  return { programAddress: PROGRAM, data, accounts: [
    ...definition.accounts.map(item => {
      const fixed = 'address' in item && typeof item.address === 'string' ? address(item.address) : undefined;
      const key = fixed ?? resolved[item.name]; check(key, `missing instruction account ${item.name}`);
      const signer = 'signer' in item && item.signer, writable = 'writable' in item && item.writable;
      return { address: key, role: key === PROGRAM ? AccountRole.READONLY : signer
        ? writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : writable ? AccountRole.WRITABLE : AccountRole.READONLY };
    }), ...binArrays.map(key => ({ address: key, role: AccountRole.WRITABLE })),
  ] };
}
