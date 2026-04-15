# NeuroVox Onboarding Guide

## What Is This?

NeuroVox is an [Obsidian](https://obsidian.md) plugin that adds voice transcription and AI post-processing to your notes. You record audio (or drop in an existing audio/video file), and the plugin transcribes it using one of three AI providers — OpenAI, Groq, or Deepgram — then optionally runs post-processing (summarization, formatting) and inserts the result into your vault.

This repository (`kinshasa`) is the **BRAT distribution package** — it contains only the compiled, bundled plugin artifacts needed for installation via [Obsidian BRAT](https://github.com/TfTHacker/obsidian42-brat). The source code lives in a separate repository.

---

## User Experience

Once installed, NeuroVox surfaces three ways to start a transcription:

1. **Floating button** — a draggable mic button overlaid on your editor (togglable in settings).
2. **Inline recorder panel** — a compact panel anchored near the cursor with record/pause/stop controls, live timer, and post-processing options.
3. **Command palette** — commands like `Start recording`, `Transcribe audio file`, `Transcribe video file`, and `Transcribe latest iPhone inbox recording`.

A typical workflow: open a note, tap the floating mic button or run the command, speak, stop recording. NeuroVox transcribes the audio, optionally applies speaker diarization (via Deepgram), runs post-processing, and appends the transcript to your note with timestamp metadata.

The plugin also supports a **job queue** with recovery — if transcription fails or the app closes mid-process, you can review and retry jobs via the `Review recovery jobs` command.

---

## How Is It Organized?

### Architecture

```
User (Obsidian app)
        |
        |  Plugin API
        v
+------------------+
| NeuroVoxPlugin   |
| (main.js entry)  |
+--------+---------+
         |
    +----+----+----------+
    |         |          |
    v         v          v
 Recording  AI        Settings
 Processor  Adapters  Tab / UI
    |         |
    v         v
 Local     External APIs
 Queue     (OpenAI, Groq,
 Backend    Deepgram,
            Cloud Run backend)
```

### File layout

```
kinshasa/
  main.js         # Bundled plugin (esbuild output)
  styles.css      # All plugin CSS
  manifest.json   # Obsidian plugin manifest
  versions.json   # Min Obsidian version per release
  README.md       # BRAT install instructions
  LICENSE.md      # License
```

This is a distribution-only repo — there are no source directories, build scripts, or tests. The single `main.js` file (~550KB) is an esbuild bundle containing the full plugin plus vendored dependencies (RecordRTC, etc.).

### Key classes inside `main.js`

| Class | Responsibility |
|-------|---------------|
| `_NeuroVoxPlugin` | Plugin entry point — loads settings, registers commands, initializes UI and adapters |
| `RecordingProcessor` | Singleton that manages the recording-to-transcription pipeline |
| `LocalQueueBackend` | Persistent job queue for transcription/processing tasks |
| `OpenAIAdapter` | Transcription via OpenAI Whisper API |
| `GroqAdapter` | Transcription via Groq API |
| `_DeepgramAdapter` | Transcription via Deepgram (supports live streaming and diarization) |
| `NeuroVoxSettingTab` | Settings UI with accordion sections for model hookup, recording, and post-processing |
| `_TimerModal` | Recording timer modal |
| `DropReviewModal` | Drag-and-drop audio file review |
| `RecoveryJobsModal` | UI for reviewing and retrying failed jobs |

### External dependencies

| Dependency | Purpose | Configured via |
|-----------|---------|---------------|
| OpenAI API | Whisper transcription | `openaiApiKey` in plugin settings |
| Groq API | Transcription | `groqApiKey` in plugin settings |
| Deepgram API | Live transcription + diarization | `deepgramApiKey` in plugin settings |
| Cloud Run backend | Optional backend processing | `backendBaseUrl`, `backendApiKey` in settings |

No secrets are stored in this repo. All API keys are entered per-device in the plugin settings panel.

---

## Key Concepts and Abstractions

| Concept | What it means in this codebase |
|---------|-------------------------------|
| AI Adapter | A provider-specific class (`OpenAIAdapter`, `GroqAdapter`, `DeepgramAdapter`) that implements a common transcription interface |
| Recording Processor | Singleton that orchestrates the full pipeline: record → queue → transcribe → post-process → insert |
| Local Queue Backend | Persistent queue stored in Obsidian's data directory; tracks job status (`queued`, `claimed`, `running`, `retry_scheduled`, `failed`, `completed`, `canceled`) |
| Post-processing | Optional AI pass after transcription — reformatting, summarizing, or enhancing the raw transcript |
| Diarization | Speaker identification in transcripts (Deepgram-specific); configurable via `deepgramLiveDiarizationProfile` |
| Speaker mapping | Named speaker labels applied to diarized transcripts; can be auto-generated or manually defined per note |
| Floating button | A draggable mic icon overlaid on the editor; visibility controlled by `showFloatingButton` setting |
| Inline recorder panel | A compact recording UI panel with status, timer, and action buttons |
| iPhone inbox | A vault folder watched for audio files from iOS; the `Transcribe latest iPhone inbox recording` command picks the newest file |
| Recovery jobs | Jobs that failed or were interrupted; reviewable and retryable via a modal |
| Settings migration | On load, settings are migrated to the current schema version with backup and normalization |

---

## Primary Flows

### Recording and transcription flow

```
User taps floating mic / runs command
  |
  v
_NeuroVoxPlugin.handleRecordingStart()
  opens TimerModal or inline recorder
  |
  v
Browser MediaRecorder captures audio
  (via RecordRTC)
  |
  v
User stops recording
  |
  v
RecordingProcessor enqueues job
  → LocalQueueBackend persists to disk
  |
  v
RecordingProcessor claims + runs job
  → selects AI Adapter by provider setting
  |
  v
AI Adapter sends audio to external API
  (OpenAI / Groq / Deepgram)
  |
  v
Transcript returned
  |
  +--[post-processing enabled?]--+
  |                              |
  v (no)                         v (yes)
Insert raw transcript      Send to backend or
into active note           AI for formatting
  |                              |
  v                              v
Done                       Insert processed
                           transcript into note
```

### Existing file transcription

1. User opens an audio or video file in Obsidian and runs `Transcribe audio file` or `Transcribe video file`.
2. The plugin validates the file extension (`mp3`, `wav`, `webm`, `m4a` for audio; video has its own set).
3. The file is sent through the same `RecordingProcessor` pipeline — queued, transcribed via the configured AI adapter, optionally post-processed, and the result is written to a note.

---

## Developer Guide

### Setup (BRAT installation)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian.
2. Add this repository URL in BRAT and install NeuroVox.
3. Open NeuroVox settings and configure:
   - `backendBaseUrl` — your Cloud Run backend URL
   - `backendApiKey` — backend bearer token
   - `deepgramApiKey` — for live transcription
4. If post-processing is enabled, configure its provider key; otherwise disable post-processing.

### Working with this repo

This is a **distribution-only** repo. You do not build, test, or develop here. The workflow is:

1. Build the plugin in the source repository (produces `main.js`, `styles.css`, `manifest.json`).
2. Copy the build artifacts into this repo.
3. Update `versions.json` if the minimum Obsidian version changes.
4. Commit and push — BRAT picks up the new release.

### Common changes

- **Bump version**: Update `version` in `manifest.json` and add the version → minAppVersion mapping in `versions.json`.
- **Update plugin build**: Replace `main.js` and/or `styles.css` with new build artifacts from the source repo.
- **Change minimum Obsidian version**: Update `minAppVersion` in `manifest.json` and the corresponding entry in `versions.json`.
