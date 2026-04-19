// Add `export` keyword to top-level declarations referenced by imports from other files.
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

// Build symbol -> file map (same as rewriter).
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
  for (const s of syms) addSymbol(s, file);
}

// Collect symbols referenced via import statements.
const importedSymbols = new Map(); // fileTarget -> Set<name>
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const importRe = /^import \{([^}]+)\} from '(\.\.?[^']*)';/gm;
  let m;
  const dirOfFile = path.dirname(file);
  while ((m = importRe.exec(src))) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const rel = m[2];
    let target = path.resolve(dirOfFile, rel);
    if (!target.endsWith('.ts')) target += '.ts';
    if (!importedSymbols.has(target)) importedSymbols.set(target, new Set());
    for (const n of names) importedSymbols.get(target).add(n);
  }
  // Also default imports `import X from 'recordrtc';` — skip non-relative.
}

const SUMMARY = {
  filesTouched: 0,
  exportsAdded: 0,
  exportDetails: [],
};

for (const file of files) {
  const imported = importedSymbols.get(file);
  if (!imported || !imported.size) continue;
  let src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let changed = false;
  const addedForThisFile = [];
  for (let i = 0; i < lines.length; i++) {
    for (const name of imported) {
      // Match top-level decl at start of line.
      const patterns = [
        new RegExp(`^class ${name}\\b`),
        new RegExp(`^(?:async\\s+)?function ${name}\\b`),
        new RegExp(`^var ${name}\\s*=`),
        new RegExp(`^const ${name}\\s*=`),
        new RegExp(`^let ${name}\\s*=`),
      ];
      for (const p of patterns) {
        if (p.test(lines[i])) {
          if (!lines[i].startsWith('export ')) {
            lines[i] = 'export ' + lines[i];
            addedForThisFile.push(name);
            changed = true;
          }
          break;
        }
      }
    }
  }
  if (changed) {
    fs.writeFileSync(file, lines.join('\n'));
    SUMMARY.filesTouched += 1;
    SUMMARY.exportsAdded += addedForThisFile.length;
    SUMMARY.exportDetails.push({ file: file.replace(ROOT + '/', ''), added: addedForThisFile });
  }
}

console.log(JSON.stringify(SUMMARY, null, 2));
