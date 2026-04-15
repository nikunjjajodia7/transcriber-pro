---
title: "fix: Eliminate plugin conflicts and improve native Obsidian integration"
type: fix
status: completed
date: 2026-04-16
---

# Fix: Eliminate Plugin Conflicts and Improve Native Obsidian Integration

## Overview

Fix 9 issues (P0-P3) found during a design review of the NeuroVox Obsidian plugin. The P0 fix prevents the plugin from breaking Obsidian's native drag-and-drop and other plugins' drop handlers. P1 fixes add keyboard dismiss to the upload sheet and throttle an expensive MutationObserver. P2 fixes address resource leaks, orphaned recording state, and mobile theme support. P3 fixes remove dead code and improve visual consistency with Obsidian's native UI.

## Problem Frame

The plugin intercepts all drop events on the editor (not just audio drops), blocking Obsidian's native file/image/link drag-and-drop and any other plugin that uses drop handlers. The mobile upload sheet has no keyboard dismiss. A MutationObserver on `document.body` with `subtree: true` fires on every DOM change without throttling. Timer intervals leak when the plugin unloads with an open modal. Switching notes during recording orphans the recording session. The mobile dock pill and upload sheet use hardcoded dark colors that ignore light themes.

## Requirements Trace

- R1. Drop handlers must not intercept non-audio drops (P0)
- R2. Upload bottom sheet must be dismissible via Escape key and Android back button (P1)
- R3. MutationObserver must not fire unthrottled on every DOM mutation (P1)
- R4. All intervals must be cleaned up on plugin unload (P2)
- R5. Recording state must not be orphaned on note switch (P2)
- R6. Mobile UI must respect Obsidian's light/dark theme (P2)
- R7. Dead viewport meta code must be removed (P3)
- R8. `!important` overrides must be replaced with proper specificity (P3)
- R9. Accordion icons must use Obsidian's icon system (P3)

## Scope Boundaries

- **In scope:** All fixes applied directly to bundled `main.js` and `styles.css`
- **Not in scope:** Adding tests (dist-only repo), refactoring the upload sheet to use Obsidian's Modal class, changing the `clickable-icon` usage on dock pill buttons (intentional for native styling)
- **Constraint:** Same as prior plan — edits to `main.js` will be overwritten by future source builds. Each fix must be documented clearly enough to port.

## Context & Research

### Relevant Code and Patterns

- `main.js:12320-12331` — Page-level dragover/drop handlers. Dragover correctly early-returns for non-audio; drop does not.
- `main.js:12129-12131` — Mic button drop handler, same unconditional `preventDefault()` pattern.
- `main.js:11823-11983` — `UploadBottomSheet` class. Raw DOM, appended to `document.body`. Has overlay click-to-close but no keyboard dismiss.
- `main.js:11714-11732` — MutationObserver on `document.body` with `{ childList: true, subtree: true }`. Callback runs 3 `querySelector` calls per mutation.
- `main.js:15184-15202` — `onunload()`. Clears processing intervals but not TimerModal.
- `main.js:13927, 14639-14677` — `this.modalInstance` tracked on plugin. Set to null in `onClose` callback but never closed in `onunload`.
- `main.js:14573-14581` — `handleActiveLeafChange`. Destroys all buttons without checking recording state.
- `styles.css:35-44` — Hardcoded mobile dark palette in `:root`.
- `main.js:12828-12833` — Dead viewport meta tag creation.
- `styles.css:1347-1351` — `!important` on `.mobile-button`.
- `main.js:7828-7831` — Accordion toggle icon uses `\u2796`/`\u2795` text nodes.

### Institutional Learnings

- Prior plan (2026-04-16-001) confirmed direct bundle edits are safe and the standard approach for this repo. Edits should search by pattern, not fixed line numbers, since earlier units may shift lines.

## Key Technical Decisions

- **Drop handlers: guard with `hasAudioFile()` check** — Match the existing `dragover` pattern. Return early for non-audio so events propagate to Obsidian and other plugins.
- **Upload sheet dismiss: add `keydown` + `popstate` listeners** — Lighter than refactoring to use Obsidian's Modal. Matches how TimerModal handles Escape (line 12784).
- **MutationObserver throttle: use RAF coalescing** — Set a pending flag, schedule RAF, skip if already pending. Limits to ~60 checks/sec. Simpler than debouncing and keeps responsiveness.
- **Timer cleanup: close modal in `onunload()`** — Plugin already tracks `this.modalInstance`. Call `.close()` which triggers the existing cleanup chain.
- **Note switch recording safety: stop recording before destroying buttons** — Check if any button has an active inline recorder. If recording, call the stop handler before `remove()`.
- **Mobile palette: add `.theme-light` CSS overrides** — Map to iOS light-mode equivalents. Keep dark values as default (`:root`) since Obsidian mobile defaults to dark.

## Open Questions

### Resolved During Planning

- **Should the `clickable-icon` class on dock pill buttons be changed?** No — it's intentional. It gives the buttons Obsidian's native hover/press styles. The trade-off (coupling to Obsidian's class) is worth it for native feel.
- **Should the upload sheet be refactored to use Obsidian's Modal?** No — too large a change for this fix pass. Adding Escape/back dismiss to the existing DOM sheet is sufficient.
- **Are the hardcoded `rgba(0,0,0,...)` shadows a problem?** No — Obsidian itself uses the same pattern. Not a conflict source.

### Deferred to Implementation

- Exact line numbers may shift as earlier units modify the file.
- The accordion icon rotation CSS needs to be tested with both open and closed states to get the transform right.

## Implementation Units

- [x] **Unit 1: Fix page and mic drop handlers to not block non-audio drops**

  **Goal:** Prevent NeuroVox from intercepting drops of images, links, text, or files from other plugins.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 12327-12331, `onPageDropBound`)
  - Modify: `main.js` (~line 12129-12131, `onMicDropBound`)

  **Approach:**
  - In `onPageDropBound`: add `if (!this.hasAudioFile(event.dataTransfer)) return;` before `event.preventDefault()`. This matches the existing `onPageDragOverBound` pattern at line 12322-12323.
  - In `onMicDropBound`: same pattern — early return if not audio, then `preventDefault()`.
  - The `handleDroppedAudio` method (line 12572-12582) already validates audio type and shows a Notice for non-audio. But that's too late — `preventDefault()` has already blocked propagation. The fix must happen before `preventDefault()`.

  **Patterns to follow:**
  - `onPageDragOverBound` at line 12320-12325 — already does the correct early-return pattern.

  **Test scenarios:**
  - Happy path: Drag an audio file onto the editor — transcription flow starts normally
  - Happy path: Drag an image onto the editor — Obsidian's native image embed works
  - Integration: Drop a file while another plugin's drop handler is active — both receive the event
  - Edge case: Drag a non-audio file onto the mic button — no interference, button ignores it

  **Verification:**
  - Drag an image into the editor with NeuroVox enabled — image embeds normally. Previously it would be silently eaten.

- [x] **Unit 2: Add Escape key and back-button dismiss to upload bottom sheet**

  **Goal:** Allow keyboard and Android back-button dismissal of the upload sheet, matching Obsidian's native modal behavior.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 11823-11983, `UploadBottomSheet` class)

  **Approach:**
  - In `open()`, after appending elements, add:
    - A bound `keydown` listener on `document` that calls `this.close()` when `event.key === "Escape"`.
    - A bound `popstate` listener on `window` that calls `this.close()`.
  - Store both bound handlers as instance properties (`this.onEscBound`, `this.onPopStateBound`).
  - In `close()`, remove both listeners before the 320ms timeout cleanup. This ensures listeners are removed immediately on close, not after the animation delay.

  **Patterns to follow:**
  - TimerModal's popstate handler at line 12791.
  - TimerModal's Escape handler via `this.scope.register([], "Escape", ...)` at line 12784 — but since UploadBottomSheet doesn't extend Modal, use direct `keydown` listener instead.

  **Test scenarios:**
  - Happy path: Open upload sheet, press Escape — sheet closes with animation
  - Happy path: Open upload sheet on Android, press back button — sheet closes
  - Edge case: Press Escape while file picker dialog is open — no double-close (file picker handles its own Escape)
  - Edge case: Sheet already closing (overlay tapped), then Escape pressed — `close()` is idempotent (null checks prevent double-remove)

  **Verification:**
  - Open upload sheet, press Escape — closes. Open again, tap overlay — closes. No errors in either case.

- [x] **Unit 3: Throttle MutationObserver callback with RAF coalescing**

  **Goal:** Prevent the overlay-detection observer from firing synchronously on every DOM mutation.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 11714-11720, `startOverlayObserver`)

  **Approach:**
  - Add a `this.overlayCheckPending` boolean flag, initialized to `false`.
  - In the MutationObserver callback, check if `overlayCheckPending` is true — if so, return immediately (skip).
  - Otherwise, set `overlayCheckPending = true` and schedule `requestAnimationFrame(() => { this.updateVisibilityForOverlays(); this.overlayCheckPending = false; })`.
  - This coalesces all mutations within a single frame into one `updateVisibilityForOverlays()` call.

  **Patterns to follow:**
  - The RAF pattern already used in dock tracking at line 11740.

  **Test scenarios:**
  - Happy path: Open a modal — pill hides within one frame (~16ms)
  - Happy path: Close a modal — pill shows within one frame
  - Edge case: Rapid DOM mutations (e.g., many plugins loading) — observer callback runs at most once per frame

  **Verification:**
  - Add temporary `console.log` in `updateVisibilityForOverlays` — count calls while rapidly opening/closing the command palette. Should be ~1 per open/close, not dozens.

- [x] **Unit 4: Close TimerModal on plugin unload to prevent timer interval leak**

  **Goal:** Ensure the recording modal's `setInterval` is cleaned up when the plugin is disabled or updated.

  **Requirements:** R4

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 15184-15202, `onunload`)

  **Approach:**
  - Before `this.cleanupUI()`, add: `if (this.modalInstance) { this.modalInstance.close(); this.modalInstance = null; }`
  - The `close()` call triggers the modal's existing `onClose` handler (line 14670), which already calls `cleanup()` → `pauseTimer()` → `clearInterval()`.
  - The plugin already tracks `this.modalInstance` (line 13927) and nulls it in `onClose` (line 14674), so this is just calling the existing teardown path.

  **Patterns to follow:**
  - The existing `onClose` handler at line 14669-14676.

  **Test scenarios:**
  - Happy path: Plugin unloads with no modal open — no change in behavior
  - Happy path: Plugin unloads while recording modal is open — modal closes, timer stops, no leaked interval
  - Edge case: Plugin unloads while modal is in "processing" state — close triggers cleanup, processing may fail gracefully

  **Verification:**
  - Open recording modal, disable plugin in settings — modal closes cleanly. Re-enable plugin — works normally with no stale intervals.

- [x] **Unit 5: Stop recording before destroying buttons on note switch**

  **Goal:** Prevent orphaned recording sessions when the user switches notes.

  **Requirements:** R5

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 14573-14581, `handleActiveLeafChange`)

  **Approach:**
  - Before the `this.buttonMap.forEach((button) => button.remove())` loop, iterate the map and check if any button has an active inline recorder panel with an active recording.
  - The inline recorder panel is accessible via `button.inlineRecorderPanel` (line 12426 shows it's a property).
  - If a panel exists and is in `recording` or `paused` state, call its stop/finalize handler before calling `button.remove()`.
  - The simplest approach: check `button.inlineRecorderPanel?.state` — if it's `"recording"` or `"paused"`, trigger the stop action which finalizes the transcription into the current note before switching.

  **Patterns to follow:**
  - The stop handler pattern in InlineRecorderPanel that calls `stopRecordingSession()`.

  **Test scenarios:**
  - Happy path: Switch notes while not recording — behavior unchanged
  - Happy path: Switch notes while recording via inline panel — recording stops, transcription is finalized into the original note
  - Edge case: Switch notes while in "finalizing" state — no double-stop, finalization continues

  **Verification:**
  - Start inline recording, switch notes — recording stops gracefully, transcript appears in the original note.

- [x] **Unit 6: Add light-mode overrides for mobile palette**

  **Goal:** Make the dock pill and upload sheet visually coherent in Obsidian's light theme.

  **Requirements:** R6

  **Dependencies:** None

  **Files:**
  - Modify: `styles.css` (~line 35-44, mobile palette variables)

  **Approach:**
  - Add a `.theme-light` block after the `:root` mobile palette that overrides each variable with iOS light-mode equivalents:
    - `--neurovox-mobile-bg: #F2F2F7` (system grouped background)
    - `--neurovox-mobile-surface: #FFFFFF` (white card)
    - `--neurovox-mobile-surface-alt: #E5E5EA` (grouped secondary)
    - `--neurovox-mobile-text: #1C1C1E` (label color)
    - `--neurovox-mobile-text-muted: #8E8E93` (secondary label — same in both modes)
    - `--neurovox-mobile-text-secondary: #AEAEB2` (tertiary label)
    - `--neurovox-mobile-accent: #7F6DF2` (keep purple accent)
    - `--neurovox-mobile-red: #E93147` (keep red)
    - `--neurovox-mobile-amber: #E09422` (slightly darker amber for light bg contrast)
    - `--neurovox-mobile-green: #34C759` (iOS system green for light mode)
  - Obsidian applies `.theme-light` or `.theme-dark` class to the `body` element. The selector `.theme-light` will correctly scope these overrides.

  **Patterns to follow:**
  - The prior plan's Unit 15 partially addressed this by converting some colors to Obsidian variables. This unit handles the remaining mobile-specific palette that intentionally tracks iOS system colors rather than Obsidian variables.

  **Test scenarios:**
  - Happy path: Dock pill in dark mode — unchanged appearance
  - Happy path: Dock pill in light mode — light background, dark text, readable controls
  - Happy path: Upload sheet in light mode — light sheet background, proper contrast
  - Edge case: Toggle theme while dock pill is visible — colors update immediately (CSS variables are live)

  **Verification:**
  - Switch to light theme on mobile — dock pill and upload sheet blend naturally with the light UI.

- [x] **Unit 7: Remove dead viewport meta tag code**

  **Goal:** Remove unreachable code that contains accessibility-hostile values.

  **Requirements:** R7

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 12828-12833, inside `TimerModal.onOpen`)

  **Approach:**
  - Remove the entire viewport meta tag block:
    ```
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
      document.head.appendChild(meta);
    }
    ```
  - Obsidian always sets a viewport meta tag, so the `if (!viewport)` block never executes. The code is dead but contains `maximum-scale=1.0, user-scalable=no` which would violate WCAG if it ever did run.
  - Keep the `try` block and the rest of `onOpen()` — only remove the viewport lines.

  **Test scenarios:**
  - Test expectation: none -- dead code removal with no behavioral change.

  **Verification:**
  - Open recording modal on both desktop and mobile — works identically. No viewport tag is created (it wasn't being created before either).

- [x] **Unit 8: Replace `!important` with higher-specificity selectors**

  **Goal:** Remove `!important` overrides that could fight Obsidian's button styling system.

  **Requirements:** R8

  **Dependencies:** None

  **Files:**
  - Modify: `styles.css` (~line 1346-1351, `.mobile-button` rules)
  - Modify: `styles.css` (~line 1365-1371, `.neurovox-button-danger` and `.neurovox-button-primary` rules)
  - Modify: `styles.css` (~line 1380, `.neurovox-modal-toggle-setting`)
  - Modify: `styles.css` (~line 1397, `.neurovox-button.recording`)

  **Approach:**
  - For `.mobile-button`: change selector to `.neurovox-confirmation-buttons.is-mobile .mobile-button` — this adds class specificity without `!important`.
  - For `.neurovox-button-danger` and `.neurovox-button-primary`: change selectors to `button.neurovox-button-danger` and `button.neurovox-button-primary` — element + class specificity.
  - For `.neurovox-modal-toggle-setting`: change to `.neurovox-timer-modal .neurovox-modal-toggle-setting` for context specificity.
  - For `.neurovox-button.recording`: change to `button.neurovox-button.recording`.
  - Remove all `!important` annotations from these rules.

  **Test scenarios:**
  - Happy path: Confirmation modal buttons render at correct size on mobile
  - Happy path: Danger/primary button colors apply correctly
  - Edge case: Another plugin styles generic `button` elements — no conflict because selectors are class-qualified

  **Verification:**
  - Open a confirmation dialog on mobile — buttons are full-width, 48px height, correct colors. No visual regression.

- [x] **Unit 9: Replace accordion emoji icons with Obsidian's icon system**

  **Goal:** Make the settings accordion disclosure icons match Obsidian's native disclosure pattern.

  **Requirements:** R9

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 7828-7831, `updateToggleIcon` in `BaseAccordion`)
  - Modify: `styles.css` (add new rule for accordion icon rotation)

  **Approach:**
  - In `updateToggleIcon()`, replace:
    ```
    this.toggleIcon.empty();
    const iconText = document.createTextNode(this.isOpen ? "\u2796" : "\u2795");
    this.toggleIcon.appendChild(iconText);
    ```
    with:
    ```
    this.toggleIcon.empty();
    (0, import_obsidian8.setIcon)(this.toggleIcon, "chevron-right");
    this.toggleIcon.classList.toggle("neurovox-accordion-icon-open", this.isOpen);
    ```
  - In `styles.css`, add:
    ```css
    .neurovox-accordion-header .neurovox-accordion-icon-open svg {
      transform: rotate(90deg);
      transition: transform 0.2s ease;
    }
    ```
  - The `setIcon` import is already available as `import_obsidian8` in the settings tab section of the bundle.

  **Patterns to follow:**
  - Obsidian's native tree view uses `setIcon(el, "chevron-right")` with rotation for disclosure.
  - The plugin already uses `setIcon` extensively (line 12097, 11853, 11866, etc.).

  **Test scenarios:**
  - Happy path: Settings tab shows chevron icons — right-pointing when closed, rotated 90deg when open
  - Happy path: Click accordion header — chevron rotates smoothly
  - Edge case: Multiple accordions open/close independently

  **Verification:**
  - Open NeuroVox settings — accordion headers show chevron icons that rotate on toggle, matching Obsidian's native disclosure pattern.

## System-Wide Impact

- **Interaction graph:** Unit 1 changes how drag/drop events propagate through the editor. After the fix, non-audio drops pass through to Obsidian's native handler and any other plugin's drop handler. This is the correct behavior — NeuroVox should only intercept audio drops.
- **Error propagation:** Unit 5 adds a recording stop before button teardown. If the stop fails, the button is still removed (fail-open). The recording processor's error handling shows a Notice to the user.
- **State lifecycle risks:** Units 4 and 5 both address state lifecycle issues — timer leak and orphaned recording. Both use existing teardown paths (modal close, recording stop) rather than inventing new cleanup logic.
- **API surface parity:** No API changes. Commands, settings schema, and file formats remain unchanged.
- **Unchanged invariants:** The dock pill's `clickable-icon` class usage is intentionally preserved. The upload sheet remains a raw DOM element (not refactored to Modal). The MutationObserver still observes `document.body` but is now throttled.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Bundle edits overwritten by future source build | Each fix is documented in this plan for porting |
| Drop handler early-return might miss edge cases in `hasAudioFile()` | The method already handles null `dataTransfer` and checks both extension and MIME type |
| Accordion `setIcon` import reference (`import_obsidian8`) may differ | Search for the actual import alias used in the settings section of the bundle |
| Light-mode mobile palette colors may not match all custom themes | Values are iOS system colors that harmonize with most light themes. Custom themes can further override. |
| Stopping recording on note switch might lose data if finalization fails | The recording processor persists audio to the job queue before processing — data is recoverable via the recovery jobs modal |

## Sources & References

- **Design review:** Conducted in this conversation, covering all UI code in `main.js` and `styles.css`
- Related plan: `docs/plans/2026-04-16-001-fix-review-findings-plan.md` (completed, prior fix pass)
- Related code: `main.js` (esbuild bundle), `styles.css`
