# Kamino Lending interface provenance

This document was copied from the neighboring `Lifeboat-cli` with the local
interfaces. CLI maintenance commands, test filenames and `--reserve` arguments
below record the original source audit; they are not mobile-project instructions.
Use [Kamino operations](kamino-operations.md) for current mobile behavior and the
[development guide](development.md) for checks and builds.

Verified 2026-09-27. This is a locally normalized subset of the upstream Anchor
IDL, with locally reconstructed support layouts. It is not a new official IDL,
nor a claim that the live upgradeable program's binary equals a particular source
build. RPC account ownership, schema checks and simulation enforce compatibility;
the configured RPC and protocol upgrade authorities remain trust dependencies.

## Pinned inputs

| Input | Version / commit |
| --- | --- |
| [KLend source](https://github.com/Kamino-Finance/klend/tree/a08760976f51a3a58c4a0c6ea27b4a0e565bca79) | `a08760976f51a3a58c4a0c6ea27b4a0e565bca79`, Cargo version `1.25.0`, account version `1` |
| [SDK Anchor IDL](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/idl/klend.json) | `38845294447623f6de3afc9dec29875f959f6f48`, IDL version `1.25.0` |
| Upstream IDL SHA-256 | `0f676a892eb974794e8574ce2dd3ea4bc14c318d78494212d200950049afb340` |
| [Scope types](https://github.com/Kamino-Finance/scope/tree/2fb674083e98ced60fc4df95814358926f28ea46/programs/scope-types/src) | `2fb674083e98ced60fc4df95814358926f28ea46`, from KLend Cargo.lock |
| [Farms state](https://github.com/Kamino-Finance/kfarms/blob/c2141a40216cfa6f4ca2d272fed351d0b0a0b981/programs/kfarms/src/state.rs) | `c2141a40216cfa6f4ca2d272fed351d0b0a0b981`, from KLend Cargo.lock |

Program IDs are pinned in the bundle:

- KLend: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- Scope mainnet: `HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ`
- Farms: `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr`
- Classic SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Associated Token: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`

No Kamino SDK is installed as a runtime dependency. Maintenance scripts read local
checkouts only; runtime imports the JSON shipped in `src/protocols/kamino`.

## Evidence inspected

Paths below refer to the pinned KLend commit:

- `programs/klend/src/lib.rs`: program ID, instruction names, emergency checks.
- `handlers/handler_refresh_reserve.rs`, `handler_refresh_obligation.rs`: reserve
  oracle options, refresh order and remaining-account counts.
- `handlers/handler_repay_obligation_liquidity.rs`: v2 wrapper, liquidity mint,
  destination vault, source token account, optional farms and market authority.
- `handlers/handler_withdraw_obligation_collateral_and_redeem_reserve_collateral.rs`:
  max-LTV path, collateral burn, wallet-owned destination, optional placeholder,
  optional farms and closure of empty obligations.
- `handlers/handler_refresh_obligation_farms_for_reserve.rs` and
  `lending_market/farms_ixs.rs`: farm address, delegatee, user owner and CPI account links.
- `state/obligation.rs`, `state/reserve.rs`, `state/lending_market.rs`,
  `state/token_info.rs`, `state/last_update.rs`, `utils/consts.rs` and `utils/seeds.rs`:
  zero-copy layouts, versions, PDA seeds and restrictions.
- `lending_market/lending_operations.rs`, `withdrawal_cap_operations.rs`,
  `utils/fraction.rs` and `utils/prices/scope.rs`: integer rounding, debt refresh,
  cap reset, max-LTV withdrawal and Scope price semantics.

The main-market and reserve addresses are also present in the pinned SDK's
`examples/utils/constants.ts`. That file's `JUPSOL_RESERVE` label aliases the SOL
reserve, so the label was not trusted: RPC mint data establishes that the reserve
is WSOL. Locally pinned market, reserve, mint and vault addresses are listed in
`metadata.json` and independently exercised by the recorded mainnet fixture.

The two legacy reserves use vault and collateral mint addresses different from
new-reserve PDA seeds in current source. Those addresses are fixed in metadata,
then validated against reserve fields and SPL Token authority/mint data. Only the
market authority, wallet ATA, referrer state and farm user are derived as PDAs.
An SPL collateral mint supply may be lower than KLend's recorded collateral supply
because holders can burn tokens directly. The USDC fixture exhibits this difference.
Redemption calculations use KLend's recorded supply, as its handler does; the
adapter rejects an external mint supply greater than the recorded one.

## Bundled representation

`klend.idl.json` keeps five instructions and the complete account layouts and
transitive struct types of Obligation, Reserve, LendingMarket and ReferrerTokenState.
Names/types from the legacy Anchor IDL are normalized to the local Solana IDL
representation. Nested instruction account groups are flattened without reordering.
Discriminators are the first eight SHA-256 bytes of `global:<snake_case_name>` or
`account:<PascalCaseName>`. Optional missing accounts use the KLend program ID as
Anchor's sentinel, always read-only. Fixed program IDs and PDA declarations are
part of the bundle, not CLI input.

Explicit padding in the upstream zero-copy schemas is preserved. Local `borsh`
layout mode means sequential fields without implicit host alignment; it does not
claim the Rust accounts are Borsh accounts. `u128` is decoded exactly as little-endian
bigint. ORE continues using its C/bytemuck alignment. Account lengths including
the discriminator are Obligation 3344, Reserve 8624, LendingMarket 4664 and
ReferrerTokenState 360 bytes. Discovery's owner offset 64 comes from ProgramInterface,
not an adapter literal. Synthetic tests independently use the pinned Rust offsets.

`support.idl.json` contains Clock (40 bytes), classic SPL Mint (82), TokenAccount
(165), Scope OraclePrices (28712), Farms UserState (920), and FarmState (8336).
Scope uses 512 DatedPrice records of 56 bytes. Farms reward fields outside MVP are
retained as explicitly sized opaque byte arrays; the checked links and flags are
decoded fields. `ata.idl.json` describes SPL Associated Token `CreateIdempotent`
(byte `1`), with payer, ATA, owner, mint, System Program and Token Program in order.
The support schema also describes SPL `InitializeAccount3` (byte `18`),
`CloseAccount` (byte `9`) and `SyncNative` (byte `17`, currently unused).
`system.idl.json` describes System `CreateAccount` (u32 discriminator `0`, followed
by u64 lamports, u64 space, pubkey owner), with writable signer payer and new account.
SPL COption fields are explicit `u32` discriminants plus values.

## Transaction account order

`refreshReserve`: writable reserve, market, optional Pyth, optional Switchboard
spot, optional Switchboard TWAP, optional Scope. Withdrawal supplies Scope and sentinels
for the other oracle types. `refreshObligation`: market, writable obligation,
then deposit reserves in obligation order, borrow reserves in obligation order,
then one referrer token state per borrow if a referrer exists. Repeated deposit/
borrow reserve keys remain in their required positions; reserve refreshes are deduplicated.

Repayment uses `refreshReservesBatch(true)` instead of individual `refreshReserve`
instructions. The upstream IDL has no fixed accounts and a `skipPriceUpdates: bool`
argument. The pinned batch handler consumes pairs of writable Reserve/read-only
LendingMarket when true, without oracle accounts or placeholders. Pair roles/order
are recorded in `metadata.repaymentRefresh.remainingAccountGroup`. ProgramInterface
encodes the eight-byte discriminator and strict one-byte bool (`01` for true).

`repayObligationLiquidityV2` (all unspecified roles read-only):

1. owner signer;
2. writable obligation;
3. lending market;
4. writable repay reserve;
5. liquidity mint;
6. writable reserve destination vault;
7. writable wallet source token account (ATA in token mode; temporary WSOL in SOL mode);
8. Token Program;
9. instructions sysvar;
10. optional writable farm user;
11. optional writable reserve farm;
12. market authority PDA;
13. Farms Program.

`withdrawObligationCollateralAndRedeemReserveCollateralV2`:

1. writable owner signer;
2. writable obligation;
3. market;
4. market authority PDA;
5. writable withdraw reserve;
6. liquidity mint;
7. writable collateral supply vault;
8. writable collateral mint;
9. writable liquidity supply vault;
10. writable wallet destination ATA;
11. optional destination-collateral placeholder (absent);
12. collateral Token Program;
13. liquidity Token Program;
14. instructions sysvar;
15. optional writable farm user;
16. optional writable farm;
17. Farms Program.

Both operation arguments are little-endian u64 after the eight-byte discriminator.
V2 invokes Farms internally; deprecated v1 refresh-farm sandwich instructions are
not used. No remaining deposit reserves are needed for repayment outside elevation
groups. This MVP rejects elevation groups rather than constructing that alternate path.

## Native SOL repayment evidence

Verified against the same KLend commit above (local checkout HEAD verified):
`handlers/handler_repay_obligation_liquidity.rs` accepts a writable source token
account with the reserve's mint; there is no associated-account constraint.
`lending_market/lending_checks.rs::repay_obligation_liquidity_checks` forbids using
the reserve vault as source. `utils/token_transfer.rs::repay_obligation_liquidity_transfer`
calls `transfer_checked` with the wallet signer as authority. Thus a freshly created,
wallet-owned classic WSOL account is a valid source.
`lending_market/ix_utils.rs::tx_includes_restricted_programs` and
`utils/consts.rs::RESTRICTED_PROGRAMS` exclude a fixed Jupiter program, not System
or classic SPL Token. These checks permit the preparation/closure instructions.

The bundled support instructions were checked against SPL Token 4.0.0
[`instruction.rs`](https://github.com/solana-labs/solana-program-library/blob/token-v4.0.0/token/program/src/instruction.rs)
and [`processor.rs`](https://github.com/solana-labs/solana-program-library/blob/token-v4.0.0/token/program/src/processor.rs).
The version and registry crate checksum from KLend Cargo.lock are recorded in
`metadata.nativeSolInterface`. `InitializeAccount3` encodes byte 18 then the owner's
pubkey; accounts are writable token account and read-only mint. It reads Rent from
the sysvar internally, sets native reserve, and initializes the balance to funded
lamports minus rent. `CloseAccount` encodes byte 9; accounts are writable source,
writable destination and owner signer. Native accounts may close with a nonzero
token balance, returning every remaining lamport, including rent, to the destination.

System funding/allocation uses the bundled layout checked against
[`solana-program` 1.17.18 `system_instruction.rs`](https://github.com/solana-labs/solana/blob/v1.17.18/sdk/program/src/system_instruction.rs),
also pinned in KLend Cargo.lock. `CreateAccount` funds rent plus the exact wrapping
amount in one instruction. Since funding precedes `InitializeAccount3`, no separate
transfer or `SyncNative` is needed. No new dependency or network interface loading
is used at runtime.

SOL mode reads the wallet, System Program and fresh temporary address in the same
final account graph as the position. The wallet must be System-owned and data-free,
the System Program executable, and the temporary address absent. A fresh in-memory
signer is attached only to account creation. The full message is compute budget,
create/fund, initialize, reserve/obligation refreshes, repay, close. The existing
WSOL ATA is never an instruction account. Both wallet and temporary signer sign
only after successful final simulation and approval, using the existing exact-message
executor and blockhash-expiry checks.

`Reserve::calculate_repay` settles all Fraction debt for `u64::MAX`, or the minimum
of debt and the explicit amount; the token debit is the ceiling of that settlement.
For SOL `all`, the local wrapping estimate uses refreshed debt rounded up and an
upper-rounded compound factor at max(curve point APR) plus host fixed APR.
The horizon is 600 legacy slots or 300 TrueApr seconds. `AccrualDuration`,
`InterestRateBasis` and `utils/consts.rs` establish 63,072,000 slots/year or
31,536,000 seconds/year. Each multiplication/division rounds up in U68F60 units;
the full compounded factor bounds KLend's positive third-order approximation over
that horizon. The buffer is `ceil(ceil(debt) * (factor - 1)) + 1` lamport, covering
small debts and rounding as well as utilization changes within the recorded curve.
This is a finite estimate, not a promise covering arbitrary confirmation delays,
configuration changes or RPC state changes. Insufficient temporary funds fail
atomically; the app never increases funding or refreshes a simulated message.

Rent comes from RPC for the bundled 165-byte account size. Before final simulation,
`getFeeForMessage` prices the actual two-signature message; a null fee fails closed.
The wallet must cover wrap + rent + fee without crediting the eventual refund.
Final simulation must return the closed temporary account (null or empty System
account with zero lamports), reduced debt, zero residual selected debt for `all`,
and wallet SOL balance. The wallet's debit excluding fee must remain between the
refreshed repayment estimate and the funded amount (also bounded by an explicit
request). Debt reduction must be positive and cannot exceed that debit in Fraction
units. The zero-lamport closure and fixed wallet destination enforce the refund;
approval displays the simulated debit and `wrap - debit + rent` refund as estimates.
The shared reserve vault balance is not compared across RPC calls, because unrelated
users can change it between the original snapshot and the final simulation. Changes
to this wallet's own SOL balance may conservatively cause validation to fail; rerun
the command in that case.

Offline tests model SPL/KLend results using test signers and public reserve fixtures;
they do not claim BPF execution. The local HTTP RPC replay checks rent/fee requests,
lamport decoding, both signatures, exact message preservation and preflight settings.

## Arithmetic and freshness

### Price-free repayment refresh (2026-09-28)

Rechecked the clean local KLend checkout at the pinned commit. The maintenance
generator now includes `refreshReservesBatch` from the same checksum-verified SDK
IDL; source commits, account layouts and transfer instructions are unchanged.
The repayment manifest and metadata describe interest refresh without new prices.

`handler_refresh_reserves_batch.rs::process` passes `None` for prices when
`skip_price_updates=true` and does not access oracle accounts. It verifies each
reserve/market link, market emergency mode and reserve version. In
`lending_operations.rs`, `refresh_reserve` still accrues interest/rewards and
updates the slot; it may clear price-status flags when the saved price is old.
`check_obligation_collateral_deposit_reserve`, `check_obligation_liquidity_borrow_reserve`
and `check_repay_possible` all use `PriceStatusFlags::NONE`. They require fresh
state in the execution slot, not validated current price bits. Full obligation
refresh, all active reserves and conditional referrer states therefore remain.

Every repayment simulation uses the batch instruction followed by obligation
refresh. Repayment no longer loads oracle feeds/Scope program, validates oracle
configuration or rejects blocked-price-use flags; oracle freshness in its internal
snapshot is explicitly unknown (`null`), never fabricated as fresh. Oracle config
changes are not repayment dependency changes. Withdrawal and its full status graph
retain price-aware refresh and Scope validation; status still offers repayment
candidates when these checks fail or prices are stale.

Cached reserve prices still feed on-chain valuation, dust and non-worsening-LTV
invariants. The change does not replace them with local prices or bypass simulation
errors. Full simulation, returned state checks, confirmation, exact-message signing
and preflight remain mandatory. Tests cover exact discriminator/bool/account pairs,
deduplicated reserve refresh, repeated obligation legs, refs, stale/missing/malformed
oracles, unsupported oracle configurations, blocked-price flags, zero price-status
bits, stale state/slots, native SOL and final simulation failure. These are modeled
RPC results, not BPF execution or verification of the deployed program binary.

### Repayment with collateral outside the transfer support matrix

Updated 2026-09-28 against the same pinned source. `validateObligation` now applies
the reserve allowlist to borrows for repayment, and to both deposits and borrows
for withdrawal. Obsolete-deposit counters no longer reject repayment by themselves.
Tag 0, elevation group 0, wallet/market identity, positive unique legs, ordinary
borrows, and position-wide order/ownership-transfer/autodeleverage exclusions remain.

`validatePositionReserve` classifies a reserve as collateral-only only when it is
an active deposit, is not any active borrow, and is not the selected operation
reserve. Such accounts are loaded from the verified obligation, checked for KLend
owner/discriminator/size, pinned main-market linkage and account version 1. They
require classic SPL configuration, a nonzero mint with at most 18 decimals, known
status (Active/Obsolete/Hidden), no emergency/permissioning and bounded risk fields.
Oracle requirements were removed by the price-free refresh change above. Known collateral
reserves retain pinned mint/decimal checks. Unknown collateral has no local token
label or transfer support; its external mint/vault/farm accounts are not used.

Evidence: `handler_refresh_reserve.rs` checks version and market linkage, accrues
reserve interest and refreshes prices. `lending_operations.rs` functions
`refresh_obligation_deposits` and `check_obligation_collateral_deposit_reserve`
(lines 1574 and 3180) use Reserve state, verify leg address/version/current-slot
freshness, record obsolete and collateral-usage flags, and compute collateral
value without collateral vault/mint accounts. They do not reject Obsolete/Hidden,
queued withdrawals, collateral-use restrictions or a reserve's autodeleverage
configuration merely for refresh. The obligation's own autodeleverage mode remains
outside this support expansion. Debt reserves still take the strict existing path.

Full simulation (and the native SOL preview) reapply the role-specific checks; mint identity,
decimals, token program and required farms must remain stable; Scope dependencies
are checked only for the price-aware withdrawal path.
Final repayment also checks unchanged collateral legs and amounts. Status falls
back from a failed full graph to separately validated repayment candidates, with
USDC/WSOL and native SOL funding modes evaluated independently. It performs no
simulation or signing and does not promise execution success.

Tests use synthetic unlisted collateral built from public Reserve fixtures and
modeled RPC simulation results. They cover partial/full and native repayment,
withdrawal rejection, status separation, malformed owner/schema/market/version,
unsupported borrow/token configuration, collateral reserve statuses,
withdrawal-only restrictions and simulation-time changes. They do not execute BPF.
The collateral-support change did not change program IDs or the transfer-token allowlist.

Repayment now uses an operation-specific RPC graph based on the source audit below.
It reads external liquidity mint/vault accounts only for the selected reserve,
only that token's source ATA (no ATA in native SOL mode), and only the selected
reserve's configured debt farm/user. Collateral mint/vault accounts, other wallet
ATAs, collateral farms, unrelated debt farms and the Associated Token program are
not required by repayment. V2 still requires the Farms program. Reserve fields
for operation/debt reserves remain checked against pinned metadata; all active Reserve accounts,
Clock and required referrer states remain in the final bank snapshot. Preview
dependency checks follow the same farm selection. Withdrawal retains its full
account graph and validations; status can also report repayment candidates.
Offline dependency tests model RPC results, not BPF execution.

The [price-free repayment refresh audit](#price-free-repayment-refresh-2026-09-28)
and repayment graph checks above record the distinction between mandatory state
refresh and optional price updates, conditional accounts, and MVP restrictions.
The `refreshReservesBatch(skipPriceUpdates=true)` path is implemented for repayment.

KLend Fraction is unsigned U68F60 (`SF = 2^60`). BigFractionBytes contains four
little-endian u64 limbs. Cached obligation debt scales by
`floor(old_debt_sf * reserve_cumulative_rate / obligation_cumulative_rate)`;
repayment base units round up. Withdrawal and native SOL repayment use an unsigned refresh preview for current
risk values or wrapping estimates. Existing supported token balances need only one full
simulation: the atomic message refreshes interest and repays the explicit amount
or u64::MAX. Cached cumulative-rate-adjusted debt provides an initial funding
estimate; the approval estimate is replaced with the simulated source-token debit.
The full simulation checks the token/obligation results before confirmation/signature.
The final simulated market, reserves and obligation are checked against the MVP
restrictions again, so a mode/configuration change between reads cannot bypass them.

Reserve liquidity supply in SF is available base units times SF plus borrowed SF,
minus accumulated protocol, accumulated referrer and pending referrer fees.
Collateral redemption is `floor(collateral * liquidity_supply_sf / collateral_supply / SF)`.
A requested token withdrawal uses the ceiling inverse conversion; output remains
an estimate because the protocol has no min-out argument here.

For a debt-bearing position, available borrow headroom is refreshed allowed borrow
value minus borrow-factor-adjusted debt value. Selected reserve max withdrawal value
is headroom times 100 divided by LTV percent, capped by that collateral value. The
adapter preserves KLend's floor ratio for max collateral and checks the explicit
amount's ceiling ratio, reducing by one unit if necessary. It also limits `all`
with debt by available liquidity and remaining withdrawal cap. Cap interval zero
disables the cap; negative capacity allows no withdrawal; expired intervals reset
the signed accumulator to zero. Debt-free `all` requires full liquidity and cap.
On-chain minimum-net-value/dust and other handler invariants are enforced in final
simulation and again by preflight/execution.

Status and planning use one final `getMultipleAccounts` bank for the complete
account graph, with monotonically bounded context slots during discovery. Clock
provides time; local wall time is not a price oracle. Supported Scope spot/TWAP
chains contain one through four valid indices with trailing `65535` terminators. Owners,
lengths, positive prices, exponent bounds, future timestamps and both configured
maximum ages are checked for withdrawal and the full status graph. Repayment uses
the price-free path described above; stale oracles do not disable it.

## Updating the interface

### Main-market reserve expansion (2026-09-28)

`scripts/capture-kamino-inventory.mjs` queries read-only `getProgramAccounts`
with context, the bundled Reserve discriminator and ProgramInterface's market
offset. There is no size filter or assumed reserve count: decoding rejects an
unexpected schema/version instead of omitting it. The public snapshot in
`tests/fixtures/kamino/inventory.json` records discovery slot 451298610 and capture
time 2026-09-28T10:57:06.193Z, with each subsequent account batch's own slot.
It contains 58 Reserve accounts (55 unique liquidity mints) and 320 accounts in
total. Each Reserve passes KLend owner, discriminator, exact size, account version
and main-market checks. No wallet, transaction submission or secret RPC URL is used.

Inventory is maintenance data, fetched in batches of at most 100 accounts, and
does not claim a single coherent execution bank. Runtime operations retain one
final `getMultipleAccounts` for their complete operation-specific graph, Clock
and slot validation. The inventory's amount/freshness observations are indicative;
runtime checks and both required simulations remain authoritative.

`scripts/bundle-kamino-inventory.mjs` checks liquidity mint/decimals/owner and vault
mint/authority, collateral mint/authority and vault, both configured Farms and
Scope configuration separately. Its public `inventory-review.json` records each
dependency check even for excluded reserves. Repayment eligibility does not
inherit failed collateral/oracle checks. The generated
[matrix](kamino-reserve-matrix.md) separates operation support, explicit state
restrictions and temporary availability. All 29 compatible reserves have both
repay and withdraw flags in metadata. The other 29 are excluded: 3 Token-2022,
11 Obsolete/Hidden, and 15 otherwise active reserves with existing unsupported
autodeleverage or collateral-use restrictions. These restrictions were not relaxed.
The three extra USDC reserves are Hidden; they are not bundled transfer targets.

Every included reserve uses its recorded vault and collateral mint addresses,
never assumed new-reserve PDAs. Symbols are labels read from Reserve tokenInfo;
the canonical WSOL mint is labelled WSOL to reserve SOL for native funding.
Selection accepts symbol or mint, resolves duplicate candidates against the
verified position/action, and requires a matching local `--reserve` if ambiguous.
The final graph is checked again for ambiguity. No runtime discovery of new
transfer tokens, remote interfaces, SDK or Kamino API was added.

The clean local KLend checkout's HEAD was verified as the pinned commit above.
Scope and Farms checkout HEADs and the upstream SDK IDL SHA-256 were also checked;
the existing Scope/Farms provenance commits are now explicit fields in metadata.
`utils/prices/scope.rs::get_price_usd`, `prices/types.rs::reduce_exp_lossy`,
`prices/utils.rs::price_to_fraction`, `utils/consts.rs` and `utils/fraction.rs`
establish the conversion: multiply values with summed decimal exponents using
U256; when the next exponent sum would exceed 36, floor each operand down to at
most 18 decimals before multiplying; finally floor `value * 2^60 / 10^exp` into
U68F60. Timestamp is the oldest component's timestamp. Local checks preserve the
existing per-component exponent bound 18, require positive prices and valid
timestamps/slots, reject empty/uninitialized chains and nontrailing terminators,
and reject zero/overflow after conversion. Only the required Scope conversion
extension was added; other oracle types remain unsupported. Refreshed on-chain
reserve/obligation values still supply withdrawal risk calculations.

Tests exercise every new public reserve with modeled partial/all repayment and
withdrawal, precision 6/8/9, real Farms configuration with synthetic users,
mixed positions, bad identities/programs and final simulation failures.
Synthetic duplicate local pins test ambiguity and action-specific selection;
they do not assert that excluded live duplicate reserves are supported.
Independent Scope tests cover two through four components, exponent reduction,
rounding, freshness, invalid chains and overflows. These are client tests with
modeled RPC simulation results, not KLend BPF execution.

To reproduce: build, run the capture script with a read-only RPC, run the inventory
bundler, review its public records and matrix, then rebuild and run all required
checks. Existing source commits, IDL checksum, layouts and instruction encodings
are unchanged. No lookup tables were added; legacy transaction size limits remain.

### Operation-specific MVP regression coverage (2026-09-28)

The original CLI working rules distinguish repayment from withdrawal, including
the one-simulation ATA path and two-simulation native SOL/withdrawal paths. The
current mobile entry points are described in [Kamino operations](kamino-operations.md). This documentation update changes no bundled interface,
source pin, program ID or runtime validation.

`tests/kamino-mvp-regression.test.ts` combines unlisted collateral, unavailable Scope,
missing withdrawal accounts, zero withdrawal liquidity and zero LTV headroom. It
checks partial/full repayment through the executor, including accrued-interest debit
for `all`, confirmation before signing and preservation of the simulated message.
With the same repayment exceptions, invalid returned source owner/mint/authority,
position ownership changes, collateral loss, an explicit debit one unit above the
request, zero/increasing source balance and residual full-repayment debt must fail
before confirmation, signature or submission. Withdrawal still rejects the graph.
These are offline modeled RPC results, not BPF execution or deployed-binary evidence.

### Maintenance procedure

1. Choose and record exact KLend and SDK commits; inspect source changes to all
   handlers, layouts, PDAs, rounding, restrictions and dependency schemas above.
   Do not equate the package version with a deployed binary hash.
2. Put pinned source checkouts in a local maintenance directory with `klend-sdk`
   as a child. Inspect the IDL checksum and deliberately update `metadata.json`
   only after reviewing the source/IDL agreement.
3. Run `node scripts/bundle-kamino.mjs <maintenance-directory>`; it refuses an
   IDL whose version/checksum differs from metadata. Update support schema source
   evidence and run `node scripts/bundle-kamino-support.mjs` if dependencies changed.
4. Review generated account lengths, discriminators, argument bytes, account roles,
   optional sentinels, PDA seeds, manifest actions and the support allowlist together.
   Capture new public read-only RPC fixtures if addresses or schemas changed.
5. Update the Kamino guide, README where applicable, this provenance record, independent layout/rounding tests and
   unsupported-state tests. Run `corepack pnpm test`, `corepack pnpm typecheck`,
   `corepack pnpm build`; run read-only integration separately with an RPC configured.

Never download these interfaces at runtime or silently relax a failed owner,
layout, address or simulation check to accommodate an upgrade.
