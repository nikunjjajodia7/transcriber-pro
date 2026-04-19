# NeuroVox

NeuroVox is an Obsidian plugin that enhances note-taking with voice
transcription and AI capabilities. It is distributed via GitHub Releases and
installable through [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Repository layout

This repo is the **source-of-truth** for NeuroVox. The TypeScript sources
live in `src/`; the bundled `main.js` is built from those sources by
`npm run build` and is not tracked in git. Released bundles are attached as
assets to each GitHub Release.

Tracked artifacts:
- `manifest.json` — plugin metadata Obsidian reads
- `styles.css` — hand-curated stylesheet (no build step)
- `versions.json` — version → minAppVersion mapping for Obsidian/BRAT

Built and shipped via GitHub Releases (not tracked):
- `main.js`
- `SHA256SUMS.txt`

## Development

```bash
nvm use            # picks up Node version from .nvmrc (20.11.1)
npm install
npm run build
```

`npm run build` runs `tsc --noEmit` and produces `main.js` via esbuild.
Source lives under `src/`; the entry point is `src/main.ts`. Never edit
`main.js` directly — see `AGENTS.md` for the no-hand-patching rule.

## Releasing

Pushing a SemVer tag (e.g. `1.0.20`, `1.0.20-rc.1`) triggers
`.github/workflows/release.yml`, which:

1. Validates `manifest.json` and `package.json` `version` fields match the tag.
2. Runs `npm ci && npm run build`.
3. Generates `SHA256SUMS.txt` for `main.js`, `manifest.json`, `styles.css`.
4. Creates a **draft** GitHub Release with all four files attached.
5. Re-downloads the uploaded assets and verifies their SHAs match the
   build-time hashes.

A maintainer reviews the draft release and publishes manually. To cut a
release:

```bash
# Bump manifest.json + package.json to the new version, commit, then:
git tag 1.0.20
git push origin 1.0.20
```

The weekly `release-integrity.yml` workflow rebuilds every release tag and
fails if any released `main.js` SHA differs from a fresh source build.
See `tools/integrity-allowlist.md` for triage guidance.

## Installation (via BRAT)

1. Install BRAT in Obsidian (desktop or mobile).
2. In BRAT, "Add Beta Plugin" → enter this repo URL.
3. BRAT downloads the latest published release and installs NeuroVox.
4. Open NeuroVox settings and configure:
   - `backendBaseUrl` (Cloud Run URL)
   - `backendApiKey` (backend bearer key)
   - `deepgramApiKey` (for live transcription)
5. If post-processing is enabled, also configure its provider key; otherwise
   disable post-processing.

BRAT install instructions: https://github.com/TfTHacker/obsidian42-brat#readme

## Security

- This repo contains no runtime secrets.
- API keys are entered per-device in plugin settings and never committed.
