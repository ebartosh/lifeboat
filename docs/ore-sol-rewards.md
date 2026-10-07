# ORE SOL rewards: recorded versus pending

On October 6, 2026, the user reported that Lifeboat displayed zero Claim SOL while ore.com Mining displayed 0.000013464 SOL for the same wallet. A read-only mainnet inspection verified:

- Miner account size and ownership matched the pinned ORE layout; both the application decoder and independent little-endian offset 688 returned `rewards_sol = 0`.
- `auto_return = 1`, `round_id = 429687`, and `checkpoint_id = 429109`.
- The miner's round account existed, had valid entropy, had completed relative to Board, and had not expired according to Clock.
- No Automation account existed for this wallet.
- Applying the pinned Checkpoint SOL formula to the miner and round returned exactly 13,464 lamports, matching the site.

An unsigned RPC simulation of the pinned SDK's Checkpoint instruction succeeded at slot 453762265. Its program log reported `Sending 0.000013464 SOL to authority`; the simulated Miner checkpoint advanced to 429687 while `rewards_sol` remained zero. The simulated wallet increased by 8,464 lamports after the 5,000-lamport base network fee. These are simulation results, not an actual payout. No wallet authorization, signature request or transaction submission was performed. A wallet-added priority fee would change the net receipt.

The current application reads Claim SOL exclusively from `Miner.rewards_sol` and considers zero unavailable before building a transaction. Its ClaimSOL instruction only drains that recorded field. It does not include pending rewards from an uncheckpointed completed round or build Checkpoint, so its zero is an incomplete representation of the site's claimable Mining SOL, rather than a rounding, account-layout or Solflare signing error.

Supporting pending Mining SOL requires validating the miner's round/Board/Clock and destination settings, estimating pending rewards using exact integer arithmetic or unsigned simulation, and settling the eligible round as part of the reviewed operation. With auto-return enabled, Checkpoint itself pays pending SOL directly to the wallet; when rewards are retained in Miner, a subsequent ClaimSOL is needed. An active Automation reload setting instead directs new rewards to Automation, whose balance must not be presented as withdrawable by ClaimSOL. Closed, current, uninitialized or expired rounds must not be counted as claimable pending rewards. Execution must re-read state, validate simulated receipts and settlement, account for fees, and retain the bounded external-wallet policy. App support for this flow has not yet been implemented.

Sources at the application's pinned ORE commit `70763fc80d6493302181bebdbf35b90c54f8f15c`: [Miner](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/state/miner.rs), [Checkpoint](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/program/src/checkpoint.rs), [ClaimSOL](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/program/src/claim_sol.rs), [SDK](https://github.com/regolith-labs/ore/blob/70763fc80d6493302181bebdbf35b90c54f8f15c/api/src/sdk.rs).
