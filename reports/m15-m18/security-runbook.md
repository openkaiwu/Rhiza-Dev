# M16 security tooling and reproduction

The historical repository scan currently fails with five candidates. Three are verified public tokenizer version literals; two old README/archive hits remain unreviewed. No exclusions, baseline suppressions or weakened rules were added. Formal security/export Gate acceptance remains open.

## Pinned installation

Use `pnpm run security:install`, requiring curl and tar on Darwin/Linux arm64/x64. Installation is local under ignored `.rhiza/tools/gitleaks/8.30.1/`. `tools/gitleaks.lock.json` pins the [official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), checksum manifest and archive SHA256. Verify both before extracting named members to memory; scans recheck the executable against that archive and verify version. Keep the [MIT notice](https://github.com/gitleaks/gitleaks/blob/v8.30.1/LICENSE), copied to `licenses/upstream/Gitleaks-MIT.txt` and alongside the installed executable. Host curl resolved the observed native-fetch release redirect timeout.

## Checks

- `pnpm run security:fixtures`: temporary inert GitHub/AWS/generic key and ZIP fixtures; expected 4/4 detections, 100%, sanitized=true and clean negative=true. Final reproduction achieved these values; fixtures are removed afterward.
- `pnpm run security:scan`: full Git history, including archives to depth 1 and decoding to depth 2; nonzero for findings. Current historical findings remain visible in `security.json`.
- `pnpm run security:export .rhiza/exports/workspace.rhiza`: explicit local artifact scan, read-only. Detector patterns are checked within declared bounds; this does not claim exhaustive DLP or replace M09 portable metadata/ZIP/reference validators.
- `pnpm run security:checks`: sanitizer/checksum regression, positive fixtures and full-history scan. Current expected exit is 1 due to unresolved history candidates. The new CI security job is blocking; it has not run on a remote runner.

Reports contain count, line, hashed rule/location references and bounds. They contain no detector match, Secret, snippet, filename, absolute path, caller parameter, key or endpoint credential. Filenames are hashed because they can contain credentials. Raw child stdout/stderr is never forwarded. Private temporary reports are removed after success or failure. Explicit default rules, empty ignore files and ignored inline allow comments prevent caller configuration from suppressing checks.

Failure codes: `SECRET_FINDINGS`, `TOOL_DOWNLOAD_FAILED`, `TOOL_CHECKSUM_MISMATCH`, `TOOL_CHECKSUM_MANIFEST_MISMATCH`, `GITLEAKS_NOT_INSTALLED`, `UNSUPPORTED_PINNED_TOOL_PLATFORM`, `TOOL_VERSION_MISMATCH`, `INVALID_SCAN_REPORT`, `SCAN_EXECUTION_FAILED`. Unexpected failures become `SECURITY_CHECK_FAILED`, with exit 1. A missing tool is never skipped; no system executable fallback is used.

## Remaining acceptance

Review the two historical documentation/archive candidates without publishing their contents. Add an exception only after proving a specific value is nonsecret, keeping the decision explicit and narrowly bound. Real Workspace export secret/path/location safety reporting and production UI integration remain pending. Existing Bundle descriptor/portable DTO location stripping and hostile-archive checks remain intact. This unit does not change Bundle format, stored bodies or keys.
