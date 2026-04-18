import { flattenTranscriptText } from './TranscriptSchema';

export class TranscriptRenderer {
  config: any;
  constructor(config: any) {
    this.config = config;
  }
  render(input: any) {
    const transcriptionText = flattenTranscriptText(input.transcript, this.config.includeTimestamps);
    let format = this.config.transcriptionTemplate;
    if (!input.audioFilePath) {
      format = format.replace(/!?\[\[{audioPath}\]\]\n?/, "").replace("[[{audioPath}]]", "").replace("{audioPath}", "");
    }
    let result = format.replace("{audioPath}", input.audioFilePath || "").replace("{transcription}", transcriptionText);
    const useTranscriptionCallout = this.isCalloutFormat(format);
    result = this.formatLines(result, useTranscriptionCallout);
    if (this.config.generatePostProcessing && input.postProcessing) {
      const postFormat = this.config.postProcessingTemplate;
      const usePostCallout = this.isCalloutFormat(postFormat);
      let postContent = postFormat.replace("{postProcessing}", input.postProcessing);
      postContent = this.formatLines(postContent, usePostCallout);
      result += `
---
${postContent}

`;
    }
    return `${result}
`;
  }
  isCalloutFormat(format: any) {
    return format.includes(">[!");
  }
  formatLines(content: any, useCallout: any) {
    return content.split("\n").map((line: any) => {
      if (!useCallout)
        return line;
      if (!line.trim())
        return ">";
      return line.startsWith(">") ? line : `>${line}`;
    }).join("\n");
  }
}
