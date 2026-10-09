# Working on Lifeboat

## Purpose and priorities

Lifeboat is an emergency client. Its main use is to perform critical actions on a user's positions when a protocol's website, API or backend is unavailable but the Solana blockchain still works. It reads state from the chain and builds transactions itself; it depends only on an RPC endpoint and the user's external wallet.

Rank product and implementation decisions in this order:

1. **Reliability:** build a valid transaction that is unlikely to fail on-chain and that the wallet will sign.
2. **Performance:** fewer RPC round trips, transactions and signatures, and less time between review and submission.

Consequences:

- Fewer checks and options are better. Keep a check only if it stops a transaction that would fail on-chain or would move funds differently from what the user reviewed. Do not add checks that reject transactions the chain would accept, such as comparing state that other users change. The earlier Meteora vault comparison did this: every withdrawal of a live position failed once review took 15 seconds or longer.
- Do not depend on protocol APIs, indexers or off-chain metadata. Use direct protocol instructions.
- Prioritize actions that recover principal (withdraw, repay, close) over convenience actions such as partial or reward-only operations.
- Removing an existing check, option or step that fails this test is a valid change. State the removal and its reason in the change description.

## Conventions

The final application language is English. All user-facing buttons, labels, messages, accessibility text, and project documentation must be written in English. Keep protocol names, token symbols, addresses, and technical identifiers unchanged.

Before building Android, read `docs/development.md`. It records the verified environment, emulator commands, and rebuild conditions.

- On this machine, use the JDK and SDK paths in that document and `scripts/build-android.ps1`. Repeat a full environment inventory only after an error, a machine change, or a change in project requirements. Keep the script's quick file-existence checks.
- Do not run `expo prebuild --clean`, Gradle `clean`, dependency reinstallation, or cache clearing before every build. Choose actions using the document's decision table.
- For emulator testing, use debug x86_64 with local Metro. Run release/production builds only when the user requests them.
- After code changes, run appropriate checks. When repackaging already verified code, do not repeat the full suite without a reason.
- Maintain build instructions in `docs/development.md` and design decisions in `docs/interface-direction.md`.