---
title: "fix: Address all ce:review findings in NeuroVox bundle"
type: fix
status: completed
date: 2026-04-16
---

# Fix: Address All ce:review Findings in NeuroVox Bundle

## Overview

Apply fixes for 22 actionable findings (P1-P3) from the full-codebase ce:review directly to the bundled `main.js` and `styles.css`. This is a distribution-only repo with no TypeScript source available, so all edits target the readable esbuild bundle. Five advisory findings (Obsidian API limitations, Deepgram protocol design) are documented but not fixable here.

## Problem Frame

The ce:review identified critical issues including a concurrency guard that immediately negates itself, disabled-by-default HTTP timeouts, SSRF via backend-controlled URLs, silent write-error swallowing in the job queue, and WebSocket lifecycle bugs. These affect reliability for every user of the plugin.

## Requirements Trace

- R1. Fix all P1 critical issues (6 findings) before any other work
- R2. Fix all actionable P2 issues (14 findings) for robustness
- R3. Fix P3 issues (5 findings) where straightforward
- R4. Minimize blast radius — each edit should be as localized as possible to reduce risk in the bundle
- R5. Document advisory findings that cannot be fixed in this repo

## Scope Boundaries

- **In scope:** All fixes that can be applied to `main.js` and `styles.css` directly
- **Not in scope:** Adding a test suite (dist-only repo), fixing Obsidian API limitations (requestUrl can't be aborted), changing Deepgram's WebSocket auth protocol, adding source maps
- **Constraint:** Edits to `main.js` will be overwritten if new build artifacts are copied from the source repo. Each fix should be documented clearly enough to re-apply or port to the source.

## Key Technical Decisions

- **Edit the bundle directly:** The bundle is readable, non-minified JavaScript. Localized edits are safe and the same approach used in prior commits (e.g., v1.0.12-v1.0.15).
- **Group fixes by subsystem, not severity:** Reduces context-switching and minimizes risk of conflicting edits in the same code region.
- **Skip WebSocket reconnection:** Adding reconnection logic to `DeepgramLiveAdapter` is a significant refactor that risks breaking the streaming flow. The double-fire fix and unexpected-close logging are safer.
- **In-memory caching for JobStore/LocalQueueBackend is deferred:** The read-modify-write pattern is deeply embedded; adding a cache layer in the bundle is high-risk. Instead, fix the critical write-error swallowing and add `ensureDir` guards.

## Open Questions

### Resolved During Planning

- **Can we edit main.js safely?** Yes — prior commits show direct bundle edits (v1.0.12-v1.0.15). The bundle is readable esbuild output.
- **Should we add WebSocket reconnection?** No — too risky in the bundle. Fix the double-fire bug and log unexpected closes instead.
- **Should we add in-memory caching to JobStore?** No — fix the write-error swallowing (the critical bug) and defer caching to the source repo.

### Deferred to Implementation

- **Exact line numbers may shift** as earlier units modify the file. Each unit should search for the pattern rather than relying on fixed line numbers.
- **Runtime testing** — each fix should be verified by exercising the relevant plugin feature in Obsidian.

## Implementation Units

### Phase 1: P1 Critical Fixes

- [x] **Unit 1: Fix ProcessingState.reset() ordering in RecordingProcessor**

  **Goal:** Prevent the concurrency guard from being immediately negated.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6994-6996)

  **Approach:**
  - In `processRecording()`, the current code calls `this.processingState.setIsProcessing(true)` then immediately calls `this.processingState.reset()`, which sets `isProcessing` back to `false`.
  - Fix: call `reset()` first, then `setIsProcessing(true)` — or modify `reset()` to not touch `isProcessing` when called during the processing preamble.
  - The safest fix is to swap the order: `reset()` before `setIsProcessing(true)`.

  **Patterns to follow:**
  - The guard check at the top of `processRecording` that reads `getIsProcessing()`.

  **Test scenarios:**
  - Happy path: Start a recording, verify `isProcessing` stays `true` throughout processing
  - Edge case: Attempt to start a second recording while one is processing — should throw "Recording is already in progress"

  **Verification:**
  - After the fix, `this.processingState.getIsProcessing()` returns `true` after the preamble completes, blocking concurrent calls.

- [x] **Unit 2: Set a real default HTTP request timeout**

  **Goal:** Prevent indefinite hangs on API calls.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 4927)

  **Approach:**
  - Change `AIAdapter.DEFAULT_REQUEST_TIMEOUT_MS = 0` to `AIAdapter.DEFAULT_REQUEST_TIMEOUT_MS = 30000` (30 seconds).
  - This activates the existing `Promise.race` timeout branch at line 4871 for all API calls.

  **Test scenarios:**
  - Happy path: API calls with normal latency complete successfully
  - Error path: Simulate a hung API (e.g., bad endpoint) — should timeout after 30s with a clear error message

  **Verification:**
  - The `timeoutMs > 0` branch at line 4871 now executes for all default calls.

- [x] **Unit 3: Add URL origin validation for backend-provided URLs (SSRF fix)**

  **Goal:** Prevent a malicious/compromised backend from redirecting requests to internal services.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6772 and ~line 6881)

  **Approach:**
  - After receiving `uploadUrl`, `statusUrl`, and `resultUrl` from the backend create-job response, validate that each URL's origin matches `backendBaseUrl`'s origin.
  - Add a helper function `validateBackendUrl(candidateUrl, backendBaseUrl)` that parses both URLs and asserts `new URL(candidate).origin === new URL(base).origin`.
  - Throw an error if validation fails: `"Backend returned URL with unexpected origin"`.
  - Apply the same check to `resultUrl` received during polling.

  **Test scenarios:**
  - Happy path: Backend returns URLs on the same origin as `backendBaseUrl` — proceeds normally
  - Error path: Backend returns `http://169.254.169.254/...` — throws origin mismatch error
  - Edge case: Backend returns a relative URL — should be resolved against `backendBaseUrl` before validation

  **Verification:**
  - All `requestUrl` calls in `BackendBatchOrchestrationService` use only validated URLs.

- [x] **Unit 4: Add per-request timeout and error handling in poll loop**

  **Goal:** Prevent a single hung poll request from stalling the entire job.

  **Requirements:** R1

  **Dependencies:** Unit 2 (default timeout must be set)

  **Files:**
  - Modify: `main.js` (~line 6848-6913, `pollForResult` method)

  **Approach:**
  - Wrap each `requestJson` call inside the poll loop in a try/catch. On transient errors (network, timeout, 5xx), log the error and continue polling rather than killing the job.
  - Add a consecutive-error counter; after 5 consecutive failures, throw to fail the job.
  - Pass an explicit `timeoutMs` of 15000 to `requestJson` for poll requests (the method uses `requestUrl` which respects Obsidian's timeout).

  **Test scenarios:**
  - Happy path: Poll succeeds after a few iterations — job completes
  - Error path: Backend returns 500 on one poll — loop continues, job eventually completes
  - Error path: Backend is unreachable for 5 consecutive polls — job fails with clear error
  - Edge case: `backendJobTimeoutSec` elapses — job fails with timeout message

  **Verification:**
  - A single transient poll failure no longer kills the entire transcription job.

- [x] **Unit 5: Fix silent write-error swallowing in JobStore and LocalQueueBackend**

  **Goal:** Ensure write failures are logged and propagated, not silently swallowed.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6297 and ~line 6488, both `withState` methods)

  **Approach:**
  - In both `withState` methods, change `this.writeChain = run.catch(() => {})` to log the error before swallowing:
    ```
    this.writeChain = run.catch((err) => {
      console.error("[NeuroVox] State write failed:", err);
    });
    ```
  - The `await run` on the next line already propagates the error to the caller, so the caller does see the failure. The `catch` on the chain prevents an unhandled rejection from breaking subsequent operations. Adding the log ensures the failure is visible.

  **Test scenarios:**
  - Happy path: Normal state writes succeed and persist
  - Error path: Simulated write failure (e.g., disk full) — error is logged to console and propagated to caller

  **Verification:**
  - Write failures appear in the console log. Subsequent writes still function (chain doesn't break).

- [x] **Unit 6: Clean up deprecated settings UI**

  **Goal:** Remove confusing deprecated settings from the UI that still write to runtime config.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~lines 8173-8217, three deprecated settings in `createBatchChunkingSettings`)

  **Approach:**
  - Comment out (or remove) the three `new Setting` blocks for: `enableBackendOrchestration` (line 8173), `preferBackendForLargeUploads` (line 8179), and `backendFailOpenToDirect` (line 8212).
  - Keep the setting fields in `DEFAULT_SETTINGS` so existing saved values don't cause errors on load, but remove the UI controls so users can't toggle them.

  **Test scenarios:**
  - Happy path: Settings panel renders without the three deprecated toggles
  - Edge case: Existing settings with these values set — plugin loads without error, values remain in saved data but are not visible

  **Verification:**
  - Open NeuroVox settings — the three deprecated toggles no longer appear.

### Phase 2: P2 Robustness Fixes

- [x] **Unit 7: Fix DeepgramLiveAdapter double-fire closed event**

  **Goal:** Prevent the `closed` event from firing twice when `stop()` is called.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 9325-9393, `start()` and `stop()` methods)

  **Approach:**
  - In the `start()` method, after the WebSocket opens successfully (inside `ws.onopen`), replace the `ws.onclose` handler with one that only fires the listener once and sets a `closeFired` flag.
  - In `stop()`, check `closeFired` before invoking the listener again.
  - Alternatively (simpler): in `stop()`, set `this.ws.onclose = null` before assigning the new close handler, preventing the `prevOnClose` wrapping pattern from double-firing.

  **Test scenarios:**
  - Happy path: Start streaming, stop — `closed` event fires exactly once
  - Edge case: Stop called while WebSocket is still connecting — no double-fire

  **Verification:**
  - Add a temporary `console.log` in the listener callback during testing; verify only one `closed` event per stop.

- [x] **Unit 8: Fix AudioChunker.bufferToBlob to handle errors and timeouts**

  **Goal:** Prevent the promise from hanging forever on MediaRecorder errors.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 4600, `bufferToBlob` method)

  **Approach:**
  - Add `recorder.onerror = (e) => reject(new Error("MediaRecorder error in bufferToBlob"))` to the promise wrapper.
  - Add a safety timeout that rejects after `(buffer.duration * 1000) + 10000`ms (buffer duration + 10s grace period).
  - Guard against `buffer.duration <= 0` or `NaN` — reject immediately with a descriptive error.

  **Test scenarios:**
  - Happy path: Normal audio buffer converts to blob successfully
  - Error path: Zero-duration buffer — rejects with clear error
  - Error path: MediaRecorder errors — rejects instead of hanging

  **Verification:**
  - `bufferToBlob` always resolves or rejects within a bounded time.

- [x] **Unit 9: Fix RecordingProcessor singleton stale reference on plugin reload**

  **Goal:** Ensure the singleton is reset when the plugin unloads.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6962 for static reset, ~line 15167 for onunload)

  **Approach:**
  - Add a static `reset()` method to `_RecordingProcessor`: `_RecordingProcessor.instance = null;`
  - Call it from `_NeuroVoxPlugin.onunload()` before the existing cleanup: `_RecordingProcessor.instance = null;` (or `RecordingProcessor.instance = null;` depending on the export name).

  **Test scenarios:**
  - Happy path: Plugin reload creates a fresh `RecordingProcessor` with the new plugin instance
  - Edge case: Plugin unloaded mid-recording — singleton is nulled, next load starts fresh

  **Verification:**
  - After plugin reload, `RecordingProcessor.getInstance(this)` returns a new instance bound to the current plugin.

- [x] **Unit 10: Improve ErrorClassifier to avoid substring false positives**

  **Goal:** Prevent URLs or paths containing status code digits from causing misclassification.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6536-6598, `classifyError` function)

  **Approach:**
  - For numeric status code patterns (`401`, `403`, `429`, `400`, `500`, `502`, `503`, `504`), change the matching to use word boundaries: check for the number preceded by a space, colon, or start of string, and followed by a space, end of string, or punctuation.
  - Replace simple string includes with a regex test: e.g., `/(^|\b|status\s*)401(\b|$)/i.test(message)` for auth errors.
  - Keep the descriptive string matches (`"unauthorized"`, `"rate limit"`, etc.) as-is since they're less prone to false positives.

  **Test scenarios:**
  - Happy path: Error message "401 Unauthorized" classifies as `auth`
  - Edge case: Error message containing URL `https://api.example.com/v4013/endpoint` does NOT classify as `auth`
  - Happy path: Error message "rate limit exceeded" classifies as `rate_limit`

  **Verification:**
  - Numeric status codes in URLs no longer trigger false classification.

- [x] **Unit 11: Add ensureDir boolean guard to LocalQueueBackend**

  **Goal:** Avoid redundant `adapter.exists()` calls on every queue operation.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6517-6520, `LocalQueueBackend.ensureDir`)

  **Approach:**
  - Add a `dirEnsured` boolean flag (same pattern as `RuntimeLogger` at line 6171-6177).
  - Set it to `true` after the first successful `mkdir` or `exists` check.
  - Skip the check on subsequent calls.

  **Test scenarios:**
  - Happy path: First queue operation creates directory; subsequent operations skip the check
  - Edge case: Plugin restart resets the flag — directory is re-checked on first operation

  **Verification:**
  - `adapter.exists()` is called at most once per plugin session for the queue directory.

- [x] **Unit 12: Optimize RuntimeLogger append fallback**

  **Goal:** Prevent the read-entire-file-then-rewrite fallback from blocking the transcription pipeline.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6104-6128, `RuntimeLogger.log`)

  **Approach:**
  - Cache the `hasAppend` capability check: test `typeof adapter.append === "function"` once on first log call, store the result in a static boolean.
  - For the fallback path (no `append`): instead of reading the entire file, maintain a small in-memory buffer of recent log lines. Flush the buffer to disk periodically (e.g., every 10 lines or 5 seconds) by appending to the file content.
  - Simpler alternative: just use `adapter.write` with the new line appended, accepting that the file might not have previous content if `adapter.read` fails — this avoids the full read.

  **Test scenarios:**
  - Happy path: Adapter with `append` — logs without reading the file
  - Happy path: Adapter without `append` — logs without reading the entire file on every call

  **Verification:**
  - Log writes on mobile (no `append`) are faster and don't block the transcription pipeline.

- [x] **Unit 13: Reduce multipart form buffer copies in prepareTranscriptionRequest**

  **Goal:** Reduce peak memory from ~75MB to ~25MB for a 25MB audio file.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 4888-4916, `prepareTranscriptionRequest`)

  **Approach:**
  - Instead of building an array of `Uint8Array` parts and then copying them all into a final `Uint8Array`, calculate the total size first, allocate the final buffer once, and write directly into it at the correct offsets.
  - This eliminates the intermediate `parts` array entirely.

  **Test scenarios:**
  - Happy path: Transcription request with a normal audio file succeeds
  - Edge case: Large audio file (close to 25MB) — no out-of-memory error

  **Verification:**
  - Same multipart body is produced (verify by comparing Content-Length or first/last bytes).

- [x] **Unit 14: Fix extractSpeakerLabels to include Speaker 0**

  **Goal:** Support 0-indexed speaker IDs from non-Deepgram providers.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 5288)

  **Approach:**
  - Change `if (Number.isFinite(id) && id > 0)` to `if (Number.isFinite(id) && id >= 0)`.

  **Test scenarios:**
  - Happy path: Transcript with "Speaker 0:" and "Speaker 1:" — both are extracted
  - Happy path: Transcript with "Speaker 1:" and "Speaker 2:" — both extracted (no regression)

  **Verification:**
  - Speaker 0 labels appear in the speaker mapping when present in transcripts.

### Phase 3: CSS & Cleanup Fixes

- [x] **Unit 15: Convert hardcoded CSS colors to theme variables**

  **Goal:** Make dock pill and upload sheet respect Obsidian's light/dark/custom themes.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Modify: `styles.css` (~lines 304-600, dock pill and upload sheet sections)

  **Approach:**
  - Replace hardcoded hex values with Obsidian CSS variables:
    - `#3A3A3C` (dark gray backgrounds) -> `var(--background-secondary-alt)`
    - `#8E8E93` (muted text) -> `var(--text-faint)`
    - `#636366` (medium gray) -> `var(--text-muted)`
    - `#E93147` (red accent) -> `var(--color-red)`
    - `#F0A030` (amber/warning) -> `var(--color-orange)`
    - `#FFFFFF` (white text) -> `var(--text-on-accent)`
    - `#1C1C1E` (sheet background) -> `var(--background-primary)`
    - `#2C2C2E` (card background) -> `var(--background-secondary)`
  - Keep the inline recorder panel as-is (it already uses variables correctly).

  **Test scenarios:**
  - Happy path: Dock pill renders correctly in default dark theme
  - Happy path: Dock pill renders correctly in a light theme
  - Edge case: Custom theme with unusual accent color — pill still looks reasonable

  **Verification:**
  - Switch between dark, light, and a custom theme — dock pill and upload sheet adapt correctly.

- [x] **Unit 16: Remove unreachable BatchRoutingPolicy code**

  **Goal:** Remove dead code that confuses maintainers.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~lines 6621-6639)

  **Approach:**
  - The `if (isLargeUpload && prefersBackend)` block at line 6621 is unreachable because `isLargeUpload` requires `sourceType === "uploaded"`, which already returned on line 6611-6619.
  - Remove the unreachable `if` block and its `else` return, leaving only the final default return at line 6641.

  **Test scenarios:**
  - Happy path: Uploaded files still route to `backend_batch`
  - Happy path: Recorded files still route to `direct_batch`

  **Verification:**
  - `BatchRoutingPolicy.decide` produces the same routing results for all input combinations.

- [x] **Unit 17: Fix poll timeout operator and generate random multipart boundary**

  **Goal:** Two small correctness fixes.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `main.js` (~line 6853 for timeout, ~line 4889 for boundary)

  **Approach:**
  - **Poll timeout:** Change `while (Date.now() - startedAt <= timeoutMs)` to `< timeoutMs` at line 6853.
  - **Multipart boundary:** Change `const boundary = "boundary"` to `const boundary = "----NVBoundary" + Math.random().toString(36).slice(2) + Date.now().toString(36)` at line 4889. Update the Content-Type header reference accordingly.

  **Test scenarios:**
  - Poll timeout: Job that takes exactly `backendJobTimeoutSec` — should timeout, not get one extra poll
  - Multipart: Transcription request still succeeds with random boundary

  **Verification:**
  - Both changes are single-line edits with clear before/after behavior.

- [x] **Unit 18: Fix versions.json gaps and ONBOARDING.md stale repo name**

  **Goal:** Clean up metadata inconsistencies.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `versions.json`
  - Modify: `ONBOARDING.md` (~line 54)

  **Approach:**
  - Add missing version entries to `versions.json` for 1.0.8 through 1.0.14 (all mapping to `"0.15.0"` matching existing entries).
  - In `ONBOARDING.md`, replace `kinshasa/` with `london/` in the file layout block (line 54) to match the current repo name.

  **Test scenarios:**
  - Test expectation: none -- metadata-only changes with no behavioral impact.

  **Verification:**
  - `versions.json` has contiguous entries from 1.0.4 through 1.0.15. ONBOARDING.md references the correct repo name.

### Phase 4: Add Backend Poll Backoff

- [x] **Unit 19: Add exponential backoff to backend poll loop**

  **Goal:** Reduce unnecessary poll requests and log writes for long-running jobs.

  **Requirements:** R3

  **Dependencies:** Unit 4 (poll loop error handling)

  **Files:**
  - Modify: `main.js` (~line 6909, inside `pollForResult`)

  **Approach:**
  - Replace the fixed `await this.sleep(pollMs)` with an incrementing delay: start at `pollMs`, increase by 1.5x each iteration, cap at `pollMs * 4`.
  - Reset the delay on status change (when `uiState` differs from `lastUiState`), since status changes indicate the backend is making progress.

  **Test scenarios:**
  - Happy path: Short job (< 30s) — polls at base interval, completes quickly
  - Happy path: Long job (10 min) — poll interval ramps up, reducing total requests
  - Edge case: Status change mid-poll — interval resets to base

  **Verification:**
  - A 10-minute job produces ~80 poll requests instead of ~200.

## System-Wide Impact

- **Interaction graph:** The timeout change (Unit 2) affects all API calls through `AIAdapter.makeAPIRequest`. The SSRF fix (Unit 3) affects only `BackendBatchOrchestrationService`. CSS changes (Unit 15) affect all mobile UI components that use the dock pill and upload sheet.
- **Error propagation:** Units 4 and 5 change how errors propagate through the job queue pipeline. Currently errors are swallowed; after fixes they will be logged and (in Unit 4) tolerated transiently.
- **State lifecycle risks:** Unit 1 (ProcessingState fix) and Unit 9 (singleton reset) directly address state lifecycle bugs. The fixes are conservative — swapping call order and nulling a static field.
- **Unchanged invariants:** The plugin's public API (commands, settings schema, file formats) is not changed. Settings saved by users will continue to load correctly.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Bundle edits overwritten by future source build | Document each fix clearly; this plan serves as the port guide |
| Regex changes in ErrorClassifier could miss real errors | Use word-boundary matching, not strict exact-match; test with known error messages |
| CSS variable substitution may look wrong in some themes | Test with at least 3 themes (default dark, default light, one custom) |
| Timeout changes could cause premature failures on slow connections | 30s default is generous; `BackendBatchOrchestrationService` uses its own longer timeout |
| Changing deprecated settings UI could confuse users who relied on them | Settings values are preserved in data; only the UI toggles are removed |

## Advisory Findings (Not Fixable Here)

These findings were identified in the review but cannot be addressed in this distribution repo:

1. **Timeout Promise.race doesn't abort underlying request** (P2) — Obsidian's `requestUrl` API doesn't support `AbortController`. The soft timeout is the best available option.
2. **Deepgram API key in WebSocket subprotocol** (P2) — Required by Deepgram's browser authentication protocol. No alternative.
3. **API keys stored in plaintext data.json** (P2) — Obsidian's `saveData` API provides no encryption. Mitigated by `.gitignore` excluding `data.json`.
4. **Path traversal via note-embedded Source path** (P2) — Obsidian's vault adapter should enforce root confinement. Needs verification on all platforms but can't be fixed without Obsidian API changes.
5. **No test suite** (P2) — This is a distribution-only repo. Tests belong in the source repository.
6. **backdrop-filter: blur(10px) on mobile** (P3) — Minor GPU cost; removing it degrades the visual design.

## Sources & References

- **Review artifact:** `.context/compound-engineering/ce-review/20260415-234402-613be828/`
- Related code: `main.js` (esbuild bundle), `styles.css`
- Related docs: `ONBOARDING.md` (project structure)
