# Kamino Lending operations in Lifeboat

On the Kamino screen, tap “Refresh”. The app checks that the RPC endpoint is on Solana mainnet-beta and shows any obligations it finds, along with debt, collateral, reserves, and reasons an action may be unavailable. For a supported position, choose debt repayment or collateral withdrawal, enter an amount in token units or `all`, review the simulation, and confirm the signature.

WSOL debt can be repaid from a WSOL associated token account (ATA) or from native SOL. In the latter case, a temporary WSOL account is created and closed in the same transaction. Withdrawn WSOL remains WSOL. Refresh the position after repayment before withdrawing collateral.

Support is limited to the pinned main market, vanilla obligations (tag 0, elevation group 0), and 29 classic SPL Token reserves. Available operations and exclusions are listed in the [reserve matrix](kamino-reserve-matrix.md); KLend, Scope, and Farms versions are recorded in [interface provenance](kamino-interface-provenance.md). An action appearing on screen does not guarantee execution: the app checks accounts again and simulates the full transaction before signing.

The RPC endpoint must support filtered `getProgramAccounts` with context, `getMultipleAccounts` with `minContextSlot`, and simulation that returns account data. If the submission outcome is uncertain, a new operation is blocked until the saved signature is checked. The migration history from `Lifeboat-cli` is in the [Kamino plan](kamino-mobile-plan.md).
