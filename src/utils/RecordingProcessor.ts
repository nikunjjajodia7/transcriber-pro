import { Notice, TFile } from 'obsidian';
import { AudioProcessor } from './audio/AudioProcessor';
import { BackendBatchOrchestrationService } from './backend/BackendBatchOrchestrationService';
import { BatchRoutingPolicy } from './routing/BatchRoutingPolicy';
import { DocumentInserter } from './document/DocumentInserter';
import { JobStore } from './recovery/JobStore';
import { LocalQueueBackend } from './queue/LocalQueueBackend';
import { ProcessingState } from './state/ProcessingState';
import { RuntimeLogger } from './telemetry/RuntimeLogger';
import { TranscriptionService } from './transcription/TranscriptionService';
import { classifyError } from './retry/ErrorClassifier';

export class RecordingProcessor {
  plugin: any;
  config: any;
  processingState: any;
  audioProcessor: any;
  transcriptionService: any;
  documentInserter: any;
  jobStore: any;
  queueBackend: any;
  batchRoutingPolicy: any;
  backendBatchOrchestrationService: any;
  static instance: any = null;
  static ADAPTER_VALIDATION_TIMEOUT_MS = 4e3;
  static STALE_FAILED_JOB_MAX_AGE_MS = 10 * 60 * 1e3;

  constructor(plugin: any) {
    this.plugin = plugin;
    this.config = {
      maxRetries: 3,
      retryDelay: 1e3
    };
    this.processingState = new ProcessingState();
    this.audioProcessor = new AudioProcessor(plugin);
    this.transcriptionService = new TranscriptionService(plugin);
    this.documentInserter = new DocumentInserter(plugin);
    this.jobStore = new JobStore(plugin);
    this.queueBackend = new LocalQueueBackend(plugin);
    this.batchRoutingPolicy = new BatchRoutingPolicy(plugin.settings);
    this.backendBatchOrchestrationService = new BackendBatchOrchestrationService(plugin);
  }
  static getInstance(plugin: any) {
    var _a;
    return (_a = this.instance) != null ? _a : this.instance = new RecordingProcessor(plugin);
  }
  /**
   * Processes a recording: transcribes audio and inserts the content into the document
   */
  async processRecording(audioBlob: any, activeFile: any, cursorPosition: any, audioFilePath: any) {
    const logContext = RuntimeLogger.createContext("batch");
    const now = new Date().toISOString();
    const detectedSourceType = this.batchRoutingPolicy.detectSourceType(audioFilePath);
    if (detectedSourceType === "uploaded") {
      cursorPosition = await this.computeEndOfFilePosition(activeFile, cursorPosition);
    }
    const resumeAnchor = await this.createResumeAnchor(activeFile, cursorPosition);
    const baseJob = {
      jobId: logContext.jobId,
      kind: "batch",
      status: "running",
      sourceFile: audioFilePath,
      targetFile: activeFile.path,
      provider: this.plugin.settings.transcriptionProvider,
      model: this.plugin.settings.transcriptionModel,
      createdAt: now,
      updatedAt: now,
      insertionLine: cursorPosition.line,
      insertionCh: cursorPosition.ch,
      resumeAnchor
    };
    const workerId = "local_recording_processor";
    const leaseMs = 3e4;
    let queueJobId = null;
    let leaseToken = null;
    if (this.processingState.getIsProcessing()) {
      throw new Error("Recording is already in progress.");
    }
    try {
      this.processingState.reset();
      this.processingState.setIsProcessing(true);
      this.plugin.showProcessingStatus("Transcribing audio");
      await this.jobStore.upsertJob(baseJob);
      const payload = {
        recoveryJobId: logContext.jobId,
        sourceRef: audioFilePath,
        targetRef: activeFile.path,
        provider: this.plugin.settings.transcriptionProvider,
        model: this.plugin.settings.transcriptionModel,
        retryPolicy: {
          maxAttempts: this.config.maxRetries + 1,
          baseDelayMs: this.config.retryDelay
        }
      };
      const enqueued = await this.queueBackend.enqueue(payload);
      const claim = await this.queueBackend.claim(workerId, leaseMs, enqueued.id);
      if (!claim) {
        throw new Error("Could not claim queue job");
      }
      queueJobId = claim.job.id;
      leaseToken = claim.leaseToken;
      await this.jobStore.upsertJob({ ...baseJob, queueJobId });
      await this.queueBackend.heartbeat(queueJobId, workerId, leaseToken, leaseMs);
      await RuntimeLogger.log(this.plugin, logContext, "record_start", { status: "started" });
      this.processingState.startStep("Audio Processing");
      const audioResult = await this.audioProcessor.processAudio(audioBlob, audioFilePath);
      await this.jobStore.upsertCheckpoint({
        jobId: logContext.jobId,
        index: 0,
        status: "committed",
        stage: "audio_ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      this.processingState.completeStep();
      if (audioResult.processedChunks && audioResult.totalChunks) {
        this.processingState.updateProgress(
          audioResult.processedChunks,
          audioResult.totalChunks
        );
      }
      this.processingState.startStep("Transcription");
      await RuntimeLogger.log(this.plugin, logContext, "provider_request", {
        status: "started",
        mimeType: audioResult.audioBlob.type || "application/octet-stream",
        size: audioResult.audioBlob.size
      });
      const routeDecision = this.batchRoutingPolicy.decide(
        audioFilePath,
        audioResult.audioBlob.size
      );
      await RuntimeLogger.log(this.plugin, logContext, "batch_route_decision", {
        status: "selected",
        route: routeDecision.route,
        preferredRoute: routeDecision.preferredRoute,
        reason: routeDecision.reason,
        sourceType: routeDecision.sourceType,
        isLargeUpload: routeDecision.isLargeUpload
      });
      let result: any;
      if (routeDecision.route === "backend_batch") {
        try {
          this.plugin.showProcessingStatus("Routing large upload to backend workers");
          result = await this.backendBatchOrchestrationService.transcribeLargeUpload(
            audioResult.audioBlob,
            audioFilePath,
            activeFile.path,
            logContext
          );
        } catch (backendError) {
          const uploadedCloudOnly = routeDecision.sourceType === "uploaded";
          await RuntimeLogger.log(this.plugin, logContext, "backend_route_failure", {
            status: "failed",
            reason: backendError instanceof Error ? backendError.message : String(backendError),
            failOpenEnabled: this.plugin.settings.backendFailOpenToDirect,
            uploadedCloudOnly
          });
          if (uploadedCloudOnly || !this.plugin.settings.backendFailOpenToDirect) {
            throw backendError;
          }
          this.plugin.showProcessingStatus(
            "Backend route failed. Falling back to direct provider transcription."
          );
          const fallbackBuffer = await audioResult.audioBlob.arrayBuffer();
          result = await this.executeWithRetry(
            () => this.transcriptionService.transcribeContent(fallbackBuffer, {
              mimeType: audioResult.audioBlob.type
            }),
            0,
            {
              onRetry: async (attempt: any, error: any) => {
                this.plugin.showProcessingStatus(
                  `Retrying transcription ${attempt}/${this.config.maxRetries + 1}`
                );
                const classified = classifyError(error);
                await RuntimeLogger.log(this.plugin, logContext, "provider_retry", {
                  status: "retrying",
                  attempt,
                  maxAttempts: this.config.maxRetries + 1,
                  errorClass: classified.errorClass,
                  retryable: classified.retryable,
                  reason: error instanceof Error ? error.message : String(error)
                });
              },
              onFailed: async (attempts: any, error: any, classification: any) => {
                await RuntimeLogger.log(this.plugin, logContext, "provider_failure", {
                  status: "failed",
                  attempts,
                  errorClass: classification.errorClass,
                  retryable: classification.retryable,
                  reason: error instanceof Error ? error.message : String(error)
                });
              }
            }
          );
        }
      } else {
        if (routeDecision.sourceType === "uploaded") {
          throw new Error(
            "Uploaded audio must use backend cloud route. Direct provider route is disabled for uploads."
          );
        }
        if (routeDecision.isLargeUpload && routeDecision.preferredRoute !== routeDecision.route) {
          this.plugin.showProcessingStatus(
            "Large upload detected. Backend route unavailable, using direct provider mode."
          );
        }
        const audioBuffer = await audioResult.audioBlob.arrayBuffer();
        result = await this.executeWithRetry(
          () => this.transcriptionService.transcribeContent(audioBuffer, {
            mimeType: audioResult.audioBlob.type
          }),
          0,
          {
            onRetry: async (attempt: any, error: any) => {
              this.plugin.showProcessingStatus(
                `Retrying transcription ${attempt}/${this.config.maxRetries + 1}`
              );
              const classified = classifyError(error);
              await RuntimeLogger.log(this.plugin, logContext, "provider_retry", {
                status: "retrying",
                attempt,
                maxAttempts: this.config.maxRetries + 1,
                errorClass: classified.errorClass,
                retryable: classified.retryable,
                reason: error instanceof Error ? error.message : String(error)
              });
            },
            onFailed: async (attempts: any, error: any, classification: any) => {
              await RuntimeLogger.log(this.plugin, logContext, "provider_failure", {
                status: "failed",
                attempts,
                errorClass: classification.errorClass,
                retryable: classification.retryable,
                reason: error instanceof Error ? error.message : String(error)
              });
            }
          }
        );
      }
      if (this.plugin.settings.generatePostProcessing && !result.postProcessing) {
        this.processingState.startStep("Post-processing");
        await RuntimeLogger.log(this.plugin, logContext, "post_processing_fallback", {
          status: "started"
        });
        try {
          const generated = await this.executeWithRetry(
            () => this.generatePostProcessing(result.transcription)
          );
          result = { ...result, postProcessing: generated };
          await RuntimeLogger.log(this.plugin, logContext, "post_processing_fallback", {
            status: "success"
          });
          this.processingState.completeStep();
        } catch (postProcessingError) {
          await RuntimeLogger.log(this.plugin, logContext, "post_processing_failure", {
            status: "failed",
            reason: postProcessingError instanceof Error ? postProcessingError.message : String(postProcessingError)
          });
          await RuntimeLogger.log(this.plugin, logContext, "post_processing_fallback", {
            status: "failed",
            reason: postProcessingError instanceof Error ? postProcessingError.message : String(postProcessingError)
          });
          this.processingState.completeStep();
        }
      }
      await RuntimeLogger.log(this.plugin, logContext, "provider_response", {
        status: "success",
        transcriptionChars: result.transcription.length
      });
      if (queueJobId && leaseToken) {
        await this.queueBackend.heartbeat(queueJobId, workerId, leaseToken, leaseMs);
      }
      await this.jobStore.upsertCheckpoint({
        jobId: logContext.jobId,
        index: 1,
        status: "committed",
        stage: "transcription_ready",
        transcript: result.transcription,
        postProcessing: result.postProcessing,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      this.processingState.completeStep();
      this.processingState.startStep("Content Insertion");
      this.plugin.showProcessingStatus("Writing transcript note");
      await RuntimeLogger.log(this.plugin, logContext, "note_render_start", { status: "started" });
      await this.documentInserter.insertContent(
        {
          transcription: result.transcription,
          postProcessing: result.postProcessing,
          audioFilePath: audioResult.finalPath,
          sourceSizeMb: (audioResult.audioBlob.size / (1024 * 1024)).toFixed(2),
          entryTitle: this.buildDurationEntryTitle(
            await this.resolveDurationSeconds(audioResult.audioBlob, result.transcription)
          ) || void 0
        },
        activeFile,
        cursorPosition
      );
      await RuntimeLogger.log(this.plugin, logContext, "note_render_commit", { status: "success" });
      await this.jobStore.upsertCheckpoint({
        jobId: logContext.jobId,
        index: 2,
        status: "committed",
        stage: "note_written",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      this.processingState.completeStep();
      await RuntimeLogger.log(this.plugin, logContext, "job_complete", { status: "completed" });
      await this.jobStore.updateJobStatus(logContext.jobId, "completed");
      if (queueJobId && leaseToken) {
        await this.queueBackend.complete(queueJobId, workerId, leaseToken, activeFile.path);
      }
      this.plugin.setProcessingStatus("Idle");
    } catch (error) {
      const primaryError = error;
      this.handleError("Processing failed", error);
      this.processingState.setError(error);
      this.plugin.setProcessingStatus("Failed");
      await RuntimeLogger.log(this.plugin, logContext, "job_failed", {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
      await this.jobStore.updateJobStatus(
        logContext.jobId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
      if (queueJobId && leaseToken) {
        try {
          await this.queueBackend.fail(
            queueJobId,
            workerId,
            leaseToken,
            error instanceof Error ? error.message : String(error)
          );
        } catch (queueFailError) {
          await RuntimeLogger.log(this.plugin, logContext, "queue_fail_record_error", {
            status: "failed",
            reason: queueFailError instanceof Error ? queueFailError.message : String(queueFailError)
          });
        }
      }
      throw primaryError;
    } finally {
      this.processingState.setIsProcessing(false);
      await RuntimeLogger.log(this.plugin, logContext, "record_stop", { status: "stopped" });
    }
  }
  async getIncompleteJobs() {
    return this.jobStore.getIncompleteJobs();
  }
  async runStartupMaintenance() {
    await this.jobStore.demoteStaleFailedToCanceled(
      RecordingProcessor.STALE_FAILED_JOB_MAX_AGE_MS
    );
    await this.jobStore.prune();
    await this.queueBackend.prune();
    await this.reconcileQueueAndRecoveryStates();
  }
  async cancelJob(jobId: any) {
    await this.jobStore.updateJobStatus(jobId, "canceled");
  }
  async resumeJob(jobId: any) {
    var _a, _b;
    const job = await this.jobStore.getJob(jobId);
    if (!job || !job.targetFile)
      return false;
    const ready = await this.jobStore.getLatestCommittedCheckpoint(jobId, "transcription_ready");
    const written = await this.jobStore.getLatestCommittedCheckpoint(jobId, "note_written");
    if (!ready || written || !ready.transcript)
      return false;
    const target = this.plugin.app.vault.getAbstractFileByPath(job.targetFile);
    if (!(target instanceof TFile))
      return false;
    let line = typeof job.insertionLine === "number" ? job.insertionLine : 0;
    let ch = typeof job.insertionCh === "number" ? job.insertionCh : 0;
    const anchorValid = await this.isResumeAnchorValid(target, job);
    if (!anchorValid) {
      const targetContent = await this.plugin.app.vault.read(target);
      const lines = targetContent.split("\n");
      line = Math.max(0, lines.length - 1);
      ch = (_b = (_a = lines[line]) == null ? void 0 : _a.length) != null ? _b : 0;
      new Notice("NeuroVox recovered transcript inserted at end of note because the original cursor anchor changed.");
    }
    await this.documentInserter.insertContent(
      {
        transcription: ready.transcript,
        postProcessing: ready.postProcessing,
        audioFilePath: job.sourceFile
      },
      target,
      { line, ch }
    );
    await this.jobStore.upsertCheckpoint({
      jobId,
      index: 2,
      status: "committed",
      stage: "note_written",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await this.jobStore.updateJobStatus(jobId, "completed");
    return true;
  }
  /**
   * Processes a streaming transcription result: inserts pre-transcribed content into the document
   */
  async processStreamingResult(transcriptionResult: any, activeFile: any, cursorPosition: any, options: any) {
    const logContext = RuntimeLogger.createContext("stream");
    const existingStreamJob = await this.jobStore.getLatestIncompleteJob("stream", activeFile.path);
    const recoveryJobId = (existingStreamJob == null ? void 0 : existingStreamJob.jobId) || logContext.jobId;
    const now = new Date().toISOString();
    const resumeAnchor = await this.createResumeAnchor(activeFile, cursorPosition);
    const baseJob = {
      jobId: recoveryJobId,
      kind: "stream",
      status: "running",
      targetFile: activeFile.path,
      provider: this.plugin.settings.transcriptionProvider,
      model: this.plugin.settings.transcriptionModel,
      createdAt: now,
      updatedAt: now,
      insertionLine: cursorPosition.line,
      insertionCh: cursorPosition.ch,
      resumeAnchor
    };
    if (this.processingState.getIsProcessing()) {
      throw new Error("Recording is already in progress.");
    }
    try {
      this.processingState.reset();
      this.processingState.setIsProcessing(true);
      this.plugin.showProcessingStatus("Processing streaming transcript");
      await this.jobStore.upsertJob(baseJob);
      await RuntimeLogger.log(this.plugin, logContext, "record_start", { status: "started" });
      this.processingState.startStep("Content Processing");
      let postProcessing;
      if (this.plugin.settings.generatePostProcessing) {
        this.processingState.startStep("Post-processing");
        postProcessing = await this.executeWithRetry(
          () => this.generatePostProcessing(transcriptionResult)
        );
        this.processingState.completeStep();
      }
      let savedAudioPath = options == null ? void 0 : options.audioFilePath;
      if (options == null ? void 0 : options.audioBlob) {
        try {
          const processedAudio = await this.audioProcessor.processAudio(
            options.audioBlob,
            options.audioFilePath
          );
          savedAudioPath = processedAudio.finalPath;
        } catch (saveError) {
          const reason = saveError instanceof Error ? saveError.message : String(saveError);
          new Notice(`NeuroVox: transcript saved, but audio file save failed (${reason})`);
          await RuntimeLogger.log(this.plugin, logContext, "provider_failure", {
            status: "failed",
            reason: `live_audio_save_failed:${reason}`
          });
        }
      }
      await this.jobStore.upsertCheckpoint({
        jobId: recoveryJobId,
        index: 1,
        status: "committed",
        stage: "transcription_ready",
        transcript: transcriptionResult,
        postProcessing,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      this.processingState.startStep("Content Insertion");
      await this.documentInserter.removeAllLiveTranscriptionBlocks(activeFile);
      await RuntimeLogger.log(this.plugin, logContext, "note_render_start", { status: "started" });
      await this.documentInserter.insertContent(
        {
          transcription: transcriptionResult,
          postProcessing,
          audioFilePath: savedAudioPath,
          sourceSizeMb: (options == null ? void 0 : options.audioBlob) ? (options.audioBlob.size / (1024 * 1024)).toFixed(2) : void 0,
          entryTitle: this.buildDurationEntryTitle(
            await this.resolveDurationSeconds(
              options == null ? void 0 : options.audioBlob,
              transcriptionResult,
              options == null ? void 0 : options.durationSeconds
            )
          ) || void 0
        },
        activeFile,
        cursorPosition
      );
      if (savedAudioPath) {
        new Notice(`NeuroVox: recording saved to ${savedAudioPath}`);
      }
      await RuntimeLogger.log(this.plugin, logContext, "note_render_commit", { status: "success" });
      await this.jobStore.upsertCheckpoint({
        jobId: recoveryJobId,
        index: 2,
        status: "committed",
        stage: "note_written",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      this.processingState.completeStep();
      await RuntimeLogger.log(this.plugin, logContext, "job_complete", { status: "completed" });
      await this.jobStore.updateJobStatus(recoveryJobId, "completed");
      this.plugin.setProcessingStatus("Idle");
    } catch (error) {
      this.handleError("Processing failed", error);
      this.processingState.setError(error);
      this.plugin.setProcessingStatus("Failed");
      await RuntimeLogger.log(this.plugin, logContext, "job_failed", {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
      await this.jobStore.updateJobStatus(
        recoveryJobId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      this.processingState.setIsProcessing(false);
      await RuntimeLogger.log(this.plugin, logContext, "record_stop", { status: "stopped" });
    }
  }
  /**
   * Generates post-processing content using the configured AI adapter
   */
  async generatePostProcessing(transcription: any) {
    const adapter = await this.getAdapter(
      this.plugin.settings.postProcessingProvider,
      "language"
    );
    const prompt = `${this.plugin.settings.postProcessingPrompt}

${transcription}`;
    return adapter.generateResponse(
      prompt,
      this.plugin.settings.postProcessingModel,
      {
        maxTokens: this.plugin.settings.postProcessingMaxTokens,
        temperature: this.plugin.settings.postProcessingTemperature
      }
    );
  }
  /**
   * Gets and validates the appropriate AI adapter
   */
  async getAdapter(provider: any, category: any) {
    const adapter = this.plugin.aiAdapters.get(provider);
    if (!adapter) {
      throw new Error(`${provider} adapter not found`);
    }
    if (!adapter.isReady(category)) {
      const apiKey = adapter.getApiKey();
      if (!apiKey) {
        throw new Error(`${provider} API key is not configured`);
      }
      const validated = await this.validateAdapterWithTimeout(adapter);
      if (validated && adapter.isReady(category)) {
        return adapter;
      }
      throw new Error(
        `${provider} adapter is not ready for ${category}. Please check your settings and model availability.`
      );
    }
    return adapter;
  }
  async validateAdapterWithTimeout(adapter: any) {
    const timeoutMs = RecordingProcessor.ADAPTER_VALIDATION_TIMEOUT_MS;
    return await Promise.race([
      adapter.validateApiKey().catch(() => false),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  }
  /**
   * Executes an operation with retry logic
   */
  async executeWithRetry(operation: any, retryCount = 0, hooks?: any): Promise<any> {
    try {
      return await operation();
    } catch (error) {
      const classification = classifyError(error);
      const unknownRetryable = classification.errorClass === "unknown" && retryCount < 1;
      const retryAllowed = (classification.retryable || unknownRetryable) && retryCount < this.config.maxRetries;
      if (retryAllowed) {
        const delay = this.getRetryDelayMs(classification.errorClass, retryCount + 1);
        if (hooks == null ? void 0 : hooks.onRetry) {
          await hooks.onRetry(retryCount + 1, error, classification, delay);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeWithRetry(operation, retryCount + 1, hooks);
      }
      if (hooks == null ? void 0 : hooks.onFailed) {
        await hooks.onFailed(retryCount + 1, error, classification);
      }
      throw error;
    }
  }
  getRetryDelayMs(errorClass: any, attempt: any) {
    const base = this.config.retryDelay;
    const multiplier = errorClass === "rate_limit" ? 2.5 : errorClass === "timeout" ? 2 : errorClass === "server" ? 1.8 : errorClass === "network" ? 1.6 : 1.5;
    const delay = Math.round(base * Math.pow(multiplier, Math.max(0, attempt - 1)));
    return Math.min(delay, 3e4);
  }
  /**
   * Handles error display
   */
  handleError(context: any, error: any) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    new Notice(`${context}: ${message}`);
  }
  async resolveDurationSeconds(audioBlob: any, transcription: any, preferredSeconds?: any) {
    if (Number.isFinite(preferredSeconds) && Number(preferredSeconds) > 0) {
      return Math.max(1, Math.round(Number(preferredSeconds)));
    }
    const decoded = await this.estimateAudioDurationFromBlob(audioBlob);
    if (decoded !== null)
      return decoded;
    const tokenMax = this.estimateDurationFromTimestampTokens(transcription);
    if (tokenMax !== null)
      return tokenMax;
    return null;
  }
  async estimateAudioDurationFromBlob(audioBlob: any) {
    if (!audioBlob || audioBlob.size <= 0)
      return null;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor)
      return null;
    let audioContext = null;
    try {
      const ctx = new AudioContextCtor();
      audioContext = ctx;
      const source = await audioBlob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(source.slice(0));
      const seconds = Number((decoded == null ? void 0 : decoded.duration) || 0);
      if (!Number.isFinite(seconds) || seconds <= 0)
        return null;
      return Math.max(1, Math.round(seconds));
    } catch (e) {
      return null;
    } finally {
      if (audioContext) {
        try {
          await audioContext.close();
        } catch (e) {
        }
      }
    }
  }
  estimateDurationFromTimestampTokens(transcription: any) {
    if (!transcription || typeof transcription !== "string")
      return null;
    const tokenRegex = /\[(\d{2}):(\d{2}):(\d{2})\]/g;
    let max = -1;
    let match = tokenRegex.exec(transcription);
    while (match) {
      const hh = Number(match[1]);
      const mm = Number(match[2]);
      const ss = Number(match[3]);
      if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss)) {
        max = Math.max(max, hh * 3600 + mm * 60 + ss);
      }
      match = tokenRegex.exec(transcription);
    }
    return max >= 0 ? max : null;
  }
  buildDurationEntryTitle(durationSeconds: any) {
    if (!Number.isFinite(durationSeconds) || Number(durationSeconds) <= 0)
      return null;
    const total = Math.max(1, Math.round(Number(durationSeconds)));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor(total % 3600 / 60);
    const ss = total % 60;
    const timeLabel = hh > 0 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    return `Transcription - ${timeLabel}`;
  }
  async reconcileQueueAndRecoveryStates() {
    const [jobs, queueSnapshot] = await Promise.all([
      this.jobStore.getIncompleteJobs(),
      this.queueBackend.getSnapshot()
    ]);
    const queueById = new Map<any, any>(queueSnapshot.map((q: any): [any, any] => [q.id, q]));
    const queueByRecoveryId = new Map<any, any>(
      queueSnapshot.filter((q: any) => !!q.payload.recoveryJobId).map((q: any): [any, any] => [q.payload.recoveryJobId, q])
    );
    for (const job of jobs) {
      const queueJob = (job.queueJobId ? queueById.get(job.queueJobId) : void 0) || queueByRecoveryId.get(job.jobId);
      if (!queueJob && job.kind === "batch" && job.status === "running") {
        await this.jobStore.updateJobStatus(
          job.jobId,
          "failed",
          "startup_reconcile_missing_queue_job"
        );
        continue;
      }
      if (!queueJob)
        continue;
      if ((queueJob.status === "failed" || queueJob.status === "canceled") && job.status === "running") {
        await this.jobStore.updateJobStatus(
          job.jobId,
          "failed",
          queueJob.reason || `queue_${queueJob.status}`
        );
      }
    }
  }
  async computeEndOfFilePosition(activeFile: any, fallback: any) {
    var _a, _b;
    try {
      const content = await this.plugin.app.vault.read(activeFile);
      if (!content) {
        return fallback;
      }
      const lines = content.split("\n");
      const line = Math.max(0, lines.length - 1);
      const ch = (_b = (_a = lines[line]) == null ? void 0 : _a.length) != null ? _b : 0;
      return { line, ch };
    } catch (e) {
      return fallback;
    }
  }
  async createResumeAnchor(file: any, position: any) {
    try {
      const content = await this.plugin.app.vault.read(file);
      return {
        line: position.line,
        ch: position.ch,
        contextHash: this.computeAnchorHash(content, position.line)
      };
    } catch (e) {
      return void 0;
    }
  }
  async isResumeAnchorValid(file: any, job: any) {
    if (!job.resumeAnchor)
      return true;
    try {
      const content = await this.plugin.app.vault.read(file);
      const currentHash = this.computeAnchorHash(content, job.resumeAnchor.line);
      return currentHash === job.resumeAnchor.contextHash;
    } catch (e) {
      return false;
    }
  }
  computeAnchorHash(content: any, line: any) {
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
}
