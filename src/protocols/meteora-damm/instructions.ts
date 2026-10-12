import { AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import idl from './cp_amm.idl.json';
import { check, PROGRAM } from './codec';

const encoder = getAddressEncoder();
const text = (value: string) => new TextEncoder().encode(value);
async function pda(seeds: readonly Uint8Array[]) {
  return (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: [...seeds] }))[0];
}
/** Seeds from the pinned create_position instruction. */
export const positionAddress = (nftMint: Address) => pda([text('position'), Uint8Array.from(encoder.encode(nftMint))]);
/** create_position puts the NFT in this program-derived token account; it can move to any account later. */
export const nftAccountAddress = (nftMint: Address) => pda([text('position_nft_account'), Uint8Array.from(encoder.encode(nftMint))]);
export const eventAuthorityAddress = () => pda([text('__event_authority')]);

export type ActionKind = 'refresh' | 'fees' | 'remove' | 'reward' | 'close';
const names: Record<ActionKind, string> = { refresh: 'refresh_vesting', fees: 'claim_position_fee', remove: 'remove_all_liquidity',
  reward: 'claim_reward', close: 'close_position' };
type IdlAccount = { name: string; address?: string; writable?: boolean; signer?: boolean };
/**
 * Exact Anchor arguments in IDL account order. Fixed addresses (pool authority, Token-2022 for the close)
 * come from the IDL; the event authority and program complete event CPI. `remaining` are writable vesting accounts.
 */
export async function dammInstruction(kind: ActionKind, accounts: Record<string, Address>,
  args: { rewardIndex?: number; skipReward?: boolean } = {}, remaining: readonly Address[] = []): Promise<Instruction> {
  const definition = idl.instructions.find(item => item.name === names[kind])!;
  let body = new Uint8Array();
  // remove_all_liquidity: token_a_amount_threshold = token_b_amount_threshold = 0 (docs/meteora-damm-operations.md).
  if (kind === 'remove') body = new Uint8Array(16);
  if (kind === 'reward') {
    check(args.rewardIndex === 0 || args.rewardIndex === 1, 'invalid reward index');
    body = Uint8Array.of(args.rewardIndex, args.skipReward ? 1 : 0);
  }
  check(kind === 'refresh' || remaining.length === 0, 'only refresh_vesting takes vesting accounts');
  const resolved: Record<string, Address> = { ...accounts, event_authority: await eventAuthorityAddress(), program: PROGRAM };
  const data = new Uint8Array(8 + body.length); data.set(definition.discriminator); data.set(body, 8);
  return { programAddress: PROGRAM, data, accounts: [
    ...(definition.accounts as IdlAccount[]).map(item => {
      const key = item.address ? address(item.address) : resolved[item.name];
      check(key, `missing instruction account ${item.name}`);
      return { address: key, role: item.signer ? item.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : item.writable ? AccountRole.WRITABLE : AccountRole.READONLY };
    }),
    ...remaining.map(key => ({ address: key, role: AccountRole.WRITABLE })),
  ] };
}
