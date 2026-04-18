import { MarkdownView, Notice, setIcon } from 'obsidian';
import { AudioRecordingManager } from '../utils/RecordingManager';
import { DeviceDetection } from '../utils/DeviceDetection';
import { DocumentInserter } from '../utils/document/DocumentInserter';
import { StreamingTranscriptionService } from '../utils/transcription/StreamingTranscriptionService';

export class DesktopDockPill {
  constructor(plugin) {
    this.plugin = plugin;
    this.state = "idle";
    this.containerEl = null;
    this.pillEl = null;
    this.contentEl = null;
    this.idleIconEl = null;
    this.expandedEl = null;
    this.recordingEl = null;
    this.finalizingEl = null;
    this.timerEl = null;
    this.pauseBtnEl = null;
    this.saveBtnEl = null;
    this.timerSeconds = 0;
    this.timerId = null;
    this.isDisposed = false;
    this.recordingManager = null;
    this.streamingService = null;
    this.documentInserter = null;
    this.livePreviewMarkerId = null;
    this.livePreviewWriteChain = Promise.resolve();
    this.liveAudioCaptureActive = false;
    this.activeFile = null;
    this.cursorPosition = null;
    this.onStateChange = null;
    this.activeContainer = null;
    this.deviceDetection = DeviceDetection.getInstance();
    this.saveAudioOn = this.plugin.settings.saveLiveRecordingAudio || false;
    this.useStreaming = this.plugin.settings.streamingMode != null ? this.plugin.settings.streamingMode : this.deviceDetection.shouldUseStreamingMode();
    this.createElement();
  }
  static RECORDER_STOP_TIMEOUT_MS = 12e3;
  createElement() {
    this.containerEl = document.createElement("div");
    this.containerEl.classList.add("neurovox-button-container");
    this.pillEl = document.createElement("div");
    this.pillEl.classList.add("neurovox-dock-pill", "neurovox-dock-pill--desktop");
    this.pillEl.setAttribute("data-state", "idle");
    this.pillEl.setAttribute("aria-label", "Open transcription actions (drag to move)");
    this.contentEl = document.createElement("div");
    this.contentEl.classList.add("neurovox-dock-pill__content");
    this.idleIconEl = document.createElement("div");
    this.idleIconEl.classList.add("neurovox-dock-pill__idle-icon");
    (0, setIcon)(this.idleIconEl, "mic");
    this.contentEl.appendChild(this.idleIconEl);
    this.expandedEl = document.createElement("div");
    this.expandedEl.classList.add("neurovox-dock-pill__expanded");
    const uploadBtn = this.makeIconBtn("upload", "neurovox-dock-pill__icon neurovox-dock-pill__upload");
    this.bindIconTap(uploadBtn, () => this.handleUploadTap());
    this.expandedEl.appendChild(uploadBtn);
    this.saveBtnEl = this.makeIconBtn("save", "neurovox-dock-pill__icon neurovox-dock-pill__save");
    if (this.saveAudioOn) this.saveBtnEl.classList.add("active");
    this.bindIconTap(this.saveBtnEl, () => this.handleSaveTap());
    this.expandedEl.appendChild(this.saveBtnEl);
    const micBtn = this.makeIconBtn("mic", "neurovox-dock-pill__icon neurovox-dock-pill__mic");
    this.bindIconTap(micBtn, () => { void this.handleMicTap(); });
    this.expandedEl.appendChild(micBtn);
    const closeBtn1 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    this.bindIconTap(closeBtn1, () => this.handleCloseTap());
    this.expandedEl.appendChild(closeBtn1);
    const cancelJobsBtn = this.makeIconBtn("broom", "neurovox-dock-pill__icon neurovox-dock-pill__cancel-jobs");
    cancelJobsBtn.setAttribute("aria-label", "Cancel in-flight transcription jobs");
    this.bindIconTap(cancelJobsBtn, () => { void this.handleCancelJobsTap(); });
    this.expandedEl.appendChild(cancelJobsBtn);
    this.contentEl.appendChild(this.expandedEl);
    this.recordingEl = document.createElement("div");
    this.recordingEl.classList.add("neurovox-dock-pill__recording");
    const redDot = document.createElement("div");
    redDot.classList.add("neurovox-dock-pill__red-dot");
    this.recordingEl.appendChild(redDot);
    this.timerEl = document.createElement("span");
    this.timerEl.classList.add("neurovox-dock-pill__timer");
    this.timerEl.textContent = "0:00";
    this.recordingEl.appendChild(this.timerEl);
    this.pauseBtnEl = this.makeIconBtn("pause", "neurovox-dock-pill__pause-btn");
    this.bindIconTap(this.pauseBtnEl, () => this.handlePauseTap());
    this.recordingEl.appendChild(this.pauseBtnEl);
    const stopBtn = document.createElement("div");
    stopBtn.classList.add("neurovox-dock-pill__stop-btn");
    (0, setIcon)(stopBtn, "square");
    this.bindIconTap(stopBtn, () => { void this.handleStopTap(); });
    this.recordingEl.appendChild(stopBtn);
    const closeBtn2 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    this.bindIconTap(closeBtn2, () => this.handleCloseTap());
    this.recordingEl.appendChild(closeBtn2);
    this.contentEl.appendChild(this.recordingEl);
    this.finalizingEl = document.createElement("div");
    this.finalizingEl.classList.add("neurovox-dock-pill__finalizing");
    const loaderIcon = document.createElement("div");
    loaderIcon.classList.add("neurovox-dock-pill__loader-icon");
    (0, setIcon)(loaderIcon, "loader");
    this.finalizingEl.appendChild(loaderIcon);
    const statusText = document.createElement("span");
    statusText.classList.add("neurovox-dock-pill__status-text");
    statusText.textContent = "Transcribing";
    this.finalizingEl.appendChild(statusText);
    const closeBtn3 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    this.bindIconTap(closeBtn3, () => this.handleCloseTap());
    this.finalizingEl.appendChild(closeBtn3);
    this.contentEl.appendChild(this.finalizingEl);
    this.pillEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.pillEl);
  }
  makeIconBtn(iconName, cls) {
    const btn = document.createElement("div");
    btn.classList.add("clickable-icon");
    cls.split(" ").forEach((c) => btn.classList.add(c));
    (0, setIcon)(btn, iconName);
    return btn;
  }
  bindIconTap(el, handler) {
    el.addEventListener("mousedown", (e) => { e.stopPropagation(); });
    el.addEventListener("click", (e) => { e.stopPropagation(); handler(); });
  }
  setActiveContainer(container) {
    this.activeContainer = container;
  }
  getContainerEl() {
    return this.containerEl;
  }
  getButtonEl() {
    return this.pillEl;
  }
  getIdleIconEl() {
    return this.idleIconEl;
  }
  updateButtonColor(color) {
    if (this.pillEl && color) {
      this.pillEl.style.setProperty("--neurovox-button-color", color);
    }
  }
  handlePillTap() {
    if (this.state === "idle") {
      this.ensureActiveFile();
      this.setState("expanded");
    } else if (this.state === "expanded") {
      this.setState("idle");
    }
  }
  ensureActiveFile() {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      this.activeFile = activeView.file;
      try {
        this.cursorPosition = activeView.editor.getCursor();
      } catch (e) {
        this.cursorPosition = null;
      }
    }
  }
  handleUploadTap() {
    if (this.state !== "expanded") return;
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice("No active note found to insert transcription.");
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp3,.wav,.webm,.m4a,.ogg,.mp4,audio/*";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        this.setState("finalizing");
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/wav" });
        await this.plugin.recordingProcessor.processRecording(blob, this.activeFile, this.cursorPosition, file.name);
        new Notice(`Transcribed uploaded audio: ${file.name}`);
        this.setState("idle");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to transcribe uploaded audio: ${message}`);
        this.setState("idle");
      }
    };
    input.click();
  }
  handleSaveTap() {
    if (this.state !== "expanded") return;
    this.saveAudioOn = !this.saveAudioOn;
    this.plugin.settings.saveLiveRecordingAudio = this.saveAudioOn;
    void this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false }).catch(() => {});
    if (this.saveBtnEl) this.saveBtnEl.classList.toggle("active", this.saveAudioOn);
  }
  async handleMicTap() {
    if (this.state !== "expanded") return;
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) {
      new Notice("No active note found to insert transcription.");
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    await this.startRecordingSession();
  }
  async handleCancelJobsTap() {
    if (this.state !== "expanded") return;
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
  async startRecordingSession() {
    if (this.isDisposed) return;
    try {
      if (!this.recordingManager) {
        this.recordingManager = new AudioRecordingManager(this.plugin);
      }
      await this.recordingManager.initialize();
      if (!this.documentInserter) {
        this.documentInserter = new DocumentInserter(this.plugin);
      }
      if (this.useStreaming && !this.streamingService) {
        this.streamingService = new StreamingTranscriptionService(this.plugin, {
          onMemoryWarning: (usage) => {
            new Notice(`Memory usage high: ${Math.round(usage)}%`);
          },
          onChunkCommitted: async (_chunkText, _metadata, partialResult) => {
            if (!this.plugin.settings.showLiveChunkPreviewInNote) return;
            await this.enqueueLivePreviewUpdate(partialResult);
          }
        });
        this.livePreviewMarkerId = this.streamingService.getRecoveryJobId();
      }
      if (this.useStreaming && this.streamingService) {
        const stream = this.recordingManager.getStream();
        if (!stream) throw new Error("Microphone stream unavailable");
        await this.streamingService.startLiveSession(stream);
        if (this.saveAudioOn && !this.liveAudioCaptureActive) {
          this.recordingManager.start();
          this.liveAudioCaptureActive = true;
        }
      } else {
        this.recordingManager.start();
      }
      this.timerSeconds = 0;
      this.updateTimerDisplay();
      this.startTimer();
      this.setState("recording");
      new Notice("Recording started");
    } catch (error) {
      this.handleFailure("Failed to start recording", error);
    }
  }
  handlePauseTap() {
    if (this.state !== "recording" && this.state !== "paused") return;
    try {
      if (this.state === "paused") {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.resumeLive();
          if (this.liveAudioCaptureActive) this.recordingManager.resume();
        } else {
          this.recordingManager.resume();
        }
        this.startTimer();
        this.setState("recording");
        (0, setIcon)(this.pauseBtnEl, "pause");
      } else {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.pauseLive();
          if (this.liveAudioCaptureActive) this.recordingManager.pause();
        } else {
          this.recordingManager.pause();
        }
        this.stopTimer();
        this.setState("paused");
        (0, setIcon)(this.pauseBtnEl, "play");
      }
    } catch (error) {
      this.handleFailure("Failed to pause/resume", error);
    }
  }
  async handleStopTap() {
    if (this.state !== "recording" && this.state !== "paused") return;
    this.setState("finalizing");
    this.stopTimer();
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
        if (!result.trim()) throw new Error("No transcription result received");
        await this.plugin.recordingProcessor.processStreamingResult(
          result, this.activeFile, this.cursorPosition,
          { audioBlob: this.saveAudioOn ? finalBlob || void 0 : void 0, durationSeconds: this.timerSeconds }
        );
      } else {
        if (!finalBlob) throw new Error("No audio data received from recorder");
        await this.plugin.recordingProcessor.processRecording(finalBlob, this.activeFile, this.cursorPosition);
      }
      this.resetRecordingState();
      this.setState("idle");
    } catch (error) {
      if (this.streamingService) {
        const msg = error instanceof Error ? error.message : String(error);
        this.streamingService.abort(`finalize_failed:${msg}`);
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
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Recorder stop timed out")), DesktopDockPill.RECORDER_STOP_TIMEOUT_MS))
    ]);
  }
  handleCloseTap() {
    if (this.state === "expanded") {
      this.setState("idle");
    } else if (this.state === "recording" || this.state === "paused") {
      this.cancelRecording();
      this.setState("idle");
    } else if (this.state === "finalizing") {
      this.cancelTranscription();
      this.setState("idle");
    }
  }
  cancelRecording() {
    this.stopTimer();
    if (this.useStreaming && this.streamingService) {
      this.streamingService.abort("user_cancelled");
      this.streamingService = null;
    }
    if (this.liveAudioCaptureActive) {
      try { this.recordingManager.stop(); } catch (e) {}
      this.liveAudioCaptureActive = false;
    } else if (this.recordingManager) {
      try { this.recordingManager.stop(); } catch (e) {}
    }
    this.resetRecordingState();
    void this.clearLivePreviewBlock(this.livePreviewMarkerId);
  }
  cancelTranscription() {
    if (this.streamingService) {
      this.streamingService.abort("user_cancelled");
      this.streamingService = null;
    }
    this.resetRecordingState();
  }
  resetRecordingState() {
    this.timerSeconds = 0;
    this.livePreviewMarkerId = null;
    this.liveAudioCaptureActive = false;
    if (this.recordingManager) {
      this.recordingManager.cleanup();
      this.recordingManager = null;
    }
    if (this.documentInserter) {
      this.documentInserter = null;
    }
    if (this.pauseBtnEl) {
      (0, setIcon)(this.pauseBtnEl, "pause");
    }
  }
  setState(state) {
    var _a;
    this.state = state;
    if (this.pillEl) {
      this.pillEl.setAttribute("data-state", state);
    }
    requestAnimationFrame(() => this.applyEdgeNudge());
    (_a = this.onStateChange) == null ? void 0 : _a.call(this, state);
  }
  applyEdgeNudge() {
    if (!this.pillEl || !this.containerEl || !this.activeContainer) return;
    if (this.state === "idle") {
      this.pillEl.style.transform = "";
      return;
    }
    const targetWidths = { expanded: 216, recording: 220, paused: 220, finalizing: 156 };
    const targetWidth = targetWidths[this.state] || 48;
    const anchorRect = this.containerEl.getBoundingClientRect();
    const leafRect = this.activeContainer.getBoundingClientRect();
    const pillLeft = anchorRect.left;
    const pillRightTarget = pillLeft + targetWidth;
    const margin = 8;
    const overflowRight = pillRightTarget - (leafRect.right - margin);
    const overflowLeft = (leafRect.left + margin) - pillLeft;
    if (overflowRight > 0) {
      this.pillEl.style.transform = `translateX(${-overflowRight}px)`;
    } else if (overflowLeft > 0) {
      this.pillEl.style.transform = `translateX(${overflowLeft}px)`;
    } else {
      this.pillEl.style.transform = "";
    }
  }
  startTimer() {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => {
      this.timerSeconds += 1;
      this.updateTimerDisplay();
    }, 1e3);
  }
  stopTimer() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
  updateTimerDisplay() {
    if (!this.timerEl) return;
    this.timerEl.textContent = this.formatTimer(this.timerSeconds);
  }
  formatTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }
  async enqueueLivePreviewUpdate(partialResult) {
    const markerId = this.livePreviewMarkerId;
    if (!markerId || !this.documentInserter) return;
    this.livePreviewWriteChain = this.livePreviewWriteChain.then(async () => {
      await this.documentInserter.upsertLiveTranscriptionBlock(this.activeFile, this.cursorPosition, markerId, partialResult);
    }).catch(() => {});
    await this.livePreviewWriteChain;
  }
  async clearLivePreviewBlock(markerIdOverride) {
    const markerId = markerIdOverride != null ? markerIdOverride : this.livePreviewMarkerId;
    if (!markerId || !this.documentInserter) return;
    await this.livePreviewWriteChain.catch(() => {});
    try {
      await this.documentInserter.removeLiveTranscriptionBlock(this.activeFile, markerId);
    } catch (e) {}
  }
  handleFailure(message, error) {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`${message}: ${detail}`);
    this.resetRecordingState();
    this.setState("idle");
  }
  show() {
    if (this.containerEl) this.containerEl.style.display = "";
  }
  hide() {
    if (this.containerEl) this.containerEl.style.display = "none";
  }
  dispose() {
    this.isDisposed = true;
    this.stopTimer();
    if (this.state === "recording" || this.state === "paused") {
      this.cancelRecording();
    } else if (this.state === "finalizing") {
      this.cancelTranscription();
    }
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
}
