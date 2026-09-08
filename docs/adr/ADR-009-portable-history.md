# ADR-009: Portable history, Replay and privileged Purge

- Status: Draft; implementation and M09 acceptance pending
- Date: 2026-09-09
- Baseline: V4.2 M09, inheriting V4.1 sections 10.6, 12 and 14
- Linear: INH-73 through INH-81

## Ownership and historical resolution

Application owns provenance queries, Replay preparation, export, import and Purge commands. Infrastructure implements storage and archive operations behind ports. Workspace scope and membership are checked before reading historical content or staging an import. ProvenanceLink is a stored logical relationship from output to input revisions, branch source, Manifest, Run, ModelSpec, ProviderEndpoint and runtime snapshot. Successful output and provenance commit together through WorkspaceUnitOfWork. Backfill derives only relationships supported by existing facts; outputs without Run evidence are explicitly pre-run.

Replay creates a new Run with parentRunRef and consumes the historical request and resolved frozen Manifest. It never calls the current Planner. Exact requires the recorded runtime, model and endpoint contracts to remain available and match. Partial exposes contract differences before dispatch. Current-model is an explicit user choice retaining historical input/context. A missing or purged ResourceVersion, missing Blob or integrity failure prevents implicit dispatch and returns a structured Missing-resource result. Exact describes input and execution contracts, not a guarantee of identical stochastic output. Imported endpoint descriptors require local credential mapping before execution.

## Logical Bundle v1

`workspace.rhiza` is a ZIP container with `rhiza-layout.json`, `index.json`, `schemas/` and `blobs/sha256/<digest>`. The manifest media type is `application/vnd.rhiza.workspace.manifest.v1+json`, formatVersion is `1.0.0`. JSON Schema 2020-12 schemas have stable IDs and are included by digest. Descriptors declare media type, digest and size. Unknown major formats are rejected before staging.

The logical export includes Workspace metadata and minimal membership, conversation/message/revision, ContextEnvelope/Manifest, Runs, ProvenanceLinks, ResourceVersions and required bytes, graph relations/projection seed, ModelSpecs, portable endpoint descriptors and runtime snapshots. Export uses explicit DTOs; database surrogate IDs, credentials, traces, stream frames and host locations are excluded. Logical IDs are preserved. Endpoint descriptors retain non-secret identity/config digest and capabilities; credential references are cleared and credential_required is true. Metadata and annotations receive recursive location filtering. Exported historical content retains its content semantics; sensitive operational metadata is not reintroduced through nested runtime configuration.

Export acquires a consistent committed view including Journal head, Runs and resources. It verifies required bytes and references before declaring a usable archive. An archive with unavailable external resources must identify them explicitly, and cannot qualify as a complete clean-store round trip.

## Archive validation and activation

Reuse decision (2026-09-09): [yauzl](https://github.com/thejoshwolfe/yauzl) 3.4.0 provides lazy entry enumeration and streamed entry-size validation; [yazl](https://github.com/thejoshwolfe/yazl) 3.3.1 provides streamed ZIP/ZIP64 writing. Both upstream licenses were checked as MIT ([yauzl license](https://raw.githubusercontent.com/thejoshwolfe/yauzl/master/LICENSE), [yazl license](https://raw.githubusercontent.com/thejoshwolfe/yazl/master/LICENSE)); exact versions are pinned and included in the production license report. The registry audit reported existing esbuild/qs advisories, none for these ZIP dependencies. Rhiza owns declared-entry, path/type, compression-ratio, actual-byte quota and descriptor validation. Export stores uncompressed entries so repetitive source content cannot violate the import compression-ratio limit. Private staging paths are removed on validation failure and disposed after downloads.

Portable Run inputs retain their original digest as `originInputHash` when endpoint locations are removed; `inputHash` verifies the actual portable input. Provenance runtime snapshot identity continues to use the original digest, while the archive descriptor verifies the portable bytes. Model and endpoint descriptors are qualified by Run identity, preserving historical configurations when a logical model/endpoint ID is reused. Imported snapshots require explicit Partial/Current-model Replay until an exact execution contract can be established; a matching display label alone never grants Exact eligibility.

The default limits are 2 GiB archive bytes, 10 GiB expanded bytes, compression ratio 100, 100,000 entries and 2 GiB per entry. A separately bounded index establishes the declared entry set before streaming entry validation and hashing. Reject absolute/drive paths, parent traversal, NUL, normalization escape, symlinks, hardlinks, devices, normalized duplicates, undeclared entries, size/digest mismatch and every quota violation. The archive implementation must enforce limits on actual streamed bytes, not only ZIP metadata. Library reuse requires verified license and maintenance/security review before incorporation.

Import checkpoints are validation, staged facts/blobs, reference resolution, projection rebuild, checksum verification and activation. Staging is isolated from normal Workspace listing and reads. Persisted checkpoint identity binds archive digest and target identity; resumption revalidates facts and bytes rather than trusting a completed flag. Failure quarantines or removes staging; activation is atomic through the Application storage boundary. Activation retries reconcile a previously committed result instead of duplicating it.

Empty-store import preserves every logical identity. Existing identical Workspace content is idempotent; the same identity with different content is rejected. No import-as-fork remapping is performed. Identity, provenance, graph and context checksums and core Conversation operations must survive a clean-store round trip.

## Purge and retained evidence

Archive hides normal content while retaining readable history. Tombstone hides content while preserving identity and relationships. Privileged Purge requires explicit confirmation, owner authorization, enumeration of affected references and a minimal audit fact. It marks provenance purged/redacted and retains Manifest/ResourceVersion identities. Ordinary roles continue to be denied Manifest UPDATE/DELETE. The earlier blanket refusal for nodes with execution history must be replaced only when all referenced copies are covered by the Purge flow.

The existing plaintext historical request, semantic Journal snapshots and shared content-addressed blobs require a migration before cryptographic erasure can be claimed. Deletable content must move behind encrypted, scoped data keys and immutable content references; immutable historical facts retain only non-content evidence. Purge must remove readable replicas and destroy applicable keys without deleting another Workspace's shared content. Migration and interruption tests must cover existing data, not only newly written resources. Exported user-controlled Bundles cannot be recalled; both export and Purge UI must disclose this limitation.

### Content encryption boundary (implementation in progress)

The Node content codec uses AES-256-GCM with a fresh 96-bit nonce and 128-bit authentication tag. Associated data binds the format version, Workspace ID and content ID using an unambiguous JSON tuple. Ciphertext is not released as plaintext until tag verification succeeds. The immutable envelope contains no key; keys must remain independently deletable. `sealed-content.ts` currently implements only this codec, not persistence, key destruction or migration. It must not be described as deployed encryption or completed Purge.

The migration inventory includes both `execution_runs.input_envelope` and `record.input`, `workspace_events.payload` (baseline and stateChanges), `command_receipts.result/error`, Manifest metadata, current messages/anchors/chunks, resource blobs, and retained import ZIPs. Covering only ResourceVersion blobs leaves readable replicas. Derived projections, trace/error fields and operational backups also require an explicit retention and content review. Existing immutable triggers cannot simply be disabled by a normal Application request; the administrative migration needs a separate, bounded capability and verified restart checkpoints. Ordinary UPDATE/DELETE restrictions remain in place after migration.

Resource-scoped destruction must preserve independently owned copies in other Workspaces. A global Provider SecretVault key is therefore not an erasure boundary. Key-store integration, replica migration, redacted read behavior, interrupted key-destruction recovery and backup-retention guarantees remain open implementation requirements.

## Acceptance evidence

INH-81 requires complete output provenance, all Replay classifications, no silent version fallback, closed Bundle references, no operational secret/location leaks, complete archive attack rejection, clean-store checksum equality and usable Conversation operations. Checkpoint failure injection must prove recovery. Product entry points require browser verification. This draft is not contract acceptance or milestone completion; each requirement needs executable and commit-bound evidence.
