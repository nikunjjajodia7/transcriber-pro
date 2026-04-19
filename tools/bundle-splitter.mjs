#!/usr/bin/env node
// @ts-check
/**
 * bundle-splitter.mjs
 *
 * Mechanically split an esbuild-produced bundle (no source maps) into one
 * TypeScript file per *unique* `// src/...` source-path marker. Vendored
 * chunks (`// node_modules/...`) are discarded.
 *
 * IMPORTANT: esbuild emits a `// src/path/file.ts` marker for every
 * contiguous chunk it places, NOT once per source file. Multiple chunks
 * can share a path (e.g. esbuild hoists imports into a pre-header and
 * emits class-static-field assignments after the class body, both under
 * the same path marker as the class itself). The splitter MUST group all
 * chunks by source path before writing — otherwise later chunks silently
 * overwrite earlier ones. See README for details.
 *
 * Usage:
 *   node tools/bundle-splitter.mjs               # default IO paths
 *   node tools/bundle-splitter.mjs --self-test   # run synthetic fixture test
 *
 * Output: src-rebuild/ tree + tools/splitter-report.json
 *
 * Throwaway code preserved purely for archival — see README.
 */

import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_INPUT_PATH = resolve(REPO_ROOT, 'tools/inputs/main-v1.0.19.js');
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, 'src-rebuild');
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, 'tools/splitter-report.json');
const ESBUILD_VERSION_ASSUMED = '0.17.3';

/**
 * Parse a bundle string into a list of chunk records.
 *
 * A chunk is a contiguous range of bundle lines preceded by a marker line
 * matching `^// (src/|node_modules/)<path>` at column zero. The marker must
 * also be preceded by a blank line (or be the first non-empty line of the
 * bundle) — this is the load-bearing guard against template-literal
 * false-positives inside vendored code.
 *
 * Lines preceding the first marker (the esbuild runtime preamble) are
 * collected as a synthetic "preamble" chunk and discarded by the caller.
 *
 * @param {string} bundle - the full bundle source, Unix line endings
 * @returns {{ kind: 'src'|'node_modules'|'preamble', path: string, body: string, startLine: number, byteOffset: number }[]}
 */
export function parseChunks(bundle) {
  // Reject CRLF — bundle is documented as Unix-only. Catching this early
  // avoids subtle off-by-ones in column-zero matching.
  if (bundle.includes('\r')) {
    throw new Error('bundle contains CRLF line endings; Unix-only input expected');
  }

  const lines = bundle.split('\n');
  const markerRe = /^\/\/ (src\/|node_modules\/)(.+)$/;

  /** @type {{ kind: 'src'|'node_modules'|'preamble', path: string, body: string, startLine: number, byteOffset: number }[]} */
  const chunks = [];

  // Pre-compute byte offset of each line start for the report.
  /** @type {number[]} */
  const lineByteOffsets = new Array(lines.length);
  let runningOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineByteOffsets[i] = runningOffset;
    runningOffset += Buffer.byteLength(lines[i], 'utf8') + 1; // +1 for '\n'
  }

  /**
   * Flush a chunk covering lines [startIdx, endIdx) as body, with marker
   * metadata captured separately.
   * @param {'src'|'node_modules'|'preamble'} kind
   * @param {string} markerPath
   * @param {number} startIdx - inclusive index of first body line
   * @param {number} endIdx - exclusive
   * @param {number} markerLineIdx - line index of the marker itself
   */
  function pushChunk(kind, markerPath, startIdx, endIdx, markerLineIdx) {
    const body = lines.slice(startIdx, endIdx).join('\n');
    chunks.push({
      kind,
      path: markerPath,
      body,
      startLine: markerLineIdx + 1,
      byteOffset: kind === 'preamble' ? 0 : lineByteOffsets[markerLineIdx],
    });
  }

  let currentKind = /** @type {'src'|'node_modules'|'preamble'} */ ('preamble');
  let currentPath = '<preamble>';
  let currentBodyStart = 0;
  let currentMarkerLineIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(markerRe);
    if (!m) continue;

    // Column-zero is already enforced by the regex. Now the blank-line guard.
    const prev = i > 0 ? lines[i - 1] : '';
    if (prev !== '') {
      // Skip suspicious mid-content matches (e.g. inside a template literal).
      process.stderr.write(
        `warning: marker at line ${i + 1} not preceded by blank line; treating as content: ${line}\n`,
      );
      continue;
    }

    // End the previous chunk at i-1 (exclusive), i.e. the blank line just
    // before this marker is trimmed from the previous body.
    pushChunk(currentKind, currentPath, currentBodyStart, i - 1, currentMarkerLineIdx);

    const kindToken = m[1];
    const pathTail = m[2];
    currentKind = kindToken === 'src/' ? 'src' : 'node_modules';
    currentPath = kindToken + pathTail;
    currentBodyStart = i + 1;
    currentMarkerLineIdx = i;
  }

  pushChunk(currentKind, currentPath, currentBodyStart, lines.length, currentMarkerLineIdx);
  return chunks;
}

/**
 * Group src chunks by path while preserving original source order.
 * @param {ReturnType<typeof parseChunks>} chunks
 * @returns {Map<string, { bodies: string[], byteOffsets: number[], startLines: number[] }>}
 */
export function groupSrcChunks(chunks) {
  /** @type {Map<string, { bodies: string[], byteOffsets: number[], startLines: number[] }>} */
  const grouped = new Map();
  for (const c of chunks) {
    if (c.kind !== 'src') continue;
    const existing = grouped.get(c.path);
    if (existing) {
      existing.bodies.push(c.body);
      existing.byteOffsets.push(c.byteOffset);
      existing.startLines.push(c.startLine);
    } else {
      grouped.set(c.path, {
        bodies: [c.body],
        byteOffsets: [c.byteOffset],
        startLines: [c.startLine],
      });
    }
  }
  return grouped;
}

/**
 * Concatenate grouped chunks for a single file. Each chunk body is trimmed
 * of leading/trailing blank lines, then joined with a single blank-line
 * separator. The wrapping `// src/...` marker was excluded from bodies
 * during parsing.
 * @param {string[]} bodies
 * @returns {string}
 */
export function concatChunkBodies(bodies) {
  const trimmed = bodies.map((b) => b.replace(/^\n+/, '').replace(/\n+$/, ''));
  return trimmed.join('\n\n') + '\n';
}

/**
 * Write the grouped output to disk. Bundle path `src/foo/bar.ts` becomes
 * `<outputDir>/foo/bar.ts` (the `src/` prefix is stripped because
 * `outputDir` is itself the rebuild root).
 * @param {Map<string, { bodies: string[], byteOffsets: number[], startLines: number[] }>} grouped
 * @param {string} outputDir
 * @returns {Promise<{ files: string[], totalBytes: number }>}
 */
export async function writeOutput(grouped, outputDir) {
  const files = [];
  let totalBytes = 0;

  if (existsSync(outputDir)) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  const sortedPaths = Array.from(grouped.keys()).sort();
  for (const bundlePath of sortedPaths) {
    if (!bundlePath.startsWith('src/')) {
      throw new Error(`unexpected non-src path in grouped output: ${bundlePath}`);
    }
    const relativePath = bundlePath.slice('src/'.length);
    const outFsPath = path.join(outputDir, relativePath);
    await mkdir(dirname(outFsPath), { recursive: true });
    const content = concatChunkBodies(grouped.get(bundlePath).bodies);
    await writeFile(outFsPath, content, 'utf8');
    files.push(outFsPath);
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  return { files, totalBytes };
}

/**
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {string} reportPath
 */
export async function runSplitter(inputPath, outputDir, reportPath) {
  const bundle = await readFile(inputPath, 'utf8');
  const inputStat = await stat(inputPath);
  const inputSha = createHash('sha256').update(bundle, 'utf8').digest('hex');

  const chunks = parseChunks(bundle);
  const srcChunks = chunks.filter((c) => c.kind === 'src');
  const vendoredChunks = chunks.filter((c) => c.kind === 'node_modules');
  const grouped = groupSrcChunks(chunks);
  const { files, totalBytes } = await writeOutput(grouped, outputDir);

  /** @type {{ path: string, chunk_count: number, chunk_byte_offsets: number[] }[]} */
  const multiChunkFiles = [];
  for (const [bundlePath, info] of grouped.entries()) {
    if (info.bodies.length > 1) {
      multiChunkFiles.push({
        path: bundlePath,
        chunk_count: info.bodies.length,
        chunk_byte_offsets: info.byteOffsets.slice(),
      });
    }
  }
  multiChunkFiles.sort((a, b) => a.path.localeCompare(b.path));

  const report = {
    input: path.relative(REPO_ROOT, inputPath),
    input_sha256: inputSha,
    input_size_bytes: inputStat.size,
    esbuild_version_assumed: ESBUILD_VERSION_ASSUMED,
    marker_count: chunks.filter((c) => c.kind !== 'preamble').length,
    src_marker_count: srcChunks.length,
    unique_src_paths: grouped.size,
    files_emitted: files.length,
    vendored_chunks_discarded: vendoredChunks.length,
    output_total_bytes: totalBytes,
    multi_chunk_files: multiChunkFiles,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

/**
 * Synthetic fixture self-test. Fails loudly if marker-grouping regresses.
 */
export async function selfTest() {
  const fixture = [
    '/* fake esbuild preamble */',
    'var __helper = () => null;',
    '',
    '// node_modules/fake-vendor/index.js',
    'var require_fake = function() { return { ok: true }; };',
    '',
    '// src/foo.ts',
    'var import_x = require("x");',
    '',
    '// src/bar.ts',
    'var _Bar = class {',
    '  hello() { return "bar"; }',
    '};',
    'var Bar = _Bar;',
    '',
    '// src/foo.ts',
    'var _Foo = class {',
    '  greet() { return "hi"; }',
    '};',
    'var Foo = _Foo;',
    '',
    '// src/bar.ts',
    'Bar.STATIC_FIELD = 42;',
    '',
    '// src/foo.ts',
    'Foo.LATE_FIELD = "late";',
    '',
  ].join('\n');

  const chunks = parseChunks(fixture);
  const srcChunks = chunks.filter((c) => c.kind === 'src');
  const vendored = chunks.filter((c) => c.kind === 'node_modules');
  const grouped = groupSrcChunks(chunks);

  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) {
    if (!cond) throw new Error(`self-test FAILED: ${msg}`);
  }

  assert(srcChunks.length === 5, `expected 5 src chunks, got ${srcChunks.length}`);
  assert(vendored.length === 1, `expected 1 vendored chunk, got ${vendored.length}`);
  assert(grouped.size === 2, `expected 2 unique src paths, got ${grouped.size}`);

  const fooInfo = grouped.get('src/foo.ts');
  const barInfo = grouped.get('src/bar.ts');
  assert(!!fooInfo, 'src/foo.ts missing from grouping');
  assert(!!barInfo, 'src/bar.ts missing from grouping');
  assert(fooInfo.bodies.length === 3, `src/foo.ts: expected 3 chunks, got ${fooInfo.bodies.length}`);
  assert(barInfo.bodies.length === 2, `src/bar.ts: expected 2 chunks, got ${barInfo.bodies.length}`);

  const fooConcat = concatChunkBodies(fooInfo.bodies);
  const importIdx = fooConcat.indexOf('var import_x = require("x");');
  const classIdx = fooConcat.indexOf('var _Foo = class');
  const staticIdx = fooConcat.indexOf('Foo.LATE_FIELD');
  assert(importIdx !== -1, 'foo.ts: missing import chunk');
  assert(classIdx !== -1, 'foo.ts: missing class chunk');
  assert(staticIdx !== -1, 'foo.ts: missing static chunk');
  assert(importIdx < classIdx, 'foo.ts: import not before class');
  assert(classIdx < staticIdx, 'foo.ts: class not before static');

  const barConcat = concatChunkBodies(barInfo.bodies);
  const barClassIdx = barConcat.indexOf('var _Bar = class');
  const barStaticIdx = barConcat.indexOf('Bar.STATIC_FIELD');
  assert(barClassIdx !== -1, 'bar.ts: missing class');
  assert(barStaticIdx !== -1, 'bar.ts: missing static');
  assert(barClassIdx < barStaticIdx, 'bar.ts: class not before static');

  assert(!fooConcat.includes('// src/foo.ts'), 'foo.ts: wrapping marker leaked');
  assert(!barConcat.includes('// src/bar.ts'), 'bar.ts: wrapping marker leaked');

  process.stderr.write('self-test PASSED\n');
}

// CLI entry — only runs when invoked directly, not on import.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL('file://' + entry).href;
    return entryUrl === import.meta.url;
  } catch {
    return false;
  }
})();
const argv = process.argv.slice(2);
if (invokedDirectly && argv.includes('--self-test')) {
  selfTest().catch((err) => {
    process.stderr.write(String(err.stack || err) + '\n');
    process.exit(1);
  });
} else if (invokedDirectly) {
  const start = Date.now();
  runSplitter(DEFAULT_INPUT_PATH, DEFAULT_OUTPUT_DIR, DEFAULT_REPORT_PATH)
    .then((report) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      process.stdout.write(
        `splitter: ${report.unique_src_paths} unique src paths from ` +
          `${report.src_marker_count} src markers ` +
          `(${report.multi_chunk_files.length} multi-chunk files); ` +
          `${report.vendored_chunks_discarded} vendored chunks discarded; ` +
          `${report.output_total_bytes} bytes written; ${elapsed}s\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(String(err.stack || err) + '\n');
      process.exit(1);
    });
}
