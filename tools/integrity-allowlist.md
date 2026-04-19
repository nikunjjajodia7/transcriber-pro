# Release Integrity Allowlist

The `release-integrity.yml` workflow rebuilds every release tag and compares the
freshly built `main.js` SHA-256 against the asset published in the corresponding
GitHub Release. A mismatch fails the workflow.

This document is **the human reference for triaging failures**. The workflow
itself does not parse this file. When a drift fires, an engineer reads the
sections below, decides whether the cause is acceptable noise (e.g. a benign
toolchain upgrade) or a real regression, and takes action.

## Acceptable noise (do NOT investigate as a regression)

These categories of drift are byte-level expected and do not indicate a code
change. If the failing tag's drift is caused by one of these, treat it as a
toolchain ratchet: bump the tooling pin if you want to silence the alert
permanently, or accept the noise.

- **esbuild patch- or minor-version drift.** A patched esbuild release can change
  helper emission, comment placement, identifier mangling, or whitespace. The
  fix is to pin `esbuild` more tightly in `package.json` and regenerate
  `package-lock.json`, then re-tag.
- **`tslib` helper emission ordering.** When `importHelpers: true`, esbuild can
  inline tslib runtime helpers in different orders across versions. Output is
  semantically identical.
- **Source path comments emitted by esbuild.** esbuild emits `// <path>` comments
  for each module relative to the entry. If the entry path changed (e.g.
  `src-rebuild/main.ts` → `src/main.ts`), every comment changes byte-for-byte.
  This was the cause of the SHA shift between the v1.0.19 dist-only build and
  the v1.0.20-rc.1 source-built bundle.
- **`.npmrc` cache settings or proxy variations.** These can affect the order
  dependencies install but should not affect bundle bytes; if they do, treat
  as a node_modules drift bug, not a source regression.

## Real regressions (DO investigate)

If the drift cannot be explained by the categories above, treat it as serious:

- The release asset on GitHub differs from what the source tree at that tag
  produces. Either the asset was hand-patched after upload (violating the
  no-hand-patching rule in `AGENTS.md`), the source tree was rewritten via a
  force push, or the build pipeline was bypassed. Audit the release page,
  audit the tag's git history, and compare against the most recent green tag.

## Process when a drift fires

1. Read the workflow log to identify the failing tag and both SHAs.
2. Check this file. If the cause matches an "acceptable noise" entry, decide
   whether to pin tooling tighter or to add the new noise pattern here.
3. Otherwise, treat as a security incident: open an issue, do not delete the
   release, do not re-tag.

## Updating this file

When you upgrade esbuild, tslib, TypeScript, or Node, run the integrity
workflow on a non-merge branch first to surface any new noise patterns. Add
them here before merging the upgrade so the workflow does not false-fail on
the next scheduled run.
