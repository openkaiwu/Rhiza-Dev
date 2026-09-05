# ADR-008: Versioned Context materialization and historical resolution

- Status: Accepted; M08 gate passed
- Date: 2026-09-06
- Baseline: Rhiza V4.2 M08

A Contributor turns a changed source into a candidate. CandidateIndex owns the replaceable, versioned search materialization; Planner applies deterministic selection and budget rules to bounded candidates; Compiler freezes selected content into real immutable ResourceVersions before execution. The existing deterministic ranking remains the default implementation. This separates source maintenance from request-time planning while preserving Strict and explicit-selection behavior.

## Identity and lifecycle

A source is identified by Workspace, source type and source ID. Node/segment/reference content is captured as a context-source ResourceVersion; file/chunk contributions retain provenance to the original ResourceVersion and freeze the exact contributed text as necessary. A materialization is derived data with a contributor/tokenizer/index version and source revision. Changed source facts update only affected rows, including message-to-node/segment dependencies; rebuild is explicit. Query audit must record actual storage operations and prove that regular planning does not read or enumerate the full Workspace.

Planner queries are capped at 500 candidates and consume a bounded graph neighborhood. Explicit selections must be resolved even when lexical search would not return them. A missing explicit source is classified as missing rather than reusing stale UI content. Strict selects explicit items only; explicit/pinned items retain their established precedence even if their total exceeds the automatic budget. Automatic candidates compete only for remaining capacity.

## Cache identity

Only the selection plan is cached, not an ExecutionRun, request ID or historical Manifest. Identity includes Workspace, node, prompt, mode, explicit selection (order, role, pin, exclusion and selection mode), attachments, budget, source digest/revision vector and existing ResourceVersion/digest for file and chunk sources, index version/revision, graph checkpoint, contributor versions, tokenizer, Planner, Compiler and selection-policy versions. Each lookup first validates authoritative index/source revisions. New node/segment/reference ResourceVersions are allocated after planning by Compiler, so their future IDs are not cache dependencies. Edge changes advance the index revision even when no source text changes. Misses expose stable cold/input/sources/index/runtime reasons. Ranking failure falls back to resolved explicit/current input with planner_failed and is retried next time; index/version/source lookup failures remain errors. Cached results are copied at the boundary so callers cannot mutate later hits.

## Frozen evidence and history

Each Manifest v1 selected item records the actual ResourceVersion ID and digest, exact selection reason, priority, mode, token count and contributor/Planner/Compiler versions. Compiler captures each selected source as a per-execution context-source Resource with one immutable version. Its raw-v1 blob is a versioned JSON object containing the exact text, including empty strings; content-addressed storage deduplicates identical bytes across executions. The original source identity remains in Manifest and file/chunk provenance retains its original ResourceVersion/digest. Compiler verifies bytes through the existing BlobStore; the returned Resource facts commit atomically with Run creation before provider dispatch. Immutable Manifest insertion and successful message/Run persistence retain the existing transaction boundary. Database triggers reject UPDATE and DELETE; insertion cannot silently replace an existing Manifest. Legacy manifests remain readable with explicit legacy-unversioned resolution.

Historical resolution follows the frozen Manifest and ResourceVersion references and verifies the stored digest. It never calls the current Planner or substitutes current source content. Missing resource, version, blob, digest mismatch and legacy-unversioned are distinct outcomes, surfaced in the explanation UI. These same outcomes remain visible when the source has been edited or archived.

## Reuse and scope

Use the existing PostgreSQL/PGlite, Resource/BlobStore, tokenizer and deterministic ranking implementations. A separate search engine would duplicate the current transaction and version lifecycle at this stage. External embedding and Memory belong to M22; M08 defines the contributor seam and retains existing local feature hashing behavior. M09 owns broader Replay/Provenance product work; M08 delivers historical Manifest resolution and its explanation panel.
