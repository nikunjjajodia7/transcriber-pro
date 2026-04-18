var import_obsidian17 = require("obsidian");
class TimerModal extends import_obsidian17.Modal {
  static RECORDER_STOP_TIMEOUT_MS = 12e3;

  constructor(plugin, targetFile, insertionPosition) {
    var _a;
    super(plugin.app);
    this.plugin = plugin;
    this.targetFile = targetFile;
    this.insertionPosition = insertionPosition;
    this.intervalId = null;
    this.seconds = 0;
    this.isClosing = false;
    this.currentState = "inactive";
    this.streamingService = null;
    this.useStreaming = false;
    this.chunkIndex = 0;
    this.recordingStartTime = 0;
    this.interruptedByLifecycle = false;
    this.pausedByBackpressure = false;
    this.backpressureMonitorId = null;
    this.onVisibilityChangeBound = null;
    this.onPageHideBound = null;
    this.onPopStateBound = null;
    this.onOutsideInteractionBound = null;
    this.onModalTouchEndBound = null;
    this.livePreviewMarkerId = null;
    this.livePreviewWriteChain = Promise.resolve();
    this.liveAudioCaptureActive = false;
    this.recordingManager = new AudioRecordingManager(plugin);
    this.deviceDetection = DeviceDetection.getInstance();
    this.documentInserter = new DocumentInserter(plugin);
    const streamingOptions = this.deviceDetection.getOptimalStreamingOptions();
    this.useStreaming = (_a = this.plugin.settings.streamingMode) != null ? _a : this.deviceDetection.shouldUseStreamingMode();
    this.CONFIG = {
      maxDuration: Number.POSITIVE_INFINITY,
      warningThreshold: 60,
      updateInterval: 1e3,
      chunkDuration: streamingOptions.chunkDuration * 1e3
      // Convert to milliseconds
    };
    this.setupCloseHandlers();
  }
  /**
   * Sets up handlers for modal closing via escape key, clicks, and touch events
   * 📱 Enhanced with proper mobile touch handling
   */
  setupCloseHandlers() {
    this.contentEl.addEventListener("touchstart", (e) => {
      e.stopPropagation();
    }, { passive: true });
    this.onOutsideInteractionBound = (event) => {
      const target = event.target;
      if (target === this.modalEl) {
        event.preventDefault();
        event.stopPropagation();
        void this.requestClose();
      }
    };
    this.modalEl.addEventListener("click", this.onOutsideInteractionBound);
    this.modalEl.addEventListener("touchstart", this.onOutsideInteractionBound, { passive: false });
    this.onModalTouchEndBound = (e) => e.preventDefault();
    this.modalEl.addEventListener("touchend", this.onModalTouchEndBound, { passive: false });
    this.scope.register([], "Escape", () => {
      void this.requestClose();
      return false;
    });
    this.onPopStateBound = () => {
      void this.requestClose();
    };
    window.addEventListener("popstate", this.onPopStateBound);
  }
  /**
   * Override the built-in close method to use our custom close handler
   */
  close() {
    if (!this.isClosing) {
      void this.requestClose();
    }
  }
  /**
   * Handles all close attempts, ensuring proper cleanup and save prompts
   */
  async requestClose() {
    if (this.isClosing)
      return;
    this.isClosing = true;
    if (this.currentState === "recording" || this.currentState === "paused") {
      await this.handleStop();
    } else {
      await this.finalizeClose();
    }
  }
  /**
   * Performs final cleanup and closes the modal
   */
  async finalizeClose() {
    this.cleanup();
    this.isClosing = false;
    super.close();
  }
  /**
   * Initializes the modal with enhanced mobile support
   * 📱 Added mobile-specific meta tags and initialization
   */
  async onOpen() {
    try {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("neurovox-timer-modal");
      if (this.isMobileDevice()) {
        contentEl.addClass("is-mobile");
      }
      const container = contentEl.createDiv({
        cls: "neurovox-timer-content"
      });
      this.ui = new RecordingUI(container, {
        onPause: () => this.handlePauseToggle(),
        onStop: () => this.handleStop()
      });
      this.registerLifecycleHandlers();
      await this.initializeRecording();
    } catch (error) {
      this.handleError("Failed to initialize recording", error);
    }
  }
  /**
   * Initializes recording with mobile-specific handling
   * 📱 Added device-specific audio configuration
   */
  async initializeRecording() {
    try {
      await this.recordingManager.initialize();
      await this.startRecording();
    } catch (error) {
      if (this.isIOSDevice() && error instanceof Error && error.name === "NotAllowedError") {
        this.handleError("iOS requires microphone permission. Please enable it in Settings.", error);
      } else {
        this.handleError("Failed to initialize recording", error);
      }
    }
  }
  /**
   * Detects if current device is mobile using Obsidian's Platform API
   */
  isMobileDevice() {
    return import_obsidian17.Platform.isMobile;
  }
  /**
   * Detects if current device is iOS using Obsidian's Platform API
   */
  isIOSDevice() {
    return import_obsidian17.Platform.isIosApp || import_obsidian17.Platform.isMobile && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  /**
   * Starts or resumes recording with progressive chunk processing
   */
  async startRecording() {
    try {
      if (this.currentState === "paused") {
        if (this.useStreaming && this.streamingService) {
          this.streamingService.resumeLive();
          if (this.liveAudioCaptureActive) {
            this.recordingManager.resume();
          }
        } else {
          this.recordingManager.resume();
        }
        this.resumeTimer();
      } else {
        if (this.useStreaming && !this.streamingService) {
          this.streamingService = new StreamingTranscriptionService(
            this.plugin,
            {
              onMemoryWarning: (usage) => {
                new import_obsidian17.Notice(`Memory usage high: ${Math.round(usage)}%`);
              },
              onChunkCommitted: async (_chunkText, _metadata, partialResult) => {
                if (!this.plugin.settings.showLiveChunkPreviewInNote)
                  return;
                await this.enqueueLivePreviewUpdate(partialResult);
              }
            }
          );
          this.livePreviewMarkerId = this.streamingService.getRecoveryJobId();
        }
        this.recordingStartTime = Date.now();
        this.chunkIndex = 0;
        if (this.useStreaming && this.streamingService) {
          const stream = this.recordingManager.getStream();
          if (!stream) {
            throw new Error("Microphone stream unavailable");
          }
          await this.streamingService.startLiveSession(stream);
          if (this.plugin.settings.saveLiveRecordingAudio && !this.liveAudioCaptureActive) {
            this.recordingManager.start();
            this.liveAudioCaptureActive = true;
          }
        } else {
          this.recordingManager.start();
        }
        this.startTimer();
      }
      this.currentState = "recording";
      this.ui.updateState(this.currentState);
      this.stopBackpressureMonitor();
      this.pausedByBackpressure = false;
      if (this.interruptedByLifecycle) {
        this.interruptedByLifecycle = false;
        new import_obsidian17.Notice("Recording resumed after app interruption");
      }
      new import_obsidian17.Notice("Recording started");
    } catch (error) {
      this.handleError("Failed to start recording", error);
    }
  }
  /**
   * Handles pause/resume toggle
   */
  handlePauseToggle() {
    if (this.currentState === "paused") {
      void this.startRecording();
    } else {
      this.pauseRecording();
    }
  }
  /**
   * Pauses the current recording
   */
  pauseRecording(reasonMessage) {
    try {
      if (this.useStreaming && this.streamingService) {
        this.streamingService.pauseLive();
        if (this.liveAudioCaptureActive) {
          this.recordingManager.pause();
        }
      } else {
        this.recordingManager.pause();
      }
      this.pauseTimer();
      this.currentState = "paused";
      this.ui.updateState(this.currentState);
      new import_obsidian17.Notice(reasonMessage || "Recording paused");
    } catch (error) {
      this.handleError("Failed to pause recording", error);
    }
  }
  /**
   * Handles stop button click
   */
  async handleStop() {
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
      let result;
      if (this.useStreaming && this.streamingService) {
        new import_obsidian17.Notice("Finishing transcription...");
        result = await this.streamingService.finishProcessing();
        this.streamingService = null;
        if (!result || result.trim().length === 0) {
          throw new Error("No transcription result received");
        }
        await this.plugin.recordingProcessor.processStreamingResult(
          result,
          this.targetFile,
          this.insertionPosition,
          {
            audioBlob: finalBlob || void 0,
            durationSeconds: this.seconds
          }
        );
        result = "";
      } else {
        if (!finalBlob) {
          throw new Error("No audio data received from recorder");
        }
        result = finalBlob;
      }
      this.cleanup();
      super.close();
      if (this.onStop && result !== "") {
        await this.onStop(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (this.streamingService) {
        this.streamingService.abort(`finalize_failed:${errorMessage}`);
        this.streamingService = null;
      }
      this.handleError("Failed to stop recording", error);
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
          TimerModal.RECORDER_STOP_TIMEOUT_MS
        )
      )
    ]);
  }
  /**
   * Manages the recording timer
   */
  startTimer() {
    this.seconds = 0;
    this.updateTimerDisplay();
    this.intervalId = window.setInterval(() => {
      this.seconds++;
      this.updateTimerDisplay();
      if (Number.isFinite(this.CONFIG.maxDuration) && this.seconds >= this.CONFIG.maxDuration) {
        void this.handleStop();
        new import_obsidian17.Notice("Maximum recording duration reached");
      }
    }, this.CONFIG.updateInterval);
  }
  /**
   * Updates the timer display
   */
  updateTimerDisplay() {
    this.ui.updateTimer(
      this.seconds,
      this.CONFIG.maxDuration,
      this.CONFIG.warningThreshold
    );
  }
  /**
   * Pauses the timer
   */
  pauseTimer() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  /**
   * Resumes the timer
   */
  resumeTimer() {
    if (!this.intervalId) {
      this.intervalId = window.setInterval(() => {
        this.seconds++;
        this.updateTimerDisplay();
        if (Number.isFinite(this.CONFIG.maxDuration) && this.seconds >= this.CONFIG.maxDuration) {
          void this.handleStop();
          new import_obsidian17.Notice("Maximum recording duration reached");
        }
      }, this.CONFIG.updateInterval);
    }
  }
  /**
   * Cleans up all resources
   */
  cleanup() {
    var _a;
    try {
      this.unregisterLifecycleHandlers();
      if (this.onOutsideInteractionBound) {
        this.modalEl.removeEventListener("click", this.onOutsideInteractionBound);
        this.modalEl.removeEventListener("touchstart", this.onOutsideInteractionBound);
        this.onOutsideInteractionBound = null;
      }
      if (this.onModalTouchEndBound) {
        this.modalEl.removeEventListener("touchend", this.onModalTouchEndBound);
        this.onModalTouchEndBound = null;
      }
      if (this.onPopStateBound) {
        window.removeEventListener("popstate", this.onPopStateBound);
        this.onPopStateBound = null;
      }
      this.pauseTimer();
      this.stopBackpressureMonitor();
      this.recordingManager.cleanup();
      (_a = this.ui) == null ? void 0 : _a.cleanup();
      if (this.streamingService) {
        this.streamingService.abort();
        this.streamingService = null;
      }
    } catch (error) {
    } finally {
      this.currentState = "inactive";
      this.seconds = 0;
      this.isClosing = false;
      this.chunkIndex = 0;
      this.recordingStartTime = 0;
      this.interruptedByLifecycle = false;
      this.pausedByBackpressure = false;
      this.livePreviewMarkerId = null;
      this.livePreviewWriteChain = Promise.resolve();
      this.liveAudioCaptureActive = false;
    }
  }
  async enqueueLivePreviewUpdate(partialResult) {
    const markerId = this.livePreviewMarkerId;
    if (!markerId)
      return;
    this.livePreviewWriteChain = this.livePreviewWriteChain.then(async () => {
      await this.documentInserter.upsertLiveTranscriptionBlock(
        this.targetFile,
        this.insertionPosition,
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
      await this.documentInserter.removeLiveTranscriptionBlock(this.targetFile, markerId);
    } catch (e) {
    }
  }
  registerLifecycleHandlers() {
    if (!this.onVisibilityChangeBound) {
      this.onVisibilityChangeBound = () => {
        if (document.visibilityState === "hidden") {
          this.handleLifecycleInterruption("app_hidden");
        }
      };
      document.addEventListener("visibilitychange", this.onVisibilityChangeBound);
    }
    if (!this.onPageHideBound) {
      this.onPageHideBound = () => this.handleLifecycleInterruption("page_hide");
      window.addEventListener("pagehide", this.onPageHideBound);
    }
  }
  unregisterLifecycleHandlers() {
    if (this.onVisibilityChangeBound) {
      document.removeEventListener("visibilitychange", this.onVisibilityChangeBound);
      this.onVisibilityChangeBound = null;
    }
    if (this.onPageHideBound) {
      window.removeEventListener("pagehide", this.onPageHideBound);
      this.onPageHideBound = null;
    }
  }
  handleLifecycleInterruption(_reason) {
    if (this.currentState !== "recording")
      return;
    this.interruptedByLifecycle = true;
    this.pauseRecording();
    new import_obsidian17.Notice("Recording paused due to app interruption. Resume when back.");
  }
  startBackpressureMonitor() {
    if (this.backpressureMonitorId !== null)
      return;
    this.backpressureMonitorId = window.setInterval(() => {
      if (!this.pausedByBackpressure || this.currentState !== "paused" || !this.streamingService)
        return;
      const pressure = this.streamingService.getBackpressureState();
      if (!pressure.paused) {
        this.pausedByBackpressure = false;
        this.stopBackpressureMonitor();
        void this.startRecording();
      }
    }, 800);
  }
  stopBackpressureMonitor() {
    if (this.backpressureMonitorId !== null) {
      window.clearInterval(this.backpressureMonitorId);
      this.backpressureMonitorId = null;
    }
  }
  /**
   * Handles errors with user feedback
   */
  handleError(message, error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    new import_obsidian17.Notice(`${message}: ${errorMessage}`);
    this.cleanup();
    void this.requestClose();
  }
}
