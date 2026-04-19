#!/usr/bin/env node
// Sub-commit 1: strip esbuild runtime helper residuals across src-rebuild/.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/nikunjjajodia/transcriber-pro/src-rebuild';

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SUMMARY = {
  classTagNormalizations: 0,
  staticFieldsLifted: 0,
  staticFieldsKeptOutside: 0,
  recordrtcShimsStripped: 0,
  mainExportHeaderStripped: false,
  mainLicenseFooterStripped: false,
  mainExportDefaultEmitted: false,
  filesTouched: 0,
  classTagFiles: [],
  staticTdzKeptFiles: [],
};

// Tokens after which `/` begins a regex literal (vs division).
const REGEX_PRECEDED_BY = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', 'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await', 'case',
]);

function lastSignificant(src, i) {
  // Walk backwards skipping whitespace; return the last token-like substring or character.
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return null;
  const c = src[j];
  if (/[A-Za-z_$0-9]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z_$0-9]/.test(src[k])) k--;
    return src.slice(k + 1, j + 1);
  }
  return c;
}

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let inCharClass = false;
  const tplStack = [];
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    const inTemplate = tplStack.length && tplStack[tplStack.length - 1].active;
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inRegex) {
      if (c === '\\') { i++; continue; }
      if (c === '[' && !inCharClass) { inCharClass = true; continue; }
      if (c === ']' && inCharClass) { inCharClass = false; continue; }
      if (c === '/' && !inCharClass) { inRegex = false; continue; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') { i++; continue; }
      if (c === '`') { tplStack.pop(); continue; }
      if (c === '$' && next === '{') {
        tplStack[tplStack.length - 1].active = false;
        tplStack[tplStack.length - 1].interpDepth = depth;
        i++;
        continue;
      }
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '/') {
      // Could be regex literal or division. Inspect context.
      const prev = lastSignificant(src, i);
      if (prev === null || REGEX_PRECEDED_BY.has(prev)) {
        inRegex = true;
        inCharClass = false;
        continue;
      }
      // Otherwise treat as division operator — fall through.
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { tplStack.push({ active: true }); continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') {
      if (tplStack.length && !tplStack[tplStack.length - 1].active && depth === tplStack[tplStack.length - 1].interpDepth) {
        tplStack[tplStack.length - 1].active = true;
        delete tplStack[tplStack.length - 1].interpDepth;
        continue;
      }
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function rewriteMainTs(file) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  const headerRe = /^var main_exports = \{\};\n__export\(main_exports, \{[\s\S]*?\}\);\nmodule\.exports = __toCommonJS\(main_exports\);\n/;
  if (headerRe.test(out)) {
    out = out.replace(headerRe, '');
    SUMMARY.mainExportHeaderStripped = true;
  }
  const footerRe = /\n\/\*! Bundled license information:[\s\S]*\*\/\s*$/;
  if (footerRe.test(out)) {
    out = out.replace(footerRe, '\n');
    SUMMARY.mainLicenseFooterStripped = true;
  }
  if (SUMMARY.mainExportHeaderStripped && !out.includes('export default NeuroVoxPlugin')) {
    if (!out.endsWith('\n')) out += '\n';
    out += '\nexport default NeuroVoxPlugin;\n';
    SUMMARY.mainExportDefaultEmitted = true;
  }
  if (out !== src) fs.writeFileSync(file, out);
}

function dropRecordrtcShim(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(
    /^var import_recordrtc = __toESM\(require_RecordRTC\(\)\);\n+/m,
    '',
  );
  if (out !== src) {
    SUMMARY.recordrtcShimsStripped += 1;
    fs.writeFileSync(file, out);
  }
}

function rewriteClassTags(file) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;
  const touchedClassNames = [];

  while (true) {
    const re = /^var _([A-Z][A-Za-z0-9_]*) = class( extends [^\n{]+)? \{$/m;
    const m = re.exec(src);
    if (!m) break;
    const className = m[1];
    const extendsClause = m[2] || '';
    const declStart = m.index;
    const openBraceIdx = src.indexOf('{', declStart + m[0].length - 1);
    const closeBraceIdx = findMatchingBrace(src, openBraceIdx);
    if (closeBraceIdx < 0) {
      console.error(`[helper-stripper] could not find matching brace for _${className} in ${file}`);
      break;
    }
    const afterClose = src.slice(closeBraceIdx + 1);
    const aliasRe = new RegExp(`^;\\nvar ${className} = _${className};\\n`);
    const aliasMatch = aliasRe.exec(afterClose);
    if (!aliasMatch) {
      console.error(`[helper-stripper] could not find alias line for _${className} in ${file}`);
      break;
    }
    const classBody = src.slice(openBraceIdx + 1, closeBraceIdx);
    const replacement = `class ${className}${extendsClause} {${classBody}}\n`;
    src = src.slice(0, declStart) + replacement + src.slice(closeBraceIdx + 1 + aliasMatch[0].length);
    src = src.replace(new RegExp(`\\b_${className}\\b`, 'g'), className);
    changed = true;
    SUMMARY.classTagNormalizations++;
    touchedClassNames.push(className);
  }

  while (true) {
    const re2 = /^var ([A-Z][A-Za-z0-9_]*) = class( extends [^\n{]+)? \{$/m;
    const m2 = re2.exec(src);
    if (!m2) break;
    const className = m2[1];
    const extendsClause = m2[2] || '';
    const declStart = m2.index;
    const openBraceIdx = src.indexOf('{', declStart + m2[0].length - 1);
    const closeBraceIdx = findMatchingBrace(src, openBraceIdx);
    if (closeBraceIdx < 0) break;
    if (src[closeBraceIdx + 1] !== ';') break;
    const classBody = src.slice(openBraceIdx + 1, closeBraceIdx);
    const replacement = `class ${className}${extendsClause} {${classBody}}`;
    src = src.slice(0, declStart) + replacement + src.slice(closeBraceIdx + 2);
    changed = true;
    SUMMARY.classTagNormalizations++;
    touchedClassNames.push(className);
  }

  const allClassNames = Array.from(new Set([...touchedClassNames, ...collectPlainClassNames(src)]));
  for (const className of allClassNames) {
    src = liftStaticAssignments(src, className, file);
  }

  if (changed) fs.writeFileSync(file, src);
}

function collectPlainClassNames(src) {
  const names = [];
  const re = /^class ([A-Z][A-Za-z0-9_]*)/gm;
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

function liftStaticAssignments(src, className, file) {
  const assignRe = new RegExp(`^${className}\\.[A-Za-z_][A-Za-z0-9_]* = .*;$`, 'gm');
  const matches = [];
  let m;
  while ((m = assignRe.exec(src))) matches.push({ start: m.index, end: m.index + m[0].length, line: m[0] });
  if (!matches.length) return src;

  const classDeclRe = new RegExp(`^class ${className}(?: extends [^\\n{]+)? \\{`, 'm');
  const classDeclMatch = classDeclRe.exec(src);
  if (!classDeclMatch) return src;
  const classOpenBrace = src.indexOf('{', classDeclMatch.index + classDeclMatch[0].length - 1);

  const lifted = [];
  const kept = [];
  const tdzPattern = new RegExp(`\\bnew ${className}\\s*\\(`);
  for (const a of matches) {
    if (tdzPattern.test(a.line)) kept.push(a);
    else lifted.push(a);
  }

  if (lifted.length) {
    const lines = lifted.map((a) => `  static ${a.line.slice(className.length + 1)}`).join('\n') + '\n';
    src = src.slice(0, classOpenBrace + 1) + '\n' + lines + src.slice(classOpenBrace + 1);
    SUMMARY.staticFieldsLifted += lifted.length;
  }

  for (const a of lifted) {
    const key = extractKey(a.line);
    const lineRe = new RegExp(`^${className}\\.${escapeRegex(key)} = .*;$\\n?`, 'm');
    src = src.replace(lineRe, '');
  }
  for (const k of kept) {
    const key = extractKey(k.line);
    const commentRe = new RegExp(`^(${className}\\.${escapeRegex(key)} = .*;)$`, 'm');
    src = src.replace(commentRe, `// kept outside class body to avoid TDZ on \`new ${className}(...)\` initializer\n$1`);
    SUMMARY.staticFieldsKeptOutside += 1;
    if (!SUMMARY.staticTdzKeptFiles.includes(file)) SUMMARY.staticTdzKeptFiles.push(file);
  }
  return src;
}

function extractKey(line) {
  const dot = line.indexOf('.');
  const eq = line.indexOf(' = ');
  return line.slice(dot + 1, eq);
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const files = listTsFiles(ROOT);
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  if (file.endsWith('/main.ts')) rewriteMainTs(file);
  dropRecordrtcShim(file);
  rewriteClassTags(file);
  const after = fs.readFileSync(file, 'utf8');
  if (before !== after) {
    SUMMARY.filesTouched += 1;
    if (before.match(/^var _[A-Z]/m)) {
      if (!SUMMARY.classTagFiles.includes(file.replace(ROOT + '/', ''))) {
        SUMMARY.classTagFiles.push(file.replace(ROOT + '/', ''));
      }
    }
  }
}

console.log(JSON.stringify(SUMMARY, null, 2));
