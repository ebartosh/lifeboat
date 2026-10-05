# ore-stake Withdraw interface

Checked 2026-10-02 against official `regolith-labs/ore-stake` commit `7628af733d9338e9560b353ef731a66efe9db3c8` (verified with `git ls-remote` and a shallow checkout at the same SHA). The published [ore-stake-api 0.3.0](https://docs.rs/ore-stake-api/latest/ore_stake_api/) source agrees on the program ID. The deployed binary was not compared to this source commit.

Sources:

- [Program ID](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/lib.rs): `stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH`. This is not the ORE miner program or the older `STkEAu2...` program found in earlier clients.
- [Instruction](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/instruction.rs): `Withdraw = 11`; `Withdraw { amount: [u8; 8] }`. The SDK serializes the amount little endian after the single byte discriminator.
- [SDK builder](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/sdk.rs): account order and flags: signer writable signer; ORE mint readonly; recipient ATA writable; Stake PDA writable; Stake ATA writable; Treasury PDA writable; Vesting PDA writable; System program readonly; SPL Token program readonly; Associated Token program readonly; ore-stake program readonly.
- [PDA seeds and account discriminator](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/mod.rs), [seed bytes](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/consts.rs): Stake `["stake", authority]`, Treasury `["treasury"]`, Vesting `["vesting"]`, under the ore-stake program. Stake discriminator is 108.
- [Stake layout and withdrawal rule](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/api/src/state/stake.rs): `repr(C)` fields `authority: Pubkey`, `balance: u64`, `compound_fee: u64`, `compound_fee_reserve: u64`, `last_claim_at: i64`, `last_deposit_at: i64`, `last_withdraw_at: i64`, `rewards_factor: Numeric`, `rewards: u64`, `lifetime_rewards: u64`. `withdraw` updates rewards and transfers `min(requested, balance)`, reduces Stake balance and Treasury total staked, and updates withdrawal time. The app rejects requests above balance instead of accepting partial execution.
- [Processor](https://github.com/regolith-labs/ore-stake/blob/7628af733d9338e9560b353ef731a66efe9db3c8/program/src/withdraw.rs): verifies signer, mint, Stake PDA and authority, token reserve, singleton accounts and programs; creates the recipient ATA when missing, transfers from Stake ATA, then checks reserves. It does not claim rewards or close Stake.
- [ORE mint and units](https://github.com/regolith-labs/ore-mint/blob/master/api/src/consts.rs): mint `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp`, 11 decimals. UI input is converted using decimal strings and `bigint`.

This path reads only a direct Stake PDA. A liquid staking `stORE` holding is a different position in [ore-lst](https://github.com/regolith-labs/ore-lst) and requires `Unwrap`, not this Withdraw instruction. No live transaction is sent by tests.

