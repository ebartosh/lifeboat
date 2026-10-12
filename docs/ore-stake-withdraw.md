# ore-stake Withdraw and Claim interface

Checked 2026-10-02 against official `regolith-labs/ore-stake` commit `7628af733d9338e9560b353ef731a66efe9db3c8` (verified with `git ls-remote` and a shallow checkout at the same SHA). The published [ore-stake-api 0.3.0](https://docs.rs/ore-stake-api/latest/ore_stake_api/) source agrees on the program ID. The deployed binary was not compared to this source commit.

Sources:

- [Program ID](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/lib.rs): `stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH`. This is not the ORE miner program or the older `STkEAu2...` program found in earlier clients.
- [Instruction](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/instruction.rs): `Withdraw = 11`; `Withdraw { amount: [u8; 8] }`. The SDK serializes the amount little endian after the single byte discriminator.
- [SDK builder](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/sdk.rs): account order and flags: signer writable signer; ORE mint readonly; recipient ATA writable; Stake PDA writable; Stake ATA writable; Treasury PDA writable; Vesting PDA writable; System program readonly; SPL Token program readonly; Associated Token program readonly; ore-stake program readonly.
- [PDA seeds and account discriminator](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/mod.rs), [seed bytes](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/consts.rs): Stake `["stake", authority]`, Treasury `["treasury"]`, Vesting `["vesting"]`, under the ore-stake program. Discriminators: Treasury 104, Stake 108, Vesting 109.
- Account framing: the program pins `steel = 4.0.9` (`Cargo.lock` at the same commit), whose `account!` and `as_account` use `8 + size_of::<T>()`: one tag byte followed by seven zero bytes, then the `repr(C)` struct. Stake is therefore 120 bytes (authority at 8, balance at 40, `rewards_factor` at 88, `rewards` at 104, `lifetime_rewards` at 112) and Treasury 32 bytes (`rewards_factor` at 8, `total_staked` at 24). Mainnet accounts read on 2026-10-08 match both sizes. An earlier parser assumed a one-byte tag and a 113-byte Stake, which no mainnet account has, so Withdraw rejected every real position until this was corrected.
- [Stake layout and withdrawal rule](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/stake.rs): `repr(C)` fields `authority: Pubkey`, `balance: u64`, `compound_fee: u64`, `compound_fee_reserve: u64`, `last_claim_at: i64`, `last_deposit_at: i64`, `last_withdraw_at: i64`, `rewards_factor: Numeric`, `rewards: u64`, `lifetime_rewards: u64`. `withdraw` updates rewards and transfers `min(requested, balance)`, reduces Stake balance and Treasury total staked, and updates withdrawal time. The app rejects requests above balance instead of accepting partial execution.
- [Processor](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/program/src/withdraw.rs): verifies signer, mint, Stake PDA and authority, token reserve, singleton accounts and programs; creates the recipient ATA when missing, transfers from Stake ATA, then checks reserves. It does not claim rewards or close Stake.
- [ORE mint and units](https://github.com/regolith-labs/ore-mint/blob/master/api/src/consts.rs): mint `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp`, 11 decimals. UI input is converted using decimal strings and `bigint`.

This path reads only a direct Stake PDA. A liquid staking `stORE` holding is a different position in [ore-lst](https://github.com/regolith-labs/ore-lst) and requires `Unwrap`, not this Withdraw instruction. No live transaction is sent by tests.

## Claim (staking rewards)

Checked 2026-10-08 against the same commit.

- [Instruction](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/instruction.rs): `Claim = 12`; `Claim { amount: [u8; 8] }`, little endian after the discriminator byte.
- [SDK builder](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/sdk.rs): signer writable signer; ORE mint readonly; recipient ATA writable; Stake PDA writable; Treasury PDA writable; Treasury ATA (`treasury_tokens_address`, the Treasury's ORE ATA) writable; Vesting PDA writable; System, SPL Token, Associated Token and ore-stake programs readonly. Rewards are paid from the Treasury ATA, not the Stake ATA.
- [Processor](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/program/src/claim.rs): verifies signer, mint, Stake PDA and authority, Treasury, Treasury ATA, Vesting and programs; creates the recipient ATA at the signer's expense when missing; calls `Stake::claim`, then transfers the claimed amount signed by the Treasury PDA. The staked balance is unchanged.
- [Reward accrual](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/stake.rs): `update_rewards` first vests pending ORE into the Treasury ([`Vesting::vest`](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/vesting.rs), linear over one hour), then adds `floor((treasury.rewards_factor − stake.rewards_factor) × balance)` to both `rewards` and `lifetime_rewards`. `claim` pays `min(amount, rewards)`.
- [`Numeric`](https://docs.rs/steel/4.0.9/src/steel/numeric.rs.html) in steel 4.0.9 is `I80F48`: a little-endian `i128` with 48 fractional bits. Multiplying by `from_u64(balance)` is exact, so the app computes `(Δbits × balance) >> 48` in `bigint` with the same floor.

App behavior:

- The list shows "Staking rewards" as recorded plus accrued rewards. It omits ORE still vesting, so it can only understate the payout.
- The instruction requests `u64::MAX`, claiming everything accrued when it executes. Only the signer can lower its own `rewards`, and the factor never decreases, so the executed payout is at least the simulated one.
- The payout is measured on the wallet's own simulated Stake account: `rewards_before + (lifetime_after − lifetime_before)`. Simulation must leave `rewards` at zero, keep `balance` unchanged and not lower `lifetime_rewards`. A fresh-blockhash simulation after approval must not pay less than the reviewed amount.
- `scripts/simulate-ore-stake-claim.mjs` runs this flow unsigned against a public mainnet staker. On 2026-10-08 it simulated 0.05105587728 ORE against an offline estimate of 0.05096520428 ORE (55,049 compute units). A 1 ORE Withdraw for the same staker also simulated successfully after the layout correction.

