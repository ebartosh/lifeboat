import { getAddressEncoder, type Address } from '@solana/kit';
import { ORE_MINT } from '../../src/protocols/ore-stake';

export type StakeFields = { balance?: bigint; rewardsFactor?: bigint; rewards?: bigint; lifetimeRewards?: bigint };

function setI128(view: DataView, offset: number, value: bigint) {
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigInt64(offset + 8, value >> 64n, true);
}

/** Mainnet layout: 8-byte steel discriminator followed by the 112-byte repr(C) Stake. */
export function stakeFixture(wallet: Address, balance = 123_456_789_012n, fields: Omit<StakeFields, 'balance'> = {}): Uint8Array {
  const data = new Uint8Array(120);
  const view = new DataView(data.buffer);
  data[0] = 108;
  data.set(getAddressEncoder().encode(wallet), 8);
  view.setBigUint64(40, balance, true);
  setI128(view, 88, fields.rewardsFactor ?? 0n);
  view.setBigUint64(104, fields.rewards ?? 0n, true);
  view.setBigUint64(112, fields.lifetimeRewards ?? fields.rewards ?? 0n, true);
  return data;
}

export function treasuryFixture(rewardsFactor = 0n, totalStaked = 0n): Uint8Array {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  data[0] = 104;
  setI128(view, 8, rewardsFactor);
  view.setBigUint64(24, totalStaked, true);
  return data;
}

export function tokenFixture(owner: Address, amount = 123_456_789_012n): Uint8Array {
  const data = new Uint8Array(165);
  data.set(getAddressEncoder().encode(ORE_MINT), 0);
  data.set(getAddressEncoder().encode(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}
