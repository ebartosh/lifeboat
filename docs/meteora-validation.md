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

## Token-2022 implementation checks — October 7, 2026

The shared token layer and Meteora integration now support extension-free Token-2022 mints and combinations of MetadataPointer, TokenMetadata and TransferFeeConfig. Token accounts admit ImmutableOwner and TransferFeeAmount, consistent with their mint. All other extensions, unknown IDs, active/inactive hooks and the native Token-2022 mint remain excluded. [Token infrastructure](token-infrastructure.md) records the exact policy, source commits and future Kamino requirements; Kamino's runtime support remains classic SPL-only.

| Check | Result |
| --- | --- |
| TypeScript (`node node_modules/typescript/bin/tsc --noEmit`) | Passed |
| Full Vitest suite | 36 files, 340 tests passed, including Kamino and ordinary SPL Meteora regressions |
| Shared token / Meteora Token-2022 cases | Layouts, malformed TLV/metadata, extension rejection, ATA programs/allocation/rent, fee rounding/caps/epochs, mixed and dual-program pairs, both reward indices, missing ATAs, fee/reward/empty positions, spendable versus withheld balances, simulation rejection, restart/unknown-result recovery passed |
| Official SPL Token 0.4.15 / DLMM 1.9.14 differential | 6 mint and 6 account decodes, 2 ATA derivations/instructions, allocation sizes, and 576 fee vectors matched; no network calls |
| Official DLMM differential | 9 scenarios passed, including Token-2022 pool/reward calculations, mint-program selection and instruction bytes/roles; no network calls |
| Browser interface checks | 89 layout/visual cases plus interactions passed, including transfer-fee position/review at 360 px and 1×/1.3×/2× text; no browser runtime errors |
| Live read-only integration | ORE and Meteora: 2 tests passed |
| Unsigned mainnet simulation | Empty-position close passed: 11,776 compute units, slot 454091149; confirmation declined, signing/submission disabled |

Official reference reports are `.cache/token-reference/report.json` and `.cache/meteora-reference/report.json`; browser artifacts are `.cache/interface-check/`, including the scrolled transfer-fee review at 2× text. The restricted shell could run TypeScript/Vitest directly. The existing tsx scripts required normal process access because the restricted shell's `os.userInfo` failed with ENOMEM; the browser harness also used normal process access. No dependency reinstallation, application dependency change, prebuild, clean, cache clearing or APK build was performed.

The new Token-2022 liquidity/fee/reward payouts are verified with fixtures and independent official clients, not live Token-2022 BPF payout simulation. This run's live unsigned simulation covers a close only. No complete withdrawal with real funds, new native Android review, or Token-2022 signing on an external wallet/device was tested. All development mainnet access was read-only or unsigned simulation; no transaction was signed or submitted.

### Live test-candidate follow-up

Read-only candidate discovery on October 7 found a PermissionlessV2 PDA reconstruction bug: `base_key` is the stored preset parameter address, whereas the previous check incorrectly derived a preset from the bin step. The branch was corrected against the pinned SDK. TypeScript, 67 existing focused Meteora tests, 6 captured-pool regressions and the expanded 14-scenario official SDK comparison passed. No interface or native code changed and no APK was rebuilt.

The public pool/mint/reserve captures in `tests/fixtures/meteora/token2022-pools.json` validate SOL/USDC as an SPL control, Agency/SOL with metadata-only Token-2022, SI/SOL and CHONK/SOL with a 1% transfer-fee rate, and MASK/SOL with 3%, at epoch 1051 and slots 454097110–454097114. Fee caps and current schedules are decoded from the mint. These are technical compatibility examples; individual PositionV2 eligibility and unsigned payout simulation still require a position read. No configured rewards were present in these example pools, so they do not test the reward payout path.
