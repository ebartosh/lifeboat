# Orca Whirlpools interface provenance

The adapter uses `@solana/kit` 7.1.1 and does not depend on an Orca SDK, Anchor, web3.js, BN or Decimal at runtime. The official SDK is an independent verification reference, installed only in the ignored `.cache/orca-reference` directory for the differential check. Shared token provenance and the extension policy are in [token-infrastructure.md](token-infrastructure.md) and `src/core/token-interface.json`.

## License boundary

From February 27, 2025 the `orca-so/whirlpools` repository and its npm packages are published under the "Orca License", which permits only listed non-commercial uses and requires Orca's written consent for anything else, including any use that could benefit a competitor. Its definition of use includes downloading, reading and copying. Lifeboat therefore pins **only material released under Apache 2.0**: the last Apache-2.0 source commit and an SDK release published before the change whose package metadata declares Apache-2.0. Later source and releases were not used as references. Whether this boundary is sufficient for a given distribution of Lifeboat is a legal question for its owner, not a technical one.

| Item | Pinned value |
| --- | --- |
| Network | Solana mainnet-beta |
| Genesis hash | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| Whirlpool program | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Source commit (last Apache-2.0, 2025-02-26) | `e528dd23bb41571f92cfdb49a2f15d4fa0b01bec` |
| Program source last changed before the pin | `174dd99` (2025-02-14) |
| IDL source | `@orca-so/whirlpools-sdk` 0.13.16 (published 2025-02-21, `license: Apache-2.0`), `dist/artifacts/whirlpool.json` |
| IDL version | `0.3.4` (Anchor 0.29 format) |
| IDL SHA-256 | `31f112eeea2eb01df489921e44694283806aa7a52a9728e6b420078ec1ebf864` |
| Package integrity | `sha512-pDN6GMPLHhtQtyJ8fiZr4itf59Nvsoj0lKgqC+G5g2D3UvZ1eaArZ9/MsoaTZnE2KdyZhEi3gQJtIkr+9jPOjA==` |
| SDK dependency used by the reference | `@orca-so/common-sdk` 0.6.10 (MIT) |

The IDL is not committed in the repository at this commit; Anchor generates it at build time. The SDK release's recorded `gitHead` is not reachable on the public remote, but the program source did not change between February 14 and the pin, and every instruction Lifeboat builds was checked against the pinned Rust source as well as the IDL. The unmodified IDL is bundled as `src/protocols/orca/whirlpool.idl.json`; its hash is recorded in `metadata.json` and checked by a test, and `.gitattributes` keeps its bytes exact on Windows checkouts. `manifest.json` records the action and support boundary.

## Reference files at the pinned commit

- `programs/whirlpool/src/state/{whirlpool,position,tick,position_bundle}.rs`: account layouts. Whirlpool is 653 bytes, Position 216, the fixed TickArray 9,988 (`8 + 36 + 113 × 88`, packed zero-copy), and `NUM_REWARDS = 3`. A reward slot is initialized when its mint is not the default key.
- `instructions/v2/decrease_liquidity.rs` and `instructions/increase_liquidity.rs` (`ModifyLiquidityV2` accounts): removal, `token_min_*` applied to the transfer-fee-excluded amount, and the update of fees and rewards owed during the same instruction.
- `instructions/v2/collect_fees.rs` and `instructions/v2/collect_reward.rs`: full fee payout; reward payout capped by the vault balance with the remainder still owed.
- `instructions/close_position.rs`, `instructions/close_position_with_token_extensions.rs`, `util/token.rs`, `util/token_2022.rs`: the emptiness requirement, NFT burn, token account close, and (Token-2022) mint close signed by the position PDA. Rent goes to `receiver`.
- `util/shared.rs`: the position authority is the NFT holder or its delegate for exactly one token.
- `util/v2/remaining_accounts_utils.rs`: `Option<RemainingAccountsInfo>`; `None` (one zero byte) adds no remaining accounts.
- `manager/liquidity_manager.rs`, `manager/position_manager.rs`, `manager/tick_manager.rs`, `manager/whirlpool_manager.rs`, `math/{tick_math,token_math,bit_math}.rs`: the fee and reward growth-inside, owed-amount, reward-emission and token-amount math ported to `src/protocols/orca/math.ts`.
- Seeds: `["position", mint]`, `["position_bundle", mint]`, `["tick_array", whirlpool, start_tick_index as decimal text]`, `["whirlpool", config, mint_a, mint_b, tick_spacing LE]`.
- `constants` in the SDK: the Memo program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.

## Validation and encoding

The IDL carries no discriminators in this format; Anchor's `sha256("account:<Name>")[..8]` and `sha256("global:<snake_case>")[..8]` values are constants in `codec.ts` and `instructions.ts`, recomputed by tests. Decoding is sequential without host alignment, rejects truncated or extended accounts, and checks owner, discriminator and exact length. Instruction data is exact Borsh (`u128` liquidity, `u64` minimums, `u8` reward index, `Option` as one byte), and account order and roles come from the bundled IDL.

Reads validate: the position PDA from its mint; the pool PDA from its config, mints and tick spacing seed; the program as executable under the upgradeable loader; the Clock sysvar; the position NFT mint (decimals 0, supply 1) and the wallet's holding account (amount 1, not frozen, no other close authority); pool and reward vaults as the pool's token accounts; receipt mints under the shared policy; and tick arrays by owner, whirlpool and start index when they use the pinned format.

## Not covered by the pinned interface

Mainnet now also has tick arrays with a different discriminator and variable sizes (observed read-only on October 9, 2026 at 7,652, 8,212 and 10,004 bytes), introduced after the pin. Lifeboat does not decode them. It passes their PDAs, which the program validates, and it does not estimate accrued fees or rewards for such positions before review; see [operations](orca-operations.md#when-the-close-waits). Live Whirlpool accounts were still 653 bytes with the pinned discriminator, and the unsigned mainnet simulations in [validation](orca-validation.md) exercise the deployed program with the pinned instructions. Position locks and other later features are handled only through their visible effects (a frozen NFT account) and simulation.

The SDK's `collectFeesQuote` and `collectRewardsQuote` do not apply the program's overflow rule (`checked_mul_shift_right(..).unwrap_or(0)`), so they can differ from the program for inconsistent states in which growth inside falls below a checkpoint. Lifeboat follows the program; a unit test covers this case.
