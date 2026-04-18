class ResultCompiler {
  constructor(startTimestamp) {
    this.segments = [];
    this.totalDuration = 0;
    this.durationOverrideMs = null;
    this.startTimestamp = startTimestamp || Date.now();
  }
  addSegment(chunk) {
    const segment = {
      startTime: chunk.metadata.timestamp - this.startTimestamp,
      endTime: chunk.metadata.timestamp - this.startTimestamp + chunk.metadata.duration,
      text: chunk.transcript.trim(),
      chunkId: chunk.metadata.id
    };
    const insertIndex = this.segments.findIndex((s) => s.startTime > segment.startTime);
    if (insertIndex === -1) {
      this.segments.push(segment);
    } else {
      this.segments.splice(insertIndex, 0, segment);
    }
    this.totalDuration = Math.max(this.totalDuration, segment.endTime);
  }
  getPartialResult(includeTimestamps = false) {
    if (this.segments.length === 0)
      return "";
    if (includeTimestamps) {
      const turnBased = this.getPartialResultBySpeakerTurns();
      if (turnBased) {
        return turnBased;
      }
      let result = "";
      let previousSpeakerLabel = null;
      for (let i = 0; i < this.segments.length; i++) {
        const segment = this.segments[i];
        const normalized = this.normalizeRepeatedSpeakerLabel(segment.text, previousSpeakerLabel);
        const text = normalized.text;
        if (i > 0)
          result += "\n\n";
        result += `[${this.formatTime(segment.startTime)}] ${text}`;
        previousSpeakerLabel = normalized.nextSpeakerLabel;
      }
      return result;
    } else {
      let result = "";
      let previousSpeakerLabel = null;
      for (let i = 0; i < this.segments.length; i++) {
        const segment = this.segments[i];
        const prevSegment = i > 0 ? this.segments[i - 1] : null;
        const normalized = this.normalizeRepeatedSpeakerLabel(
          segment.text,
          previousSpeakerLabel
        );
        const text = normalized.text;
        if (prevSegment && segment.startTime - prevSegment.endTime > 1e3) {
          result += "\n\n...\n\n";
        } else if (i > 0) {
          result += " ";
        }
        result += text;
        previousSpeakerLabel = normalized.nextSpeakerLabel;
      }
      return result;
    }
  }
  normalizeRepeatedSpeakerLabel(text, previousSpeakerLabel) {
    const raw = (text || "").trim();
    if (!raw) {
      return { text: raw, nextSpeakerLabel: previousSpeakerLabel };
    }
    const match = /^(Speaker\s+\d+):\s*/i.exec(raw);
    if (!match) {
      return { text: raw, nextSpeakerLabel: previousSpeakerLabel };
    }
    const currentLabel = match[1];
    if (previousSpeakerLabel && currentLabel.toLowerCase() === previousSpeakerLabel.toLowerCase()) {
      const stripped = raw.slice(match[0].length).trim();
      return {
        text: stripped || raw,
        nextSpeakerLabel: currentLabel
      };
    }
    return {
      text: raw,
      nextSpeakerLabel: currentLabel
    };
  }
  getPartialResultBySpeakerTurns() {
    const turns = [];
    let currentTurn = null;
    let hasSpeakerLabels = false;
    for (const segment of this.segments) {
      const raw = (segment.text || "").trim();
      if (!raw)
        continue;
      const parsed = this.extractSpeakerLabelAndBody(raw);
      const speaker = parsed.speakerLabel;
      const textPart = parsed.body || raw;
      if (speaker)
        hasSpeakerLabels = true;
      if (!currentTurn) {
        currentTurn = {
          startTime: segment.startTime,
          speakerLabel: speaker,
          textParts: textPart ? [textPart] : []
        };
        continue;
      }
      if (speaker && speaker !== currentTurn.speakerLabel) {
        turns.push(currentTurn);
        currentTurn = {
          startTime: segment.startTime,
          speakerLabel: speaker,
          textParts: textPart ? [textPart] : []
        };
        continue;
      }
      if (speaker && !currentTurn.speakerLabel) {
        turns.push(currentTurn);
        currentTurn = {
          startTime: segment.startTime,
          speakerLabel: speaker,
          textParts: textPart ? [textPart] : []
        };
        continue;
      }
      if (textPart) {
        currentTurn.textParts.push(textPart);
      }
    }
    if (currentTurn) {
      turns.push(currentTurn);
    }
    if (!hasSpeakerLabels || turns.length === 0) {
      return null;
    }
    return turns.map((turn) => {
      const text = turn.textParts.join(" ").replace(/\s+/g, " ").trim();
      if (!text)
        return "";
      if (turn.speakerLabel) {
        return `[${this.formatTime(turn.startTime)}] ${turn.speakerLabel}: ${text}`;
      }
      return `[${this.formatTime(turn.startTime)}] ${text}`;
    }).filter(Boolean).join("\n\n");
  }
  extractSpeakerLabelAndBody(text) {
    const match = /^(Speaker\s+\d+):\s*(.*)$/i.exec(text.trim());
    if (!match) {
      return { speakerLabel: null, body: text.trim() };
    }
    return {
      speakerLabel: match[1],
      body: (match[2] || "").trim()
    };
  }
  getFinalResult(includeTimestamps = false, includeMetadata = false) {
    if (this.segments.length === 0)
      return "";
    let result = "";
    if (includeMetadata) {
      const recordingDate = new Date(this.startTimestamp).toLocaleString();
      const effectiveDurationMs = this.durationOverrideMs !== null ? Math.max(this.totalDuration, this.durationOverrideMs) : this.totalDuration;
      const duration = this.formatTime(effectiveDurationMs);
      result += `## Recording Information
`;
      result += `- Date: ${recordingDate}
`;
      result += `- Duration: ${duration}
`;
      result += `- Segments: ${this.segments.length}

`;
      result += `---

`;
    }
    result += includeTimestamps ? "## Transcription with Timestamps\n\n" : "## Transcription\n\n";
    result += this.getPartialResult(includeTimestamps);
    return result;
  }
  formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1e3);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      const mm = Math.floor(totalSeconds % 3600 / 60);
      return `${hours.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  getSegmentCount() {
    return this.segments.length;
  }
  getTotalDuration() {
    return this.totalDuration;
  }
  setDurationOverride(milliseconds) {
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      this.durationOverrideMs = Math.floor(milliseconds);
    }
  }
  clear() {
    this.segments = [];
    this.totalDuration = 0;
    this.durationOverrideMs = null;
  }
  // For error recovery - get unprocessed segments
  getMissingSegments(processedChunkIds) {
    const allIndices = new Set(Array.from({ length: this.segments.length }, (_, i) => i));
    const processedIndices = new Set(
      this.segments.map((seg, index) => processedChunkIds.has(seg.chunkId) ? index : -1).filter((index) => index !== -1)
    );
    return Array.from(allIndices).filter((index) => !processedIndices.has(index));
  }
}
