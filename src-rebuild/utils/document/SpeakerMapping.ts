var SPEAKER_MAPPING_HEADER = "## Speaker Mapping";
var ENTRY_MAPPING_START_PREFIX = "<!-- neurovox:mapping:start:";
var ENTRY_MAPPING_END_PREFIX = "<!-- neurovox:mapping:end:";
export function extractSpeakerLabels(transcript) {
  const labelIds = /* @__PURE__ */ new Set();
  const timePrefix = "(?:(?:\\[[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\\]|\\[\\[t=[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\\]\\])\\s+)?";
  const regex = new RegExp(`(^|\\n)\\s*(?:>\\s*)*${timePrefix}Speaker\\s+(\\d+):`, "g");
  let match = regex.exec(transcript);
  while (match) {
    const id = Number(match[2]);
    if (Number.isFinite(id) && id >= 0) {
      labelIds.add(id);
    }
    match = regex.exec(transcript);
  }
  return Array.from(labelIds).sort((a, b) => a - b).map((id) => `Speaker ${id}`);
}
export function hasSpeakerMappingSection(noteContent) {
  return /^\s*(?:>\s*)*(?:\[[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\]\s+)?## Speaker Mapping\s*$/m.test(noteContent);
}
export function buildEntrySpeakerMappingSection(labels, entryId) {
  if (labels.length === 0)
    return "";
  const lines = [
    SPEAKER_MAPPING_HEADER,
    `${ENTRY_MAPPING_START_PREFIX}${entryId} -->`,
    ...labels.map((label) => `- [ ] ${label}: `),
    `${ENTRY_MAPPING_END_PREFIX}${entryId} -->`
  ];
  return `${lines.join("\n")}
`;
}
export function applySpeakerMappingToEntry(noteContent, entryId, entryStart, entryEnd) {
  const entryContent = noteContent.slice(entryStart, entryEnd);
  const mappingRegion = findEntryMappingRegion(entryContent, entryId);
  if (!mappingRegion) {
    return { updatedContent: noteContent, replacedCount: 0, mappedSpeakers: 0 };
  }
  const mapping = parseSpeakerNameMap(mappingRegion.sectionContent);
  if (mapping.size === 0) {
    return { updatedContent: noteContent, replacedCount: 0, mappedSpeakers: 0 };
  }
  const beforeMapping = entryContent.slice(0, mappingRegion.startIndex);
  const mappingBlock = entryContent.slice(mappingRegion.startIndex, mappingRegion.endIndex);
  const afterMapping = entryContent.slice(mappingRegion.endIndex);
  const inferredAliases = inferAliasesFromDiarizedLines(entryContent, Array.from(mapping.keys()));
  const appliedBefore = applyMapToText(beforeMapping, mapping, inferredAliases);
  const appliedAfter = applyMapToText(afterMapping, mapping, inferredAliases);
  const replacedCount = appliedBefore.replaced + appliedAfter.replaced;
  const updatedEntry = `${appliedBefore.text}${mappingBlock}${appliedAfter.text}`;
  const updatedContent = `${noteContent.slice(0, entryStart)}${updatedEntry}${noteContent.slice(entryEnd)}`;
  return {
    updatedContent,
    replacedCount,
    mappedSpeakers: mapping.size
  };
}
export function hasEntrySpeakerMappingSection(entryContent, entryId) {
  return findEntryMappingRegion(entryContent, entryId) !== null;
}
function findEntryMappingRegion(entryContent, entryId) {
  const startMarker = `${ENTRY_MAPPING_START_PREFIX}${entryId} -->`;
  const endMarker = `${ENTRY_MAPPING_END_PREFIX}${entryId} -->`;
  const startRegex = new RegExp(`^\\s*(?:>\\s*)*${escapeForRegExp(startMarker)}\\s*$`, "m");
  const endRegex = new RegExp(`^\\s*(?:>\\s*)*${escapeForRegExp(endMarker)}\\s*$`, "m");
  const startMatch = startRegex.exec(entryContent);
  if (!startMatch || startMatch.index === void 0)
    return null;
  const start = startMatch.index;
  const afterStart = start + startMatch[0].length;
  const endSearch = entryContent.slice(afterStart);
  const endMatch = endRegex.exec(endSearch);
  if (!endMatch || endMatch.index === void 0)
    return null;
  const endMarkerIndex = afterStart + endMatch.index;
  let end = endMarkerIndex + endMatch[0].length;
  while (end < entryContent.length && (entryContent[end] === "\n" || entryContent[end] === "\r")) {
    end += 1;
  }
  const headerRegex = /^\s*(?:>\s*)*(?:\[[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\]\s+)?## Speaker Mapping\s*$/gm;
  const before = entryContent.slice(0, start);
  let headerStart = start;
  let headerMatch = headerRegex.exec(before);
  let lastMatch = null;
  while (headerMatch) {
    lastMatch = headerMatch;
    headerMatch = headerRegex.exec(before);
  }
  if (lastMatch && lastMatch.index !== void 0) {
    const candidateStart = lastMatch.index;
    const candidateEnd = candidateStart + lastMatch[0].length;
    const between = entryContent.slice(candidateEnd, start);
    if (/^\s*$/.test(between)) {
      headerStart = candidateStart;
    }
  }
  return {
    startIndex: headerStart,
    endIndex: end,
    sectionContent: entryContent.slice(headerStart, end)
  };
}
function parseSpeakerNameMap(section) {
  const map = /* @__PURE__ */ new Map();
  const lines = section.split("\n");
  for (const line of lines) {
    const match = /^\s*(?:>\s*)*-\s*\[[ xX]\]\s*Speaker\s+(\d+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!match)
      continue;
    const id = Number(match[1]);
    const name = match[2].trim();
    if (!Number.isFinite(id) || id <= 0 || !name)
      continue;
    map.set(id, name);
  }
  return map;
}
function applyMapToText(text, mapping, inferredAliases) {
  let replaced = 0;
  let updated = text;
  const entries = Array.from(mapping.entries()).sort((a, b) => b[0] - a[0]);
  const applyLabel = (sourceLabel, targetName) => {
    const escapedSource = escapeForRegExp(sourceLabel);
    const pattern = new RegExp(
      `(^|\\n)(\\s*(?:>\\s*)*(?:(?:\\[[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\\]|\\[\\[t=[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\\]\\])\\s+)?)${escapedSource}\\s*:`,
      "gi"
    );
    updated = updated.replace(pattern, (_match, p1, p2) => {
      replaced += 1;
      return `${p1}${p2}${targetName}:`;
    });
  };
  for (const [id, name] of entries) {
    const sourceLabels = /* @__PURE__ */ new Set([`Speaker ${id}`]);
    const inferred = inferredAliases.get(id);
    if (inferred && inferred !== name) {
      sourceLabels.add(inferred);
    }
    for (const sourceLabel of sourceLabels) {
      applyLabel(sourceLabel, name);
    }
    applyLabel(`Speaker${id}`, name);
  }
  if (mapping.size === 1) {
    const firstName = entries[0][1];
    applyLabel("Speaker", firstName);
  }
  return { text: updated, replaced };
}
function inferAliasesFromDiarizedLines(content, speakerIds) {
  const labelsInOrder = [];
  const seen = /* @__PURE__ */ new Set();
  const lineRegex = /(^|\n)\s*(?:>\s*)*(?:\[[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\]|\[\[t=[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\]\])\s+([^:\n]{1,80}):/g;
  let match = lineRegex.exec(content);
  while (match) {
    const label = (match[2] || "").trim();
    if (!label || /^Speaker\s+\d+$/i.test(label)) {
      match = lineRegex.exec(content);
      continue;
    }
    if (!seen.has(label)) {
      seen.add(label);
      labelsInOrder.push(label);
    }
    match = lineRegex.exec(content);
  }
  const idsSorted = [...speakerIds].sort((a, b) => a - b);
  const out = /* @__PURE__ */ new Map();
  for (let i = 0; i < idsSorted.length; i++) {
    const inferred = labelsInOrder[i];
    if (!inferred)
      continue;
    out.set(idsSorted[i], inferred);
  }
  return out;
}
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
