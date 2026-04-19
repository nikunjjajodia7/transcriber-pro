# bundle-splitter.mjs

Throwaway splitter that turns the v1.0.19 esbuild bundle into a raw
TypeScript source tree at `src-rebuild/`. Preserved purely for archival —
do not rely on it after Unit 4 lands.

## What it consumes

- `tools/inputs/main-v1.0.19.js` — the v1.0.19 production bundle snapshot
  taken in Unit 1. **Do not modify this file.** The canonical copy at
  `main.js` (repo root) is the shipped artifact; `tools/inputs/` is the
  frozen input for the rebuild.

## What it produces

- `src-rebuild/` — one `.ts` file per unique `// src/...` marker in the
  bundle. Directory structure mirrors the bundle's source-path markers
  (`src/utils/document/DocumentInserter.ts` -> `src-rebuild/utils/document/DocumentInserter.ts`).
  Output is **unverified TypeScript** — imports, types, and class-field
  syntax are still in esbuild's lowered form. Unit 3 normalizes them.
- `tools/splitter-report.json` — machine-readable summary: marker counts,
  unique-path count, multi-chunk file list with byte offsets, input SHA.

The v1.0.19 run produces 52 unique source files from 63 `// src/` markers
(11 files appear under two marker blocks each — see the report).

## How to invoke

```
# From repo root. Runs in ~0.03s.
node tools/bundle-splitter.mjs

# Run the built-in synthetic fixture self-test (no file IO):
node tools/bundle-splitter.mjs --self-test

# Run the on-disk fixture test (imports the splitter as a library):
node tools/test-fixtures/run-fixture-test.mjs
```

No external dependencies. Plain Node ESM using `node:fs/promises`.

## The load-bearing bit: marker chunks vs. source files

esbuild emits a `// src/path/file.ts` marker for every *contiguous chunk*
it places, **not once per source file**. In v1.0.19, esbuild splits
~11 files into two chunks each — one block for hoisted imports or the
class body, and a later block for static-field assignments
(`DocumentInserter.STATIC_FIELD = ...`) or late-order definitions.

A naive "one file per marker" splitter would overwrite earlier chunks
with later ones, silently dropping import preambles or static-field
assignments. This splitter **groups all chunks by source path before
writing**, then concatenates them in original source order into a single
emitted file.

The grouping logic is covered by both an in-script self-test
(`--self-test`) and an on-disk fixture at
`tools/test-fixtures/multi-chunk-fixture.bundle.js`, which exercises:
- two files with multiple (2 and 3) chunks each
- interleaved marker ordering (foo, bar, foo, bar, foo)
- a vendored `// node_modules/...` chunk that must be discarded
- assertion that wrapping `// src/...` marker lines do not leak into output

## How marker detection works

The boundary regex is `^// (src/|node_modules/)[^\s]+$`, matched at
column zero. A second guard requires the previous line to be blank; this
rules out mid-template-literal false positives inside vendored code.
Verified empirically against the v1.0.19 bundle: all 72 real markers are
blank-line-preceded, and no spurious matches occur.

Vendored chunks (`// node_modules/...`) are parsed but discarded — they
do not need to appear in `src-rebuild/`, since Unit 3 re-derives them as
normal `import` statements from real `node_modules` resolution.

## Known limitations (handled downstream, not here)

Intentionally **not** addressed by this splitter (Unit 3's job):
- esbuild helper wrappers (`__commonJS`, `__toESM`, `__publicField`,
  `__privateGet`, etc.) are left in the emitted source verbatim.
- `import_obsidianN` aliases are not consolidated back into
  `import { ... } from 'obsidian'`.
- Class-static fields are left in assignment form (`Cls.FIELD = value`)
  rather than rewritten to declaration form (`static FIELD = value`).
- Imports between emitted files are not derived; the output does not
  compile under `tsc` as-is.

## Assumptions

- Bundle is Unix line endings (`\n`). Splitter rejects CRLF input.
- esbuild version **assumed** to be `0.17.3` (pinned in the v1.0.4
  `package.json`). If Unit 4's parity check fails, this assumption gets
  revisited in Unit 5.
- Input bundle SHA-256: `8f44937637dd0449708975c63f73abdb3684d0d67fc925c11b4b056af6f935cc`.
