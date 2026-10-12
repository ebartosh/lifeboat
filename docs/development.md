# Building and testing Lifeboat

Run commands in PowerShell from the project root. On this machine, there is no need to locate the JDK and SDK again: the script selects them, checks the JDK and Platform 36, and restores environment variables when it finishes.

Use the build decision table and current commands below. Dated verification and device-attempt paragraphs are historical records for the stated code/build; their pending results and test counts are not the current test-suite total. Later entries may supersede earlier observations. Current wallet behavior is in [Wallets and RPC](wallet-and-rpc.md), and the [documentation index](README.md) links the focused validation records.

## Normal emulator build

If dependencies are installed and `android/` already exists:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Architecture x86_64
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. This debug APK requires Metro. The first native build takes many minutes; subsequent builds reuse Gradle and CMake caches. Do not run `clean` beforehand.

## When to rebuild

| Change | Action |
| --- | --- |
| TS/JS, styles, or text only | Start Metro; the installed debug APK is sufficient if native dependencies have not changed. |
| `package.json` / lockfile | `corepack pnpm install --frozen-lockfile`; if native dependencies changed, run prebuild and build the APK. |
| Native dependencies, Expo plugins, or native `app.json` settings | `corepack pnpm exec expo prebuild --platform android --no-clean`, then build the APK. |
| New checkout, missing `android/` | Install dependencies, run prebuild, and build the APK. |
| Generated Android project synchronization error | After identifying the cause, `prebuild --clean` is acceptable; it recreates `android/` and removes manual changes there. |
| Different machine, updated requirements, or tool lookup error | Check the environment using the section below. |

Expo generates `android/`, which is excluded from Git. Keep permanent settings in Expo configuration, plugins, or scripts, rather than only in generated files.

Launcher artwork is stored in `assets/icon.png` and `assets/adaptive-icon.png`, referenced by `app.json`. After changing either image, run Android prebuild with `--no-clean --no-install` before the next APK build; Metro alone cannot update an installed launcher icon. On this machine use `node node_modules/expo/bin/cli prebuild --platform android --no-clean --no-install`. The October 9 rope-free logo uses the approved 1254 × 1254 image unchanged for the main icon. Its adaptive version centers a 1046 × 1046 copy on a 1254 × 1254 transparent canvas with 104 px padding, over the configured white background. Prebuild synchronized the existing native project, all 15 generated launcher image dimensions were checked, and circular-mask previews were inspected at 48, 72, and 96 px. No APK was built or installed for this asset change.

With the installed Expo CLI 57.0.27, prebuild defaults to recreating native folders (`clean: !args['--no-clean']` in the local CLI). Use **`--no-clean` explicitly** for ordinary native synchronization. On October 6, the previously documented command without that flag recreated `android/` while removing document-picker, causing extra native recompilation. No Gradle clean or cache-clearing command was issued. The current template's signing certificate remained unchanged.

## Verified environment

On this machine, debug x86_64 was successfully built and installed on the emulator on October 4, 2026:

| Tool | Verified value |
| --- | --- |
| Node.js | 24.13.1; project minimum is 22.13 |
| Package manager | Corepack / pnpm 12.6.0, pinned in `package.json` |
| JDK | 17, `C:\Program Files\Java\jdk-17` |
| Android SDK | `$env:LOCALAPPDATA\Android\Sdk` (`C:\Users\user\AppData\Local\Android\Sdk`) |
| SDK Platform / Build-Tools | 36 / 36.0.0 |
| NDK | 27.1.12297006 |
| Emulator | AVD `Medium_Phone`, ABI x86_64; `emulator-5554` during verification |
| Application ID | `app.lifeboat.mobile` |

Expo, React Native, Solana Kit, and MWA versions are pinned in `package.json` and `pnpm-lock.yaml`. Reassess environment requirements when updating them. On a new machine, install the tools in the table and accept Android SDK licenses. Then:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm exec expo prebuild --platform android --no-clean
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Architecture x86_64
```

Alternative tool locations can be passed through `-JavaPath` and `-SdkPath`. The global `java` on PATH does not determine the build JDK: the script sets its own `JAVA_HOME`.

The script limits Gradle to two workers, disables parallel tasks, runs the Kotlin compiler in-process, and limits CMake to two threads. JVM memory: 2048 MiB heap, 1024 MiB metaspace. These settings survive prebuild. A previous build with a 512 MiB metaspace limit produced a memory warning; the successful build used 1024 MiB.

### Second machine (user `Bartosh-en`)

On October 8, 2026, debug arm64-v8a was built here and installed on a Samsung Galaxy A54 (SM-A546B, serial `RZCW4097DLF`) over USB. The first native build took 21 minutes. Verified tools: Node.js 22.19.0; JDK 17.0.12 at the script's default `C:\Program Files\Java\jdk-17` (Android Studio's bundled JBR is Java 25 and was not used); SDK at the default `%LOCALAPPDATA%\Android\Sdk` with Platforms 36 and 37, Build-Tools 36.0.0, NDK 27.1.12297006, CMake 4.1.2, command-line tools and platform-tools. An x86_64 API 37 AVD exists but testing uses the phone.

Corepack's cached pnpm 12.6.0 is incomplete on this machine (`pnpm.cjs` missing), so `corepack pnpm …` fails. Run installed entry points with Node instead, for example `node node_modules/expo/bin/cli prebuild --platform android --no-clean`.

Both machines sign with the Expo template's `android/app/debug.keystore` (SHA-256 `FA:C6:17:45:…:91:03:3B:9C`) for debug and release, so `adb install -r` updates an app installed from the other machine and keeps its data. The phone does not need USB file-transfer mode; USB debugging works in any USB mode once the computer is authorized.

## Running on the emulator

Start the Android AVD through Android Studio. Start Metro in a separate terminal:

```powershell
node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 8081 --max-workers 2
```

On this Windows machine, `--dns-result-order=ipv4first` is needed for `adb reverse`: without it, Metro listened on IPv6 localhost and the app could not connect. Metro runs only on localhost; LAN access is unnecessary.

In another terminal:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
# If the ID differs, replace emulator-5554 with the value from devices.
& $adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s emulator-5554 reverse tcp:8081 tcp:8081
& $adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'exp+lifeboat://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' -p app.lifeboat.mobile
```

`install -r` updates the app while retaining data. Repeat `adb reverse` after restarting the emulator. After the development client's initial welcome screen, repeat the link-opening command if necessary. JS/TS-only changes do not require APK reinstallation.

If the app cannot connect, first check Metro on port 8081, the device ID, and `adb reverse --list`. For a build failure, start with the specific log error; reinstalling the SDK/JDK or clearing all caches is not the first step.

A debug build that turns black after positions load, with `Do not know how to serialize a BigInt` followed by `Should not already be working` in `ReactNativeJS` logcat, is React 19.2's development performance track calling `JSON.stringify` on a `bigint[]` prop. `src/mobile/polyfills.ts` handles this in development only, for array calls without a replacer. Do not use `BigInt.prototype.toJSON` instead: it runs before `@solana/kit`'s replacer, so RPC requests then fail with `INVALID_PARAMS`. This was verified on the phone on October 12, 2026; release builds use the production renderer and are unaffected.

## Running on a phone from Android Studio

Android Studio can build, install, and launch the app directly on a connected phone:

1. Open the generated `android/` directory as the Android Studio project, not the repository root. Let Gradle sync finish. If `android/` is missing or native configuration changed, use the prebuild steps above first.
2. In **Settings > Build, Execution, Deployment > Build Tools > Gradle**, select the verified JDK 17 at `C:\Program Files\Java\jdk-17` as the Gradle JDK. Studio runs Gradle directly and does not invoke `scripts/build-android.ps1` or its environment setup.
3. Enable developer options and USB debugging on the phone, connect it with a data-capable USB cable, and accept the debugging authorization prompt on the unlocked phone.
4. Select the `app` run configuration and the phone in the device selector. In **Build Variants**, choose `debug` for development or `release` for a standalone app.
5. Click **Run** (the green triangle). Studio builds the selected variant, installs it, and launches it. Use Run rather than Debug for the non-debuggable release variant. The current release signing configuration uses the project's test debug key.

For `debug`, start Metro with the localhost/IPv4 command above. In a terminal, run `adb devices`, then set up the USB connection:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
# Replace PHONE_SERIAL with the phone ID from adb devices.
& $adb -s PHONE_SERIAL reverse tcp:8081 tcp:8081
& $adb -s PHONE_SERIAL shell am start -W -a android.intent.action.VIEW -d 'exp+lifeboat://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' -p app.lifeboat.mobile
```

Keep Metro running while developing. TS/JS changes can then update through Fast Refresh without rebuilding the APK. The `release` variant embeds the JS bundle and does not require Metro or `adb reverse`.

The generated project's default architecture list includes multiple ABIs. For a predictable ARM64-only build with the verified resource limits, the existing PowerShell build script remains available in Studio's terminal; Studio's Run action uses its own Gradle settings. Do not change or regenerate the Android project just to connect a phone.

For connection troubleshooting, see [Android's hardware-device guide](https://developer.android.com/studio/run/device).

## Checking changes

The October 6, 2026 wallet update removes JSON keypair import and local wallet signing. Older app-owned key files are left untouched and are never loaded. Runtime encoding/signature checks and their deterministic signing material now live under test fixtures; the local RPC helper uses that test-only encoding oracle. Temporary Kamino signers remain required for native SOL operations.

The October 6 removal of `expo-document-picker` changed a native dependency. A checkout whose generated Android project still contains it needs dependency synchronization and prebuild with `--no-clean` before the next native build. The requested October 6 diagnostic release already included that synchronization, as recorded below. Do not repeat it when the native project matches the lockfile; use the existing debug x86_64 build script. A release rebuild requires an explicit request.

The removal passed TypeScript, all 274 tests, and 73 browser layout/interaction cases on October 6, 2026, including direct connection, cancelled wallet switching and disconnect. No APK was built or installed for this change. In the restricted shell, pnpm could not open its store operation lock; the installed TypeScript/Vitest entry points were run with Node directly. The interface check required execution outside the restricted shell to bundle and launch the headless browser.

```powershell
corepack pnpm typecheck
corepack pnpm test
# For interface changes:
corepack pnpm test:interface
```

The October 7 header update places wallet connection/details and an icon-only refresh command at the upper right. Wallet switching is inside Wallet details; the network badge, Fonts and license command/dialog, and bottom command bar are removed. TypeScript, five interface asset checks, and 76 browser layout cases plus interaction checks passed, including the real application header at 360 px with 1×, 1.3×, and 2× text, refresh requests, disconnect and cancelled switching. Screenshots and the report are in `.cache/interface-check/`. This is a TS/JS-only change: use Metro with the existing compatible debug APK; no native rebuild, prebuild or clean is needed. No APK was built or installed for this update.

Also check the interface on a narrow screen, with 2× text, the keyboard, system insets, and long addresses and amounts. MWA wallet checks require a compatible Android wallet; the [Solana Mobile development wallet](https://docs.solanamobile.com/get-started/development-setup) can be used.

For a wallet that opens without an approval request, return to Lifeboat and record whether its connection message reports session establishment, authorization, or return/account validation. **Connect wallet** starts a fresh request; signing reuses the saved token. Check approval, rejection, reconnection, and preservation of the previous wallet after cancellation on the actual wallet/device. Unit mocks cannot establish Phantom compatibility. These TS-only connection changes need Metro refresh in debug; a standalone release APK requires rebuilding only when requested.

### Phantom signature diagnostics

The October 7 expiry investigation used read-only `scripts/diagnose-blockhash.mjs` and `scripts/diagnose-blockhash-window.mjs`. Current samples had 149–150 remaining blocks; historical metadata for the failed interval showed 176 produced blocks over 48 seconds (about 273 ms/block). A fresh 150-block budget therefore lasted about 41 seconds during that interval. The public RPC's faster historical query sequence hit HTTP 429; bounded retries and one-second pacing completed the slower run with 30 requests. No transaction contents, signatures, addresses or credentials are saved by these probes, and they never simulate, sign or send transactions. See [blockhash expiry](blockhash-expiry.md) for the reports and phase breakdown. This investigation did not change application execution code, require an APK rebuild, or remove any expiry/fee-review checks.

The first captured October 7 Claim ORE on the URI comparison build returned a Phantom signature and passed bounded wallet-addition validation and repeated simulation. The updated-fee review was approved, then `pre-send-height` stopped with `blockhash-expired` about 48.2 seconds after preparation started. No `send-start` occurred. The earlier -3 signing refusal did not reproduce on this attempt, but token reuse still returned -1. This is progress in signing compatibility, not verified network confirmation; see [Phantom evidence](phantom-validation.md#observed-phantom-result). Block-height freshness at acquisition/review was not recorded, so do not infer the exact expiry cause from elapsed time alone.

On October 7, the user requested a project-page URI experiment in the existing repository. GitHub Pages was published from the isolated `gh-pages` branch (`ad1f5a4eb329c7d727e2ad47a592fb2d4d7e6908`) at `https://ebartosh.github.io/lifeboat/`. The page and project-path JSON returned HTTP 200 without redirects; JSON content type, package and test certificate were verified. Origin-root `/.well-known/assetlinks.json` still returned HTTP 404, so this is not a Digital Asset Links verification experiment. Local `.env.local` configures the page URI for the requested APK comparison. This environment-only change requires no native prebuild, dependency reinstall or cache cleaning. The 28 identity/adapter tests passed; packaging checks must verify the exact URI in the embedded bundle. See [wallet identity](wallet-identity/README.md) for publication and the remaining domain-root requirement.

The memo-check interface and capability logging are TS/JS changes. For these changes alone, use the existing debug APK with Metro when its native dependencies match; no prebuild or clean is needed. If packaging the parallel removal of `expo-document-picker`, follow the native dependency synchronization instructions above. A standalone release must be explicitly requested before rebuilding it; the existing standalone APK does not receive JS changes through Metro.

Open **Wallet details > Wallet signature check**, start the filtered capture helper, then choose **Sign memo without sending** and approve the request yourself. The app requests one legacy memo signature and verifies it locally; neither this check nor the capture helper submits a transaction. Capability discovery records only fixed feature/version flags and numeric request limits. Discovery failure is diagnostic and does not trigger a new connection prompt or select another signing/submission method. The SDK normalizes capabilities, so these flags are not evidence of the exact negotiated protocol version.

Read [Phantom diagnostics](phantom-validation.md) before comparing attempts. On October 6, 2026, TypeScript, 27 focused adapter/check/filter tests, and 73 browser layout/interaction cases passed. The phone was available through ADB, but the initial filtered snapshot contained no wallet attempt events. At that point no new Phantom signing result, identity experiment, APK build or installation had been performed; subsequent requested packaging is recorded below.

### Capturing a wallet connection

The installed October 6 diagnostic release subsequently captured two user-triggered Phantom memo checks. Both returned -1 on legacy token reuse, succeeded in fresh authorization, saved renewal, then returned -3 on `sign_transactions` (34/460 ms after the adapter's signing milestone). Neither returned a signature. Normalized capabilities were `signTransactions=yes signAndSend=yes legacy=yes v0=yes maxTransactions=10`; the SDK synthesizes the signing feature for legacy sessions, so it is not proof of successful method implementation. This reproduces the refusal without an ORE instruction. See [the observed memo result](phantom-validation.md#observed-phantom-result) for the evidence and remaining hypotheses.

On October 5, 2026, the user confirmed that battery saver mode prevented wallet connection on their phone. Solflare displayed an error identifying battery saver; Phantom opened without displaying a connection request or explaining the cause. Connection worked after battery saver was disabled. This is a device observation, not a compatibility guarantee for every Android device or wallet version. Check battery saver before reproducing this symptom, and record its state alongside the log. Transaction approval testing is still pending.

Connect the phone over USB with debugging authorized. Identify it using `adb devices`, then run from the project root:

```powershell
node scripts/capture-wallet-logs.mjs PHONE_SERIAL
# Read the existing log buffer without waiting for another attempt:
node scripts/capture-wallet-logs.mjs PHONE_SERIAL --snapshot
```

Keep capture running, open Lifeboat, and press **Connect wallet** once. Keep the wallet unlocked. If no prompt appears, wait about 15 seconds and return to Lifeboat; if authorization was sent, its native request timeout can take about 90 seconds. Read the status, then press Ctrl+C in the capture terminal. The script prints the saved `.cache/wallet-diagnostics-*.log` path. It records device/Android and wallet versions, fixed native milestones, and Lifeboat's `trace=v1` events. It does not clear logcat or save raw logs. The native SDK logs full request params, including tokens during signing: use the filtered script rather than sharing an unfiltered logcat capture.

New JS diagnostics require the current code via Metro in debug. An older standalone APK still provides native milestones but will lack `trace=v1` lines; a release rebuild remains an explicit user decision. In Android Studio Logcat, select the phone and query `tag:SolanaMobileWalletAdapterModule | tag:ReactNativeJS`; inspect locally and share the filtered script output.

The same capture supports transaction failures. `[LifeboatWalletSign]` distinguishes wallet session, authorization, account validation, signing, closure, and return. `[LifeboatTransaction]` marks simulation, review, signing, signature validation, blockhash checks, pending record persistence, RPC submission, and confirmation. Failures include only a fixed reason category and stage; custom instruction errors include only the instruction index and numeric code. Raw error messages, simulation logs, addresses, signatures, RPC URLs, and wire transactions are excluded. Wrapped signing/RPC errors retain their original cause in memory so numeric error codes remain diagnosable without recording their payloads.

`sign-transactions-invoked` alone proves a request reached the native wallet adapter, not that the wallet signed it. `signing-result` indicates the core received a signed response; validation still follows. `send-start` means submission was attempted, not accepted. `send-result` means the RPC returned the expected signature, not that confirmation succeeded. Use the app's saved signature and **Check status** for an unknown result; these logs never trigger retries or submission.

On October 5, 2026, a phone Claim ORE attempt passed simulation, returned from wallet signing, and stopped at `signature-validation` with `invalid-signature`; no `send-start` occurred. This identifies the rejection stage, not its root cause. The follow-up `signature-rejected` milestone reports the specific failed check: signer set, message representation/length/bytes, signature representation/length, or Ed25519 verification. The same strict validator is used by the no-submission memo check. A Node test verifies compatibility with the transaction decoder used by the installed MWA Kit wrapper; native-device verification is still required.

The follow-up attempt through Solflare reported `check=message-length`. Ed25519 verification was not reached and Lifeboat did not submit the transaction. `message-shape` diagnostics now compare original/returned lengths, format, account/instruction counts, and Compute Budget instruction counts without recording message contents. A local legacy Claim ORE round trip through web3.js 1.99.0 preserved the message, so that test alone does not explain the device mismatch. Keep rejecting altered messages until their source is identified; do not reinterpret or silently accept a wallet's changes after simulation.

The next device trace confirmed a structural mutation through Solflare 2.29.1: the original legacy Claim ORE message was 412 bytes, 11 accounts, 1 instruction, and no Compute Budget instructions; the returned legacy message was 594 bytes, 13 accounts, 5 instructions, including 2 Compute Budget instructions. The decoder consumed all bytes on both sides, excluding trailing-padding artifacts. This identifies the immediate failure: the wallet signing path returns an expanded transaction rather than the exact simulated message. The two other added instructions were not identified by these filtered structural logs. Do not call them harmless fees without inspecting them. Compare with another MWA wallet using the same account; supporting wallet modifications requires a separate design that validates every added instruction, fees, simulation, and user approval, not removing byte equality checks.

The instruction-diagnostic update logs `instruction-detail` only when a wallet response fails message-length or message-bytes validation. It decodes the original and returned legacy/v0 instructions in memory, then records program IDs, known instruction kinds, numeric opcodes, lengths and numeric operands. `compute-limit` values are compute units; `compute-price` values are micro-lamports per compute unit; `system-transfer` values are lamports; token transfer/approval values are raw token units, with decimals in `secondary` for checked variants. System account creation records lamports and space. Memo text, unknown instruction payloads, wallet/account addresses, authorization tokens, signatures and whole transactions remain excluded. Program IDs and decoded numeric operands are explicit additions to the previous structure-only log policy. Account references use `original-N` for the original static-account index or `added-N` for the returned static-account index. They do not identify a recipient's real-world owner or prove that a transfer is a wallet fee.

`originalIndex=N` means an instruction matches original instruction N by resolved program, data, ordered accounts and their signer/writable roles; unresolved lookup-table accounts are never treated as a match. This is a diagnostic comparison, not an acceptance rule, and does not establish ordering or whole-message equivalence. Malformed, oversized, trailing-byte and unsupported v1 messages produce no instruction details. Exact message and signature checks still block submission. Existing captures did not preserve Solflare's signed payload, so a repeated user-approved Claim ORE is required after installing this update. TypeScript and 30 focused instruction/filter/signature/transaction tests passed before rebuilding the diagnostic ARM64 release; no native changes, prebuild or cache cleaning are needed.

This diagnostic ARM64 release built successfully in 2m 7s on October 5, 2026. APK v2 verification passed, and its embedded bundle contains the new instruction-diagnostic markers. SHA-256: `490AC06D8C30FE0D53460CC2B5768F54F13D63DC7EC03A4B9A62800153F0A304`. The phone disconnected from ADB during the build. After the user restored USB, `adb install -r` completed successfully, the installed APK hash matched, and Lifeboat opened. The subsequent user-approved Solflare reproduction was captured as described below. This APK also contains the optional identity-URI configuration, but no project URI has been configured or page published.

The October 5 Solflare reproduction at 20:19:51 returned the same 594-byte/5-instruction structure. Instruction 0 still matched the original ORE Claim ORE by program, instruction data, ordered accounts and signer/writable roles (`originalIndex=0`). Instructions 1 and 2 were `SetComputeUnitLimit(240000)` and `SetComputeUnitPrice(100000)` (micro-lamports per unit), respectively. The calculated priority-fee component is 24,000 lamports (0.000024 SOL), excluding the base fee and any costs of the original operation. Instructions 3 and 4 called `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`, with one account each, discriminators 6/10 and data lengths 26/64. The [Lighthouse generated account-info instruction](https://github.com/Jac0xb/lighthouse/blob/main/clients/js/src/generated/instructions/assertAccountInfoMulti.ts) identifies 6 as `AssertAccountInfoMulti`; the [token-account instruction](https://github.com/Jac0xb/lighthouse/blob/main/clients/js/src/generated/instructions/assertTokenAccountMulti.ts) identifies 10 as `AssertTokenAccountMulti`. These are assertion instruction types, rather than additional transfer instructions. Exact assertion fields/thresholds and target-account references were not recorded by the generic diagnostic version, so they have not been decoded. This is not verification of the deployed program binary or an implemented acceptance policy. Lifeboat still rejected message-length before Ed25519 verification and submission; no `send-start` occurred. Supporting this response should preserve the original operation and validate only the specific assertion variants, targets and payloads, bounded Compute Budget settings, unchanged signer/fee-payer/lifetime context and the actual signed transaction before submission.

A subsequent Phantom 26.31.1 trace showed failed token reuse, fallback to fresh authorization, then `ERROR_NOT_SIGNED` immediately after `sign_transactions` (about 50 ms, without a signature result). The old broad fallback did not record the token-reuse error code; its precise cause is still unknown. Signing now falls back only on `ERROR_AUTHORIZATION_FAILED` (-1), recognizes both normalized SDK errors and native `JSON_RPC_ERROR/userInfo.jsonRpcErrorCode` errors, and records the sanitized code on `authorize-retry` or `authorize-rejected`. Renewed authorization for the same account is saved before requesting the signature, so a later refusal does not leave the old token on disk. `ERROR_NOT_SIGNED` is classified as `wallet-not-signed`, not proof of user cancellation. No signature request is made if renewal cannot be persisted. These changes need device verification with Phantom; they do not establish why Phantom initially refused reuse or signing.

The next Phantom trace verified the corrected path: reuse returned -1, fresh authorization completed, `authorization-saved` occurred before `sign-start`, and signing still returned -3 about 30 ms later. No signature or submission followed. The trace also included a manual fresh connection before the claim, so it did not yet test reuse of the authorization persisted after the failed signature request. Repeat Claim ORE without choosing Connect/Switch again to test that path. Missing `identity.uri` remains a hypothesis for authorization behavior: the MWA identity-verification guidance recommends declining unverifiable identities, but the current trace does not prove that this is Phantom's refusal reason. Do not add an unrelated or invented app website as a workaround.

Repeating the claim without another manual connection also returned -1 on reuse and -3 on signing. Saving renewal therefore did not resolve Phantom's refusal. The user reported that Phantom marks Lifeboat as unreliable and confirmed that no project HTTPS site exists. An identity-verification experiment is prepared in [wallet-identity/README.md](wallet-identity/README.md): optional `EXPO_PUBLIC_WALLET_IDENTITY_URI`, a project-page draft, and the current APK certificate association. No URI has been set, no page has been published, and no APK has been rebuilt for this option. Missing domain identity is a plausible hypothesis; the warning and numeric error codes do not establish Phantom's exact refusal reason.

On October 5, 2026, the user confirmed that Claim ORE initiated in Lifeboat succeeded with Jupiter as the external wallet. The filtered device trace at 17:30 showed successful authorization and signing, followed by unchanged-message and signature validation, RPC submission, and `confirmed` at 17:30:40.445 (7,674 ms from transaction start). Both original and returned messages were legacy, 412 bytes, 11 accounts, 1 instruction, and no Compute Budget instructions. This establishes a working end-to-end path on the tested device/build without a configured identity URI. Jupiter's exact version and whether the account was identical to the earlier wallet tests were not recorded. Keep this as the working comparison for Phantom and Solflare; it does not explain their failures or establish compatibility for other operations.

| Last milestone | Interpretation |
| --- | --- |
| Native `session-start`, followed by `session-timeout` | The wallet launched, but the native MWA association did not complete; JS authorization was not sent. |
| JS `session-ready`, then `authorize-start` / native `authorize-invoked` | The session established and Lifeboat issued authorization; investigate the wallet response and the sanitized failure reason. |
| Native `authorize-invoked` with no JS milestones | JS trace is absent or the APK predates these diagnostics; this alone does not establish a JS failure. |
| JS `authorize-result`, without `session-closed` | Authorization returned, but session cleanup has not completed. |
| JS `foreground-wait`, without `success` | Authorization and session closure completed; check return to Lifeboat and account validation. |
| JS `success` | MWA returned a usable account to the adapter; investigate persistence/UI if the app does not show it. |

Compare one attempt with Phantom and one with Solflare on the same phone and Lifeboat build. Select **Just once** if Android offers a wallet chooser. If Phantom was made the default handler, clear its **Open by default** setting before retrying; the exact setting label varies by Android vendor. Do not clear wallet storage. Success with Solflare narrows the issue to Phantom-specific behavior, but does not prove Lifeboat's request is compatible with every wallet. Failure with both points toward a shared app/device path, with the milestones deciding the next step. Connecting alone sends no Solana transaction.

The main tests use fixtures and local RPC mocks without sending transactions to Solana. Local Android RPC server:

```powershell
node --import tsx scripts/serve-test-rpc.mjs --claims
```

For an external wallet, add `--wallet=<public address>`. The server checks Ed25519 and exact Claim SOL/ORE messages, but does not execute BPF. With `SOLANA_RPC_URL` set, `corepack pnpm test:integration` runs read-only ORE and Meteora checks. It sends no mainnet transactions.

### Meteora verification

The normal suite includes independent position/bin byte fixtures, captured public mainnet pool accounts, calculations, strict simulation postconditions, sequential mocked external-wallet signing, MWA handoff mocks, and durable restart/unknown-result tests. `pnpm test:interface` includes Meteora positions, restrictions, review, partial progress and unknown-result states at 360 px and 1×/1.3×/2× text. Artifacts are in `.cache/interface-check/`.

Optional SDK differential verification (isolated reference install; no application dependency changes):

```powershell
npm.cmd install --prefix .cache/meteora-reference --ignore-scripts --no-audit --no-fund @meteora-ag/dlmm@1.9.14 @solana/spl-token@0.4.15
node --import tsx scripts/verify-meteora-reference.mjs
node --import tsx scripts/verify-token-reference.mjs
```

The reports are `.cache/meteora-reference/report.json` and `.cache/token-reference/report.json`. The reference scripts enforce exact client versions and make no network calls. Compare again when the bundled protocol source or token codec/instruction/fee logic changes, rather than reinstalling it for every Android build. Token-2022 is TS/JS only and adds no native or application dependencies. An existing compatible debug APK receives these changes through Metro without prebuild or an APK rebuild. An installed standalone release embeds its JS bundle and requires a requested rebuild to include them.

Read-only mainnet account capture and unsigned simulation:

```powershell
node --import tsx scripts/capture-meteora-mainnet.mjs
node --import tsx scripts/simulate-meteora-mainnet.mjs
```

Capture updates `tests/fixtures/meteora/mainnet.json`; simulation writes `.cache/meteora-mainnet-simulation.json`. By default it simulates the first prepared transaction of one position in the captured pool. Set `METEORA_POOL` to another pool address and `METEORA_POSITIONS` to the number of positions to simulate; the report records each transaction's actions, size and compute units. The simulation helper has no signing material, declines confirmation and disables submission. A public position may be empty, locked, unsupported or insufficiently funded for the simulated network fee; inspect the report instead of funding it. Simulation can return a closed position as an empty zero-lamport system account, so both that exact tombstone and `null` are recognized.

### Orca verification

The normal suite includes independent Whirlpool/Position/TickArray byte fixtures, recomputed Anchor discriminators, ported math, PDA and instruction checks, transaction splitting, Token-2022 receipts, simulation postconditions, and durable controller/restart tests (`tests/orca-*.test.ts`). `pnpm test:interface` includes the Orca list, restrictions, review notes, partial progress and unknown-result states.

Optional SDK differential verification against the last Apache-2.0 release (see [Orca provenance](orca-interface-provenance.md) for why later releases are not used):

```powershell
npm.cmd install --prefix .cache/orca-reference --ignore-scripts --no-audit --no-fund --save-exact @orca-so/whirlpools-sdk@0.13.16 @orca-so/common-sdk@0.6.10 @coral-xyz/anchor@0.29.0 @solana/web3.js@1.98.0 @solana/spl-token@0.4.12 decimal.js@10.5.0
node --import tsx scripts/verify-orca-reference.mjs
```

The report is `.cache/orca-reference/report.json`; the script checks the exact SDK version and licenses and makes no network calls.

Unsigned mainnet simulation of public positions (read-only; signing and submission disabled):

```powershell
node --import tsx scripts/simulate-orca-mainnet.mjs
```

It discovers positions of `ORCA_POOLS` (comma-separated, default the SOL/USDC 64 and 4 tick-spacing pools) through a filtered `getProgramAccounts`, finds each NFT holder with a mint-filtered token-account scan (the public RPC throttles `getTokenLargestAccounts`), and simulates the first prepared transaction for up to `ORCA_PER_CATEGORY` positions per category (empty, in range, out of range; default 1), checking at most `ORCA_MAX_ATTEMPTS` positions (default 40). `ORCA_DYNAMIC=1` keeps only positions with a tick array outside the pinned fixed format. It retries HTTP 429 with backoff, so a public RPC run takes several minutes; `SOLANA_RPC_URL` selects another RPC. The report is `.cache/orca-mainnet-simulation.json`. A public position may be unsupported or its holder unable to pay the simulated fee; such attempts are recorded, not funded.

Unsigned ORE staking reward claim against a public staker (optionally pass another wallet address):

```powershell
node --import tsx scripts/simulate-ore-stake-claim.mjs
```

It writes `.cache/ore-stake-claim-simulation.json` with the offline estimate and the simulated payout, and fails if the payout is below the estimate. Like the Meteora helper, it has no signing material, declines confirmation and disables submission.

For native review with safe local fixtures, use a public wallet address already connected in the emulator. The fixture server cannot submit transactions and never forwards requests:

```powershell
node --import tsx scripts/serve-meteora-test-rpc.mjs --wallet=PUBLIC_WALLET_ADDRESS
# In a separate PowerShell terminal:
$env:EXPO_PUBLIC_LIFEBOAT_TEST_RPC = 'http://127.0.0.1:8899'
node --dns-result-order=ipv4first node_modules/expo/bin/cli start --dev-client --localhost --port 8081 --max-workers 2
# In the adb terminal:
& $adb -s emulator-5554 reverse tcp:8899 tcp:8899
```

Open the existing debug APK through the normal Metro link. Verify positions, WSOL notice, recipient, estimates, rent, step counts, review scrolling and cancellation. Do not approve a signature as part of this UI check. The test RPC override accepts only localhost HTTP and applies only to development bundles; release always selects the mainnet default. Stop Metro and remove the environment variable before returning to ordinary development:

```powershell
Remove-Item Env:EXPO_PUBLIC_LIFEBOAT_TEST_RPC -ErrorAction SilentlyContinue
```

Meteora (DLMM and DAMM v2) is TS/JS only and needs no native dependency changes or prebuild. The DAMM v2 reference and simulation scripts are `scripts/verify-meteora-damm-reference.mjs` (SDK in the ignored `.cache/meteora-damm-reference`) and `scripts/simulate-meteora-damm-mainnet.mjs` (unsigned; `DAMM_CAPTURE=1` refreshes `tests/fixtures/meteora-damm/mainnet.json`). With a compatible debug APK, use Metro without rebuilding the APK; a standalone release requires a requested rebuild to include JS changes. Native checks on October 5, 2026 use the existing debug x86_64 APK and local Metro; no production build or real mainnet submission is required.

When rebuilding already verified code without changes, checking the build output, installation, and startup is sufficient. Repeat the full test suite for changes or new reasons to verify.

## Repository files and local outputs

Keep source, documentation, Expo configuration, scripts, `pnpm-lock.yaml`, `.env.example`, public interface JSON and deterministic/public test fixtures in Git. `android/` is generated; permanent native settings belong in Expo configuration, plugins or scripts.

The root [`.gitignore`](../.gitignore) excludes dependencies, Expo/pnpm caches, `.cache/` diagnostic reports and screenshots, `dist/` exports, `artifacts/` APK copies, coverage, build logs, JVM heap dumps, local environment files, Android signing keys and IDE state. Device copies named `lifeboat-wallet.json`, `lifeboat-external-wallet.json`, `lifeboat-pending.json`, `lifeboat-meteora-operation.json`, `lifeboat-orca-operation.json` and `lifeboat-rpc.txt`, including staging/backup suffixes, are also excluded. These are private app records, not repository fixtures; external-wallet records contain authorization tokens and legacy wallet files may contain private keys.

Check exclusions from the project root:

```powershell
git status --short --untracked-files=normal
git check-ignore -v .env.local .cache/interface-check/report.json artifacts/example.apk lifeboat-external-wallet.json
git ls-files --cached --ignored --exclude-standard
```

The last command should print nothing: ignore rules do not remove files already tracked by Git. Keep exclusions specific; do not ignore all JSON files or the fixture directories. `.env.example` stays versioned, and `EXPO_PUBLIC_` values are embedded in the app rather than protected by ignoring the local environment file.

## Release and production: only on explicit request

On October 7, 2026, the user requested rebuilding the Token-2022 Meteora update and the corrected PermissionlessV2 pool PDA validation. `scripts/build-android.ps1 -Release -Architecture arm64-v8a` succeeded in 1m 23s (16 tasks executed, 715 up-to-date). No prebuild, dependency reinstall, Gradle clean or manual cache clearing was run. Packaging reuses the verified TypeScript/tests/interface/reference results; the full suite was not repeated for the rebuild. The source map includes the shared token layer and the corrected `base_key` preset seed, and the APK's embedded Hermes bundle exactly matches the verified generated bundle. Token fee/simulation markers and the configured project identity URI are present. APK v2 signature verification passed with the existing certificate; native libraries are ARM64 only. The named artifact is `artifacts/lifeboat-token2022-arm64-2026-10-07.apk` (39,913,268 bytes), SHA-256 `9626F7D53D4AA39952D42B0DDBB5D23766E850FAC9489EE488B6A9DBC5425F71`. `adb install -r` on `RZCW4097DLF` is currently pending the foreground Google Play Protect dialog. ADB was not retried while that installation remains active. Device installation and startup verification remain pending; no financial operation was initiated.

On October 7, 2026, the requested project-page URI comparison built with `scripts/build-android.ps1 -Release -Architecture arm64-v8a` in 2m 44s (16 tasks executed, 715 up-to-date). No prebuild, dependency reinstall or cache cleaning was run for this environment-only change. Expo loaded `.env.local`; both the generated bundle and final APK contain `https://ebartosh.github.io/lifeboat/` and the memo-check markers. APK v2 verification passed. A named copy is saved as `artifacts/lifeboat-project-uri-arm64-2026-10-07.apk`, SHA-256 `E37745DCA0BF2BB0DE4F4D5D4C079E2DFF5816FB748A65CED5BB0B8A2E3C563C`. The phone initially appeared as an unnamed offline ADB transport; `adb reconnect offline` removed that stale transport. After the user reconnected `RZCW4097DLF`, `adb install -r` delivered the APK and waited on the confirmed foreground Play Protect dialog. It subsequently returned `Success`. The installed APK hash matched the project-URI build, and Lifeboat launched with activity status `ok` and a running process (cold start, 328 ms). No duplicate installation was needed; application data was retained. Fresh filtered log capture was started for the user-approved Phantom comparison. Its subsequent signed response and pre-submission expiry are recorded in [Phantom diagnostics](phantom-validation.md#observed-phantom-result). The project page is public, but origin-root association remains HTTP 404, so this APK tests adding a real identity URI rather than verified Digital Asset Links.

On October 6, 2026, the user requested installation of the Phantom diagnostic update. Dependencies were synchronized with `pnpm install --frozen-lockfile` (document-picker removed, no downloads), and Android prebuild ran with `--no-install`. Because the installed Expo CLI defaults to cleaning, that command recreated the generated project; future ordinary synchronization must include `--no-clean` as documented above. `scripts/build-android.ps1 -Release -Architecture arm64-v8a` succeeded in 10m 47s (699 executed tasks, 32 up-to-date). APK v2 verification passed with the unchanged test certificate. The archive contains only ARM64 native libraries and includes **Wallet signature check**, **Sign memo without sending**, `LifeboatWalletCheck`, and `event=capabilities` in its embedded bundle. APK SHA-256: `07327F3D35C513D1CFC15F68896C0798D456AFF19A223231721CBBDE594DD212`. No full test rerun was needed for packaging already verified code. `adb install -r` on `RZCW4097DLF` waited for several minutes, then returned `Success`. After the user reconnected the phone, the installed APK hash matched this build and Lifeboat launched successfully (cold start, activity status `ok`, process present). No duplicate installation was needed. Application data was retained by the update. This verifies packaging, installation and startup; a user-approved Phantom memo signature remains pending.

The Solflare compatibility update is TS/JS only and requires no native prebuild or cleaning. It adds a bounded modified-message policy, parsed Lighthouse assertion diagnostics, repeat simulation/postcondition checks and a second fee review. The existing strict memo check is unchanged. [solflare-validation.md](solflare-validation.md) records the acceptance rules and separate automatic/device matrix. Before packaging, TypeScript, the 273-test full suite and 65 interface cases passed; 62 follow-up focused tests passed after adding unavailable/inconsistent updated-fee checks and repeated simulation hooks. The previously authorized diagnostic ARM64 release rebuilt successfully in 2m 46s. APK v2 verification passed and the bundle contains the repeat-simulation/review markers and **Send transaction** label. SHA-256: `4E3496770DA663F2607A79ECFA035387B172D21DA54A2F904AC39AB961B236D2`. `adb install -r` initially waited while the phone was locked, then completed successfully. The installed APK hash matched on the subsequent check; no duplicate installation was needed. A successful build/install is not a successful Solflare transaction.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Release -Architecture all
```

APK: `android/app/build/outputs/apk/release/app-release.apk`. `all` includes x86_64 and arm64-v8a; a physical Android device usually needs `-Architecture arm64-v8a`. Release includes JS/Hermes and local ORE/Kamino IDL and metadata, and does not need Metro. The current Expo template signs release with a test debug key: this build is for prototype testing; publication requires separate signing configuration.

On October 5, 2026, an explicitly requested ARM64 release with wallet/transaction diagnostics built successfully in 4m 54s using existing Gradle caches. APK v2 signature verification passed. `adb install -r` updated the Samsung SM-A546B on Android 16 and retained application data. Installation initially waited for Google Play verification while the phone was locked; it completed after the user confirmed Play Protect. If a committed installation remains pending, inspect the phone for that prompt before retrying installation. Lifeboat's launch was verified; this does not establish successful transaction signing or confirmation.

`corepack pnpm build` performs an Expo production export for Android, rather than building an APK. It is unnecessary for normal emulator testing.

The current RPC is `https://api.mainnet.solana.com`; no API key is required. `EXPO_PUBLIC_HELIUS_API_KEY` is reserved for future Helius selection and is unused by the current default RPC. `EXPO_PUBLIC_` values are embedded in the app and can be extracted. Public RPC rate limits are suitable for a prototype; production configuration requires a separate decision.

The October 7 expiry-message update is TS/JS only. It recognizes known expiry before submission, explains fresh preparation and approval without long pauses, and preserves unknown-result blocking and Meteora checkpoints. TypeScript, 64 focused transaction/controller tests and 82 interface layout cases with interaction checks passed. The new error and Meteora resume messages were checked at 360 px with 1×, 1.3× and 2× text scaling; the 2× expiry screenshot was visually inspected. These are RN Web preview checks, not native-device verification. This update requires an ordinary JS-inclusive rebuild to appear in the installed APK; no native prebuild, clean or dependency changes are needed. The installed project-URI APK predates this message change. See [blockhash-expiry.md](blockhash-expiry.md) for the diagnosis and recovery rules.
