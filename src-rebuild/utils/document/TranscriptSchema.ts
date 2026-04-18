export function fromPlainTranscription(transcription) {
  return {
    segments: [
      {
        startMs: 0,
        endMs: 0,
        text: transcription.trim()
      }
    ]
  };
}
export function flattenTranscriptText(transcript, includeTimestamps = false) {
  const lines = transcript.segments.map((segment) => {
    const text = segment.text.trim();
    if (!text)
      return "";
    if (!includeTimestamps)
      return text;
    if (/(^|\n)\s*## Speaker Mapping\s*$/m.test(text) || text.includes("<!-- neurovox:mapping:start:")) {
      return text;
    }
    return `${formatTimestamp(segment.startMs)} ${text}`.trim();
  }).filter(Boolean);
  return lines.join("\n");
}
function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `[${m}:${s}]`;
}
