#!/usr/bin/env node
// Unit 4 helper v2: more accurate field-inference.
// Walks each class top-level; collects `this.<name> =` assignments anywhere
// inside the class; finds existing field declarations ONLY among the
// top-of-class decl block (lines between `class X {` and first `(...)` line
// that looks like a constructor/method) and existing `static X = ...` lines.
// Does NOT match destructuring patterns as "existing".

import fs from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: add-class-fields.mjs <file.ts> [<file.ts> ...]');
  process.exit(2);
}

let totalFields = 0;
let totalClasses = 0;

// Match only simple field declarations at expected class-body indent:
//   "  name: Type;"
//   "  name;"
//   "  name = expr;"
//   "  static name = expr;"
//   "  readonly name: Type;"
// Destructuring like "  const { name, name2 } = x;" is excluded because
// the line must match exactly `  [modifier] name [:|=|;] ...`.
const fieldDeclRegex = /^\s+(?:static\s+|readonly\s+|public\s+|private\s+|protected\s+)*([A-Za-z_$][\w$]*)(?:\s*:[^=;]*)?(?:\s*=\s*[^;]*)?\s*;?\s*$/;
// Method / constructor: line that after indent starts with identifier(args) or identifier: (args)
// We detect by `<name>(` pattern at the start of the line (post-indent), allowing get/set/async/static/private etc.
const methodStartRegex = /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+)*\w+\s*\(/;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out = [...lines];
  const classes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+[^{]+)?\s*\{/);
    if (!m) continue;
    const startIndent = m[1];
    let depth = 0, started = false, endLine = -1;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { endLine = j; break; } }
      }
      if (endLine >= 0) break;
    }
    if (endLine < 0) continue;
    classes.push({ startLine: i, endLine, indent: startIndent, name: m[2] });
  }
  classes.sort((a, b) => b.startLine - a.startLine);
  for (const cls of classes) {
    const bodyLines = lines.slice(cls.startLine + 1, cls.endLine);
    // Collect `this.<name> = ...` assignments within body.
    // But skip nested class bodies so we don't attribute inner fields to outer.
    // Simple approach: track brace depth within body; only accept assigns at
    // depth 1 or deeper (method bodies), excluding lines inside a nested `class` block.
    // We detect nested class blocks and skip them.
    const nestedRanges = [];
    for (let k = 0; k < bodyLines.length; k++) {
      const mm = bodyLines[k].match(/^(\s*)class\s+\w+/);
      if (!mm) continue;
      let d = 0, s = false, end = -1;
      for (let kk = k; kk < bodyLines.length; kk++) {
        for (const ch of bodyLines[kk]) {
          if (ch === '{') { d++; s = true; }
          else if (ch === '}') { d--; if (s && d === 0) { end = kk; break; } }
        }
        if (end >= 0) break;
      }
      if (end >= 0) { nestedRanges.push([k, end]); k = end; }
    }
    const inNested = (ln) => nestedRanges.some(([a, b]) => ln >= a && ln <= b);
    // Collect fields from this.X = assignments (excluding nested class regions)
    const fields = new Set();
    const assignRegex = /\bthis\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\?\?=|\|\|=|\&\&=)/g;
    for (let k = 0; k < bodyLines.length; k++) {
      if (inNested(k)) continue;
      const ln = bodyLines[k];
      let mm;
      while ((mm = assignRegex.exec(ln)) !== null) fields.add(mm[1]);
    }
    // Collect existing class-field declarations: only the top block before
    // the first method/constructor line. Plus `static` decls anywhere.
    const existing = new Set();
    let firstMethodLine = bodyLines.length;
    for (let k = 0; k < bodyLines.length; k++) {
      if (inNested(k)) continue;
      if (methodStartRegex.test(bodyLines[k])) { firstMethodLine = k; break; }
    }
    for (let k = 0; k < firstMethodLine; k++) {
      const dm = bodyLines[k].match(fieldDeclRegex);
      if (dm) existing.add(dm[1]);
    }
    // Also scan the entire body for explicit `static <name> =` declarations
    for (let k = 0; k < bodyLines.length; k++) {
      if (inNested(k)) continue;
      const sm = bodyLines[k].match(/^\s+static\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(?::|=|;)/);
      if (sm) existing.add(sm[1]);
    }
    const toAdd = [...fields].filter(f => !existing.has(f));
    if (toAdd.length === 0) continue;
    const declStr = toAdd.map(f => `${cls.indent}  ${f}: any;`).join('\n');
    out.splice(cls.startLine + 1, 0, declStr);
    totalFields += toAdd.length;
    totalClasses++;
  }
  if (out.length !== lines.length) {
    fs.writeFileSync(file, out.join('\n'));
    console.log(`${file}: added ${out.length - lines.length} field decl line(s)`);
  }
}

console.log(`\nDONE. ${totalClasses} classes touched, ${totalFields} fields added.`);
