# M09 Bundle security check · 2026-09-28

The production import adapter validates a `workspace.rhiza` archive in a private staging directory before publishing a Workspace. The deterministic hostile-archive fixtures in `server/infrastructure/bundle-archive.test.ts` and `server/domain/portable-bundle.test.ts` exercise these rejection classes:

| Attack | Rejection |
| --- | --- |
| ZIP path traversal, absolute/drive/backslash/control/device names | `BUNDLE_UNSAFE_PATH` or `BUNDLE_INVALID_ARCHIVE` |
| Symlink, Unix hardlink marker, device/FIFO/socket modes | `BUNDLE_UNSAFE_ENTRY_TYPE` |
| Exact or case-folded duplicate, undeclared entry | `BUNDLE_DUPLICATE_ENTRY` or `BUNDLE_UNDECLARED_ENTRY` |
| Descriptor digest/size mismatch, forged ZIP size | `BUNDLE_DIGEST_MISMATCH`, `BUNDLE_SIZE_MISMATCH` or `BUNDLE_INVALID_ARCHIVE` |
| Compression bomb; archive, index, entry-count, single-entry and expanded-byte quotas | `BUNDLE_QUOTA_EXCEEDED` or `BUNDLE_INVALID_INDEX` |
| Malformed ZIP or unsupported format | `BUNDLE_INVALID_ARCHIVE` or `BUNDLE_UNSUPPORTED_FORMAT` |

Metadata is checked before payload extraction; actual streamed bytes are bounded and hashed. Path traversal and symlink fixtures leave an external sentinel unchanged and remove failed private staging directories. The same adapter is used by HTTP preview/import; `e2e/m06-runs.e2e.test.ts` verifies a malformed archive returns stable `BUNDLE_INVALID_ARCHIVE` on both routes and leaves no import checkpoint, Workspace or transient upload directory.

Verification on the current M09 branch: `pnpm vitest run server/domain/portable-bundle.test.ts server/infrastructure/bundle-archive.test.ts server/infrastructure/portable-workspace.test.ts --maxWorkers=1 --testTimeout=30000` passed 33/33; with a real local PostgreSQL connection, `pnpm vitest run e2e/m06-runs.e2e.test.ts --maxWorkers=1 --testTimeout=30000` passed 72/72. The export fixture stages the generated Bundle and scans every extracted entry for the configured API-key, private endpoint and upload-directory sentinels; none appear. It also validates portable schemas/descriptors and rejects an injected provider `apiKey`. These assertions cover the fixed attack and leakage fixtures, not arbitrary user-authored text or deployment backups.

INH-78's attack suite is accepted. This is not M09 Gate closure: Purge replica erasure, existing staging data, backup retention and strict-current evidence remain separate pending checks.
