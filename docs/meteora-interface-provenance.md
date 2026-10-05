# Meteora DLMM interface provenance

The adapter uses `@solana/kit` 7.1.1 and does not depend on Meteora's SDK, Anchor, web3.js, BN or Decimal at runtime. The official SDK is an independent verification reference, installed only in an ignored `.cache/meteora-reference` directory for the optional differential check.

| Item | Pinned value |
| --- | --- |
| Network | Solana mainnet-beta |
| Genesis hash | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| DLMM program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| IDL metadata version/spec | `0.12.0` / `0.1.0` |
| Official SDK | `@meteora-ag/dlmm` 1.9.14 |
| Source commit | `576919e3e4368e542c402f000b4264724f7f23ec` |

The full unmodified upstream [IDL](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/idl/idl.json) is bundled as `src/protocols/meteora/dlmm.idl.json`. Its SHA-256 is recorded in `metadata.json` and checked by a test. `manifest.json` records the action and support boundary. Upstream package metadata declares the ISC license.

## Reference files

- [SDK withdrawal, claim builders and processPosition](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/index.ts): `removeLiquidity`, `claimFee2`, `claimReward2`, `closePosition2`, and Q64 fee/reward calculations.
- [Position wrapper](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/helpers/positions/wrapper.ts) and [extension decoder/range helpers](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/helpers/positions/index.ts): the 8112-byte base excluding discriminator and 112-byte records beyond 70 bins.
- [PDA derivation](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/helpers/derive.ts): pool, reserve, reward vault, bitmap, bin array, and event authority seeds, including signed bin-array indices.
- [Pool flags](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/ts-client/src/dlmm/helpers/lbPair.ts): distinguish liquidity mining from limit-order layouts. The same bin bytes have different meanings in those pool modes.
- [Rust dynamic position calculations](https://github.com/MeteoraAg/dlmm-sdk/blob/576919e3e4368e542c402f000b4264724f7f23ec/commons/src/extensions/dynamic_position.rs): floor each bin's liquidity amount; shift shares by 64 before multiplying fee/reward growth; active-bin reward accrual divides by 15 and scaled supply.
- [Official current SDK reference](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx) and [examples](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx) were reviewed during implementation. These moving documentation pages do not replace the pinned source interface.

## Validation and encoding

Discovery uses PositionV2/legacy discriminators and owner at offset 40, without a fixed `dataSize` filter. PositionV2 decodes the base plus the extension records required by its declared range. Extra allocated records and unused base bins cannot hide pending assets outside that range. Legacy accounts remain visible but never receive an instruction.

Preparation validates mainnet genesis, executable programs, account owners, discriminators, sizes, the pool PDA, reserve/reward vault PDAs, bin-array PDAs and their pool/index links, bitmap links, SPL mints, ATAs and token authorities. Position accounts can be initialized keypairs or PDAs whose initialization base is not stored: there is no invented universal position PDA check. Instead, program ownership, PositionV2 discriminator and wallet/pool links are verified. Dependency discovery is followed by one `getMultipleAccounts` snapshot with a monotonic minimum slot. Confirmed transaction slots set the floor for subsequent reads.

Instructions use the upstream IDL discriminator/account order and tightly encoded Borsh arguments. Ordinary SPL Token uses an empty `RemainingAccountsInfo.slices` vector. Writable bin arrays are appended in ascending index order after IDL accounts; optional missing bitmap accounts use the program address as a read-only sentinel. `remove_liquidity_by_range2` always encodes 10,000 bps. Fee and reward instructions follow removal with a new state read, and `close_position2` is prepared only after zero shares and pending amounts are verified.

Simulation requires a fresh account snapshot, verifies the targeted shares/pending amounts, validates position/pool links and recipient authorities, and matches recipient token increments to vault decrements. Completion requires a confirmed close and a fresh absent position account. RPC responses remain a trust dependency; simulation cannot prove future execution or protect against a malicious RPC fabricating the chain.

## Captures and checks

`tests/fixtures/meteora/mainnet.json` contains public program/pool/mint/reserve accounts captured with read-only mainnet RPC; it records the slot, UTC timestamp, source commit and discovery filters. Synthetic position/bin fixtures use independent pinned offsets. The SDK differential script covers base/extended/max-width positions, one-sided liquidity, fees/rewards, negative PDAs and all four instruction types. Neither the app dependency tree nor its lockfile changes to install the SDK reference.
