#!/usr/bin/env node
// Sub-commit 2: re-derive import statements across src-rebuild/.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/nikunjjajodia/transcriber-pro/src-rebuild';

const SUMMARY = {
  filesScanned: 0,
  obsidianImportsEmitted: 0,
  recordrtcImportsEmitted: 0,
  ffmpegImportsEmitted: 0,
  internalImportsEmittedTotal: 0,
  filesWithObsidianImport: 0,
  filesWithRecordrtcImport: 0,
  filesWithFFmpegImport: 0,
  filesWithInternalImports: 0,
  ambiguousIdentifiers: [],
  unresolvedIdentifiers: [],
  obsidianAliasLinesDropped: 0,
};

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const symbolMap = new Map();
function addSymbol(name, file) {
  if (!symbolMap.has(name)) symbolMap.set(name, []);
  const files = symbolMap.get(name);
  if (!files.includes(file)) files.push(file);
}

function collectTopLevelSymbols(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const symbols = [];
  for (const line of lines) {
    let m;
    if ((m = /^class ([A-Z][A-Za-z0-9_]*)/.exec(line))) symbols.push(m[1]);
    else if ((m = /^function ([A-Za-z_][A-Za-z0-9_]*)/.exec(line))) symbols.push(m[1]);
    else if ((m = /^async function ([A-Za-z_][A-Za-z0-9_]*)/.exec(line))) symbols.push(m[1]);
    else if ((m = /^var ([A-Za-z_][A-Za-z0-9_]*) = /.exec(line))) symbols.push(m[1]);
    else if ((m = /^const ([A-Za-z_][A-Za-z0-9_]*) = /.exec(line))) symbols.push(m[1]);
    else if ((m = /^let ([A-Za-z_][A-Za-z0-9_]*) = /.exec(line))) symbols.push(m[1]);
  }
  return symbols;
}

const files = listTsFiles(ROOT);
for (const file of files) {
  const syms = collectTopLevelSymbols(file);
  for (const s of syms) {
    if (/^import_obsidian\d*$/.test(s)) continue;
    if (s === 'import_recordrtc') continue;
    addSymbol(s, file);
  }
}

// Standard runtime + DOM globals.
const GLOBALS = new Set([
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'DOMException',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect', 'JSON',
  'Math', 'NaN', 'Infinity', 'undefined', 'null', 'true', 'false', 'this',
  'console', 'window', 'document', 'navigator', 'globalThis', 'self', 'process',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'Request', 'Response', 'Headers', 'URL', 'URLSearchParams',
  'Blob', 'File', 'FileReader', 'FormData', 'AbortController', 'AbortSignal',
  'Event', 'CustomEvent', 'EventTarget', 'MessageChannel', 'MessagePort',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'SharedArrayBuffer',
  'TextEncoder', 'TextDecoder', 'btoa', 'atob', 'crypto', 'performance',
  'AudioContext', 'AudioWorkletNode', 'AudioBuffer', 'MediaStream', 'MediaStreamTrack',
  'MediaRecorder', 'MediaStreamAudioSourceNode', 'WebSocket', 'XMLHttpRequest',
  'HTMLElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSpanElement',
  'HTMLImageElement', 'HTMLAudioElement', 'HTMLVideoElement', 'HTMLCanvasElement',
  'HTMLAnchorElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLLabelElement',
  'HTMLOptionElement', 'HTMLFormElement', 'HTMLLinkElement', 'HTMLScriptElement',
  'Element', 'Node', 'Text', 'Comment', 'Touch', 'TouchEvent', 'TouchList',
  'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'WheelEvent', 'InputEvent',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'PerformanceObserver',
  'IDBDatabase', 'IDBObjectStore', 'IDBTransaction', 'indexedDB',
  'CSSStyleSheet', 'StyleSheet', 'getComputedStyle',
  'Worker', 'SharedWorker', 'Notification',
  'showOpenFilePicker', 'showSaveFilePicker',
  'localStorage', 'sessionStorage', 'caches',
  'NodeFilter',
  'module', 'exports', 'require', '__dirname', '__filename', 'global',
  'arguments', 'super',
]);

function collectLocalDecls(src) {
  const locals = new Set();
  // Function/arrow headers `(params) {` or `(params) =>`.
  const headerRe = /\(([^()]*)\)\s*(\{|=>)/g;
  let m;
  while ((m = headerRe.exec(src))) {
    const params = m[1];
    for (const part of params.split(',')) {
      const name = part.trim().split(/[:= ]/)[0].replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) locals.add(name);
    }
  }
  const catchRe = /\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/g;
  while ((m = catchRe.exec(src))) locals.add(m[1]);
  // Multi-declarator var/let/const.
  const multiDeclRe = /\b(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)*)/g;
  while ((m = multiDeclRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) locals.add(name);
    }
  }
  const forRe = /\bfor\s*\(\s*(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = forRe.exec(src))) locals.add(m[1]);
  const classRe = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = classRe.exec(src))) locals.add(m[1]);
  const fdRe = /\b(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = fdRe.exec(src))) locals.add(m[1]);
  // Class static fields: `  static NAME = ...;` — treat as declared in file scope so
  // `ClassName.NAME` access elsewhere doesn't re-flag NAME as unresolved.
  const staticFieldRe = /^\s*static\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
  while ((m = staticFieldRe.exec(src))) locals.add(m[1]);
  return locals;
}

function stripStringsAndComments(src) {
  const out = [];
  let i = 0;
  let inLine = false, inBlock = false, inStr = null, inRegex = false, inCharClass = false;
  const tplStack = [];
  const KEYWORDS_BEFORE_REGEX = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'else', 'do', 'yield', 'await', 'case',
  ]);
  function isRegexContext() {
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (j < 0) return true;
    const prev = out[j];
    if ('([{,;=:?!&|+-*%~^<>'.includes(prev)) return true;
    if (/[A-Za-z_$]/.test(prev)) {
      let k = j;
      while (k >= 0 && /[A-Za-z_$0-9]/.test(out[k])) k--;
      const word = out.slice(k + 1, j + 1).join('');
      return KEYWORDS_BEFORE_REGEX.has(word);
    }
    return false;
  }
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    const inTemplate = tplStack.length && tplStack[tplStack.length - 1].active;
    if (inLine) { out.push(c === '\n' ? '\n' : ' '); if (c === '\n') inLine = false; i++; continue; }
    if (inBlock) {
      if (c === '*' && next === '/') { out.push('  '); i += 2; inBlock = false; continue; }
      out.push(c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (inStr) {
      if (c === '\\') { out.push('  '); i += 2; continue; }
      if (c === inStr) { out.push(' '); inStr = null; i++; continue; }
      out.push(c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (inTemplate) {
      if (c === '\\') { out.push('  '); i += 2; continue; }
      if (c === '`') { tplStack.pop(); out.push(' '); i++; continue; }
      if (c === '$' && next === '{') { tplStack[tplStack.length-1].active = false; out.push('  '); i += 2; continue; }
      out.push(c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (inRegex) {
      if (c === '\\') { out.push('  '); i += 2; continue; }
      if (c === '[' && !inCharClass) { inCharClass = true; out.push(' '); i++; continue; }
      if (c === ']' && inCharClass) { inCharClass = false; out.push(' '); i++; continue; }
      if (c === '/' && !inCharClass) {
        out.push(' '); i++; inRegex = false;
        while (i < src.length && /[gimsuy]/.test(src[i])) { out.push(' '); i++; }
        continue;
      }
      out.push(c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (c === '/' && next === '/') { inLine = true; out.push('  '); i += 2; continue; }
    if (c === '/' && next === '*') { inBlock = true; out.push('  '); i += 2; continue; }
    if (c === '/') {
      if (isRegexContext()) { inRegex = true; inCharClass = false; out.push(' '); i++; continue; }
    }
    if (c === '"' || c === "'") { inStr = c; out.push(' '); i++; continue; }
    if (c === '`') { tplStack.push({ active: true }); out.push(' '); i++; continue; }
    if (c === '}' && tplStack.length && !tplStack[tplStack.length-1].active) {
      tplStack[tplStack.length-1].active = true;
      out.push(' '); i++; continue;
    }
    out.push(c); i++;
  }
  return out.join('');
}

function rewriteFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const relFile = file.replace(ROOT + '/', '');
  const obsidianSyms = new Set();
  let needsRecordRTC = false;
  const ffmpegSyms = new Set();

  // 1. Strip obsidian alias decls and consolidate references. Some chunked files
  //    (MobileDockPill, DesktopDockPill, UploadBottomSheet) reference an alias
  //    (e.g. `import_obsidian16`) that was declared in a sibling chunk of the bundle
  //    but ended up in a different split file. We match BOTH the alias decl
  //    pattern and any orphan `import_obsidianN.X` reference.
  const obsidianAliasRe = /^var (import_obsidian\d*) = require\("obsidian"\);\n/gm;
  const aliasNames = [];
  let m;
  while ((m = obsidianAliasRe.exec(src))) aliasNames.push(m[1]);
  if (aliasNames.length) {
    src = src.replace(obsidianAliasRe, '');
    SUMMARY.obsidianAliasLinesDropped += aliasNames.length;
  }
  // Collect all `import_obsidianN.X` refs in the file (declared or orphaned).
  const allObsidianRefRe = /\bimport_obsidian\d*\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let r;
  while ((r = allObsidianRefRe.exec(src))) obsidianSyms.add(r[1]);
  src = src.replace(allObsidianRefRe, (_, name) => name);

  // 2. Recordrtc.
  if (src.includes('import_recordrtc')) {
    src = src.replace(/\bimport_recordrtc\.default\b/g, 'RecordRTC');
    needsRecordRTC = true;
  }

  // 3. FFmpeg in VideoProcessor.
  if (relFile === 'utils/VideoProcessor.ts') {
    if (/\bFFmpeg\b/.test(src)) ffmpegSyms.add('@ffmpeg/ffmpeg::FFmpeg');
    if (/\bfetchFile\b/.test(src)) ffmpegSyms.add('@ffmpeg/util::fetchFile');
    if (/\btoBlobURL\b/.test(src)) ffmpegSyms.add('@ffmpeg/util::toBlobURL');
  }

  // 4. Re-derive internal imports.
  const stripped = stripStringsAndComments(src);
  const localDecls = collectLocalDecls(src);
  const ownSymbols = new Set(collectTopLevelSymbols(file));

  // Lookbehind: skip identifiers preceded by another word char (continuation of a
  // larger identifier) or by a single `.` (member access, e.g. `obj.foo`).
  // The double `.` of a spread/rest (`...foo`) is allowed: the inner lookbehind
  // requires a non-`.` immediately before the `.`, so `..` and `...` slip through.
  const idRe = /(?<!\w)(?<![^.]\.)([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const seen = new Set();
  // r reused from above
  while ((r = idRe.exec(stripped))) {
    const name = r[1];
    if (seen.has(name)) continue;
    if (GLOBALS.has(name)) continue;
    if (localDecls.has(name)) continue;
    if (ownSymbols.has(name)) continue;
    if (obsidianSyms.has(name)) continue;
    if (name === 'RecordRTC' && needsRecordRTC) continue;
    if (ffmpegSyms.has(`@ffmpeg/ffmpeg::${name}`) || ffmpegSyms.has(`@ffmpeg/util::${name}`)) continue;
    if (/^import_/.test(name)) continue;
    // esbuild-style transient locals
    if (/^_[a-z]\d?$/.test(name)) continue;
    if (name.startsWith('_')) continue;
    if (!/^[A-Z]/.test(name) && !symbolMap.has(name)) continue;
    seen.add(name);
  }

  const internalImportsByModule = new Map();
  const ambiguous = [];
  const unresolved = [];
  for (const name of seen) {
    if (!symbolMap.has(name)) {
      unresolved.push({ file: relFile, name });
      continue;
    }
    const candidates = symbolMap.get(name).filter((c) => c !== file);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      ambiguous.push({ name, candidates: candidates.map((c) => c.replace(ROOT + '/', '')) });
    }
    const target = candidates[0];
    if (!internalImportsByModule.has(target)) internalImportsByModule.set(target, new Set());
    internalImportsByModule.get(target).add(name);
  }

  let header = '';
  if (obsidianSyms.size) {
    header += `import { ${[...obsidianSyms].sort().join(', ')} } from 'obsidian';\n`;
    SUMMARY.obsidianImportsEmitted += obsidianSyms.size;
    SUMMARY.filesWithObsidianImport += 1;
  }
  if (needsRecordRTC) {
    header += `import RecordRTC from 'recordrtc';\n`;
    SUMMARY.recordrtcImportsEmitted += 1;
    SUMMARY.filesWithRecordrtcImport += 1;
  }
  if (ffmpegSyms.size) {
    const byModule = new Map();
    for (const ks of ffmpegSyms) {
      const [mod, sym] = ks.split('::');
      if (!byModule.has(mod)) byModule.set(mod, new Set());
      byModule.get(mod).add(sym);
    }
    for (const [mod, set] of byModule) {
      header += `import { ${[...set].sort().join(', ')} } from '${mod}';\n`;
      SUMMARY.ffmpegImportsEmitted += 1;
    }
    SUMMARY.filesWithFFmpegImport += 1;
  }
  const dirOfFile = path.dirname(file);
  const internalLines = [];
  for (const [target, set] of internalImportsByModule) {
    let rel = path.relative(dirOfFile, target).replace(/\.ts$/, '');
    if (!rel.startsWith('.')) rel = './' + rel;
    const symsList = [...set].sort();
    const ambigForLine = symsList.filter((s) => ambiguous.some((a) => a.name === s));
    let line = `import { ${symsList.join(', ')} } from '${rel}';`;
    if (ambigForLine.length) {
      const todos = ambigForLine.map((s) => {
        const cands = ambiguous.find((a) => a.name === s).candidates;
        return `// TODO(unit-3-ambiguous): ${s} is defined in multiple files: ${cands.join(', ')} — pick one`;
      });
      line = todos.join('\n') + '\n' + line;
    }
    internalLines.push(line);
    SUMMARY.internalImportsEmittedTotal += 1;
  }
  internalLines.sort();
  if (internalLines.length) {
    header += internalLines.join('\n') + '\n';
    SUMMARY.filesWithInternalImports += 1;
  }
  for (const a of ambiguous) SUMMARY.ambiguousIdentifiers.push({ file: relFile, ...a });
  for (const u of unresolved) SUMMARY.unresolvedIdentifiers.push(u);

  if (header) src = header + '\n' + src.replace(/^\n+/, '');
  fs.writeFileSync(file, src);
  SUMMARY.filesScanned += 1;
}

for (const file of files) {
  rewriteFile(file);
}

const out = {
  ...SUMMARY,
  ambiguousIdentifierCount: SUMMARY.ambiguousIdentifiers.length,
  unresolvedIdentifierCount: SUMMARY.unresolvedIdentifiers.length,
};
console.log(JSON.stringify(out, null, 2));
