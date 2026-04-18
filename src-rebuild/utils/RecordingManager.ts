import RecordRTC from 'recordrtc';
import { DeviceDetection } from './DeviceDetection';

export class AudioRecordingManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.recorder = null;
    this.stream = null;
    this.pendingDataCallbacks = /* @__PURE__ */ new Set();
    // Audio quality settings (sample rates in Hz)
    this.SAMPLE_RATES = {
      ["low" /* Low */]: 22050,
      // Voice optimized
      ["medium" /* Medium */]: 32e3,
      // High quality voice
      ["high" /* High */]: 44100
      // CD quality
    };
    // Mobile-optimized sample rates
    this.MOBILE_SAMPLE_RATES = {
      ["low" /* Low */]: 16e3,
      // Mobile voice optimized
      ["medium" /* Medium */]: 22050,
      // Mobile high quality voice
      ["high" /* High */]: 32e3
      // Mobile max quality
    };
    // Bitrate settings (bits per second)
    this.BIT_RATES = {
      ["low" /* Low */]: 64e3,
      // Good for voice
      ["medium" /* Medium */]: 128e3,
      // Excellent voice quality
      ["high" /* High */]: 192e3
      // Studio quality
    };
    // Mobile-optimized bitrates
    this.MOBILE_BIT_RATES = {
      ["low" /* Low */]: 16e3,
      // Mobile voice optimized
      ["medium" /* Medium */]: 32e3,
      // Mobile good quality
      ["high" /* High */]: 48e3
      // Mobile high quality
    };
    this.deviceDetection = DeviceDetection.getInstance();
  }
  /**
   * Gets audio configuration based on current quality settings
   */
  getAudioConfig() {
    const quality = this.plugin.settings.audioQuality;
    const isMobile = this.deviceDetection.isMobile();
    const sampleRates = isMobile ? this.MOBILE_SAMPLE_RATES : this.SAMPLE_RATES;
    const bitRates = isMobile ? this.MOBILE_BIT_RATES : this.BIT_RATES;
    return {
      type: "audio",
      mimeType: "audio/webm",
      recorderType: RecordRTC.StereoAudioRecorder,
      numberOfAudioChannels: 1,
      desiredSampRate: sampleRates[quality] || sampleRates["medium" /* Medium */],
      // Add bitrate control for better compression
      bitsPerSecond: bitRates[quality] || bitRates["medium" /* Medium */]
    };
  }
  /**
   * Initializes the recording manager with microphone access
   */
  async initialize() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (error) {
      throw new Error("Failed to access microphone");
    }
  }
  start(options) {
    if (!this.stream) {
      throw new Error("Audio recorder not initialized");
    }
    this.currentOptions = options;
    const streamingMimeType = (options == null ? void 0 : options.timeSlice) ? this.getPreferredStreamingMimeType() : void 0;
    const config = {
      ...this.getAudioConfig(),
      // MediaStreamRecorder emits timeslice/final chunks more reliably for streaming mode.
      recorderType: (options == null ? void 0 : options.timeSlice) ? RecordRTC.MediaStreamRecorder : RecordRTC.StereoAudioRecorder,
      mimeType: streamingMimeType || this.getAudioConfig().mimeType,
      timeSlice: options == null ? void 0 : options.timeSlice,
      // RecordRTC uses ondataavailable callback for time-sliced recording
      ondataavailable: (options == null ? void 0 : options.onDataAvailable) ? async (blob) => {
        if (!blob || blob.size === 0)
          return;
        const task = Promise.resolve(options.onDataAvailable(blob)).catch(() => {
        }).finally(() => {
          this.pendingDataCallbacks.delete(task);
        });
        this.pendingDataCallbacks.add(task);
        await task;
      } : void 0
    };
    this.recorder = new RecordRTC(this.stream, config);
    this.recorder.startRecording();
  }
  getPreferredStreamingMimeType() {
    const candidates = ["audio/wav", "audio/webm;codecs=pcm", "audio/webm"];
    const mediaRecorderCtor = window.MediaRecorder;
    const isSupported = mediaRecorderCtor && typeof mediaRecorderCtor.isTypeSupported === "function" ? (mime) => mediaRecorderCtor.isTypeSupported(mime) : () => false;
    for (const mime of candidates) {
      if (isSupported(mime)) {
        return mime;
      }
    }
    return "audio/webm";
  }
  pause() {
    if (!this.recorder)
      return;
    this.recorder.pauseRecording();
  }
  resume() {
    if (!this.recorder)
      return;
    this.recorder.resumeRecording();
  }
  async stop() {
    if (!this.recorder)
      return null;
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.stopRecording(() => {
        void this.waitForPendingDataCallbacks().then(() => this.waitForDataDrainWindow()).then(() => {
          var _a;
          const blob = ((_a = this.recorder) == null ? void 0 : _a.getBlob()) || null;
          if (blob) {
            Object.defineProperty(blob, "name", {
              value: `recording-${new Date().getTime()}.wav`,
              writable: true
            });
          }
          resolve(blob);
        });
      });
    });
  }
  async waitForPendingDataCallbacks(timeoutMs = 3e3) {
    const start = Date.now();
    while (this.pendingDataCallbacks.size > 0 && Date.now() - start < timeoutMs) {
      await Promise.allSettled(Array.from(this.pendingDataCallbacks));
    }
  }
  async waitForDataDrainWindow(windowMs = 3e3, pollMs = 50) {
    const endAt = Date.now() + windowMs;
    while (Date.now() < endAt) {
      if (this.pendingDataCallbacks.size > 0) {
        await Promise.allSettled(Array.from(this.pendingDataCallbacks));
        continue;
      }
      await this.sleep(pollMs);
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  cleanup() {
    if (this.recorder) {
      try {
        this.recorder.destroy();
      } catch (error) {
      }
      this.recorder = null;
    }
    this.pendingDataCallbacks.clear();
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
      }
      this.stream = null;
    }
  }
  getState() {
    return this.recorder ? this.recorder.state : "inactive";
  }
  isRecording() {
    return this.getState() === "recording";
  }
  isInitialized() {
    return this.recorder !== null;
  }
  getStream() {
    return this.stream;
  }
}
