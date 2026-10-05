# Kamino main-market reserve matrix

Public read-only inventory: 2026-09-28T10:57:06.193Z; discovery slot 451298610.
58 schema/version/owner/market-verified reserves; 55 unique mints.
Bundled operation support: repay 29, withdraw 29.

Support requires the existing vanilla/tag 0, elevation group 0 and classic SPL rules.
State restrictions listed below remain excluded; changing them requires a new review.
Liquidity and oracle freshness are temporary availability, not support decisions.
Farm users, wallet funds, the entire position graph, transaction size and successful simulation still apply.
LST/vault tokens are transferred as tokens only; no redemption, unstaking or exchange is implemented.

| Reserve | Mint | Symbol | Decimals | Repay | Withdraw | Exclusion / required extension | Snapshot availability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 64AZMUHLB6NYvQSt41JTer4v8NAFDCz5sUPb7dYpCxa | sctmY8fJucsJatwHz6P48RuWBBkdBMNmSMuBYrWFdrw | adraSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| StGKGcLQoTsWzQ1tFY2bWqrdiuBhqdFE4niiAutQxQB | Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ | dSOL | 9 | yes | yes | — | not an execution guarantee |
| d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q | So11111111111111111111111111111111111111112 | WSOL | 9 | yes | yes | — | not an execution guarantee |
| febGYTnFX4GbSGoFHFeJXUHgNaK53fB23uDins9Jp1E | 7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs | ETH | 8 | yes | yes | — | not an execution guarantee |
| 2EXNMnkHE5TY1wTwA9UKi3wpTvoXpFsDPeGC5GVttu5F | 3orqhCKM5admbcHkHQhRAEKbXhUT5VPgsQqz7fBa6QdF | fBTC | 8 | yes | yes | — | not an execution guarantee |
| 2UFz8kwraHybFyKhGQRwAsE5NtNpAhWs2X5grGoS7hnQ | picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX | picoSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| 2gFjdQLFaFqTKMv4nFGMAP4bX2F5KAsyiJn8yZQHPKSE | stke7uu3fXHsGqKVVjKnkmj65LRPVrqr4bLG2SJg7rh | stkeSOL | 9 | yes | yes | — | not an execution guarantee |
| 2gc9Dm1eB6UgVYFBUN9bWks6Kes9PbWSaPaa9DqyvEiN | 2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo | PYUSD | 6 | no | no | Token-2022 requires a separate extension | not an execution guarantee |
| 37Jk2zkz23vkAYBT66HM2gaqJuNg2nYLsCreQAVt5MWK | cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij | cbBTC | 8 | yes | yes | — | not an execution guarantee |
| 4AFAGAm5G8fkcKy7QerL88E7BiSE22ZRbvJzvaKjayor | JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN | JUP | 6 | yes | yes | — | not an execution guarantee |
| 4Hyrqb9Mq7y1wkq4YoqHkPdPx3VQyFY3mxMj67naC1Cb | CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn | xBTC | 8 | yes | yes | — | not an execution guarantee |
| 4eUxuaHSHNTftaui3XVW32d2Ph2hKBLpuMP25gQ5MqF4 | ZScHuTtqZukUrtZS43teTKGs2VqkKL8k4QCouR2n6Uo | wstETH | 8 | no | no | status=2 (Hidden) excluded by current operation checks | not an execution guarantee |
| 57U9pEC8NsWvHgWywd2xHTRkGQzWWYsWivxYRhtxZrLB | 9HB4kAMLSYfGFfN142DKMyPyHyZQ8pXF8M1STbDudodY | kSOLBSOLOrca | 6 | no | no | autodeleverageEnabled=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| 5YpGenXaAowj4HS33AvirVb8P4tgue7S7YaY6MyYZ7LD | 3jsFX1tx2Z8ewmamiwSU851GzyzM2DJMq7KWW5DM8Py3 | CHAI | 8 | no | no | status=1 (Obsolete) excluded by current operation checks; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| 5xXxt9uVHrcT5b1KveAT5ZWgk2f74aDjnLEDDEeAxgpN | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | USDC | 6 | no | no | status=2 (Hidden) excluded by current operation checks | not an execution guarantee |
| 6U9CnJYCQwHUEmf4Pq4oGVKHVvD29wZvtPbFNjYmgjaF | Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B | bbSOL | 9 | yes | yes | — | not an execution guarantee |
| 6pazpY4icuXZ5sb2jMWAqdG4TtbUoY1SJ45237Fjht9h | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | USDC | 6 | no | no | status=2 (Hidden) excluded by current operation checks | not an execution guarantee |
| 6vKCRnEzrxRS1NybsMVEyNE3ztFAxCz6WusiiGft1PbA | USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB | USD1 | 6 | yes | yes | — | not an execution guarantee |
| 75WrtSz7rLCdBvAQhtHi8M2jC8HnpT8iUxcYkdeawr37 | GYiUmJ8reqYAdTQtx6CRFawHqPXx9yzkUFvaUVE8PskP | kSOLJITOSOLRaydium | 6 | no | no | autodeleverageEnabled=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| 8gVpWfWDCtCcUX1meSphqqpyWBceLCcrs9yEXwKKjQrL | sctmTAsDn4tLUcemqoqYijfuRkiEfAMPi84PNq2EueR | nxSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| 8qnVHjKMcWAdkFnKvmRigj9J7UAVj2ooJ83GfeNn2DpR | cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm | fwdSOL | 9 | yes | yes | — | not an execution guarantee |
| 9JB9EMxEp9gZy3i1jqD2yvNYWKRZCP6f3drdQw853swH | 7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj | STSOL | 9 | no | no | status=1 (Obsolete) excluded by current operation checks | zero recorded withdrawal liquidity |
| 9Ukd2MSw5RvVFaN8jLhWxjHLEGiF1F6Hf7v3Zq5hZsKB | jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL | JTO | 9 | yes | yes | — | not an execution guarantee |
| A2J2CEwmwa9aTKbEfNoik6YTyNep9GtvNjU65okWYhwn | strng7mqqc1MBJJV6vMzYbEqnwVGvKKGKedeCvtktWA | strongSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | USDC | 6 | no | no | status=2 (Hidden) excluded by current operation checks | not an execution guarantee |
| ApQkX32ULJUzszZDe986aobLDLMNDoGQK8tRm6oD6SsA | CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH | CASH | 6 | no | no | Token-2022 requires a separate extension | not an execution guarantee |
| AxuWrPrJfwrUTvCWRxpkSQct6q8k1YSJzxhyYw2AAmv2 | 4G9USgnbg6fDTQ5AUfpCjM89zqbzWj32xfqvsaAu66DM | kUXDUSDCOrca | 6 | no | no | autodeleverageEnabled=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| B5uYvxUcwX5fCB4msGU4DaHh8k6fsSkKHNboy94F9vbt | HUBsveNpjo5pWqNkH57QzxjQASdTVXcSK7bVKTSZtcSX | hubSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| BHUi32TrEsfN2U821G4FprKrR4hTeK4LCWtA3BFetuqA | USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA | USDS | 6 | yes | yes | — | not an execution guarantee |
| Bpc4kAh29J3YDQUMJJdGdr1zBAhTQjC48R1B8YTWudsi | 9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u | FDUSD | 6 | yes | yes | — | not an execution guarantee |
| BvafE5Sm6rLrBbVRtJ2FkCzfNJQ2TjcL8bvPZULUDYrt | CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE | cgntSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| CExamod1Ai3d1N8Vh7sBjt5xbZzb2VmGMAFocf7fxCzm | he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A | hSOL | 9 | yes | yes | — | not an execution guarantee |
| CHBNUPdjeo2N5QkZY2uAqv7TW5EbCTMsfvaskCBuxbom | vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7 | vSOL | 9 | yes | yes | — | not an execution guarantee |
| CkgQnPbuHHwSv2mNdAKH79TKSqC6jsyttK9yh4MPH6z3 | sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx | dfdvSOL | 9 | yes | yes | — | not an execution guarantee |
| D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | USDC | 6 | yes | yes | — | not an execution guarantee |
| DGQZWCY17gGtBUgdaFs1VreJWsodkjFxndPsskwFKGpp | jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v | JupSOL | 9 | yes | yes | — | not an execution guarantee |
| DaGyAQJrdkLCzYZiUWg49NV8vabDnhR7ETwLu5eQgL56 | USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX | USDH | 6 | no | no | status=1 (Obsolete) excluded by current operation checks; autodeleverageEnabled=1 excluded; disableUsageAsCollOutsideEmode=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| EAA3VVsxUuQB1Tm5x7TJkq9ATtiX5Qwq8ok7gXwim7oo | 27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4 | JLP | 6 | yes | yes | — | not an execution guarantee |
| EGPE45iPkme8G8C1xFDNZoZeHdP3aRYtaAfAQuuwrcGZ | HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr | EURC | 6 | yes | yes | — | not an execution guarantee |
| ESCkPWKHmgNE7Msf77n9yzqJd5kQVWWGy3o5Mgxhvavp | 2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH | USDG | 6 | no | no | Token-2022 requires a separate extension | not an execution guarantee |
| EVbyPKrHG6WBfm4dLxLMJpUDY43cCAcHSpV3KYjKsktW | J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn | JITOSOL | 9 | yes | yes | — | not an execution guarantee |
| FBSyPnxtHKLBZ4UeeUyAnbtFuAmTHLtso9YtsqRDRWpM | mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So | MSOL | 9 | yes | yes | — | not an execution guarantee |
| FMbsZf4HuQ1a8a7VdmALT3S8WRfu3EocphRKPXxRsfGd | CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX | cdcSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| FPAwg5jadDs8AvUtvtAbit2RCZdkZES6yY5X6nCSuEw9 | 3Fb5DMRWoBLWD36Lp4BtG41LaFjVeEJNCH9YLNPYdVqj | kSOLMSOLRaydium | 6 | no | no | autodeleverageEnabled=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| Fqjbo3L4NAyzPcy6swv1XXLm1c7tUTKWMDkjCo9mfSDq | BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85 | bnSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| G31zKdH2SkDZPhmoQraep5xbTSPyk3VZxAeBdC3nmq5J | StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT | STEP | 9 | no | no | status=1 (Obsolete) excluded by current operation checks; withdrawal oracle: unsupported Scope conversion chain | zero recorded withdrawal liquidity |
| GFLLgX9V6PR1PzhgsGzeyUddpt2ws2PBRAxRwoLrboGp | Dk2X1HCbwJae44P7FpqdFoeT6LEw4JVyyHvZMHUzHWbi | kSOLJITOSOLOrca | 6 | no | no | status=1 (Obsolete) excluded by current operation checks; autodeleverageEnabled=1 excluded; withdrawal oracle: unsupported Scope conversion chain | not an execution guarantee |
| Ggn9EUzL5QQPM8JPsyu1MU1uD3rGJty7iXddLQnmxPyS | xStpgUCss9piqeFUk2iLVcvJEGhAdJxJQuwLkXP555G | xSTEP | 9 | no | no | status=1 (Obsolete) excluded by current operation checks; non-Scope oracle requires a separate withdrawal extension; withdrawal oracle: unsupported Scope conversion chain | zero recorded withdrawal liquidity |
| GhGPbkWmPjSkbkgZbhNGBTxzwQKjqDpZwNfaf2gQKgdG | 7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT | UXD | 6 | no | no | status=1 (Obsolete) excluded by current operation checks; autodeleverageEnabled=1 excluded; disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| H3t6qZ1JkguCNTi9uzVKqQ7dvt2cum4XiXWom6Gn5e5S | Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB | USDT | 6 | yes | yes | — | not an execution guarantee |
| H9vmCVd77N1HZa36eBn3UnftYmg4vQzPfm1RxabHAMER | bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1 | bSOL | 9 | yes | yes | — | not an execution guarantee |
| HD93Fq3gmVh3J7euJJ5MBw8Ph3ebeMFS699JQePN4XgN | 7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn | jSOL | 9 | yes | yes | — | not an execution guarantee |
| HMCXsf1jFUDbvGGhvUzCzwkKbmUhxhxz7gYZwXpTuReT | LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X | laineSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| HV9KsS5mB4b9CFhDJVKdfxWBAomYfUk5PeUsdgMQsUrB | pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL | pSOL | 9 | yes | yes | — | not an execution guarantee |
| HYnVhjsvU1vBKTPsXs1dWe6cJeuU8E4gjoYpmwe81KzN | 3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh | WBTC | 8 | yes | yes | — | not an execution guarantee |
| Hcz1o77tF9TpdEHcvrx29tz7SBKoQEwJA1wuJqGZYnTw | 6DNSN2BJsaPFdFFc1zP37kkeNe4Usc1Sqkzr9C9vPWcU | tBTC | 8 | yes | yes | — | not an execution guarantee |
| Ht9NoB1udjpRqws1sCw1j2dL7MeTDHYCDdDFkbc1Arst | BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs | bonkSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
| J5oj3VKWQNKRZx3heWZx7JZC59AEDQ9UQwqqiy63nCuf | LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg | lanternSOL | 9 | no | no | disableUsageAsCollOutsideEmode=1 excluded | not an execution guarantee |
