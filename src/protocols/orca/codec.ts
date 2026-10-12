import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { ChainAccount } from '../../core/accounts';
import { VerificationError } from '../../core/errors';
import idl from './whirlpool.idl.json';

export const PROGRAM = address('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
export const MEMO = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const ZERO = address('11111111111111111111111111111111');
export const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
export const SYSVAR = address('Sysvar1111111111111111111111111111111111111');
export const WSOL = address('So11111111111111111111111111111111111111112');
export const NUM_REWARDS = 3;
export const TICK_ARRAY_SIZE = 88;
export const MIN_TICK_INDEX = -443636;
export const MAX_TICK_INDEX = 443636;
// The pinned 0.29-format IDL carries no discriminators: Anchor uses sha256("account:<Name>")[..8].
// tests/orca-protocol.test.ts recomputes every value.
export const DISCRIMINATORS = {
  Whirlpool: [63, 149, 209, 12, 225, 128, 99, 9],
  Position: [170, 188, 143, 228, 122, 64, 247, 208],
  TickArray: [69, 97, 189, 190, 110, 7, 66, 187],
  PositionBundle: [129, 169, 175, 65, 185, 95, 32, 100],
} as const;
export type AccountName = keyof typeof DISCRIMINATORS;
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new VerificationError(`Orca: ${message}`);
}
/** Simulation may retain Anchor's emptied system-owned account as a tombstone. */
export function isClosedAccount(account: ChainAccount | null | undefined) {
  return account === null || (!!account && account.owner === ZERO && account.lamports === 0n
    && !account.executable && account.data.length === 0);
}
type FieldType = string | { array: [FieldType, number] } | { defined: string };
type Field = { name: string; type: FieldType };
const definitions = new Map<string, Field[]>([
  ...(idl.types as unknown as { name: string; type: { kind: string; fields?: Field[] } }[]),
  ...(idl.accounts as unknown as { name: string; type: { kind: string; fields?: Field[] } }[]),
].filter(item => item.type.kind === 'struct' && item.type.fields).map(item => [item.name, item.type.fields!]));
const sizes: Record<string, number> = { bool: 1, u8: 1, u16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, publicKey: 32 };
// Borsh accounts and the packed zero-copy TickArray are both sequential without host alignment.
function read(data: Uint8Array, cursor: { offset: number }, type: FieldType): unknown {
  if (typeof type !== 'string') {
    if ('array' in type) return Array.from({ length: type.array[1] }, () => read(data, cursor, type.array[0]));
    return readStruct(data, cursor, type.defined);
  }
  const size = sizes[type];
  check(size !== undefined && cursor.offset + size <= data.length, 'truncated or unknown IDL field');
  const offset = cursor.offset; cursor.offset += size;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === 'publicKey') return getAddressDecoder().decode(data.subarray(offset, offset + 32));
  if (type === 'bool') { check(data[offset]! <= 1, 'invalid bool'); return data[offset] === 1; }
  if (type === 'u8') return data[offset];
  if (type === 'u16') return view.getUint16(offset, true);
  if (type === 'u32') return view.getUint32(offset, true);
  if (type === 'i32') return view.getInt32(offset, true);
  if (type === 'i64') return view.getBigInt64(offset, true);
  if (type === 'u64') return view.getBigUint64(offset, true);
  const low = view.getBigUint64(offset, true), high = type === 'i128' ? view.getBigInt64(offset + 8, true) : view.getBigUint64(offset + 8, true);
  return low | high << 64n;
}
function readStruct(data: Uint8Array, cursor: { offset: number }, name: string): Record<string, unknown> {
  const fields = definitions.get(name); check(fields, `unknown IDL type ${name}`);
  return Object.fromEntries(fields.map(field => [field.name, read(data, cursor, field.type)]));
}
export function hasDiscriminator(data: Uint8Array, expected: readonly number[]) {
  return data.length >= 8 && expected.every((byte, i) => data[i] === byte);
}
export function decodeAccount<T>(name: AccountName, account: ChainAccount | null | undefined): T {
  check(account && account.owner === PROGRAM && !account.executable, `${name} is missing or has invalid owner/type`);
  check(hasDiscriminator(account.data, DISCRIMINATORS[name]), `${name} discriminator mismatch`);
  const cursor = { offset: 8 }; const result = readStruct(account.data, cursor, name);
  check(cursor.offset === account.data.length, `${name} has unexpected length`);
  return result as T;
}
export type WhirlpoolRewardInfo = { mint: Address; vault: Address; authority: Address; emissionsPerSecondX64: bigint; growthGlobalX64: bigint };
export type WhirlpoolState = { whirlpoolsConfig: Address; whirlpoolBump: number[]; tickSpacing: number; tickSpacingSeed: number[];
  feeRate: number; protocolFeeRate: number; liquidity: bigint; sqrtPrice: bigint; tickCurrentIndex: number;
  protocolFeeOwedA: bigint; protocolFeeOwedB: bigint; tokenMintA: Address; tokenVaultA: Address; feeGrowthGlobalA: bigint;
  tokenMintB: Address; tokenVaultB: Address; feeGrowthGlobalB: bigint; rewardLastUpdatedTimestamp: bigint;
  rewardInfos: WhirlpoolRewardInfo[] };
export type PositionRewardInfo = { growthInsideCheckpoint: bigint; amountOwed: bigint };
export type PositionState = { whirlpool: Address; positionMint: Address; liquidity: bigint; tickLowerIndex: number; tickUpperIndex: number;
  feeGrowthCheckpointA: bigint; feeOwedA: bigint; feeGrowthCheckpointB: bigint; feeOwedB: bigint; rewardInfos: PositionRewardInfo[] };
export type Tick = { initialized: boolean; liquidityNet: bigint; liquidityGross: bigint; feeGrowthOutsideA: bigint;
  feeGrowthOutsideB: bigint; rewardGrowthsOutside: bigint[] };
export type TickArrayState = { startTickIndex: number; ticks: Tick[]; whirlpool: Address };
/** An initialized reward slot; the program leaves uninitialized slots at the default (zero) mint. */
export const rewardInitialized = (reward: WhirlpoolRewardInfo) => reward.mint !== ZERO;
