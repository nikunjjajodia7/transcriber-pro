export class DeepgramLiveAdapter {
  options: any;
  ws: any;
  listener: any;
  pendingFrames: any;
  opened: any;
  stopped: any;
  static OPEN_TIMEOUT_MS = 12e3;
  static STOP_TIMEOUT_MS = 1e4;

  constructor(options: any) {
    this.options = options;
    this.ws = null;
    this.listener = null;
    this.pendingFrames = [];
    this.opened = false;
    this.stopped = false;
  }
  onEvent(listener: any) {
    this.listener = listener;
  }
  isOpen() {
    var _a;
    return this.opened && ((_a = this.ws) == null ? void 0 : _a.readyState) === WebSocket.OPEN;
  }
  async start() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.stopped = false;
    const apiKey = this.options.settings.deepgramApiKey.trim();
    if (!apiKey) {
      throw new Error("Deepgram API key is not configured");
    }
    const url = this.buildLiveUrl();
    const ws = new WebSocket(url, ["token", apiKey]);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Deepgram live WebSocket open timed out"));
      }, DeepgramLiveAdapter.OPEN_TIMEOUT_MS);
      ws.onopen = async () => {
        var _a;
        window.clearTimeout(timeout);
        this.opened = true;
        (_a = this.listener) == null ? void 0 : _a.call(this, { type: "open" });
        try {
          await this.flushPendingFrames();
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Deepgram live WebSocket failed to open"));
      };
      ws.onclose = (event) => {
        var _a;
        this.opened = false;
        (_a = this.listener) == null ? void 0 : _a.call(this, { type: "closed", code: event.code, reason: event.reason });
      };
      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }
  async sendAudio(chunk: any) {
    var _a;
    if (this.stopped)
      return;
    const frame = chunk instanceof Blob ? await chunk.arrayBuffer() : chunk;
    if (!this.isOpen()) {
      this.pendingFrames.push(frame);
      return;
    }
    (_a = this.ws) == null ? void 0 : _a.send(frame);
  }
  async stop() {
    if (!this.ws || this.stopped)
      return;
    this.stopped = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
    await new Promise<void>((resolve) => {
      var _a;
      const done = () => resolve();
      const timeout = window.setTimeout(() => {
        var _a2;
        try {
          (_a2 = this.ws) == null ? void 0 : _a2.close(1e3, "client_stop_timeout");
        } catch (e) {
        }
        done();
      }, DeepgramLiveAdapter.STOP_TIMEOUT_MS);
      if (this.ws) {
        this.ws.onclose = (event: any) => {
          var _a2;
          window.clearTimeout(timeout);
          this.opened = false;
          (_a2 = this.listener) == null ? void 0 : _a2.call(this, { type: "closed", code: event.code, reason: event.reason });
          done();
        };
      }
    });
  }
  abort(reason = "manual_abort") {
    var _a;
    this.stopped = true;
    try {
      (_a = this.ws) == null ? void 0 : _a.close(1e3, reason);
    } catch (e) {
    } finally {
      this.opened = false;
    }
  }
  async flushPendingFrames() {
    var _a;
    if (!this.isOpen())
      return;
    for (const frame of this.pendingFrames.splice(0)) {
      (_a = this.ws) == null ? void 0 : _a.send(frame);
    }
  }
  buildLiveUrl() {
    const query = new URLSearchParams({
      model: this.options.model || "nova-3",
      punctuate: "true",
      smart_format: "true",
      interim_results: "true",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1"
    });
    const profile = this.options.settings.deepgramLiveDiarizationProfile;
    if (profile === "low_latency") {
      query.set("endpointing", "300");
      query.set("utterance_end_ms", "800");
    } else if (profile === "balanced") {
      query.set("endpointing", "500");
      query.set("utterance_end_ms", "1200");
    } else {
      query.set("endpointing", "1000");
      query.set("utterance_end_ms", "2000");
    }
    this.applyLanguageSettings(query, this.options.model || "nova-3");
    if (this.options.settings.enableSpeakerDiarization) {
      query.set("diarize", "true");
      query.set("utterances", "true");
    }
    return `wss://api.deepgram.com/v1/listen?${query.toString()}`;
  }
  applyLanguageSettings(query: any, model: any) {
    const languageHints = (this.options.settings.deepgramLanguageHints || "").split(",").map((s: any) => s.trim()).filter(Boolean);
    const hintSet = new Set(languageHints.map((hint: any) => hint.toLowerCase()));
    const supportsMulti = /^nova-(2|3)/i.test(model);
    const shouldUseMulti = supportsMulti && (hintSet.has("multi") || languageHints.length > 1);
    if (shouldUseMulti) {
      query.set("language", "multi");
      return;
    }
    if (this.options.settings.deepgramDetectLanguage) {
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
  handleMessage(rawData: any) {
    var _a, _b, _c, _d, _e;
    try {
      if (typeof rawData !== "string")
        return;
      const payload = JSON.parse(rawData);
      if ((payload == null ? void 0 : payload.type) !== "Results")
        return;
      const alt = (_b = (_a = payload == null ? void 0 : payload.channel) == null ? void 0 : _a.alternatives) == null ? void 0 : _b[0];
      const text = typeof (alt == null ? void 0 : alt.transcript) === "string" ? alt.transcript.trim() : "";
      if (!text)
        return;
      const startedAt = typeof (payload == null ? void 0 : payload.start) === "number" ? payload.start : void 0;
      const speakerTurns = this.extractSpeakerTurns(alt);
      const isFinal = (payload == null ? void 0 : payload.is_final) === true || (payload == null ? void 0 : payload.speech_final) === true;
      if (isFinal) {
        (_c = this.listener) == null ? void 0 : _c.call(this, { type: "final", text, startedAtSec: startedAt, speakerTurns });
      } else {
        (_d = this.listener) == null ? void 0 : _d.call(this, { type: "interim", text, startedAtSec: startedAt, speakerTurns });
      }
    } catch (error) {
      (_e = this.listener) == null ? void 0 : _e.call(this, {
        type: "error",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  extractSpeakerTurns(alternative: any) {
    const words = Array.isArray(alternative == null ? void 0 : alternative.words) ? alternative.words : [];
    if (words.length === 0)
      return void 0;
    const turns: any[] = [];
    let currentSpeaker: any;
    let currentWords: any[] = [];
    let currentStart: any;
    const flush = () => {
      if (currentWords.length === 0)
        return;
      turns.push({
        speakerId: currentSpeaker,
        text: currentWords.join(" ").trim(),
        startedAtSec: currentStart
      });
      currentWords = [];
      currentStart = void 0;
    };
    for (const word of words) {
      const punctWord = typeof (word == null ? void 0 : word.punctuated_word) === "string" ? word.punctuated_word : typeof (word == null ? void 0 : word.word) === "string" ? word.word : "";
      if (!punctWord.trim())
        continue;
      const speakerRaw = typeof (word == null ? void 0 : word.speaker) === "number" ? word.speaker : void 0;
      const speakerId = typeof speakerRaw === "number" ? speakerRaw + 1 : void 0;
      const wordStart = typeof (word == null ? void 0 : word.start) === "number" ? word.start : void 0;
      if (currentWords.length === 0) {
        currentSpeaker = speakerId;
        currentStart = wordStart;
        currentWords.push(punctWord);
        continue;
      }
      if (speakerId !== currentSpeaker) {
        flush();
        currentSpeaker = speakerId;
        currentStart = wordStart;
      }
      currentWords.push(punctWord);
    }
    flush();
    return turns.length > 0 ? turns : void 0;
  }
}
