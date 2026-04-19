export class TranscriptionService {
  plugin: any;
  static ADAPTER_VALIDATION_TIMEOUT_MS = 4e3;

  constructor(plugin: any) {
    this.plugin = plugin;
  }
  /**
   * Transcribes audio content and optionally generates post-processing
   * @param audioBuffer The audio data to transcribe
   * @returns The transcription result
   */
  async transcribeContent(audioBuffer: any, options: any) {
    try {
      const transcription = await this.transcribeAudioOnly(audioBuffer, options);
      const postProcessing = await this.generatePostProcessingFromTranscript(transcription);
      return {
        transcription,
        postProcessing
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Transcription failed: ${message}`);
    }
  }
  async transcribeAudioOnly(audioBuffer: any, options: any) {
    return this.transcribeAudio(audioBuffer, options);
  }
  async generatePostProcessingFromTranscript(transcription: any) {
    if (!this.plugin.settings.generatePostProcessing) {
      return void 0;
    }
    return this.generatePostProcessing(transcription);
  }
  /**
   * Transcribes audio using the configured AI adapter
   */
  async transcribeAudio(audioBuffer: any, options: any) {
    const adapter = await this.getAdapter(
      this.plugin.settings.transcriptionProvider,
      "transcription"
    );
    const transcription = await adapter.transcribeAudio(
      audioBuffer,
      this.plugin.settings.transcriptionModel,
      options
    );
    if (!(options == null ? void 0 : options.allowEmptyTranscription) && (!transcription || !transcription.trim())) {
      throw new Error("Transcription is empty");
    }
    return transcription;
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
    const timeoutMs = TranscriptionService.ADAPTER_VALIDATION_TIMEOUT_MS;
    return await Promise.race([
      adapter.validateApiKey().catch(() => false),
      new Promise((resolve) => {
        window.setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  }
}
