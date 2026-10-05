# Lifeboat interface requirements

Status: implemented in React Native; verified in the browser test harness. Meteora positions and withdrawal review are also checked on the Android debug emulator. Far Manager is the structural reference: working panels, data rows, double borders, a path, a command bar, and a dialog above the list. The color scheme is **light**: the overall background is white, with small filled areas highlighting the current object and important action.

Agreed preferences: white main background, blue text, contrasting local fills, double borders, and a file manager character. The typefaces, sizes, highlight shades, and panel arrangement below are proposals for the first mockup; assess them together on a phone screen.

## 1. Principle

Lifeboat resembles a tidy file manager for financial positions. Select a protocol and entry in the list; read details and perform an action beside or below it. The interface should be dense, orderly, and quick to scan while keeping amounts, addresses, and fees readable.

Large surfaces remain white. **Local fills** create contrast: one selected row, the current status, and the primary action. Double borders distinguish panels and dialogs. Corner radii are minimal, 0–4 dp. Do not use shadows, gradients, or decorative illustrations.

## 2. Color system

| Role | Color | Use |
| --- | --- | --- |
| Base background | White `#FFFFFF` | Screen, panels, inputs, dialog |
| Primary text | Navy `#163B73` | Names, amounts, addresses, statuses, important area borders |
| Active text | Blue `#2F6FE4` | Current path, links, available commands |
| Selected row | Soft orange `#FFD2B0` | One active entry with navy text |
| Secondary fill | Light blue `#EAF3FF` | Status bar, panel heading, informational label |
| Thin separators | `#DCE6F2` | List rows and detail groups; decorative lines only |
| Primary action | Orange `#FF7A1A` | Local button fill with dark `#20334D` text |

On white, `#163B73` has approximately 11:1 contrast, `#2F6FE4` approximately 4.65:1, and `#FF7A1A` approximately 2.61:1. Use **blue text on white**. Orange is a fill with dark text rather than a small text color. Use navy on `#FFD2B0` for the selected row: it resembles the warm reference highlight and remains readable.

Fills occupy a small part of the screen, leaving the workspace white. Use `#F7FAFD` only for a disabled input that would otherwise disappear against white. Errors and dangerous actions need explicit text; color must not be their only signal.

Soft orange marks the selected entry and is not simultaneously used for the path or normal labels. Light blue marks supporting information. Bright orange marks the primary action. Use navy or `#20334D` text on colored fills; reserve bright blue for white backgrounds. Label errors “Error” with an explanation and confirmed results “Confirmed”. Do not reduce an entire row's opacity to make important data look secondary.

## 3. Typography

The font pairing retains the Far Manager character and the original preference for serifs.

| Role | Proposed font | Size | Use |
| --- | --- | --- | --- |
| Working rows | IBM Plex Mono, system `monospace` fallback | 14–16 sp | Lists, addresses, numbers, path, command bar |
| Serif headings | IBM Plex Serif, system `serif` fallback | 20–26 sp | Lifeboat, selected position name, large amount |
| Secondary labels | IBM Plex Mono | 12–13 sp | Entry types and column names; not important fees |

Fonts are predominantly blue. Do not turn every row into a serif heading: serifs establish character, while monospace supports exact comparison. Before implementation, check English letters, digits, `≈`, `…`, addresses, and `ORE/SOL` symbols; bundle font files so results do not depend on the device.

Use regular and medium weights, excluding thin or decorative styles. Line height is approximately 1.35–1.5 times font size. Disable programming ligatures in addresses and technical identifiers. Check `0/O` and `1/l/I` distinction and redistribution terms for the font files. Large detail amounts may use serifs; tabular amounts remain monospaced.

List numbers are right-aligned with equal-width digits. Do not truncate amounts with ellipses. A row may shorten an address, but details and confirmation expose the full address and allow copying.

Every number includes its token. Mark rounded estimates with `≈`; a small nonzero value must not become `0`. Expose the full value in details. Copy the original address without visual line breaks and show “Address copied”. All user-facing labels, buttons, messages, and accessibility text are in English; token symbols, protocol names, and identifiers remain unchanged.

## 4. Panels and navigation

### Phone, up to 719 dp

Place the list above brief details of the selected entry. Both areas have double blue borders on white and share one scroll flow. Do not create two small, independently scrolling areas on phones. Open long details and operation forms separately, returning to the previous selection and list position. Show the network, shortened wallet, and path at the top, with a fixed command bar at the bottom. The status bar may scroll with content when height is limited. Keep commands and inputs clear of the keyboard and respect top and bottom system insets.

```text
┌ Lifeboat                         MAINNET ┐
│ Wallet AB12…CD34                         │
├ ORE / Rewards ───────────────────────────┤
│ > SOL rewards                0.024 SOL   │
│   ORE rewards               12.800 ORE   │
│   Staking                  140.000 ORE   │
├ SOL rewards ─────────────────────────────┤
│ Available                    0.024 SOL   │
│ Fee                       0.000005 SOL   │
│ Miner                     full address  │
├ Claim SOL  │  Refresh ──────────────────┤
│ 3 entries · updated 12:41                │
└─────────────────────────────────────────┘
```

This structural sketch uses sample data. The row with `>` receives a fill; verify double borders and exact sizes in the visual mockup. App data determines action availability.

### Wide screen, from 720 dp

Place panels side by side: protocols and positions on the left, details on the right. Each panel has its own double border, as in the reference. A shared status and command bar runs along the bottom. The left panel must fit the name and primary value without horizontal scrolling.

720 dp is an initial guide. With enlarged text or insufficient room, use sequential list/detail viewing even on wide screens. Selecting an entry opens details without running an operation. Preserve selection by identifier on refresh rather than row number. Reset previous details and amounts on wallet changes.

### Double borders and selection

Main panel: 1 dp navy outer line, 2 dp white gap, and 1 dp blue inner line. Dialogs use the same scheme, with an optional 2 dp outer line. Apply double borders to panels and dialogs; separate internal rows with one thin line. On phones, borders must not take space away from amounts or touch targets.

Draw borders with UI lines, not font characters. Leave 8–12 dp between the inner border and content. A panel title may interrupt the top line, as in the reference; long titles wrap above it. Base spacing increment: 4 dp. Do not add double borders inside entries.

The selected row uses a solid soft orange fill and navy text as the primary contrast signal, plus `>` or a short vertical marker on the left. Hardware keyboard focus has a separate blue outline to distinguish it from selection. Only one row per panel is filled at a time.

## 5. Rows and commands

- Row and button touch targets are at least 48 × 48 dp for this Android interface. Achieve density through typography rather than smaller touch targets.
- Lists show a short name, type, and one primary number; place long explanations in details.
- “Refresh” looks like a text command with a blue border or underline. The primary financial action uses orange fill and a dark label. Avoid multiple equally bright adjacent buttons.
- The status bar may use light blue fill. Distinguish the current path with text and a border so it does not compete with the selected row.
- The bottom bar resembles Far function commands, but phone actions use words. Labels such as `F1` and `F2` require actual hardware keyboard support.
- Loading, empty lists, RPC errors, unsupported positions, and pending confirmation appear as text within the same border system.

On refresh, do not replace unknown values with zero or show “No positions” before loading finishes. If retaining old data, show its read time and “Refreshing…” or “Could not refresh”. Explain disabled actions clearly; selection, pressed buttons, and running operations must look different. During submission, show the current phase and prevent duplicate presses. Changing selection must not move an open form to another position.

## 6. Financial operation dialog

Confirmation opens as a white dialog with a double blue border over the main screen. The heading or simulation result may use light blue fill. Show, in order: action and token, estimated amount, full wallet address, recipient or source, position and reserve where applicable, fees, simulation result, and additional cost warnings. At the bottom, use an orange “Sign and send” command with dark text and a quiet unfilled “Cancel” command. Long addresses wrap and can be copied. For an unknown submission result, show the transaction signature and “Check status”.

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

- Shared components live in `src/mobile/Interface.tsx`, `ActionButton.tsx`, and `theme.ts`: panels, dialogs, selection rows, messages, inputs, copying, colors, and typography. Panel borders are 1 dp navy / 2 dp white / 1 dp blue; dialog outer borders are 2 dp. Panel padding is 8 dp, dialog padding 12 dp. Buttons and inputs have 2 dp corners and no shadows.
- Working text uses IBM Plex Mono Regular 14/20 sp, labels Mono Medium 12/18 sp, commands Mono Medium 14/20 sp, and headings Serif Medium 22/30 sp. Text scaling is unrestricted. Long numbers wrap without rounding or ellipses; unknown values are not replaced with zero. Address ligatures are disabled. Selection uses `>` and soft orange, with separate hardware focus styling.
- Manual external wallet connection requests fresh permission instead of silently reusing the old authorization. The status explains approval and return to Lifeboat, and connection failures distinguish session establishment, authorization, and return/account validation. Cancelling retains the previous wallet.
- Signing requests fresh connection permission only after the MWA authorization-failed code, rather than on every error. Renewed permission for the same account is persisted before signing. Logs distinguish wallet refusal to sign from an explicit cancellation; no transaction is sent after a refusal.
- Wallet connection troubleshooting uses fixed log milestones rather than exposing request payloads in the interface. The capture helper filters native MWA logs, which may otherwise contain authorization tokens. Approval behavior must be checked on the target wallet and device.
- Transaction diagnostics distinguish a signing request, a returned response, local signature validation, RPC submission, and confirmation. Fixed failure categories and numeric instruction errors go to the filtered log; wallet/RPC payloads are excluded. Instrumentation does not change approval, submission, or unknown-result recovery.
- Bundle IBM Plex Mono and Serif in Regular/Medium weights. The app exposes their SIL Open Font License 1.1 text in “Fonts and license”. Font loading has explicit loading, error, and retry states. Font tests check English letters, technical symbols, distinguishable `0/O` and `1/l/I`, monospaced number widths, and the bundled license. Color tests check text contrast of at least 4.5:1 and control contrast of at least 3:1.
- Phones show list and details in one scroll flow; wide screens use adjacent panels when space permits. Full details and amount forms open in dialogs. Selection persists by entry identifier through refresh/reordering; wallet changes reset it. Selecting a row does not run an operation. Full addresses and transaction signatures can be copied with feedback.
- ORE rows cover SOL rewards, ORE rewards, and direct staking. Kamino rows show debt, collateral, unavailable positions, and separately validated repayment candidates. The operation dialog shows simulation, amount and fee estimates, wallet/source/recipient, applicable position/reserve, account creation costs, and status checking for uncertain results.
- Meteora rows identify a selected DLMM position by token pair and address. Details show liquidity, fees and rewards per token, full pool/mint/position addresses, and explicit restrictions. Withdraw all preserves original tokens and explicitly keeps WSOL wrapped. Each signature review shows the owner recipient, simulated step receipts, estimated remaining receipts, network fees, ATA rent, position rent refund and remaining step count. Progress distinguishes confirmed steps, partial completion, cancellation and unknown results. Resume re-reads state; a pending signature exposes only status checking. Complete status requires a verified closed position.
- `scripts/check-interface.mjs` uses an isolated React Native Web preview with fixtures and mocked native services. It checks 360 px width at 1×, 1.3×, and 2× text across no-wallet, ORE, loading, empty, error, Kamino, review, and unknown-result states, plus wide screens, long addresses, low-screen input, copying, selection, reordering, and operation interactions. Screenshots and the report are saved in `.cache/interface-check/`. The preview checks horizontal overflow, 48 px touch targets, and browser runtime errors; it does not establish native Android keyboard, safe-area, screen-reader, or wallet behavior. Those checks require a device.
