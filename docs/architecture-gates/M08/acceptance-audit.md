# M08 acceptance audit

Date: 2026-09-06. Scope: V4.2 M08, with the unchanged V4.1 Context Runtime requirements. The primary implementation agent performed the final code/spec audit; executable acceptance is recorded by the adjacent commit-bound `evidence.json`.

| Requirement | Implementation and executable evidence |
| --- | --- |
| Four independently testable layers | `contracts.ts`, `lexical-contributor.ts`, `indexed-planner.test.ts`, `context-compiler.test.ts`; existing deterministic ranking and tokenization reused. |
| Incremental candidate materialization | `postgres-index.ts` updates affected node/segment/file/chunk/reference rows in the source transaction. `m08-context-index.e2e.test.ts` proves changed-message propagation, edge-only revision advancement, transaction rollback and rebuild equivalence. |
| Scan-free regular planning | Production `IndexedContextPlanner` reads only indexed candidates and bounded adjacency under the Workspace lock. Integration rejects aggregate source-table queries. Benchmark archives actual SQL and returned-row counts for 1k/10k nodes. This claim concerns regular planning; legacy startup and write-side aggregate loading remain. |
| Full cache identity | Tests vary Workspace, node, prompt, mode, selection, attachments, budget, source revision/digest/ResourceVersion, index/revision/graph checkpoint and runtime versions. Each attempt rereads authoritative revisions; cached values are copied. |
| Failure behavior | Ranking failure retains resolved explicit/current items, respects exclusion and retries next time. Missing explicit sources and unsupported index versions remain classified errors. No stale UI-content substitution. |
| Frozen source coverage | The M08 case in `m06-runs.e2e.test.ts` uses all five source types, checks real ResourceVersion/digest references and file/chunk origin provenance, and verifies frozen blobs equal dispatched input. Resource facts exist before provider dispatch. |
| Immutable Manifest v1 | Migration 0012 validates scoped ResourceVersion references on insertion and rejects UPDATE/DELETE, including the legacy purge flag. SQL integration tests attempt both mutations and forged digests. Legacy stored manifests are unchanged. |
| Historical resolution | Both user and assistant messages resolve the same frozen Manifest after source archive. A Planner spy must receive zero calls. Blob tests distinguish missing resource/version/blob, digest mismatch and legacy unversioned data. |
| Selection characterization | Existing Context characterization plus indexed tests enforce explicit pin precedence, Strict behavior, exclusion, budget, low-score and chunk-limit explanations. |
| Product explanation | Production App and history panel tests cover loading, return, stale Workspace responses and missing evidence. `visual-acceptance.md` archives the direct visual PASS for desktop and a 270px panel. |
| Performance and recovery | `benchmark:m08` records 20 measured samples after three warmups, index bytes and complete incremental-write latency at 1k/10k nodes. The 250ms lookup p95 target is observational in M08. `context:rebuild` reconstructs derived index rows; the gate validates raw samples, commit identity and SQL bounds. |

Deployment applies migrations 0011/0012 through the existing migration runner. For an existing Workspace, run `pnpm run context:rebuild` before planning if its index head is absent or stale. Rebuild does not modify frozen history. Frozen Resource facts use the existing append-only storage boundary; versioned Manifest deletion cannot bypass retained execution history.

The full gate includes lint, typecheck, all unit/E2E tests, license verification, G0 characterization and schema snapshots, module/Host boundaries, the M08 benchmark and production build. Real PostgreSQL E2E is explicitly skipped when `DATABASE_URL` is unavailable; PGlite uses the same migrations and is mandatory. Test and performance outcomes belong to the generated evidence, not manually asserted coverage counters.
