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

## Validation and investigations

| Topic | Document |
| --- | --- |
| Meteora fixtures, independent SDK comparison and device/live-check limits | [Meteora validation](meteora-validation.md) |
| Shared wallet-addition policy and Solflare device-test matrix | [Solflare validation](solflare-validation.md) |
| Phantom authorization/signature evidence and memo comparison | [Phantom validation](phantom-validation.md) |
| Pre-submission blockhash expiry and recovery rules | [Blockhash expiry](blockhash-expiry.md) |
| Project-page URI experiment and origin-root association requirement | [Wallet identity](wallet-identity/README.md) |

## Historical migration plans

- [Original ORE / React Native migration](mobile-react-native-plan.md): includes superseded keypair import, local signing and runtime diagnostics.
- [Kamino mobile migration](kamino-mobile-plan.md): October 2 acceptance stages and original RPC/signing assumptions.

For a new build or code change, follow [development.md](development.md) rather than repeating historical release builds, dependency installations or cleanup steps.
