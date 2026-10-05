# lifeboat-cli migration plan for React Native

This document records the original ORE migration. The later Kamino migration is
covered in a [separate plan](kamino-mobile-plan.md); statements excluding Kamino
apply only to the earlier stage.

Status as of 2026-10-02: the ORE mobile migration and stages 2–6 are implemented.
The release APK for x86_64/arm64-v8a runs without Metro. Local signing, Claim
SOL/ORE, and external wallets were checked on Android with a local RPC harness,
which does not execute Solana BPF. System file-picker cancellation was deferred
at the user's request; real RPC was not tested because `SOLANA_RPC_URL` is unset.
API 24 is declared as the APK minimum, but no API 24 device is available for testing.

## Migration progress

Working mobile project: `Lifeboat`; source: neighboring `Lifeboat-cli`.
The original CLI is read-only.

- [x] Used the existing Android Expo development build / Hermes scaffold.
- [x] Pinned @solana/kit 7.1.1, quick-crypto 1.1.7, Nitro 0.37.1,
  expo-file-system 57.0.7, and expo-document-picker 57.0.2.
  Native x86_64 build and offline runtime verified on the emulator.
- [x] Copied ProgramInterface, ORE IDL/metadata/manifest, and provenance for
  diagnostics; migrated the full adapter and orchestration in stage 2.
- [x] Added Node reference fixtures for PDA, ClaimSOL/ClaimORE, and a signed
  transaction; checked bigint, UTF-8, base64, Ed25519, and message immutability.
- [x] Implemented a diagnostic screen for writing/reading/deleting a public test
  key in the private directory and picking a test JSON through the system picker.
  Stage 1 accepted only the test key. Stage 3 replaced the main screen with
  arbitrary valid keypair import and RPC rewards viewing.
- [x] Offline tests and TypeScript pass. Tests are included in typecheck.
- [x] Android Hermes bytecode export with JSON import attributes passes;
  regenerated Android through Expo prebuild. This is not an APK build.
- [x] Identified Metro incompatibility with `.js` paths; mobile copies use
  extensionless relative imports.
- [x] Built a debug x86_64 APK on JDK 17.0.12 and Gradle 9.3.1.
- [x] Fixed Nitro/Ninja builds by switching pnpm to `nodeLinker: hoisted`.
- [x] 2026-09-30: x86_64 emulator startup with Hermes; all 12 offline checks
  passed, including private files, Ed25519, and agreement with Node.
- [x] System test JSON selection: successful flow confirmed by the user.
- [ ] File-picker cancellation: untested, deferred at the user's request.
- [x] Agreement with Node confirmed on emulator; user authorized stage 2
  without cancellation testing. Minimum Android API 24 remains untested.

Environment check on 2026-09-29: Android Studio, bundled Java 25.0.3,
Platform-Tools (adb works), Build-Tools 36.0.0, SDK Platform 36, and NDK
27.1.12297006 installed. Gradle 9.3.1 starts with bundled Java 25.0.3.
JAVA_HOME and ANDROID_HOME are set in the build process. Created AVD
Medium_Phone (x86_64, API 37.2). API 24 is the scaffold's declared minimum;
actual native crypto support still needs confirmation. Current build and
verification instructions are in the [development guide](development.md).

Goal: an ORE-only mobile app for viewing rewards, claim SOL, and claim ORE,
using direct Solana RPC access, bundled protocol interfaces, and the same
transaction checks as CLI.

## Accepted decisions

- Platform: Android only.
- Create a clean React Native/Expo project in a separate folder beside
  lifeboat-cli. The source project is strictly read-only during migration.
  Copy required code, fixtures, and tests; do not move or change originals.
- Perform all adaptation, dependency installation, generation, builds, and
  checks in the new project. Do not change source code, documentation, tests,
  configuration, package.json, lockfile, node_modules, or dist in the original;
  create/delete nothing there. Its CLI and Kamino remain unchanged.
  This restriction applies to migration implementation; editing the plan
  itself was separately requested by the user.
- Migrate only required ORE modules and tests. Kamino is outside this plan.
- Working prototype: local signing and a plaintext keypair in the app's private
  directory. Secure storage, biometrics, and unlocking are unnecessary.
- Integrate an external Android wallet after the working prototype (stage 6).
- Minimum import: an existing 64-byte Solana JSON keypair, as in CLI, through
  the system picker. Seed phrases and new permanent wallet creation are
  outside the first version.
- No CLI is needed in the new project: the mobile app replaces the command
  interface. Reuse protocol logic and behavior tests; command and terminal
  output compatibility are unnecessary.

Technology proposal: React Native + TypeScript, Expo development build,
Hermes, existing `@solana/kit`, and ordinary keypair file storage.
Verify compatibility and exact versions in stage 1.

## What to migrate

All actions below apply to file copies in the new project. Source paths
identify which code to copy.

| Project part | Action |
| --- | --- |
| `src/core/program-interface.ts`, accounts, format | Reuse decoding, PDA, checks, and bigint calculations |
| `src/protocols/ore` | Migrate adapter, IDL, metadata, manifest, and ORE provenance |
| `src/protocols/registry.ts` | Copy only ORE adapter creation; omit Kamino imports and the multiprotocol registry |
| `src/core/rpc.ts` | Pass RPC URL explicitly; remove app environment reads and replace Node-dependent codecs |
| `src/core/transaction.ts` | Preserve local signing and execution order |
| `src/core/wallet.ts` | Reuse keypair validation; replace loading with a mobile implementation |
| `src/commands.ts` | Move ORE orchestration into UI functions without terminal formatting |
| ORE tests and applicable core tests | Copy required fixtures and adapt to mobile operations |

Target structure for one mobile app:

```text
src/core/            # RPC, interfaces, checks, transaction lifecycle
src/protocols/ore/   # ORE adapter and bundled JSON
src/operations/      # Operation orchestration, structured results
src/mobile/          # React Native, screens, signing, settings
tests/               # Protocol and mobile behavior tests
```

No shared library between projects or monorepo is needed. Use pnpm and familiar
verification commands in the new project. Protocol core must not contain React,
terminal input, key file loading, or `process.env` reads.

## Stages and acceptance criteria

### 1. Verify mobile runtime and signing

- Create a minimal React Native + TypeScript project with Expo development build.
  Pin compatible versions after checking; the source Solana dependency is
  `@solana/kit` 7.1.1.
- Check Hermes bigint, TextEncoder/Decoder, base64, cryptography, ORE PDA, and
  transaction serialization. Check Metro and static JSON imports with current
  import attributes and TypeScript `.js` paths.
- Check importing and reading a test keypair from plaintext, Ed25519 signing
  through `@solana/kit`, and signature verification without submission.
- Verify message byte preservation during signing and determine the minimum
  supported Android version.

Done when PDA/encoding on the target device match Node fixtures and signing
with a test key works without mainnet submission. Until then, do not migrate
the entire UI or replace the Solana SDK throughout the project.

### 2. Separate operations from CLI and prepare mobile core

**Completed 2026-09-30.**

- [x] Copied required core/ORE modules, fixtures, and tests; CLI unchanged.
- [x] `createOreAdapter()` loads only the ORE bundle and validates provenance metadata.
- [x] RPC URL is explicit; Node.js, Buffer, process.env, and CLI are absent from core.
- [x] `readOreRewards()` needs only an address and returns SOL/ORE, refining fee,
  and available actions.
- [x] `claimSol()` / `claimOre()` return structured results and provide UI action,
  recipient, amount/fee estimates, and simulation results.
- [x] `getSigner()` runs after confirmation. Preserved simulation, size, blockhash,
  preflight submission, and confirmation checks; additionally verify signer
  address, signature, message immutability, and lifetime before submission.
- [x] Missing Miner and zero payout create no transaction; rejection requests no key.
- [x] Migrated/adapted 63 offline tests in 9 files. TypeScript and Hermes export pass.
- [x] Emulator/Hermes passes 13 diagnostics; the entire client module including
  RPC loads, and read-only ORE was checked with an offline reader.

Public UI entry: `src/operations/client.ts`, `createOreClient(rpcUrl)`.
Main tests use fixtures/local HTTP and do not access mainnet. Read-only
integration was migrated separately (`pnpm test:integration`) and was not run
at this stage. No Solana transactions were sent. RPC mocks do not execute BPF.
Full UI, persisting uncertain outcomes before submission, duplicate-press
protection, and background recovery remain in stages 3–4. Neighboring CLI and
Kamino were unchanged.

Original stage requirements:

- Migrate required `src/core` and `src/protocols/ore` parts with tests. Remove
  Node.js dependencies from app runtime; retain Node.js for tools/tests.
  Do not copy Kamino modules or dependencies.
- Separate the reading wallet address from operation signing capability:
  status must not require private key access.
- Replace shared `Buffer` paths with portable codecs or minimal verified
  compatibility. Preserve ORE IDL, metadata, manifest, pinned source, and
  rounding. Read `docs/ore-interface-provenance.md` before migration;
  do not present the reconstructed IDL as official.
- Remove `KeyPairSigner` requirements wherever only an address is needed.
  Execution needs a small callback to obtain a local signer after confirmation;
  add external wallets in stage 6.
- Move command orchestration to `src/operations`, providing structured
  operations, estimates, and simulation results to UI.
- Do not migrate CLI entry point, terminal prompts, flag parsing, `commander`,
  `bin`, or old build configuration. Use the new mobile project configuration.
- Adapt command tests to operation functions while preserving behavior/error
  checks. Terminal output and CLI flag tests are unnecessary.

Done when protocol core loads in the mobile app, passes adapted tests with
existing fixtures, and is independent of CLI.

### 3. Local key, settings, and ORE rewards viewing

Progress as of 2026-09-30:

- [x] Separate 64-byte keypair import with public-part validation; plaintext
  private-directory storage, replacement, deletion, and original-file preservation.
- [x] System picker without a cache copy; own temporary write files are cleaned up.
- [x] Local RPC persistence, hidden URL input, and error messages without secrets.
- [x] Miner / SOL and ORE rewards screen with protocol and network fee estimates.
  Missing fee estimates do not hide successfully read rewards.
- [x] Reset snapshots on setting changes/backgrounding; late responses/timeouts
  cannot restore stale data. UI operation preparation/submission not yet added.
- [x] TypeScript, 79 offline tests, and Android Hermes export.
- [x] x86_64/Hermes emulator: system import, key overwrite, address/RPC recovery
  after force-stop, and UI deletion. Private key file removed, no temporary
  copies remained, and original Downloads JSON preserved.
- [x] Android + local RPC: Miner found, 0.1842 SOL / 0.00000000024 ORE,
  both network fee estimates 0.000005 SOL; missing Miner, unsupported account
  structure, and HTTP 503 displayed correctly.
- [ ] Real Solana RPC reading (the local harness does not establish the
  current on-chain interface).

- Import one keypair with the system picker, validate format/public part, and
  show its address. Read without a cache copy when possible; delete app-created
  temporary copies after processing. Keep the original user file.
- Store the imported keypair as ordinary plaintext in the private app directory;
  support replacement/deletion. Do not add SecureStore, Keystore, encryption,
  or biometrics for the prototype.
- Do not include keys in source, APK, real-data fixtures, or logs. Use only test keys.
- Store RPC URL in local settings and omit RPC secrets from logs.
  Do not add a lifeboat-cli server.
- ORE screen: Miner presence, available SOL/ORE, fee estimate.
- Wallet/RPC changes reset prepared operations. Position status is a snapshot;
  operation availability depends on validation and simulation.

Done when test key import, reading, and deletion work, the app reads ORE state
through configured RPC, and empty, unsupported, and error states display correctly.

### 4. Complete the first operation through the mobile lifecycle

Progress as of 2026-09-30:

- [x] Claim SOL/ORE UI: reread data, full simulation, separate amount/recipient/
  refining fee/network fee screen, explicit “Sign and send” or cancellation.
- [x] Local signing of the same message with signature/blockhash lifetime checks;
  the RPC response must match the locally computed signature.
- [x] Before send, save signature, wallet, action, original RPC, blockhash,
  lastValidBlockHeight, and time. No private key or wire transaction in the journal.
- [x] Restore journal on startup; check status separately without resubmission.
  Missing status remains unknown even after expiry: blockhash expiration alone
  does not prove the operation did not execute earlier.
- [x] Duplicate-press protection, preparation/confirmation cancellation on
  backgrounding, and new-submission blocking for unknown results or corrupt journals.
- [x] Storage errors before submission block send; RPC requests time out after 20 seconds.
- [x] TypeScript, 96 offline tests, and Android Hermes bundle.
- [x] Emulator: cancellation after simulation (0 submissions), locally signed
  Claim SOL/ORE with Ed25519 harness checks, simulation failure without sending,
  and separate display of confirmed transaction errors.
- [x] Emulator: lost response, force-stop, startup journal recovery, saved
  signature check, and confirmation; journal deleted after success.
  Status checking did not increase submissions. The initial HTTP disconnect
  produced 2 requests with the same signature; no new messages/signatures were created.

Real Solana was not used: `SOLANA_RPC_URL` was unset. Read-only integration and
release APK without Metro remain stage 5 tasks.

The local harness starts with `--claims`, accepts only exact Claim SOL/ORE
messages for the public fixture key, and verifies Ed25519. It models RPC,
does not execute BPF, and sends no Solana transactions.

Start with ORE claim SOL, then add claim ORE:

1. Validate programs/accounts and construct the message.
2. Run full simulation and validate its required results.
3. Show action, wallet, amount/fee estimates, and require explicit confirmation.
4. Check blockhash lifetime; sign the same message locally.
5. Verify message immutability, expected signers, and signatures.
6. Submit through configured RPC with preflight; check confirmation.

End the attempt when blockhash expires; a new blockhash requires a new
simulation and confirmation cycle. Rejection sends nothing. Missing Miner or
zero payout creates no transaction.

For claim ORE, preserve refining fee and net payout calculations using bigint,
including existing rounding. SOL has 9 decimals; ORE has 11. The recipient is
the configured wallet; ORE goes to its ATA, created atomically by the program
when needed. Show amounts/fees as estimates. Obtain PDA and instructions from
bundled ProgramInterface.

Handle background/return, duplicate presses, and lost RPC responses. Persist
the signed transaction identifier and minimum checking data before submission
so its RPC status can be checked after restart. Never automatically repeat an
operation with an unknown result.

Done when this lifecycle passes fixture/test-signature checks and mobile UI
distinguishes cancellation, error, waiting, unknown result, and confirmation.

### 5. Verify and build a working ORE prototype

**Implemented 2026-10-02.** 108 offline tests and TypeScript pass; Hermes export
and `assembleRelease` pass. The release APK includes JS and both ABIs and starts
on an API 37.2 emulator without Metro. Rewards, both locally signed operations,
and journal recovery after a lost response were tested with local RPC.
Final `app-release.apk`: 66,264,364 bytes, SHA-256
`88074FED46BE968C4650D2786AFFA16BBAC731927850E2A733E64C1BA0DF5B93`;
Android Debug signature (prototype testing only).
README covers installation, wallets, RPC, builds, and limitations. Native API 24
has not been device-tested; real Solana read-only integration remains conditional
on `SOLANA_RPC_URL`. No test sent a mainnet transaction.

- After code changes: `corepack pnpm test`, `corepack pnpm typecheck`, and
  `corepack pnpm build`; include mobile build/type checks.
- Update behavior tests for core/UI boundaries, key import/deletion, read errors,
  invalid keypairs, message immutability, blockhash expiry, account changes,
  cancellation, missing Miner, zero payout, refining fee rounding, and unknown
  result recovery.
- Main tests require neither network nor a real wallet. Do not present modeled
  RPC as BPF execution. Mainnet tests send nothing.
- With `SOLANA_RPC_URL`, separately run migrated read-only ORE integration.
  Check local signing on Android with test keys without mainnet submission.
- Build an installable Android release APK with bundled IDL/metadata.
  Verify startup without Metro and operations through one RPC.
- Write the new README: installation, RPC configuration, signing, local key
  import/deletion, supported Android versions, and ORE limitations.
  Document mobile flows and migrate ORE provenance.

Done when an installable Android APK provides a working prototype with ORE
status, claim SOL, claim ORE, and local signing.

### 6. Add external wallet integration

**Implemented 2026-10-02.** Used official Solana Mobile Wallet Adapter and
`signTransactions` for `@solana/kit`. Connection and memo signing without
submission, Claim SOL/ORE, rejection, and blocking on account change were checked
on an emulator with Solana Fake Wallet. The app verifies address, message bytes,
and Ed25519, then submits through configured RPC. Expired authorization is
renewed with wallet approval; switching to an external wallet deletes the local
keypair copy. On the local harness, Claim ORE used one simulation, one submission,
and confirmation. Real network and other wallet implementations need device testing.

This stage follows the working ORE prototype and does not block stages 1–5.

- Select/test an Android wallet and compatible adapter, starting with Mobile
  Wallet Adapter for `@solana/kit`.
- Add connection, address retrieval, and signing requests without submission.
  The permanent private key remains in the wallet app.
- Preserve checks → simulation → display/confirmation → signing the same
  message → lifeboat-cli submitting through RPC with preflight → confirmation.
- Verify unchanged returned messages and expected wallet signatures.
- Check rejection, account changes, wallet return, blockhash expiry, and
  compatibility of every supported operation. Do not replace blockhash
  without a new simulation/confirmation cycle.
- Update wallet connection tests and README. Plaintext import is a temporary
  prototype mechanism; switching to an external wallet removes the app's
  stored key copy while keeping the original user file.

Done when supported operations work through an external wallet with the same
transaction checks. Store publication is a separate step.

## First-version scope

Functional goal: ORE status, claim SOL, and claim ORE only.
Kamino, new protocols, ORE mining/checkpointing/staking, arbitrary recipients,
swaps, backend, and automation are outside this migration.
Kamino modules, interfaces, screens, and tests stay in the source project;
preparing mobile architecture for their future migration is unnecessary.
Indexes, remote IDL, and protocol APIs are unnecessary. iOS, secure local key
storage, seed phrases, and multiple permanent keys are outside the plan.
CLI support is unnecessary. Add external wallets after the working prototype.

## Sources for the technology prototype

Checked 2026-09-28; determine exact dependency versions in stage 1.

- [Solana Mobile: React Native installation](https://docs.solanamobile.com/get-started/react-native/installation)
  — `@solana/kit` compatibility and crypto polyfill; MWA dependencies are needed in stage 6.
- [Solana Mobile: MWA sessions](https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly)
  — wallet connection and signing without submission for stage 6.
- [Expo: development builds](https://docs.expo.dev/develop/development-builds/introduction/)
  — builds with custom native dependencies.

### Native build check, 2026-09-29

SDK Platform 36 and NDK 27.1.12297006 were installed and recognized by Gradle.
Gradle additionally installed Build-Tools 35.0.0 and CMake 3.22.1.
The first `assembleDebug` failed with Prefab/CMake on JBR 25.0.3:
`WARNING: A restricted method in java.lang.System has been called`.
With `JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED`, the individual
`react-native-nitro-modules:configureCMakeDebug[x86_64]` task passed.
This established a workaround for one task, not APK readiness.

For a machine with 8 GB RAM, use `--max-workers=2 --no-parallel`,
`-Pkotlin.compiler.execution.strategy=in-process`, and one architecture:
`-PreactNativeArchitectures=x86_64` for the emulator. Phones require their own ABI,
usually `arm64-v8a`. Set `NODE_ENV=development` during builds.
Full APK/runtime verification was not yet complete.

The created `Medium_Phone` AVD (API 37.2) remained adb `offline` when started
in the background; the app was not tested on it. The background instance was stopped.

Retry result: x86_64 `assembleDebug` with native access and limited parallelism
failed with Nitro/Ninja: `manifest 'build.ninja' still dirty after 100 tries`.
CMake reported object paths longer than the safe 250-character limit in `.pnpm`.
Long paths were a candidate cause; a shorter dependency/native-build location
needed investigation. No APK existed yet. All build processes ended; no device
test ran. Latest log: `.cache/android-build-limited.log` (local, excluded from Git).

### Successful JDK 17 build, 2026-09-29

- JDK 17.0.12 found at `C:\Program Files\Java\jdk-17`. Gradle remained 9.3.1.
- Ninja still failed with JDK 17 under the original isolated pnpm layout.
- After `nodeLinker: hoisted`, lockfile installation, and regeneration of Android,
  x86_64 `assembleDebug` passed: 491 tasks, 11 minutes 15 seconds.
  Earlier statements about missing APK describe previous attempts.
- APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 76,368,136 bytes.
  Verified x86_64 Nitro, QuickCrypto, and Hermes libraries inside.
- TypeScript and both offline tests passed after dependency reinstallation.
- Reproduction: `powershell -NoProfile -File scripts/build-android.ps1`.
  ARM64 phones need a separate `-Architecture arm64-v8a` build; that architecture
  was not yet checked.
- This development APK requires Metro. It was not yet installed and Android
  runtime checks had not run. Stage 1 remained open.

### Emulator startup, 2026-09-30

On `emulator-5554`, the app could not connect to Metro's LAN address
(`ENETUNREACH`). Fixed with `adb reverse tcp:8081 tcp:8081` and opening
`exp+lifeboat://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.
After closing the Expo menu, Lifeboat opened with Hermes.
Runtime/private-file diagnostics passed all 12 checks, including Ed25519,
message immutability, and exact signed-transaction agreement with the Node fixture.
No RPC or transaction submission was used.
System JSON selection/cancellation and minimum API 24 were not yet tested in
this run on the newer emulator.