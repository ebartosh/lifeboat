# Wallet identity verification experiment

Phantom 26.31.1 repeatedly rejected reuse with MWA error -1, accepted fresh authorization, then immediately rejected signing with -3. Lifeboat's authorization initially identified itself only by name. The user confirmed on October 5, 2026 that no project HTTPS website exists. Missing identity verification is a hypothesis, not a confirmed reason for Phantom's signing refusal.

The app now accepts `EXPO_PUBLIC_WALLET_IDENTITY_URI` for the owner's public HTTPS project page. Leave it empty until a real address exists. The URI must not contain credentials, a query or a fragment. Connection and signing use the same identity. This TS-only option does not configure Android App Links by itself, and no new APK was built without a usable URI.

The prepared [assetlinks.json](assetlinks.json) binds `app.lifeboat.mobile` to the signing certificate of the currently installed test release. The public SHA-256 certificate fingerprint was extracted with the verified JDK and Android `apksigner`, not from an authorization token. This is the existing test signing key; replace the statement with the correct signing certificate when changing signing configuration.

[index.html](index.html) is a reviewable, English project-page draft with application metadata. It has not been hosted or published. It contains no wallet state, authorization tokens, private keys, or RPC credentials. Hosting this page and the domain association is a separate external publishing action. Any deployment must serve the association from `/.well-known/assetlinks.json`, regardless of this documentation folder's source filename. The current certificate is a prototype test certificate, so this draft is for the identity-verification experiment, not a production trust claim.

To run the experiment:

1. Use a public HTTPS host controlled by the project owner, with a page describing Lifeboat and its app identity.
2. Serve `assetlinks.json` from `/.well-known/assetlinks.json` on that host. It must be accessible over HTTPS, return HTTP 200 with JSON content, and avoid redirects. A page under someone else's host is insufficient if the owner cannot serve this root-level file.
3. Set `EXPO_PUBLIC_WALLET_IDENTITY_URI` in the project's local environment to the actual page URL. Changing this value requires rebuilding an installed standalone release; debug needs a refreshed Metro bundle.
4. If declaring App Links for this host, put them in Expo configuration, run ordinary Android prebuild, and rebuild using the established decision table. Do not edit only the generated manifest or use `prebuild --clean` by default. A wallet can independently inspect the domain statement during MWA identity verification; do not claim native App Links are configured just because the statement exists.
5. Connect Phantom once, then test signing and repeat signing with the saved authorization while capturing the filtered log. Keep the wallet version, account and operation constant. Compare the -1/-3 behavior before and after identity configuration. A domain statement does not guarantee that Phantom will trust the app or accept its transaction.

References: [MWA identity verification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html#dapp-identity-verification), [Android website associations](https://developer.android.com/training/app-links/configure-assetlinks).
