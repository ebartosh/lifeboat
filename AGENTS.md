# Working on Lifeboat

The final application language is English. All user-facing buttons, labels, messages, accessibility text, and project documentation must be written in English. Keep protocol names, token symbols, addresses, and technical identifiers unchanged.

Before building Android, read `docs/development.md`. It records the verified environment, emulator commands, and rebuild conditions.

- On this machine, use the JDK and SDK paths in that document and `scripts/build-android.ps1`. Repeat a full environment inventory only after an error, a machine change, or a change in project requirements. Keep the script's quick file-existence checks.
- Do not run `expo prebuild --clean`, Gradle `clean`, dependency reinstallation, or cache clearing before every build. Choose actions using the document's decision table.
- For emulator testing, use debug x86_64 with local Metro. Run release/production builds only when the user requests them.
- After code changes, run appropriate checks. When repackaging already verified code, do not repeat the full suite without a reason.
- Maintain build instructions in `docs/development.md` and design decisions in `docs/interface-direction.md`.