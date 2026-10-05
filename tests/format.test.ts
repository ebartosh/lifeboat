import { describe, expect, it } from "vitest";

import { formatLamports } from "../src/core/format.js";

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
