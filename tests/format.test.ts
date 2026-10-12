import { describe, expect, it } from "vitest";

import { formatLamports, groupDigits } from "../src/core/format.js";

describe("SOL formatting", () => {
  it.each([
    [0n, "0"],
    [1n, "0.000000001"],
    [184_200_000n, "0.1842"],
    [1_000_000_000n, "1"],
    [1_000_000_001n, "1.000000001"],
  ])("formats %s lamports exactly", (lamports, expected) => {
    expect(formatLamports(lamports)).toBe(expected);
  });
});

describe("display digit grouping", () => {
  it.each([
    ["0", "0"],
    ["999.123456", "999.123456"],
    ["1284.551615", "1,284.551615"],
    ["-1000000", "-1,000,000"],
    ["18446744073709.551615", "18,446,744,073,709.551615"],
  ])("groups %s without changing the fraction", (value, expected) => {
    expect(groupDigits(value)).toBe(expected);
  });
});
