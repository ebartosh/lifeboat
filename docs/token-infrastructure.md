# Shared SPL Token / Token-2022 infrastructure

`src/core/tokens.ts` describes token properties without assigning protocol permissions. It validates the mint's owning program, initialization and authority options; classic SPL lengths; Token-2022 account-type bytes, zero mint padding and TLV boundaries; duplicate, truncated and misplaced extensions; supported fixed payload lengths; TokenMetadata Borsh lengths, UTF-8 and mint linkage; and transfer fee schedules. Unknown extension IDs remain visible capabilities for a protocol to reject. It decodes token account mint, authority, spendable amount, frozen/delegated/native/close-authority state and separate withheld fees. Protocol adapters decide which states and capabilities an operation admits.

The shared layer derives program-specific ATAs, constructs CreateIdempotent with payer/owner/mint/System/token program roles, calculates required account allocation and quotes RPC rent. Classic token accounts use 165 bytes. Token-2022 ATAs add ImmutableOwner (170 bytes); fee-bearing ATAs additionally require TransferFeeAmount (182 bytes). Non-associated accounts without these extensions use the smaller underlying layout. Account sizing rejects mint capabilities whose requirements this layer cannot determine. No SDK, web3.js, BN, Decimal or Node Buffer is added to application runtime.

All token amounts and fees use bigint. `transferAmounts` returns grossAmount, transferFee and netAmount separately and checks u64 inputs. Epochs before the newer schedule activate the older fee; at and after the newer epoch, the newer fee applies. A fee is the smaller of the ceiling-rounded basis-point fee and maximumFee. Zero amounts have zero fees. Each instruction transfer gets its own rounding and cap. `amount` in Meteora receipts means netAmount; aggregated receipt totals may span several transfers.

## Meteora policy

`src/protocols/meteora/token-policy.ts` admits exactly these extensions:

| Account kind | Allowed extensions |
| --- | --- |
| Mint | None, MetadataPointer (18), TokenMetadata (19), TransferFeeConfig (1), and combinations of these |
| Token account | None, ImmutableOwner (7), TransferFeeAmount (2), and combinations consistent with the mint |

TransferFeeAmount must be present exactly when the mint has TransferFeeConfig. Vaults need not have ImmutableOwner. All other mint/account extensions and unknown IDs are excluded, even when their optional control is disabled. This includes MintCloseAuthority, confidential transfer/fee/mint-burn extensions, DefaultAccountState, MemoTransfer, NonTransferable and NonTransferableAccount, InterestBearingConfig, CpiGuard, PermanentDelegate, TransferHook and TransferHookAccount, group and member pointers/data, ScaledUiAmountConfig, PausableConfig/PausableAccount, and PermissionedBurn. The native Token-2022 mint is excluded by the pinned DLMM interface. Frozen, delegated, uninitialized, alternate-close-authority, mismatched and malformed accounts are unavailable. Ordinary WSOL keeps its existing SPL path and stays wrapped.

Meteora discovers mint programs before deriving ATAs, then validates the same programs in its final monotonic account snapshot. Pool flags must match verified mint owners. Reward programs are determined independently. Missing ATA rent is deduplicated by ATA and queried by required size. Simulation verifies each gross vault debit against the epoch-specific net wallet credit and withheld-fee increase. Withheld vault fees cannot be reduced. Mint bytes cannot change, and the returned Clock must be valid with a nondecreasing epoch. Fee-only, reward-only, empty, multi-range and recovered withdrawals use the same rules. Durable operation records still store only identities, steps and signatures; restart derives fees and programs from fresh verified accounts.

## Pinned official references

The official Rust interface and processor were inspected at [solana-program/token-2022 commit 1436a91674fb3679e6473661f5f1e6a6b41f093d](https://github.com/solana-program/token-2022/tree/1436a91674fb3679e6473661f5f1e6a6b41f093d). Relevant files are `interface/src/extension/mod.rs` (TLV and required extensions), `interface/src/extension/transfer_fee/mod.rs` (epoch schedules, ceiling rounding and caps), and `program/src/processor.rs` (source gross debit, destination net credit and separate withheld amount). These pinned source references do not establish the hash of a deployed Solana binary.

The independent clients are **@solana/spl-token 0.4.15** and **@meteora-ag/dlmm 1.9.14**, installed only in ignored `.cache/meteora-reference`. The DLMM source/IDL remains [commit 576919e3e4368e542c402f000b4264724f7f23ec](https://github.com/MeteoraAg/dlmm-sdk/tree/576919e3e4368e542c402f000b4264724f7f23ec). `src/core/token-interface.json` records the token provenance; Meteora's manifest records its policy. Official SPL `unpackMint`, `unpackAccount`, ATA construction, allocation and epoch fee functions, plus Meteora's net-fee function, are compared by `scripts/verify-token-reference.mjs`. `scripts/verify-meteora-reference.mjs` also checks Token-2022 position calculations and the pinned Anchor instruction bytes/account roles.

## Future Kamino integration

Kamino remains limited to its existing classic SPL reserves and vanilla obligations. Its SPL support codecs and operation builders are unchanged. The reusable foundation is mint-program verification, strict token decoding, extension capabilities, ATA construction/allocation/rent, and gross/fee/net arithmetic. Debt, interest, LTV, collateral, reserve permissions and repay-all rules remain in Kamino.

A separate integration must verify the chosen KLend source and live reserve token-program fields, liquidity and collateral mint/vault layouts, CPI instruction accounts and extension allowlists; repay debits versus the net liquidity received by a reserve; exact debt cancellation and fee gross-up for repay-all; collateral redemption amounts, rounding and net user receipts; withheld vault fees versus usable reserve liquidity; refresh/oracle/farms/referrer compatibility; epoch changes during preparation and recovery; and unsigned BPF simulation with independent KLend references. Meteora compatibility provides no permission to enable any Kamino Token-2022 reserve or obligation type.
