# Kamino Lending migration plan for Lifeboat on Android

Status as of 2026-10-02: implementation stages 1–7 have been added to the mobile project.
The adapter and local interfaces, RPC reading, positions screen, repayment from
ATA and native SOL, collateral withdrawal, and the shared pending-operation
storage mechanism have been migrated. `corepack pnpm test` (151 tests), `typecheck`,
Hermes export, and release APK builds for x86_64/arm64-v8a pass. After a cold AVD
restart, the APK was installed and started without Metro; the Kamino panel
appeared without runtime errors. Live mainnet RPC reading and on-device MWA
signing have not been checked: a suitable endpoint and wallet have not been
configured. Automated tests send no mainnet transactions.

The locally normalized `klend.idl.json` was copied from the neighboring
`Lifeboat-cli`; copy SHA-256:
`86a91e1c53ae11b34376716f4886b30a79cebec538975ba4269f30439eb1d2f4`.
Pinned upstream commits and the original IDL hash are in
[provenance](kamino-interface-provenance.md).

This plan is based on the neighboring `Lifeboat-cli` and mobile `Lifeboat` state
on 2026-10-02. The source is read-only. Implementation and new files belong in
the mobile project.

## Goal and scope

Migrate three CLI user flows: viewing positions (`kamino status`), debt repayment
(`repay`), and collateral withdrawal (`withdraw`). The app uses the user-specified
Solana RPC, bundled interfaces, and selected wallet. It needs neither the Kamino
website/API nor a Lifeboat server.

Keep the current CLI matrix: only the pinned main market, 29 supported reserves,
vanilla obligations with tag 0 and elevation group 0, and classic SPL Token.
Preserve the distinction between acceptable unlisted collateral for repayment
and a fully supported graph for withdrawal. Do not expand markets, tokens, or
position types during migration. A symbol or mint can match several reserves:
resolve selection against the verified position and require explicit reserve
selection when ambiguous.

## Source modules and mapping

| In `Lifeboat-cli` | In the mobile project |
| --- | --- |
| `src/protocols/kamino/{adapter,accounts,state,math,repay,withdraw,native-sol,operation-common,operations}.ts` | `src/protocols/kamino/`; preserve checks, calculations, and instruction construction; adapt runtime and signing |
| `src/protocols/kamino/{klend,support,system,ata}.idl.json`, `metadata.json`, `manifest.json` | Bundle local data in the APK with the same addresses and versions |
| `src/kamino-commands.ts`, `src/kamino-guidance.ts` | `src/operations/kamino.ts`: structured screen/error data without CLI prompts or `--yes` |
| `src/core/{accounts,rpc,transaction}.ts` | Extend existing mobile modules only with required methods and additional signing support |
| `tests/kamino-*.test.ts`, `tests/fixtures/kamino*`, `docs/kamino-*.md` | Migrate applicable tests and public fixtures; keep the matrix and interface provenance beside implementation |

Record the source version/hashes when copying CLI files. Do not use CLI `dist`
or maintenance scripts at app runtime. Convert relative `.js` imports in mobile
copies to Metro-compatible paths. Check Node-dependent code, particularly
`Buffer` in `operation-common.ts`, on Hermes; do not add the Kamino SDK as a
runtime dependency.

## Stages

### 1. Pin the migration contract

1. Compare copied IDL, metadata, manifest, reserve matrix, and provenance with
   the current CLI; record the source revision. Preserve each action's limits
   and rejection reasons, including farm/referrer, Scope, reserve status, and
   the 1232-byte legacy transaction limit.
2. Define mobile models: obligations, supported actions, and unavailability
   reasons; operation requests with `position`, `token`/`mint`, optional
   `reserve`, and amount or `all`; preparation results for confirmation.
   Store amounts as `bigint` and format using mint decimals.
3. Record the network decision explicitly: Kamino requires mainnet RPC.
   Before displaying operations, check `getGenesisHash` or an equivalent
   unambiguous network check; the URL alone is insufficient.

**Done when:** the mobile contract represents the same valid and invalid cases
as the CLI without manually substituting program IDs or accounts.

### 2. Extend RPC and check runtime

1. Add `SolanaRpcClient.getAccounts` using `getMultipleAccounts` with
   `minContextSlot`, filtered `getProgramAccounts` with slot context, and
   `getMinimumBalanceForRentExemption` for temporary WSOL. Preserve one
   configured endpoint, commitment, timeout, encoding, and returned account
   count/order checks.
2. Migrate `LendingReader`/snapshot types. Check mobile RPC slot context and
   requested final accounts from `simulateTransaction`: Kamino validates
   their state after simulation.
3. Adapt `refreshPreview`: CLI takes a fee payer `KeyPairSigner`, but mobile
   preliminary simulation must use a public address and also work with MWA
   without requesting a signature. Validate returned accounts and slot as in CLI.
4. On Hermes, run diagnostics for bundled JSON, obligation/reserve decoding,
   PDA, `bigint`, instruction construction, and transaction encoding.
   Remove only confirmed Node/Metro incompatibilities.

**Done when:** the same public account set decodes identically in CLI and mobile
tests, and Android runtime checks pass in a release APK without Metro.

### 3. Migrate position reading

1. Migrate `KaminoAdapter` and bundled data. Discover wallet obligations with
   filtered `getProgramAccounts`, then reread and validate the complete graph
   in one snapshot with slot and Clock checks.
2. Show positions, debt, collateral, reserve/mint, available actions, and specific
   blocking reasons. A button is not an execution guarantee: balances, prices,
   and network state can change.
3. Reset stale lists on RPC/wallet changes, backgrounding, and confirmed
   operations; guard against late read responses.

**Done when:** `status` shows the same positions and restrictions as CLI on
fixed RPC fixtures; reading requests neither signatures nor submission.

### 4. Repayment from token ATA

1. Migrate `prepareRepay` for supported SPL tokens and `all`, checking required
   borrow legs, selected liquidity mint/vault/ATA, debt farm, and referrer states.
   Use the existing CLI `refreshReservesBatch(skipPriceUpdates=true)` and
   `refreshObligation` path; do not impose Scope or withdrawal-cap checks on repayment.
2. Prepare and simulate the complete atomic message with returned accounts.
   Verify reduced debt and unchanged collateral; require zero remaining selected
   debt for `all`. Before confirmation, show wallet, position, reserve, source,
   expected debit, and fee estimate.
3. Sign exactly the simulated message with a local key or MWA; verify address,
   bytes, and Ed25519. Submit through the same RPC with preflight and check confirmation.

**Done when:** tests reject invalid graphs, insufficient funds, message changes,
and invalid simulation results; the flow passes the Android RPC harness without
actual mainnet submission.

### 5. WSOL debt repayment from native SOL

1. Migrate `fullRepaymentWrap`, interest, rent, and balance checks. Create a new
   temporary WSOL account and include creation, funding, repayment, and closure
   returning the remainder to the same wallet in one message. An existing WSOL
   ATA is unnecessary.
2. Extend `executeSafeTransaction` for known additional local signers. The temporary
   key signs the same unchanged transaction; MWA signs only the wallet's part.
   Verify both signatures and the message before submission. Do not persist the
   temporary key.
3. Preserve CLI preliminary refresh simulation to calculate `all`, then simulate
   the complete message and check SOL debit, debt, temporary account closure, and
   refund/rent estimates. Show those estimates on screen.

**Done when:** local and MWA flows work with two signers, and failure/cancellation
does not leave a submitted partial operation.

### 6. Collateral withdrawal

1. Migrate `prepareWithdraw` with the full supported graph, all Scope spot/TWAP
   component freshness checks, collateral mint/vault/farm, LTV, liquidity, and
   withdrawal cap. Preserve `all`: all selected collateral without debt, or the
   maximum permitted local estimate with debt.
2. Run preliminary refresh simulation followed by complete-message simulation.
   Check final obligation/reserve and recipient ATA; create a missing ATA atomically.
   Withdrawn WSOL remains WSOL.
3. Show receipt estimate, fee, and rent. After repayment, require confirmation
   and a fresh position read before preparing withdrawal.

**Done when:** the screen does not offer withdrawal with a stale oracle or an
invalid complete graph, and full-message checks match CLI.

### 7. Shared mobile lifecycle and release

1. Generalize `ClaimController`/`PendingStore` to protocol-neutral operations or
   add Kamino to their types without creating a second independent submission
   mechanism. Save signature, RPC, wallet, type, position/reserve, and blockhash
   lifetime **before** `sendTransaction`. While the result is unknown, block
   new ORE and Kamino operations and allow saved-signature checks after restart.
   Blockhash expiry does not prove nonexecution.
2. Check background cancellation, return from MWA, wallet/RPC changes, blockhash
   expiry before signing/submission, lost RPC responses, restart, and confirmed
   errors. Reread the position after success.
3. Update README and Kamino documentation with the exact matrix, interface sources,
   restrictions, and `all` behavior. Builds/checks: `corepack pnpm test`,
   `corepack pnpm typecheck`, `corepack pnpm build`, a Hermes release APK, then
   Android testing with local RPC. If mainnet RPC is available, run read-only
   integration separately; automated tests send no real transactions.

**Done when:** all three flows are available in the APK without Metro; network
loss, backgrounding, and restart preserve safe outcome checks; ORE flows and
tests continue working.

## Delivery order

Position viewing can ship after stage 3, and ATA repayment after stage 4.
Enable native SOL and withdrawal only after the corresponding stage 5–6 checks.
Show each intermediate version's restrictions explicitly in the interface.