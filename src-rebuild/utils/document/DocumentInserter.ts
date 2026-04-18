var import_obsidian3 = require("obsidian");

class DocumentInserter {
  static LIVE_MARKER_START_PREFIX = "<!-- neurovox:live:start:";
  static LIVE_MARKER_END_PREFIX = "<!-- neurovox:live:end:";
  static liveCalloutCollapsedState = /* @__PURE__ */ new Map();

  constructor(plugin) {
    this.plugin = plugin;
  }
  static setLiveCalloutCollapsedState(filePath, collapsed) {
    const key = DocumentInserter.buildLiveStateKey(filePath);
    if (!key)
      return;
    DocumentInserter.liveCalloutCollapsedState.set(key, collapsed);
  }
  /**
   * Inserts formatted content at the specified position in a file
   * @param content The content to insert
   * @param file The target file
   * @param position The cursor position for insertion
   */
  async insertContent(content, file, position) {
    var _a;
    try {
      this.validateTemplates();
      const transcript = fromPlainTranscription(content.transcription);
      const title = (content.entryTitle || this.buildDefaultEntryTitle()).trim();
      const entryMeta = createEntryMeta(title);
      const speakerLabels = extractSpeakerLabels(content.transcription);
      if (speakerLabels.length > 0) {
        const speakerMappingSection = buildEntrySpeakerMappingSection(
          speakerLabels,
          entryMeta.id
        );
        const baseText = ((_a = transcript.segments[0]) == null ? void 0 : _a.text) || "";
        transcript.segments[0].text = `${speakerMappingSection}
${baseText}`.trim();
      }
      const renderer = new TranscriptRenderer({
        transcriptionTemplate: this.plugin.settings.transcriptionCalloutFormat,
        postProcessingTemplate: this.plugin.settings.postProcessingCalloutFormat,
        generatePostProcessing: this.plugin.settings.generatePostProcessing,
        includeTimestamps: this.plugin.settings.includeTimestamps || false
      });
      let formattedContent = renderer.render({
        transcript,
        postProcessing: content.postProcessing,
        audioFilePath: content.audioFilePath
      });
      formattedContent = this.applyEntryTitle(formattedContent, title);
      const markerHash = this.computeContentHash(formattedContent);
      const entryMarker = this.buildEntryMarker(markerHash, entryMeta);
      formattedContent = this.injectCalloutMetadata(formattedContent, {
        sourcePath: content.audioFilePath,
        recordedAtIso: entryMeta.recordedAtIso,
        sourceSizeMb: content.sourceSizeMb
      });
      formattedContent = this.injectEntryMarkerIntoCallout(formattedContent, entryMarker);
      await this.insertAtPositionWithIdempotency(entryMarker, formattedContent, file, position);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      new import_obsidian3.Notice(`Content insertion failed: ${message}`);
      throw error;
    }
  }
  /**
   * Inserts content at the specified position in a file
   */
  async insertAtPositionWithIdempotency(entryMarker, content, file, position) {
    const fileContent = await this.plugin.app.vault.read(file);
    if (fileContent.includes(entryMarker)) {
      return;
    }
    const lines = fileContent.split("\n");
    const offset = lines.slice(0, position.line).reduce((acc, line) => acc + line.length + 1, 0) + position.ch;
    const entry = content;
    const updatedContent = fileContent.slice(0, offset) + entry + fileContent.slice(offset);
    await this.plugin.app.vault.modify(file, updatedContent);
  }
  async upsertLiveTranscriptionBlock(file, position, markerId, transcription) {
    var _a;
    const fileContent = await this.plugin.app.vault.read(file);
    const { startMarker, endMarker } = this.getLiveMarkers(markerId);
    const collapsed = (_a = this.getLiveCalloutCollapsedState(file.path)) != null ? _a : false;
    const block = this.buildLiveTranscriptionBlock(
      startMarker,
      endMarker,
      transcription,
      collapsed
    );
    const region = this.findLiveRegion(fileContent, startMarker, endMarker);
    if (region) {
      const updated2 = fileContent.slice(0, region.start) + block + fileContent.slice(region.end);
      await this.plugin.app.vault.modify(file, updated2);
      return;
    }
    const lines = fileContent.split("\n");
    const offset = lines.slice(0, position.line).reduce((acc, line) => acc + line.length + 1, 0) + position.ch;
    const updated = `${fileContent.slice(0, offset)}${block}${fileContent.slice(offset)}`;
    await this.plugin.app.vault.modify(file, updated);
  }
  async removeLiveTranscriptionBlock(file, markerId) {
    const fileContent = await this.plugin.app.vault.read(file);
    const { startMarker, endMarker } = this.getLiveMarkers(markerId);
    const region = this.findLiveRegion(fileContent, startMarker, endMarker);
    if (!region) {
      this.clearLiveCalloutCollapsedState(file.path);
      return;
    }
    const updated = `${fileContent.slice(0, region.start)}${fileContent.slice(region.end)}`;
    await this.plugin.app.vault.modify(file, updated);
    this.clearLiveCalloutCollapsedState(file.path);
  }
  async removeAllLiveTranscriptionBlocks(file) {
    const fileContent = await this.plugin.app.vault.read(file);
    const cleaned = this.stripAllLegacyLiveBlocks(fileContent);
    if (cleaned.removedCount === 0)
      return 0;
    await this.plugin.app.vault.modify(file, cleaned.content);
    this.clearLiveCalloutCollapsedState(file.path);
    return cleaned.removedCount;
  }
  async replaceLiveTranscriptionBlockWithFinalContent(file, markerId, finalContent, fallbackPosition) {
    const fileContent = await this.plugin.app.vault.read(file);
    const { startMarker, endMarker } = this.getLiveMarkers(markerId);
    const region = this.findLiveRegion(fileContent, startMarker, endMarker);
    if (!region) {
      const markerHash2 = this.computeContentHash(finalContent);
      const entryMarker = this.buildEntryMarker(markerHash2);
      const withMarker = this.injectEntryMarkerIntoCallout(finalContent, entryMarker);
      await this.insertAtPositionWithIdempotency(entryMarker, withMarker, file, fallbackPosition);
      this.clearLiveCalloutCollapsedState(file.path);
      return;
    }
    const markerHash = this.computeContentHash(finalContent);
    const withMetadata = this.injectCalloutMetadata(finalContent, {
      recordedAtIso: new Date().toISOString()
    });
    const entry = this.injectEntryMarkerIntoCallout(withMetadata, this.buildEntryMarker(markerHash));
    const updated = fileContent.slice(0, region.start) + entry + fileContent.slice(region.end);
    await this.plugin.app.vault.modify(file, updated);
    this.clearLiveCalloutCollapsedState(file.path);
  }
  getLiveMarkers(markerId) {
    return {
      startMarker: `${DocumentInserter.LIVE_MARKER_START_PREFIX}${markerId} -->`,
      endMarker: `${DocumentInserter.LIVE_MARKER_END_PREFIX}${markerId} -->`
    };
  }
  buildLiveTranscriptionBlock(startMarker, endMarker, transcription, collapsed) {
    const body = transcription.trim().length > 0 ? transcription.trim() : "(listening...)";
    const quoted = body.split("\n").map((line) => `> ${line}`).join("\n");
    const foldMarker = collapsed ? "-" : "+";
    return `>[!info]${foldMarker} Live Transcription (In Progress)
> Type: live-transcription
> Recorded: ${new Date().toISOString()}
>
${quoted}
> ${startMarker}
> ${endMarker}
`;
  }
  getLiveCalloutCollapsedState(filePath) {
    const key = DocumentInserter.buildLiveStateKey(filePath);
    if (!key)
      return void 0;
    return DocumentInserter.liveCalloutCollapsedState.get(key);
  }
  clearLiveCalloutCollapsedState(filePath) {
    const key = DocumentInserter.buildLiveStateKey(filePath);
    if (!key)
      return;
    DocumentInserter.liveCalloutCollapsedState.delete(key);
  }
  static buildLiveStateKey(filePath) {
    const note = (filePath || "").trim();
    if (!note)
      return null;
    return note;
  }
  findLiveRegion(fileContent, startMarker, endMarker) {
    const startMarkerIndex = fileContent.indexOf(startMarker);
    if (startMarkerIndex === -1)
      return null;
    const endMarkerIndex = fileContent.indexOf(endMarker, startMarkerIndex);
    if (endMarkerIndex === -1)
      return null;
    let start = startMarkerIndex;
    const before = fileContent.slice(0, startMarkerIndex);
    const calloutHeaderRegex = /^>\[![^\]]+\][^\n]*$/gm;
    let headerMatch = calloutHeaderRegex.exec(before);
    let lastHeader = null;
    while (headerMatch) {
      lastHeader = headerMatch;
      headerMatch = calloutHeaderRegex.exec(before);
    }
    if (lastHeader && lastHeader.index !== void 0) {
      start = lastHeader.index;
    }
    let end = endMarkerIndex + endMarker.length;
    if (fileContent[end] === "\n") {
      end += 1;
    }
    return { start, end };
  }
  stripAllLegacyLiveBlocks(fileContent) {
    var _a;
    const startRegex = /<!--\s*neurovox:live:start:([a-zA-Z0-9_\-]+)\s*-->/g;
    let removedCount = 0;
    let updated = fileContent;
    let offset = 0;
    let match = startRegex.exec(fileContent);
    while (match) {
      const markerId = match[1];
      const markerIndex = ((_a = match.index) != null ? _a : 0) - offset;
      let absoluteStart = markerIndex;
      const before = updated.slice(0, markerIndex);
      const calloutHeaderRegex = /^>\[![^\]]+\][^\n]*$/gm;
      let headerMatch = calloutHeaderRegex.exec(before);
      let lastHeader = null;
      while (headerMatch) {
        lastHeader = headerMatch;
        headerMatch = calloutHeaderRegex.exec(before);
      }
      if (lastHeader && lastHeader.index !== void 0) {
        absoluteStart = lastHeader.index;
      }
      const { endMarker } = this.getLiveMarkers(markerId);
      const endIndex = updated.indexOf(endMarker, markerIndex);
      if (endIndex === -1) {
        match = startRegex.exec(fileContent);
        continue;
      }
      let absoluteEnd = endIndex + endMarker.length;
      if (updated[absoluteEnd] === "\n") {
        absoluteEnd += 1;
      }
      updated = `${updated.slice(0, absoluteStart)}${updated.slice(absoluteEnd)}`;
      removedCount += 1;
      offset += absoluteEnd - absoluteStart;
      match = startRegex.exec(fileContent);
    }
    return { content: updated, removedCount };
  }
  validateTemplates() {
    const transcriptionTemplate = this.plugin.settings.transcriptionCalloutFormat || "";
    if (!transcriptionTemplate.includes("{transcription}")) {
      throw new Error("Transcription template must include {transcription} placeholder");
    }
    const postTemplate = this.plugin.settings.postProcessingCalloutFormat || "";
    if (this.plugin.settings.generatePostProcessing && !postTemplate.includes("{postProcessing}")) {
      throw new Error("Post-processing template must include {postProcessing} placeholder");
    }
  }
  buildDefaultEntryTitle() {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    return `Transcription - ${timeLabel}`;
  }
  applyEntryTitle(content, title) {
    if (!title)
      return content;
    const calloutTitleRegex = /(^|\n)(>\[![^\]]+\][^\n]*)/;
    const match = calloutTitleRegex.exec(content);
    if (!match) {
      return `## ${title}

${content}`;
    }
    const existingLine = match[2];
    const replacedLine = existingLine.replace(/(>\[![^\]]+\][-+])\s*.*/, `$1 ${title}`);
    if (replacedLine === existingLine) {
      const fallback = existingLine.replace(/(>\[![^\]]+\])\s*.*/, `$1- ${title}`);
      return content.replace(existingLine, fallback);
    }
    return content.replace(existingLine, replacedLine);
  }
  buildEntryMarker(hash, meta) {
    if (meta) {
      return buildEntryMarkerComment(meta, hash);
    }
    const fallbackMeta = {
      id: `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: "",
      recordedAtIso: new Date().toISOString()
    };
    return buildEntryMarkerComment(fallbackMeta, hash);
  }
  injectEntryMarkerIntoCallout(content, entryMarker) {
    if (!entryMarker.trim() || content.includes(entryMarker))
      return content;
    const headerMatch = /(>\[![^\]]+\][^\n]*)(\n|$)/.exec(content);
    if (!headerMatch || headerMatch.index === void 0)
      return content;
    const insertAt = headerMatch.index + headerMatch[0].length;
    return `${content.slice(0, insertAt)}> ${entryMarker}
${content.slice(insertAt)}`;
  }
  injectCalloutMetadata(content, metadata) {
    const headerMatch = /(>\[![^\]]+\][^\n]*)(\n|$)/.exec(content);
    if (!headerMatch || headerMatch.index === void 0)
      return content;
    const insertAt = headerMatch.index + headerMatch[0].length;
    const lines = [];
    if (metadata.sourcePath && !/^\s*(?:>\s*)*Source:\s+/im.test(content)) {
      lines.push(`> Source: ${metadata.sourcePath}`);
    }
    if (metadata.recordedAtIso && !/^\s*(?:>\s*)*Recorded:\s+/im.test(content)) {
      lines.push(`> Recorded: ${metadata.recordedAtIso}`);
    }
    if (!/^\s*(?:>\s*)*Type:\s+/im.test(content)) {
      lines.push("> Type: audio-transcription");
    }
    if (metadata.sourceSizeMb && !/^\s*(?:>\s*)*Size:\s+/im.test(content)) {
      lines.push(`> Size: ${metadata.sourceSizeMb}MB`);
    }
    if (lines.length === 0)
      return content;
    return `${content.slice(0, insertAt)}${lines.join("\n")}
>
${content.slice(insertAt)}`;
  }
  computeContentHash(content) {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) + hash ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }
}
