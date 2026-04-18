var MobileDockPill = class {
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
    this.dockTrackingRafId = null;
    this.lastDockBottom = null;
    this.dockEl = null;
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
    this.onDispose = null;
    this.uploadSheet = null;
    this.overlayObserver = null;
    this.deviceDetection = DeviceDetection.getInstance();
    this.saveAudioOn = this.plugin.settings.saveLiveRecordingAudio || false;
    this.useStreaming = this.plugin.settings.streamingMode != null ? this.plugin.settings.streamingMode : this.deviceDetection.shouldUseStreamingMode();
    this.createElement();
  }
  static RECORDER_STOP_TIMEOUT_MS = 12e3;
  createElement() {
    this.containerEl = document.createElement("div");
    this.containerEl.classList.add("neurovox-dock-pill-container");
    this.pillEl = document.createElement("div");
    this.pillEl.classList.add("neurovox-dock-pill");
    this.pillEl.setAttribute("data-state", "idle");
    this.contentEl = document.createElement("div");
    this.contentEl.classList.add("neurovox-dock-pill__content");
    // Idle icon
    this.idleIconEl = document.createElement("div");
    this.idleIconEl.classList.add("neurovox-dock-pill__idle-icon");
    (0, import_obsidian16.setIcon)(this.idleIconEl, "mic");
    this.contentEl.appendChild(this.idleIconEl);
    // Expanded section
    this.expandedEl = document.createElement("div");
    this.expandedEl.classList.add("neurovox-dock-pill__expanded");
    const uploadBtn = this.makeIconBtn("upload", "neurovox-dock-pill__icon neurovox-dock-pill__upload");
    uploadBtn.addEventListener("click", (e) => { e.stopPropagation(); this.handleUploadTap(); });
    this.expandedEl.appendChild(uploadBtn);
    this.saveBtnEl = this.makeIconBtn("save", "neurovox-dock-pill__icon neurovox-dock-pill__save");
    if (this.saveAudioOn) this.saveBtnEl.classList.add("active");
    this.saveBtnEl.addEventListener("click", (e) => { e.stopPropagation(); this.handleSaveTap(); });
    this.expandedEl.appendChild(this.saveBtnEl);
    const micBtn = this.makeIconBtn("mic", "neurovox-dock-pill__icon neurovox-dock-pill__mic");
    micBtn.addEventListener("click", (e) => { e.stopPropagation(); this.handleMicTap(); });
    this.expandedEl.appendChild(micBtn);
    const closeBtn1 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    closeBtn1.addEventListener("click", (e) => { e.stopPropagation(); this.handleCloseTap(); });
    this.expandedEl.appendChild(closeBtn1);
    this.contentEl.appendChild(this.expandedEl);
    // Recording section
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
    this.pauseBtnEl.addEventListener("click", (e) => { e.stopPropagation(); this.handlePauseTap(); });
    this.recordingEl.appendChild(this.pauseBtnEl);
    const stopBtn = document.createElement("div");
    stopBtn.classList.add("neurovox-dock-pill__stop-btn");
    (0, import_obsidian16.setIcon)(stopBtn, "square");
    stopBtn.addEventListener("click", (e) => { e.stopPropagation(); this.handleStopTap(); });
    this.recordingEl.appendChild(stopBtn);
    const closeBtn2 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    closeBtn2.addEventListener("click", (e) => { e.stopPropagation(); this.handleCloseTap(); });
    this.recordingEl.appendChild(closeBtn2);
    this.contentEl.appendChild(this.recordingEl);
    // Finalizing section
    this.finalizingEl = document.createElement("div");
    this.finalizingEl.classList.add("neurovox-dock-pill__finalizing");
    const loaderIcon = document.createElement("div");
    loaderIcon.classList.add("neurovox-dock-pill__loader-icon");
    (0, import_obsidian16.setIcon)(loaderIcon, "loader");
    this.finalizingEl.appendChild(loaderIcon);
    const statusText = document.createElement("span");
    statusText.classList.add("neurovox-dock-pill__status-text");
    statusText.textContent = "Transcribing";
    this.finalizingEl.appendChild(statusText);
    const closeBtn3 = this.makeIconBtn("x", "neurovox-dock-pill__icon neurovox-dock-pill__close");
    closeBtn3.addEventListener("click", (e) => { e.stopPropagation(); this.handleCloseTap(); });
    this.finalizingEl.appendChild(closeBtn3);
    this.contentEl.appendChild(this.finalizingEl);
    this.pillEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.pillEl);
    // Pill tap (for idle state)
    this.pillEl.addEventListener("click", () => { this.handlePillTap(); });
  }
  makeIconBtn(iconName, cls) {
    const btn = document.createElement("div");
    btn.classList.add("clickable-icon");
    cls.split(" ").forEach((c) => btn.classList.add(c));
    (0, import_obsidian16.setIcon)(btn, iconName);
    return btn;
  }
  handlePillTap() {
    if (this.state === "idle") {
      this.setState("expanded");
    }
  }
  handleUploadTap() {
    if (this.state !== "expanded") return;
    const activeView = this.plugin.app.workspace.getActiveViewOfType(import_obsidian16.MarkdownView);
    if (!activeView || !activeView.file) {
      new import_obsidian16.Notice("No active note found to insert transcription.");
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    this.uploadSheet = new UploadBottomSheet({
      plugin: this.plugin,
      saveAudioOn: this.saveAudioOn,
      onTranscribe: (file, saveAudio) => {
        this.saveAudioOn = saveAudio;
        this.plugin.settings.saveLiveRecordingAudio = saveAudio;
        void this.plugin.saveSettings({ refreshUi: false, triggerFloatingRefresh: false }).catch(() => {});
        if (this.saveBtnEl) this.saveBtnEl.classList.toggle("active", saveAudio);
        void this.processUploadedFile(file);
      },
      onCancel: () => {
        this.uploadSheet = null;
      }
    });
    this.uploadSheet.open();
  }
  async processUploadedFile(file) {
    try {
      this.setState("finalizing");
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/wav" });
      await this.plugin.recordingProcessor.processRecording(blob, this.activeFile, this.cursorPosition, file.name);
      new import_obsidian16.Notice(`Transcribed uploaded audio: ${file.name}`);
      this.setState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian16.Notice(`Failed to transcribe: ${message}`);
      this.setState("idle");
    }
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
    const activeView = this.plugin.app.workspace.getActiveViewOfType(import_obsidian16.MarkdownView);
    if (!activeView || !activeView.file) {
      new import_obsidian16.Notice("No active note found to insert transcription.");
      return;
    }
    this.activeFile = activeView.file;
    this.cursorPosition = activeView.editor.getCursor();
    await this.startRecordingSession();
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
            new import_obsidian16.Notice(`Memory usage high: ${Math.round(usage)}%`);
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
      new import_obsidian16.Notice("Recording started");
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
        (0, import_obsidian16.setIcon)(this.pauseBtnEl, "pause");
      } else {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.pauseLive();
          if (this.liveAudioCaptureActive) this.recordingManager.pause();
        } else {
          this.recordingManager.pause();
        }
        this.stopTimer();
        this.setState("paused");
        (0, import_obsidian16.setIcon)(this.pauseBtnEl, "play");
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
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Recorder stop timed out")), MobileDockPill.RECORDER_STOP_TIMEOUT_MS))
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
      (0, import_obsidian16.setIcon)(this.pauseBtnEl, "pause");
    }
  }
  setState(state) {
    var _a;
    this.state = state;
    if (this.pillEl) {
      this.pillEl.setAttribute("data-state", state);
    }
    (_a = this.onStateChange) == null ? void 0 : _a.call(this, state);
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
    new import_obsidian16.Notice(`${message}: ${detail}`);
    this.resetRecordingState();
    this.setState("idle");
  }
  attachTo(viewContent) {
    if (!this.containerEl) return;
    if (this.containerEl.parentNode !== document.body) {
      document.body.appendChild(this.containerEl);
    }
    this.measureAndPositionAboveDock();
    this.startOverlayObserver();
    this.startDockTracking();
  }
  startOverlayObserver() {
    if (this.overlayObserver) return;
    this.overlayCheckPending = false;
    this.overlayObserver = new MutationObserver(() => {
      if (this.overlayCheckPending) return;
      this.overlayCheckPending = true;
      requestAnimationFrame(() => {
        this.updateVisibilityForOverlays();
        this.overlayCheckPending = false;
      });
    });
    this.overlayObserver.observe(document.body, { childList: true, subtree: true });
  }
  updateVisibilityForOverlays() {
    if (!this.containerEl) return;
    const hasOverlay = document.querySelector('.modal-container') !== null
      || document.querySelector('.menu') !== null
      || document.querySelector('.prompt') !== null
      || document.querySelector('.suggestion-container') !== null
      || document.querySelector('.neurovox-upload-overlay') !== null
      || this.isMobileDrawerOpen()
      || !this.hasActiveMarkdownView();
    if (hasOverlay) {
      this.containerEl.style.visibility = 'hidden';
      this.containerEl.style.pointerEvents = 'none';
    } else {
      this.containerEl.style.visibility = '';
      this.containerEl.style.pointerEvents = '';
    }
  }
  isMobileDrawerOpen() {
    const drawers = document.querySelectorAll('.workspace-drawer');
    if (drawers.length === 0) return false;
    const vw = window.innerWidth;
    for (const drawer of drawers) {
      const rect = drawer.getBoundingClientRect();
      if (rect.width <= 0) continue;
      if (drawer.classList.contains('mod-left') && rect.right > 1) return true;
      if (drawer.classList.contains('mod-right') && rect.left < vw - 1) return true;
    }
    return false;
  }
  hasActiveMarkdownView() {
    try {
      return !!this.plugin.app.workspace.getActiveViewOfType(import_obsidian16.MarkdownView);
    } catch (e) {
      return true;
    }
  }
  resolveDockEl() {
    if (this.dockEl && this.dockEl.isConnected) return this.dockEl;
    this.dockEl = document.querySelector('.mobile-navbar')
        || document.querySelector('.workspace-tab-header-container-inner')
        || document.querySelector('.mod-mobile .workspace-tab-header-container');
    return this.dockEl;
  }
  startDockTracking() {
    if (this.dockTrackingRafId !== null) return;
    if (!this.resolveDockEl()) return;
    const track = () => {
        if (this.isDisposed || !this.containerEl) {
            this.dockTrackingRafId = null;
            return;
        }
        const dockEl = this.resolveDockEl();
        if (dockEl) {
            const dockRect = dockEl.getBoundingClientRect();
            const dockMissing = dockRect.width === 0 && dockRect.height === 0;
            const distFromBottom = dockMissing ? -1 : window.innerHeight - dockRect.top;
            if (distFromBottom !== this.lastDockBottom) {
                this.lastDockBottom = distFromBottom;
                if (distFromBottom <= 0) {
                    this.containerEl.style.transform = 'translateX(-50%) translateY(100%)';
                } else {
                    this.containerEl.style.transform = 'translateX(-50%)';
                    this.containerEl.style.bottom = (distFromBottom + 6) + 'px';
                }
            }
        }
        this.updateVisibilityForOverlays();
        this.dockTrackingRafId = requestAnimationFrame(track);
    };
    this.dockTrackingRafId = requestAnimationFrame(track);
  }
  stopDockTracking() {
    if (this.dockTrackingRafId !== null) {
        cancelAnimationFrame(this.dockTrackingRafId);
        this.dockTrackingRafId = null;
    }
    this.lastDockBottom = null;
    this.dockEl = null;
  }
  measureAndPositionAboveDock() {
    if (!this.containerEl) return;
    this.dockEl = null;
    const dockEl = this.resolveDockEl();
    if (dockEl) {
      const dockRect = dockEl.getBoundingClientRect();
      if (dockRect.width === 0 && dockRect.height === 0) return;
      const distFromBottom = window.innerHeight - dockRect.top;
      this.containerEl.style.bottom = (distFromBottom + 6) + 'px';
    }
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
    this.cancelRecording();
    this.stopDockTracking();
    if (this.overlayObserver) {
      this.overlayObserver.disconnect();
      this.overlayObserver = null;
    }
    if (this.uploadSheet) {
      this.uploadSheet.close();
      this.uploadSheet = null;
    }
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
};
