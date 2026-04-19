var ENTRY_MARKER_REGEX = /<!--\s*neurovox:entry:([^\n]*?)\s*-->/g;
var ENTRY_META_REGEX = /<!--\s*neurovox:entry-meta:({[\s\S]*?})\s*-->/;
export function createEntryMeta(title: any) {
  const recordedAtIso = new Date().toISOString();
  return {
    id: `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    recordedAtIso
  };
}
export function buildEntryMarkerComment(meta: any, hash: any) {
  const compactPayload = `id=${meta.id};hash=${hash}`;
  return `<!-- neurovox:entry:${compactPayload} -->`;
}
export function findEntryRegions(noteContent: any) {
  const markers: any[] = Array.from(noteContent.matchAll(ENTRY_MARKER_REGEX));
  if (markers.length === 0)
    return [];
  const starts = markers.map((match) => {
    var _a;
    const markerStart = (_a = match.index) != null ? _a : 0;
    const markerLineStart = noteContent.lastIndexOf("\n", markerStart) + 1;
    const markerLineEnd = noteContent.indexOf("\n", markerStart);
    const markerLine = markerLineEnd === -1 ? noteContent.slice(markerLineStart) : noteContent.slice(markerLineStart, markerLineEnd);
    const inQuotedCallout = /^\s*>\s*<!--\s*neurovox:entry:/i.test(markerLine);
    if (!inQuotedCallout)
      return markerStart;
    const before = noteContent.slice(0, markerStart);
    const calloutHeaderRegex = /^>\[![^\]]+\][^\n]*$/gm;
    let calloutHeaderMatch = calloutHeaderRegex.exec(before);
    let lastHeader = null;
    while (calloutHeaderMatch) {
      lastHeader = calloutHeaderMatch;
      calloutHeaderMatch = calloutHeaderRegex.exec(before);
    }
    return lastHeader && lastHeader.index !== void 0 ? lastHeader.index : markerStart;
  });
  return markers.map((match, index) => {
    var _a, _b;
    const markerText = match[0];
    const markerPayload = (match[1] || "").trim();
    const markerStart = (_a = match.index) != null ? _a : 0;
    const start = (_b = starts[index]) != null ? _b : markerStart;
    const nextStart = starts[index + 1];
    const end = typeof nextStart === "number" ? nextStart : noteContent.length;
    const raw = noteContent.slice(start, end);
    let meta = null;
    const markerMeta = parseMetaFromMarkerPayload(markerPayload);
    if (markerMeta) {
      meta = markerMeta;
    } else {
      const metaMatch = raw.match(ENTRY_META_REGEX);
      if (!(metaMatch == null ? void 0 : metaMatch[1])) {
        return {
          markerStart,
          start,
          end,
          markerLine: markerText,
          meta
        };
      }
      try {
        const parsed = JSON.parse(metaMatch[1]);
        if (parsed && typeof parsed.id === "string") {
          meta = {
            id: parsed.id,
            title: typeof parsed.title === "string" ? parsed.title : "",
            recordedAtIso: typeof parsed.recordedAtIso === "string" ? parsed.recordedAtIso : ""
          };
        }
      } catch (e) {
        meta = null;
      }
    }
    return {
      markerStart,
      start,
      end,
      markerLine: markerText,
      meta
    };
  });
}
function parseMetaFromMarkerPayload(payloadRaw: any) {
  if (!payloadRaw)
    return null;
  if (payloadRaw[0] !== "{") {
    const compact = parseCompactMarkerPayload(payloadRaw);
    if (!compact)
      return null;
    return {
      id: compact.id,
      title: compact.title || "",
      recordedAtIso: compact.recordedAtIso || ""
    };
  }
  try {
    const parsed = JSON.parse(payloadRaw);
    if (!parsed || typeof parsed.id !== "string")
      return null;
    return {
      id: parsed.id,
      title: typeof parsed.title === "string" ? parsed.title : "",
      recordedAtIso: typeof parsed.recordedAtIso === "string" ? parsed.recordedAtIso : ""
    };
  } catch (e) {
    return null;
  }
}
function parseCompactMarkerPayload(payloadRaw: any) {
  const pairs = payloadRaw.split(";").map((part: any) => part.trim()).filter(Boolean).map((part: any) => {
    const idx = part.indexOf("=");
    if (idx === -1)
      return null;
    return {
      key: part.slice(0, idx).trim(),
      value: part.slice(idx + 1).trim()
    };
  }).filter((item: any) => !!item);
  if (pairs.length === 0)
    return null;
  const kv = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    kv.set(pair.key, pair.value);
  }
  const id = kv.get("id");
  if (!id)
    return null;
  return {
    id,
    title: kv.get("title"),
    recordedAtIso: kv.get("recordedAtIso")
  };
}
export function findEntryRegionAtPosition(noteContent: any, position: any) {
  const entries = findEntryRegions(noteContent);
  if (entries.length === 0)
    return null;
  const offset = positionToOffset(noteContent, position);
  const matched = entries.find((entry) => offset >= entry.start && offset < entry.end);
  if (matched)
    return matched;
  return entries[entries.length - 1];
}
function positionToOffset(content: any, position: any) {
  var _a, _b, _c, _d;
  const lines = content.split("\n");
  const safeLine = Math.max(0, Math.min(position.line, Math.max(0, lines.length - 1)));
  const safeCh = Math.max(0, Math.min(position.ch, (_b = (_a = lines[safeLine]) == null ? void 0 : _a.length) != null ? _b : 0));
  let offset = 0;
  for (let i = 0; i < safeLine; i++) {
    offset += ((_d = (_c = lines[i]) == null ? void 0 : _c.length) != null ? _d : 0) + 1;
  }
  offset += safeCh;
  return offset;
}
