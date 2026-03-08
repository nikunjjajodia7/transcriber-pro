# NeuroVox (BRAT Distribution)

This repository is a distribution-only package for Obsidian BRAT.

## Included files
- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## Mobile BRAT setup
1. Install BRAT in Obsidian mobile.
2. Add this repo in BRAT and install NeuroVox.
3. Open NeuroVox settings and configure:
- `backendBaseUrl` (Cloud Run URL)
- `backendApiKey` (backend bearer key)
- `deepgramApiKey` (for live transcription)
4. If post-processing is enabled, also configure its provider key; otherwise disable post-processing.

## Security
- This repo contains no runtime secrets.
- API keys are entered per-device in plugin settings and are not stored here.
