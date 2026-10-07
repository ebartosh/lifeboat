# Wallet identity verification experiment

Phantom 26.31.1 repeatedly rejected reuse with MWA error -1, accepted fresh authorization, then immediately rejected signing with -3. Lifeboat's authorization initially identified itself only by name. The user confirmed on October 5, 2026 that no project HTTPS website exists. Missing identity verification is a hypothesis, not a confirmed reason for Phantom's signing refusal.

The app accepts `EXPO_PUBLIC_WALLET_IDENTITY_URI` for the owner's public HTTPS project page. The URI must not contain credentials, a query or a fragment. Connection and signing use the same identity. This TS-only option does not configure Android App Links by itself. The October 6 diagnostic APK uses name-only identity. On October 7, the user selected a project-page URI experiment and the local `.env.local` was set to `https://ebartosh.github.io/lifeboat/` after verifying the public page. This is a URI-only experiment, not verified domain identity.

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

References: [GitHub Pages site naming](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites), [Pages publication source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The prepared [assetlinks.json](assetlinks.json) binds `app.lifeboat.mobile` to the signing certificate of the currently installed test release. The public SHA-256 certificate fingerprint was extracted with the verified JDK and Android `apksigner`, not from an authorization token. This is the existing test signing key; replace the statement with the correct signing certificate when changing signing configuration.

[index.html](index.html) is the English project page published at `https://ebartosh.github.io/lifeboat/`. It contains no wallet state, authorization tokens, private keys, or RPC credentials. Fully verified domain association still requires `/.well-known/assetlinks.json` at the origin root, regardless of this documentation folder's source filename. The current certificate is a prototype test certificate; this page is for the identity experiment, not a production trust claim.

To run the experiment:

1. Use a public HTTPS host controlled by the project owner, with a page describing Lifeboat and its app identity.
2. Serve `assetlinks.json` from `/.well-known/assetlinks.json` on that host. It must be accessible over HTTPS, return HTTP 200 with JSON content, and avoid redirects. A page under someone else's host is insufficient if the owner cannot serve this root-level file.
3. Set `EXPO_PUBLIC_WALLET_IDENTITY_URI` in the project's local environment to the actual page URL. Changing this value requires rebuilding an installed standalone release; debug needs a refreshed Metro bundle.
4. If declaring App Links for a correctly associated host, put them in Expo configuration, run Android prebuild with `--no-clean`, and rebuild using the established decision table. The current URI-only experiment has no native changes and needs no prebuild. Do not claim native App Links are configured just because a statement file exists.
5. Connect Phantom once, then test signing and repeat signing with the saved authorization while capturing the filtered log. Keep the wallet version, account and operation constant. Compare the -1/-3 behavior before and after identity configuration. A domain statement does not guarantee that Phantom will trust the app or accept its transaction.

References: [MWA identity verification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#dapp-identity-verification), [Android website associations](https://developer.android.com/training/app-links/configure-assetlinks).
