# Orca Whirlpools operations

Select **Orca**, refresh positions, select one entry, and choose **Withdraw all**. This removes all of the position's liquidity, collects its fees and every initialized reward, closes the position account and burns its NFT. The connected wallet must hold the position NFT. It receives the original pool and reward tokens; WSOL stays wrapped and nothing is swapped.

## Discovery and supported positions

Lifeboat reads the wallet's SPL Token and Token-2022 accounts (`getTokenAccountsByOwner` by token program) and keeps those that hold exactly one token. For each such mint it derives the Whirlpool position PDA (`["position", mint]`) and the position bundle PDA (`["position_bundle", mint]`), and reads both in batched account reads. No program-wide scan, indexer, API or off-chain metadata is used.

Supported: Solana mainnet-beta single-position NFTs, both classic (SPL Token mint, `close_position`) and Token-2022 (`close_position_with_token_extensions`, which also closes the NFT mint), held in the ATA or in any other token account of the wallet. Pool and reward tokens follow the shared receipt-token policy in [token infrastructure](token-infrastructure.md): ordinary SPL Token, extension-free Token-2022, and Token-2022 with TransferFeeConfig, MetadataPointer and TokenMetadata. Positions with liquidity, fee-only or reward-only positions, positions out of range on either side, and already empty positions are supported. Missing recipient ATAs are created idempotently with the correct token program.

Shown with an explanation and a disabled action:

- **Position bundles.** A bundle NFT controls up to 256 positions with different seeds and instructions; it is listed as unsupported.
- **Locked positions.** A position NFT in a frozen token account cannot be burned, so the close would fail.
- **Another close authority** on the position token account, which would make the close fail.
- **Unlisted token extensions**, active or inactive transfer hooks, and the native Token-2022 mint.
- **Owed rewards for an uninitialized reward slot**, which no instruction can collect.
- Mismatched, missing or malformed accounts (position or pool PDA, vaults, tick arrays, program).

## Review and signing

Each transaction has a fresh account read, blockhash, simulation, fee lookup and separate approval. Review lists the step's actions, the recipient, this step's simulated net receipts (with gross transfer and withheld fee where a transfer fee applies), the network fee, ATA rent, remaining estimated receipts, estimated remaining fees and ATA rent, and the rent refund. The refund is the position account plus the position token account, plus the NFT mint for Token-2022 positions.

The plan uses these instructions in order: `decrease_liquidity_v2` for the full position liquidity, `collect_fees_v2`, `collect_reward_v2` for each initialized reward, and the close. A reward is skipped when it owes nothing and emits nothing: its growth inside can only change through emissions, so the owed amount stays exactly zero (if its authority restarted emissions before the transaction landed, the close would fail on-chain and nothing would be paid differently). Skipped rewards do not appear in receipts. The ORCA mint has a built-in symbol; other mints use their on-chain metadata symbol or, without one, their abbreviated address (see [token infrastructure](token-infrastructure.md)). `decrease_liquidity_v2` updates fees and rewards owed itself, so no separate `update_fees_and_rewards` is needed; a position without liquidity accrues nothing. Consecutive instructions share a transaction while it stays within 1,100 bytes and an estimated 1,200,000 compute units (the shared budget in `src/core/packing.ts`). In fixtures, a position with one reward fits a single transaction and one with three rewards needs two, with or without missing ATAs. After each confirmation the app re-reads the position and plans the rest again.

### Liquidity minimums

`token_min_a` and `token_min_b` are 0. The token split of an in-range position changes with every price movement, so any per-token minimum derived at preparation can reject a withdrawal that the chain would accept, and the price is state that other users change during review. This follows the AGENTS.md rule and matches the Meteora integration, whose removal instruction has no minimums. The trade-off is that the composition is not bound: the review shows the simulated amounts as an estimate, and the executed transaction pays out at the price when it lands.

### When the close waits

`collect_reward_v2` pays at most the reward vault's balance and leaves the rest owed, and the program closes only an empty position. The close therefore joins the plan only when every initialized reward's owed amount is known and covered by its vault:

- With both tick arrays in the pinned fixed format, owed fees and rewards are computed exactly as `decrease_liquidity` will compute them, and the close shares a transaction with the collections.
- A tick array in a format the pinned interface does not describe (the newer dynamic tick arrays) does not stop the withdrawal: the program accepts it, and Lifeboat passes only its PDA. Accrued fees and rewards are then not estimated before review (they are measured by simulation), and when a reward is initialized the close becomes a separate step after the removal is confirmed and the owed amounts can be read from the position. Pools without rewards still close in the same transaction.
- If a reward vault holds less than is owed, Lifeboat withdraws the liquidity and fees and collects what the vault holds, then stops with an explanation. The position stays open, without liquidity, until the vault is refilled; resuming later finishes it.

### Simulation checks

Simulation must succeed within the compute limit and return fresh accounts. It checks that the pool's mints, vaults and reward links are unchanged; that removal leaves zero liquidity and fee collection leaves zero fees owed, or that the position, its NFT account (and Token-2022 NFT mint) are closed; that the vaults remain the pool's token accounts; that the receipt-relevant mint fields and the Clock epoch did not regress; and that no wallet token account decreased. The net increase of each wallet account is the receipt, and the withheld increase is the transfer fee.

Reward collections are measured, not required to empty the owed amount, because the payout is capped by a vault balance that other users' collections change. Pool vault balances, mint supply and other users' state are not compared, for the same reason. Lifeboat adds no priority fee; an external wallet may add bounded Compute Budget settings under the [shared wallet-addition policy](solflare-validation.md), which require another simulation and fee review.

## Interruption and recovery

The model is the same as Meteora's. The app saves an operation record (`orca-operation.json` in the app's private storage) with the wallet, position, RPC, completed steps and signatures, and saves each step and its signature before submission. Restart restores **Result unknown** or **Withdrawal incomplete**. An unknown signature must be resolved with **Check status** before another step is prepared; an expired blockhash or a transport error does not prove the step did not execute. **Resume withdrawal** re-reads the chain and never resends a confirmed step; a confirmed removal or fee collection that is not visible blocks continuation. **End withdrawal** removes the checkpoint only when no signature is pending. Completion requires a fresh read showing the position account is gone. Only one withdrawal record (Meteora or Orca) can exist at a time; two records block new submissions.

## Verification boundaries

The interface and its sources are recorded in [Orca provenance](orca-interface-provenance.md); test and simulation results are in [Orca validation](orca-validation.md). Local fixtures model the account transitions and are not BPF execution. The unsigned mainnet simulation helper has signing and submission disabled, and no real mainnet transaction was sent during development. Compatibility with a particular external wallet or device remains a device test.
