# Meteora DAMM v2 integration plan

Status: proposed on October 9, 2026. Milestones 1–5 were implemented on October 11, 2026; milestone 6, the device test, remains. Current behavior is in [DAMM v2 operations](meteora-damm-operations.md), sources in [DAMM v2 provenance](meteora-damm-interface-provenance.md) and results in [DAMM v2 validation](meteora-damm-validation.md). The development priorities in [AGENTS.md](../AGENTS.md) apply: reliability first, performance second, few checks and options.

## Verified facts

Read on October 9, 2026 from the official program source (pinned on October 11 to the same commits; the source is release 0.2.4, the SDK's IDL says 0.2.5, and the parts used agree) [`MeteoraAg/damm-v2`](https://github.com/MeteoraAg/damm-v2/tree/a85c926607433f23f0ea60f4ca7b1ae92f4156cb) (commit `a85c926…`) and SDK [`MeteoraAg/damm-v2-sdk`](https://github.com/MeteoraAg/damm-v2-sdk/tree/79ebbfe59a225e641a2f37cd03404f26de1b0c8e) (commit `79ebbfe…`, `src/idl/cp_amm.json`). Milestone 1 pins the exact sources and IDL hash.

- Program `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`, IDL version 0.2.5.
- A position is represented by a Token-2022 NFT. The position account is the PDA `["position", nft_mint]`.
- The SDK discovers a wallet's positions with `getTokenAccountsByOwner(wallet, Token-2022)`: accounts holding exactly 1 token give NFT mints, from which position addresses are derived and fetched in one batch. Discovery needs no Meteora API and no program-wide account scan.
- The SDK's `removeAllLiquidityAndClosePosition` builds a single transaction: `refresh_vesting` (only with separate vesting accounts), `claim_position_fee`, `remove_all_liquidity(token_a_amount_threshold, token_b_amount_threshold)`, `claim_reward` for each initialized reward slot, then `close_position`, which burns the NFT and refunds rent.

Program rules relevant to withdrawal:

- `remove_all_liquidity` removes only `unlocked_liquidity` and fails with `InsufficientLiquidity` when there is none. It first releases matured vesting held inside the position (`refresh_inner_vesting`).
- `close_position` requires `is_empty()`: unlocked, vested and permanently locked liquidity, pending fees and all rewards must be zero (`PositionIsNotEmpty`). A position with a permanent lock or unfinished vesting can never be closed; only its unlocked liquidity, fees and rewards can be recovered.
- `claim_reward` fails on a frozen reward vault unless `skip_reward = 1`, which forfeits that reward and allows the remaining steps and the close.
- The pool's access validator can forbid liquidity removal (`PoolDisabled`).

## Scope

The first version provides one action, **Withdraw all**, for one DAMM v2 position. It recovers everything recoverable and closes the position when the program allows it. DAMM v1 is a separate later phase.

| Position state | Transaction | Result |
| --- | --- | --- |
| Unlocked | fees + remove + rewards + close | Everything recovered; rent refunded |
| Vesting complete | refresh vesting + fees + remove + rewards + close | Same |
| Vesting in progress | fees + remove unlocked + rewards | Locked liquidity stays; review shows the amount and unlock point |
| Permanent lock | fees + rewards | Principal cannot be withdrawn; this is the only recoverable value |
| Pool forbids removal | none | Action disabled with the reason |

## Design

- **One transaction and one approval per position.** Compute Budget, missing ATA creation and the instructions above. The DLMM packet-size check (1,100-byte budget) moves into shared code and is reused.
- **Minimum amounts of 0** in `remove_all_liquidity`. A threshold only makes an emergency withdrawal fail. Removal takes a proportional share of the pool, so moving the price beforehand does not take value from the person withdrawing. Before this is final, write down the argument for concentrated-range pools.
- **Few checks.** Simulation must succeed; the position must be closed, or emptied of what could be removed; wallet token balances must not decrease. Receipts are the measured balance changes, as in DLMM. Token-2022 mints are not checked against an extension allowlist; only transfer hooks are refused, because they require extra accounts and the transaction would fail. Simulation catches other failures.
- **Recovery.** A single transaction uses the existing pending-signature flow used by ORE and Kamino; the DLMM multi-step operation record is not needed.
- **Interface.** DAMM v2 positions appear in the Meteora tab, with the pool type in each row. Rows show the token pair, unlocked, vesting and permanently locked liquidity, fees and rewards. The review uses the DLMM layout.
- **WSOL stays wrapped**, as in DLMM. The SDK unwraps it, but that is a convenience.

## Milestones

1. **Pin sources.** Record the program commit, IDL hash and SDK version in `src/protocols/meteora-damm/metadata.json`. Capture read-only mainnet accounts for pools and positions in several states: unlocked, vesting, permanent lock, Token-2022 with transfer fee, and rewards. Write the support-boundary document.
2. **Read positions.** Decode Position, Pool and Vesting accounts, and discover positions through the wallet's token accounts. Vesting accounts are a separate account type found by a filtered program-account query; confirm that the public RPC accepts it. Fixtures come from the captures.
3. **Build the transaction.** Instruction builder, compared byte for byte against the official SDK with the existing differential pattern; the SDK is installed only in `.cache`.
4. **Integrate.** Shared executor and pending-signature flow, Meteora tab rows and review dialog, and the interface checks at 1×, 1.3× and 2× text.
5. **Unsigned mainnet simulation** on live public positions: compute units and size, transfer-fee tokens and locked positions. Nothing is signed or submitted.
6. **Device test.** The user withdraws a real position with Jupiter using name-only wallet identity.

To confirm in the pinned source during milestone 1:

- which pool states block `can_remove_liquidity`;
- whether fee and reward claims still work in a disabled pool;
- how `refresh_vesting` treats inner vesting compared with separate vesting accounts.

Answered from the pinned source on October 11: only the activation point blocks removal (`pool_status` does not); fee and reward claims work in a disabled pool; `refresh_vesting` refreshes inner vesting exactly as removal does and is needed only for separate vesting accounts. Details are in the provenance document.

## Decisions

1. **Frozen reward vault.** Withdraw all sets `skip_reward = 1` for a vault that is frozen when the position is read, forfeiting that reward so the principal is recovered and the position closes. Details and review name the forfeited reward.
2. **Placement.** DAMM v2 rows are in the Meteora tab with the type `DAMM v2`.
3. **Permanently locked positions.** No separate action: **Withdraw all** stays enabled and claims fees and rewards (and removes any unlocked part); it is disabled with the reason only when nothing is recoverable.

Implementation notes: the minimum-amount argument for concentrated-range pools is written in the operations document. Three cases keep the position open rather than letting the close fail the transaction: dust liquidity (`AmountIsZero`), a frozen or foreign-closable NFT account, and locked liquidity.

## DAMM v1 (later)

DAMM v1 users hold LP tokens rather than position NFTs. Withdrawal goes through Meteora's separate Dynamic Vault program, and LP tokens can sit in lock escrows or farms, each of which needs its own path. It requires separate research and a boundary document, and follows a device-tested DAMM v2.
