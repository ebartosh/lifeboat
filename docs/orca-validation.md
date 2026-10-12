# Orca verification record

Verified on October 9, 2026 with the environment in [development.md](development.md). This record describes implementation checks; no signed withdrawal of real funds was made.

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`, the `typecheck` script) | Passed |
| Full Vitest suite (`vitest run`, the `test` script) | 42 files, 453 tests passed, including existing ORE, Kamino and Meteora checks |
| Orca protocol tests (`tests/orca-protocol.test.ts`) | 33 passed (including settled-reward skipping and the ORCA symbol): IDL pin, recomputed discriminators, independent byte offsets, PDAs, ported math including the overflow rule, instruction bytes/roles, discovery, restrictions, plans, packing, Token-2022 receipts, close holds, simulation postconditions |
| Orca controller tests (`tests/orca-controller.test.ts`) | 8 passed: persistence order, partial restore, unknown-result recovery, final-state completion, on-chain failure, end, corrupted/conflicting records, cross-protocol resume refusal |
| Browser interface (`node scripts/check-interface.mjs`, the `test:interface` script) | 129 layout/visual cases plus interactions passed, including 11 Orca scenarios and a one-transaction review without a step count at 360 px and 1×/1.3×/2× text; no browser runtime errors |
| Apache-2.0 SDK differential (`scripts/verify-orca-reference.mjs`) | 6 checks passed with `@orca-so/whirlpools-sdk` 0.13.16: sqrt price for 11 ticks, tick array start for 70 tick/spacing pairs, and 5 position scenarios matching decoders, PDAs, liquidity amounts, fees, time-based rewards, and every instruction's bytes, account order and roles; no network calls |
| Unsigned mainnet simulation (`scripts/simulate-orca-mainnet.mjs`) | 8 public positions passed in 3 runs: empty, in-range and out-of-range positions in both SOL/USDC pools, SPL Token and Token-2022 NFTs, fixed and newer tick-array formats; 9,504–92,974 CU and 351–989 bytes; nothing signed or sent |

Corepack's cached pnpm is incomplete on this machine ([development.md](development.md)), so the `typecheck`, `test` and `test:interface` scripts were run through their Node entry points.

## Unsigned mainnet simulations

Runs on October 9, 2026 against `https://api.mainnet-beta.solana.com`, slots 454862839–454863137. Each row is the first prepared transaction for a public position, simulated with its NFT holder as fee payer.

| Pool (tick spacing) | Position | NFT | Tick arrays | Actions | CU | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| HJPj…ndJ (64) | `12WXYic6aEP4fwf3mvvcLjxhkKGYyuLcuHrEq1WZLwKD`, empty | SPL Token | fixed | close | 9,504 | 351 |
| HJPj…ndJ (64) | `13AEMdDniw6Twd7MyuMeSuoUdNQPXG1c9TLLXyRagEom`, out of range | SPL Token | fixed | remove, fees, reward 0, close (with ATA creation) | 92,974 | 935 |
| HJPj…ndJ (64) | `26V81YG5PxcSWbvCKC2V17YeunHzR3AtiiwkYNFfA4q7`, in range | SPL Token | fixed | remove, fees, reward 0, close | 46,180 | 873 |
| Czfq…44zE (4) | `11icVsZqyjFnXNtFufSSTGYafMWfu4fSMn9vgjFDK4A`, out of range | Token-2022 | fixed | remove, fees, reward 0, close | 81,187 | 989 |
| Czfq…44zE (4) | `128JnuXyXXdUq9xhy27oqLDYjpWjWgcoY6XBDZ3yg7PA`, in range | Token-2022 | fixed | remove, fees, reward 0, close | 55,244 | 905 |
| Czfq…44zE (4) | `134yQnWNKANKNbk9BK1kjfScRVVd5PQSehMYvVr6RLhY`, empty | Token-2022 | fixed | close | 18,483 | 351 |
| Czfq…44zE (4) | `4WHnxMYsA52hVDx9HuFoUT2KULsJTf5dCxT5pN9F2Vf6`, in range | Token-2022 | newer | remove, fees, reward 0 (close held for a later step) | 51,309 | 898 |
| Czfq…44zE (4) | `9HwnwM4NjDBh4fiNhU2sLAoysQsXXDCxER25Q7Ujz6JW`, out of range | Token-2022 | newer | remove, fees, reward 0 (close held for a later step) | 66,475 | 876 |

Each passing simulation also passed the plan's postconditions (zero liquidity and fees, or closed position, NFT account and Token-2022 mint; unchanged pool links; no wallet balance decrease). For the fixed-format positions in the tick-spacing-64 pool, the simulated net receipts equalled the pre-review estimates exactly (for example 79,640,244 / 8,302,225 / 22,795 base units); in the busier tick-spacing-4 pool the in-range estimate differed from the simulation by less than 0.001% (13,542,776,222 estimated versus 13,542,787,566 simulated for token A) because the price moved between the read and the simulation, which is why receipts are measured. The newer tick-array runs confirm that the deployed program accepts those arrays at the pinned PDAs. Five further attempts stopped at `InvalidAccountForFee` (the holder could not pay the simulated fee) and were recorded, not funded. Earlier attempts in the same session hit HTTP 429 on `getTokenLargestAccounts`; the script now finds holders with a mint-filtered token-account scan.

After settled rewards began to be skipped, the tick-spacing-64 run was repeated (same day, unsigned): `13AEMdDniw6Twd7MyuMeSuoUdNQPXG1c9TLLXyRagEom` now plans remove, fees, close without the ended ORCA reward (66,821 CU, 807 bytes instead of 92,974 CU and 935 bytes) and its close passed, confirming that nothing was owed; `26V81YG5PxcSWbvCKC2V17YeunHzR3AtiiwkYNFfA4q7`, which holds earlier ORCA rewards, still collects reward 0.

The close step that follows a newer-format removal, and the reward-vault shortfall path, were not reached on mainnet: an unsigned simulation cannot apply the first step's effects. They are covered by fixtures; the close instruction itself passed on the empty positions above.

The helper has no signing material, declines every review and disables submission; nothing was sent. Pool `HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ` (SOL/USDC, tick spacing 64) has reward slot 0 initialized with ended emissions, so its positions exercise reward collection and the close rules.

## Compute and size budget

The plan estimates 120,000 CU for removal, 80,000 for fee collection, 60,000 per reward collection, 50,000 for the close and 40,000 per ATA creation, below the shared 1,200,000-CU plan budget; the measured units above stay well below these estimates. Transactions are legacy and packed to at most 1,100 bytes, leaving room for wallet Compute Budget and Lighthouse additions. In fixtures, a position with one reward fits one transaction; three rewards split into two, with or without missing ATAs and Token-2022 accounts.

## Not verified here

- The full multi-transaction sequence on real funds, and external-wallet compatibility on a device. No Android build or emulator run was made: the change is TypeScript/JavaScript only, and an existing debug APK receives it through Metro.
- Tick arrays in the newer format are not decoded (see [provenance](orca-interface-provenance.md#not-covered-by-the-pinned-interface)); for those positions the review relies on simulation for fees and rewards.
- Local fixtures model account transitions and are not BPF execution.

Artifacts: `.cache/orca-reference/report.json`, `.cache/orca-mainnet-simulation.json`, `.cache/interface-check/`.
