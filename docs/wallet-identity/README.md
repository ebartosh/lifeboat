# Wallet identity verification experiment

Phantom 26.31.1 repeatedly rejected reuse with MWA error -1, accepted fresh authorization, then immediately rejected signing with -3. Lifeboat's authorization initially identified itself only by name. The user confirmed on October 5, 2026 that no project HTTPS website exists. Missing identity verification is a hypothesis, not a confirmed reason for Phantom's signing refusal.

The app accepts `EXPO_PUBLIC_WALLET_IDENTITY_URI` for the owner's public HTTPS project page. The URI must not contain credentials, a query or a fragment. Connection and signing use the same identity. This TS-only option does not configure Android App Links by itself. The October 6 diagnostic APK uses name-only identity. On October 7, the user selected a project-page URI experiment and the local `.env.local` was set to `https://ebartosh.github.io/lifeboat/` after verifying the public page. This is a URI-only experiment, not verified domain identity.

## Root-host association published on October 8, 2026

The user authorized creating the public repository [ebartosh/ebartosh.github.io](https://github.com/ebartosh/ebartosh.github.io) and publishing the origin-root website. Commit `3a2cd80d1d3e2a6338f3ea46f9f63db972258fe7` adds four public files: `index.html`, `README.md`, `.nojekyll`, and `.well-known/assetlinks.json`. GitHub Pages publishes branch `main` from `/`, with HTTPS enforced. The [deployment](https://github.com/ebartosh/ebartosh.github.io/actions/runs/37805209833) completed successfully. The homepage identifies ebartosh's projects and links to Lifeboat's existing project page and source repository.

Direct HTTP checks returned 200 without redirects for `https://ebartosh.github.io/`, `https://ebartosh.github.io/.well-known/assetlinks.json`, and `https://ebartosh.github.io/lifeboat/`. The root homepage and association response exactly match the published files, and the association is served as `application/json`. Google's Digital Asset Links statements API retrieved the `delegate_permission/common.handle_all_urls` statement for `app.lifeboat.mobile` with fingerprint `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. Before publication, `apksigner verify --print-certs` verified that fingerprint against the APK installed on `RZCW4097DLF`.

This closes the missing origin-root statement described in the October 7 experiment below. It establishes that the certificate association is publicly retrievable; wallet-side identity checks, native Android App Links verification and removal of Solflare/Jupiter warnings have not been verified. No wallet signing was requested during publication. Domain association does not guarantee that a wallet will trust the site. If a warning persists, request a false-positive review for the exact identity URI and host.

Maintain root-host files in the new repository; the existing project-page preparation script still targets the separate `ebartosh/lifeboat` project site. The identity URI can remain `https://ebartosh.github.io/lifeboat/`: the root association applies to its host. Publication itself needs no APK rebuild. If restoring the URI from the current name-only configuration, restart Metro and connect freshly for a debug build; an installed standalone build needs an explicitly requested rebuild to change its embedded identity. The root file uses the current prototype test certificate and must be updated when the app signing certificate changes.

## Website content updated on October 9, 2026

The project page and root homepage now describe Lifeboat as an emergency Android client for critical actions when protocol websites or backends are unavailable, using direct chain reads, an RPC endpoint and an external wallet. The project page summarizes ORE mining and staking actions, Kamino repayment and collateral withdrawal including Multiply/eMode, Meteora withdrawal and recovery, transaction review, wallet requirements and links to current guides. Prototype status and the main operation limits remain explicit.

The project-page update is commit `50389f38c8a45015f87eeec420cd039fd34c7997` on `ebartosh/lifeboat`'s `gh-pages` branch. The root homepage and repository README update is commit `f25bc66f292faf87dc350bc2a742bb0114cdf583` on `ebartosh/ebartosh.github.io`'s `main` branch. Both updates preserve the existing certificate association files. Six browser layout checks passed for both pages at 360 px with 1x/2x text and at 960 px, including horizontal overflow and readable link labels; screenshots were inspected. Source for the project page remains [index.html](index.html), while the root homepage is maintained in its separate repository.

Both Pages deployments completed successfully. Direct HTTP checks returned 200 without redirects and verified the exact updated HTML on both sites. Both association URLs still return JSON with the expected package and certificate, and all five documentation links target existing public files. This content update does not establish new wallet compatibility results.

## Selected GitHub Pages target

On October 7, 2026, the user chose the existing `ebartosh/lifeboat` repository and `https://ebartosh.github.io/lifeboat/`. The site was published to a new isolated `gh-pages` branch, commit `ad1f5a4eb329c7d727e2ad47a592fb2d4d7e6908`. GitHub Pages reports a built deployment with source `gh-pages` and folder `/`. The earlier registered `lifeboat-solana` organization is not used for this experiment. No application worktree changes were committed or pushed.

The publishable files are:

```text
index.html
.nojekyll
.well-known/assetlinks.json
```

Generate the three files with `node scripts/prepare-wallet-identity-site.mjs` into `.cache/wallet-identity-site/`. `.nojekyll` is empty and disables Jekyll processing. Publish only the listed files to the existing repository's `gh-pages` branch. In repository **Settings > Pages**, use **Deploy from a branch**, branch **gh-pages**, folder **/(root)**. Application source stays on its existing branch; the site links to `ebartosh/lifeboat`.

HTTP verification on October 7 found the page and `https://ebartosh.github.io/lifeboat/.well-known/assetlinks.json` returning HTTP 200 without redirects. The JSON content type, package and certificate match the expected statement. However, `https://ebartosh.github.io/.well-known/assetlinks.json` still returns HTTP 404. Digital Asset Links uses the origin-root path, so the project-path file cannot verify the domain. The user chose to try the project-page URI despite this limitation. Compare name-only identity with name plus this real page URI; do not interpret any result as successful Digital Asset Links verification. Complete domain verification still needs a root-level statement or an owned custom host that can serve it.

The first captured Claim ORE with this URI returned a valid, policy-accepted Phantom signature, then stopped before submission because the blockhash expired after the updated-fee review. Reuse still returned -1 and needed fresh authorization. The user reported that Phantom displayed the host `ebartosh.github.io`, which is the configured page's actual host. Neither the successful signing nor that display proves root-domain association. See [the device result](../phantom-validation.md#observed-phantom-result).

On October 8, Solflare 2.29.1 blocked a Meteora withdrawal signed with this URI, calling it a fraudulent site; it had signed with name-only identity on October 5. The URI therefore helped Phantom but triggers Solflare's site blocklist or reputation check. The user reported a false positive to Solflare. Later that day, Jupiter showed the same malicious-site warning for the same withdrawal with this URI; it had signed with name-only identity on October 5. The user then switched local `.env.local` to name-only identity; the commented URI there restores the Phantom experiment. Changing the identity needs a Metro restart, because the Expo CLI reads `.env.local` at startup, and then a fresh **Connect wallet**. With name-only identity, Jupiter signed the full Meteora Withdraw all at 18:21–18:22. Three transactions were confirmed: the user rejected one signature and cancelled one review, and both were retried. The position account then read as closed on mainnet. The malicious-site warnings were therefore tied to the URI, not to the transaction. See the [Solflare matrix](../solflare-validation.md#automated-and-device-matrix).

References: [GitHub Pages site naming](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites), [Pages publication source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The prepared [assetlinks.json](assetlinks.json) binds `app.lifeboat.mobile` to the signing certificate of the currently installed test release. The public SHA-256 certificate fingerprint was extracted with the verified JDK and Android `apksigner`, not from an authorization token. This is the existing test signing key; replace the statement with the correct signing certificate when changing signing configuration.

[index.html](index.html) is the English project page published at `https://ebartosh.github.io/lifeboat/`. It contains no wallet state, authorization tokens, private keys, or RPC credentials. The origin-root `/.well-known/assetlinks.json` is published from the separate root-site repository described above. Wallet-side verification and acceptance still need device testing. The current certificate is a prototype test certificate; domain association is not a production trust claim.

To run the experiment:

1. Use a public HTTPS host controlled by the project owner, with a page describing Lifeboat and its app identity.
2. Serve `assetlinks.json` from `/.well-known/assetlinks.json` on that host. It must be accessible over HTTPS, return HTTP 200 with JSON content, and avoid redirects. A page under someone else's host is insufficient if the owner cannot serve this root-level file.
3. Set `EXPO_PUBLIC_WALLET_IDENTITY_URI` in the project's local environment to the actual page URL. Changing this value requires rebuilding an installed standalone release; debug needs a refreshed Metro bundle.
4. If declaring App Links for a correctly associated host, put them in Expo configuration, run Android prebuild with `--no-clean`, and rebuild using the established decision table. The current URI-only experiment has no native changes and needs no prebuild. Do not claim native App Links are configured just because a statement file exists.
5. Connect Phantom once, then test signing and repeat signing with the saved authorization while capturing the filtered log. Keep the wallet version, account and operation constant. Compare the -1/-3 behavior before and after identity configuration. A domain statement does not guarantee that Phantom will trust the app or accept its transaction.

References: [MWA identity verification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#dapp-identity-verification), [Android website associations](https://developer.android.com/training/app-links/configure-assetlinks).
