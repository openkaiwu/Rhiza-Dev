# M11–M14 engineering delivery

Branch: `update1002`; original base: `789f54c`. Implementation uses existing React, Application/UoW, encrypted relational persistence, candidate index, Run lifecycle and Node Host adapters. No production dependency was added. Existing licenses were verified with `pnpm run licenses:verify`.

## Functional scope

- M11: bounded scoped SQL graph list/neighborhood/path/tree/change queries, same-transaction incremental projection, scale/trace benchmark and current Node/headless evidence reuse.
- M12: durable Stop with command lookup, temporary SSE/TEMP_RESULT, scoped model preference hierarchy, server Retry lineage/new Manifest, stable recovery classes and existing offline/IME/focus controls.
- M13: Conversation rename/status, Workspace forms/archive/restore, original-message Segment Anchors/archive/restore, indexed Chinese/case-insensitive partial search, explicit Merge target/full reply or confirmed summary.
- M14: graph filters/path/navigation/legend, rectangle culling, bounded cache, semantic zoom, Context actions, archive/restore and read-only Purge tombstones.

Migration `0037_product_preferences.up.sql` is additive. Historical Message/Manifest/ResourceVersion content remains immutable. Old Bundle v1 files remain readable; optional new fields are absent from old semantic snapshots, and preference clearing is an explicit replayable null delta. Rollback retains current schema and content encryption; the compatible code floor must include migration 0037. No down migration or user-data cleanup is part of this delivery.

## Evidence map

| Invariant | Executable evidence |
| --- | --- |
| M01–M04 contracts/Host/isolation | G0 characterization; `verify:m02:boundaries`; `verify:m04:host-boundary`; Node Host unit tests; Workspace directory/scope and UoW unit tests |
| M05/M08 Context/Manifest/history | `m05-journal.e2e.test.ts`, `m08-context-index.e2e.test.ts`, Context Compiler/planner tests |
| M06 durable Run/Stop/Retry/10k trace separation | `m06-runs.e2e.test.ts`, including M12–M13 HTTP regressions |
| M07 graph rebuild/checkpoint/layout/rollback | `postgres-store.e2e.test.ts`, `m11-graph.e2e.test.ts` |
| M09 Bundle/Provenance/Purge/privacy | `m09-default-bundle.e2e.test.ts`, `m09-provenance.e2e.test.ts`, `m09-purge-checkpoint.e2e.test.ts`, Bundle archive/security unit tests |
| M10 State/Journal/Receipt/recovery/writes | `m10-write-path.e2e.test.ts`, `m10-rollback.e2e.test.ts`, `scripts/m10-inspection.test.ts`; `m10:reconcile`, `m10:legacy-writes`, `m10:rollback` |
| M13 immutable range/optional history | Application command tests; portable semantic schema/history tests |
| M14 cache/viewport | `GraphView.test.tsx`, `graph-model.test.ts`, `graph-viewport.test.ts`; desktop/narrow browser reports |

Repository commands are derived from package.json: `pnpm run lint`, `pnpm run build` (includes typecheck), `pnpm run test`, `pnpm run licenses:verify`, `pnpm run verify:g0`, `pnpm run verify:m02:boundaries`, `pnpm run verify:m04:host-boundary`. Focused aggregators are `m11:checks` through `m14:checks`; `benchmark:m11` writes machine-readable raw samples and exits nonzero when thresholds fail. Tests run once broadly; fixes rerun only affected cases.

## Performance and formal acceptance

`reports/m11-m14/performance.json` records the local encrypted PGlite profile with 300 Conversations, 10k graph objects/50k relations, 20 warmups/200 samples, concurrency 1 and no external network. Command p95 673.1 ms/p99 2624.1 ms exceeds the 200/500 ms gate. Graph p95 22.1 ms/p99 23.1 ms passes 150/400 ms; Context p95 7.7 ms passes 250 ms. 10k Trace concurrent primary p95 regression is -21.7%, within 25%. These are synthetic local observations, not business staging or dogfood evidence. Absolute Command performance remains open; do not close INH-99 or M11 Gate. Archived Linux JSON G0 measurements are not comparable with this macOS encrypted PGlite profile; the relative gate remains pending.

Real staging, cross-session complex-project dogfood, backup expiry and continuous observation are deferred. No ready local PostgreSQL was available; its existing integration cases report skipped, while PGlite is the functional backend. M11–M14 formal Gates remain pending external/dependency/performance evidence. INH-90 is architectural observation only; no deferred Task/Workflow/Executor platform is invented. Verification results and browser observations are finalized alongside the delivery commits and synchronized to Linear without claiming Gate Done.

## Independent review and compatibility observations

One fresh review found one Critical and five Important issues. The same fix pass addressed all six: retained-namespace Segment Purge content/edges, ambiguous Retry identity, delayed Retry cancellation, independent relation-page caching, stale detail/path responses, and older materializer upgrades. Each finding has a failing reproduction and targeted passing regression; no second review loop was run. Recovery text now distinguishes local transport termination from a confirmed persisted outcome.

INH-90 is observational only. `server/m11-seams.test.ts` carries application-owned Task/Conversation/Artifact and WorkflowDefinition/WorkflowRun refs through generic bounded read seams, and exercises a fake side-effecting executor through RuntimePort. Current production fact mapping, Command types and Host/Run metadata do not yet define Task/Workflow persistence, effect receipts, approval or fencing. Those gaps remain inputs to M20/M24/M25; no future platform API is introduced.

Archived G0 snapshots/evidence are immutable commit-bound records. Current additive contract snapshots are retained under `docs/architecture-gates/M11/contract-snapshots/`; normal `verify:g0` still reports current contract drift. Characterization and current boundary checks are separate evidence, not a new G0 pass. Compatible code rollback floor: `1145401`, which includes migration 0037; rollback preserves schema/encryption/history.

The browser covers desktop 1440×900 and narrow 390×844. The 300-node graph report records 20 warmups/200 event-to-React-DOM-commit samples, p95 0.4 ms/p99 0.6 ms, zero offscreen cards, and unchanged Domain facts. This equivalent interaction budget excludes browser compositor/display latency and does not claim real multi-session dogfood.
