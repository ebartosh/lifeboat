# Kamino RPC fixtures

`mainnet.json` was captured with read-only `getMultipleAccounts` from Solana mainnet.
Its provenance records the capture timestamp and slot. It contains the main market,
USDC/WSOL reserves, mints and vaults, Scope prices and delegated collateral farms,
Clock and executable program accounts. No wallet keypair was read or stored.
The public example obligation from the pinned SDK was absent and is recorded as null.

Program account payloads are retained as captured; no program binaries are executed.
The offline suite replays the records through a local HTTP JSON-RPC endpoint and
asserts all fetches stay on that endpoint. Runtime input comes from the configured
RPC only. The fixture is public chain data, not a live price source.

`../kamino.ts` adds a synthetic, wallet-owned obligation using independently
specified Rust layout offsets from KLend commit
`a08760976f51a3a58c4a0c6ea27b4a0e565bca79`, plus synthetic wallet token and farm-user
accounts. The signer is the repository's deterministic test signer. Reserve and
oracle schemas and legacy addresses are validated against the captured records.

Operation simulations are modeled responses, not execution of a local KLend BPF
binary. Tests exercise integer planning, roles/order/payloads, recipient checks,
simulation results, signing order, cancellation, expiry, preflight options and RPC
isolation. Positive tests do not assert a real mainnet transaction was submitted.
The opt-in integration tests only read program/market/reserve accounts and Clock.

`inventory.json` is the separate main-market discovery snapshot: 58 reserves,
55 unique mints, 320 public accounts. Its provenance records the discriminator
and market filters, discovery slot, capture time and source commit. Each batch
records its own slot. It is an inventory across banks, not an execution snapshot.
`inventory-review.json` records independent dependency checks and per-operation
compatibility; `docs/kamino-reserve-matrix.md` presents the exclusions. No RPC
endpoint, credentials, wallet or private key is recorded.

`../kamino-inventory.ts` combines those public records with synthetic obligations,
ATAs and required farm users. It normalizes Reserve, Clock and Scope component
slots into the original fixture's modeled bank, retaining recorded prices and
timestamps. The partial/all operation tests model returned results and sign only
with the deterministic test signer. Duplicate-reserve tests add synthetic local
pins temporarily; they do not enable the Hidden USDC reserves in production.

Capture with `node scripts/capture-kamino-inventory.mjs` after building, then
review with `node scripts/bundle-kamino-inventory.mjs`. Both are maintenance-only;
neither is called by the application. The capture falls back to the public
mainnet RPC if `SOLANA_RPC_URL` is unset.

To replace an operation fixture, use only read-only public RPC calls, keep all related accounts
in one final `getMultipleAccounts` snapshot, preserve provenance, and independently
review sizes/owners/links before adjusting assertions. Never include RPC URLs with
credentials or private key material in fixture files.
