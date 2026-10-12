# Lifeboat interface requirements

Perpetuals scope decision (October 11, 2026): retain only Jupiter Perps as a candidate for full-position closing during a website/API outage while keepers and accepted price feeds remain available. GMTrade and Pacifica are excluded from this integration scope. Jupiter request creation must not be presented as a completed position exit; a possible integration needs separate request, execution and payout states. This feature is not implemented or validated with a funded position; see [perpetuals feasibility research](perps-feasibility-research.md).

Status: implemented in React Native; verified in the browser test harness. Meteora positions and withdrawal review are also checked on the Android debug emulator. Far Manager is the structural reference: working panels, data rows, double borders, a path, a command bar, and a dialog above the list. The color scheme is **light**: the overall background is white, with small filled areas highlighting the current object and important action.

Agreed preferences: white main background, blue text, contrasting local fills, double borders, and a file manager character. The typefaces, sizes, highlight shades, and panel arrangement below are proposals for the first mockup; assess them together on a phone screen.

## 1. Principle

Lifeboat resembles a tidy file manager for financial positions. Select a protocol and entry in the list; read details and perform an action beside or below it. The interface should be dense, orderly, and quick to scan while keeping amounts, addresses, and fees readable.

Large surfaces remain white. **Local fills** create contrast: one selected row, the current status, and the primary action. Double borders distinguish panels and dialogs. Corner radii are minimal, 0–4 dp. Do not use shadows, gradients, or decorative illustrations.

## 2. Color system

The launcher logo retains the original pixel-art orange-and-white lifebuoy, navy boat, two blue waves, and shading. The four exterior rope loops were removed on October 9, 2026 to simplify the silhouette. `assets/icon.png` is the approved image; `assets/adaptive-icon.png` uses the same image with additional centered padding for Android launcher masks. This limited logo edit does not change the flat styling of interface controls.

| Role | Color | Use |
| --- | --- | --- |
| Base background | White `#FFFFFF` | Screen, panels, inputs, dialog |
| Primary text | Navy `#163B73` | Names, amounts, addresses, statuses, important area borders |
| Active text | Blue `#2F6FE4` | Current path, links, available commands |
| Selected row | Soft orange `#FFD2B0` | One active entry with navy text |
| Secondary fill | Light blue `#EAF3FF` | Status bar, panel heading, informational label |
| Thin separators | `#DCE6F2` | List rows and detail groups; decorative lines only |
| Primary action | Orange `#FF7A1A` | Local button fill with dark `#20334D` text |
| Secondary text | Slate `#4A6287` | Field labels, explanations, panel info lines |
| Headers | Amber `#7A4A00` | Column titles and section headings, like Far Manager's yellow titles |
| Token symbols | Teal `#006670` | Symbols after amounts and in pair names |
| Addresses | Cobalt `#1D5A9E` | Addresses and identifiers, including the wallet command |
| Status | Green `#1E6B34` / red `#A63838` | Supported or confirmed / unavailable or error status words |
| Hotkey letter | Dark orange `#C2410C` | Underlined first letter of commands on white and light-blue surfaces |

On white, `#163B73` has approximately 11:1 contrast, `#2F6FE4` approximately 4.65:1, and `#FF7A1A` approximately 2.61:1. Use **blue text on white**. Orange is a fill with dark text rather than a small text color. Use navy on `#FFD2B0` for the selected row: it resembles the warm reference highlight and remains readable.

Fills occupy a small part of the screen, leaving the workspace white. Use `#F7FAFD` only for a disabled input that would otherwise disappear against white. Errors and dangerous actions need explicit text; color must not be their only signal.

Highlight groups follow Far Manager: each color has exactly one meaning and appears only in that role. Amounts stay navy and remain the strongest text. Every highlight color keeps at least 4.5:1 on white, on the selected row, and on light blue where it appears. Slate fails on the selected row, so row details switch to navy there. Bright blue command text reaches only about 3.3:1 on soft orange and stays out of selected rows.

Soft orange marks the selected entry and is not simultaneously used for normal labels. Light blue marks supporting information. Bright orange marks the primary action. Use navy or `#20334D` text on colored fills; reserve bright blue for white backgrounds. Label errors “Error” with an explanation and confirmed results “Confirmed”. Do not reduce an entire row's opacity to make important data look secondary.

## 3. Typography

The font pairing retains the Far Manager character and the original preference for serifs.

| Role | Proposed font | Size | Use |
| --- | --- | --- | --- |
| Working rows | IBM Plex Mono, system `monospace` fallback | 14–16 sp | Lists, addresses, numbers, path, command bar |
| Serif headings | IBM Plex Serif, system `serif` fallback | 20–26 sp | Dialog titles, selected position name, large amount |
| Secondary labels | IBM Plex Mono | 12–13 sp | Entry types and column names; not important fees |
| Protocol tabs | IBM Plex Mono SemiBold | 14 sp | Kamino, Meteora, Orca, ORE |

Commands are bracketed labels, as in Far Manager dialogs: `[ Details ]`. They have no border box. The primary financial action is the only filled command: `[ Claim SOL ]` on a 28 dp orange band with dark text. Pressed commands show a band behind the label (light blue with navy text; lighter orange for the primary action), hardware keyboard focus adds a blue outline, and disabled commands show a gray band with slate text. Every command keeps a 48 dp touch target around its label. Brackets are visual only; screen readers announce the plain command name.

Interactive labels underline their first letter, as Far Manager marks hotkeys. On white and light-blue surfaces the letter is also dark orange; on the orange primary action and the danger command it is only underlined. The wallet command marks the first character of the shortened address. Disabled commands drop the marker. List rows, which use `>` for selection, and icon-only commands are exempt. The letters are visual markers, not keyboard shortcuts; screen readers read the whole word.

Text edges align. A borderless command's label starts on the same edge as the text around it, and a command at the end of a row ends on the right content edge; its touch padding extends into the margin.

Fonts are predominantly blue. Do not turn every row into a serif heading: serifs establish character, while monospace supports exact comparison. Before implementation, check English letters, digits, `≈`, `…`, addresses, and `ORE/SOL` symbols; bundle font files so results do not depend on the device.

Use regular and medium weights, excluding thin or decorative styles. Line height is approximately 1.35–1.5 times font size. Disable programming ligatures in addresses and technical identifiers. Check `0/O` and `1/l/I` distinction and redistribution terms for the font files. Large detail amounts may use serifs; tabular amounts remain monospaced.

List numbers are right-aligned with equal-width digits. Do not truncate amounts with ellipses. A row may shorten an address, but details and confirmation expose the full address and allow copying.

Every number includes its token. Mark rounded estimates with `≈`; a small nonzero value must not become `0`. Expose the full value in details. Copy the original address without visual line breaks and show “Address copied”. All user-facing labels, buttons, messages, and accessibility text are in English; token symbols, protocol names, and identifiers remain unchanged.

## 4. Panels and navigation

### Phone, up to 719 dp

Place the list above brief details of the selected entry. Both areas have double blue borders on white and share one scroll flow. Do not create two small, independently scrolling areas on phones. Open long details and operation forms separately, returning to the previous selection and list position. The header has no visible app name; "Lifeboat" remains a screen-reader heading. The RPC status sits at the upper left as `[ RPC ● ]`. Show the wallet command, labeled with the shortened address in cobalt, and a circular-arrow refresh command at the upper right. When enlarged text needs more room, RPC and refresh share the first line and the wallet command moves to a second line, aligned right. Protocols form a full-width tab bar below; the selected tab has a light-blue fill and a 3 dp navy bar. When the labels no longer fit side by side, the tabs stack vertically and the navy bar moves to the left edge. There is no separate path line: the tab and the panel titles identify the location. There is no bottom command bar.

The app pings the configured RPC once at startup. The status mark is a hollow navy circle while checking, a filled green circle when the RPC answered, and a red cross when it did not; the shape differs in each state, so color is not the only signal. An unreachable RPC also shows an error note below the header. The status is not a command and is not rechecked on refresh. The status bar may scroll with content when height is limited. Keep commands and inputs clear of the keyboard and respect top and bottom system insets.

```text
[ RPC ● ]            [ AB12…CD34 ]  [ ↻ ]
[  ORE   |  Kamino  |  Meteora  ]
╔═ ORE · Positions ════════════════════════╗
║   Position                      Amount   ║
║ > SOL rewards                0.024 SOL   ║
║   Rewards                                ║
║   ORE rewards               12.800 ORE   ║
║   Rewards                                ║
╚══════════════════════════ Read 12:41 ════╝
╔═ SOL rewards ════════════════════════════╗
║ 0.024 SOL                                ║
║ [ Details ]                [ Claim SOL ] ║
╚══════════════════════════════════════════╝
╔═ Meteora · Positions ════════════════════╗
║   Position                      Amount   ║
║ > WSOL / USDC             ≈0.0106 WSOL   ║
║                           ≈0.4952 USDC   ║
║   DAMM v2 · 8LJ7…c8E9                    ║
║   JUP / USDC                             ║
║   DAMM v2 · 1111…1114          Vesting   ║
╚══════════════════════════ Read 12:41 ════╝
```

This structural sketch uses sample data. The row with `>` receives a fill; verify double borders and exact sizes in the visual mockup. App data determines action availability.

Every protocol list uses the same row: the panel is titled *Protocol* · Positions with the columns **Position** and **Amount**. The amount is what the row holds or what its main action recovers: one token for Kamino and ORE, and each token Withdraw all returns for Meteora and Orca (the details pane's **You receive** estimate). A red status (`Unavailable`, `Vesting`, `Locked`, `Partial`) appears on the second line only when something limits the action, so a fully recoverable position has no label. Orca's in-range indicator was removed because it does not affect withdrawal.

### Wide screen, from 720 dp

Place panels side by side: protocols and positions on the left, details on the right. Each panel has its own double border, as in the reference. Wallet and refresh commands remain at the upper right. The left panel must fit the name and primary value without horizontal scrolling.

720 dp is an initial guide. With enlarged text or insufficient room, use sequential list/detail viewing even on wide screens. Selecting an entry opens details without running an operation. Preserve selection by identifier on refresh rather than row number. Reset previous details and amounts on wallet changes.

### Double borders and selection

Main panel: 1 dp navy outer line, 2 dp white gap, and 1 dp blue inner line. Dialogs use the same scheme, with an optional 2 dp outer line. Apply double borders to panels and dialogs; separate internal rows with one thin line. On phones, borders must not take space away from amounts or touch targets.

Draw borders with UI lines, not font characters. Leave 8–12 dp between the inner border and content. The panel title interrupts the top line, as in the reference; a long title wraps and the line meets it at its vertical center. An optional info line, such as the read time, interrupts the bottom line at the right. Lists show every row, with no item counter and no scroll area of their own. If a list becomes long, show the first entries and a “Show all (N)” command instead of nesting a scroll view. Base spacing increment: 4 dp. Do not add double borders inside entries.

The selected row uses a solid soft orange fill and navy text as the primary contrast signal, plus `>` or a short vertical marker on the left. Hardware keyboard focus has a separate blue outline to distinguish it from selection. Only one row per panel is filled at a time.

## 5. Rows and commands

- Row and button touch targets are at least 48 × 48 dp for this Android interface. Achieve density through typography rather than smaller touch targets.
- Lists show a short name, type, and one primary number under an amber column-header row; place long explanations in details.
- Refresh is a bracketed circular-arrow command, `[ ↻ ]`, beside the wallet command, with an English accessibility label. Disable it when disconnected, loading, or locked by an operation. The primary financial action uses the orange band and a dark label. Avoid multiple equally bright adjacent commands.
- In a details panel, **Details** sits on the left and the financial actions on the right, with the primary action rightmost, as in the dialog footer.
- Protocol tabs replace the path line. The selected tab is shown by fill and the navy bar, not by color alone. The order is Kamino, Meteora, Orca, ORE, and Kamino opens first. At 2× text the four tabs stack.
- Explain an unavailable action with one note directly below the commands rather than several stacked sentences.
- Financial actions stay with their selected entry. Wallet switching is available inside Wallet details; there is no duplicate bottom command bar.
- Loading, empty lists, RPC errors, unsupported positions, and pending confirmation appear as text within the same border system.

On refresh, do not replace unknown values with zero or show “No positions” before loading finishes. If retaining old data, show its read time and “Refreshing…” or “Could not refresh”. Explain disabled actions clearly; selection, pressed buttons, and running operations must look different. During submission, show the current phase and prevent duplicate presses. Changing selection must not move an open form to another position.

## 6. Financial operation dialog

Confirmation opens as a white dialog with a double blue border over the main screen. Its header (title, plus a subtitle with the action and, for a multi-step withdrawal, `step N of ≈M`; the count is approximate because each step is re-planned from fresh state, and it is omitted when the withdrawal is one transaction ending in the close) and its command footer stay fixed; only the content between them scrolls. Show, in order: the simulation result on a light-blue fill, the amount, or for Meteora this step's receipts and costs, then costs and cost warnings, remaining totals for multi-step operations, and finally the accounts: full wallet address, recipient or source, and position and reserve where applicable. Values use label/value rows with amber section headings. The footer holds `[ Cancel ]` on the left and the orange `[ Sign and send ]` command with dark text on the right. Long addresses wrap and can be copied. For an unknown submission result, show the transaction signature and “Check status”. After a confirmed or failed result, an “On-chain result” section shows the wallet's token balance changes, SOL balance change and network fee, read with `getTransaction` from the same RPC (for Meteora, summed over every confirmed step). It replaces the simulation estimate with measured values. It appears once the RPC serves the transaction, is omitted if the RPC cannot, and never changes the reported status. No explorer or indexer is involved.

On small screens, confirmation takes almost the entire screen and scrolls; do not compress data into a desktop Far window. “Cancel” applies to preparation or confirmation before submission; closing a window after submission must not imply transaction cancellation. Focus and screen reader navigation stay within the open dialog and return to the originating action when it closes.

## 7. Mockup acceptance criteria

1. At 360 dp width, the current protocol, selected position, wallet, and available action are visible without horizontal scrolling.
2. The workspace is white. Local fills distinguish the selected row, status, and primary action without turning the screen into colored cards.
3. Test 1×, 1.3×, and 2× text and a low screen with the keyboard open. Rearrange columns and panels when space is insufficient; do not force smaller text.
4. Primary amounts, fees, and full addresses remain readable and untruncated in confirmation.
5. Selection, focus, error, and confirmation are distinguishable without relying on color.

## 8. Relationship to the current prototype

The intermediate screen with a navy wallet panel and cards has been replaced by a white layout with local fills and double borders. Financial operations, RPC, validation, calculations, simulation, signing, and submission continue using their existing implementations.

## 9. Implementation decisions and verification

- Known transaction expiry before submission explains that the operation was not sent and asks the user to prepare again, complete wallet approval and fee review without long pauses, and check the details before approving. Meteora retains confirmed steps and offers resume. Unknown submission results retain status checking and block retry; they never receive this advice. The expiry message uses the existing operation dialog and unrestricted text scaling.
- Shared components live in `src/mobile/Interface.tsx`, `ActionButton.tsx`, and `theme.ts`: panels, dialogs, selection rows, messages, inputs, copying, colors, and typography. Panel borders are 1 dp navy / 2 dp white / 1 dp blue, drawn from edge views so the title and info line interrupt them without absolute positioning; dialog outer borders are 2 dp. Panel padding is 8 dp, dialog padding 12 dp. `ActionButton` draws bracketed commands: the label sits in a band view inside a 48 dp pressable, borderless commands pull their 8 dp touch padding into the margin (`align` chooses the side), and the primary band is flush with its brackets. Inputs have 2 dp corners; nothing has shadows. `ListHeader`, `DataRow` (fixed-width `>` column), `Field`, `Section`, `Amount`, `Tabs`, `Note` and the dialog `subtitle`/`actions` props implement the layout. `Amount` groups digits for display only and colors the token; copied values and inputs stay ungrouped. Address copying is an inline `[ Copy ]` command, right-aligned, whose accessibility label stays “Copy: <label>”. Wallet details has no subtitle; it shows the full address under the label “Address” and lists **Switch wallet**, **Wallet signature check** and **Disconnect wallet** as a plain bracketed stack.
- Working text uses IBM Plex Mono Regular 14/20 sp, labels Mono Medium 12/18 sp, commands Mono Medium 14/20 sp, tabs Mono SemiBold 14/20 sp, panel titles Mono Medium 13/18 sp, notes Mono Regular 13/18 sp in slate, and headings and large detail amounts Serif Medium 22/30 sp. Text scaling is unrestricted. Long numbers wrap without rounding or ellipses; unknown values are not replaced with zero. Address ligatures are disabled. Selection uses `>` and soft orange, with separate hardware focus styling.
- External wallets are the only wallet source. **Connect wallet** at the upper right and **Switch wallet** inside Wallet details directly open the MWA connection flow. Wallet details also expose **Disconnect wallet**. Switching closes the details dialog before opening the wallet. JSON keypair import, local-key details and local wallet signing have been removed; legacy key files remain untouched and unused.
- Manual external wallet connection requests fresh permission instead of silently reusing the old authorization. The status explains approval and return to Lifeboat, and connection failures distinguish session establishment, authorization, and return/account validation. Cancelling retains the previous wallet.
- Signing requests fresh connection permission only after the MWA authorization-failed code, rather than on every error. Renewed permission for the same account is persisted before signing. Logs distinguish wallet refusal to sign from an explicit cancellation; no transaction is sent after a refusal.
- Wallet details exposes a separate **Wallet signature check** dialog. It explains that the memo is signed and verified locally without submission or a network fee. **Sign memo without sending** is an explicit user action; settings and financial operations remain locked during the check. The result stays in the dialog, and retry becomes available after completion. This diagnostic uses strict unchanged-message validation, independently of the bounded addition policy for financial operations.
- Wallet connection troubleshooting uses fixed log milestones rather than exposing request payloads in the interface. The capture helper filters native MWA logs, which may otherwise contain authorization tokens. Approval behavior must be checked on the target wallet and device.
- The public project page follows the white background, blue text and double-border direction. Its October 9 content presents Lifeboat as an emergency client, explains supported ORE, Kamino and Meteora recovery actions and their main limits, and links to the protocol guides and application source. The page is published from `gh-pages` in `ebartosh/lifeboat` at `/lifeboat/`; the separate `ebartosh.github.io` homepage carries a matching summary. Content uses one readable column with wrapping at enlarged text sizes. Six browser checks cover both pages at 360 px with 1x and 2x text and at 960 px; screenshots were inspected. The origin-root certificate association was published on October 8 and remains separate from website reputation or verified wallet compatibility. No verified-identity label is added to the app.
- Transaction diagnostics distinguish a signing request, a returned response, local signature validation, RPC submission, and confirmation. Fixed failure categories and numeric instruction errors go to the filtered log; wallet/RPC payloads are excluded. Instrumentation does not change approval, submission, or unknown-result recovery.
- Rejected wallet message mutations produce instruction diagnostics with program IDs, known instruction kinds, numeric operands and anonymous account references. Memo text, unknown payloads, wallet/account addresses and credentials are excluded. Instruction matching is diagnostic only; it does not authorize a modified transaction or bypass the existing message/signature checks.
- External-wallet responses may pass a separate bounded policy for compute settings and fully decoded Lighthouse account/token postconditions. Original operations, account roles, signer/fee-payer/lifetime context and signatures remain checked. Permitted modified responses are re-simulated and receive a second review showing the actual network fee and priority component; **Send transaction** submits the already signed version without another wallet handoff. Unknown additions stop before submission. See [Solflare validation](solflare-validation.md) for limits and the device matrix.
- The October 7 Phantom approval flow took 48.2 seconds while historical data showed a roughly 41-second fresh blockhash window at the observed production pace. Both user reviews remain required; the timing finding does not justify hiding wallet changes or bypassing expiry checks. Any future remaining-time display must derive from block heights and clearly distinguish expired preparation from submitted/unknown status. See [expiry evidence](blockhash-expiry.md).
- Bundle IBM Plex Mono Regular/Medium/SemiBold and Serif Regular/Medium with their SIL Open Font License 1.1 files. SemiBold comes from IBM's official `IBM/plex` repository (revision 2.005; the other Mono weights are 2.003). The Fonts and license command and dialog have been removed from the interface. Font loading has explicit loading, error, and retry states. Font tests check English letters, technical symbols, distinguishable `0/O` and `1/l/I`, monospaced number widths, and the bundled license. Color tests check text contrast of at least 4.5:1, including every highlight color on each surface it appears on and labels on the pressed and disabled command bands, and at least 3:1 for non-text marks: input borders, the refresh icon and the RPC status marks. Bracketed commands are identified by their text, so their bands need no 3:1 edge.
- Phones show list and details in one scroll flow; wide screens use adjacent panels when space permits. Details and amount forms open in dialogs. Selection persists by entry identifier through refresh/reordering; wallet changes reset it. Selecting a row does not run an operation. Full addresses and transaction signatures can be copied with feedback.
- ORE rows cover SOL rewards, ORE rewards, and direct staking. Kamino rows show debt, collateral, unavailable positions, and separately validated repayment candidates. The operation dialog shows simulation, amount and fee estimates, wallet/source/recipient, applicable position/reserve, account creation costs, and status checking for uncertain results.
- The Kamino repayment dialog shows quiet `[ Full debt ]` and, for a token ATA, `[ Wallet balance ]` commands below the amount input; they fill `all` or `balance`, which can also be typed. Amount inputs do not echo their value below the field, and the note below does not repeat these keywords; it only states that a balance above the debt repays just the debt. Native SOL repayment hides `[ Wallet balance ]` and rejects `balance`.
- A successful wallet connection shows no notice; the address in the header is the confirmation.
- The `Operation · Status` panel sits directly under the protocol tabs, above the positions, because an operation that holds the lock disables actions on every tab. Its status uses the selected-row fill (the operation is the current object) and names the operation, such as `Meteora · Withdraw all · 2 steps confirmed`. While the lock is held it states that other actions are blocked. After the dialog is closed, the panel carries `[ Info ]` and the next step (`[ Resume withdrawal ]` or `[ Check status ]`); while the dialog is open, only the dialog shows them. A finished result that no longer holds the lock also carries `[ Close ]`, which removes the panel until the next operation. A pending signature, a withdrawal checkpoint or an unreadable record keeps the panel.
- Kamino entries of a Multiply or eMode position carry one slate note under the amount, in the details pane and in the Details dialog. It names the Multiply position and that Lifeboat unwinds it only from wallet funds, and names the eMode group and the LTV Kamino applies. Vanilla positions show no note.
- Kamino entries of a position with debt carry a second slate note with Kamino's LTV, max LTV, liquidation LTV and health. The note states that Kamino stored these values at the position's last on-chain refresh and gives that refresh's approximate age from the slot difference (~0.4 s per slot). Ratios round toward liquidation. The Kamino withdrawal review adds a **Position before withdrawal** section with the same four fields from the refresh simulation. The values are informational: Lifeboat doesn't refresh a position only to show them, and doesn't block an operation on them. Repayment review omits the section because its price-free refresh would show values at cached reserve prices.
- Meteora rows identify a selected DLMM position by token pair and address. Details show liquidity, fees and rewards per token, full pool/mint/position addresses, and explicit restrictions. Withdraw all preserves original tokens and explicitly keeps WSOL wrapped. Each signature review lists the step's actions (remove, claim fees, claim reward with bin ranges, close) and shows the owner recipient, simulated step receipts, estimated remaining receipts, network fees, ATA rent, position rent refund and remaining step count. Progress distinguishes confirmed steps, partial completion, cancellation and unknown results. Resume re-reads state; a pending signature exposes only status checking. Complete status requires a verified closed position.
- DAMM v2 rows share the Meteora panel with DLMM rows and carry the type `DAMM v2`. Their status is `Unlocked` when Withdraw all closes the position, `Vesting` or `Locked` when liquidity stays locked, `Partial` when dust or the NFT account keeps it open, and `Unavailable` for a position that cannot be read; a status that also disables the action is shown in the danger color. Details show unlocked, vesting and permanently locked liquidity as token estimates, fees, rewards per slot, the next unlock point and, when the position stays open or a frozen reward vault forfeits a reward, a notice saying so. Withdraw all is one transaction: its review has no step count and lists the actions (release matured vesting, claim fees, remove all unlocked liquidity, claim or forfeit reward N, close and burn the NFT), measured receipts, network fee, ATA rent, rent refund and why the position stays open. Status and recovery use the single-transaction pending-signature flow (`Meteora DAMM v2 · Withdraw all`). A failed DAMM v2 read shows its own error without disabling DLMM rows.
- Orca rows follow the Meteora pattern: token pair, `Whirlpool` type, short position address, and a status of In range, Out of range or No liquidity; position bundles and locked or otherwise unsupported positions stay listed as Unavailable with a restriction note. Details show liquidity, fees and rewards per token (fees and rewards as `≥` lower bounds with a note when a tick array is outside the pinned format), a notice when a reward vault cannot pay in full, and full position, pool, NFT and mint addresses. Review lists position-wide actions (remove 100% liquidity, collect fees, collect reward N, close and burn the NFT) without bin ranges, and adds a note when the close follows in a later step or must wait for a reward vault. Operation status names `Orca · Withdraw all`; resume, end, unknown-result and confirmed states reuse the Meteora flow.
- Meteora token details and review explicitly label wallet receipts after transfer fees. Gross liquidity/fee/reward estimates remain distinguishable from net wallet receipts. Position details (Meteora DLMM, DAMM v2 and Orca) use the transfer-fee labels only when a position token or reward has a Token-2022 transfer fee; otherwise they read **You receive · est.** and **Breakdown · estimates**, because the breakdown adds up to the receipt and "before fees" above a larger total read as if the earned trading fees had been subtracted. A fee-bearing simulated receipt exposes its gross transfer and withheld fee, and explains that withheld fees are unavailable to spend. Future fees use the current simulated epoch and may change before later steps. Unsupported Token-2022 extensions use the existing restriction/disabled-action flow. Large amounts, fee text and addresses keep unrestricted wrapping and text scaling.
- `scripts/check-interface.mjs` uses an isolated React Native Web preview with fixtures and mocked native services. It checks 360 px width at 1×, 1.3×, and 2× text across no-wallet, ORE, loading, empty, error, Kamino, review, and unknown-result states, plus wide screens, long addresses, low-screen input, copying, selection, reordering, and operation interactions. It also checks the header (RPC status after a failed startup ping, wallet and refresh placement, the two-line layout at 2×), stacked tabs at 2×, and tab labels wider than their tabs. Screenshots and the report are saved in `.cache/interface-check/`. The preview checks horizontal overflow, 48 px touch targets, and browser runtime errors; it does not establish native Android keyboard, safe-area, screen-reader, or wallet behavior. Those checks require a device.
