# M16 collaboration backend contract and evidence

This is incremental engineering evidence. M16 production UI, Provider, optional/external files, endpoint mapping, managed backup and security tooling remain pending. No formal Gate is closed.

Application exposes Workspace-scoped `/api/v1/workspaces/:workspaceId/collaborations` routes (legacy default-Workspace routes remain usable):

| Method/path | Operation |
| --- | --- |
| POST collection | Create with prompt, mode, 2–4 modelIds and synthesisModelId; optional attachmentIds and reduced token/time/round budgets |
| GET collection / `/:id` | Read recent records or one record; never dispatch |
| POST `/:id/invoke` | Explicit participantId/round; commit budget reservation and Run before dispatch |
| POST `/:id/retry` | Failed/interrupted attemptId; new child Run using that attempt's frozen inputs |
| POST `/:id/stop` | Persist Stop first, then independently cancel all active Runs |
| POST `/:id/synthesize` | Explicit synthesis using quoted terminal outputs and authoritative missing participants |
| POST `/:id/retain` | Explicit same-Workspace targetNodeId; create a new Message referring to the synthesis output |
| POST `/:id/stream` | Explicit finite mode execution via SSE; deterministic child identities, participant events, state summaries and final committed record |

Limits: 4 models, 5 rounds, 32000 total token estimate, 180 seconds; synthesis reserves 4096 tokens and each provider completion is limited to 1024 tokens. Independent review/second opinion default to one round; peer review/debate default to two for a real exchange. Unknown or estimated usage charges the full reservation. Provider usage can exceed an estimate; charged overruns stop future reservations. Expired recovery retains the original deadline; creating a new collaboration is an explicit user action.

Core Run/Manifest/Provenance formats stay unchanged. Participant outputs live in a dedicated branch; ordinary Chat stays on its original node until explicit retention/navigation. Application facts append to sealed Journal payloads with compare-and-swap reservation checks. Terminal facts settle against the latest locked record, so concurrent completions preserve both outputs and Stop cannot be overwritten. Migration 0038 adds identities/indexes only, and is tested on isolated databases; no user database was migrated. Terminal output and facts are atomic. Startup interrupts active work; it never assumes an external call succeeded and never dispatches an automatic retry.

Typed synthesis requires recommendation, rationale, alternatives with pros/cons/applicability, risks, disagreement and valid sourceOutputRefs. The server adds missingParticipants; model output cannot erase failures or invent references. Retention preserves the original output and creates a new referenced Message through the existing merge path.

Streaming dispatch is sequential within each bounded round. This keeps reservation order deterministic without adding a scheduler; concurrent explicit participant calls remain supported by the underlying lifecycle. A single start receipt prevents concurrent/lost-response starts from dispatching again. Interrupted streams require manual participant review/Retry. Provider failures remain evidence in subsequent exchange/synthesis; no failed participant is automatically retried. Network disconnect durably stops the pass and cancels its active Run. Convergence is advisory and never changes hard limits. SSE state events omit frozen input bodies; the final record is delivered after transactional commit.

Bundle keeps its v1 container and uses an explicitly versioned inner v2 document for new facts. Validation checks resource identities/digests and output history; legacy inner v1 still reads. Import recreates collaboration Run indexes, and storage-location rewrites do not change the base hash. Purge owns snapshots created before the first participant Run, removes every encrypted Journal version of the owning collaboration, and preserves unrelated facts. Active and retained cross-object references remain protected.

Verified with fake Runtime and isolated PGlite:

- First-round base equality and no visibility; later exchange and single participant Retry; duplicate commands do not repeat model calls; ordinary Chat history stays independent; nonmember Workspace denial.
- Partial typed synthesis and failure visibility; referenced retention is idempotent and does not overwrite the original output.
- Bundle preview/import roundtrip preserves base hash and synthesis. Owning Purge makes collaboration unreadable and finishes all key checkpoints while unrelated collaboration remains readable.
- Active Stop cancels Run with no Manifest; simultaneous participant completions preserve both terminal outputs; startup interruption/manual Retry with no automatic repeated calls; injected failure after SQL writes rolls back Workspace/collaboration state.
- Policy hard token/time/round limits; conservative unknown usage; invalid synthesis provenance/format rejection; sourceRevision survives export with inner v2.
- Exact historical attachment Blob survives current attachment version changes; mismatched digest still rejects.
- Four mode stream fixtures preserve first-round isolation, prior-round exchange and partial failure; repeated streams produce zero new calls. Expired budgets dispatch zero calls. Real HTTP disconnect cancels durable work, saves no late Manifest, and blocks concurrent/repeated starts.
- Six existing shared Run/Bundle/cancel/rollback/isolation/Retry regressions pass. Typecheck, targeted lint, M02/M04 boundaries and M10 legacy-write inspection pass.

Required commands are derived from package.json. New targeted entrypoint: `pnpm run m16:collaboration:checks`. Existing affected shared checks used `pnpm vitest run e2e/m06-runs.e2e.test.ts -t 'commits terminal|cancels an uncooperative|rolls back a successful|rejects cross-workspace|captures complete portable|reconstructs Retry' --maxWorkers=1 --testTimeout=30000`. Filtered-out tests were not disabled. Full lint/build/test/license sweep and one whole-branch reviewer remain scheduled for stable M15–M18 delivery.
