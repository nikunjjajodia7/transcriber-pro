import { AudioChunker } from './AudioChunker';
import { AudioFileManager } from './AudioFileManager';

export class AudioProcessor {
  constructor(plugin) {
    this.plugin = plugin;
    // Maximum audio size before skipping chunking (25MB)
    this.MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
    // Audio quality settings (sample rates in Hz)
    this.SAMPLE_RATES = {
      ["low" /* Low */]: 22050,
      // Voice optimized (smaller files)
      ["medium" /* Medium */]: 32e3,
      // High quality voice (balanced)
      ["high" /* High */]: 44100
      // CD quality (larger files)
    };
    // Bitrate settings for different quality levels (bits per second)
    this.BIT_RATES = {
      ["low" /* Low */]: 64e3,
      // Good for voice
      ["medium" /* Medium */]: 128e3,
      // Excellent voice quality
      ["high" /* High */]: 192e3
      // Studio quality
    };
    this.audioChunker = new AudioChunker(
      this.getSampleRate(),
      this.getBitRate(),
      "audio/webm; codecs=opus"
    );
    this.audioFileManager = new AudioFileManager(plugin);
  }
  /**
   * Processes an audio blob, handling large files by chunking if necessary
   * @param audioBlob The audio blob to process
   * @param audioFilePath Optional path to save the audio file
   * @returns Object containing paths to audio files and concatenated blob
   */
  async processAudio(audioBlob, audioFilePath) {
    try {
      const fileSizeMB = audioBlob.size / (1024 * 1024);
      const provider = this.plugin.settings.transcriptionProvider;
      if (this.canProviderHandleFile(provider, audioBlob.size)) {
        const finalPath = audioFilePath || await this.audioFileManager.saveAudioFile(audioBlob);
        return { finalPath, audioBlob };
      } else {
        throw new Error(this.getLargeFileErrorMessage(provider, fileSizeMB));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to process audio: ${message}`);
    }
  }
  /**
   * Gets the sample rate based on the current audio quality setting
   */
  getSampleRate() {
    return this.SAMPLE_RATES[this.plugin.settings.audioQuality] || this.SAMPLE_RATES["medium" /* Medium */];
  }
  /**
   * Gets the bit rate based on the current audio quality setting
   */
  getBitRate() {
    return this.BIT_RATES[this.plugin.settings.audioQuality] || this.BIT_RATES["medium" /* Medium */];
  }
  /**
   * Checks if the provider can handle the given file size
   */
  canProviderHandleFile(provider, fileSize) {
    const MAX_SIZE_25MB = 25 * 1024 * 1024;
    const MAX_SIZE_2GB = 2 * 1024 * 1024 * 1024;
    switch (provider) {
      case "deepgram" /* Deepgram */:
        return fileSize <= MAX_SIZE_2GB;
      case "openai" /* OpenAI */:
      case "groq" /* Groq */:
        return fileSize <= MAX_SIZE_25MB;
      default:
        return fileSize <= MAX_SIZE_25MB;
    }
  }
  /**
   * Generates a helpful error message for files that are too large
   */
  getLargeFileErrorMessage(provider, fileSizeMB) {
    const fileSize = fileSizeMB.toFixed(1);
    switch (provider) {
      case "openai" /* OpenAI */:
        return `File too large (${fileSize}MB) for OpenAI. Switch to Deepgram for large files.`;
      case "groq" /* Groq */:
        return `File too large (${fileSize}MB) for Groq. Switch to Deepgram for large files.`;
      case "deepgram" /* Deepgram */:
        return `File too large (${fileSize}MB). Split the audio file into smaller segments.`;
      default:
        return `File too large (${fileSize}MB). Switch to Deepgram for large files.`;
    }
  }
}
