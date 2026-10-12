import { AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import idl from './whirlpool.idl.json';
import { check, PROGRAM } from './codec';

const encoder = getAddressEncoder();
const text = (value: string) => new TextEncoder().encode(value);
export const keyBytes = (key: Address) => Uint8Array.from(encoder.encode(key));
export async function pda(seeds: readonly Uint8Array[]) {
  return (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: [...seeds] }))[0];
}
/** Seeds from the pinned open_position, initialize_tick_array, initialize_pool and position bundle instructions. */
export const positionAddress = (mint: Address) => pda([text('position'), keyBytes(mint)]);
export const positionBundleAddress = (mint: Address) => pda([text('position_bundle'), keyBytes(mint)]);
export const tickArrayAddress = (pool: Address, start: number) => pda([text('tick_array'), keyBytes(pool), text(String(start))]);
export const whirlpoolAddress = (config: Address, mintA: Address, mintB: Address, tickSpacingSeed: readonly number[]) =>
  pda([text('whirlpool'), keyBytes(config), keyBytes(mintA), keyBytes(mintB), Uint8Array.from(tickSpacingSeed)]);

export type StepKind = 'remove' | 'fees' | 'reward' | 'close';
export type CloseKind = 'token' | 'token-2022';
// Anchor 0.29 instruction discriminators: sha256("global:<snake_case_name>")[..8], recomputed by tests.
export const INSTRUCTIONS = {
  decreaseLiquidityV2: [58, 127, 188, 62, 79, 82, 196, 96],
  collectFeesV2: [207, 117, 95, 191, 229, 180, 226, 15],
  collectRewardV2: [177, 107, 37, 180, 160, 19, 49, 209],
  closePosition: [123, 134, 81, 0, 49, 68, 98, 98],
  closePositionWithTokenExtensions: [1, 182, 135, 59, 155, 25, 99, 223],
} as const;
type InstructionName = keyof typeof INSTRUCTIONS;
type IdlAccount = { name: string; isMut: boolean; isSigner: boolean };
const u64 = (value: bigint) => { const d = new Uint8Array(8); new DataView(d.buffer).setBigUint64(0, value, true); return d; };
/**
 * Exact Borsh arguments in IDL account order. remaining_accounts_info is None (one zero byte):
 * transfer-hook mints are rejected, so no hook accounts follow.
 */
export function whirlpoolInstruction(name: InstructionName, accounts: Record<string, Address>,
  args: { liquidity?: bigint; rewardIndex?: number } = {}): Instruction {
  const definition = idl.instructions.find(item => item.name === name);
  check(definition, `unknown instruction ${name}`);
  let body: Uint8Array;
  if (name === 'decreaseLiquidityV2') {
    const liquidity = args.liquidity ?? 0n;
    check(liquidity > 0n && liquidity < 1n << 128n, 'invalid liquidity amount');
    // liquidity_amount u128, token_min_a = 0, token_min_b = 0 (docs/orca-operations.md), None.
    body = new Uint8Array(33);
    body.set(u64(liquidity & ((1n << 64n) - 1n)), 0); body.set(u64(liquidity >> 64n), 8);
  } else if (name === 'collectFeesV2') body = new Uint8Array(1);
  else if (name === 'collectRewardV2') {
    check(Number.isInteger(args.rewardIndex) && args.rewardIndex! >= 0 && args.rewardIndex! < 3, 'invalid reward index');
    body = Uint8Array.of(args.rewardIndex!, 0);
  } else body = new Uint8Array();
  const data = new Uint8Array(8 + body.length); data.set(INSTRUCTIONS[name]); data.set(body, 8);
  return { programAddress: PROGRAM, data, accounts: (definition.accounts as IdlAccount[]).map(item => {
    const key = accounts[item.name]; check(key, `missing instruction account ${item.name}`);
    return { address: key, role: item.isSigner ? item.isMut ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
      : item.isMut ? AccountRole.WRITABLE : AccountRole.READONLY };
  }) };
}
