# Lifeboat documentation

Lifeboat is an emergency client for critical actions when a protocol's web infrastructure is unavailable but the Solana blockchain still works. Development favors reliability first and performance second; [AGENTS.md](../AGENTS.md) states the rules that follow from this.

Use the guides below for current app behavior. Dated validation records describe the tested code, wallet, device and operation; a passing build or simulation does not establish successful on-chain execution. Migration plans preserve earlier requirements and results and may describe features that were later removed.

## Current guides

| Topic | Document |
| --- | --- |
| Development, Android environment, rebuild decisions and local outputs | [Building and testing](development.md) |
| Interface rules and design decisions | [Interface direction](interface-direction.md) |
| External wallets, storage, signing and mainnet RPC | [Wallets and RPC](wallet-and-rpc.md) |
| ORE rewards and direct staking | [ORE operations](ore-operations.md) |
| Kamino Lending repayment and collateral withdrawal | [Kamino operations](kamino-operations.md) |
| Meteora DLMM withdrawal, transfer fees and recovery | [Meteora operations](meteora-operations.md) |
| Meteora DAMM v2 withdrawal, locked positions and its support boundary | [DAMM v2 operations](meteora-damm-operations.md) |
| Orca Whirlpools withdrawal, close timing and recovery | [Orca operations](orca-operations.md) |
| Shared SPL Token / Token-2022 infrastructure and protocol limits | [Token infrastructure](token-infrastructure.md) |

## Protocol interfaces and support boundaries

| Topic | Document |
| --- | --- |
| Reconstructed ORE interface and source pins | [ORE provenance](ore-interface-provenance.md) |
| Direct ORE staking withdrawal interface | [ORE stake withdrawal](ore-stake-withdraw.md) |
| Recorded Claim SOL versus pending mining rewards; pending settlement is not implemented | [ORE SOL rewards](ore-sol-rewards.md) |
| KLend, Scope and Farms source pins and original CLI audit | [Kamino provenance](kamino-interface-provenance.md) |
| Pinned main-market reserves and action limits | [Kamino reserve matrix](kamino-reserve-matrix.md) |
| DLMM source pins, account checks and instruction construction | [Meteora provenance](meteora-interface-provenance.md) |
| Whirlpool Apache-2.0 source pins, license boundary, account checks and instruction construction | [Orca provenance](orca-interface-provenance.md) |
| DAMM v2 program and IDL pins, license boundary and the program rules relied on | [DAMM v2 provenance](meteora-damm-interface-provenance.md) |

## Validation and investigations

| Topic | Document |
| --- | --- |
| Jupiter Perps, GMTrade and Pacifica dependency boundaries, source review and RPC permission evidence | [Perpetuals feasibility](perps-feasibility-research.md) |
| Meteora fixtures, independent SDK comparison and device/live-check limits | [Meteora validation](meteora-validation.md) |
| Orca tests, SDK comparison and unsigned mainnet simulations | [Orca validation](orca-validation.md) |
| DAMM v2 tests, SDK comparison and unsigned mainnet simulations | [DAMM v2 validation](meteora-damm-validation.md) |
| Shared wallet-addition policy and Solflare device-test matrix | [Solflare validation](solflare-validation.md) |
| Phantom authorization/signature evidence and memo comparison | [Phantom validation](phantom-validation.md) |
| Pre-submission blockhash expiry and recovery rules | [Blockhash expiry](blockhash-expiry.md) |
| Project-page URI experiment and origin-root association requirement | [Wallet identity](wallet-identity/README.md) |

## Current plans

- [Meteora DAMM v2 integration](damm-v2-plan.md): milestones 1–5 are implemented; the device test with an external wallet (milestone 6) remains.

## Historical migration plans

- [Original ORE / React Native migration](mobile-react-native-plan.md): includes superseded keypair import, local signing and runtime diagnostics.
- [Kamino mobile migration](kamino-mobile-plan.md): October 2 acceptance stages and original RPC/signing assumptions.
- [Orca Whirlpools implementation plan](orca-whirlpools-plan.md): October 9 requirements for the Withdraw all integration; the license boundary in [Orca provenance](orca-interface-provenance.md) determines the pinned commit and SDK release.

For a new build or code change, follow [development.md](development.md) rather than repeating historical release builds, dependency installations or cleanup steps.
