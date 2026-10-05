# Lifeboat

Lifeboat is an Android app for ORE operations, Kamino Lending positions and Meteora DLMM positions on Solana. It shows rewards and positions for the selected wallet, helps prepare supported transactions, and lets you sign them on your phone. The app currently uses the public Solana mainnet RPC endpoint.

## Features

- **ORE:** view rewards and estimated SOL and ORE payouts, claim either reward, view a direct ORE staking position, and withdraw available ORE.
- **Kamino Lending:** view supported positions, debt, and collateral; repay debt and withdraw collateral.
- **Meteora DLMM:** withdraw all liquidity from a selected PositionV2, claim fees and rewards, and close its empty account with recoverable progress. WSOL stays wrapped.
- **Wallets:** import a Solana JSON keypair or connect a compatible Android wallet through Mobile Wallet Adapter.
- **Transaction review:** the app refreshes account data and simulates a transaction before signing, displays its details, and asks for confirmation. After submission, you can check its status using the saved signature.

You need Android 7 or later and a wallet. No RPC API key is required for the current build. An imported private key is stored **unencrypted** in the app's private directory; connecting an external wallet removes the local copy. This is a prototype build, so review the address, amount, and simulation result before each transaction.

## Documentation

- [ORE operations](docs/ore-operations.md): rewards, direct staking, limitations, and transaction handling.
- [Kamino Lending operations](docs/kamino-operations.md): positions, repayment, withdrawal, and RPC requirements.
- [Meteora DLMM operations](docs/meteora-operations.md) and [interface provenance](docs/meteora-interface-provenance.md): support, review, multi-transaction recovery and pinned sources.
- [Wallets and RPC](docs/wallet-and-rpc.md): connection, local storage, and signing.
- [Build and checks](docs/development.md): local development and APK builds.
- [Kamino reserve matrix](docs/kamino-reserve-matrix.md), [Kamino interface provenance](docs/kamino-interface-provenance.md), and [ORE interface provenance](docs/ore-interface-provenance.md): technical support boundaries.
