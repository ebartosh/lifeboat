import { getAddressEncoder, type Address } from "@solana/kit";

// Constructed independently from the pinned Rust #[repr(C)] source layout.
// These offsets are test-oracle data and are intentionally not imported from
// ProgramInterface or the bundled IDL.
export function createMinerFixture(authority: Address, rewardsSol = 184_200_000n): Uint8Array {
  const data = new Uint8Array(752);
  const view = new DataView(data.buffer);
  data.set([103, 0, 0, 0, 0, 0, 0, 0], 0);
  data.set(getAddressEncoder().encode(authority), 8);
  view.setBigUint64(40, 1n, true); // auto_return
  view.setBigUint64(48, 22n, true); // checkpoint_id
  view.setBigUint64(56, 10_000n, true); // checkpoint_fee
  view.setBigUint64(64 + 2 * 8, 7_000_000n, true); // deployed[2]
  view.setBigUint64(264 + 2 * 8, 8_000_000n, true); // mass[2]
  view.setBigUint64(464 + 2 * 8, 9_000_000n, true); // cumulative[2]
  view.setBigUint64(664, 91n, true); // round_id
  data[672] = 0x2a; // rewards_factor.bits[0]
  view.setBigUint64(688, rewardsSol, true);
  view.setBigUint64(696, 12n, true);
  view.setBigUint64(704, 13n, true);
  view.setBigInt64(712, -14n, true);
  view.setBigInt64(720, 15n, true);
  view.setBigUint64(728, 16n, true);
  view.setBigUint64(736, 17n, true);
  view.setBigUint64(744, 18n, true);
  return data;
}
