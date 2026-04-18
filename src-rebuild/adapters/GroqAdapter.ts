class GroqAdapter extends AIAdapter {
  constructor(settings) {
    super(settings, "groq" /* Groq */);
    this.apiKey = "";
  }
  getApiKey() {
    return this.apiKey;
  }
  setApiKeyInternal(key) {
    this.apiKey = key;
  }
  getApiBaseUrl() {
    return "https://api.groq.com/openai/v1";
  }
  getTextGenerationEndpoint() {
    return "/chat/completions";
  }
  getTranscriptionEndpoint() {
    return "/audio/transcriptions";
  }
  async validateApiKeyImpl() {
    if (!this.apiKey) {
      return false;
    }
    try {
      await this.makeAPIRequest(
        `${this.getApiBaseUrl()}/chat/completions`,
        "POST",
        {
          "Content-Type": "application/json"
        },
        JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 1
        })
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  parseTextGenerationResponse(response) {
    var _a, _b, _c;
    if ((_c = (_b = (_a = response == null ? void 0 : response.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) {
      return response.choices[0].message.content;
    }
    throw new Error("Invalid response format from Groq");
  }
  parseTranscriptionResponse(response) {
    if (response == null ? void 0 : response.text) {
      return response.text;
    }
    throw new Error("Invalid transcription response format from Groq");
  }
}
