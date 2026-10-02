# M15–M18 delivery evidence

Baseline: update1002 / 478872e. Full goal remains in progress; this is incremental evidence, not milestone closure.

Implemented backend units: distinct Context modes; bounded read-only preview; version-bound accept/reject with reasons, stale-source rejection and idempotent transactional persistence; safe fallback, Manifest identity and temporary input filtering; read-only Replay policy/config preflight sharing execution guards; no static recommendation in new server seeds. No user database migration, historical rewriting or production UI redesign performed.

Verified targeted checks (actual current work):

- Planner/indexed-mode regressions: 19 passed before the additional seed regression; seed regression then passed in the application group.
- Application/legacy HTTP/planner group: 60 passed. Additional Manifest/temporary-input regression: 5/5 M15 application tests passed.
- PGlite Context HTTP: preview changes no activity, no unconfirmed source reaches a Manifest/model input, accept is idempotent, accepted reason/fingerprint survives encryption, confirmed source enters the next Manifest, changed source is rejected and nonmember Workspace is forbidden.
- Existing frozen Replay E2E enhanced with preflight: passed; exact/partial/current-model, config drift, corrupted resource and zero preflight model calls.
- Typecheck and strict M02 architecture boundary passed. Targeted lint passed after removing a stale import. Full build/test/license/boundary sweep is reserved for stable delivery.

Preview: [interactive HTML](design/preview.html), [implementation contract](design/contract.md). Browser checks: 1440x900 and 390x844; confirmation updates selected state; narrow navigation/Workspace title retained. Screenshot evidence is prototype evidence, not production acceptance. Approval pending.

Remaining M15: production Context/Resource/Manifest/Replay/Provenance UI, resource navigation and final visual/behavior regression. M16–M18 implementation and broad verification are still outstanding. Formal Gates remain pending. Preserve inherited Command/G0 performance failures, real staging/backup-expiry/observation and M17 real-use/new-user evidence; no skipped external gate is marked Done.
