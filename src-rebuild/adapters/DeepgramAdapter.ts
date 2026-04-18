var import_obsidian20 = require("obsidian");
class DeepgramAdapter extends AIAdapter {
  static MIN_TIMEOUT_MS = 18e4;
  static MAX_TIMEOUT_MS = 18e5;
  static TIMEOUT_PER_MB_MS = 8e3;

  constructor(settings) {
    super(settings, "deepgram" /* Deepgram */);
    this.apiKey = "";
  }
  getApiKey() {
    return this.apiKey;
  }
  setApiKeyInternal(key) {
    this.apiKey = key;
  }
  getApiBaseUrl() {
    return "https://api.deepgram.com";
  }
  getTextGenerationEndpoint() {
    return "";
  }
  getTranscriptionEndpoint() {
    return "/v1/listen";
  }
  async validateApiKeyImpl() {
    if (!this.apiKey) {
      return false;
    }
    try {
      const response = await this.makeAPIRequest(
        `${this.getApiBaseUrl()}/v1/projects`,
        "GET",
        {},
        null
      );
      return response && Array.isArray(response.projects);
    } catch (error) {
      return false;
    }
  }
  parseTextGenerationResponse(response) {
    throw new Error("Text generation not supported by Deepgram");
  }
  parseTranscriptionResponse(response) {
    return this.parseTranscriptionResponseWithOptions(response, false);
  }
  parseTranscriptionResponseWithOptions(response, allowEmptyTranscription) {
    var _a, _b, _c, _d, _e, _f;
    let transcript = "";
    if (this.settings.enableSpeakerDiarization) {
      const utterances = (_a = response == null ? void 0 : response.results) == null ? void 0 : _a.utterances;
      if (Array.isArray(utterances) && utterances.length > 0) {
        transcript = this.formatDiarizedTranscript(utterances);
      }
    }
    if (!transcript && ((_f = (_e = (_d = (_c = (_b = response == null ? void 0 : response.results) == null ? void 0 : _b.channels) == null ? void 0 : _c[0]) == null ? void 0 : _d.alternatives) == null ? void 0 : _e[0]) == null ? void 0 : _f.transcript)) {
      transcript = response.results.channels[0].alternatives[0].transcript;
    }
    if (!transcript) {
      if (allowEmptyTranscription) {
        return "";
      }
      throw new Error("Invalid transcription response format from Deepgram");
    }
    transcript = this.normalizeSpeakerFormatting(transcript);
    if (this.settings.forceRomanizedOutput) {
      transcript = toRomanIfNeeded(transcript, true);
    }
    return transcript;
  }
  // Override the transcribeAudio method since Deepgram has a different API structure
  async transcribeAudio(audioArrayBuffer, model, options) {
    var _a;
    try {
      const query = new URLSearchParams({
        model,
        punctuate: "true",
        smart_format: "true"
      });
      this.applyLanguageSettings(query, model);
      if (this.settings.enableSpeakerDiarization) {
        query.set("diarize", "true");
        query.set("utterances", "true");
      }
      const endpoint = `${this.getApiBaseUrl()}${this.getTranscriptionEndpoint()}?${query.toString()}`;
      const contentType = ((_a = options == null ? void 0 : options.mimeType) == null ? void 0 : _a.trim()) || "application/octet-stream";
      const timeoutMs = this.calculateTimeoutMs(audioArrayBuffer.byteLength);
      const response = await this.requestWithTimeout(
        endpoint,
        {
          "Content-Type": contentType
        },
        audioArrayBuffer,
        timeoutMs
      );
      const transcript = this.parseTranscriptionResponseWithOptions(
        response,
        (options == null ? void 0 : options.allowEmptyTranscription) === true
      );
      if (!(options == null ? void 0 : options.allowEmptyTranscription) && (!transcript || !transcript.trim())) {
        throw new Error("Deepgram returned an empty transcript");
      }
      return transcript;
    } catch (error) {
      const message = this.getDeepgramErrorMessage(error);
      throw new Error(`Failed to transcribe audio with Deepgram: ${message}`);
    }
  }
  async diagnoseAudio(audioArrayBuffer, model, options) {
    var _a, _b, _c, _d, _e, _f;
    const query = new URLSearchParams({
      model,
      punctuate: "true",
      smart_format: "true"
    });
    this.applyLanguageSettings(query, model);
    if (this.settings.enableSpeakerDiarization) {
      query.set("diarize", "true");
      query.set("utterances", "true");
    }
    const endpoint = `${this.getApiBaseUrl()}${this.getTranscriptionEndpoint()}?${query.toString()}`;
    const contentType = ((_a = options == null ? void 0 : options.mimeType) == null ? void 0 : _a.trim()) || "application/octet-stream";
    const timeoutMs = this.calculateTimeoutMs(audioArrayBuffer.byteLength);
    const response = await this.requestWithTimeout(
      endpoint,
      { "Content-Type": contentType },
      audioArrayBuffer,
      timeoutMs
    );
    const utterances = Array.isArray((_b = response == null ? void 0 : response.results) == null ? void 0 : _b.utterances) ? response.results.utterances : [];
    const channel = (_d = (_c = response == null ? void 0 : response.results) == null ? void 0 : _c.channels) == null ? void 0 : _d[0];
    const alternatives = Array.isArray(channel == null ? void 0 : channel.alternatives) ? channel.alternatives : [];
    const transcript = (typeof ((_e = alternatives == null ? void 0 : alternatives[0]) == null ? void 0 : _e.transcript) === "string" ? alternatives[0].transcript : "") || "";
    const speakerTagCount = (transcript.match(/Speaker\s+\d+:/g) || []).length;
    const diarizeRequested = this.settings.enableSpeakerDiarization;
    const fallbackPathUsed = diarizeRequested && utterances.length === 0 && transcript.length > 0;
    return {
      endpoint,
      requestParams: Object.fromEntries(query.entries()),
      utterancesPresent: utterances.length > 0,
      utterancesCount: utterances.length,
      channelsCount: Array.isArray((_f = response == null ? void 0 : response.results) == null ? void 0 : _f.channels) ? response.results.channels.length : 0,
      alternativesCount: alternatives.length,
      transcriptLength: transcript.length,
      speakerTagCountInTranscript: speakerTagCount,
      diarizeRequested,
      fallbackPathUsed,
      detectedLanguage: (channel == null ? void 0 : channel.detected_language) || null
    };
  }
  calculateTimeoutMs(sizeBytes) {
    const sizeMb = Math.max(1, Math.ceil(sizeBytes / (1024 * 1024)));
    const computed = sizeMb * DeepgramAdapter.TIMEOUT_PER_MB_MS;
    return Math.min(
      DeepgramAdapter.MAX_TIMEOUT_MS,
      Math.max(DeepgramAdapter.MIN_TIMEOUT_MS, computed)
    );
  }
  applyLanguageSettings(query, model) {
    const languageHints = (this.settings.deepgramLanguageHints || "").split(",").map((s) => s.trim()).filter(Boolean);
    const hintSet = new Set(languageHints.map((hint) => hint.toLowerCase()));
    const supportsMulti = /^nova-(2|3)/i.test(model);
    const shouldUseMulti = supportsMulti && (hintSet.has("multi") || languageHints.length > 1);
    if (shouldUseMulti) {
      query.set("language", "multi");
      return;
    }
    if (this.settings.deepgramDetectLanguage) {
      query.set("detect_language", "true");
      if (languageHints.length > 0) {
        query.set("languages", languageHints.join(","));
      }
      return;
    }
    if (languageHints.length > 0) {
      query.set("language", languageHints[0]);
    }
  }
  async requestWithTimeout(endpoint, headers, body, timeoutMs) {
    let timeoutHandle = null;
    try {
      return await Promise.race([
        this.makeAPIRequest(endpoint, "POST", headers, body),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `Deepgram request timed out after ${Math.round(timeoutMs / 1e3)}s`
              )
            );
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
  formatDiarizedTranscript(utterances) {
    let currentSpeaker = null;
    const lines = [];
    for (const utt of utterances) {
      const text = typeof (utt == null ? void 0 : utt.transcript) === "string" ? utt.transcript.trim() : "";
      if (!text)
        continue;
      const speakerId = typeof (utt == null ? void 0 : utt.speaker) === "number" ? utt.speaker + 1 : 0;
      const speakerLabel = speakerId > 0 ? `Speaker ${speakerId}` : "Speaker";
      const timestamp = this.formatTimestampToken(utt == null ? void 0 : utt.start);
      if (speakerLabel !== currentSpeaker) {
        if (lines.length > 0) {
          lines.push("");
        }
        lines.push(`${timestamp} ${speakerLabel}: ${text}`);
        currentSpeaker = speakerLabel;
      } else {
        const lastIndex = lines.length - 1;
        lines[lastIndex] = `${lines[lastIndex]} ${text}`;
      }
    }
    return lines.join("\n").trim();
  }
  normalizeSpeakerFormatting(transcript) {
    const speakerMatches = transcript.match(/Speaker\s+\d+:/g);
    if (!speakerMatches || speakerMatches.length < 2) {
      return transcript;
    }
    let normalized = transcript.replace(/\s*(Speaker\s+\d+:)/g, "\n$1").trim();
    normalized = normalized.replace(/\n{3,}/g, "\n\n");
    return normalized;
  }
  formatTimestampToken(startSeconds) {
    const raw = typeof startSeconds === "number" && Number.isFinite(startSeconds) ? startSeconds : 0;
    const total = Math.max(0, Math.floor(raw));
    const hours = Math.floor(total / 3600).toString().padStart(2, "0");
    const minutes = Math.floor(total % 3600 / 60).toString().padStart(2, "0");
    const seconds = (total % 60).toString().padStart(2, "0");
    return `[${hours}:${minutes}:${seconds}]`;
  }
  // Override the makeAPIRequest method to handle Deepgram's authorization header format
  async makeAPIRequest(endpoint, method, headers, body) {
    try {
      const requestHeaders = {
        "Authorization": `Token ${this.getApiKey()}`,
        // Deepgram uses "Token" instead of "Bearer"
        ...headers
      };
      const response = await (0, import_obsidian20.requestUrl)({
        url: endpoint,
        method,
        headers: requestHeaders,
        body: body || void 0,
        throw: true
      });
      if (!response.json) {
        throw new Error("Invalid response format");
      }
      return response.json;
    } catch (error) {
      throw error;
    }
  }
  getDeepgramErrorMessage(error) {
    if (!(error instanceof Error)) {
      return this.getErrorMessage(error);
    }
    const raw = error.message || "Unknown error";
    const statusMatch = raw.match(/\bstatus\s+(\d{3})\b/i);
    const status = statusMatch ? statusMatch[1] : "";
    let compact = raw.replace(/\s+/g, " ").trim();
    if (compact.length > 280) {
      compact = `${compact.slice(0, 280)}...`;
    }
    return status ? `status ${status} - ${compact}` : compact;
  }
}
