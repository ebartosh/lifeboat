# Meteora DAMM v2 interface provenance

Pinned on October 11, 2026. `src/protocols/meteora-damm/metadata.json` records the same values, and `tests/meteora-damm-protocol.test.ts` checks the IDL hash, program ID, version and discriminators.

| Item | Pin |
| --- | --- |
| Program | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (Solana mainnet-beta) |
| Program source | [`MeteoraAg/damm-v2` `a85c926607433f23f0ea60f4ca7b1ae92f4156cb`](https://github.com/MeteoraAg/damm-v2/tree/a85c926607433f23f0ea60f4ca7b1ae92f4156cb), release cp_amm 0.2.4 (September 8, 2026), the latest commit on `main` when pinned |
| IDL | `src/idl/cp_amm.json` from [`MeteoraAg/damm-v2-sdk` `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`](https://github.com/MeteoraAg/damm-v2-sdk/tree/79ebbfe59a225e641a2f37cd03404f26de1b0c8e), bundled unmodified as `cp_amm.idl.json`; IDL version 0.2.5 |
| IDL SHA-256 | `7f5e5f5e9cab57cd208575dc53359676550e41ee0c19fc822560fe1062fd3ac5` |
| Reference SDK | npm `@meteora-ag/cp-amm-sdk` 1.5.1 (MIT), integrity `sha512-f5jB4cMZ9iA8V+Dtah5I3LvRACyX0TlQkrvD/lxy2SyPf9M8rMK2ViodgCEwTVqyRvyv4JMeK2fGOpDaYwVAug==`, installed only in the ignored `.cache/meteora-damm-reference` for the differential check; its bundled IDL is byte-identical to Lifeboat's |

## License boundary

The SDK, including the IDL, is MIT-licensed and is the only bundled artifact. The program source is under the Meteora Noncommercial Licence. Lifeboat reads it to verify layouts and rules and copies no code from it: the decoder is driven by the MIT IDL, and `math.ts` reimplements the documented formulas in TypeScript.

## IDL and source versions

The SDK synced its IDL to "cp_amm 0.2.5" while the program's newest public source is 0.2.4. Lifeboat uses only parts that agree between them, compared by hand against the pinned source:

- the instruction set and the error codes are identical;
- the account lists, signer and writable flags of `remove_all_liquidity`, `claim_position_fee`, `claim_reward`, `close_position` and `refresh_vesting`, including event CPI accounts, match the Anchor contexts;
- `Pool` (1,104 bytes), `Position` (400 bytes) and `Vesting` (176 bytes) match the `#[account(zero_copy)]` structs, which the program asserts with `const_assert_eq!`; they are bytemuck types without implicit padding, so the IDL fields decode in sequence.

Unsigned mainnet simulations of the built transactions (see [validation](meteora-damm-validation.md)) confirm that the deployed program accepts them.

## Accounts and derivations

- Position: PDA `["position", nft_mint]`. `create_position` mints the Token-2022 NFT into the PDA token account `["position_nft_account", nft_mint]`, owned by the creator; the NFT can later move to any token account.
- Pool authority: PDA `["pool_authority"]`, fixed in the IDL as `HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC`. Event authority: PDA `["__event_authority"]`.
- Vesting: a 184-byte account whose `position` field is at offset 8; the SDK finds it with the same filter.
- Decoding uses the shared IDL reader `src/core/anchor-idl.ts` (also used by Meteora DLMM) and checks the owner, discriminator and exact length.

## Program rules relied on

Read in the pinned source:

- `remove_all_liquidity` first calls `refresh_inner_vesting`, then removes all `unlocked_liquidity`. It fails with `InsufficientLiquidity` when none is unlocked and with `AmountIsZero` when both token amounts round to zero. Thresholds compare transfer-fee-excluded amounts.
- `close_position` requires `is_empty()`: unlocked, vested and permanently locked liquidity, both pending fees and every reward slot's pending amount are zero. It burns the NFT and closes the NFT account (authority: owner) and the NFT mint (authority: pool authority) with Token-2022, and closes the position to `rent_receiver`.
- `claim_position_fee` updates the fee checkpoint on total liquidity (unlocked + vested + permanent), pays both pending amounts and resets them. `remove_all_liquidity` also updates fees, so after a fee claim in the same transaction no new fee accrues.
- `claim_reward` validates the slot and vault, updates pool and position rewards, and resets the slot's pending amount. On a frozen vault with `skip_reward = 1` it pays nothing; with `skip_reward = 0` and a non-zero amount it fails with `RewardVaultFrozenSkipRequired`. On an unfrozen vault `skip_reward` has no effect.
- `refresh_vesting` refreshes inner vesting and every vesting account passed as a remaining account, and closes completed vesting accounts to the owner.
- The program transfers with `transfer_checked` and no extra accounts, so a mint with an active transfer hook cannot be withdrawn.
- The NFT holder (`position_nft_account.owner`) passes every authority check; delegate permissions only matter for other signers.

The plan's open questions, answered from the pinned source:

- **Which pool states block removal?** Only the activation point: `can_remove_liquidity` is `current_point >= activation_point`. `pool_status = Disable` blocks adding liquidity, swaps, new positions, locks and splits, not removal.
- **Do fee and reward claims work in a disabled pool?** Yes. Neither instruction consults the access validator or the activation point.
- **How does `refresh_vesting` treat inner vesting?** It refreshes inner vesting exactly as `remove_all_liquidity` does, then each passed vesting account. Separate vesting accounts are released only by `refresh_vesting`, so Lifeboat adds it only for those.

## Not covered

Instructions Lifeboat does not build (adding liquidity, partial removal, splitting, locking, swaps, delegate management and operator instructions) were not reviewed beyond their effect on the account layouts above.
