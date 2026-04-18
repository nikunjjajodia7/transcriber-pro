# Frozen rebuild inputs

Immutable snapshot of the inputs the v1.0.20 source rebuild consumes. Do not edit any file in this directory after capture — it is the reference baseline that downstream units diff against. If any of these files need to change, the rebuild starts over.

## Capture

- Capture date: 2026-04-19
- Executor: Unit 1 of `docs/plans/2026-04-18-001-refactor-rebuild-source-from-bundle-plan.md`
- Origin `main` SHA at capture: `6aa0d96cdd3078b7206ce70b7026c4d2bd415fca`
- Source workspace branch at capture: `rebuild-source` (created from `origin/main`)

## Files

| File | Source | SHA-256 |
| ---- | ------ | ------- |
| `main-v1.0.19.js` | v1.0.19 release asset (byte-verified against `gh release download 1.0.19`) | `8f44937637dd0449708975c63f73abdb3684d0d67fc925c11b4b056af6f935cc` |
| `manifest-v1.0.19.json` | v1.0.19 release tree | `b7f6c66d22f3904944c323e9fc65634cbe3ce536824a56758e0a9690eec4ed7f` |
| `versions-v1.0.19.json` | v1.0.19 release tree (entries 1.0.4 through 1.0.19) | `0f0587a8f9300bd305ab6a80fb7e1e75fcb97a73ec00b6bf1f91abafde2b7d18` |
| `main-v1.0.4-baseline.js` | Local `.main.js.v104.bak` (v1.0.4 build output from exploratory local build) | `f1f25016323dc859f260ff8de7478e68e6b6407949111ce5af1643e93eb0a407` |

## Release reference

- Release URL: https://github.com/nikunjjajodia7/transcriber-pro/releases/tag/1.0.19
- Published: 2026-04-18T06:32:17Z
- Tag: `1.0.19`

## Toolchain pin

- esbuild version used to produce `main-v1.0.19.js`: **`0.17.3`** (from `package-lock.json` on local `main` HEAD `29df8a2` — `origin/main` has no `package-lock.json` tracked). Diff work in Unit 5 assumes this version; any upgrade before Unit 5 invalidates the "helper emission noise" allowlist.
- `versions-v1.0.19.json` records `0.15.0` as the minimum Obsidian app version per entry — unrelated to esbuild; that string is Obsidian's plugin-compat field.

## Source-map status

Pre-flight (2026-04-19) confirmed v1.0.19 `main.js` has NO inline source maps: `grep -c sourceMappingURL` = 0, `grep -c sourcesContent` = 0. Unit 2 therefore uses the regex-splitter path (SQ1 resolution).

## Archival tags

- `dist-snapshot-2026-04-19` points at `origin/main` = `6aa0d96` — immutable safety anchor before the rebuild lands.
- `legacy-v1.0.4-source` points at the source workspace's local `main` HEAD = `29df8a2b92e86a9833f9d15dce18defa9fafa763` — preserves the 87 unpushed v1.0.4-era commits for retrieval. No audit of those commits was performed; the bundle is canonical per 2026-04-19 user decision.
