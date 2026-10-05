# Building and testing Lifeboat

Run commands in PowerShell from the project root. On this machine, there is no need to locate the JDK and SDK again: the script selects them, checks the JDK and Platform 36, and restores environment variables when it finishes.

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
| Native dependencies, Expo plugins, or native `app.json` settings | `corepack pnpm exec expo prebuild --platform android`, then build the APK. |
| New checkout, missing `android/` | Install dependencies, run prebuild, and build the APK. |
| Generated Android project synchronization error | After identifying the cause, `prebuild --clean` is acceptable; it recreates `android/` and removes manual changes there. |
| Different machine, updated requirements, or tool lookup error | Check the environment using the section below. |

Expo generates `android/`, which is excluded from Git. Keep permanent settings in Expo configuration, plugins, or scripts, rather than only in generated files.

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
corepack pnpm exec expo prebuild --platform android
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Architecture x86_64
```

Alternative tool locations can be passed through `-JavaPath` and `-SdkPath`. The global `java` on PATH does not determine the build JDK: the script sets its own `JAVA_HOME`.

The script limits Gradle to two workers, disables parallel tasks, runs the Kotlin compiler in-process, and limits CMake to two threads. JVM memory: 2048 MiB heap, 1024 MiB metaspace. These settings survive prebuild. A previous build with a 512 MiB metaspace limit produced a memory warning; the successful build used 1024 MiB.

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

```powershell
corepack pnpm typecheck
corepack pnpm test
# For interface changes:
corepack pnpm test:interface
```

Also check the interface on a narrow screen, with 2× text, the keyboard, system insets, and long addresses and amounts. MWA wallet checks require a compatible Android wallet; the [Solana Mobile development wallet](https://docs.solanamobile.com/get-started/development-setup) can be used.

For a wallet that opens without an approval request, return to Lifeboat and record whether its connection message reports session establishment, authorization, or return/account validation. **Connect external wallet** starts a fresh request; signing reuses the saved token. Check approval, rejection, reconnection, and preservation of the previous wallet after cancellation on the actual wallet/device. Unit mocks cannot establish Phantom compatibility. These TS-only connection changes need Metro refresh in debug; a standalone release APK requires rebuilding only when requested.

### Capturing a wallet connection

On October 5, 2026, the user confirmed that battery saver mode prevented wallet connection on their phone. Solflare displayed an error identifying battery saver; Phantom opened without displaying a connection request or explaining the cause. Connection worked after battery saver was disabled. This is a device observation, not a compatibility guarantee for every Android device or wallet version. Check battery saver before reproducing this symptom, and record its state alongside the log. Transaction approval testing is still pending.

Connect the phone over USB with debugging authorized. Identify it using `adb devices`, then run from the project root:

```powershell
node scripts/capture-wallet-logs.mjs PHONE_SERIAL
# Read the existing log buffer without waiting for another attempt:
node scripts/capture-wallet-logs.mjs PHONE_SERIAL --snapshot
```

Keep capture running, open Lifeboat, and choose **Connect external wallet** once. Keep the wallet unlocked. If no prompt appears, wait about 15 seconds and return to Lifeboat; if authorization was sent, its native request timeout can take about 90 seconds. Read the status, then press Ctrl+C in the capture terminal. The script prints the saved `.cache/wallet-diagnostics-*.log` path. It records device/Android and wallet versions, fixed native milestones, and Lifeboat's `trace=v1` events. It does not clear logcat or save raw logs. The native SDK logs full request params, including tokens during signing: use the filtered script rather than sharing an unfiltered logcat capture.

New JS diagnostics require the current code via Metro in debug. An older standalone APK still provides native milestones but will lack `trace=v1` lines; a release rebuild remains an explicit user decision. In Android Studio Logcat, select the phone and query `tag:SolanaMobileWalletAdapterModule | tag:ReactNativeJS`; inspect locally and share the filtered script output.

The same capture supports transaction failures. `[LifeboatWalletSign]` distinguishes wallet session, authorization, account validation, signing, closure, and return. `[LifeboatTransaction]` marks simulation, review, signing, signature validation, blockhash checks, pending record persistence, RPC submission, and confirmation. Failures include only a fixed reason category and stage; custom instruction errors include only the instruction index and numeric code. Raw error messages, simulation logs, addresses, signatures, RPC URLs, and wire transactions are excluded. Wrapped signing/RPC errors retain their original cause in memory so numeric error codes remain diagnosable without recording their payloads.

`sign-transactions-invoked` alone proves a request reached the native wallet adapter, not that the wallet signed it. `signing-result` indicates the core received a signed response; validation still follows. `send-start` means submission was attempted, not accepted. `send-result` means the RPC returned the expected signature, not that confirmation succeeded. Use the app's saved signature and **Check status** for an unknown result; these logs never trigger retries or submission.

On October 5, 2026, a phone Claim ORE attempt passed simulation, returned from wallet signing, and stopped at `signature-validation` with `invalid-signature`; no `send-start` occurred. This identifies the rejection stage, not its root cause. The follow-up `signature-rejected` milestone reports the specific failed check: signer set, message representation/length/bytes, signature representation/length, or Ed25519 verification. The same strict validator is used by the no-submission memo check. A Node test verifies compatibility with the transaction decoder used by the installed MWA Kit wrapper; native-device verification is still required.

The follow-up attempt through Solflare reported `check=message-length`. Ed25519 verification was not reached and Lifeboat did not submit the transaction. `message-shape` diagnostics now compare original/returned lengths, format, account/instruction counts, and Compute Budget instruction counts without recording message contents. A local legacy Claim ORE round trip through web3.js 1.99.0 preserved the message, so that test alone does not explain the device mismatch. Keep rejecting altered messages until their source is identified; do not reinterpret or silently accept a wallet's changes after simulation.

The next device trace confirmed a structural mutation through Solflare 2.29.1: the original legacy Claim ORE message was 412 bytes, 11 accounts, 1 instruction, and no Compute Budget instructions; the returned legacy message was 594 bytes, 13 accounts, 5 instructions, including 2 Compute Budget instructions. The decoder consumed all bytes on both sides, excluding trailing-padding artifacts. This identifies the immediate failure: the wallet signing path returns an expanded transaction rather than the exact simulated message. The two other added instructions were not identified by these filtered structural logs. Do not call them harmless fees without inspecting them. Compare with another MWA wallet using the same account; supporting wallet modifications requires a separate design that validates every added instruction, fees, simulation, and user approval, not removing byte equality checks.

A subsequent Phantom 26.31.1 trace showed failed token reuse, fallback to fresh authorization, then `ERROR_NOT_SIGNED` immediately after `sign_transactions` (about 50 ms, without a signature result). The old broad fallback did not record the token-reuse error code; its precise cause is still unknown. Signing now falls back only on `ERROR_AUTHORIZATION_FAILED` (-1), recognizes both normalized SDK errors and native `JSON_RPC_ERROR/userInfo.jsonRpcErrorCode` errors, and records the sanitized code on `authorize-retry` or `authorize-rejected`. Renewed authorization for the same account is saved before requesting the signature, so a later refusal does not leave the old token on disk. `ERROR_NOT_SIGNED` is classified as `wallet-not-signed`, not proof of user cancellation. No signature request is made if renewal cannot be persisted. These changes need device verification with Phantom; they do not establish why Phantom initially refused reuse or signing.

The next Phantom trace verified the corrected path: reuse returned -1, fresh authorization completed, `authorization-saved` occurred before `sign-start`, and signing still returned -3 about 30 ms later. No signature or submission followed. The trace also included a manual fresh connection before the claim, so it did not yet test reuse of the authorization persisted after the failed signature request. Repeat Claim ORE without choosing Connect/Switch again to test that path. Missing `identity.uri` remains a hypothesis for authorization behavior: the MWA identity-verification guidance recommends declining unverifiable identities, but the current trace does not prove that this is Phantom's refusal reason. Do not add an unrelated or invented app website as a workaround.

Repeating the claim without another manual connection also returned -1 on reuse and -3 on signing. Saving renewal therefore did not resolve Phantom's refusal. The user reported that Phantom marks Lifeboat as unreliable and confirmed that no project HTTPS site exists. An identity-verification experiment is prepared in [wallet-identity/README.md](wallet-identity/README.md): optional `EXPO_PUBLIC_WALLET_IDENTITY_URI`, a project-page draft, and the current APK certificate association. No URI has been set, no page has been published, and no APK has been rebuilt for this option. Missing domain identity is a plausible hypothesis; the warning and numeric error codes do not establish Phantom's exact refusal reason.

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

The normal suite includes independent position/bin byte fixtures, captured public mainnet pool accounts, calculations, strict simulation postconditions, sequential local test-key signing, MWA handoff mocks, and durable restart/unknown-result tests. `pnpm test:interface` includes Meteora positions, restrictions, review, partial progress and unknown-result states at 360 px and 1×/1.3×/2× text. Artifacts are in `.cache/interface-check/`.

Optional SDK differential verification (isolated reference install; no application dependency changes):

```powershell
npm.cmd install --prefix .cache/meteora-reference --ignore-scripts --no-audit --no-fund @meteora-ag/dlmm@1.9.14
node --import tsx scripts/verify-meteora-reference.mjs
```

The report is `.cache/meteora-reference/report.json`. Compare again when the bundled protocol source or codec/instruction logic changes, rather than reinstalling it for every Android build.

Read-only mainnet account capture and unsigned simulation:

```powershell
node --import tsx scripts/capture-meteora-mainnet.mjs
node --import tsx scripts/simulate-meteora-mainnet.mjs
```

Capture updates `tests/fixtures/meteora/mainnet.json`; simulation writes `.cache/meteora-mainnet-simulation.json`. The simulation helper has no signing material, declines confirmation and disables submission. A public position may be empty, locked, unsupported or insufficiently funded for the simulated network fee; inspect the report instead of funding it. Simulation can return a closed position as an empty zero-lamport system account, so both that exact tombstone and `null` are recognized.

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

Meteora is TS/JS only and needs no native dependency changes, prebuild or APK rebuild. Native checks on October 5, 2026 use the existing debug x86_64 APK and local Metro; no production build or real mainnet submission is required.

When rebuilding already verified code without changes, checking the build output, installation, and startup is sufficient. Repeat the full test suite for changes or new reasons to verify.

## Release and production: only on explicit request

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Release -Architecture all
```

APK: `android/app/build/outputs/apk/release/app-release.apk`. `all` includes x86_64 and arm64-v8a; a physical Android device usually needs `-Architecture arm64-v8a`. Release includes JS/Hermes and local ORE/Kamino IDL and metadata, and does not need Metro. The current Expo template signs release with a test debug key: this build is for prototype testing; publication requires separate signing configuration.

On October 5, 2026, an explicitly requested ARM64 release with wallet/transaction diagnostics built successfully in 4m 54s using existing Gradle caches. APK v2 signature verification passed. `adb install -r` updated the Samsung SM-A546B on Android 16 and retained application data. Installation initially waited for Google Play verification while the phone was locked; it completed after the user confirmed Play Protect. If a committed installation remains pending, inspect the phone for that prompt before retrying installation. Lifeboat's launch was verified; this does not establish successful transaction signing or confirmation.

`corepack pnpm build` performs an Expo production export for Android, rather than building an APK. It is unnecessary for normal emulator testing.

The current RPC is `https://api.mainnet.solana.com`; no API key is required. `EXPO_PUBLIC_HELIUS_API_KEY` is reserved for future Helius selection and is unused by the current default RPC. `EXPO_PUBLIC_` values are embedded in the app and can be extracted. Public RPC rate limits are suitable for a prototype; production configuration requires a separate decision.
