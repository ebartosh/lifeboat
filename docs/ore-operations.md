# ORE operations in Lifeboat

The app reads ORE rewards through the public Solana mainnet RPC and shows the Miner account, estimated SOL and ORE payouts, the refining fee, and available actions. To refresh the data, select a wallet and tap “Refresh”. No API key is required.

## Claiming rewards

“Claim SOL” and “Claim ORE” reread the ORE accounts, build a transaction, and simulate it. Before confirmation, the app shows the wallet, recipient, estimated payout, refining fee, and network fee. Estimates can differ from the on-chain result. Claim ORE sends tokens to the selected wallet's associated token account (ATA); creating that account, if needed, requires SOL for rent.

After confirmation, the app checks the blockhash lifetime, signs locally or opens the external wallet for signing, and verifies the signer's address, message bytes, and Ed25519 signature. It then saves the transaction identifier and submits the transaction through the configured RPC endpoint with preflight. An external wallet only signs the transaction; Lifeboat submits it.

Canceling before submission sends nothing. If the response is lost, the app goes into the background, or it restarts after submission, use “Check status”. This check uses the saved signature and original RPC endpoint; it does not create another transaction. While the outcome is unknown, another operation is blocked. Blockhash expiration alone does not prove that the transaction did not execute earlier.

## Direct staking

The app shows the direct ORE staking position and the amount available to withdraw. Enter an ORE amount, review the prepared transaction, and confirm the signature. The separate `ore-stake` program interface and withdrawal limits are documented in [Withdraw interface](ore-stake-withdraw.md).

## Protocol interface

The bundled ORE IDL is a reconstructed subset, not an official protocol artifact. See [ORE interface provenance](ore-interface-provenance.md) for sources and limitations. The migration history from `Lifeboat-cli` is in the [React Native plan](mobile-react-native-plan.md).
