export class WebAudioPcmSource {
  stream: any;
  audioContext: any;
  sourceNode: any;
  processorNode: any;
  gainNode: any;
  running: any;
  paused: any;
  framesSent: any;
  samplesSent: any;
  inputSampleRate: any;
  targetSampleRate: any;
  bufferSize: any;
  constructor(stream: any, options: any) {
    this.stream = stream;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.gainNode = null;
    this.running = false;
    this.paused = false;
    this.framesSent = 0;
    this.samplesSent = 0;
    this.inputSampleRate = 0;
    var _a, _b;
    this.targetSampleRate = (_a = options == null ? void 0 : options.targetSampleRate) != null ? _a : 16e3;
    this.bufferSize = (_b = options == null ? void 0 : options.bufferSize) != null ? _b : 4096;
  }
  async start(onFrame: any) {
    if (this.running)
      return;
    const audioContext = new AudioContext();
    this.audioContext = audioContext;
    this.inputSampleRate = audioContext.sampleRate;
    const source = audioContext.createMediaStreamSource(this.stream);
    this.sourceNode = source;
    const processor = audioContext.createScriptProcessor(this.bufferSize, 1, 1);
    this.processorNode = processor;
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    this.gainNode = gain;
    processor.onaudioprocess = (event) => {
      if (!this.running || this.paused)
        return;
      const input = event.inputBuffer.getChannelData(0);
      if (!input || input.length === 0)
        return;
      const resampled = this.resample(input, this.inputSampleRate, this.targetSampleRate);
      if (resampled.length === 0)
        return;
      const pcm16 = this.floatTo16BitPcm(resampled);
      this.framesSent += 1;
      this.samplesSent += pcm16.length;
      const frame = pcm16.buffer.slice(0);
      void onFrame(frame);
    };
    source.connect(processor);
    processor.connect(gain);
    gain.connect(audioContext.destination);
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    this.running = true;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  async stop() {
    var _a, _b;
    this.running = false;
    this.paused = false;
    try {
      if (this.processorNode) {
        this.processorNode.disconnect();
        this.processorNode.onaudioprocess = null;
      }
    } catch (e) {
    }
    try {
      (_a = this.sourceNode) == null ? void 0 : _a.disconnect();
    } catch (e) {
    }
    try {
      (_b = this.gainNode) == null ? void 0 : _b.disconnect();
    } catch (e) {
    }
    this.processorNode = null;
    this.sourceNode = null;
    this.gainNode = null;
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch (e) {
      }
      this.audioContext = null;
    }
  }
  abort() {
    void this.stop();
  }
  isRunning() {
    return this.running;
  }
  getStats() {
    return {
      framesSent: this.framesSent,
      samplesSent: this.samplesSent,
      inputSampleRate: this.inputSampleRate,
      targetSampleRate: this.targetSampleRate
    };
  }
  resample(input: any, inputRate: any, outputRate: any) {
    if (inputRate === outputRate) {
      return input;
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const src = i * ratio;
      const low = Math.floor(src);
      const high = Math.min(low + 1, input.length - 1);
      const t = src - low;
      output[i] = input[low] * (1 - t) + input[high] * t;
    }
    return output;
  }
  floatTo16BitPcm(input: any) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return output;
  }
}
