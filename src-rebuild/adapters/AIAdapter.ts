var import_obsidian2 = require("obsidian");
var AIProvider = /* @__PURE__ */ ((AIProvider2) => {
  AIProvider2["OpenAI"] = "openai";
  AIProvider2["Groq"] = "groq";
  AIProvider2["Deepgram"] = "deepgram";
  return AIProvider2;
})(AIProvider || {});
var AIModels = {
  ["openai" /* OpenAI */]: [
    { id: "whisper-1", name: "Whisper", category: "transcription" },
    { id: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe", category: "transcription" },
    { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe", category: "transcription" },
    { id: "gpt-4o", name: "GPT 4o", category: "language", maxTokens: 16e3 },
    { id: "gpt-4o-mini", name: "GPT 4o Mini", category: "language", maxTokens: 16e3 },
    { id: "gpt-5", name: "GPT 5", category: "language", maxTokens: 4e5 },
    { id: "gpt-5-mini", name: "GPT 5 Mini", category: "language", maxTokens: 4e5 },
    { id: "gpt-5-nano", name: "GPT 5 Nano", category: "language", maxTokens: 4e5 }
  ],
  ["groq" /* Groq */]: [
    { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", category: "transcription" },
    { id: "whisper-large-v3", name: "Whisper Large v3", category: "transcription" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", category: "language", maxTokens: 32768 },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", category: "language", maxTokens: 131072 },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B", category: "language", maxTokens: 8192 },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B", category: "language", maxTokens: 8192 },
    { id: "qwen/qwen3-32b", name: "Qwen 3 32B", category: "language", maxTokens: 40960 },
    { id: "moonshotai/kimi-k2-instruct-0905", name: "Kimi K2", category: "language", maxTokens: 16384 },
    { id: "openai/gpt-oss-20b", name: "OpenAI GPT-OSS 20B", category: "language", maxTokens: 32768 },
    { id: "openai/gpt-oss-120b", name: "OpenAI GPT-OSS 120B", category: "language", maxTokens: 32768 }
  ],
  ["deepgram" /* Deepgram */]: [
    { id: "nova-2", name: "Nova-2", category: "transcription" },
    { id: "nova-3", name: "Nova-3", category: "transcription" }
  ]
};
function getModelInfo(modelId) {
  for (const models of Object.values(AIModels)) {
    const model = models.find((m) => m.id === modelId);
    if (model)
      return model;
  }
  return void 0;
}
class AIAdapter {
  static DEFAULT_REQUEST_TIMEOUT_MS = 3e4;

  constructor(settings, provider) {
    this.settings = settings;
    this.provider = provider;
    this.keyValidated = false;
    this.lastValidatedKey = "";
    this.models = AIModels[provider];
  }
  setApiKey(key) {
    const currentKey = this.getApiKey();
    if (key !== currentKey) {
      this.keyValidated = false;
      this.lastValidatedKey = "";
    }
    this.setApiKeyInternal(key);
  }
  async generateResponse(prompt, model, options) {
    try {
      const endpoint = `${this.getApiBaseUrl()}${this.getTextGenerationEndpoint()}`;
      const body = {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: (options == null ? void 0 : options.maxTokens) || 1e3,
        temperature: (options == null ? void 0 : options.temperature) || 0.7
      };
      const response = await this.makeAPIRequest(
        endpoint,
        "POST",
        { "Content-Type": "application/json" },
        JSON.stringify(body)
      );
      return this.parseTextGenerationResponse(response);
    } catch (error) {
      const message = this.getErrorMessage(error);
      throw new Error(`Failed to generate response: ${message}`);
    }
  }
  async transcribeAudio(audioArrayBuffer, model, _options) {
    var _a, _b, _c, _d, _e, _f;
    try {
      const { headers, body } = await this.prepareTranscriptionRequest(audioArrayBuffer, model);
      const endpoint = `${this.getApiBaseUrl()}${this.getTranscriptionEndpoint()}`;
      try {
        const response = await this.makeAPIRequest(
          endpoint,
          "POST",
          headers,
          body
        );
        return this.parseTranscriptionResponse(response);
      } catch (error) {
        if (((_a = error == null ? void 0 : error.response) == null ? void 0 : _a.status) === 400) {
          throw new Error(`Invalid request format: ${((_d = (_c = (_b = error == null ? void 0 : error.response) == null ? void 0 : _b.data) == null ? void 0 : _c.error) == null ? void 0 : _d.message) || "Check audio format and model name"}`);
        } else if (((_e = error == null ? void 0 : error.response) == null ? void 0 : _e.status) === 401) {
          throw new Error("Invalid API key or unauthorized access");
        } else if (((_f = error == null ? void 0 : error.response) == null ? void 0 : _f.status) === 413) {
          throw new Error("Audio file too large. Maximum size is 25MB");
        }
        throw error;
      }
    } catch (error) {
      const message = this.getErrorMessage(error);
      throw new Error(`Failed to transcribe audio: ${message}`);
    }
  }
  async validateApiKey() {
    try {
      const currentKey = this.getApiKey();
      if (!currentKey) {
        this.keyValidated = false;
        this.lastValidatedKey = "";
        return false;
      }
      if (this.keyValidated && this.lastValidatedKey === currentKey) {
        return true;
      }
      const isValid = await this.validateApiKeyImpl();
      if (isValid) {
        this.keyValidated = true;
        this.lastValidatedKey = currentKey;
      } else {
        this.keyValidated = false;
        this.lastValidatedKey = "";
      }
      return isValid;
    } catch (error) {
      this.keyValidated = false;
      this.lastValidatedKey = "";
      return false;
    }
  }
  getAvailableModels(category) {
    return this.models.filter((model) => model.category === category);
  }
  isReady(category = "transcription") {
    const currentKey = this.getApiKey();
    if (!currentKey)
      return false;
    return this.keyValidated && this.lastValidatedKey === currentKey;
  }
  async makeAPIRequest(endpoint, method, headers, body, timeoutMs = AIAdapter.DEFAULT_REQUEST_TIMEOUT_MS) {
    try {
      const requestHeaders = {
        "Authorization": `Bearer ${this.getApiKey()}`,
        ...headers
      };
      const requestPromise = (0, import_obsidian2.requestUrl)({
        url: endpoint,
        method,
        headers: requestHeaders,
        body: body || void 0,
        throw: true
      });
      const response = timeoutMs > 0 ? await Promise.race([
        requestPromise,
        new Promise((_, reject) => {
          window.setTimeout(
            () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        })
      ]) : await requestPromise;
      if (!response.json) {
        throw new Error("Invalid response format");
      }
      return response.json;
    } catch (error) {
      throw error;
    }
  }
  async prepareTranscriptionRequest(audioArrayBuffer, model) {
    const boundary = "----NVBoundary" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const encoder = new TextEncoder();
    const parts = [];
    parts.push(encoder.encode(`--${boundary}\r
`));
    parts.push(encoder.encode('Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n\r\n'));
    parts.push(new Uint8Array(audioArrayBuffer));
    parts.push(encoder.encode("\r\n"));
    parts.push(encoder.encode(`--${boundary}\r
`));
    parts.push(encoder.encode('Content-Disposition: form-data; name="model"\r\n\r\n'));
    parts.push(encoder.encode(model));
    parts.push(encoder.encode("\r\n"));
    parts.push(encoder.encode(`--${boundary}--\r
`));
    const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
    const finalBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      finalBuffer.set(part, offset);
      offset += part.length;
    }
    return {
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body: finalBuffer.buffer
    };
  }
  getErrorMessage(error) {
    if (error instanceof Error)
      return error.message;
    if (typeof error === "string")
      return error;
    return "Unknown error occurred";
  }
}
