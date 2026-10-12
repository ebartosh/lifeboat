# Perpetuals feasibility for Lifeboat

Assessment date: October 11, 2026. Research only; no protocol integration was added.

## Decision

None of Jupiter Perps, GMTrade, or Pacifica has a verified path for a complete exit using only the user's wallet and Solana RPC when its execution infrastructure is also unavailable.

Jupiter and GMTrade can support a narrower service: read positions and submit a locally built close request when the website or transaction-building API is unavailable, provided protocol keepers and price infrastructure still operate. A confirmed request transaction does not prove a position was closed. Pacifica's documented read, close, and withdrawal paths require its API and matching engine and do not meet Lifeboat's current dependency rule.

Selected scope (user decision, October 11, 2026): retain only Jupiter Perps as a candidate for closing an entire position during a website/API outage while keepers and accepted price feeds remain available. Exclude GMTrade and Pacifica from this integration scope, including the narrower escrow/recovery candidates. GMTrade's technical ability to submit a local request remains a research finding, not a selected feature. No keeper-outage exit, instant co-signed close, partial close, or reward-only action is selected. Jupiter support still requires funded-position and external-wallet validation.

| Capability | Jupiter Perps | GMTrade / GMX Solana | Pacifica |
| --- | --- | --- | --- |
| Discover positions through RPC | Supported by account layout and examples | Supported by public position layout and SDK | No public RPC-only position reader established |
| Build close locally | Owner-signed request; instant close has extra signers | Owner-signed decrease order | Documented path is a signed API message |
| Complete exit with ordinary wallet if executors stop | No verified path; instant close rejected the tested owner as keeper | Reviewed source requires `ORDER_KEEPER` | No documented engine-independent path |
| Recover already escrowed or settled funds | Request cancellation/refund may be possible; state and permissions matter | Owner close/refund and existing token delegation offer limited paths | No documented user-only withdrawal path |
| Fit with current Lifeboat scope | Conditional request support; not an autonomous exit | Conditional request support and limited recovery | Exclude pending an independently verifiable escape path |

These are availability findings, not a security ranking or a guarantee that every possible future instruction has been excluded.

## Method and evidence limits

The project requires direct RPC reads and locally built instructions, an external wallet, recovery of principal before convenience actions, and checks only for actual on-chain failure or a departure from reviewed fund movement. The current shared executor builds legacy transactions, simulates before review and again after a blockhash refresh, then obtains the wallet signature. Its other signers are locally available temporary keypairs. It has no remote keeper co-signing or signed API-message execution path. See [AGENTS.md](../AGENTS.md), [transaction executor](../src/core/transaction.ts), and [wallet guide](wallet-and-rpc.md).

Research used official documentation, the SDK/source linked by GMTrade, the Jupiter examples linked by its developer documentation, and public mainnet RPC. No wallet connection, private key, signed transaction, or transaction submission was used. Raw metadata and the trimmed simulation result are in [RPC evidence](perps-research-evidence.json).

At RPC slot `455721983`:

| Program | Program address | Last deployment slot | Published IDL |
| --- | --- | --- | --- |
| Jupiter Perps | `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu` | `413092478` | 59 instructions |
| GMTrade store | `Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo` | `438769784` | 130 instructions |

Both were executable upgradeable programs. The probe derived their Anchor IDL addresses, read the accounts, and decompressed the published JSON. SHA-256 hashes of the decompressed bytes are recorded in the evidence. Published IDL does not establish source-to-binary equivalence.

The GMTrade repository was inspected at commit [`8af1e70c0c0b6ff9d6b41ba4997910588fbcec28`](https://github.com/gmsol-labs/gmx-solana/tree/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28), dated October 8, 2026. Source permissions were checked, but its binary was not reproduced and compared with deployment. Jupiter's officially linked example repository was inspected at [`630cfd72cad499f45453a53383d7ac6d3e09e022`](https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing/tree/630cfd72cad499f45453a53383d7ac6d3e09e022), dated September 7, 2025. That older example is not the current interface pin: the live IDL includes newer request-close and instant-close instructions.

No successful close of a funded open position, payout receipt, Android wallet compatibility test, or full outage experiment was performed. Positive support claims below are implementation feasibility, not completed integration validation.

## Jupiter Perps

### Reads and the owner-signed request

Positions, pool/custody parameters, and pending requests are available as program accounts. The linked example discovers a wallet's positions with `getProgramAccounts`, the Position discriminator and owner at offset 8. A position with `sizeUsd = 0` is closed; its account can remain present. Discovery and account decoding therefore need no Portfolio API. Sources: [Position account](https://developers.jup.ag/docs/perps/position-account), [wallet discovery example](https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing/blob/630cfd72cad499f45453a53383d7ac6d3e09e022/src/examples/get-open-positions-for-wallet.ts).

The live IDL separates `createDecreasePositionMarketRequest`, signed by `owner`, from `decreasePosition4`, signed by `keeper`. The request contains the close intent, price bound, desired output mint, and full-position flag. It is possible to build and submit this request through RPC without asking the Perps API for a serialized transaction. Keepers subsequently execute it. Returning the collateral token avoids an additional output swap route. Sources: [request account](https://developers.jup.ag/docs/perps/position-request-account), [locally constructed request example](https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing/blob/630cfd72cad499f45453a53383d7ac6d3e09e022/src/examples/create-market-trade-request.ts), [live IDL evidence](perps-research-evidence.json).

This is useful for a frontend/API incident with healthy keepers. It does not establish that the client can replace stopped keepers.

### Instant close and signer restrictions

The published IDL exposes `instantDecreasePosition` and `instantDecreasePosition2`, each requiring `keeper`, `apiKeeper`, and `owner`. The official API documents an instant transaction path routed through `POST /transaction/execute`. That path cannot be made independent merely by reconstructing its instruction bytes. Source: [Perps API specification](https://perps-api.jup.ag/v1/docs).

An unsigned mainnet simulation at slot `455722737` tested `instantDecreasePosition` with the documented example position's ordinary owner supplied for both keeper accounts. Account construction used live Position and Custody data and the published IDL. Execution reached the permission check and returned `6034 / InvalidKeeper` from `instant_decrease_position.rs:159`. See [simulation evidence](perps-research-evidence.json).

The example position was already closed. This result demonstrates rejection of that owner as an instant-close keeper, not successful execution of a close or a complete proof about every instruction. The current `instantDecreasePosition2` and ordinary request fulfillment were not simulated with an open position. An autonomous exit remains unverified and should not be advertised.

### Oracles, cancellation, and review

The checked SOL custody includes Pyth and Doves feed addresses and `maxPriceAgeSec = 5`. The live IDL has stale-price, invalid-oracle-signer, and invalid-keeper errors. Having an oracle address is not equivalent to being able to obtain or publish an accepted fresh price after producers stop. Price permissions and sources must be tested for the selected instruction; replacing one source with another is not established. Sources: [Custody documentation](https://developers.jup.ag/docs/perps/custody-account), [RPC evidence](perps-research-evidence.json).

`closePositionRequest2/3` have an optional keeper account. The older example omits the keeper for request cleanup. This concerns a request account and any escrow/refund, not closure of the perpetual position. Current custody layout also contains `disableClosePositionRequest` and withdrawal-limit fields; the checked SOL custody had the close-request flag false. Exact cancellation states and limits need live simulation before support. Sources: [request cleanup example](https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing/blob/630cfd72cad499f45453a53383d7ac6d3e09e022/src/examples/close-position-request.ts), [RPC evidence](perps-research-evidence.json).

If implemented, the review must approve a request and its enforceable price bound, with output amounts marked as estimates. Progress must distinguish request confirmation, pending execution, rejection/expiry, and actual position reduction/payout. Simulating creation does not simulate the later keeper execution. A refresh must not silently widen the approved price bound. Shared pool state changes should not cause client-side rejection unless the chain or reviewed fund movement requires it.

## GMTrade / GMX Solana

### Reads and local construction

GMTrade links the `gmsol-sdk` Rust SDK and its source repository. Position data includes store, owner, market token, collateral token, side, size, collateral and fee snapshots. Public PDA/discovery and instruction-building code make RPC-only discovery and creation of a `MarketDecrease` order feasible. Use live store/market/token-map data rather than website metadata. Sources: [official SDK](https://docs.rs/gmsol-sdk/0.10.0/gmsol_sdk/), [Position layout](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/states/position.rs), [order builder](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/crates/sdk/src/builders/order/create.rs).

### The execution barrier

The reviewed program entrypoints apply `only_order_keeper` to `execute_decrease_order_v2`, `execute_withdrawal`, and `execute_glv_withdrawal`. `only_order_keeper` checks the store's `ORDER_KEEPER` role. Role membership is an address bitmap; an ordinary caller without membership receives a permission error. A keeper here is an authorized actor, not a permissionless bot any user can replace. Sources: [entrypoints](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/lib.rs), [authentication](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/utils/internal/authentication.rs), [role membership](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/states/roles.rs).

The source also restricts Chainlink feed updates to `PRICE_KEEPER`. The SDK consumes a signed report and builds its update instruction; it does not eliminate report production or authorization. Protocol support for multiple oracle providers does not remove the order-execution role. Sources: [oracle SDK path](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/crates/sdk/src/client/ops/oracle.rs), [program entrypoints](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/lib.rs).

Creating an order therefore helps if only the website/API fails. Creating a withdrawal request also does not provide autonomous LP redemption when keepers stop. Running a local keeper without the required role does not solve either case.

### Limited recovery that survives an execution outage

The shared action-close code explicitly permits the action owner; a different caller needs the expected keeper role and a terminal action state. `close_order_v2` and `close_withdrawal` can return tokens already held in request escrow. Pending cancellations remain subject to the store's cancel-feature permissions. Completed order cleanup can also require prior builder-fee settlement. These recover already escrowed outputs or unused inputs; they do not realize PnL on a live position. Sources: [owner/keeper close distinction](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/utils/internal/action.rs), [order cleanup](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/instructions/exchange/order.rs), [withdrawal cleanup](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/instructions/exchange/withdrawal.rs).

A further narrow recovery path exists for claimable SPL token accounts whose user delegation has already been established: `use_claimable_account` approves the user as token delegate. An existing valid allowance can permit a direct SPL transfer, limited by balance and delegated amount. Establishing or extending that allowance still requires a keeper. This is a candidate for recovery of settled funds and needs fixture and unsigned simulation validation. Source: [claimable token implementation](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/instructions/token.rs).

`close_empty_position` requires an already empty position and its configured minimum age. It only recovers account rent, not the collateral in a live trade. Standing trigger orders can survive a manual close, so their state needs deliberate treatment rather than assuming the position's disappearance removed every order. Sources: [position cleanup](https://github.com/gmsol-labs/gmx-solana/blob/8af1e70c0c0b6ff9d6b41ba4997910588fbcec28/programs/store/src/instructions/exchange/order.rs), [GMTrade trading guide](https://docs.gmtrade.xyz/about/trading/).

If implemented, separate request creation, keeper execution, and escrow collection. Review enforceable acceptable-price/output constraints and execution fees. Recover only state the chain actually makes accessible. The source snapshot uses Business Source License 1.1; any production vendoring needs an explicit source/license boundary, as with existing protocol provenance records. No SDK or program code was added to the app.

## Pacifica

The documented position read is `GET /api/v1/positions`. Closing a position uses a market order with the opposite side and `reduce_only`, submitted to `POST /api/v1/orders/create_market` with a signed message. Withdrawal is a separate signed request to `POST /api/v1/account/withdraw`, returning a batch nonce rather than a user-built Solana withdrawal transaction. Sources: [position API](https://docs.pacifica.fi/api-documentation/api/rest-api/account/get-positions), [order API](https://docs.pacifica.fi/api-documentation/api/rest-api/orders/create-market-order), [withdrawal API](https://docs.pacifica.fi/api-documentation/api/rest-api/account/request-withdrawal).

The official fund-security design places the hot withdrawal signer under matching-engine control, with programmatic spending limits; a cold multisig replenishes that hot reserve. A user message signature authorizes the engine request, not a direct user-only debit from the reserve. Source: [fund security](https://docs.pacifica.fi/trading-on-pacifica/fund-security).

The official SDK is a REST/WebSocket example client. In the inspected public documentation and SDK, no RPC-only per-user position layout, reduce instruction, force-withdraw timeout, balance proof, or user-only escape instruction was established. This is a documented-interface finding, not a binary audit proving no hidden mechanism exists. Sources: [API overview](https://docs.pacifica.fi/api-documentation/api), [official SDK](https://github.com/pacifica-fi/python-sdk).

The address labeled the USDC deposit/withdraw bridge in the security documentation, `72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa`, was a 165-byte SPL Token account, not an executable program, in the RPC probe. Publishing that reserve address does not identify a callable position-close interface. See [RPC evidence](perps-research-evidence.json).

An alternative frontend could use the healthy Pacifica API during a website outage. That would introduce a dependency prohibited by Lifeboat's present scope. Adding message signing or an API SDK would not make the engine available during an outage. Do not integrate under the current model unless a verifiable independent recovery path becomes available.

## Failure scenarios and next steps

| Failure | Jupiter | GMTrade | Pacifica |
| --- | --- | --- | --- |
| Website unavailable; API, keepers and prices healthy | Local request feasible | Local order feasible | Alternative API client feasible, outside Lifeboat scope |
| Transaction-building API unavailable; keepers and prices healthy | Legacy owner request is a candidate | Local owner order is a candidate | Documented close/withdraw path unavailable if API ingress is down |
| Keepers or engine unavailable; Solana healthy | No verified full exit; request cleanup may remain | No full exit in reviewed source; limited escrow/delegation recovery | No documented independent exit |
| Accepted price feeds stale | Completion can fail on price checks | Completion can fail on price checks | No client-independent pricing/engine path established |
| Protocol disables relevant operations | RPC availability does not override program permissions | RPC availability does not override store permissions | RPC availability does not override withdrawal authority or limits |

For the current product promise, do not present any of these as a proven autonomous close adapter. The selected candidate is Jupiter's full-position owner request as a website/API fallback with healthy keepers and price feeds. GMTrade and Pacifica are excluded from the selected scope.

Before implementing the selected Jupiter candidate, the concrete acceptance gates are:

1. Pin the live interface and deployment identity, and establish source/license provenance where code is reused.
2. Discover an owned funded position and all relevant request/escrow accounts using RPC alone.
3. Build and simulate the owner request, enforcing only reviewed intent and actual program constraints. Separately validate the executing/payout transaction and every signer.
4. Demonstrate request execution after removing protocol API access. Test stopped executor and stale-price cases separately; a keeper signing service is not an RPC-only solution.
5. Validate request expiry/cancellation and payout reconciliation so interrupted or rejected close requests remain recoverable. Request-account cleanup must not be reported as position closure.
6. Test external-wallet signing on Android and recovery after interrupted asynchronous execution. Report completion only after account changes and payout receipts establish it.

RPC reads and the negative Jupiter permission simulation are complete. Funded-position execution, keeper-outage exit, and mobile signing remain unverified; no financial transaction was submitted during this research.
