# Meteora DLMM operations

Select **Meteora**, refresh positions, select one entry, and choose **Withdraw all**. This action applies to that position. It removes all its liquidity, claims available swap fees and liquidity mining rewards, and closes the empty position account. The connected wallet must own the position and receives the original pool and reward tokens. WSOL stays wrapped; there is no swap or conversion to SOL.

## Supported positions

The first version supports Solana mainnet-beta, PositionV2 (including extensions up to the pinned protocol's 1400-bin limit), ordinary SPL Token mints, and a limited Token-2022 set. Token-2022 mints may have no extensions or any combination of **MetadataPointer**, **TokenMetadata**, and **TransferFeeConfig**. Token accounts may have **ImmutableOwner** and **TransferFeeAmount**; the latter is required exactly when the mint has TransferFeeConfig. Mixed SPL / Token-2022 pool pairs and Token-2022 rewards are supported. Each mint's verified owner determines its token program; pool program flags must agree.

One-sided positions, missing recipient ATAs, fee-only or reward-only positions, and already empty positions are supported. New ATAs use the idempotent creation instruction with the correct token program. Rent uses 165 bytes for SPL, 170 bytes for a Token-2022 ATA with ImmutableOwner, and 182 bytes when TransferFeeAmount is also required. Closing an empty position does not create token accounts.

Legacy positions, all unlisted mint/account extensions (including active or inactive transfer hooks, MemoTransfer and CpiGuard), the native Token-2022 mint, active slot/timestamp locks, and a fee recipient different from the connected owner are displayed with an explanation and a disabled action. Missing, malformed, stale, frozen, delegated, or mismatched accounts also disable preparation. Unknown token symbols are represented by their mint identifier; full mint addresses are available in details and review. Metadata is validated structurally and is never fetched from its URI. Unverifiable amounts are unavailable rather than zero.

DAMM, swaps, and withdrawing all positions in a wallet are outside this integration.

## Review and signing

Each transaction has a fresh account read, blockhash, simulation, fee lookup, and separate approval. Review shows the selected position, recipient, expected remaining **net receipts after transfer fees** by mint, this step's simulated net receipts, any gross transfer and withheld fee, current network fee, estimated remaining fees, ATA rent, estimated position rent refund, and confirmed/remaining step counts. Future receipts and fees are estimates; swaps, reward accrual, epoch changes, RPC state and network fees may change them. Closing refunds the position account's lamports to its owner. Pool vaults and recipient token accounts remain open.

Transfer fees use integer ceiling rounding, the active epoch's schedule and the maximum fee for each separate liquidity, fee or reward transfer. Remaining estimates use the same 70-bin instruction boundaries as withdrawal. The token account's base amount is spendable; withheld fees are stored separately and never added to receipts. Simulation checks the gross vault debit, net wallet increment and exact increase in withheld fees, preserves withheld vault fees, and verifies mint configuration and the simulated Clock epoch. This action does not harvest or withdraw withheld fees.

Liquidity removal uses 10,000 basis points, covering the full position range in chunks of at most 70 bins. The app removes liquidity first, then re-reads and claims fees and each configured reward, and finally re-reads and closes only an empty position. Separate conservative transactions limit packet size and compute use; a maximum-width position can require up to 81 signatures. The estimated step count can change after a state read. Every packet must fit Solana's 1232-byte limit, and simulation must remain within 1,400,000 compute units. Lifeboat adds no priority fee or external landing service to its prepared plan. An external wallet may add bounded Compute Budget settings; these require the [shared wallet-addition policy](solflare-validation.md), repeat simulation and a second fee review before submission.

The external MWA wallet signs through the shared transaction executor; local wallet signing is unavailable. Confirmed close instructions alone do not produce a completed status: the app must read the final position account and verify its absence.

## Interruption and recovery

The app saves an operation identifier, owner, position, RPC, completed steps and signatures. Before submission it also saves the current step and its signature/blockhash. Confirmation is checkpointed before deleting the pending signature. Restart restores either **Result unknown** or **Withdrawal incomplete**.

For an unknown result, use **Check status**. No new step can be sent until the saved signature is confirmed or confirmed with an error. A timeout, transport error, or expired blockhash is not evidence that the transaction did not execute. A crash after saving a signature but before submission also remains conservative and unknown; the app does not infer that it is safe to resend.

Use **Resume withdrawal** once the signature is resolved. Resumption checks the saved wallet and RPC, reads the chain again, and does not resend a confirmed step. If a confirmed step's effects are not visible, continuation stops rather than treating stale or externally changed state as a new withdrawal. **End withdrawal** stops future steps and removes the progress checkpoint only when no signature is pending. It cannot reverse confirmed payouts; remaining assets stay in the position. Closing the dialog does not cancel a submitted transaction.

## Verification boundaries

Protocol fixtures test independent byte offsets and a local account-transition model. The optional official SDK comparison independently checks decoders, amounts, PDA derivation, instruction bytes and account roles without network calls. Local simulations are models, not Solana BPF execution. Read-only mainnet account fixtures and optional live integration tests validate the deployed program and public pool dependencies. The unsigned simulation helper has signing and submission disabled. No real mainnet transactions are sent during development.

Browser layout checks cover narrow/wide screens, 1×/1.3×/2× text, long amounts/addresses, unsupported rows, review, progress, cancellation and unknown results. Android debug checks use the existing x86_64 APK with local Metro. MWA foreground handoff and signature validation are covered by tests; compatibility with a particular external wallet still requires testing on that wallet/device.

See [interface provenance](meteora-interface-provenance.md) and [development commands](development.md).
