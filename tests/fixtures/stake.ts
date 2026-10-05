import { getAddressEncoder, type Address } from '@solana/kit';
import { ORE_MINT } from '../../src/protocols/ore-stake';

export function stakeFixture(wallet: Address, balance = 123_456_789_012n): Uint8Array {
  const data = new Uint8Array(113);
  data[0] = 108;
  data.set(getAddressEncoder().encode(wallet), 1);
  new DataView(data.buffer).setBigUint64(33, balance, true);
  return data;
}

export function tokenFixture(owner: Address, amount = 123_456_789_012n): Uint8Array {
  const data = new Uint8Array(165);
  data.set(getAddressEncoder().encode(ORE_MINT), 0);
  data.set(getAddressEncoder().encode(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}
