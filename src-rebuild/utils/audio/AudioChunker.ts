export class AudioChunker {
  constructor(sampleRate, bitRate, mimeType = "audio/webm; codecs=opus") {
    this.sampleRate = sampleRate;
    this.bitRate = bitRate;
    this.mimeType = mimeType;
    this.MAX_AUDIO_SIZE_MB = 25;
    this.MAX_AUDIO_SIZE_BYTES = this.MAX_AUDIO_SIZE_MB * 1024 * 1024;
    this.CHUNK_OVERLAP_SECONDS = 2;
  }
  /**
   * Splits an audio blob into smaller chunks if necessary
   * @param audioBlob The audio blob to potentially split
   * @returns Array of audio blobs (single item if no split needed)
   */
  async splitAudioBlob(audioBlob) {
    if (audioBlob.size <= this.MAX_AUDIO_SIZE_BYTES) {
      return [audioBlob];
    }
    try {
      const chunks = [];
      const chunkSize = this.MAX_AUDIO_SIZE_BYTES;
      let offset = 0;
      while (offset < audioBlob.size) {
        const end = Math.min(offset + chunkSize, audioBlob.size);
        const chunk = audioBlob.slice(offset, end);
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.sampleRate
        });
        const arrayBuffer = await chunk.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const processedChunk = await this.bufferToBlob(audioContext, audioBuffer, audioBlob.type);
        chunks.push(processedChunk);
        await audioContext.close();
        offset += chunkSize;
      }
      return chunks;
    } catch (error) {
      return [audioBlob];
    }
  }
  /**
   * Concatenates multiple audio chunks back into a single blob
   * @param chunks Array of audio blobs to combine
   * @returns Single concatenated audio blob
   */
  async concatenateAudioChunks(chunks) {
    try {
      const firstChunk = chunks[0];
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });
      const processedChunks = [];
      for (const chunk of chunks) {
        const processedChunk = await this.processChunk(chunk, firstChunk.type, audioContext);
        processedChunks.push(processedChunk);
      }
      await audioContext.close();
      return new Blob(processedChunks, { type: firstChunk.type });
    } catch (error) {
      return chunks[0];
    }
  }
  /**
   * Creates a chunk from the audio buffer
   */
  async createChunk(audioContext, audioBuffer, startTime, endTime, mimeType) {
    const chunkBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      Math.ceil((endTime - startTime) * audioBuffer.sampleRate),
      audioBuffer.sampleRate
    );
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const chunkData = chunkBuffer.getChannelData(channel);
      const startSample = Math.floor(startTime * audioBuffer.sampleRate);
      const endSample = Math.ceil(endTime * audioBuffer.sampleRate);
      chunkData.set(channelData.subarray(startSample, endSample));
    }
    return await this.bufferToBlob(audioContext, chunkBuffer, mimeType);
  }
  /**
   * Processes a single chunk for concatenation
   */
  async processChunk(chunk, mimeType, audioContext) {
    try {
      const arrayBuffer = await chunk.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      return await this.bufferToBlob(audioContext, audioBuffer, mimeType);
    } catch (error) {
      return chunk;
    }
  }
  /**
   * Converts an AudioBuffer to a Blob using MediaRecorder
   */
  async bufferToBlob(audioContext, buffer, mimeType) {
    if (!buffer.duration || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      throw new Error("bufferToBlob: invalid buffer duration");
    }
    return new Promise((resolve, reject) => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      const recorder = new MediaRecorder(destination.stream, {
        mimeType: this.mimeType,
        bitsPerSecond: this.bitRate
      });
      const chunks = [];
      let settled = false;
      const safetyTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("bufferToBlob: timed out waiting for MediaRecorder"));
        }
      }, buffer.duration * 1e3 + 1e4);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0)
          chunks.push(e.data);
      };
      recorder.onerror = (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimeout);
          reject(new Error("bufferToBlob: MediaRecorder error"));
        }
      };
      recorder.onstop = () => {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimeout);
          resolve(new Blob(chunks, { type: mimeType }));
        }
      };
      recorder.start();
      source.start(0);
      setTimeout(() => {
        try { source.stop(); } catch (e) {}
        try { recorder.stop(); } catch (e) {}
      }, buffer.duration * 1e3);
    });
  }
}
