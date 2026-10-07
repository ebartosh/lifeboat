import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { ChainAccount } from '../../core/accounts';
import { VerificationError } from '../../core/errors';
import idl from './dlmm.idl.json';
import { decodeTokenAccount, decodeTokenMint, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM } from '../../core/tokens';

export const PROGRAM = address(idl.address);
export const ZERO = address('11111111111111111111111111111111');
export const TOKEN = TOKEN_PROGRAM;
export const TOKEN_2022 = TOKEN_2022_PROGRAM;
export const ATA = ASSOCIATED_TOKEN_PROGRAM;
export const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
export const SYSVAR = address('Sysvar1111111111111111111111111111111111111');
export const WSOL = address('So11111111111111111111111111111111111111112');
export const LEGACY_DISCRIMINATOR = [170, 188, 143, 228, 122, 64, 247, 208];
export const POSITION_SIZE = 8120;
export const BIN_DATA_SIZE = 112;
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new VerificationError(`Meteora: ${message}`);
}
/** Simulation may retain Anchor's emptied system-owned account as a tombstone. */
export function isClosedAccount(account: ChainAccount | null | undefined) {
  return account === null || (!!account && account.owner === ZERO && account.lamports === 0n
    && !account.executable && account.data.length === 0);
}
type FieldType = string | { array: [FieldType, number] } | { defined: { name: string } };
type Field = { name: string; type: FieldType };
const definitions = new Map((idl.types as unknown as { name: string; type: { fields?: Field[] } }[])
  .filter(item => item.type.fields).map(item => [item.name, item.type.fields!]));
// Anchor's IDL includes explicit padding for all bundled zero-copy types. Decode
// sequentially like its Borsh coder; never apply host ABI alignment to u128.
function read(data: Uint8Array, cursor: { offset: number }, type: FieldType): unknown {
  if (typeof type !== 'string') {
    if ('array' in type) return Array.from({ length: type.array[1] }, () => read(data, cursor, type.array[0]));
    return readStruct(data, cursor, type.defined.name);
  }
  const size = type === 'pubkey' ? 32 : ({ u8: 1, u16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16 } as Record<string, number>)[type];
  check(size !== undefined && cursor.offset + size <= data.length, 'truncated or unknown IDL field');
  const offset = cursor.offset; cursor.offset += size;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === 'pubkey') return getAddressDecoder().decode(data.subarray(offset, offset + 32));
  if (type === 'u8') return data[offset];
  if (type === 'u16') return view.getUint16(offset, true);
  if (type === 'u32') return view.getUint32(offset, true);
  if (type === 'i32') return view.getInt32(offset, true);
  if (type === 'i64') return view.getBigInt64(offset, true);
  if (type === 'u128') return view.getBigUint64(offset, true) | view.getBigUint64(offset + 8, true) << 64n;
  return view.getBigUint64(offset, true);
}
function readStruct(data: Uint8Array, cursor: { offset: number }, name: string): Record<string, unknown> {
  const fields = definitions.get(name); check(fields, `unknown IDL type ${name}`);
  return Object.fromEntries(fields.map(field => [field.name, read(data, cursor, field.type)]));
}
export function discriminator(name: string): readonly number[] {
  const definition = idl.accounts.find(item => item.name === name);
  check(definition, `unknown account ${name}`); return definition.discriminator;
}
export function hasDiscriminator(data: Uint8Array, expected: readonly number[]) {
  return data.length >= 8 && expected.every((byte, i) => data[i] === byte);
}
export function decodeAccount<T>(name: string, account: ChainAccount | null | undefined): T {
  check(account && account.owner === PROGRAM && !account.executable, `${name} is missing or has invalid owner/type`);
  check(hasDiscriminator(account.data, discriminator(name)), `${name} discriminator mismatch`);
  const cursor = { offset: 8 }; const result = readStruct(account.data, cursor, name);
  check(cursor.offset === account.data.length, `${name} has unexpected length`);
  return result as T;
}
export type FeeInfo = { fee_x_per_token_complete: bigint; fee_y_per_token_complete: bigint; fee_x_pending: bigint; fee_y_pending: bigint };
export type UserReward = { reward_per_token_completes: bigint[]; reward_pendings: bigint[] };
export type PositionState = { lb_pair: Address; owner: Address; lower_bin_id: number; upper_bin_id: number;
  liquidity_shares: bigint[]; fee_infos: FeeInfo[]; reward_infos: UserReward[]; lock_release_point: bigint; fee_owner: Address; version: number };
export function decodePosition(account: ChainAccount | null | undefined): PositionState {
  check(account && account.owner === PROGRAM && !account.executable, 'position has invalid owner/type');
  check(hasDiscriminator(account.data, discriminator('PositionV2')), 'legacy or unknown position discriminator');
  check(account.data.length >= POSITION_SIZE && account.data.length <= POSITION_SIZE+1330*BIN_DATA_SIZE
    && (account.data.length - POSITION_SIZE) % BIN_DATA_SIZE === 0, 'invalid extended position length');
  const state = decodeAccount<PositionState>('PositionV2', { ...account, data: account.data.subarray(0, POSITION_SIZE) });
  const width = state.upper_bin_id - state.lower_bin_id + 1;
  check(width >= 1 && width <= 1400 && account.data.length >= POSITION_SIZE + Math.max(0, width - 70) * BIN_DATA_SIZE, 'position range exceeds its allocated data');
  const allocated = 70+(account.data.length-POSITION_SIZE)/BIN_DATA_SIZE;
  for (let i = 70; i < allocated; i++) {
    const entry = readStruct(account.data, { offset: POSITION_SIZE + (i - 70) * BIN_DATA_SIZE }, 'PositionBinData') as {
      liquidity_share: bigint; fee_info: FeeInfo; reward_info: UserReward };
    state.liquidity_shares.push(entry.liquidity_share); state.fee_infos.push(entry.fee_info); state.reward_infos.push(entry.reward_info);
  }
  // Unused allocation must not contain assets that would be lost on close.
  check(state.liquidity_shares.slice(width).every(v => v === 0n) && state.fee_infos.slice(width).every(f => f.fee_x_pending === 0n && f.fee_y_pending === 0n)
    && state.reward_infos.slice(width).every(r => r.reward_pendings.every(v => v === 0n)), 'position contains assets outside its range');
  state.liquidity_shares = state.liquidity_shares.slice(0, width); state.fee_infos = state.fee_infos.slice(0, width); state.reward_infos = state.reward_infos.slice(0, width);
  return state;
}
export type RewardInfo = { mint: Address; vault: Address; reward_duration_end: bigint; reward_rate: bigint; last_update_time: bigint };
export type PoolState = { token_x_mint: Address; token_y_mint: Address; reserve_x: Address; reserve_y: Address;
  reward_infos: RewardInfo[]; active_id: number; activation_type: number; pair_type: number; base_key: Address;
  bin_step_seed: number[]; base_factor_seed: number[]; require_base_factor_seed: number; bump_seed: number[];
  token_mint_x_program_flag: number; token_mint_y_program_flag: number;
  parameters: { function_type: number; min_bin_id: number; max_bin_id: number } };
export type Bin = { amount_x: bigint; amount_y: bigint; liquidity_supply: bigint; fee_amount_x_per_token_stored: bigint;
  fee_amount_y_per_token_stored: bigint; fulfilled_order_amount_x: bigint; fulfilled_order_amount_y: bigint;
  limit_order_fee_ask_side: bigint; limit_order_fee_bid_side: bigint };
export type BinArray = { index: bigint; lb_pair: Address; bins: Bin[] };
export type TokenState = { amount: bigint };
// Classic-only compatibility helpers for the public SPL capture script.
export function tokenState(account: ChainAccount | null | undefined, mint: Address, authority: Address): TokenState {
  check(account?.owner === TOKEN, 'invalid ordinary SPL token account');
  const state = decodeTokenAccount(account);
  check(state.mint === mint && state.authority === authority, 'token mint/authority mismatch');
  check(!state.frozen && !state.delegate && state.delegatedAmount === 0n && !state.closeAuthority, 'frozen, delegated or alternate close-authority token account');
  return {amount:state.amount};
}
export function mintDecimals(account: ChainAccount | null | undefined) {
  check(account?.owner === TOKEN, 'ordinary SPL mint required by the capture helper');
  return decodeTokenMint(ZERO,account).decimals;
}
