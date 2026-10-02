# Third-party notices

## LibreChat

- Upstream repository: `https://github.com/danny-avila/LibreChat`
- Locked version: `v0.8.7`
- Locked commit: `9e74cc0e57b395926122bd4062c1fcedc48ed465`
- Role in Rhiza: reference implementation and future AI Runtime adapter source
- License: MIT; see `licenses/upstream/LibreChat-MIT.txt`

The LibreChat product UI, Mongo conversation model, Admin Panel and Sandpack/Nodebox artifact chain are not part of the Rhiza domain implementation in this repository.

## librechat-data-provider

- Package: `librechat-data-provider@0.8.509`
- Source: LibreChat `packages/data-provider`
- Role in Rhiza: model-spec validation, endpoint normalization and file capability policy
- Declared package license: ISC

## Complete production dependency report

Run `npm run licenses:generate` to reproduce `reports/third-party-licenses.json`
from the locked production dependency tree. CI runs `npm run licenses:verify` and
fails when that report is missing or stale.

## Gitleaks development and CI tool

- Pinned version: `v8.30.1`, official release `https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1`.
- Role: local/CI secret detection and explicit exported-artifact scans; no production dependency or runtime model integration.
- License: MIT; full upstream notice retained in `licenses/upstream/Gitleaks-MIT.txt` and alongside the installed binary.
- `tools/gitleaks.lock.json` pins the official checksum manifest and Darwin/Linux arm64/x64 release archive digests. The installer verifies both before extracting bytes, and scans verify the installed executable against that verified archive.
