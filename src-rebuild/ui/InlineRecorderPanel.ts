import { Notice } from 'obsidian';
import { AudioRecordingManager } from '../utils/RecordingManager';
import { DeviceDetection } from '../utils/DeviceDetection';
import { DocumentInserter } from '../utils/document/DocumentInserter';
import { RecordingUI } from './RecordingUI';
import { StreamingTranscriptionService } from '../utils/transcription/StreamingTranscriptionService';
import { canEditSaveAudio, canPauseToggle, canStartRecording, canStopRecording, canUploadAudio } from '../utils/recorder/RecorderStateMachine';

export class InlineRecorderPanel {
  static RECORDER_STOP_TIMEOUT_MS = 12e3;

  constructor(options) {
    this.panelEl = null;
    this.statusRowEl = null;
    this.statusEl = null;
    this.timerEl = null;
    this.uiContainerEl = null;
    this.readyContainerEl = null;
    this.activeContainerEl = null;
    this.finalizingContainerEl = null;
    this.ui = null;
    this.streamingService = null;
    this.state = "ready";
    this.timerSeconds = 0;
    this.timerId = null;
    this.livePreviewMarkerId = null;
    this.livePreviewWriteChain = Promise.resolve();
    this.isCollapsed = false;
    this.isDisposed = false;
    this.liveAudioCaptureActive = false;
    this.saveAudioForSession = false;
    this.saveAudioToggleEl = null;
    this.startButtonEl = null;
    this.uploadButtonEl = null;
    this.cancelJobsButtonEl = null;
    var _a;
    this.plugin = options.plugin;
    this.containerEl = options.containerEl;
    this.activeFile = options.activeFile;
    this.cursorPosition = options.cursorPosition;
    this.onDispose = options.onDispose;
    this.onStateChange = options.onStateChange;
    this.isMobileSheet = Boolean(options.isMobileSheet);
    this.deviceDetection = DeviceDetection.getInstance();
    this.recordingManager = new AudioRecordingManager(this.plugin);
    this.documentInserter = new DocumentInserter(this.plugin);
    this.saveAudioForSession = this.plugin.settings.saveLiveRecordingAudio;
    this.useStreaming = (_a = this.plugin.settings.streamingMode) != null ? _a : this.deviceDetection.shouldUseStreamingMode();
    this.createPanel(options.anchor);
  }
  async start() {
    var _a;
    try {
      await this.recordingManager.initialize();
      this.timerSeconds = 0;
      (_a = this.ui) == null ? void 0 : _a.updateTimer(this.timerSeconds, Number.POSITIVE_INFINITY, 60);
      this.setState("ready");
    } catch (error) {
      this.handleFailure("Failed to initialize recorder", error);
    }
  }
  toggleCollapsed() {
    if (this.isDisposed || !this.panelEl)
      return;
    this.isCollapsed = !this.isCollapsed;
    this.panelEl.toggleClass("is-collapsed", this.isCollapsed);
  }
  updateAnchor(anchor) {
    if (this.isDisposed || !this.panelEl)
      return;
    this.positionPanel(this.panelEl, anchor);
  }
  async startRecordingSession() {
    var _a;
    if (this.isDisposed || !canStartRecording(this.state))
      return;
    try {
      if (this.useStreaming && !this.streamingService) {
        this.streamingService = new StreamingTranscriptionService(this.plugin, {
          onMemoryWarning: (usage) => {
            new Notice(`Memory usage high: ${Math.round(usage)}%`);
          },
          onChunkCommitted: async (_chunkText, _metadata, partialResult) => {
            if (!this.plugin.settings.showLiveChunkPreviewInNote)
              return;
            await this.enqueueLivePreviewUpdate(partialResult);
          }
        });
        this.livePreviewMarkerId = this.streamingService.getRecoveryJobId();
      }
      if (this.useStreaming && this.streamingService) {
        const stream = this.recordingManager.getStream();
        if (!stream) {
          throw new Error("Microphone stream unavailable");
        }
        await this.streamingService.startLiveSession(stream);
        if (this.saveAudioForSession && !this.liveAudioCaptureActive) {
          this.recordingManager.start();
          this.liveAudioCaptureActive = true;
        }
      } else {
        this.recordingManager.start();
      }
      this.timerSeconds = 0;
      (_a = this.ui) == null ? void 0 : _a.updateTimer(this.timerSeconds, Number.POSITIVE_INFINITY, 60);
      this.startTimer();
      this.setState("recording");
      new Notice("Recording started");
    } catch (error) {
      this.handleFailure("Failed to start recording", error);
    }
  }
  async handlePauseToggle() {
    if (this.state === "finalizing" || this.isDisposed || !canPauseToggle(this.state))
      return;
    try {
      if (this.state === "paused") {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.resumeLive();
          if (this.liveAudioCaptureActive) {
            this.recordingManager.resume();
          }
        } else {
          this.recordingManager.resume();
        }
        this.startTimer();
        this.setState("recording");
      } else {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.pauseLive();
          if (this.liveAudioCaptureActive) {
            this.recordingManager.pause();
          }
        } else {
          this.recordingManager.pause();
        }
        this.stopTimer();
        this.setState("paused");
      }
    } catch (error) {
      this.handleFailure("Failed to pause/resume recording", error);
    }
  }
  async stop() {
    if (this.state === "finalizing" || this.isDisposed || !canStopRecording(this.state))
      return;
    this.setState("finalizing");
    const markerIdForCleanup = this.livePreviewMarkerId;
    try {
      let finalBlob = null;
      if (this.useStreaming) {
        if (this.liveAudioCaptureActive) {
          finalBlob = await this.stopRecorderWithTimeout();
          this.liveAudioCaptureActive = false;
        }
      } else {
        finalBlob = await this.stopRecorderWithTimeout();
      }
      if (this.useStreaming && this.streamingService) {
        const result = await this.streamingService.finishProcessing();
        this.streamingService = null;
        if (!result.trim()) {
          throw new Error("No transcription result received");
        }
        await this.plugin.recordingProcessor.processStreamingResult(
          result,
          this.activeFile,
          this.cursorPosition,
          {
            audioBlob: this.saveAudioForSession ? finalBlob || void 0 : void 0,
            durationSeconds: this.timerSeconds
          }
        );
      } else {
        if (!finalBlob) {
          throw new Error("No audio data received from recorder");
        }
        await this.plugin.recordingProcessor.processRecording(
          finalBlob,
          this.activeFile,
          this.cursorPosition
        );
      }
      this.dispose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.streamingService) {
        this.streamingService.abort(`finalize_failed:${message}`);
        this.streamingService = null;
      }
      this.handleFailure("Failed to stop recording", error);
    } finally {
      await this.clearLivePreviewBlock(markerIdForCleanup);
    }
  }
  async stopRecorderWithTimeout() {
    return await Promise.race([
      this.recordingManager.stop(),
      new Promise(
        (_, reject) => window.setTimeout(
          () => reject(new Error("Recorder stop timed out")),
          InlineRecorderPanel.RECORDER_STOP_TIMEOUT_MS
        )
      )
    ]);
  }
  dispose() {
    var _a;
    if (this.isDisposed)
      return;
    this.isDisposed = true;
    this.stopTimer();
    if (this.ui) {
      this.ui.cleanup();
      this.ui = null;
    }
    if (this.streamingService) {
      this.streamingService.abort();
      this.streamingService = null;
    }
    this.recordingManager.cleanup();
    this.liveAudioCaptureActive = false;
    (_a = this.panelEl) == null ? void 0 : _a.remove();
    this.panelEl = null;
    this.onDispose();
  }
  createPanel(anchor) {
    this.panelEl = document.createElement("div");
    this.panelEl.addClass("neurovox-inline-recorder-panel");
    if (this.isMobileSheet) {
      this.panelEl.addClass("is-mobile-sheet");
    }
    this.positionPanel(this.panelEl, anchor);
    this.uiContainerEl = this.panelEl.createDiv({ cls: "neurovox-inline-recorder-body" });
    this.statusRowEl = this.uiContainerEl.createDiv({ cls: "neurovox-inline-recorder-status-row" });
    this.statusEl = this.statusRowEl.createEl("span", {
      cls: "neurovox-inline-recorder-status",
      text: "Ready"
    });
    this.timerEl = this.statusRowEl.createEl("span", {
      cls: "neurovox-inline-recorder-timer",
      text: "00:00"
    });
    this.readyContainerEl = this.uiContainerEl.createDiv({
      cls: "neurovox-inline-recorder-section neurovox-inline-recorder-section-ready"
    });
    this.createOptionsRow(this.readyContainerEl);
    this.activeContainerEl = this.uiContainerEl.createDiv({
      cls: "neurovox-inline-recorder-section neurovox-inline-recorder-section-active"
    });
    this.ui = new RecordingUI(this.activeContainerEl, {
      onPause: () => {
        void this.handlePauseToggle();
      },
      onStop: () => {
        void this.stop();
      }
    });
    this.ui.updateState("recording");
    this.finalizingContainerEl = this.uiContainerEl.createDiv({
      cls: "neurovox-inline-recorder-section neurovox-inline-recorder-section-finalizing"
    });
    this.finalizingContainerEl.createDiv({
      cls: "neurovox-inline-recorder-finalizing",
      text: "Finalizing transcription..."
    });
    this.containerEl.appendChild(this.panelEl);
    this.syncControlAvailability();
  }
  createOptionsRow(container) {
    const primaryRow = container.createDiv({
      cls: "neurovox-inline-recorder-options neurovox-inline-recorder-options-primary"
    });
    this.startButtonEl = primaryRow.createEl("button", {
      cls: "neurovox-inline-recorder-action neurovox-inline-recorder-action-primary",
      text: "Start recording"
    });
    this.startButtonEl.addEventListener("click", () => {
      void this.startRecordingSession();
    });
    const secondaryRow = container.createDiv({
      cls: "neurovox-inline-recorder-options neurovox-inline-recorder-options-secondary"
    });
    this.uploadButtonEl = secondaryRow.createEl("button", {
      cls: "neurovox-inline-recorder-action",
      text: "Upload audio"
    });
    this.uploadButtonEl.addEventListener("click", () => {
      void this.handleUploadAudio();
    });
    const label = secondaryRow.createEl("label", { cls: "neurovox-inline-recorder-option" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    checkbox.checked = this.saveAudioForSession;
    this.saveAudioToggleEl = checkbox;
    label.createSpan({ text: "Save audio" });
    checkbox.addEventListener("change", () => {
      if (!canEditSaveAudio(this.state)) {
        checkbox.checked = this.saveAudioForSession;
        new Notice("Save audio can only be changed before recording starts.");
        return;
      }
      this.saveAudioForSession = checkbox.checked;
      this.plugin.settings.saveLiveRecordingAudio = checkbox.checked;
      void this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false }).catch(() => {
      });
    });
    const utilityRow = container.createDiv({
      cls: "neurovox-inline-recorder-options neurovox-inline-recorder-options-utility"
    });
    this.cancelJobsButtonEl = utilityRow.createEl("button", {
      cls: "neurovox-inline-recorder-action neurovox-inline-recorder-action-ghost",
      text: "Cancel jobs"
    });
    this.cancelJobsButtonEl.addEventListener("click", () => {
      void this.cancelIncompleteJobs();
    });
  }
  async handleUploadAudio() {
    if (!canUploadAudio(this.state)) {
      new Notice("Upload audio is available before recording starts.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp3,.wav,.webm,.m4a,.ogg,.mp4,audio/*";
    input.onchange = async () => {
      var _a;
      const file = (_a = input.files) == null ? void 0 : _a[0];
      if (!file)
        return;
      try {
        this.setState("finalizing");
        const blob = new Blob([await file.arrayBuffer()], {
          type: file.type || "audio/wav"
        });
        await this.plugin.recordingProcessor.processRecording(
          blob,
          this.activeFile,
          this.cursorPosition,
          file.name
        );
        new Notice(`Transcribed uploaded audio: ${file.name}`);
        this.dispose();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to transcribe uploaded audio: ${message}`);
        this.setState("ready");
      }
    };
    input.click();
  }
  async cancelIncompleteJobs() {
    try {
      const pending = await this.plugin.recordingProcessor.getIncompleteJobs();
      if (pending.length === 0) {
        new Notice("No incomplete jobs to cancel.");
        return;
      }
      await Promise.all(pending.map((job) => this.plugin.recordingProcessor.cancelJob(job.jobId)));
      new Notice(`Canceled ${pending.length} incomplete job(s).`);
    } catch (e) {
      new Notice("Failed to cancel incomplete jobs.");
    }
  }
  positionPanel(panelEl, anchor) {
    const margin = 12;
    const parentRect = this.containerEl.getBoundingClientRect();
    const panelWidth = panelEl.offsetWidth || 300;
    const panelHeight = panelEl.offsetHeight || 220;
    if (this.isMobileSheet) {
      const width = Math.min(360, Math.max(280, parentRect.width - margin * 2));
      const safeInsetBottom = typeof window !== "undefined" && window.visualViewport ? Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop) : 0;
      const dockOffset = 92;
      const left2 = Math.max(margin, Math.round((parentRect.width - width) / 2));
      const top2 = Math.max(margin, Math.round(parentRect.height - panelHeight - dockOffset - safeInsetBottom));
      panelEl.style.width = `${width}px`;
      panelEl.style.left = `${left2}px`;
      panelEl.style.top = `${top2}px`;
      return;
    }
    let left = anchor.x - panelWidth - margin;
    let top = anchor.y - panelHeight + 48;
    if (left < margin)
      left = anchor.x + 60;
    if (left + panelWidth > parentRect.width - margin) {
      left = Math.max(margin, parentRect.width - panelWidth - margin);
    }
    if (top < margin)
      top = margin;
    if (top + panelHeight > parentRect.height - margin) {
      top = Math.max(margin, parentRect.height - panelHeight - margin);
    }
    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
  }
  setState(state) {
    var _a, _b;
    this.state = state;
    (_a = this.panelEl) == null ? void 0 : _a.setAttribute("data-state", state);
    if (this.statusEl) {
      this.statusEl.setText(
        state === "ready" ? "Ready" : state === "recording" ? "Recording" : state === "paused" ? "Paused" : "Finalizing..."
      );
    }
    if (this.ui) {
      this.ui.updateState(
        state === "paused" ? "paused" : state === "recording" ? "recording" : "recording"
      );
    }
    this.syncControlAvailability();
    (_b = this.onStateChange) == null ? void 0 : _b.call(this, state);
  }
  syncControlAvailability() {
    var _a, _b, _c;
    const isReady = this.state === "ready";
    const isActive = this.state === "recording" || this.state === "paused";
    const isFinalizing = this.state === "finalizing";
    (_a = this.readyContainerEl) == null ? void 0 : _a.toggleClass("is-hidden", !isReady);
    (_b = this.activeContainerEl) == null ? void 0 : _b.toggleClass("is-hidden", !isActive);
    (_c = this.finalizingContainerEl) == null ? void 0 : _c.toggleClass("is-hidden", !isFinalizing);
    if (this.timerEl) {
      this.timerEl.setText(this.formatTimer(this.timerSeconds));
    }
    if (this.saveAudioToggleEl) {
      this.saveAudioToggleEl.disabled = !canEditSaveAudio(this.state);
    }
    if (this.startButtonEl) {
      this.startButtonEl.disabled = !canStartRecording(this.state);
    }
    if (this.uploadButtonEl) {
      this.uploadButtonEl.disabled = !canUploadAudio(this.state);
    }
    if (this.cancelJobsButtonEl) {
      this.cancelJobsButtonEl.disabled = this.state === "finalizing";
    }
  }
  startTimer() {
    if (this.timerId !== null)
      return;
    this.timerId = window.setInterval(() => {
      var _a, _b;
      this.timerSeconds += 1;
      (_a = this.timerEl) == null ? void 0 : _a.setText(this.formatTimer(this.timerSeconds));
      (_b = this.ui) == null ? void 0 : _b.updateTimer(this.timerSeconds, Number.POSITIVE_INFINITY, 60);
    }, 1e3);
  }
  stopTimer() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
  async enqueueLivePreviewUpdate(partialResult) {
    const markerId = this.livePreviewMarkerId;
    if (!markerId)
      return;
    this.livePreviewWriteChain = this.livePreviewWriteChain.then(async () => {
      await this.documentInserter.upsertLiveTranscriptionBlock(
        this.activeFile,
        this.cursorPosition,
        markerId,
        partialResult
      );
    }).catch(() => {
    });
    await this.livePreviewWriteChain;
  }
  async clearLivePreviewBlock(markerIdOverride) {
    const markerId = markerIdOverride != null ? markerIdOverride : this.livePreviewMarkerId;
    if (!markerId)
      return;
    await this.livePreviewWriteChain.catch(() => {
    });
    try {
      await this.documentInserter.removeLiveTranscriptionBlock(this.activeFile, markerId);
    } catch (e) {
    }
  }
  handleFailure(message, error) {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`${message}: ${detail}`);
    this.dispose();
  }
  formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainingSeconds = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainingSeconds}`;
  }
}
