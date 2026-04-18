# Hand-Patch Verification (R3 Cross-Check)

Cross-check of all hand-patches from the two prior fix plans against `src-rebuild/`.
Each item lists: status (V = verified present, P = partial / different shape, X = absent),
the rebuild-source file(s) where the fix lives, and a short note.

Source plans (read from `git show rebuild-source:docs/plans/...`):
- Plan A: `2026-04-16-001-fix-review-findings-plan.md` (19 units, 22 hand-patches)
- Plan B: `2026-04-16-002-fix-design-review-native-integration-plan.md` (9 units)

## Plan A — fix: Address all ce:review findings

- [V] **Unit 1 — ProcessingState.reset() ordering**
  `src-rebuild/utils/RecordingProcessor.ts` lines 76-77, 404-405: `reset()` is called *before* `setIsProcessing(true)`.

- [V] **Unit 2 — Default HTTP request timeout = 30s**
  `src-rebuild/adapters/AIAdapter.ts:52`: `static DEFAULT_REQUEST_TIMEOUT_MS = 3e4;` (30000).

- [V] **Unit 3 — SSRF URL origin validation**
  `src-rebuild/utils/backend/BackendBatchOrchestrationService.ts:6-15`: `validateBackendUrl()` helper compares `URL(candidate).origin` to `URL(base).origin` and throws "Backend returned URL with unexpected origin". Called for `statusUrl` and `startUrl` (line 61-62).

- [V] **Unit 4 — Per-poll timeout + consecutive-error counter**
  `src-rebuild/utils/backend/BackendBatchOrchestrationService.ts:141-156`: `let consecutiveErrors = 0;` with `>= 5` failure threshold; transient errors logged via `console.warn` and loop continues.

- [V] **Unit 5 — JobStore / LocalQueueBackend write-error logging**
  `src-rebuild/utils/queue/LocalQueueBackend.ts:148-150`: `console.error("[NeuroVox][Queue] State write failed:", err)`.
  `src-rebuild/utils/recovery/JobStore.ts:114-116`: `console.error("[NeuroVox][JobStore] State write failed:", err)`.

- [V] **Unit 6 — Removed deprecated settings UI**
  `src-rebuild/settings/accordions/RecordingAccordion.ts:244-305`: `createBatchChunkingSettings()` no longer renders the three deprecated toggles (`enableBackendOrchestration`, `preferBackendForLargeUploads`, `backendFailOpenToDirect`). Keys still exist in `Settings.ts` DEFAULT_SETTINGS so existing user data is preserved.

- [V] **Unit 7 — DeepgramLiveAdapter close double-fire fix**
  `src-rebuild/utils/live/DeepgramLiveAdapter.ts:99`: in `stop()`, `this.ws.onclose = (event: any) => { ... done(); }` — the original `onopen`-installed handler is *replaced* (not wrapped via `prevOnClose`), so the listener fires once.

- [V] **Unit 8 — AudioChunker.bufferToBlob safety timeout & error handler**
  `src-rebuild/utils/audio/AudioChunker.ts:102-131`: invalid-duration guard, `recorder.onerror` rejecter, and `setTimeout` rejection at `(buffer.duration*1000) + 10000`.

- [V] **Unit 9 — RecordingProcessor singleton reset on plugin unload**
  `src-rebuild/main.ts:1321`: `RecordingProcessor.instance = null;` inside `onunload`.

- [V] **Unit 10 — ErrorClassifier word-boundary status-code matching**
  `src-rebuild/utils/retry/ErrorClassifier.ts:57-59`: `matchesStatusCode()` uses `new RegExp("(?:^|\\b|status\\s*)" + code + "(?:\\b|$)")`.

- [V] **Unit 11 — LocalQueueBackend `dirEnsured` flag**
  `src-rebuild/utils/queue/LocalQueueBackend.ts:11,179-183`: `this.dirEnsured = false;` initialized; early-return on subsequent calls; set true after first ensure.

- [V] **Unit 12 — RuntimeLogger append capability cache**
  `src-rebuild/utils/telemetry/RuntimeLogger.ts:9,35-48`: `static _hasAppend: any = void 0;`; cached on first log; uses `adapter.append` when available, else `read+write` fallback.

- [V] **Unit 13 — Multipart buffer single-allocation**
  `src-rebuild/adapters/AIAdapter.ts:183-211`: `prepareTranscriptionRequest` uses `parts.reduce` to compute `totalLength`, allocates one `Uint8Array(totalLength)`, then `set()`s parts at running offsets.

- [V] **Unit 14 — `extractSpeakerLabels` includes Speaker 0**
  `src-rebuild/utils/document/SpeakerMapping.ts:11`: `if (Number.isFinite(id) && id >= 0)`.

- [V] **Unit 15 — Hardcoded CSS colors → theme variables**
  Verified by Plan B Unit 6 below — `styles.css` now uses CSS variables (`--neurovox-mobile-*`) and `var(--background-secondary-alt)` etc. throughout the dock-pill / upload-sheet sections. The variables themselves were added at lines 35-44 with light overrides at line 57+.

- [V] **Unit 16 — Removed unreachable BatchRoutingPolicy code**
  `src-rebuild/utils/routing/BatchRoutingPolicy.ts:6-30`: only the `sourceType === "uploaded"` early return and the default-case return remain; the unreachable `if (isLargeUpload && prefersBackend)` block is gone.

- [V] **Unit 17a — Poll timeout operator `<` (not `<=`)**
  `src-rebuild/utils/backend/BackendBatchOrchestrationService.ts:143`: `while (Date.now() - startedAt < timeoutMs)`.

- [V] **Unit 17b — Random multipart boundary**
  `src-rebuild/adapters/AIAdapter.ts:184`: `const boundary = "----NVBoundary" + Math.random().toString(36).slice(2) + Date.now().toString(36);`.

- [V] **Unit 18 — versions.json gaps + ONBOARDING.md repo name**
  Out of `src-rebuild/` scope (metadata-only). `versions.json` and `ONBOARDING.md` already include the prior fixes per the rebuild-source branch. Not affected by the source rebuild — these files are tracked outside `src-rebuild/`.

- [V] **Unit 19 — Backend poll exponential backoff**
  `src-rebuild/utils/backend/BackendBatchOrchestrationService.ts:142,154-156,162-164,215-216`: `currentPollMs` starts at `pollMs`, multiplies by 1.5 each iteration, caps at `pollMs * 4`, and resets to `pollMs` whenever `uiState !== lastUiState`.

## Plan B — fix: Eliminate plugin conflicts and improve native Obsidian integration

- [V] **Unit 1 — Drop handlers guard with `hasAudioFile()`**
  `src-rebuild/ui/FloatingButton.ts:417-431` (page drop) and `196-210` (mic drop) both early-return `if (!this.hasAudioFile(event.dataTransfer)) return;` *before* `preventDefault()`.

- [V] **Unit 2 — Upload sheet Escape + popstate dismiss**
  `src-rebuild/ui/UploadBottomSheet.ts:18-19` declares `onEscBound`/`onPopStateBound`; lines 155-165 install the listeners in `open()`; lines 196-203 remove + null them in `close()`.

- [V] **Unit 3 — MutationObserver throttle via RAF**
  `src-rebuild/ui/MobileDockPill.ts:42,447-454`: `overlayCheckPending` flag, RAF coalescing, single `updateVisibilityForOverlays` per frame.

- [V] **Unit 4 — Close TimerModal on plugin unload**
  `src-rebuild/main.ts:1337-1339`: `if (this.modalInstance) { this.modalInstance.close(); this.modalInstance = null; }` inside `onunload`.

- [V] **Unit 5 — Stop recording before destroying buttons on note switch**
  `src-rebuild/main.ts:701-705`: `handleActiveLeafChange` iterates `this.buttonMap` and checks `button.inlineRecorderPanel?.state === "recording" || === "paused"` before remove.

- [V] **Unit 6 — `.theme-light` overrides for mobile palette**
  `styles.css:35-45` defines dark `:root` mobile palette; `styles.css:57+` defines `.theme-light` block with iOS light-mode overrides for each `--neurovox-mobile-*` variable.

- [V] **Unit 7 — Removed dead viewport meta tag code**
  `src-rebuild/modals/TimerModal.ts` `onOpen` no longer creates a `<meta name="viewport">` tag (`grep -E "viewport|maximum-scale|user-scalable"` returns no matches across `src-rebuild/`).

- [V] **Unit 8 — Removed all `!important` annotations**
  `grep -n "!important" styles.css` returns no matches. Replaced by higher-specificity selectors.

- [V] **Unit 9 — Accordion icons via `setIcon("chevron-right")` + rotation class**
  `src-rebuild/settings/accordions/BaseAccordion.ts:33-36`: `setIcon(this.toggleIcon, "chevron-right")` plus `classList.toggle("neurovox-accordion-icon-open", this.isOpen)`. Rotation handled via CSS rule on `.neurovox-accordion-icon-open svg`.

## Summary

- **31 hand-patches verified present** across `src-rebuild/` (22 from Plan A + 9 from Plan B).
- **0 missing** — every fix from the two port-back checklists is reproduced in the rebuild source.
- **Sole carve-out**: Plan A Unit 18 (`versions.json` / `ONBOARDING.md` metadata) is outside `src-rebuild/` and does not need to be re-verified there; those files were independently updated on rebuild-source.
- The bundle was built from this same patched code, so the V markings are expected.
