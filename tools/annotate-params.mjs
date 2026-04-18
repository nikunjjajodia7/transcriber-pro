#!/usr/bin/env node
// Unit 4 helper: reads tsc's TS7006/TS7034 errors from stdin (or a log file)
// and inserts `: any` for each named param on the indicated column.
//
// Usage:
//   npx tsc --noEmit -p tsconfig.json | node tools/annotate-params.mjs
//
// Safe: only annotates at the exact (line,col) reported; idempotent.

import fs from 'node:fs';
import path from 'node:path';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const logSrc = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await readStdin();

// Parse tsc lines: path(line,col): error TS7006: Parameter 'name' implicitly has an 'any' type.
const re = /^(.+?)\((\d+),(\d+)\):\s*error TS(7006|7034|7005):\s*(?:Parameter '([^']+)'|Variable '([^']+)')/gm;
const byFile = new Map();
let m;
while ((m = re.exec(logSrc)) !== null) {
  const file = m[1];
  const line = parseInt(m[2], 10);
  const col = parseInt(m[3], 10);
  const code = m[4];
  const name = m[5] || m[6];
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line, col, code, name });
}

let totalFixed = 0;
for (const [file, items] of byFile) {
  let text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // group by line; apply from rightmost col so earlier offsets aren't shifted
  const byLine = new Map();
  for (const it of items) {
    if (!byLine.has(it.line)) byLine.set(it.line, []);
    byLine.get(it.line).push(it);
  }
  for (const [lineNum, group] of byLine) {
    const idx = lineNum - 1;
    let line = lines[idx];
    if (line === undefined) continue;
    // Sort by col desc
    group.sort((a, b) => b.col - a.col);
    for (const it of group) {
      const colIdx = it.col - 1;
      const nameLen = it.name.length;
      const after = line.slice(colIdx + nameLen);
      // Skip if already annotated (next non-whitespace is `:`)
      if (/^\s*[:?]/.test(after)) continue;
      // Only handle param annotation (code 7006) inline.
      // For variable implicit any (7034/7005), we skip (need more context).
      if (it.code !== '7006') continue;
      // Check the identifier at col matches expected name
      const at = line.slice(colIdx, colIdx + nameLen);
      if (at !== it.name) {
        // Sometimes col is 1-indexed past whitespace; skip mismatches.
        continue;
      }
      // Insert ': any' after the name. If next char is `?` then handle `name?: any`.
      const nextCh = after[0];
      if (nextCh === '?') {
        // param is optional: already has '?', insert after `?`
        line = line.slice(0, colIdx + nameLen + 1) + ': any' + line.slice(colIdx + nameLen + 1);
      } else {
        line = line.slice(0, colIdx + nameLen) + ': any' + line.slice(colIdx + nameLen);
      }
      totalFixed++;
    }
    lines[idx] = line;
  }
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`${file}: annotated ${items.length} param(s)`);
}

console.log(`\nDONE. ${totalFixed} params annotated.`);
