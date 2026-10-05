# Meteora verification record

Verified on October 5, 2026 with the environment in [development.md](development.md). This record describes the implementation checks rather than a signed withdrawal of real funds.

| Check | Result |
| --- | --- |
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm test` | 27 files, 213 tests passed; includes existing ORE/Kamino checks |
| `corepack pnpm test:interface` | 58 layout cases plus interactions passed; browser runtime errors: none |
| `SOLANA_RPC_URL` + `corepack pnpm test:integration` | ORE and Meteora read-only tests passed |
| Official SDK differential script | 7 scenarios passed; no network calls |
| Public mainnet account capture | Program, pool, SPL mints and reserves validated; slot 453538613 |
| Unsigned live fee-claim simulation | Passed; 45,507 compute units; recipient increments matched reserve decrements |
| Unsigned live empty-position close simulation | Passed; 11,776 compute units; exact system-owned zero-lamport tombstone recognized |
| Android debug x86_64 / existing APK / local Metro | Live empty state; fixture position and review; recipient, receipt/rent/fee/step details; WSOL notice; cancellation and restart recovery observed |
| Android 2× text | Restored incomplete-operation dialog rendered with wrapping addresses and text; browser harness separately verifies all review/recovery controls at 2× |

The live simulations were declined before signing; the helper disables submission. The native fixture server recorded one simulation and zero submissions. Its submission endpoint is always disabled and it never forwards requests. The emulator's original font scale was restored to 1.0, the unsigned test checkpoint was removed after its operation identifier and empty completed-step list were checked, and the temporary fixture/Metro servers were stopped. Wallet data was preserved. There was no native rebuild, clean, cache clearing or dependency reinstallation for Android.

Artifacts are in `.cache/interface-check/`, `.cache/meteora-reference/report.json`, `.cache/meteora-mainnet-simulation.json` and `.cache/meteora-android-*.png`. The committed capture includes its source, slot and timestamp in `tests/fixtures/meteora/mainnet.json`. Refreshing the unsigned simulation report replaces it with the latest checked public position; earlier fee-claim evidence is recorded in this table.

Simulation and fixtures cannot establish future transaction execution. Local models do not execute Solana BPF. The live checks cover public pool dependencies and unsigned fee/close instructions; liquidity removal and reward instructions are covered by independent fixtures, shared-executor tests and official SDK comparison. The full real-funds multi-transaction sequence was intentionally not submitted. MWA cancellation, foreground handoff and changed-wallet protections pass with test signatures; specific external-wallet/device compatibility remains a device test.
