# Orca Whirlpools "Withdraw all" implementation plan

## Context
Lifeboat is an emergency Solana client (Expo/React Native, `@solana/kit` 7.1.1). It currently supports ORE, Kamino Lending and Meteora DLMM. Read `AGENTS.md` first and follow it exactly. In short:
- Reliability comes first and performance second.
- Use direct protocol instructions only. No protocol APIs, indexers, off-chain metadata or runtime SDKs.
- Keep a check only if it stops a transaction that would fail on-chain or would move funds differently from what the user reviewed. Never compare state that other users change.
- All user-facing text and docs are in English.

Orca was chosen as the fourth protocol: about $310M TVL on DefiLlama (2026-10-09), no oracle or keeper dependency, and close to the existing DLMM integration.

## Scope
One action, the Whirlpool equivalent of Meteora's **Withdraw all**. For a selected position owned by the connected wallet:
1. Remove all liquidity.
2. Collect all fees and every initialized reward.
3. Close the position and burn its NFT. The rent goes back to the owner.

Use as few transactions and wallet approvals as fit Solana's limits.

**Out of scope:** swaps, partial withdrawals, fee-only or reward-only actions, withdrawing every position at once, and Orca's other programs.

**Position bundles:** show them as unsupported with an explanation, unless supporting them turns out to be trivial once the main flow works.

## Use Meteora DLMM as the template
Mirror its structure, naming, review data, recovery model and docs:
- Protocol code: `src/protocols/meteora/`. Expect `adapter.ts`, `codec.ts`, `instructions.ts`, `math.ts`, `withdraw.ts`, `token-policy.ts`, a bundled IDL, `manifest.json` and `metadata.json` (IDL SHA-256, checked by a test).
- Operation and recovery: `src/operations/meteora.ts`, plus `src/mobile/MeteoraPanel.tsx` and how `App.tsx` wires `'meteora'` into `Protocol`, refresh, pending-store and resume.
- Docs: `docs/meteora-operations.md`, `docs/meteora-interface-provenance.md`, `docs/meteora-validation.md`.
- Verification: `scripts/verify-meteora-reference.mjs`, `scripts/simulate-meteora-mainnet.mjs`, `scripts/capture-meteora-mainnet.mjs`, plus the `tests/meteora-*.test.ts` files and `tests/fixtures/meteora/`.

Reuse the shared code; don't copy it: `src/core/tokens.ts` (Token-2022 extension policy), `src/core/transaction.ts` (executor), `src/core/wallet-transaction-policy.ts`, ATA creation and the simulation-measured net receipts. If two protocols need the same helper, move it to `src/core` rather than duplicating it.

## Requirements
1. **Pin the interface.** Pin the Whirlpool program ID and a specific `orca-so/whirlpools` commit. Bundle the unmodified IDL and record its source, commit, license and SHA-256. The official SDK may only be installed under an ignored `.cache/` directory, for differential checks. It must never be a runtime dependency. Verify every layout, seed and instruction against the pinned source, not from memory. That includes fixed vs dynamic tick arrays, `*_v2` instructions, and closing a Token-2022 position NFT.
2. **Discovery without `getProgramAccounts` where possible.** Read the wallet's SPL Token and Token-2022 accounts, keep those with amount 1 and decimals 0, and derive the position PDA from each mint. Then check that the position exists, is owned by the Whirlpool program and matches its mint. Unsupported or invalid positions stay visible, with a reason and a disabled action, as Meteora does.
3. **Build the transactions.** Fetch the needed tick arrays, the pool and the reward vaults in as few batched reads as possible. Create recipient ATAs idempotently with the correct token program. If fees and rewards must be refreshed before collecting, confirm that in the source and do it. WSOL stays wrapped.
4. **Slippage minimums on liquidity removal.** Choose `token_min_a` and `token_min_b` by the AGENTS.md test: they must not make a withdrawal fail because of ordinary price movement during review. Document the choice and the reason.
5. **Token-2022.** Use the same allowed extensions as Meteora (`token-policy.ts` / `core/tokens`), with transfer fees subtracted from displayed receipts. Reject transfer hooks and any unlisted extension, with an explanation.
6. **Sizing.** Keep each transaction within the existing 1,100-byte budget and below 1.2M estimated CU. Base the CU estimates on unsigned mainnet simulations and record the measurements in the docs. Transactions stay legacy, with no lookup tables.
7. **Review and simulation checks.** Show the same fields Meteora shows. Simulation must confirm that liquidity is zero and fees/rewards are cleared (or the position is closed) and that no wallet token account decreased. Report the net increase as the receipt. Do not compare pool vault balances or any other state that other users change.
8. **Interruption and recovery.** Follow the Meteora model: checkpoint before sending, an unknown result blocks new steps until resolved, re-read and re-plan after each confirmation, and verify completion by confirming the position account is gone.
9. **UI.** Add an **Orca** protocol tab and panel that match the existing bracket-command UI and `docs/interface-direction.md`. Add preview scenarios to `tests/ui/preview.jsx` and `scripts/check-interface.mjs`: list, loading, empty, error, review, wallet review, partial, unknown, and a Token-2022 transfer-fee case.

## Definition of done
- `pnpm typecheck`, `pnpm test` and `pnpm test:interface` pass.
- New unit tests cover:
  - decoders, using byte-offset fixtures;
  - PDA derivation;
  - instruction bytes and account roles;
  - transaction splitting;
  - Token-2022 receipts;
  - the controller and recovery paths.
- A differential script compares decoders, PDAs, amounts and instruction bytes against the official SDK pinned in `.cache/`, with no network calls.
- An unsigned mainnet simulation script runs against at least one real Whirlpool position (in range, out of range, and with rewards if possible). Signing and submission must be disabled in it. Never send a mainnet transaction.
- Docs are complete:
  - `docs/orca-operations.md`
  - `docs/orca-interface-provenance.md`
  - `docs/orca-validation.md`
  - entries in `docs/README.md` (list this plan under historical migration plans once done)
  - any shared changes in `docs/token-infrastructure.md` and `docs/interface-direction.md`
- If an Android check is needed, follow `docs/development.md` (debug x86_64 with local Metro, no clean rebuilds by default).

## Working rules
- The working tree already contains uncommitted work from another task. Don't revert, reformat or commit it. Leave your changes uncommitted for review unless told otherwise.
- Stop and report instead of guessing if:
  - any part of the flow turns out to need an Orca API or an off-chain service;
  - the pinned source contradicts this plan;
  - a requirement here conflicts with `AGENTS.md`.
- In the final report, list:
  - what is supported and what is excluded, with reasons;
  - the measured CU and byte sizes;
  - every check you added or deliberately left out.
