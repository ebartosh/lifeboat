// Independent Rust repr(C) layout: header 8, motherlode 8, Numeric [u8;16], two u64s.
export function createTreasuryFixture(totalUnclaimed = 1000n, totalRefined = 1000n, factor = 0n): Uint8Array {
  const data = new Uint8Array(48);
  data[0] = 104;
  const view = new DataView(data.buffer);
  const bits = BigInt.asUintN(128, factor);
  view.setBigUint64(16, bits & ((1n << 64n) - 1n), true);
  view.setBigUint64(24, bits >> 64n, true);
  view.setBigUint64(32, totalRefined, true);
  view.setBigUint64(40, totalUnclaimed, true);
  return data;
}
