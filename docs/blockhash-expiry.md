# Phantom Claim ORE blockhash expiry

The October 7, 2026 attempt exhausted its block-height lifetime while waiting for authorization, signing and fee approval. Historical mainnet data shows 176 produced blocks over its 48-second interval, exceeding a fresh 150-block budget. At that observed pace, 150 blocks lasted approximately 40.9 seconds. Lifeboat stopped before submission, after Phantom had returned a valid signed transaction.

## Evidence

The filtered capture `.cache/wallet-diagnostics-2026-10-07T02-02-42-239Z.log` records preparation at device time 07:03:56.550 and expiry detection at 07:04:44.711 (Asia/Yekaterinburg, UTC+5). The historical probe used UTC timestamps 02:03:56–02:04:44.

| Phase | Observed duration |
| --- | --- |
| Establish signing wallet session | 3.068 seconds |
| Reuse rejection and fresh authorization, including persistence | 14.533 seconds |
| Wallet signature request and response | 8.807 seconds |
| Second review of wallet changes and fees | 18.517 seconds |
| Other preparation, first review, validation, RPC and storage | 3.236 seconds |
| Total until expiry detection | 48.161 seconds |

The second review began 29.014 seconds after preparation and was approved at 47.531 seconds. At the measured historical pace, only roughly 12 seconds of a fresh budget would remain at the start of that review. This estimate is not an exact countdown: the original acquisition and check heights were not logged.

Read-only historical block metadata:

| Endpoint | Slot | Block height | Block time UTC |
| --- | --- | --- | --- |
| Start of attempt interval | 454083184 | 432120785 | 2026-10-07 02:03:56 |
| End of attempt interval | 454083360 | 432120961 | 2026-10-07 02:04:44 |

The height difference is 176 blocks over 48 seconds: approximately 273 ms per produced block. Report: `.cache/blockhash-window-2026-10-07T02-19-48-284Z.json`. Block timestamps are estimated and have second resolution; this small uncertainty does not close the 26-block excess over a 150-block budget.

Three current sequential `getLatestBlockhash(confirmed)` / `getBlockHeight(confirmed)` samples also showed 150, 150 and 149 remaining blocks. Height advanced by 42 blocks over 11.143 seconds (approximately 265 ms/block). The sampled endpoint block timestamps independently advanced by 11 seconds over 41 context slots (approximately 268 ms/slot), consistent with that pace rather than a response catch-up artifact. Report: `.cache/blockhash-diagnostics-2026-10-07T02-14-51-778Z.json`. These current samples do not prove the original RPC response was equally fresh, but the historical pace alone explains why even a fresh budget could not cover the observed attempt duration.

## Code checks and implications

`SolanaRpcClient` requests both blockhash and height at `confirmed` commitment. The executor compares block height against `lastValidBlockHeight`, using `>` so the last valid height is still allowed. It does not compare slots with heights or impose a 40/48-second wall-clock timeout. Signature validation and repeated simulation passed; `pre-send-height` then stopped before `sendTransaction` was called. The earlier `pending-save` does not imply RPC submission.

The [Solana expiry guide](https://solana.com/developers/cookbook/transactions/confirmation) describes a block-age window; its 60–90-second approximation is not a guaranteed approval period. The [blockhash RPC](https://solana.com/docs/rpc/http/getlatestblockhash) supplies the actual last valid height, and [block height RPC](https://solana.com/docs/rpc/http/getblockheight) supplies the current height. Use measured heights rather than a fixed seconds assumption.

Phantom's saved-token reuse still returned -1, forcing a 14.5-second authorization flow. Resolving that repeated authorization would provide the largest recoverable margin in this observed attempt. Removing that duration arithmetically would reduce 48.2 seconds to about 33.6 seconds; that is an estimate, not verification that a future attempt will confirm. A root-associated identity host remains a relevant authorization experiment because the current project-page host has no root Digital Asset Links statement. It is not a proven fix for -1.

Expiry prevention must preserve both reviews and the exact signed message. Changing its blockhash invalidates signatures. A renewed attempt requires fresh construction, simulation, fee review and wallet approval; an already signed stale packet cannot simply be refreshed and sent. No expiry check, fee review or signing policy was removed in this investigation, and no transaction was submitted by the probe scripts.

## User-facing expiry recovery

Known expiry before submission now displays: "Transaction expired. Nothing was sent. Prepare it again, then complete wallet approval and the fee review without long pauses. Check the details before approving."

The executor marks only the three pre-submission height checks with a typed expiry error. The controller also recognizes that error inside the unsent-operation wrapper after saving a pending signature. It clears that unsent record before allowing a new preparation. Meteora uses step-specific wording, keeps confirmed checkpoints and instructs the user to resume the withdrawal. An expired signature with an unknown submission result still blocks resubmission and offers status checking; it never shows the faster-approval advice. The message does not promise a fixed number of seconds or bypass careful review, fresh simulation or signing.

## Lifetime refresh after the first review

The first review uses a provisional blockhash for simulation and display only. After approval, the executor requests a new blockhash and, when its `lastValidBlockHeight` is later, rebuilds the same instructions with it. It then repeats the caller's pre-simulation checks, simulation and postcondition validation before the wallet receives the message. The wallet therefore signs a message that was simulated after approval, and time spent on the first review no longer consumes the signing and landing window. In the observed attempt above, the first review was short, so this change does not address the authorization and second-review durations.

This silent re-check adds no review. If the fresh simulation or validation fails, or the network fee exceeds the approved fee, nothing is signed or sent, and the user prepares the operation again. If an RPC node returns an older blockhash, the reviewed lifetime and simulation are kept. Both the wallet-change review and the exact-signed-message rule are unchanged.

## Repeat the read-only probes

```powershell
node scripts/diagnose-blockhash.mjs
node scripts/diagnose-blockhash-window.mjs 2026-10-07T02:03:56Z 2026-10-07T02:04:44Z
```

The current probe prints numeric heights and context slots without the blockhash. The historical probe locates the time interval and requests block metadata with transactions and rewards excluded. Reports contain public numerical metadata only. The historical probe caps requests, spaces them, and retries HTTP 429 with bounded delays; the first faster probe encountered the public RPC's rate limit, then the slower run completed with 30 requests.
