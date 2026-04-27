---
title: "Refactor mobile recorder to native ribbon + persistent Notice"
created: 2026-04-20
status: active
depth: deep
target_release: 1.1.0-rc.1
supersedes_on_mobile: docs/plans/2026-04-19-001-fix-mobile-recorder-lifecycle-plan.md
---

# Refactor mobile recorder to native ribbon + persistent Notice

## Problem frame

The mobile recorder has shipped three iOS keyboard / viewport positioning bugs in 30 days, all in the same file family (`MobileDockPill.ts` / `InlineRecorderPanel.ts`). rc.2 (`1.0.20-rc.2`) added `visualViewport` listeners and a RAF re-position pass (Unit 1 of the prior plan) — the bug **still reproduces** when the user taps into a note body while recording. The underlying positioning math fights iOS; we are patching symptoms, not causes.

The recurring failure mode is not a specific off-by-one. It is the **architecture**: a floating `HTMLElement` attached to `document.body` that has to compute its own position relative to a mobile viewport that shifts unpredictably as the keyboard shows/hides and as Obsidian's own drawer/dock animates. Three fixes in 30 days in one component is the signal. Stop patching. Switch surfaces.

The target pattern uses Obsidian's native UI primitives so the OS + Obsidian handle positioning: a **ribbon icon** to start/stop recording, and a **persistent `Notice` (`timeout = 0`)** as the "recording in progress" indicator — tappable to stop, updateable with live timer and optional interim text.

The redesign also surfaces adjacent dead code uncovered during research (§10 of the research report): `InlineRecorderPanel` is unreachable on every code path today because `MobileDockPill` / `DesktopDockPill` short-circuit `FloatingButton.handleClick()` before the panel branch can run. Retiring it with this plan is consolidation, not scope creep.

## Decision summary

1. **Mobile default** becomes ribbon mode: `🎙️` icon (start/stop) + `📤` icon (upload) + persistent `Notice` indicator. The floating mic + `MobileDockPill` are retired **on mobile only** in ribbon mode.
2. **Desktop unchanged**. `DesktopDockPill` + `FloatingButton` stay — desktop has no keyboard/viewport problem, and the edge-nudge refit (Unit 4 of the prior plan) just shipped.
3. **Settings-gated rollout** with a new `recorderMode` enum (`floating | ribbon | modal`). **All mobile users (new and upgrading) default to `ribbon`** — existing users see a one-time "Restore floating mic" Notice on first 1.1.0 launch so they can revert in one tap. Desktop defaults are unchanged. See §Migration for the full mapping.
4. **Insertion logic is untouched.** `StreamingTranscriptionService` + `DocumentInserter` + `RecordingProcessor` keep their current behavior. Uploads still append at end-of-file per **Finding 2** (shorthand for the prior bug-fix plan's Unit 6 — `UploadBottomSheet` close-timer race fix landed in `1.0.20-rc.1`; see `docs/plans/2026-04-19-001-fix-mobile-recorder-lifecycle-plan.md` §Finding 2). Live transcripts still stream to cursor; no-active-note still falls back to `transcriptFolderPath`.
5. **`UploadBottomSheet` is untouched.** The ribbon `📤` icon replicates `MobileDockPill.handleUploadTap()` verbatim and hands the same callbacks to the same sheet.
6. **`InlineRecorderPanel` is deleted** along with the `useExpandableFloatingRecorder` + `showToolbarButton` dead flags, as part of this plan's cleanup phase.
7. **Release sequencing:** `1.1.0-rc.1` (not `1.0.20-rc.3`). This is a user-visible UX redesign with a settings migration and a new default mode — honest minor bump. The 1.0.20 line stays a pure bug-fix line; promote rc.2 → 1.0.20 stable first (the already-pending Unit 7), then this plan cuts `1.1.0-rc.1`.

## Scope boundaries

**In scope:**
- New `RibbonRecorderController` that owns ribbon icons + persistent Notice + recording state
- New `recorderMode` setting + migration (schema v5 → v6)
- Mobile-only deprecation of `MobileDockPill` when `recorderMode === 'ribbon'`
- Deletion of `InlineRecorderPanel`, `useExpandableFloatingRecorder`, `showToolbarButton` (all already dead or unreachable)
- Settings UI update in `RecordingAccordion.ts` to expose `recorderMode` toggle
- Reuse of existing `UploadBottomSheet` via replicated upload handler
- Reuse of existing `StreamingTranscriptionService` via the same constructor surface `MobileDockPill` uses today

**Out of scope (non-goals):**
- Hindi / nova-3 language-routing bug (`DeepgramLiveAdapter.ts:155-174`, `DeepgramAdapter.ts:167`) — **separate PR**, tracked separately
- Desktop UX redesign — `DesktopDockPill` stays as-is
- `TimerModal` redesign — used by the `modal` recorder mode and command palette; stays as-is
- Pause/resume for ribbon mode — deferred to a follow-up; ribbon mode is **record/stop only** at launch
- CodeMirror `WidgetType` inline interim transcript preview — deferred to a follow-up (Unit 9 left as exploration, not build)
- `DocumentInserter.ts` / `StreamingTranscriptionService.ts` internals
- Android testing — plan builds to iOS + desktop parity; Android validation folded into the 1.1.0 bake window. Note: `Platform.isMobile` is true on Android, so Android users also migrate to `ribbon` in this plan. Android is expected to be strictly easier (no keyboard-fights-viewport class of bug on Android Obsidian), but we do not ship 1.1.0 stable until at least one Android device smoke-test passes the same checklist as iOS.
- Deprecating `DeviceDetection` — it still drives streaming tuning; only `Platform.isMobile` is used for new ribbon branching

## Resolved design questions

(The seven questions in the feature brief are all resolved here — none are deferred as blockers.)

1. **Floating mic visibility on mobile with `recorderMode === 'ribbon'`?** Hidden. The ribbon is the single entry point. Dual entry points confuse mental model and double the surface area for future lifecycle bugs.
2. **Settings toggle vs hard-cut?** Settings toggle. `recorderMode` enum with three options. Mobile new-install default = `ribbon`. Existing mobile users migrate to `floating` (their current behavior) so updates are non-breaking. Plan to flip the default-for-all-mobile to `ribbon` in 1.2.0 after one release of bake. Hard-cut is disrespectful to users with working flows.
3. **Ribbon tap with no active note?** Start recording against a new file at `transcriptFolderPath` — identical to current `StreamingTranscriptionService` fallback. No special-case UI, no abort.
4. **Persistent Notice interactions?**
   - **Tap anywhere on `noticeEl`** → stop recording. Obsidian's Notice layer is not long-press friendly and we don't want a hidden gesture.
   - **During post-stop processing** → Notice updates to "Transcribing…" with a spinner glyph; tap is disabled (no re-entrancy).
   - **After transcript insertion** → Notice auto-hides. No "re-open last recording" — that's cognitive overhead for a marginal use case.
5. **Tap-while-stopped behavior?** None. Notice is not shown while stopped. Start a new recording via ribbon.
6. **Interim transcript preview placement?**
   - **Launch:** update Notice text with last ~50 chars of rolling interim (low cognitive load, matches current pill behavior). Truncate from the left so the most recent words are visible.
   - **Deferred (future iteration, exploration only):** inline CodeMirror `WidgetType` at cursor as an ambient preview. Not in this plan's build scope because it needs its own UX validation pass.
7. **Pause/resume?** Not supported in ribbon mode at launch. Current mobile pill has pause but it's rarely used on mobile. Deferred to a follow-up once ribbon mode has bake time. `TimerModal` (`recorderMode === 'modal'`) keeps pause/resume for users who need it.

## Architecture

### Surfaces (mobile, `recorderMode === 'ribbon'`)

```
┌─────────────────────────────────────────┐
│  Obsidian Menu (bottom-right on phone)  │
│   ┌──────────────────────────────────┐  │
│   │ 🎙️  Start recording  (mic)         │  │  ← ribbon icon
│   │ 📤  Upload recording (upload-cloud)│  │  ← ribbon icon
│   └──────────────────────────────────┘  │
├─────────────────────────────────────────┤
│                                         │
│  [Active note body…]                    │
│                                         │
├─────────────────────────────────────────┤
│  ╭─ Notice (persistent) ──────────────╮ │
│  │ 🔴 REC 0:23  Tap to stop           │ │  ← Notice(timeout=0)
│  │ "…and the third point is that we"  │ │    live interim tail
│  ╰────────────────────────────────────╯ │
└─────────────────────────────────────────┘
```

Directional sketch only; the `Notice` is rendered by Obsidian and we don't control its position. That is the point.

### Control flow

```
onload()
  └─ if Platform.isMobile && recorderMode === 'ribbon':
      new RibbonRecorderController(plugin)
           ├─ plugin.addRibbonIcon('mic', 'Start recording', onRecordTap)
           ├─ plugin.addRibbonIcon('upload-cloud', 'Upload recording', onUploadTap)
           └─ (no persistent DOM beyond what Obsidian manages)

  └─ FloatingButton suppressed on mobile when controller is active
     (new gate in main.ts createButtonForFile + handleActiveLeafChange)

onRecordTap() [idle]
  └─ capture activeFile + cursor position
  └─ new StreamingTranscriptionService(plugin, callbacks)
  └─ new AudioRecordingManager(plugin)
  └─ getUserMedia → startLiveSession(stream)
  └─ show persistent Notice: "🔴 REC 0:00 · Tap to stop"
  └─ register tap handler on notice.noticeEl → onStopTap
  └─ start 1Hz timer interval → update notice.setMessage
  └─ subscribe to partial-result callback (10Hz from StreamingTranscriptionService)
      → throttled notice.setMessage with last-50-chars interim tail

onStopTap() [recording]
  └─ update Notice → "Transcribing…" (spinner glyph; disable tap re-entry)
  └─ const finalBlob = await recordingManager.stop()
  └─ const result = await streamingService.finishProcessing() → StreamingTranscriptionResult
  └─ await plugin.recordingProcessor.processStreamingResult(result, activeFile, cursorPosition, { audioBlob: finalBlob, durationSeconds })
     (on catch → fallback: plugin.recordingProcessor.processRecording(finalBlob, activeFile, cursorPosition))
  └─ notice.hide()
  └─ controller returns to idle

onUploadTap()
  └─ capture activeFile (or null)
  └─ new UploadBottomSheet({
       plugin,
       saveAudioOn: settings.saveLiveRecordingAudio,
       onTranscribe: (file, saveAudio) =>
         plugin.recordingProcessor.processRecording(blob, activeFile, cursorPosition, file.name),
       onCancel: () => {}
     })

onunload()
  └─ abort in-flight recording if present
  └─ hide + dispose Notice
  └─ clear timer interval
  └─ (ribbon icons auto-cleaned by Obsidian)
```

### State machine

`RibbonRecorderController.state: 'idle' | 'recording' | 'processing'`. Transitions:

- `idle → recording`: on `onRecordTap`, after `startLiveSession` resolves.
- `recording → processing`: on `onStopTap`, before `finishProcessing`.
- `processing → idle`: after `recordingProcessor.processStreamingResult` resolves (or on error).
- `recording → idle` (error path): `streamingService.abort()` fired from `onerror` callback; Notice swaps to `"Recording failed · tap to dismiss"`, then hides on tap.

Only one concurrent recording. A `onRecordTap` while `state !== 'idle'` is a no-op. This matches current mobile pill semantics and avoids duplicate-modal issues like the one `main.ts:774` guards against.

**Rationale for three-value `recorderMode` enum (per review finding #7):** `modal | ribbon | floating` is three concepts not two. A two-value flag can represent "use ribbon: yes/no" but then `useRecordingModal` stays as a parallel flag and the mobile settings UI has to check two flags to pick the right dropdown value. Collapsing both flags into a single `recorderMode` enum centralizes the decision to one place, makes the settings UI trivially `settings.recorderMode` on both platforms, and makes future modes (e.g. a hypothetical `minimal` or `voice-activation` mode) additive without re-migrating. The cost is one extra string comparison per mode branch — negligible.

## Migration (schema v5 → v6)

Add to `src/settings/Settings.ts`:

```ts
export type RecorderMode = 'floating' | 'ribbon' | 'modal';

// in NeuroVoxSettings
recorderMode: RecorderMode;
```

Add default:
- New installs (no prior `data.json`): `'ribbon'` on mobile (detected at first-launch from `Platform.isMobile`), `'floating'` on desktop.

Add migration in `src/settings/migrations.ts` (bump `CURRENT_SETTINGS_VERSION` from 5 → 6):

```
For each existing settings object:
  If settings.useRecordingModal && !settings.showFloatingButton:
    recorderMode = 'modal'
  Else if Platform.isMobile:
    recorderMode = 'ribbon'   (opt-out — existing mobile users get the fix by default)
  Else if settings.showFloatingButton:
    recorderMode = 'floating'   (desktop default preserved)
  Else:
    recorderMode = 'floating'   (conservative fallback)
  Delete useExpandableFloatingRecorder
  Delete showToolbarButton
```

**Rationale (revised per review finding #1):** The original draft migrated existing mobile users to `floating` so they would not feel sudden change. That decision traded safety for leaving the keyboard bug unfixed on exactly the users most affected by it. Reversed: existing mobile users migrate to `ribbon` **by default** (opt-out). On first 1.1.0 launch we surface a one-time Notice (see Unit 2a) explaining the change with a "Restore floating mic" action that sets `recorderMode = 'floating'` and persists. Users who prefer the old surface can revert in one tap; users who do nothing get the fix.

Desktop users are unaffected — desktop has no keyboard bug. `modal` users are unaffected — they already opted out of the floating mic. `1.2.0` no longer needs a "default-flip" because the flip happens here.

## Implementation units

Eight build units + one exploration unit. Units are ordered so each one can land + smoke-test before the next starts.

### Unit 1 — Settings: `recorderMode` schema + migration

**Goal:** Add `RecorderMode` type + `recorderMode` field with schema bump + migration that preserves existing behavior.

**Files:**
- `src/settings/Settings.ts` — add `RecorderMode` type, `recorderMode` field, update `DEFAULT_SETTINGS`, bump `CURRENT_SETTINGS_VERSION` from 5 to 6
- `src/settings/migrations.ts` — add v5→v6 migration, delete `useExpandableFloatingRecorder` + `showToolbarButton` from migrated object
- `src/settings/accordions/RecordingAccordion.ts` — remove settings UI for the two deleted flags, add `recorderMode` dropdown (desktop: `floating` / `modal`; mobile: `floating` / `ribbon` / `modal`)

**Approach:**
- Default factory should pick `'ribbon'` for mobile fresh installs based on `Platform.isMobile` at the moment defaults are constructed. For desktop fresh installs, default `'floating'`.
- Migration is idempotent: if `recorderMode` already exists, skip. If `settingsVersion < 6`, run the mapping table from §Migration.
- Do NOT delete `showFloatingButton` or `useRecordingModal` in this migration — they still drive desktop behavior and the `modal` mode respectively.

**Patterns to follow:**
- `src/settings/migrations.ts:122-125` — existing migration pattern for `useExpandableFloatingRecorder` (removing a flag)
- `src/settings/migrations.ts:25` — pattern for forcing an unused flag

**Test scenarios:**
- Happy: fresh install on mobile → `recorderMode === 'ribbon'`
- Happy: fresh install on desktop → `recorderMode === 'floating'`
- Migration (mobile, opt-out flip): v5 settings with `showFloatingButton: true, useRecordingModal: false` on mobile → v6 with `recorderMode: 'ribbon'` + `firstRunRibbonNoticeShown: false`
- Migration (desktop, preserves): v5 settings with `showFloatingButton: true, useRecordingModal: false` on desktop → v6 with `recorderMode: 'floating'`
- Migration: v5 settings with `showFloatingButton: false, useRecordingModal: true` → v6 with `recorderMode: 'modal'` (any platform, user had already opted out of floating)
- Migration: v5 settings with `useExpandableFloatingRecorder: true` → v6 without that field
- Idempotent: running migration twice doesn't double-mutate
- Settings UI: `recorderMode` dropdown on mobile shows 3 options; on desktop shows 2 (no `ribbon`)

**Verification:** Open Test Vault settings → Recording → see new "Recorder style" dropdown. Check `data.json` — v5 test fixture migrates as expected. Tests green.

### Unit 1a — First-run Notice for upgrading mobile users

**Goal:** On first 1.1.0 launch for an upgrading mobile user, surface a one-time Notice explaining the new ribbon recorder and offering a single-tap revert to floating.

**Files:**
- `src/settings/Settings.ts` — add `firstRunRibbonNoticeShown: boolean` (default `false`)
- `src/settings/migrations.ts` — set `firstRunRibbonNoticeShown = false` for any user flipped to `ribbon` by the v6 migration; set `true` for fresh installs (they opted into ribbon; no notice needed)
- `src/main.ts` — in `onload()`, after migration, if `Platform.isMobile && settings.recorderMode === 'ribbon' && !settings.firstRunRibbonNoticeShown`, show a persistent Notice with two inline buttons ("Got it" / "Restore floating mic"), then set `firstRunRibbonNoticeShown = true` and `await saveSettings()`.

**Approach:**
- Notice copy (≤3 lines):
  > NeuroVox mobile uses a new recorder (ribbon icons + tap-to-stop indicator). The floating mic was retired to fix iOS keyboard bugs.
  > [Got it] · [Restore floating mic]
- "Restore floating mic" sets `recorderMode = 'floating'`, saves, and shows a confirmation toast. User can flip back anytime from settings.
- Notice is non-blocking — user can dismiss by tapping "Got it" or the Notice close affordance.
- Desktop upgraders see no Notice (they are not migrated to ribbon).

**Patterns to follow:**
- `src/main.ts:105-110` — existing migration-complete Notice pattern

**Test scenarios:**
- Happy: upgrading mobile user with `firstRunRibbonNoticeShown: false` → Notice shown on first load, `firstRunRibbonNoticeShown` persisted `true` after tap
- Happy: "Restore floating mic" → `recorderMode === 'floating'`, floating mic visible after Obsidian reload
- Edge: fresh mobile install → no Notice (fresh installs pre-set `firstRunRibbonNoticeShown = true`)
- Edge: desktop upgrader → no Notice, no mode change
- Idempotent: reloading Obsidian after dismissal → Notice does not re-appear

**Verification:** Seed a v5 `data.json` with mobile-floating config → open 1.1.0-rc.1 on iOS Test Vault → Notice appears once; choose "Restore floating mic" → reload → floating mic visible.

### Unit 2 — `RibbonRecorderController` scaffold + ribbon icons

**Goal:** New class that owns ribbon icon registration + dispose. No recording logic yet; just the two icons wired to no-op handlers.

**Files:**
- `src/ui/RibbonRecorderController.ts` (new) — class with constructor(plugin), `registerIcons()`, `dispose()`, no-op `onRecordTap()`, no-op `onUploadTap()`
- `src/main.ts` — instantiate controller in `onload()` after `initializeProcessingStatus()` when `Platform.isMobile && settings.recorderMode === 'ribbon'`. Dispose in `onunload()`.

**Approach:**
- `registerIcons()` calls `plugin.addRibbonIcon('mic', 'Start recording', onRecordTap)` + `plugin.addRibbonIcon('upload-cloud', 'Upload recording', onUploadTap)`. Store returned `HTMLElement` references on the controller.
- `dispose()` calls `.remove()` on each stored element (belt + suspenders — Obsidian also auto-cleans on unload).
- Icon names: use Lucide names bundled with Obsidian (`'mic'` + `'upload-cloud'` are both current Lucide ids). If either is not available in the current Obsidian version, fall back to `addIcon` with inline SVG.
- Controller stores `plugin` reference and handles its own lifecycle. Do NOT put persistent state on `plugin` itself — keep the blast radius contained to one new class.
- **MarkdownView header action (per review finding #3 — 2-tap ergonomics mitigation):** Also register an `ItemView.addAction('mic', 'Start recording', onRecordTap)` on the active `MarkdownView` via a `workspace.on('active-leaf-change')` subscription. This gives 1-tap recording while the user is actively editing a note — the common case. The ribbon icon remains the canonical entry point (1 tap from other views, 2 taps from inside a note via the mobile menu), but the header action makes the recording-while-editing path faster than today's floating mic (which had to fight the keyboard).
  - Remove the header action on leaf-change (or when the leaf is no longer a `MarkdownView`), re-add on the next active `MarkdownView`.
  - Icon: same `'mic'` Lucide id; tooltip: `"Start recording"`.

**Patterns to follow:**
- `src/main.ts:822` — existing pattern for status bar registration (storage on `this`, no explicit removal)
- `src/modals/TimerModal.ts:39-77` — constructor style, explicit `dispose()`-like method (`cleanup`/`finalizeClose`)

**Test scenarios:**
- Controller instantiated only when `Platform.isMobile && recorderMode === 'ribbon'`
- Both ribbon icons appear in mobile menu after Obsidian reload
- `dispose()` removes both icons and is idempotent
- Changing `recorderMode` from `ribbon` → `floating` at runtime: icons disappear on next Obsidian reload (not required to hot-reload mid-session)
- **MarkdownView header action:** opening a `.md` file → mic action appears in view header; switching to a non-Markdown leaf → action removed; back to a Markdown leaf → action re-added
- **MarkdownView header action:** tapping the header mic triggers the same `onRecordTap` as the ribbon icon (1 code path, not a fork)

**Verification:** Reload Obsidian on iOS Test Vault. Open mobile menu. See 🎙️ and 📤 icons. Tapping either logs the expected no-op to console.

### Unit 3 — Persistent Notice indicator + 1Hz timer

**Goal:** Show a `Notice(timeout=0)` when recording starts. Update it every second with `🔴 REC mm:ss · Tap to stop`. Tap on `notice.noticeEl` triggers stop callback.

**Files:**
- `src/ui/RibbonRecorderController.ts` — add `currentNotice: Notice | null`, `timerInterval: number | null`, `recordingStartedAt: number`, `onStopTap()` handler (stub that just hides notice + clears timer for now — full wiring in Unit 4)
- `styles.css` — optional: scope `.neurovox-recording-notice` class applied to `notice.noticeEl` for any styling tweaks (pulsing red dot animation)

**Approach:**
- On `onRecordTap` (for this unit, a test trigger — actual recording wire-up is Unit 4), construct `new Notice('🔴 REC 0:00 · Tap to stop', 0)`, store reference.
- Add `.neurovox-recording-notice` class to `notice.noticeEl.classList`.
- **Tap-handler DOM stability (per review finding #4):** `notice.setMessage()` can re-render `noticeEl.innerHTML` on some Obsidian versions, which detaches any handler bound directly to `noticeEl` or its children. Two defensive layers:
  1. Bind via `plugin.registerDomEvent(notice.noticeEl, 'click', onStopTap)` on the **outer container** (event bubbles from inner text regardless of innerHTML rebuild).
  2. On every `setMessage` call, re-check `notice.noticeEl.dataset.neurovoxBound` — if falsy, re-attach the click handler and set the flag. This is belt-and-suspenders against Obsidian versions that rebuild the outer element too.
  - Smoke-test step in Unit 3 verification: tap the Notice after 5+ seconds of timer updates → stop must fire.
- Start `setInterval` at 1000ms that calls `notice.setMessage(formatRecordingMessage(elapsedSec))`.
- `formatRecordingMessage(sec)` → `\`🔴 REC ${formatMmSs(sec)} · Tap to stop\``.
- **Permission-pending state (per review finding #5):** before `getUserMedia` resolves (Unit 4 integration), show a transient `new Notice('🎙️ Requesting microphone…', 0)` that gets replaced by the recording Notice on resolve. On denial, replace with a persistent guidance Notice: `"Microphone permission denied. Enable it in iOS Settings → Obsidian → Microphone."` — tap to dismiss.
- On `onStopTap`, clear interval, null out both refs, call `notice.hide()`.

**Patterns to follow:**
- `src/main.ts:833-855` (`startProcessingStatusReconciliation`) — existing pattern for `setInterval` tracked on `this` + cleared in `onunload`
- `src/main.ts:822-824` — adding a CSS class to a dynamically-created HTMLElement

**Test scenarios:**
- Happy: tap record → Notice appears with "🔴 REC 0:00", updates to "0:01" after 1s, "0:02" after 2s
- Happy: tap the Notice → it hides, timer clears
- **DOM stability:** Tap the Notice after ≥5s of `setMessage` updates → stop still fires (handler survives innerHTML rebuilds)
- **DOM stability:** Programmatically delete and rebuild `noticeEl.innerHTML`, then tap → re-attach logic restores the handler on next `setMessage`
- **Permission pending:** mock `getUserMedia` with a 2s delay → "Requesting microphone…" Notice shown for ~2s, then replaced by recording Notice
- **Permission denied:** mock `getUserMedia` rejection with `NotAllowedError` → persistent guidance Notice shown, tap dismisses, state returns to idle
- Edge: tap record twice in a row while Notice active → second tap is a no-op (controller state guard)
- Lifecycle: `plugin.unload()` while Notice active → Notice hides, timer clears, no stray intervals
- iOS: Notice remains visible while keyboard is shown (this is the whole point; Notice is positioned by Obsidian, not by us)
- iOS: Notice remains visible after backgrounding + foregrounding the app (Obsidian's Notice layer handles this)

**Verification:** On iOS Test Vault, tap record → see pulsing indicator at top of screen. Tap it → it hides. Open a note, summon keyboard — indicator stays put. No visualViewport math anywhere in the codebase.

### Unit 4 — Recording wire-up: `StreamingTranscriptionService` + `AudioRecordingManager`

**Goal:** Replace Unit 2/3 stub handlers with the real recording pipeline. `onRecordTap` starts a live session; `onStopTap` finishes and inserts.

**Files:**
- `src/ui/RibbonRecorderController.ts` — add `streamingService`, `recordingManager`, `activeFile`, `cursorPosition` fields. Full `onRecordTap` + `onStopTap` implementations.

**Approach:**
- `onRecordTap` (state: idle):
  1. Capture `activeFile = plugin.app.workspace.getActiveFile()` and `cursorPosition` from the active `MarkdownView.editor` if present (null is acceptable — falls back to `transcriptFolderPath`).
  2. Instantiate `new StreamingTranscriptionService(plugin, { onChunkCommitted, onMemoryWarning })`.
  3. Instantiate `new AudioRecordingManager(plugin)`.
  4. Call `recordingManager.start()` → get `MediaStream`.
  5. Call `streamingService.startLiveSession(stream)`.
  6. Transition to `recording`, show Notice (Unit 3), start timer.
  7. On failure at any step: `streamingService.abort()`, `recordingManager.cleanup()`, show transient Notice `"Recording failed: <reason>"`, return to idle.
- `onStopTap` (state: recording):
  1. Transition to `processing`, update Notice → `"Transcribing…"` with spinner glyph, stop timer.
  2. `const finalBlob = await recordingManager.stop()`.
  3. `const result = await streamingService.finishProcessing()` → `StreamingTranscriptionResult`.
  4. `await plugin.recordingProcessor.processStreamingResult(result, activeFile, cursorPosition, { audioBlob: finalBlob, durationSeconds })` — mirrors `MobileDockPill.ts:313`. On throw, fall back to `plugin.recordingProcessor.processRecording(finalBlob, activeFile, cursorPosition)` (mirrors `MobileDockPill.ts:319`).
  5. Hide Notice, null refs, transition to idle.
- All timers/listeners registered through `plugin.registerDomEvent` / `plugin.registerInterval` where possible so Obsidian auto-cleans.

**Patterns to follow:**
- `src/ui/MobileDockPill.ts:228-260` — existing construction of `StreamingTranscriptionService` + `AudioRecordingManager(plugin)`. Mirror this sequence.
- `src/ui/MobileDockPill.ts:313-319` — canonical `processStreamingResult` / `processRecording` call shape with fallback
- `src/modals/TimerModal.ts:206` — `new StreamingTranscriptionService(...)` call pattern
- `src/modals/TimerModal.ts:400-438` (`cleanup()`) — error-recovery + teardown sequence

**Test scenarios:**
- Happy: record 10s → stop → final transcript inserted at cursor in active note
- Happy: record 10s with no active note → final transcript inserted at `transcriptFolderPath`/new-file (existing `StreamingTranscriptionService` behavior)
- Edge: `getUserMedia` permission denied → Notice shows error, state returns to idle, no leaked WebSocket
- Edge: network drops mid-recording → `onerror` callback fires, Notice shows "Recording failed", state returns to idle, `streamingService.abort()` called
- Edge: Obsidian unloaded mid-recording (`plugin.onunload`) → `streamingService.abort()` + `recordingManager.cleanup()` called, no stray timers, no orphaned Notice
- Integration: final transcript matches what `MobileDockPill` would have inserted for the same audio (diff-test against golden recording if feasible; else manual smoke)
- Concurrency: second `onRecordTap` while in `recording` or `processing` state → no-op (guard via state machine)

**Verification:** Record a 15s mobile clip in Test Vault → transcript appears at cursor → no WebSocket left in Chrome DevTools Network tab (use Safari remote debugging on iOS). Reload Obsidian and re-run; no "can't restart — session already live" error.

### Unit 5 — Live interim preview in Notice

**Goal:** Show rolling interim transcript tail in the Notice while recording, so the user has feedback that audio is landing.

**Files:**
- `src/ui/RibbonRecorderController.ts` — subscribe to interim results from `StreamingTranscriptionService`

**Approach:**
- `StreamingTranscriptionService` already fires `onChunkCommitted` for finalized chunks and exposes `getPartialResult()` for interim. We want interim, so either:
  - **Preferred:** extend `StreamingTranscriptionService` callbacks to add `onInterimUpdate(text)` (fires at adapter cadence, ~10Hz for Deepgram live).
  - **Alternative (no service changes):** poll `streamingService.getPartialResult()` inside the existing 1Hz timer tick.

  Pick the polling path for this unit to keep scope contained — no changes to `StreamingTranscriptionService`. If UX feels too stuttery in smoke test, a follow-up unit adds the explicit callback.
- Message template: `\`🔴 REC ${mmss} · Tap to stop\n${interimTail}\`` where `interimTail = last 50 chars of getPartialResult() with "…" prefix if truncated`.
- Apply CSS in `styles.css` to keep Notice readable at two lines on iOS (`white-space: pre-wrap`, max-width cap).

**Patterns to follow:**
- `src/utils/transcription/StreamingTranscriptionService.ts:346` (`getPartialResult`) — existing API
- `src/ui/MobileDockPill.ts` interim render — check how the pill currently surfaces rolling interim; mirror the truncation logic

**Test scenarios:**
- Happy: speak "the quick brown fox jumps over the lazy dog" → Notice shows truncated tail updating in real time
- Edge: no audio input (silence) → Notice shows just timer, no interim section
- Edge: very long running transcript → Notice tail stays ≤50 chars (no runaway growth)
- Performance: 1Hz polling doesn't drop frames on iOS (visually smooth)
- Reset: stopping + starting a new recording → interim section starts empty (no leftover state)

**Verification:** Record a ~30s monologue on iOS Test Vault → Notice shows last-spoken phrase updating ~1x/sec, timer counts cleanly.

### Unit 6 — Upload handler rewire

**Goal:** `📤` ribbon icon opens `UploadBottomSheet` and wires transcription → end-of-file insertion (Finding 2 parity).

**Files:**
- `src/ui/RibbonRecorderController.ts` — `onUploadTap()` implementation
- (`src/ui/UploadBottomSheet.ts` — untouched)

**Approach:**
- Replicate `MobileDockPill.handleUploadTap()` verbatim into `RibbonRecorderController.onUploadTap()`:
  1. Capture `activeFile` (may be null).
  2. Capture `cursorPosition` (null for uploads — appends at end-of-file per Finding 2).
  3. Construct `new UploadBottomSheet({ plugin, saveAudioOn, onTranscribe, onCancel })` — reuse the exact constructor shape.
  4. `onTranscribe(file, saveAudio)` calls `plugin.recordingProcessor.processRecording(blob, activeFile, null, file.name)` — explicit `null` cursor position forces end-of-file append (existing `DocumentInserter` behavior).
  5. `onCancel` is a no-op.
- Guard: `onUploadTap` is allowed while `state === 'idle'` only. If `recording` or `processing`, show transient Notice "Finish current recording first" and return.

**Patterns to follow:**
- `src/ui/MobileDockPill.ts:168-205` — `handleUploadTap` + `processUploadedFile` — this is the canonical reference

**Test scenarios:**
- Happy: tap 📤 → bottom sheet opens → pick audio file → transcribes → transcript appended at end of active note
- Happy: tap 📤 with no active note → transcribes → transcript written to `transcriptFolderPath` new file (existing fallback)
- Edge: tap 📤 while recording → Notice warns, sheet does not open, existing recording continues
- Edge: cancel in bottom sheet → no file picked, no state change
- Integration: Finding 2 + Unit 6 (the UploadBottomSheet close-timer race fix from prior plan) both remain intact

**Verification:** On iOS Test Vault, tap 📤 → sheet opens smoothly → pick an `.m4a` → transcript appends at end of active note. Check git blame on `UploadBottomSheet.ts` — untouched by this unit.

### Unit 7 — Suppress `FloatingButton` on mobile when `recorderMode === 'ribbon'`

**Goal:** Don't render the floating mic / `MobileDockPill` on mobile when ribbon mode is active. Desktop and non-ribbon modes keep existing behavior.

**Files:**
- `src/main.ts` — gate `createButtonForFile()` (defined at `main.ts:744`, called from `main.ts:89`, `:716`, `:727`) so it early-returns when `Platform.isMobile && settings.recorderMode === 'ribbon'`. Apply the same gate at the three call sites if cheaper than a single in-function early return.
- `src/main.ts:71-72` — `registerFloatingButtonEvents` + initial event trigger — confirm they no-op under the same condition
- `src/main.ts:757-760` (`cleanupUI()`) — already iterates `buttonMap.clear()`; no change, but verify that switching `recorderMode` from `floating` → `ribbon` at runtime + Obsidian reload cleanly removes floating buttons

**Approach:**
- Introduce a small helper `shouldRenderFloatingButton(settings): boolean` in `main.ts` that returns `!Platform.isMobile || settings.recorderMode === 'floating'`. Call it at the top of `createButtonForFile()` (one gate covers all three call sites).
- Do NOT remove `FloatingButton.ts` or `MobileDockPill.ts` in this unit — they're still needed for `recorderMode === 'floating'` (desktop + opted-in mobile users). Retirement of `MobileDockPill` is a future plan once ribbon mode proves out.

**Test scenarios:**
- `recorderMode === 'ribbon'` on mobile → no floating mic visible, no `MobileDockPill` in DOM
- `recorderMode === 'floating'` on mobile → floating mic + `MobileDockPill` behave identically to rc.2
- Desktop (all modes) → `DesktopDockPill` / floating mic behavior unchanged
- Switch mode via settings → `floating` → `ribbon` → full Obsidian reload → ribbon controller active, no floating mic
- Switch mode back `ribbon` → `floating` → reload → floating mic returns, ribbon icons gone (icons auto-cleaned by Obsidian since controller not instantiated)

**Verification:** In Test Vault, toggle `recorderMode` via settings → reload Obsidian → correct surface appears. No orphaned DOM from the previous mode. No console warnings about leaked listeners.

### Unit 8 — Delete `InlineRecorderPanel` + dead flags

**Goal:** Remove unreachable code. `InlineRecorderPanel` and its two gating flags (`useExpandableFloatingRecorder`, `showToolbarButton`) are dead in today's codebase per research §10.

**Files (delete):**
- `src/ui/InlineRecorderPanel.ts` — delete entire file

**Files (edit):**
- `src/ui/FloatingButton.ts` — remove InlineRecorderPanel import at line 6, remove `inlineRecorderPanel` field at line 20 / 51, remove `toggleInlineRecorderPanel()` method (~lines 786-825), remove references at 261, 580-581, 790-791, 805, 813, 824, and the `useRecordingModal && useExpandableFloatingRecorder` branch in `handleClick()` at line 634
- `src/main.ts:704-711` — remove the `button.inlineRecorderPanel` null-guard in `handleActiveLeafChange`
- `src/settings/Settings.ts` — remove `useExpandableFloatingRecorder` and `showToolbarButton` fields
- `src/settings/migrations.ts:122-125, :25` — migration from Unit 1 already deletes these; just remove any defensive references
- `src/settings/accordions/RecordingAccordion.ts:185-186` — remove settings UI entries for the two dead flags
- `styles.css` — delete `.neurovox-inline-recorder-panel*` selectors (line 289+)

**Approach:**
- Cleanup only. No behavior changes — these code paths are unreachable today.
- Do NOT touch `FloatingButton.startDirectRecording()` + `stopDirectRecording()` in this unit even though they're also probably dead. They're legacy fallbacks and deleting them is a separate concern — leave for a future cleanup pass.

**Patterns to follow:**
- Recent cleanup commits in git history for reference style

**Test scenarios:**
- After cleanup, `grep -r "InlineRecorderPanel" src/` returns zero hits
- After cleanup, `grep -r "useExpandableFloatingRecorder\|showToolbarButton" src/` returns zero hits
- `npm run build` succeeds with no TS errors
- Full rc.2 feature parity: all recorder modes + upload + all prior bug fixes still work (regression smoke)
- Bundle size: `main.js` is smaller than rc.2 by ~500 lines worth

**Verification:** Build green. Functional smoke in all three `recorderMode`s. `main.js` SHA-256 captured for post-deploy diffing.

### Unit 9 — Exploration only (DO NOT BUILD): inline CodeMirror interim widget

**Goal:** Write a design note (not code) exploring whether to add a CM6 `WidgetType` interim preview at cursor as a future iteration. Outcome is a document or a brief ADR-style markdown in `docs/explorations/`, not a PR.

**Files (write):**
- `docs/explorations/2026-04-20-codemirror-interim-widget.md` (new)

**Approach:** Summarize research Q4 findings, list 3 specific UX questions we'd want to validate (does inline text compete with the user's own typing? does 10Hz feel too twitchy? does it break selection?), propose a minimal prototype scope for a follow-up release. **Explicitly not part of 1.1.0 build.**

**No test scenarios.** Document only.

## Sequencing

1. **Before this plan starts:** promote `1.0.20-rc.2` → `1.0.20` stable (the already-pending Unit 7 from the prior plan, after 24h bake). This keeps the bug-fix line clean.
2. Once `1.0.20` is out, open a new branch `feat/ribbon-mobile-recorder` off `main`.
3. Land **Unit 1** + **Unit 1a** (settings + migration + first-run Notice). Safe to land alone — no UI surface change for `floating` users.
4. Land **Unit 2** + **Unit 3** (ribbon icons + persistent Notice with no recording wired yet).
5. **🚦 GATE — Unit 3 iOS smoke (per review finding #2).** Build a BRAT-installable `1.1.0-alpha.1` from the Units 1+1a+2+3 stack and install on at least one iOS device. Required pass criteria before Units 4-7 begin:
   - Persistent Notice remains visible for ≥60 seconds of idle time
   - Notice survives iOS keyboard show/hide cycles
   - Notice survives app background → foreground with recording timer state
   - Tap handler fires reliably after `setMessage` updates (DOM stability check)
   - If any criterion fails: STOP. Do not proceed to Unit 4. Pivot decision (per Open Question #1): either retry with the hard fallback (`ItemView.addAction`-only indicator, no Notice) or abandon ribbon mode and rewrite the bug-fix line instead.
   - If all pass: continue.
6. Land **Units 4 → 7** in order. These compose into the working ribbon mode and should land as a cohesive PR (or tightly-chained series) — ribbon mode is non-functional without all four.
7. Cut **`1.1.0-rc.1`** after Units 1–7 land. Publish via BRAT, smoke on iOS + desktop.
8. Bake for 3–7 days. Watch for new failure modes in `Notice` behavior (iOS Safari quirks around persistent OS-managed toasts), user opt-out rate via "Restore floating mic", and upload-path regressions.
9. Promote `1.1.0-rc.1` → `1.1.0` stable.
10. **After `1.1.0` stable + ≥1 week bake:** land **Unit 8** (delete `InlineRecorderPanel` + dead flags) as a separate PR on the `main` branch. Splitting this out (per review finding #8) isolates the dead-code-deletion risk from the ribbon-mode risk — if `1.1.0` is hot-fixed back for any reason, the cleanup is not entangled in the revert.

## Risks

**High:**
- **`Notice(timeout=0)` persistence quirks on iOS Safari Obsidian.** If Obsidian's mobile Notice layer swallows the persistent notice on app background/foreground (e.g., auto-hides after 60s regardless of `timeout=0`), ribbon mode loses its indicator. *Mitigation:* prototype early — Unit 3 smokes this on iOS Test Vault before further units commit. Fallback: re-show Notice on `document.visibilitychange` foreground event. Hard fallback: add an `ItemView.addAction` header button in the active `MarkdownView` as a secondary stop-affordance.

**Medium:**
- **Ribbon tap ergonomics on phone.** Ribbon icons live behind the mobile menu (per research Q2). That's a ~2-tap start ("Menu" → "Start recording") from outside a note vs. today's 1-tap floating mic. *Mitigation (now in Unit 2):* ship the `ItemView.addAction('mic', ...)` header action on the active `MarkdownView` as part of this plan — that gives 1-tap start while editing (the dominant case) without any keyboard math. The ribbon remains the canonical entry point from non-Markdown views. Command palette shortcut (already exists) remains as a fast-path for power users.
- **Settings migration edge cases.** Users with hand-edited `data.json`, old snapshots, or the `5 → 6` migration crash mid-run. *Mitigation:* idempotent migration, defensive defaults, unit tests covering every flag combination in §Migration.
- **State machine gaps.** User force-quits Obsidian mid-recording → Notice orphaned in Obsidian state → next open shows stale "🔴 REC" with stale timer. *Mitigation:* on `onload()` after a detected crash (via existing `JobStore` recovery scan or a dedicated sentinel), drop any leftover Notice. This is already the shape of `reconcileProcessingStatusFromJobs()` in `main.ts:833` — mirror the pattern.

**Low:**
- **Lucide icon drift.** `'mic'` / `'upload-cloud'` names might not exist in the bundled Lucide set on older Obsidian versions. *Mitigation:* `addIcon()` with inline SVG as a guaranteed fallback if the direct name fails.
- **Interim preview polling at 1Hz is visibly laggy.** Text updates feel jerky. *Mitigation:* if smoke test finds this unacceptable, add explicit `onInterimUpdate` callback in `StreamingTranscriptionService` (small, surgical change) as Unit 5.5.

## Verification (end-to-end)

Manual smoke on iOS + desktop Test Vault, covering:
- Fresh install → mobile default = ribbon; desktop default = floating
- Existing mobile user upgrade from rc.2 → 1.1.0-rc.1 → migrated to `ribbon` by default, sees first-run Notice with "Restore floating mic" action; tapping it flips back to `floating` and reload confirms the floating mic is visible
- Existing desktop user upgrade → unchanged; no first-run Notice
- Mobile ribbon mode: record → stop → transcript at cursor
- Mobile ribbon mode: upload → file picker → transcript at end-of-file
- Mobile ribbon mode: keyboard shows/hides → Notice unaffected (this is the whole point of the redesign)
- Mobile ribbon mode: app backgrounded + foregrounded during recording → recording continues, Notice still visible
- Mobile ribbon mode: Obsidian reload mid-recording → graceful recovery (no orphaned WebSocket, no orphaned Notice)
- Mobile floating mode: unchanged behavior vs. rc.2
- Desktop floating mode: unchanged behavior vs. rc.2
- `npm run build` green, `main.js` SHA-256 captured
- Release workflow produces clean draft with 4 assets (parity with rc.2 release)

## References

- Prior plan (bug-fix line): `docs/plans/2026-04-19-001-fix-mobile-recorder-lifecycle-plan.md`
- Obsidian API docs: https://docs.obsidian.md/Plugins
- Obsidian mobile status bar limitation: https://docs.obsidian.md/Plugins/User+interface/Status+bar
- Obsidian Notice + setMessage: https://docs.obsidian.md/Reference/TypeScript+API/Notice
- Obsidian Ribbon actions: https://docs.obsidian.md/Plugins/User+interface/Ribbon+actions

## Open questions (post-planning, for implementation-time resolution)

1. If `Notice(timeout=0)` has iOS lifecycle quirks, does the hard fallback to `ItemView.addAction` become the primary pattern instead? Decide after Unit 3 smoke.
2. Should the ribbon tap also show a transient toast "Recording started" for discoverability, given the Notice may appear a beat later? Decide after Unit 3 UX review.
3. Does `RibbonRecorderController` need to subscribe to `workspace.on('active-leaf-change')` to update cached `activeFile` reference mid-recording, or is captured-at-start-time sufficient? Existing `MobileDockPill` uses captured-at-start-time — match that unless smoke test reveals a concrete break.
