# Meteora DAMM v2 validation

Recorded October 11, 2026, for the code described in [DAMM v2 operations](meteora-damm-operations.md). No mainnet transaction was signed or sent. The device test with an external wallet (plan milestone 6) is still to be done.

| Check | Result |
| --- | --- |
| Type check (`tsc --noEmit`) | Passed |
| Unit and fixture tests (`vitest run`) | 44 files, 492 tests passed; DAMM v2 adds 39 in `tests/meteora-damm-protocol.test.ts` and `tests/meteora-damm-controller.test.ts` |
| Official SDK comparison (`scripts/verify-meteora-damm-reference.mjs`) | 14 checks passed, no network calls |
| Unsigned mainnet simulation (`scripts/simulate-meteora-damm-mainnet.mjs`) | 8 live positions in 9 state categories passed |
| Browser interface (`node scripts/check-interface.mjs`) | 155 layout/visual cases plus interactions passed, including 21 DAMM v2 cases at 360 px and 1×/1.3×/2× text |
| Android JS bundle (`expo export --platform android`) | Hermes bundle built (4.9 MB) and contains the DAMM v2 program ID, action and labels; no APK was built, since the change is TS/JS only |

The `typecheck`, `test` and `test:interface` scripts were run through their Node entry points, as recorded in [development.md](development.md).

## Unit and fixture tests

`tests/fixtures/meteora-damm.ts` builds pools, positions, vesting accounts, mints and token accounts from byte offsets taken independently from the pinned Rust layouts, and models each instruction's account changes during simulation and submission. The tests cover:

- the bundled IDL hash, program ID, account and instruction discriminators, PDAs (position, NFT account, event and pool authority), instruction data and account roles;
- decoding of eight captured mainnet positions with their pools and vesting accounts (`tests/fixtures/meteora-damm/mainnet.json`), cross-checked against the independent offsets, and rejection of wrong owners, discriminators and lengths;
- removal amounts for concentrated and compounding pools, fee and reward accrual, and vesting release;
- discovery from the NFT's program account, an ATA or any other token account (one extra lookup only in the last case), and unavailable rows;
- plans and measured receipts for unlocked, inner and separate vesting (in progress and complete), permanent locks, frozen reward vaults, settled rewards, transfer fees, missing ATAs, dust, a frozen NFT account, pre-activation pools and transfer hooks;
- rejection of a simulation that leaves the position open or reduces a wallet balance;
- the controller: review contents, the pending signature saved before sending, cancellation, a refused position with nothing sent, restart into an unknown result resolved by **Check status**, and pending-record validation.

## Official SDK comparison

`@meteora-ag/cp-amm-sdk` 1.5.1 is installed only under `.cache/meteora-damm-reference`. The script checks that the SDK's IDL equals the bundled one, then:

- for each captured mainnet position, decodes the position, pool and vesting accounts with the SDK's Anchor coder and compares every field Lifeboat reads; compares the position and NFT-account PDAs; and compares fees and rewards (`getUnClaimLpFee` at the capture time), removal amounts (`getAmountAFromLiquidityDelta`, `getAmountBFromLiquidityDelta`) and vesting release (`getAvailableVestingLiquidity`);
- for six fixture scenarios (plain, two rewards with a frozen vault, Token-2022 transfer fee with missing ATAs, two separate vesting accounts, permanent lock, compounding pool with the NFT in an ATA), rebuilds every DAMM v2 instruction with the SDK's `program.methods` and compares data bytes and account metas.

## Unsigned mainnet simulation

The script samples pools with an initialized reward, compounding pools and pools of the Token-2022 transfer-fee mints PYUSD and BERN, positions with separate vesting accounts and positions with rare inner-vesting schedules. For each position it finds the NFT holder, prepares Withdraw all for that wallet and runs the shared executor with signing and submission disabled, stopping at review. Public RPC, October 11, 2026:

| Categories | Position | Actions | Compute units | Bytes | Closes |
| --- | --- | --- | --- | --- | --- |
| unlocked, transfer fee | `2PPG…5MjE` | fees, remove, close | 73,018 | 711 | yes |
| unlocked, rewards | `2eEy…5oAa` | fees, remove, reward 0, close | 94,082 | 873 | yes |
| separate vesting complete | `3BTN…MdDp` | refresh, fees, remove, close | 94,394 | 875 | yes |
| unlocked, compounding | `5F4V…TLrD` | fees, remove, close | 68,728 | 743 | yes |
| permanent lock, rewards | `6EfM…xeo6` | fees, remove, reward 0 | 59,980 | 714 | no |
| separate vesting in progress, permanent lock | `7UCV…vJuL` | refresh, fees, remove | 62,811 | 780 | no |
| inner vesting in progress | `8MAi…xf9M` | fees, remove | 62,671 | 764 | no |
| no liquidity, compounding | `FB8N…K59T` | fees, close | 50,212 | 775 | yes |

All 75 sampled candidates produced a passing simulation or were skipped because their category had already passed; none failed. The largest transaction uses 875 of the 1,100-byte budget, which leaves room for a wallet's Compute Budget price and guards, and under 100,000 compute units. Measured receipts matched the pre-review estimates, except that rewards still accruing grew by the seconds between read and simulation. The transfer-fee position paid a withheld fee of about 2.7 % on one token, reported separately.

Not observed live: a frozen reward vault, a pool before its activation point, inner vesting that has completed but not been refreshed, dust liquidity and a frozen NFT account. Fixtures cover them.

## Limits

Fixtures model account transitions; they do not execute the BPF program. The SDK comparison checks Lifeboat against Meteora's own TypeScript, not against the program. Simulation shows that the deployed program accepts the transactions for the sampled wallets; it does not establish that a particular external wallet signs them. That is the device test.

Artifacts: `.cache/meteora-damm-reference/report.json`, `.cache/meteora-damm-mainnet-simulation.json`, `.cache/interface-check/`.
