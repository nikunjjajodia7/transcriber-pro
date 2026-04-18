#!/usr/bin/env node
// @ts-check
/**
 * Standalone runner for the on-disk fixture at
 * `tools/test-fixtures/multi-chunk-fixture.bundle.js`. Feeds it through the
 * splitter's exported parser/grouper and asserts the chunk-grouping logic.
 *
 * Run with: `node tools/test-fixtures/run-fixture-test.mjs`
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChunks, groupSrcChunks, concatChunkBodies } from '../bundle-splitter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'multi-chunk-fixture.bundle.js');

const bundle = await readFile(FIXTURE_PATH, 'utf8');
const chunks = parseChunks(bundle);
const srcChunks = chunks.filter((c) => c.kind === 'src');
const vendored = chunks.filter((c) => c.kind === 'node_modules');
const grouped = groupSrcChunks(chunks);

function assert(cond, msg) {
  if (!cond) {
    process.stderr.write(`fixture test FAILED: ${msg}\n`);
    process.exit(1);
  }
}

assert(srcChunks.length === 5, `expected 5 src chunks, got ${srcChunks.length}`);
assert(vendored.length === 1, `expected 1 vendored chunk, got ${vendored.length}`);
assert(grouped.size === 2, `expected 2 unique src paths, got ${grouped.size}`);

const foo = grouped.get('src/foo.ts');
const bar = grouped.get('src/bar.ts');
assert(foo && foo.bodies.length === 3, 'src/foo.ts must have 3 chunks');
assert(bar && bar.bodies.length === 2, 'src/bar.ts must have 2 chunks');

const fooConcat = concatChunkBodies(foo.bodies);
assert(fooConcat.includes('var import_x'), 'foo: missing import');
assert(fooConcat.includes('var _Foo = class'), 'foo: missing class');
assert(fooConcat.includes('Foo.LATE_FIELD'), 'foo: missing static');
assert(
  fooConcat.indexOf('var import_x') < fooConcat.indexOf('var _Foo = class'),
  'foo: import must precede class',
);
assert(
  fooConcat.indexOf('var _Foo = class') < fooConcat.indexOf('Foo.LATE_FIELD'),
  'foo: class must precede static',
);

const barConcat = concatChunkBodies(bar.bodies);
assert(barConcat.includes('var _Bar = class'), 'bar: missing class');
assert(barConcat.includes('Bar.STATIC_FIELD'), 'bar: missing static');
assert(
  barConcat.indexOf('var _Bar = class') < barConcat.indexOf('Bar.STATIC_FIELD'),
  'bar: class must precede static',
);

assert(!fooConcat.includes('// src/foo.ts'), 'foo: wrapping marker leaked');
assert(!barConcat.includes('// src/bar.ts'), 'bar: wrapping marker leaked');

process.stdout.write('fixture test PASSED\n');
