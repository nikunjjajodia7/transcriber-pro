# Plan: Dynamic header recording actions + restore live callout

> **Status (2026-04-28):** PR1 shipped in #12 (`ec106fd` — `LivePreviewWriter`
> extraction + ribbon callback wiring). PR2 was revised on 2026-04-29:
> replace the custom `HeaderRecorderPanel` with state-based native Obsidian
> header actions + persistent `Notice` + mobile-toolbar commands.
>
> **Plan design review:** original custom-panel direction was superseded after
> checking Obsidian's supported UI surfaces. The revised PR2 uses native header
> actions and persistent `Notice` instead of custom-positioned DOM.
>
> **`/ce-plan` deepening pass:** architecture, data-integrity, patterns,
> and repo-research agents accepted-in-full. PR1 remains shipped; PR2 now has
> lower UI risk because Obsidian owns positioning. Deepened: 2026-04-28,
> revised: 2026-04-29.

## Goals

1. **Restore the missing live transcription callout** in the active note
   (a regression introduced when mobile recording moved from `MobileDockPill`
   to `RibbonRecorderController` — the controller never registers
   `onChunkCommitted`, so partials never reach the document).
2. **Add dynamic native header recording controls** that appear only when
   useful: mic while idle; pause/resume + stop while recording; no custom
   panel. Keep Obsidian `Notice` as the recording status/timer surface.

Goal 1 is urgent, low-risk, and reversible. Goal 2 was revised specifically
to avoid the custom DOM positioning class that caused 3 keyboard/viewport
bugs in 30 days per `docs/plans/2026-04-20-001-...`.

Out of scope:
- Redesigning desktop pill (`DesktopDockPill` stays as-is).
- Re-introducing the pill's "expanded" 4-icon intermediate state.
- Save-audio quick toggle in the header (lives in settings + upload sheet).
- Typing `StreamingTranscriptionService` callbacks (separate follow-up —
  the regression's root cause is a free-form `callbacks: any` shape that
  silently accepts missing handlers; worth typing later).
- Editor-transaction-based writes for the live preview (defer; document
  the user-edit clobber contract loudly in §Data-integrity contracts).
- Introducing a test framework. **The repo has no tests today** — no
  `vitest`, no `jest.config`, no `*.test.*`. Verification for both PRs
  is manual iPhone QA against the State coverage matrix. Adding
  vitest+jsdom is a separate scope decision, not bundled here.

---

## Sequencing — shipped PR1, revised PR2

| Order | Ship unit                                           | Risk      | Reversibility |
| ----- | --------------------------------------------------- | --------- | ------------- |
| PR1   | `LivePreviewWriter` extraction + ribbon callback wiring | Low       | Trivial       |
| PR2   | Dynamic native header actions + commands + pause/resume + single-controller invariant | Medium | Per-flag |

**Why the split:** the regression fix is a clean port of working code
already proven on desktop (`DesktopDockPill`) and previously on mobile
(`MobileDockPill`). It does not depend on any new UI surface. Bundling
it with the header-actions UX redesign delays a fix that should ship today and
couples a low-risk change to a higher-risk one. The architecture review
called this out as the load-bearing structural concern.

**Why no iOS positioning spike now:** the spike was only needed for a custom
floating/header-positioned panel. The revised PR2 uses `view.addAction(...)`
and `Notice`, so Obsidian owns placement through keyboard, rotation, and modal
states. iPhone validation is still required, but the empirical question is now
normal behavior QA, not "can our custom geometry survive iOS?"

---

# PR1 — Live-callout regression fix

## Root cause

`RibbonRecorderController.ts:151-157` constructs `StreamingTranscriptionService`
without registering the `onChunkCommitted` callback, so partial transcripts
never reach `DocumentInserter.upsertLiveTranscriptionBlock`. The working
pattern is in `MobileDockPill.ts:235-244` and `DesktopDockPill.ts` (same
fields). Three call sites of the same write-chain pattern is two too many —
extracting consolidates them and fixes the regression in one place.

## Implementation units

### Unit P1.1 — Extract `LivePreviewWriter`

**Goal.** Move `livePreviewWriteChain`, `enqueueLivePreviewUpdate`, and
`clearLivePreviewBlock` out of the two pill controllers into a shared
helper. One canonical implementation. One place to fix bugs going
forward.

**Files.**
- Create: `src/utils/document/LivePreviewWriter.ts`
- Modify: `src/ui/MobileDockPill.ts` (replace inlined methods with helper)
- Modify: `src/ui/DesktopDockPill.ts` (same)

**API shape.**
- Constructor: `new LivePreviewWriter(plugin, file, cursorPosition, markerId)`
- Method: `enqueue(partial: string): Promise<void>` — chains writes, swallows
  per-write errors but tracks first-failure state for D2.
- Method: `clear(): Promise<void>` — flushes the chain, then removes the
  block via `DocumentInserter.removeLiveTranscriptionBlock`.
- Method: `close(): void` — sets the `closed` flag for D1; subsequent
  `enqueue` calls short-circuit.

**Verification.** Existing pill flow on desktop (`DesktopDockPill`)
continues to render the live callout block identically — no visual or
functional regression from the extraction.

### Unit P1.2 — Wire `LivePreviewWriter` into `RibbonRecorderController`

**Goal.** Restore the regressed live callout on mobile.

**Files.**
- Modify: `src/ui/RibbonRecorderController.ts`

**Approach.**
- Add `livePreviewWriter: LivePreviewWriter | null` field.
- In `startRecordingSession()`:
  - Construct `streamingService` with `onChunkCommitted: async (_t, _m, partial) => { if (!plugin.settings.showLiveChunkPreviewInNote) return; await this.livePreviewWriter?.enqueue(partial); }`.
  - Build the writer immediately after the streaming service exists:
    `this.livePreviewWriter = new LivePreviewWriter(plugin, activeFile, cursorPosition, streamingService.getRecoveryJobId())`.
- In stop / cancel / `dispose()` / `handleFailure`:
  - Call `this.livePreviewWriter.close()` first (D1 guard) before any
    subsequent chunk callback can race a re-insert.
  - Call `await this.livePreviewWriter.clear()` in a `finally` to remove
    the block. Mirror `MobileDockPill.handleStopTap` line 298-331.
- In `resetRecordingState`: drop the writer reference.

**Verification.** On mobile in `recorderMode === 'ribbon'`: tap mic → live
transcription callout appears in the active note within ~3-5s, updates as
user speaks, removed on stop / cancel / failure.

## Data-integrity contracts

These contracts apply to both pills and the new ribbon path now that they
share `LivePreviewWriter`.

- **D1. `closed` guard against late-callback races.** After `close()`, any
  `enqueue` short-circuits. Closes the documented race where a final
  streaming chunk fires after `clear()` runs and re-inserts a block
  post-removal. (`MobileDockPill.ts:294-333` is incidentally protected
  on the happy-stop path because `RecordingProcessor.ts:476` strips all
  live blocks before final insert; the cancel path is not, hence the
  guard.)
- **D2. One-shot Notice on persistent write failure.** Today
  `livePreviewWriteChain.catch(() => {})` silently swallows
  file-moved/deleted/locked errors mid-record — user sees a stale
  callout that never updates. The writer tracks `firstFailureSurfaced`;
  on the first failed `vault.modify`, surface a single `new Notice("Live
  preview detached — recording continues")`. Subsequent failures are
  silently logged.
- **D3. User-edit clobber contract (documented, not fixed).**
  `DocumentInserter.upsertLiveTranscriptionBlock`
  (`src/utils/document/DocumentInserter.ts:86-107`) does
  `vault.read → vault.modify` with no revision check. Any user edits
  inside or adjacent to the live-block region between reads (every
  3-5s) are silently overwritten. This contract is unchanged from
  today and not blocking shipping. **Documented in plan; not fixed in
  PR1.** A follow-up should switch to editor transactions.
- **D4. `getRecoveryJobId()` parity verification.**
  `StreamingTranscriptionService.getRecoveryJobId()` and the IDs used by
  `RecordingProcessor.ts:414-509` checkpoints must be the same value, or
  crash recovery silently breaks correlation (the regex-based sweep at
  `main.ts:916-939` still cleans markers, but the recovery modal won't
  match them to a session). Verification step: log both IDs at session
  start and assert equality in dev builds. Drop the assert in prod.

**No marker leakage sweep needed.** `cleanupStaleLivePreviewInVault()` at
`main.ts:916-939` already runs on plugin load and `RecordingProcessor.ts:476`
strips all live blocks before final insert. Cleanup is double-covered.

## PR1 validation

Manual on iPhone (development build):
1. Tap ribbon mic → recording starts, Notice indicator unchanged from today.
2. Within ~3-5s, a live transcription callout appears in the active note.
3. Speak; callout updates with rolling partial transcript.
4. Tap Notice to stop → callout removed, final transcript inserted at original cursor.
5. Tap Notice mid-record → cancel → callout removed, no transcript inserted.
6. Disable plugin mid-record → callout cleared on next vault scan / load.
7. Settings → toggle "Show live chunks in note" off → no callout appears next time.

**Desktop regression:** record on desktop with `DesktopDockPill` → live
callout still appears identically (the extraction must not change behavior).

---

# PR2 — Dynamic native header actions

## Decision

The custom `HeaderRecorderPanel` plan is superseded. PR2 should use
Obsidian-owned surfaces only:

- `MarkdownView.addAction(...)` for state-based note-header buttons.
- Persistent `Notice(timeout = 0)` for recording status, timer, interim tail,
  tap-to-stop, and processing state.
- Registered commands with icons so users can add recording actions to the
  mobile toolbar or mobile Quick Action.

This keeps the "things in the header" UX while avoiding the prior bug class:
custom-positioned DOM that must chase iOS keyboard, rotation, and modal
viewport changes.

## Visual spec

```
Idle:
[ ▢       Untitled                            🎙  ⋯ ]

Idle with optional upload enabled:
[ ▢       Untitled                         ⬆  🎙  ⋯ ]

Recording:
[ ▢       Untitled                         ⏸  ⏹  ⋯ ]
Notice: 🔴 REC 0:42 · Tap to stop

Paused:
[ ▢       Untitled                         ▶  ⏹  ⋯ ]
Notice: ⏸ Paused 0:42 · Tap to stop

Processing:
[ ▢       Untitled                            ⋯ ]
Notice: Transcribing...
```

No plugin panel overlays the title. No geometry code. Extra controls appear
only while they are useful.

## State rules

| State | Header actions | Notice |
| ----- | -------------- | ------ |
| No active Markdown view | none | none |
| Idle | mic; optional upload | none |
| Requesting mic permission | none or disabled mic | `Requesting microphone...` |
| Recording | pause + stop | persistent timer + tap-to-stop |
| Paused | resume + stop | persistent paused timer + tap-to-stop |
| Processing | none | persistent `Transcribing...` |
| Error | return to idle actions | transient error Notice |

Upload should not appear while recording, paused, or processing. If we keep
upload in the header at all, it is idle-only. Upload remains available through
the ribbon action and command path either way.

## Implementation units

### Unit P2.1 — Header action state manager

**Files.** Modify: `src/ui/RibbonRecorderController.ts`.

**Approach.**
- Replace the current single `headerAction` field with a small action registry:
  `micAction`, `uploadAction`, `pauseAction`, `resumeAction`, `stopAction`.
- Add `refreshHeaderActions()` that:
  - gets the active `MarkdownView`,
  - detaches any actions that do not belong in the current state,
  - creates missing actions with `view.addAction(...)`,
  - stores each returned `HTMLElement`,
  - no-ops when there is no active Markdown view.
- Use `HTMLElement.detach()` for removal rather than CSS-only hiding. This
  keeps the header physically uncluttered and avoids hidden focus targets.
- Add tooltip/title text for every action:
  - mic: `Start recording`
  - upload: `Upload recording`
  - pause: `Pause recording`
  - resume: `Resume recording`
  - stop: `Stop recording`

### Unit P2.2 — Keep Notice as the state indicator

**Files.** Modify: `src/ui/RibbonRecorderController.ts`.

**Approach.**
- Keep the existing persistent `Notice` flow instead of deleting it.
- Update message formatting for states:
  - recording: `REC mm:ss · Tap to stop`
  - paused: `Paused mm:ss · Tap to stop`
  - processing: `Transcribing...`
- Keep the existing tap-to-stop handler on `notice.noticeEl`.
- Ensure `setMessage()` reattaches the tap handler after each update, as the
  current implementation already does.

### Unit P2.3 — Pause/resume

**Files.** Modify: `src/ui/RibbonRecorderController.ts`.

**Approach.**
- Add paused state fields to the controller.
- Port the working `MobileDockPill.handlePauseTap` behavior:
  - pause calls `streamingService.pauseLive()`,
  - resume calls `streamingService.resumeLive()`,
  - update header actions and Notice immediately after state changes.
- Timer should freeze while paused if that is how the existing pill behaves;
  otherwise match the pill exactly for consistency.

### Unit P2.4 — Upload as idle-only header action plus command

**Files.** Modify: `src/ui/RibbonRecorderController.ts` and `src/main.ts`.

**Approach.**
- Register upload header action only in idle state, or hide it behind a setting
  if header crowding still feels high.
- Keep the existing upload flow unchanged: tap upload → `UploadBottomSheet`.
- Add/confirm commands with icons:
  - `Start recording` / `Stop recording` or one `Toggle recording`
  - `Upload recording`
  - `Pause/resume recording`
- Commands give mobile users native access through Obsidian's mobile toolbar
  and Quick Action without crowding the note header.

### Unit P2.5 — Active view and state transitions

**Files.** Modify: `src/ui/RibbonRecorderController.ts`.

**Approach.**
- Refresh actions on:
  - `active-leaf-change`,
  - `layout-change`,
  - record start,
  - pause/resume,
  - stop/cancel,
  - processing start/end,
  - dispose.
- During an active recording, controls may follow the active Markdown header
  because they are actions, not a status surface. The captured `activeFile`
  and cursor remain the source of truth for where the transcript lands.
- If no Markdown note is active mid-recording, remove header actions but keep
  the persistent Notice so the user still knows recording is active.

### Unit P2.6 — Single-controller invariant

**Files.** Modify: `src/main.ts`.

**Approach.**
- Add an assertion that `MobileDockPill` and `RibbonRecorderController` are
  mutually exclusive for mobile ribbon mode.
- If both ever exist simultaneously, fail loudly with `console.error` and a
  `Notice` instead of letting both controllers write live-preview markers.

## State coverage matrix

| # | State / event | Expected behavior |
| - | ------------- | ----------------- |
| 1 | Idle note open | Mic visible; upload visible only if enabled; no Notice |
| 2 | Tap mic | Header switches to pause + stop; recording Notice appears |
| 3 | Tap pause | Header switches to resume + stop; Notice shows paused |
| 4 | Tap resume | Header switches back to pause + stop; Notice shows recording |
| 5 | Tap stop | Header controls disappear; Notice shows processing |
| 6 | Processing completes | Notice hides; idle header actions return |
| 7 | Upload idle | Bottom sheet opens; no recording controls appear |
| 8 | Upload while recording | Upload action absent; command path shows `Finish the current recording first.` |
| 9 | Active leaf changes mid-record | Header actions move/remove based on active Markdown view; Notice remains |
| 10 | No active Markdown view mid-record | Header actions removed; Notice remains tappable to stop |
| 11 | Command palette/modal opens | No special positioning behavior needed; Obsidian owns header + Notice |
| 12 | Keyboard opens/closes | No custom repositioning needed; Obsidian owns header + Notice |
| 13 | Rotation | No custom repositioning needed; Obsidian owns header + Notice |
| 14 | Plugin disable mid-record | Header actions detach; Notice hides; live preview closes then clears |
| 15 | Recording error | Header returns to idle; transient error Notice shown |
| 16 | Desktop regression | Desktop dock pill remains unchanged |

## Native Obsidian behavior alignment

- Use `view.addAction(...)` for header controls; do not create a custom panel.
- Use `HTMLElement.detach()` to remove inactive controls from the header.
- Use built-in Lucide icon names accepted by Obsidian (`mic`, `upload`,
  `pause`, `play`, `square`/`circle-stop` depending on current icon support).
- Keep UI text sentence-case and short.
- Use `Notice` for status, not header text.
- Register commands with `icon` so they render well in command palette and
  mobile toolbar.

## PR2 validation

Manual on iPhone (development build pushed via Conductor). Validation must
exercise every row of the State coverage matrix.

**Core flow:**
1. Idle note header shows only mic, plus upload only if enabled.
2. Tap mic → header switches to pause + stop, persistent Notice timer starts.
3. Live callout appears in note body within ~3-5s, updates as you speak.
4. Tap pause → header switches to resume + stop, Notice shows paused state.
5. Tap resume → header switches back to pause + stop, Notice shows recording.
6. Tap stop → header controls disappear, Notice shows `Transcribing...`, live
   callout is removed, final transcript inserts at original cursor.
7. Tap Notice while recording → stop path runs exactly once.
8. Tap upload while idle → bottom sheet opens; no recording controls appear.

**State matrix coverage:**
9. Switch to another note mid-record → header actions follow active Markdown
   view if available; Notice remains visible; final transcript still lands in
   the original note.
10. Open command palette mid-record → no custom UI mispositions; header actions
    and Notice remain Obsidian-managed.
11. Tap into note body so iOS keyboard opens → no custom UI mispositions.
12. Rotate device mid-record → no custom UI mispositions.
13. Close all Markdown views mid-record → header actions disappear; Notice
    remains tappable to stop.
14. Use upload command while recording → command warns `Finish the current
    recording first.` and does not open the sheet.
15. Disable plugin mid-record → header actions detach, Notice hides, live
    preview clears, no orphaned markers.
16. Simulate recording error → header returns to idle; transient error Notice
    appears.

**Command / mobile toolbar checks:**
17. Command palette exposes recording commands with icons.
18. On mobile, commands can be added to the mobile toolbar / Quick Action.
19. Command state is correct: pause/resume hidden or guarded when not recording;
    upload guarded during recording/processing.

**A11y spot checks:**
20. VoiceOver: header action titles are readable (`Start recording`, `Pause
    recording`, `Resume recording`, `Stop recording`, `Upload recording`).
21. Bluetooth keyboard: header actions remain reachable as native Obsidian
    clickable icons; no hidden detached controls receive focus.

**Single-controller invariant check:**
22. Toggle `recorderMode` mid-record (if surfaced in settings) → either
    blocked entirely or asserts loudly; never both controllers active.

**Desktop regression:** launch desktop build, confirm `MobileDockPill`
still works unchanged. Ribbon controller is mobile-only (gated by
`recorderMode === 'ribbon'`).

---

## Files touched (cumulative across both PRs)

**PR1:**
- New: `src/utils/document/LivePreviewWriter.ts`
- Modified: `src/ui/MobileDockPill.ts` (replace inlined methods)
- Modified: `src/ui/DesktopDockPill.ts` (replace inlined methods)
- Modified: `src/ui/RibbonRecorderController.ts` (wire callback + writer)

**PR2:**
- Modified: `src/ui/RibbonRecorderController.ts` (state-based header actions,
  pause/resume, idle-only upload action, Notice state updates)
- Modified: `src/main.ts` (commands + single-controller invariant assertion)

No changes to:
- `styles.css` (no custom panel or positioning styles)
- `src/utils/document/DocumentInserter.ts` (already exposes the API we need)
- `src/utils/transcription/StreamingTranscriptionService.ts` (already exposes
  `onChunkCommitted` + `getRecoveryJobId`)
- `UploadBottomSheet` (unchanged flow)

---

## Open questions

- **Should upload appear in the header by default?** Default plan: yes, but
  idle-only. If the header still feels crowded, keep upload as command/ribbon
  only.
- **Mic action while recording: remove or morph?** Default plan: remove mic and
  show explicit pause + stop. This is clearer than overloading mic as stop.
- **Separate stop and cancel?** Default plan: stop only in the header; cancel
  can remain a command/follow-up if users need it. The earlier panel's `X`
  is intentionally not carried forward.

## Future follow-ups (deferred, not in this plan)

- Type `StreamingTranscriptionService.callbacks` so missing `onChunkCommitted`
  is a TypeScript error, not a silent regression. The fact that the regression
  could even occur (and that the deleted `TimerModal.ts:206` was a fourth
  silent call site) is a structural signal worth fixing.
- Switch `DocumentInserter.upsertLiveTranscriptionBlock` to editor
  transactions to fix the user-edit clobber risk (§Data-integrity contracts D3).
- Vitest + jsdom for at minimum `LivePreviewWriter` and header-action
  state-transition logic. Manual QA covers PR1 and PR2 today; tests pay off
  on the next regression.
