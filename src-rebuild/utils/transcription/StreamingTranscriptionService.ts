var import_obsidian12 = require("obsidian");

class StreamingTranscriptionService {
  static CHUNK_MAX_RETRIES = 2;
  static CHUNK_RETRY_DELAY_MS = 1e3;
  static FINALIZE_TIMEOUT_MS = 12 * 60 * 1e3;
  static FOUR_HUNDRED_FALLBACK_THRESHOLD = 2;
  static LIVE_DIARIZATION_STABILIZATION_MS = 2500;

  constructor(plugin, callbacks) {
    this.plugin = plugin;
    this.isProcessing = false;
    this.acceptingChunks = true;
    this.processedChunks = /* @__PURE__ */ new Set();
    this.abortController = null;
    this.processingPromise = null;
    this.recoveryJobInitialized = false;
    this.failedChunks = /* @__PURE__ */ new Map();
    this.lastChunkError = null;
    this.transportProfile = "native";
    this.consecutive400Errors = 0;
    this.liveAdapter = null;
    this.liveAdapterStartPromise = null;
    this.liveAudioSource = null;
    this.liveStarted = false;
    this.livePaused = false;
    this.liveSegmentIndex = 0;
    this.liveSentChunkCount = 0;
    this.liveFatalError = null;
    this.lastInterimText = null;
    this.lastInterimTs = null;
    this.lastCommittedText = null;
    this.liveReconnectRequired = false;
    this.bufferedLiveFinals = [];
    this.deviceDetection = DeviceDetection.getInstance();
    const options = this.deviceDetection.getOptimalStreamingOptions();
    this.chunkQueue = new ChunkQueue(
      options.maxQueueSize,
      options.memoryLimit,
      callbacks == null ? void 0 : callbacks.onMemoryWarning
    );
    this.resultCompiler = new ResultCompiler();
    this.transcriptionService = new TranscriptionService(plugin);
    this.callbacks = callbacks || {};
    this.logContext = RuntimeLogger.createContext("stream");
    this.jobStore = new JobStore(plugin);
    this.transportMode = this.plugin.settings.transcriptionProvider === "deepgram" /* Deepgram */ ? "deepgram_ws" : "chunk_queue";
    this.liveSessionStartTs = Date.now();
    if (this.transportMode === "deepgram_ws") {
      this.initializeLiveAdapter();
    }
  }
  async startLiveSession(stream) {
    if (this.transportMode !== "deepgram_ws")
      return;
    if (this.liveStarted)
      return;
    await this.ensureRecoveryJob();
    await this.ensureLiveAdapterStarted();
    this.liveAudioSource = new WebAudioPcmSource(stream, {
      targetSampleRate: 16e3,
      bufferSize: 4096
    });
    await RuntimeLogger.log(this.plugin, this.logContext, "provider_request", {
      status: "started",
      mode: "deepgram_ws",
      reason: "live_ws_open",
      diarize: this.plugin.settings.enableSpeakerDiarization,
      forceRomanizedOutput: this.plugin.settings.forceRomanizedOutput,
      deepgramLiveDiarizationProfile: this.plugin.settings.deepgramLiveDiarizationProfile
    });
    await this.liveAudioSource.start(async (frame) => {
      var _a;
      if (!this.acceptingChunks || this.livePaused)
        return;
      try {
        await ((_a = this.liveAdapter) == null ? void 0 : _a.sendAudio(frame));
        this.liveSentChunkCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.liveFatalError = message;
        this.lastChunkError = { message, chunkId: "live_frame_send" };
      }
    });
    this.liveStarted = true;
    this.livePaused = false;
  }
  pauseLive() {
    var _a;
    if (this.transportMode !== "deepgram_ws")
      return;
    this.livePaused = true;
    (_a = this.liveAudioSource) == null ? void 0 : _a.pause();
  }
  resumeLive() {
    var _a, _b;
    if (this.transportMode !== "deepgram_ws")
      return;
    this.livePaused = false;
    if (this.liveReconnectRequired || !((_a = this.liveAdapter) == null ? void 0 : _a.isOpen())) {
      this.liveReconnectRequired = false;
      void this.ensureLiveAdapterStarted().catch(async (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.liveFatalError = this.liveFatalError || `resume_reconnect_failed:${reason}`;
        this.lastChunkError = {
          chunkId: `live_seg_${this.liveSegmentIndex}`,
          message: this.liveFatalError
        };
        await RuntimeLogger.log(this.plugin, this.logContext, "provider_failure", {
          status: "failed",
          reason: this.liveFatalError,
          mode: "deepgram_ws"
        });
      });
    }
    (_b = this.liveAudioSource) == null ? void 0 : _b.resume();
  }
  async addChunk(chunk, metadata) {
    if (!this.acceptingChunks) {
      await RuntimeLogger.log(this.plugin, this.logContext, "chunk_fail", {
        status: "rejected",
        chunkId: metadata.id,
        chunkIndex: metadata.index,
        reason: "finalize_in_progress"
      });
      return false;
    }
    if (this.transportMode === "deepgram_ws") {
      await RuntimeLogger.log(this.plugin, this.logContext, "chunk_fail", {
        status: "rejected",
        chunkId: metadata.id,
        chunkIndex: metadata.index,
        reason: "live_ws_uses_pcm_frames"
      });
      return false;
    }
    const added = await this.chunkQueue.enqueue(chunk, metadata);
    if (!added) {
      const reason = this.chunkQueue.getLastRejectReason() || "queue_backpressure";
      await RuntimeLogger.log(this.plugin, this.logContext, "chunk_fail", {
        status: "failed",
        chunkId: metadata.id,
        chunkIndex: metadata.index,
        reason
      });
      return false;
    }
    await RuntimeLogger.log(this.plugin, this.logContext, "chunk_create", {
      status: "queued",
      chunkId: metadata.id,
      chunkIndex: metadata.index,
      chunkDurationMs: metadata.duration,
      chunkSize: metadata.size,
      queueSize: this.chunkQueue.size()
    });
    if (!this.isProcessing) {
      this.processingPromise = this.startProcessing();
    }
    return true;
  }
  async startProcessing() {
    if (this.isProcessing)
      return;
    this.isProcessing = true;
    this.abortController = new AbortController();
    await this.ensureRecoveryJob();
    try {
      while (!this.abortController.signal.aborted) {
        const queueItem = this.chunkQueue.dequeue();
        if (!queueItem) {
          if (!this.acceptingChunks) {
            break;
          }
          await this.sleep(100);
          continue;
        }
        try {
          await this.processChunkWithRetry(queueItem.chunk, queueItem.metadata);
        } catch (error) {
          this.lastChunkError = {
            chunkId: queueItem.metadata.id,
            message: error instanceof Error ? error.message : String(error)
          };
        }
      }
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }
  async processChunkWithRetry(chunk, metadata) {
    let attempt = 0;
    while (attempt <= StreamingTranscriptionService.CHUNK_MAX_RETRIES) {
      try {
        await this.processChunkOnce(chunk, metadata);
        this.consecutive400Errors = 0;
        return;
      } catch (error) {
        attempt += 1;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const is400 = /\bstatus 400\b/i.test(errorMessage);
        if (is400) {
          this.consecutive400Errors += 1;
          if (this.plugin.settings.streamTransportFallbackEnabled && this.transportProfile === "native" && this.consecutive400Errors >= StreamingTranscriptionService.FOUR_HUNDRED_FALLBACK_THRESHOLD) {
            this.transportProfile = "wav_fallback";
            await RuntimeLogger.log(this.plugin, this.logContext, "chunk_retry", {
              status: "retrying",
              chunkId: metadata.id,
              chunkIndex: metadata.index,
              attempt,
              maxAttempts: StreamingTranscriptionService.CHUNK_MAX_RETRIES + 1,
              reason: "Switching stream transport profile to wav_fallback after repeated 400 errors"
            });
          }
        } else {
          this.consecutive400Errors = 0;
        }
        if (attempt <= StreamingTranscriptionService.CHUNK_MAX_RETRIES) {
          await RuntimeLogger.log(this.plugin, this.logContext, "chunk_retry", {
            status: "retrying",
            chunkId: metadata.id,
            chunkIndex: metadata.index,
            attempt,
            maxAttempts: StreamingTranscriptionService.CHUNK_MAX_RETRIES + 1,
            reason: errorMessage
          });
          await this.sleep(StreamingTranscriptionService.CHUNK_RETRY_DELAY_MS);
          continue;
        }
        await RuntimeLogger.log(this.plugin, this.logContext, "chunk_fail", {
          status: "failed",
          chunkId: metadata.id,
          chunkIndex: metadata.index,
          attempts: StreamingTranscriptionService.CHUNK_MAX_RETRIES + 1,
          reason: error instanceof Error ? error.message : String(error)
        });
        const failureMessage = error instanceof Error ? error.message : String(error);
        this.failedChunks.set(metadata.index, failureMessage);
        await this.jobStore.upsertCheckpoint({
          jobId: this.logContext.jobId,
          index: metadata.index,
          status: "failed",
          stage: "transcription_ready",
          chunkId: metadata.id,
          errorCode: "chunk_retry_exhausted",
          errorMessage: failureMessage,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        throw error;
      }
    }
  }
  async processChunkOnce(chunk, metadata) {
    const payload = await this.prepareChunkPayload(chunk);
    await RuntimeLogger.log(this.plugin, this.logContext, "provider_request", {
      status: "started",
      chunkId: metadata.id,
      chunkIndex: metadata.index,
      mimeType: payload.mimeType,
      size: payload.size
    });
    const result = await this.transcriptionService.transcribeContent(payload.arrayBuffer, {
      mimeType: payload.mimeType,
      allowEmptyTranscription: true
    });
    await RuntimeLogger.log(this.plugin, this.logContext, "provider_response", {
      status: "success",
      chunkId: metadata.id,
      chunkIndex: metadata.index,
      transcriptionChars: result.transcription.length
    });
    await this.commitFinalTranscriptChunk(result.transcription, metadata);
    this.cleanupBlob(chunk);
  }
  async finishProcessing() {
    this.acceptingChunks = false;
    if (this.transportMode === "deepgram_ws") {
      await this.finishLiveTransport();
      return this.buildFinalResult();
    }
    if (this.processingPromise) {
      try {
        await Promise.race([
          this.processingPromise,
          this.sleep(StreamingTranscriptionService.FINALIZE_TIMEOUT_MS).then(() => {
            throw new Error("Finalize timed out while waiting for queue drain");
          })
        ]);
      } catch (error) {
        if (this.abortController) {
          this.abortController.abort();
        }
        await RuntimeLogger.log(this.plugin, this.logContext, "job_abort", {
          status: "aborted",
          reason: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
    return this.buildFinalResult();
  }
  getPartialResult() {
    return this.resultCompiler.getPartialResult(
      this.plugin.settings.includeTimestamps || false
    );
  }
  getStats() {
    var _a;
    return {
      queueStats: this.chunkQueue.getStats(),
      processedChunks: this.processedChunks.size,
      totalDuration: this.resultCompiler.getTotalDuration(),
      segmentCount: this.resultCompiler.getSegmentCount(),
      transportMode: this.transportMode,
      liveSentChunks: this.liveSentChunkCount,
      liveAudioStats: ((_a = this.liveAudioSource) == null ? void 0 : _a.getStats()) || null
    };
  }
  abort(reason = "manual_abort") {
    this.acceptingChunks = false;
    this.isProcessing = false;
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.liveAdapter) {
      this.liveAdapter.abort(reason);
    }
    if (this.liveAudioSource) {
      this.liveAudioSource.abort();
    }
    void this.jobStore.updateJobStatus(this.logContext.jobId, "failed", reason);
    void RuntimeLogger.log(this.plugin, this.logContext, "job_abort", {
      status: "aborted",
      reason
    });
    this.cleanup();
  }
  cleanup() {
    this.chunkQueue.clear();
    this.resultCompiler.clear();
    this.processedChunks.clear();
    this.failedChunks.clear();
    this.lastChunkError = null;
    this.transportProfile = "native";
    this.consecutive400Errors = 0;
    this.isProcessing = false;
    this.acceptingChunks = true;
    this.abortController = null;
    this.processingPromise = null;
    this.liveAdapterStartPromise = null;
    this.liveAdapter = null;
    this.liveAudioSource = null;
    this.liveStarted = false;
    this.livePaused = false;
    this.liveSegmentIndex = 0;
    this.liveSentChunkCount = 0;
    this.liveFatalError = null;
    this.lastInterimText = null;
    this.lastInterimStartedAtSec = void 0;
    this.lastInterimTs = null;
    this.lastCommittedText = null;
    this.liveReconnectRequired = false;
    this.bufferedLiveFinals = [];
  }
  cleanupBlob(blob) {
    try {
      if (blob && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(blob);
      }
    } catch (e) {
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async prepareChunkPayload(chunk) {
    if (this.transportProfile === "wav_fallback") {
      const isNativeWav = (chunk.type || "").toLowerCase().includes("wav");
      if (isNativeWav) {
        const wav = chunk;
        return {
          arrayBuffer: await wav.arrayBuffer(),
          mimeType: "audio/wav",
          size: wav.size
        };
      }
      return {
        arrayBuffer: await chunk.arrayBuffer(),
        mimeType: chunk.type || "application/octet-stream",
        size: chunk.size
      };
    }
    return {
      arrayBuffer: await chunk.arrayBuffer(),
      mimeType: chunk.type || "application/octet-stream",
      size: chunk.size
    };
  }
  isQueuePaused() {
    if (this.transportMode === "deepgram_ws")
      return false;
    return this.chunkQueue.isPaused();
  }
  canAcceptChunks() {
    if (this.transportMode === "deepgram_ws")
      return this.acceptingChunks;
    return !this.chunkQueue.isPaused() && this.chunkQueue.canAcceptChunk(1);
  }
  getBackpressureState() {
    if (this.transportMode === "deepgram_ws") {
      return {
        paused: false,
        reason: null,
        queueSize: 0,
        maxQueueSize: 1,
        memoryPercent: 0
      };
    }
    return this.chunkQueue.getBackpressureState();
  }
  getLastChunkError() {
    return this.lastChunkError;
  }
  getMemoryUsage() {
    if (this.transportMode === "deepgram_ws")
      return 0;
    return this.chunkQueue.getMemoryUsage();
  }
  getRecoveryJobId() {
    return this.logContext.jobId;
  }
  async ensureRecoveryJob() {
    if (this.recoveryJobInitialized)
      return;
    const activeView = this.plugin.app.workspace.getActiveViewOfType(import_obsidian12.MarkdownView);
    const activeFile = activeView == null ? void 0 : activeView.file;
    if (!activeFile)
      return;
    let contextHash = "";
    try {
      const content = await this.plugin.app.vault.read(activeFile);
      contextHash = this.computeAnchorHash(content, activeView.editor.getCursor().line);
    } catch (e) {
      contextHash = "";
    }
    const now = new Date().toISOString();
    await this.jobStore.upsertJob({
      jobId: this.logContext.jobId,
      kind: "stream",
      status: "running",
      targetFile: activeFile.path,
      provider: this.plugin.settings.transcriptionProvider,
      model: this.plugin.settings.transcriptionModel,
      createdAt: now,
      updatedAt: now,
      insertionLine: activeView.editor.getCursor().line,
      insertionCh: activeView.editor.getCursor().ch,
      resumeAnchor: {
        line: activeView.editor.getCursor().line,
        ch: activeView.editor.getCursor().ch,
        contextHash
      }
    });
    this.recoveryJobInitialized = true;
  }
  computeAnchorHash(content, line) {
    const lines = content.split("\n");
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length - 1, line + 2);
    const context = lines.slice(start, end + 1).join("\n");
    let hash = 2166136261;
    for (let i = 0; i < context.length; i++) {
      hash ^= context.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }
  initializeLiveAdapter() {
    const adapter = new DeepgramLiveAdapter({
      settings: this.plugin.settings,
      model: this.plugin.settings.transcriptionModel || "nova-3"
    });
    adapter.onEvent((event) => {
      void this.handleLiveAdapterEvent(event);
    });
    this.liveAdapter = adapter;
  }
  async ensureLiveAdapterStarted() {
    var _a;
    if (!this.liveAdapter) {
      this.initializeLiveAdapter();
    }
    if ((_a = this.liveAdapter) == null ? void 0 : _a.isOpen())
      return;
    if (!this.liveAdapter) {
      throw new Error("Live adapter is not initialized");
    }
    if (!this.liveAdapterStartPromise) {
      this.liveAdapterStartPromise = this.liveAdapter.start();
    }
    try {
      await this.liveAdapterStartPromise;
    } finally {
      this.liveAdapterStartPromise = null;
    }
  }
  async handleLiveAdapterEvent(event) {
    if (event.type === "error") {
      this.liveFatalError = event.reason || "live_transport_error";
      this.lastChunkError = {
        chunkId: `live_seg_${this.liveSegmentIndex}`,
        message: this.liveFatalError || "live_transport_error"
      };
      await RuntimeLogger.log(this.plugin, this.logContext, "provider_failure", {
        status: "failed",
        reason: this.liveFatalError,
        mode: "deepgram_ws"
      });
      return;
    }
    if (event.type === "final") {
      if (this.isWithinLiveStabilizationWindow()) {
        this.bufferedLiveFinals.push({
          text: event.text,
          startedAtSec: event.startedAtSec,
          speakerTurns: event.speakerTurns,
          suppressSpeakerLabels: true
        });
      } else {
        await this.flushBufferedLiveFinals();
        await this.commitLiveFinalEvent(event.text, event.startedAtSec, event.speakerTurns);
      }
      this.lastInterimText = null;
      this.lastInterimStartedAtSec = void 0;
      this.lastInterimTs = null;
      return;
    }
    if (event.type === "interim") {
      const interim = this.formatInterimForFallback(event);
      this.lastInterimText = interim.text;
      this.lastInterimStartedAtSec = interim.startedAtSec;
      this.lastInterimTs = Date.now();
      await RuntimeLogger.log(this.plugin, this.logContext, "provider_response", {
        status: "interim",
        chunkId: `live_seg_${this.liveSegmentIndex}`,
        mode: "deepgram_ws",
        transcriptionChars: (event.text || "").length
      });
      return;
    }
    if (event.type === "closed") {
      this.liveReconnectRequired = true;
      const closeReason = event.reason || "closed";
      const isIdleTimeout = /net0001|did not receive audio data/i.test(closeReason);
      if (!this.livePaused && this.acceptingChunks && !isIdleTimeout) {
        this.liveFatalError = this.liveFatalError || `live_stream_closed:${closeReason}`;
        this.lastChunkError = {
          chunkId: `live_seg_${this.liveSegmentIndex}`,
          message: this.liveFatalError
        };
      }
      await RuntimeLogger.log(this.plugin, this.logContext, "provider_response", {
        status: "closed",
        mode: "deepgram_ws",
        reason: closeReason
      });
    }
  }
  buildChunkFromLiveFinal(text, startedAtSec) {
    const duration = this.estimateDurationMs(text);
    const startOffsetMs = typeof startedAtSec === "number" && Number.isFinite(startedAtSec) ? Math.max(0, Math.floor(startedAtSec * 1e3)) : this.resultCompiler.getTotalDuration();
    const metadata = {
      id: `live_seg_${this.liveSegmentIndex}`,
      index: this.liveSegmentIndex,
      duration,
      timestamp: this.liveSessionStartTs + startOffsetMs,
      size: 0
    };
    this.liveSegmentIndex += 1;
    return {
      metadata,
      transcript: text,
      processed: true
    };
  }
  estimateDurationMs(text) {
    const wordCount = text.split(/\s+/).map((t) => t.trim()).filter(Boolean).length;
    if (wordCount <= 0)
      return 1e3;
    return Math.min(1e4, Math.max(1e3, wordCount * 350));
  }
  async commitFinalTranscriptChunk(transcript, metadata) {
    const normalized = toRomanIfNeeded(
      (transcript || "").trim(),
      this.plugin.settings.forceRomanizedOutput
    );
    if (!normalized) {
      return;
    }
    const transcriptionChunk = {
      metadata,
      transcript: normalized,
      processed: true
    };
    this.resultCompiler.addSegment(transcriptionChunk);
    this.processedChunks.add(metadata.id);
    this.failedChunks.delete(metadata.index);
    this.lastCommittedText = normalized;
    await RuntimeLogger.log(this.plugin, this.logContext, "chunk_commit", {
      status: "committed",
      chunkId: metadata.id,
      chunkIndex: metadata.index
    });
    await this.jobStore.upsertCheckpoint({
      jobId: this.logContext.jobId,
      index: metadata.index,
      status: "committed",
      stage: "transcription_ready",
      chunkId: metadata.id,
      transcript: this.resultCompiler.getPartialResult(
        this.plugin.settings.includeTimestamps || false
      ),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (this.callbacks.onProgress) {
      const totalChunks = this.transportMode === "deepgram_ws" ? Math.max(this.liveSentChunkCount, this.processedChunks.size) : this.processedChunks.size + this.chunkQueue.size();
      this.callbacks.onProgress(this.processedChunks.size, totalChunks);
    }
    if (this.callbacks.onChunkCommitted) {
      const partial = this.resultCompiler.getPartialResult(
        this.plugin.settings.includeTimestamps || false
      );
      await this.callbacks.onChunkCommitted(normalized, metadata, partial);
    }
  }
  formatInterimForFallback(event) {
    if (!event.speakerTurns || event.speakerTurns.length === 0) {
      return {
        text: toRomanIfNeeded(
          this.normalizeSpeakerFormatting(event.text),
          this.plugin.settings.forceRomanizedOutput
        ),
        startedAtSec: event.startedAtSec
      };
    }
    const pieces = [];
    let start = event.startedAtSec;
    for (const turn of event.speakerTurns) {
      const formatted = this.formatSpeakerTurn(turn);
      if (!formatted)
        continue;
      pieces.push(formatted);
      if (typeof start !== "number" && typeof turn.startedAtSec === "number") {
        start = turn.startedAtSec;
      }
    }
    return {
      text: toRomanIfNeeded(
        pieces.join("\n"),
        this.plugin.settings.forceRomanizedOutput
      ),
      startedAtSec: start
    };
  }
  formatSpeakerTurn(turn) {
    const text = (turn.text || "").trim();
    if (!text)
      return "";
    const id = typeof turn.speakerId === "number" && Number.isFinite(turn.speakerId) ? Math.max(1, Math.floor(turn.speakerId)) : 0;
    const label = id > 0 ? `Speaker ${id}` : "Speaker";
    return `${label}: ${text}`;
  }
  isWithinLiveStabilizationWindow() {
    return Date.now() - this.liveSessionStartTs < StreamingTranscriptionService.LIVE_DIARIZATION_STABILIZATION_MS;
  }
  async flushBufferedLiveFinals() {
    if (this.bufferedLiveFinals.length === 0)
      return;
    const pending = this.bufferedLiveFinals.splice(0, this.bufferedLiveFinals.length);
    for (const item of pending) {
      await this.commitLiveFinalEvent(
        item.text,
        item.startedAtSec,
        item.speakerTurns,
        item.suppressSpeakerLabels === true
      );
    }
  }
  async commitLiveFinalEvent(text, startedAtSec, speakerTurns, suppressSpeakerLabels = false) {
    if (!suppressSpeakerLabels && speakerTurns && speakerTurns.length > 0) {
      for (const turn of speakerTurns) {
        const formatted = this.formatSpeakerTurn(turn);
        if (!formatted)
          continue;
        const chunk2 = this.buildChunkFromLiveFinal(formatted, turn.startedAtSec);
        await this.commitFinalTranscriptChunk(formatted, chunk2.metadata);
      }
      return;
    }
    const normalized = this.normalizeSpeakerFormatting(text);
    const chunk = this.buildChunkFromLiveFinal(normalized, startedAtSec);
    await this.commitFinalTranscriptChunk(normalized, chunk.metadata);
  }
  normalizeSpeakerFormatting(transcript) {
    const raw = (transcript || "").trim();
    if (!raw)
      return "";
    const speakerMatches = raw.match(/Speaker\s+\d+:/gi);
    if (!speakerMatches || speakerMatches.length < 2) {
      return raw;
    }
    let normalized = raw.replace(/\s*(Speaker\s+\d+:)/gi, "\n$1").trim();
    normalized = normalized.replace(/\n{3,}/g, "\n\n");
    return normalized;
  }
  async finishLiveTransport() {
    var _a;
    if (!this.liveAdapter)
      return;
    try {
      await this.flushBufferedLiveFinals();
      if ((_a = this.liveAudioSource) == null ? void 0 : _a.isRunning()) {
        await this.liveAudioSource.stop();
      }
      await this.ensureLiveAdapterStarted();
      await this.liveAdapter.stop();
      const tail = (this.lastInterimText || "").trim();
      if (tail.length >= 6 && tail !== this.lastCommittedText && this.lastInterimTs !== null && Date.now() - this.lastInterimTs < 15e3) {
        const chunk = this.buildChunkFromLiveFinal(tail, this.lastInterimStartedAtSec);
        await this.commitFinalTranscriptChunk(tail, chunk.metadata);
        await RuntimeLogger.log(this.plugin, this.logContext, "chunk_commit", {
          status: "committed",
          chunkId: chunk.metadata.id,
          chunkIndex: chunk.metadata.index,
          reason: "safe_tail_fallback"
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.liveFatalError = this.liveFatalError || reason;
      await RuntimeLogger.log(this.plugin, this.logContext, "job_abort", {
        status: "aborted",
        reason: `live_stop_failed:${reason}`
      });
      if (this.resultCompiler.getSegmentCount() === 0) {
        throw new Error(`Live transport failed: ${reason}`);
      }
    } finally {
      const elapsedMs = Math.max(0, Date.now() - this.liveSessionStartTs);
      this.resultCompiler.setDurationOverride(elapsedMs);
      this.liveStarted = false;
    }
  }
  buildFinalResult() {
    const includeTimestamps = this.transportMode === "deepgram_ws" ? true : this.plugin.settings.includeTimestamps || false;
    const finalResult = this.resultCompiler.getFinalResult(includeTimestamps, true);
    if (this.transportMode === "deepgram_ws" && this.liveFatalError) {
      if (!this.plugin.settings.allowPartialOnStreamFinalizeFailure) {
        throw new Error(`Streaming finalize failed: ${this.liveFatalError}`);
      }
      const prefix = finalResult.trim().length > 0 ? `${finalResult}

` : "";
      return `${prefix}> [!warning] NeuroVox Partial Result
> Live stream ended with provider error.
> Reason: ${this.liveFatalError}`;
    }
    if (this.failedChunks.size > 0) {
      const failed = Array.from(this.failedChunks.entries()).sort((a, b) => a[0] - b[0]).map(([index, reason]) => `${index}:${reason}`).join("; ");
      if (!this.plugin.settings.allowPartialOnStreamFinalizeFailure) {
        throw new Error(`Streaming finalize failed. Uncommitted chunks: ${failed}`);
      }
      const prefix = finalResult.trim().length > 0 ? `${finalResult}

` : "";
      return `${prefix}> [!warning] NeuroVox Partial Result
> Some live chunks failed and were omitted.
> Failed chunks: ${failed}`;
    }
    return finalResult;
  }
}
