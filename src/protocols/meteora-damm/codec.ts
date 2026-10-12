import { address, type Address } from '@solana/kit';
import type { ChainAccount } from '../../core/accounts';
import { createIdlDecoder } from '../../core/anchor-idl';
import { VerificationError } from '../../core/errors';
import idl from './cp_amm.idl.json';

export const PROGRAM = address(idl.address);
export const ZERO = address('11111111111111111111111111111111');
export const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
export const SYSVAR = address('Sysvar1111111111111111111111111111111111111');
export const WSOL = address('So11111111111111111111111111111111111111112');
export const NUM_REWARDS = 2;
/** Account sizes including the 8-byte discriminator: the program asserts Pool 1104, Position 400, Vesting 176 bytes. */
export const SIZES = { Pool: 1112, Position: 408, Vesting: 184 } as const;
export type AccountName = keyof typeof SIZES;
/** CollectFeeMode::Compounding prices removals from the tracked reserves instead of the price range. */
export const COMPOUNDING = 2;
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new VerificationError(`Meteora DAMM v2: ${message}`);
}
/** Simulation may retain Anchor's emptied system-owned account as a tombstone. */
export function isClosedAccount(account: ChainAccount | null | undefined) {
  return account === null || (!!account && account.owner === ZERO && account.lamports === 0n
    && !account.executable && account.data.length === 0);
}
const { readStruct } = createIdlDecoder(idl.types as unknown as Parameters<typeof createIdlDecoder>[0], check);
export function discriminator(name: AccountName): readonly number[] {
  return idl.accounts.find(item => item.name === name)!.discriminator;
}
export function hasDiscriminator(data: Uint8Array, expected: readonly number[]) {
  return data.length >= 8 && expected.every((byte, i) => data[i] === byte);
}
export function decodeAccount<T>(name: AccountName, account: ChainAccount | null | undefined): T {
  check(account && account.owner === PROGRAM && !account.executable, `${name} is missing or has invalid owner/type`);
  check(hasDiscriminator(account.data, discriminator(name)), `${name} discriminator mismatch`);
  check(account.data.length === SIZES[name], `${name} has unexpected length`);
  const cursor = { offset: 8 }, result = readStruct(account.data, cursor, name);
  check(cursor.offset === account.data.length, `${name} layout does not match its length`);
  return result as T;
}
/** U256 fields are stored as 32 little-endian bytes. */
export function u256(bytes: readonly number[]): bigint {
  return bytes.reduceRight((value, byte) => value << 8n | BigInt(byte), 0n);
}
export type InnerVesting = { cliff_point: bigint; period_frequency: bigint; cliff_unlock_liquidity: bigint;
  liquidity_per_period: bigint; total_released_liquidity: bigint; number_of_period: number };
export type RewardInfo = { initialized: number; reward_token_flag: number; mint: Address; vault: Address; funder: Address;
  reward_duration: bigint; reward_duration_end: bigint; reward_rate: bigint; reward_per_token_stored: number[];
  last_update_time: bigint; cumulative_seconds_with_empty_liquidity_reward: bigint };
export type PoolState = { token_a_mint: Address; token_b_mint: Address; token_a_vault: Address; token_b_vault: Address;
  liquidity: bigint; sqrt_min_price: bigint; sqrt_max_price: bigint; sqrt_price: bigint; activation_point: bigint;
  activation_type: number; pool_status: number; token_a_flag: number; token_b_flag: number; collect_fee_mode: number;
  fee_a_per_liquidity: number[]; fee_b_per_liquidity: number[]; permanent_lock_liquidity: bigint;
  token_a_amount: bigint; token_b_amount: bigint; layout_version: number; reward_infos: RewardInfo[] };
export type UserRewardInfo = { reward_per_token_checkpoint: number[]; reward_pendings: bigint; total_claimed_rewards: bigint };
export type PositionState = { pool: Address; nft_mint: Address; fee_a_per_token_checkpoint: number[]; fee_b_per_token_checkpoint: number[];
  fee_a_pending: bigint; fee_b_pending: bigint; unlocked_liquidity: bigint; vested_liquidity: bigint; permanent_locked_liquidity: bigint;
  reward_infos: UserRewardInfo[]; inner_vesting: InnerVesting; delegate_permission: number };
export type VestingState = { position: Address; inner_vesting: InnerVesting };
