# Phantom signing investigation

Status on October 7, 2026: Phantom returned a signed Claim ORE with the configured project-page URI; end-to-end submission is not yet verified. Token reuse still returned -1, and the attempt stopped before RPC submission because the blockhash expired after the updated-fee review. The October 6 memo refusals remain the no-URI baseline. Jupiter's user-confirmed Claim ORE on October 5 is the working end-to-end comparison.

## Established observations

Samsung SM-A546B, Android 16, Phantom 26.31.1: initial connection succeeded. Reusing authorization invoked legacy `reauthorize` and returned `ERROR_AUTHORIZATION_FAILED` (-1). Fresh authorization succeeded; `sign_transactions` then returned `ERROR_NOT_SIGNED` (-3) in approximately 20–50 ms, without a transaction approval screen. No signature returned and no RPC submission occurred. Persisting renewed authorization before the signature request did not resolve this sequence, including on a repeat without manually reconnecting.

The [legacy MWA specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec1.0.html) defines -3 as a signing refusal for any reason. It does not establish user cancellation. The installed protocol SDK 2.2.9 deliberately maps `authorize` with a saved token to `reauthorize` for a legacy session. Protocol Kit 0.3.2 encodes a compiled Kit transaction as a wire payload for `sign_transactions`. These local implementation checks do not establish Phantom's internal refusal reason.

The [MWA 2.0 specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html) makes `solana:signTransactions` a deprecated optional feature; the legacy specification includes it. `getCapabilities` therefore matters, but SDK normalization adds that feature for legacy sessions. The public `transact` callback does not expose the negotiated protocol version. Do not infer it solely from normalized capability flags; the earlier native `reauthorize-invoked` milestone is separate evidence of the legacy path.

The same specification recommends native identity verification against the developer domain's `/.well-known/assetlinks.json`. The initial no-URI builds had no public project page. The October 7 build uses the real project page described below, while root-domain association remains unavailable. Successful signing with this URI supports investigating identity configuration, but does not establish Digital Asset Links verification or the wallet's internal reason for the earlier -3. See the separate [identity experiment](wallet-identity/README.md).

## Memo comparison

### Project-page URI comparison

On October 7, the user selected `https://ebartosh.github.io/lifeboat/` in the existing repository. The page was published from `gh-pages`, commit `ad1f5a4eb329c7d727e2ad47a592fb2d4d7e6908`, and HTTP 200 was verified for both the page and project-path certificate JSON. Origin-root `https://ebartosh.github.io/.well-known/assetlinks.json` remains HTTP 404. This experiment therefore compares name-only identity with name plus a real project-page URI; it does not verify Digital Asset Links.

The ARM64 comparison APK was built and its v2 signature and embedded URI were verified. Local artifact: `artifacts/lifeboat-project-uri-arm64-2026-10-07.apk`, SHA-256 `E37745DCA0BF2BB0DE4F4D5D4C079E2DFF5816FB748A65CED5BB0B8A2E3C563C`. After waiting on the confirmed Play Protect dialog, installation returned `Success`. The installed APK hash matches this URI comparison build, and Lifeboat startup was verified. The October 6 no-URI failures remain the baseline; no user-approved memo result has yet been captured for the URI build. After updating, connect Phantom freshly once, run the memo check, then repeat without manually reconnecting. Record -1/-3 behavior and approval UI, without submitting the memo.

### Observed Phantom result

The October 7 capture `.cache/wallet-diagnostics-2026-10-07T02-02-42-239Z.log` records a Claim ORE attempt beginning at device log timestamp 07:03:56. The instruction is identified by the pinned ORE IDL's `claimOre` discriminator 4. Legacy `reauthorize` still returned -1; fresh authorization succeeded and was saved. This time `sign_transactions` returned a signed response after about 8.8 seconds, and the adapter completed successfully. The user reported seeing the transaction approval screen and clarified that signing worked but the transaction did not complete.

The signed response expanded from 412 bytes / 11 accounts / 1 instruction to 547 bytes / 13 accounts / 5 instructions. The original Claim ORE instruction was preserved. Added Compute Budget settings were 200,000 units and 375,000 micro-lamports per unit, giving a 75,000-lamport (0.000075 SOL) priority component. Two compact Lighthouse instructions (variants 6/10, three parsed conditions each) followed the operation. The bounded policy, signature checks and repeated simulation/postconditions passed, and the updated-fee review was approved.

At `pre-send-height`, about 48.2 seconds after transaction preparation began, Lifeboat stopped with `reason=blockhash-expired`. No `send-start`, `send-result` or network-confirmation milestone followed. This is an expiry failure before application submission, not a continued wallet signing refusal. The snapshot does not record the remaining block heights at acquisition or review, so it cannot establish whether RPC freshness contributed. Refreshing or changing an already signed message would require new signatures and the appropriate simulation/review; do not bypass expiry checks or submit this stale packet.

The subsequent read-only historical investigation found 176 produced blocks in those 48 seconds, or approximately 273 ms/block. A fresh 150-block budget would cover about 40.9 seconds, shorter than the attempt. Current RPC samples had 149–150 blocks remaining and independently showed approximately 265–268 ms/block/slot. This identifies a block-height budget exhausted by the multi-step approval flow; the exact original initial height remains unrecorded. See [blockhash expiry evidence](blockhash-expiry.md) for the phase durations, historical heights and code checks.

The displayed `ebartosh.github.io` is the host of the configured URI; `/lifeboat/` is its project path. The page title and `identity.name` remain Lifeboat. A different displayed host requires using a different actual identity host; no label spoofing or URL substitution is part of this experiment.

### October 6 no-URI memo baseline

The filtered capture `.cache/wallet-diagnostics-2026-10-06T08-28-01-246Z.log` contains two memo attempts at device log timestamps 13:32:45 and 13:33:07 on October 6. Both fetched a blockhash, established an MWA session, queried capabilities, and invoked legacy `reauthorize`. Reuse returned -1, fresh `authorize` succeeded, the account check passed, and renewed authorization was saved before `sign_transactions`. The signature request then failed with -3: 34 ms after the adapter's `sign-start` in attempt 2, and 460 ms in attempt 4. Neither attempt produced `sign-result` or reached local signature validation. The user reported seeing connection approval rather than transaction approval. The diagnostic path has no RPC submission operation.

Both normalized capability responses were `signTransactions=yes signAndSend=yes legacy=yes v0=yes maxTransactions=10`. Legacy `signTransactions=yes` can be synthesized by the SDK; it is not independent proof that Phantom will sign a particular request. The version flags and one-item request give no indication of an unsupported legacy format or exceeded advertised batch limit. Native `reauthorize-invoked` establishes the legacy authorization path separately.

The refusal also affects a transaction containing only the memo instruction, so an ORE-specific instruction is not necessary to trigger it. This narrows investigation to the common signing/authorization/identity path or Phantom policy, without proving an exact internal cause. Renewed-token persistence is again verified before refusal. Missing domain identity remains a candidate; testing a correctly associated owned domain is still pending. Neither capabilities nor these errors justify silently switching to wallet-owned submission.

### Reproduction procedure

1. Use the October 6 standalone diagnostic installation, or a debug build with local Metro. The earlier October 5 installation does not contain the new control. Follow [development.md](development.md), including synchronization for any separate native dependency changes.
2. Connect Phantom. Open **Wallet details > Wallet signature check**. The control only opens the explanatory dialog; it does not immediately request a signature.
3. Start the filtered capture:

   ```powershell
   node scripts/capture-wallet-logs.mjs RZCW4097DLF
   ```

4. Choose **Sign memo without sending**, approve any wallet prompts yourself, and return to Lifeboat. The check fetches a confirmed mainnet blockhash, builds one legacy memo instruction with the connected account as fee payer, then verifies the returned account signature and unchanged message. It never calls `sendTransaction` or stores a pending operation. No fee is paid.
5. Stop capture after the result. Repeat the memo check without manually reconnecting to compare renewed-token reuse. An authorization prompt may still appear if Phantom rejects reuse.
6. If needed, run the same check with Jupiter on the same phone/build as a signing comparison. Claim ORE need only be retried after reviewing the result and intentionally approving that separate financial operation.

| Result | Interpretation |
| --- | --- |
| Memo also fails in `phase=signing` with -3 before approval | The refusal extends beyond ORE instructions; identity, authorization, wallet policy or common MWA signing behavior remain candidates. |
| Memo succeeds, Claim ORE still fails before approval | Investigate the Claim ORE payload or Phantom's simulation/policy for that operation. |
| Memo returns a transaction but fails in `phase=validation` | Signing occurred, but the returned signature/message failed strict validation. This differs from the previous immediate refusal. Wallet-added instructions are rejected in this diagnostic check. |
| Capability `signTransactions=no` | The normalized response does not advertise the signing method Lifeboat uses. Do not silently switch to wallet-owned submission. |
| Capability discovery fails | The log records only its reason/code; authorization and the existing signature request are still attempted. |
| No new filtered events | Do not infer a wallet result; confirm that the running bundle contains the diagnostic update and capture is active. |

## Safe evidence

`[LifeboatWalletCheck]` records blockhash acquisition, signature request/response, validation and final result. `[LifeboatWalletSign] event=capabilities` records only `signTransactions`, `signAndSend`, `legacy`, `v0` (`yes/no/unknown`) and `maxTransactions` (a nonnegative safe integer or `unknown`). Arbitrary wallet feature/version strings are never printed. Authorization errors retain sanitized numeric codes; native `get_capabilities` messages retain fixed milestones only. Raw errors, tokens, wallet addresses, signatures and transaction payloads are excluded from these additions.

The initial October 6 read-only snapshot contained no wallet attempt events; subsequent live capture supplied the two memo failures described above. The project page was subsequently published on October 7 for the URI comparison above. No external report has been sent and no automatic `signAndSendTransactions` fallback has been added. Wallet-owned submission would require a separate design for validation, actual fees and recovery when the submission result is unknown.
