# Solflare compatibility and device checks

## Supported wallet additions

The shared transaction executor preserves exact-message signing by default. For an external wallet returning a changed legacy transaction, `wallet-transaction-policy.ts` permits only:

- The same fee payer, recent blockhash, signer order and signer/writable roles for every original account.
- The same non-Compute-Budget instructions, data, ordered account addresses and execution order, each occurring once in its original position relative to the other operation instructions.
- At most one valid `SetComputeUnitLimit` (1..1,400,000 units) and one `SetComputeUnitPrice`, with an explicit limit when a price is present. Existing limit/price instructions may be replaced; other Compute Budget variants are rejected.
- A priority-fee component no greater than 200,000 lamports (0.0002 SOL), calculated with integer ceiling. This is a per-transaction priority cap, not a cap on the original operation's amount or rent. It accommodates the app's existing 1,400,000-unit plans at the observed 100,000-micro-lamport unit price; the actual fee still requires user approval.
- At most eight Lighthouse postcondition instructions, strictly variants 6 (`AssertAccountInfoMulti`) and 10 (`AssertTokenAccountMulti`), after all original operation instructions. Each must target exactly one original account and have a fully decoded payload with 1..16 recognized assertions. Bounds, enum tags, option flags, operators and complete byte consumption are checked. Legacy Borsh u32 and canonical compact vector lengths are supported; unsupported payloads fail closed.
- Only the Compute Budget and Lighthouse program accounts may be added, as read-only non-signers. Added transfers, approvals, memo instructions, memory writes, unfamiliar programs, new target accounts, altered operation arguments/recipients, missing/duplicated/reordered operation instructions and oversized wire packets are rejected.

The Lighthouse decoder uses the public layouts at commit `4c579479c98635e419b1b167f08be02a71604a71` of [Jac0xb/lighthouse](https://github.com/Jac0xb/lighthouse/tree/4c579479c98635e419b1b167f08be02a71604a71). A read-only mainnet RPC check on October 5, 2026 found the expected executable program, ProgramData `CJ5WEjifs4d77pEA9DpewppByFjHcAkNv3YYSuSoDk7c`, deployment slot `294179293`, and no upgrade authority. This checks immutability metadata, not reproducible binary/source verification or a security audit. Support trusts that fixed mainnet program's documented read-only assertion semantics.

For a permitted modified response, Lifeboat re-signs only its configured temporary accounts (needed when a wallet change invalidates a pre-signature), verifies every required Ed25519 signature over the returned message, repeats the pre-simulation checks and RPC simulation, and repeats the operation's simulation postconditions. It obtains the signed message's network-fee estimate and rejects missing, negative or lower-than-priority estimates. A second application review shows the actual fee and priority component, with **Send transaction** instead of asking the wallet to sign again. Cancellation sends nothing. Original blockhash expiry checks, durable pending identity, exact RPC signature comparison and unknown-result recovery remain in effect.

The no-submission memo check remains strict. The policy is shared by compatible external-wallet responses; it does not depend on an unverified wallet brand label. Supporting future additions requires decoding them and extending the policy explicitly. A signed packet that exceeds Solana's 1232-byte limit remains unsupported; adding protection checks does not waive that limit.

## Automated and device matrix

On October 7, a user-triggered Phantom 26.31.1 Claim ORE with Lifeboat's project-page identity URI returned a modified response accepted by this shared policy: Compute Budget limit 200,000, price 375,000 micro-lamports/unit, and two compact Lighthouse 6/10 assertions with three conditions each. Signature validation and repeat simulation/postconditions passed, followed by updated-fee approval. The executor stopped at `pre-send-height` because the original blockhash expired; no RPC send occurred. This verifies the tested Phantom signing/validation path, not network-confirmed Claim ORE or Solflare compatibility. See [Phantom device evidence](phantom-validation.md#observed-phantom-result).

Automated tests below use real application instruction builders, local cryptographic signatures and modeled wallet additions/RPC state. They do not run the Solflare binary or execute protocol BPF. Device results must be recorded separately after user-approved attempts; do not infer wallet compatibility from mocks.

| Operation | Automated coverage | Solflare device result after compatibility update |
| --- | --- | --- |
| Claim ORE | Real instruction; modified-message validation, signatures, simulation and fee review | Pending; old build rejected appended Compute Budget + Lighthouse 6/10 |
| Claim SOL | Real instruction and modified-message execution | Pending; the October 6 user's zero recorded balance hid eligible pending round rewards, requiring separate Checkpoint support before that payout can be tested |
| Unstake ORE | Real withdrawal instruction, amount/account preservation | Pending |
| Kamino withdraw | Real prepared plan and modified-message execution | Pending |
| Kamino repay tokens | Real prepared plan and modified-message execution | Pending |
| Kamino repay SOL | Real wrapping plan, preserved temporary signer and renewed temporary signature | Pending |
| Meteora withdraw all: remove | Fixture execution with fresh protocol postconditions and both reviews | Pending |
| Meteora withdraw all: fees | Fixture execution with fresh protocol postconditions and both reviews | Pending |
| Meteora withdraw all: rewards | Fixture execution with fresh protocol postconditions and both reviews | Pending |
| Meteora withdraw all: close | Fixture execution with final-state validation and both reviews | Pending |

Device sequence: Claim ORE, Claim SOL, a user-selected Unstake ORE amount, user-selected Kamino withdraw and repay amounts (including native SOL if available), then a user-selected Meteora position's Withdraw all. The user chooses positions/amounts and approves wallet signatures and updated fee reviews. Capture each operation separately with the filtered helper; record wallet version, added instruction kinds and parsed assertion fields, whether updated-message simulation passed, and network confirmation or the exact failure stage. For Meteora, record every step and any partial result. New wallet additions remain blocked and diagnosed before submission. Do not retry an unknown submission; check its saved signature first.
