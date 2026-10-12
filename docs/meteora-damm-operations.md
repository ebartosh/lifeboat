# Meteora DAMM v2 operations

Select **Meteora**, refresh positions, select a row of type `DAMM v2`, and choose **Withdraw all**. One transaction and one wallet approval recover everything the program lets the position release now: pending fees, all unlocked liquidity and every claimable reward. The position account is closed and its NFT burned when nothing remains locked. The connected wallet must hold the position NFT and receives the original pool and reward tokens; WSOL stays wrapped and nothing is swapped.

## Discovery

Lifeboat reads the wallet's Token-2022 accounts (`getTokenAccountsByOwner`) and keeps those holding exactly one token. Each mint derives the position PDA `["position", nft_mint]`; existing DAMM v2 positions are read in one batch, their pools in a second, and every mint, wallet token account, reward vault and NFT account in a third. No Meteora API, indexer, off-chain metadata or program-wide account scan is used.

Separate vesting accounts are the one exception: they are found with a `getProgramAccounts` query filtered by size (184 bytes) and position (offset 8). Lifeboat runs it only when the position vests more liquidity than its inner schedule, which is the case exactly when separate vesting accounts exist. The public mainnet RPC accepted this query on October 11, 2026 (2,944 vesting accounts program-wide, about 1.6 s for an unfiltered read).

DLMM and DAMM v2 positions share the Meteora tab and are read in parallel. A failed DAMM v2 read shows its own error and does not hide or disable DLMM positions, and the reverse.

## What Withdraw all does

The transaction holds, in the official SDK order: Compute Budget, idempotent creation of missing recipient ATAs, and then

| Instruction | When |
| --- | --- |
| `refresh_vesting` with the vesting accounts that release liquidity now | Separate vesting accounts have matured liquidity |
| `claim_position_fee` | The position has liquidity or pending fees |
| `remove_all_liquidity(0, 0)` | Unlocked liquidity remains after the release |
| `claim_reward(i, skip_reward)` | Reward slot `i` is initialized and can still pay this position |
| `close_position` | Nothing remains locked, as listed below |

`remove_all_liquidity` releases matured inner vesting itself, so positions without separate vesting accounts need no refresh. A reward slot is skipped when it owes nothing and cannot accrue more: the position has no liquidity, or the reward period has ended and the position's checkpoint already equals the pool's (the SDK's rule).

| Position state | Transaction | Result |
| --- | --- | --- |
| Unlocked | fees + remove + rewards + close | Everything recovered; rent refunded |
| Vesting complete | (refresh) + fees + remove + rewards + close | Same |
| Vesting in progress | (refresh) + fees + remove unlocked + rewards | Locked liquidity stays; details and review show it and the next unlock point |
| Permanent lock | fees + rewards (+ remove of any unlocked part) | Locked principal cannot be withdrawn |
| Nothing recoverable now | none | Action disabled with the reason |
| Before the pool's activation point, with unlocked liquidity | none | Action disabled with the reason |

The close joins only when the program's `is_empty()` will hold: no vesting or permanently locked liquidity remains, the unlocked liquidity is removed, and the NFT account can be burned and closed by the wallet. It refunds the position, NFT account and NFT mint rent; `refresh_vesting` also refunds the rent of vesting accounts it completes.

Three cases keep the position open instead of letting the close fail the whole transaction:

- **Dust.** `remove_all_liquidity` fails with `AmountIsZero` when the unlocked liquidity is worth less than one unit of either token, so it is left in place.
- **Frozen or foreign-closable NFT account.** Burning fails on a frozen account, and only the close authority can close the account.
- **Locked liquidity**, vesting or permanent.

The review lists the actions, the measured receipts, network fee, ATA rent and rent refund, and states why the position stays open when it does. Details show unlocked, vesting and permanently locked liquidity as token estimates, fees and rewards per slot, and the next unlock point.

### Liquidity minimums

`token_a_amount_threshold` and `token_b_amount_threshold` are 0. A threshold can only make an emergency withdrawal fail when the price moves during review, and the price is state that other users change.

A zero threshold also does not expose the withdrawal to price manipulation. A DAMM v2 pool has one price range `[Pmin, Pmax]` shared by every position, and a removal of liquidity `L` at price `P` pays `a(P) = L(1/√P − 1/√Pmax)` of token A and `b(P) = L(√P − √Pmin)` of token B. Valued at the true price `P*`, the position is worth `V(P*) = a(P*)·P* + b(P*)`, which is concave in `P*`, and `V′(P) = a(P)`. The tokens paid at a moved price `P` are worth `a(P)·P* + b(P) = V(P) + V′(P)(P* − P)`: the tangent of `V` at `P`, which by concavity is never below `V(P*)`. Outside the range `V` is linear, so the bound holds there too. Compounding pools are constant-product pools without a range (`Pmin → 0`, `Pmax → ∞`), and removal pays a proportional share of the tracked reserves, so the same argument applies. Moving the price before the removal changes the mix of tokens received, not their value at the true price; the cost falls on whoever moved the price. The review shows the simulated amounts as an estimate; the executed transaction pays at the price when it lands.

### Frozen reward vaults

`claim_reward` fails on a frozen reward vault unless `skip_reward = 1`, which clears the pending reward without paying it. Withdraw all sets `skip_reward = 1` for a slot whose vault is frozen when the position is read, so the principal can still be withdrawn and the position closed. Details and review name the forfeited reward. A vault that freezes after the read makes the transaction fail on-chain; nothing is forfeited without being reviewed.

## Supported tokens

Pool and reward tokens may use SPL Token or Token-2022. Token-2022 mints are not checked against an extension allowlist. Only an active transfer hook is refused, because the program transfers without the hook's extra accounts and the transaction would always fail; such a position is listed with the reason and a disabled action. Simulation catches other failures, and receipts are measured, so a transfer fee or other extension cannot change what the review reports. Transfer fees are reported as the withheld increase of the wallet's account.

## Checks

Before signing, simulation must succeed and return the accounts Lifeboat asked for. Then:

- the position, its NFT account and NFT mint are closed; or, when the position stays open, its unlocked liquidity is zero after a removal, its pending fees are zero after a fee claim, and each claimed reward is zero;
- no recipient token account of the wallet decreased.

The net increase of each recipient account is the receipt, and the withheld-fee increase is the transfer fee. ATA rent is measured from the created accounts. Pool vaults, reserves and other users' state are not compared, because other users change them.

Not carried over from the DLMM and Orca integrations, because they neither stop a failing transaction nor a payout different from the review: the receipt-token extension allowlist, the recipient-account extension and delegate checks, the vault ownership checks, the mint-configuration comparison after simulation, the Clock-epoch check and the program-loader check. The program checks the same account relations on-chain, and the receipts are measured.

## Interruption and recovery

Withdraw all is one transaction, so it uses the pending-signature flow of ORE and Kamino rather than the DLMM operation record. The signature is saved before submission (`pending.json`, action `meteora-damm-withdraw-all`, with the position). After a restart or an unknown result, **Check status** reads the saved signature through the saved RPC; the transaction is never resent. A confirmed result refreshes the Meteora tab, and a position that stayed open can be withdrawn again later.

## Not supported

Partial withdrawals, fee-only or reward-only actions, swaps, wallet-wide withdrawal and DAMM v1. DAMM v1 positions are LP tokens withdrawn through Meteora's separate Dynamic Vault program, possibly from lock escrows or farms, and need separate research.

The pinned interface, its sources and licenses are recorded in [DAMM v2 provenance](meteora-damm-interface-provenance.md); test, SDK comparison and simulation results in [DAMM v2 validation](meteora-damm-validation.md).
