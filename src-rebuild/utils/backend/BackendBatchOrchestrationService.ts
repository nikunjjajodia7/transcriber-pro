import { requestUrl } from 'obsidian';
import { RuntimeLogger } from '../telemetry/RuntimeLogger';
import { clampMonotonicUiState, formatUiStateLabel, mapBackendToUiState } from './BackendStatusMapper';
import { isCompletedStatus, isFailedTerminalStatus } from './BackendCompletionGate';

function validateBackendUrl(candidateUrl, backendBaseUrl) {
  try {
    const candidateOrigin = new URL(candidateUrl).origin;
    const baseOrigin = new URL(backendBaseUrl).origin;
    if (candidateOrigin !== baseOrigin) {
      throw new Error(`Backend returned URL with unexpected origin: ${candidateOrigin} (expected ${baseOrigin})`);
    }
  } catch (e) {
    if (e.message.includes("unexpected origin")) throw e;
    throw new Error(`Backend returned invalid URL: ${candidateUrl}`);
  }
}
export class BackendBatchOrchestrationService {
  static CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

  constructor(plugin) {
    this.plugin = plugin;
  }
  async transcribeLargeUpload(audioBlob, sourcePath, targetPath, logContext) {
    const baseUrl = this.plugin.settings.backendBaseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Backend base URL is not configured.");
    }
    const createUrl = `${baseUrl}/api/v1/transcription/jobs`;
    const createBody = {
      sourceRef: sourcePath || null,
      targetRef: targetPath,
      provider: this.plugin.settings.transcriptionProvider,
      model: this.plugin.settings.transcriptionModel,
      mimeType: audioBlob.type || "application/octet-stream",
      size: audioBlob.size,
      options: {
        deepgramDetectLanguage: this.plugin.settings.deepgramDetectLanguage,
        deepgramLanguageHints: this.plugin.settings.deepgramLanguageHints,
        enableSpeakerDiarization: this.plugin.settings.enableSpeakerDiarization,
        forceRomanizedOutput: this.plugin.settings.forceRomanizedOutput
      }
    };
    await RuntimeLogger.log(this.plugin, logContext, "backend_job_create", {
      status: "started",
      url: createUrl
    });
    const created = await this.requestJson(createUrl, "POST", createBody);
    const jobId = (created.jobId || created.id || "").trim();
    if (!jobId) {
      throw new Error("Backend create job response missing job id.");
    }
    await RuntimeLogger.log(this.plugin, logContext, "backend_job_create", {
      status: "success",
      backendJobId: jobId
    });
    const uploadUrl = (created.uploadUrl || `${createUrl}/${encodeURIComponent(jobId)}/source`).trim();
    const statusUrl = (created.statusUrl || `${createUrl}/${encodeURIComponent(jobId)}`).trim();
    const startUrl = `${createUrl}/${encodeURIComponent(jobId)}/start`;
    validateBackendUrl(statusUrl, baseUrl);
    validateBackendUrl(startUrl, baseUrl);
    await this.uploadSource(uploadUrl, audioBlob, logContext, jobId);
    if (created.started !== true) {
      await RuntimeLogger.log(this.plugin, logContext, "backend_job_start", {
        status: "started",
        backendJobId: jobId,
        url: startUrl
      });
      await this.requestJson(startUrl, "POST", {});
      await RuntimeLogger.log(this.plugin, logContext, "backend_job_start", {
        status: "success",
        backendJobId: jobId
      });
    }
    const result = await this.pollForResult(statusUrl, created.resultUrl, jobId, logContext);
    return result;
  }
  async uploadSource(uploadUrl, audioBlob, logContext, backendJobId) {
    await RuntimeLogger.log(this.plugin, logContext, "backend_source_upload", {
      status: "started",
      backendJobId,
      size: audioBlob.size,
      mimeType: audioBlob.type || "application/octet-stream"
    });
    this.plugin.showProcessingStatus("Uploading source audio to backend");
    const totalChunks = Math.max(
      1,
      Math.ceil(audioBlob.size / BackendBatchOrchestrationService.CHUNK_SIZE_BYTES)
    );
    const mimeType = audioBlob.type || "application/octet-stream";
    if (totalChunks === 1) {
      const body = await audioBlob.arrayBuffer();
      await (0, requestUrl)({
        url: uploadUrl,
        method: "PUT",
        headers: this.buildHeaders({
          "Content-Type": mimeType
        }),
        body,
        throw: true
      });
    } else {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * BackendBatchOrchestrationService.CHUNK_SIZE_BYTES;
        const end = Math.min(
          audioBlob.size,
          start + BackendBatchOrchestrationService.CHUNK_SIZE_BYTES
        );
        const chunk = audioBlob.slice(start, end, mimeType);
        const chunkBody = await chunk.arrayBuffer();
        const isFinalChunk = chunkIndex === totalChunks - 1;
        this.plugin.showProcessingStatus(
          `Uploading source audio to backend (${chunkIndex + 1}/${totalChunks})`
        );
        await (0, requestUrl)({
          url: uploadUrl,
          method: "PUT",
          headers: this.buildHeaders({
            "Content-Type": mimeType,
            "X-NeuroVox-Chunk-Index": String(chunkIndex),
            "X-NeuroVox-Chunk-Total": String(totalChunks),
            "X-NeuroVox-Chunk-Final": isFinalChunk ? "true" : "false"
          }),
          body: chunkBody,
          throw: true
        });
      }
    }
    await RuntimeLogger.log(this.plugin, logContext, "backend_source_upload", {
      status: "success",
      backendJobId,
      chunkCount: totalChunks
    });
  }
  async pollForResult(statusUrl, defaultResultUrl, backendJobId, logContext) {
    const timeoutMs = this.plugin.settings.backendJobTimeoutSec * 1e3;
    const pollMs = this.plugin.settings.backendPollIntervalMs;
    const startedAt = Date.now();
    let lastUiState = null;
    let consecutiveErrors = 0;
    let currentPollMs = pollMs;
    while (Date.now() - startedAt < timeoutMs) {
      let status;
      try {
        status = await this.requestJson(statusUrl, "GET");
        consecutiveErrors = 0;
      } catch (pollError) {
        consecutiveErrors += 1;
        console.warn(`[NeuroVox] Poll request failed (${consecutiveErrors}/5):`, pollError);
        if (consecutiveErrors >= 5) {
          throw new Error(`Backend poll failed 5 consecutive times. Last error: ${pollError instanceof Error ? pollError.message : String(pollError)}`);
        }
        await this.sleep(currentPollMs);
        currentPollMs = Math.min(currentPollMs * 1.5, pollMs * 4);
        continue;
      }
      const normalized = (status.status || "").toLowerCase();
      const stage = status.stage || normalized || "processing";
      const rawUiState = mapBackendToUiState(status.status, status.stage);
      const uiState = clampMonotonicUiState(lastUiState, rawUiState);
      if (uiState !== lastUiState) {
        currentPollMs = pollMs;
      }
      lastUiState = uiState;
      this.plugin.showProcessingStatus(`Backend: ${formatUiStateLabel(uiState)}`);
      await RuntimeLogger.log(this.plugin, logContext, "backend_job_poll", {
        status: "started",
        backendJobId,
        stage,
        uiState,
        progress: typeof status.progress === "number" ? status.progress : void 0
      });
      if (isCompletedStatus(normalized)) {
        const inlineTranscript = (status.transcription || "").trim();
        if (inlineTranscript.length > 0) {
          await RuntimeLogger.log(this.plugin, logContext, "backend_job_complete", {
            status: "success",
            backendJobId,
            transcriptionChars: inlineTranscript.length
          });
          return {
            transcription: inlineTranscript,
            postProcessing: status.postProcessing
          };
        }
        const resultUrl = (status.resultUrl || defaultResultUrl || "").trim();
        if (!resultUrl) {
          throw new Error("Backend job completed but no result payload was provided.");
        }
        const result = await this.requestJson(resultUrl, "GET");
        const transcript = (result.transcription || "").trim();
        if (!transcript) {
          throw new Error("Backend result payload missing transcription text.");
        }
        await RuntimeLogger.log(this.plugin, logContext, "backend_job_complete", {
          status: "success",
          backendJobId,
          transcriptionChars: transcript.length
        });
        return {
          transcription: transcript,
          postProcessing: result.postProcessing
        };
      }
      if (isFailedTerminalStatus(normalized)) {
        const message = status.message || `Backend job ended with status "${normalized}"`;
        await RuntimeLogger.log(this.plugin, logContext, "backend_job_complete", {
          status: "failed",
          backendJobId,
          reason: message
        });
        throw new Error(message);
      }
      await this.sleep(currentPollMs);
      currentPollMs = Math.min(currentPollMs * 1.5, pollMs * 4);
    }
    throw new Error(
      `Backend job timed out after ${this.plugin.settings.backendJobTimeoutSec}s`
    );
  }
  async requestJson(url, method, body) {
    const response = await (0, requestUrl)({
      url,
      method,
      headers: this.buildHeaders({
        "Content-Type": "application/json"
      }),
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      throw: true
    });
    if (!response.json) {
      throw new Error(`Backend returned invalid JSON response for ${method} ${url}`);
    }
    return response.json;
  }
  buildHeaders(extra) {
    const headers = { ...extra };
    const token = this.plugin.settings.backendApiKey.trim();
    if (token.length > 0) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
