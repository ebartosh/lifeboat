# Lifeboat

Lifeboat is an emergency Android client for Solana positions. Use it to perform critical actions, such as withdrawing, repaying or claiming, when a protocol's website or backend is unavailable but the Solana network still works. It reads positions directly from the blockchain and builds transactions itself, so it needs only an RPC endpoint and your wallet.

Lifeboat currently supports ORE, Kamino Lending positions and Meteora DLMM and DAMM v2 positions. It shows rewards and positions for the selected wallet, helps prepare supported transactions, and lets you sign them on your phone. The app currently uses the public Solana mainnet RPC endpoint.

## Features

- **ORE:** view rewards and estimated SOL and ORE payouts, claim either reward, view a direct ORE staking position, and withdraw available ORE.
- **Kamino Lending:** view supported positions, debt, and collateral; repay debt and withdraw collateral.
- **Meteora DLMM:** withdraw all liquidity from a selected PositionV2, claim fees and rewards, and close its empty account with recoverable progress. Classic SPL and a limited Token-2022 extension set support mixed pairs and rewards; receipts exclude transfer fees. WSOL stays wrapped.
- **Meteora DAMM v2:** in one transaction, claim fees, remove all unlocked liquidity and claim rewards from a selected position, and close it and burn its NFT when nothing remains locked. Vesting and permanently locked liquidity stay in the position. WSOL stays wrapped.
- **Wallets:** connect a compatible Android wallet through Mobile Wallet Adapter; wallet keys stay in the wallet app.
- **Transaction review:** the app refreshes account data and simulates a transaction before signing, displays its details, and asks for confirmation. After submission, you can check its status using the saved signature.

You need Android 7 or later and a compatible external wallet. No RPC API key is required for the current build. Lifeboat cannot import private keys or sign with a stored wallet key. Legacy key files from older versions remain untouched and unused; see [Wallets and RPC](docs/wallet-and-rpc.md) for storage details. This is a prototype build, so review the address, amount, and simulation result before each transaction.

## Documentation

Start with the [documentation index](docs/README.md) for current guides, verification records, and historical migration plans.

- [ORE operations](docs/ore-operations.md): rewards, direct staking, limitations, and transaction handling.
- [Kamino Lending operations](docs/kamino-operations.md): positions, repayment, withdrawal, and RPC requirements.
- [Meteora DLMM operations](docs/meteora-operations.md) and [interface provenance](docs/meteora-interface-provenance.md): support, review, multi-transaction recovery and pinned sources.
- [Meteora DAMM v2 operations](docs/meteora-damm-operations.md) and [interface provenance](docs/meteora-damm-interface-provenance.md): locked positions, review, checks and pinned sources.
- [Shared token infrastructure](docs/token-infrastructure.md): SPL/Token-2022 validation, exact extension policy, transfer fees, reference checks, and future Kamino work. Kamino remains classic SPL-only.
- [Wallets and RPC](docs/wallet-and-rpc.md): connection, local storage, and signing.
- [Build and checks](docs/development.md): local development and APK builds.
- [Kamino reserve matrix](docs/kamino-reserve-matrix.md), [Kamino interface provenance](docs/kamino-interface-provenance.md), and [ORE interface provenance](docs/ore-interface-provenance.md): technical support boundaries.
