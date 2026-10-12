# Recorded ORE RPC responses

These are unmodified `getAccountInfo` HTTP response bodies from Solana
mainnet-beta, captured through the public `https://api.mainnet-beta.solana.com`
endpoint on 2026-09-27. No credentials or private keys are included.

| File | Account | Captured at (UTC) | Context slot |
| --- | --- | --- | --- |
| `ore-miner.json` | `FXUhkNhtcySRLNgL3PiDN2dU5MzAjvQaauAdAKhaVs7B` | 02:40:04.815 | 450865126 |
| `ore-program.json` | `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv` | 02:40:05.014 | 450865126 |

Both requests used this envelope, replacing `ACCOUNT` with the address above:

```json
{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["ACCOUNT",{"commitment":"confirmed","encoding":"base64"}]}
```

The Miner was discovered in public transaction
`8xK4Ug4ibAJDH1YntLLyGZnMpHRDU6qgxycPTegi5uaMhyYf1SKYXr36nhBw9erogKrA23Spgt3wKDLeLz6GGLN`.
Its authority is `21EiCDdLHKdPw4acJ1HE7hrNuoiLPcFS1hSBHDp2DDKB`.
This is a public account selected as test data, not a project-owned wallet.

## Independent expectations

The test's literal expectations were read directly from the base64-decoded
response using Node's `Buffer.readBigUInt64LE` / `readBigInt64LE`, with offsets
from the pinned Rust `#[repr(C)]` layout documented in
[the interface provenance](../../../docs/ore-interface-provenance.md).
Neither the bundled IDL nor `ProgramInterface.decodeAccount` generated them.
The authority was independently base58-encoded from bytes 8 through 39.

| Field | Byte offset | Captured value |
| --- | --- | --- |
| auto_return | 40 | 1 |
| checkpoint_id | 48 | 419695 |
| checkpoint_fee | 56 | 10000 |
| cumulative[0] | 464 | 117203015 |
| round_id | 664 | 419695 |
| rewards_factor | 672 | `50bc4bf82fdd00000000000000000000` (raw hex) |
| rewards_sol | 688 | 0 |
| refined_ore | 696 | 2511967530 |
| rewards_ore | 704 | 4225994188146 |
| last_claim_ore_at | 712 | 1790417858 |
| last_claim_sol_at | 720 | 1783906629 |
| lifetime_rewards_ore | 728 | 111528149116759 |
| lifetime_deployed | 736 | 7671505108870 |
| lifetime_rewards_sol | 744 | 6906070676749 |

The recorded Miner has zero claimable SOL; the synthetic Miner fixture continues
to cover nonzero rewards and negative signed timestamps.

## Replay and refresh

`tests/ore-rpc.test.ts` serves these bodies over loopback HTTP and exercises the
real RPC client, SDK response processing, base64 conversion, PDA derivation,
program/owner/authority verification, and Miner decoding. Only the JSON-RPC ID
is replaced to match each incoming request. Raw JSON numbers are preserved.
The test runs in the default offline suite without `SOLANA_RPC_URL`.

To refresh deliberately, repeat the requests above and save their raw response
bodies, checking for RPC errors first. Update the timestamps and context slots,
then independently inspect the bytes against the pinned Rust layout and review
any changes to the expected values. Do not generate expectations using the
production decoder or auto-update snapshots to make failures pass.

These fixtures establish compatibility at the captured slot. They do not detect
later on-chain upgrades; the separate opt-in live integration test remains useful.

## ore-stake accounts

`ore-stake.json` is one unmodified `getMultipleAccounts` response body (one context slot for every account),
captured from the same public endpoint on 2026-10-08 at 16:15:51 UTC, context slot 454595494:

```json
{"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[[PROGRAM,STAKE,TREASURY,STAKE_ATA,WALLET_ATA],{"encoding":"base64","commitment":"confirmed"}]}
```

| Index | Account | Role |
| --- | --- | --- |
| 0 | `stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH` | ore-stake program (executable) |
| 1 | `12jrW29HvC2e1sWt9VdeiVHyJsf4pndihiUneurymfpt` | Stake PDA, 120 bytes |
| 2 | `F3ajpARUkbMnYsrbAmgnsjyp991DVbGYRzfaVXy1Dfvu` | Treasury PDA, 32 bytes |
| 3 | `D9X3T2mmGctvLTSe3z9n6YvZ2G59mDi52j2ZtFokyvrP` | Stake ORE ATA |
| 4 | `syAaZaKRQwUwmTU1AHRZFuYV321kPgNZyRh8KotDVSv` | Authority's ORE ATA |

The Stake was found with `getProgramAccounts` filtered to 120-byte accounts. Its authority,
`EfixMV4qZLx7DRdQf8xADMLe5bsKzRZfumf2SfAkZusH`, is a public staker selected as test data, not a
project-owned wallet. Expectations were read with Node `Buffer` reads at offsets from the pinned
`repr(C)` layout and steel 4.0.9's 8-byte discriminator, not with the production parser:

| Field | Byte offset | Captured value |
| --- | --- | --- |
| Stake discriminator | 0..8 | `6c00000000000000` |
| Stake balance | 40 | 7427708297624 |
| Stake rewards_factor (I80F48 bits) | 88 | 14138660205406 |
| Stake rewards | 104 | 511369 |
| Stake lifetime_rewards | 112 | 355700594876 |
| Treasury discriminator | 0..8 | `6800000000000000` |
| Treasury rewards_factor (I80F48 bits) | 8 | 14329134405381 |
| Treasury total_staked | 24 | 27740033973586451 |

Claimable before vesting: `511369 + floor((14329134405381 − 14138660205406) × 7427708297624 / 2^48) = 5026843770`.
