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

M16 collaboration backend now implements scoped create/invoke/retry/stop/synthesize/retain/query APIs, immutable shared base, original-input Retry, bounded prior-round exchange, reserved participant/synthesis costs, durable cancellation, startup interruption without automatic dispatch, typed synthesis with authoritative missing participants, and referenced result retention. Application facts reuse sealed append-only Journal payloads; migration 0038 adds identity indexes only. Separate output branches keep ordinary Chat history independent. No ExecutionRun/Manifest/Provenance format is changed. See [backend contract and evidence](collaboration.md).

New PGlite evidence: invoke/exchange/synthesize and receipt idempotency; standalone ordinary Chat; scoped denial; structured partial synthesis/retention; Bundle preview/import preserving collaboration base hash and synthesis; Purge removing every owning collaboration Journal copy while preserving unrelated collaboration facts; active Stop cancels its durable Run without a Manifest; startup interruption/manual Retry; injected failure after SQL state writes leaves no partial Workspace/collaboration commit. Pure policy and synthesis validation regressions pass. The export preserves M15 sourceRevision and selects inner document v2 when new facts exist; the outer Bundle stays v1 and old inner documents remain readable.

Remaining M15: production Context/Resource/Manifest/Replay/Provenance UI, resource navigation and final visual/behavior regression. Remaining M16: product orchestration/SSE/UI, Provider catalog improvements, optional/external Bundle files and endpoint mapping, managed backup and security tooling; additional acceptance fixtures remain. M17 performance/recovery matrix and M18 IA/Graph/personal state, whole-suite verification and final branch review are still outstanding. Formal Gates remain pending. Preserve inherited Command/G0 performance failures, real staging/backup-expiry/observation and M17 real-use/new-user evidence; no skipped external gate is marked Done.
