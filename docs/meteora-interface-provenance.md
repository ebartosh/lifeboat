# Meteora DLMM interface provenance

The adapter uses `@solana/kit` 7.1.1 and does not depend on Meteora's SDK, SPL Token SDK, Anchor, web3.js, BN or Decimal at runtime. The official clients are independent verification references, installed only in an ignored `.cache/meteora-reference` directory for the differential checks. Shared token provenance and exact extension policy are in [token-infrastructure.md](token-infrastructure.md) and `src/core/token-interface.json`.

| Item | Pinned value |
| --- | --- |
| Network | Solana mainnet-beta |
| Genesis hash | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| DLMM program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| IDL metadata version/spec | `0.12.0` / `0.1.0` |
| Official SDK | `@meteora-ag/dlmm` 1.9.14 |
| Source commit | `576919e3e4368e542c402f000b4264724f7f23ec` |
| Token-2022 Rust interface/processor commit | `1436a91674fb3679e6473661f5f1e6a6b41f093d` |
| Independent official SPL Token client | `@solana/spl-token` 0.4.15 |

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

Preparation validates mainnet genesis, executable programs, account owners, discriminators, sizes, the pool PDA, reserve/reward vault PDAs, bin-array PDAs and their pool/index links, bitmap links, SPL/Token-2022 mints and their extension policy, program-specific ATAs and token authorities. Position accounts can be initialized keypairs or PDAs whose initialization base is not stored: there is no invented universal position PDA check. Instead, program ownership, PositionV2 discriminator and wallet/pool links are verified. Mint-program discovery precedes ATA derivation and is revalidated in the final `getMultipleAccounts` snapshot with a monotonic minimum slot. Confirmed transaction slots set the floor for subsequent reads.

Instructions use the upstream IDL discriminator/account order and tightly encoded Borsh arguments. All admitted tokens use an empty `RemainingAccountsInfo.slices` vector because transfer hooks are excluded. Pool X/Y and reward programs come from separately verified mint owners. The fixed memo program account in the IDL remains present. Writable bin arrays are appended in ascending index order after IDL accounts; optional missing bitmap accounts use the program address as a read-only sentinel. `remove_liquidity_by_range2` always encodes 10,000 bps. Fee and reward instructions follow removal with a new state read, and `close_position2` is prepared only after zero shares and pending amounts are verified.

Simulation requires a fresh account snapshot, verifies the targeted shares/pending amounts, validates position/pool links and recipient authorities, and matches the gross vault debit to net recipient increments plus the exact increase in withheld fees. Withheld vault fees remain unchanged. The returned Clock epoch selects the fee schedule; mint bytes remain unchanged. Remaining estimates apply rounding and caps to separate instruction ranges, liquidity, fees and rewards. Completion requires a confirmed close and a fresh absent position account. RPC responses remain a trust dependency; simulation cannot prove future execution or protect against a malicious RPC fabricating the chain.

## Captures and checks

PermissionlessV2 (`pair_type = 3`) uses the preset parameter address stored in `base_key` plus the ordered mint addresses as pool PDA seeds. The bin step is not the preset index. Public Agency/SOL, SI/SOL, MASK/SOL and CHONK/SOL accounts exposed an incorrect reconstruction on October 7; the validation was corrected against the pinned official `deriveLbPairWithPresetParamWithIndexKey` helper. `tests/fixtures/meteora/token2022-pools.json` records these public pool/mint/reserve accounts and an SPL SOL/USDC control. Live reads confirmed their mint policies and reserve states; they do not establish a particular user position's eligibility or payout simulation.

`tests/fixtures/meteora/mainnet.json` contains public program/pool/mint/reserve accounts captured with read-only mainnet RPC; it records the slot, UTC timestamp, source commit and discovery filters. Synthetic position/bin fixtures use independent pinned offsets. The SDK differential script covers base/extended/max-width positions, one-sided liquidity, fees/rewards, negative PDAs and all four instruction types. Neither the app dependency tree nor its lockfile changes to install the SDK reference.
