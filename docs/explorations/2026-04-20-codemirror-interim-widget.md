---
title: "Inline CodeMirror interim transcript widget — exploration"
created: 2026-04-20
status: exploration
type: design-note
related_plan: docs/plans/2026-04-20-001-refactor-ribbon-mobile-recorder-plan.md
build_status: not-in-1.1.0
---

# Inline CodeMirror interim transcript widget

**This is an exploration. Do not build from this document.** It exists so the next iteration of the mobile recorder has somewhere to start, and so the deferral decision is recoverable later instead of getting lost in chat history.

## Why this exists

The 1.1.0 ribbon recorder ships with the rolling interim transcript surfaced in the persistent `Notice` (last ~50 chars, updated at 1Hz). That works because the Notice is a separate OS-managed surface that does not compete with the editor — but it also means the transcript preview is physically far from where the cursor is, and on a phone the user often cannot see the Notice and the cursor at the same time without scrolling.

A natural next step is to surface the live interim transcript **inline at the cursor**, as ambient typing-ahead. CodeMirror 6's `WidgetType` is the right primitive: a decoration whose contents we control, that lives in the editor flow, that does not enter the document text or the undo stack.

## Research summary (plan §Resolved design questions Q4 / §Risks)

The 1.1.0 plan considered the inline approach, picked the Notice path, and explicitly deferred this for later validation. The reasoning recorded there:

- **Strength:** transcript preview lives where the user is looking. No glance-shifting between Notice and cursor. Matches the mental model of "voice-to-text dictation" closer than the Notice does.
- **Risk:** untested UX surface. Inline previews on a small mobile editor can compete with the user's own typing, can flicker at high update cadence, and can break selection or scroll-into-view when the widget grows or shrinks.
- **Decision:** ship the Notice in 1.1.0, gather bake data, then explore inline as a follow-up if the Notice surface proves insufficient (e.g., bug reports about "I can't see what I'm saying without scrolling").

## Three UX questions to validate before building

These are the questions a prototype must answer. None are answerable from reading docs — they need a built artifact in front of real users.

### Q1. Does inline interim text compete with the user's own typing?

A `WidgetType` at the cursor is visually adjacent to wherever the user might also be typing (e.g., a quick correction while still talking). Two streams of text appearing in the same physical region creates ambiguity: which text is "real," which will commit to the document, which is the AI guessing? The Notice avoids this entirely because it lives outside the editor.

**Validation:** record + type at the same time and observe whether testers (a) hesitate before typing, (b) misread their own typing as transcript, or (c) ignore the inline preview because it adds cognitive load. If hesitation or misread shows up at >1 in 5 sessions, the inline approach is worse than the Notice for users who interleave voice and keyboard.

### Q2. Does 10Hz update cadence feel twitchy?

`StreamingTranscriptionService` exposes `getPartialResult()` which the ribbon controller currently polls at 1Hz to update the Notice. For inline preview, 1Hz feels stuttery in the user's peripheral vision because the text is right next to the gaze point. Bumping to ~10Hz (Deepgram live's natural cadence) is technically straightforward — wire `onInterimUpdate(text)` callback into the streaming service — but inline rapid text changes could trigger:

- visual flicker as the widget rebuilds
- layout reflow if the interim grows/shrinks line wrapping
- attention-snapping that breaks reading flow on the rest of the note

**Validation:** prototype both 1Hz and 10Hz, A/B with users, instrument self-reported "feels jittery" rating. Also measure whether testers stop reading the rest of the note while recording (eye-tracking would be ideal but not available; proxy is "did you notice X in the note above?").

### Q3. Does the widget break editor selection, scroll, or undo?

CodeMirror widgets that mutate frequently can interact badly with:

- **Selection:** if the user selects text near the cursor and the widget reflows, does the selection survive? Does it visually "jump"?
- **Scroll:** if the widget grows large enough to push content off-screen, does CM6 auto-scroll to keep the cursor visible? Is that behavior we want during live transcription, or does it pull the user's reading position involuntarily?
- **Undo:** widgets must not enter the undo history. We need to confirm that the `Decoration.widget()` API stays clean here, especially when the widget is replaced (rather than just updated) every tick.
- **IME / mobile keyboard:** does the widget interact correctly with iOS / Android composition state? This is the failure mode that already burned the floating mic — we don't want to recreate it in a different form.

**Validation:** scripted test plan in a Test Vault that exercises each scenario manually before any user testing.

## Minimal prototype scope (for a future iteration, not 1.1.0)

If the project decides to build this, the smallest useful prototype is:

1. Add `onInterimUpdate(text: string)` callback to `StreamingTranscriptionService` (firing at adapter cadence — Deepgram live's ~10Hz). No throttling at the service layer; let consumers throttle.
2. New module `src/ui/InlineInterimWidget.ts` — exposes a CM6 `ViewPlugin` that:
   - subscribes to a controller-provided `getInterimText()` accessor
   - renders a single `Decoration.widget()` immediately after the captured cursor position at recording start
   - replaces the widget contents on each interim update
   - removes the widget when recording stops (or on session error)
3. `RibbonRecorderController` mounts the `ViewPlugin` on the active `MarkdownView`'s editor when recording starts; unmounts on stop.
4. Setting flag (`recorderInterimSurface: 'notice' | 'inline' | 'both'`, default `'notice'`) so the prototype is opt-in via settings during the bake period. Power users can A/B test for us.
5. Style: muted color (`var(--text-faint)`), italic, no border or background — purely typographic so it reads as ambient, not as document content.

**Out of scope for the prototype:**

- streaming chunk commits inline (those still flow through `DocumentInserter` at chunk boundaries)
- inline display when no `MarkdownView` is active (fall back to Notice)
- persisting the widget across editor leaf changes (kill the widget on leaf change, restart on return — tracking it across leaves is a feature creep magnet)

## When to revisit

Trigger conditions to reopen this exploration:

- ≥3 user reports during 1.1.0 bake of "I can't see the transcript while recording" or "the Notice is too far from where I'm looking"
- A redesign of the mobile streaming pipeline that changes the natural update cadence (e.g., switching to a non-Deepgram adapter that emits at 1Hz natively, which would change Q2's premise)
- Plan to ship desktop ribbon mode — desktop users have larger screens and the Notice→cursor glance distance is not the same problem, so inline may matter less there

If none of those fire within ~2 release cycles, this exploration is probably dead and should be archived.
