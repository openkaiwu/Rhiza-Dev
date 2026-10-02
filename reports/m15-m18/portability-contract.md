# M16 portability implementation contract

Status: **backend implemented and locally verified; production UI and formal acceptance pending**. Optional resource export, explicit inner v3 descriptors, strict shared assessment, bounded content/configuration preflight and refusal before incomplete activation are implemented. HTTP exact-file hydration, retained completed-archive restart recovery and explicit local endpoint/model configuration assessment are verified. This document is not preview approval or a completed Gate.

## Verified scope and current seams

[INH-130](https://linear.app/inhandy/issue/INH-130/m16bundle-ux-exportimport-preflightexternal-descriptors-与安全提示), read back on 2026-10-02, is In Progress. Its scope explicitly includes choosing whether an export contains blobs, external descriptors, import preflight for missing references/endpoint mapping/credential requirements, identical preflight and execution rules, and no secret disclosure. Its visual acceptance is separate and outstanding. Task 5 of `docs/superpowers/plans/2026-10-02-m15-m18.md` additionally requires exact omitted-file content before activation, old Bundle readability and semantic roundtrip checks.

Baseline seams inspected before implementation (historical context):

- `server/infrastructure/portable-bundle.ts`, `NodePortableBundle.export`: always exports every non-Purged ResourceVersion. It also embeds Run envelopes and emits endpoint/model descriptors. Endpoint credentials are represented by `credential_ref: null` and `credential_required: true`.
- `server/domain/portable-workspace-schema.ts`: inner v1/v2 reject unknown fields. No external-resource descriptor schema exists.
- `server/domain/portable-bundle.ts` and `server/infrastructure/bundle-archive.ts`: outer v1 index entries describe real ZIP entries. Extraction rejects missing/undeclared entries, unsafe paths and digest/size mismatches. This invariant must remain intact.
- `server/infrastructure/portable-content.ts`, `decodePortableDocument` / `validatePortableContent`: every non-Purged ResourceVersion currently requires an indexed Blob; the decoder validates references, collaboration, Run identity and Journal replay before returning facts. It discards the document's endpoint/model descriptor presentation metadata.
- `server/application/create-application.ts`: PreviewWorkspaceBundle and ImportWorkspaceBundle share `bundleImport.receive`; preview currently returns only Workspace identity, archive digest and counts. Import creates a checkpoint, retains the encrypted archive and activates through the existing UoW.
- `server/application/prepare-bundle-import.ts` and `server/infrastructure/portable-content.ts`, `NodeImportArchiveStore.stage`: recovery is bound to the retained ZIP digest and must reverify content, including after blobs-ready. Temporary external files are not a durable recovery source.
- `server/application/create-application.ts`, `activeModel`, and `server/application/replay-preflight.ts`, `assessReplay`: execution resolves local model IDs, not only endpoints. Existing SetWorkspaceModel and SetConversationModel commands change future preferences through Application/UoW. Historical snapshots remain immutable.
- `server/provider-service.ts` and `docs/provider-catalog-contract.md`: ProviderStore/SecretVault remain the installation-wide authority; no Workspace-local duplicate credential registry should be introduced.

## Implemented portable document contract

Keep the outer Bundle v1 index and strict ZIP validation unchanged. Default full exports retain their current inner v1/v2 behavior. Thin exports use an explicit new inner v3 document accepted by the new reader; old readers reject the unsupported inner version rather than silently accepting incomplete history.

Add `externalResources[]` to the v3 document, outside `facts`. Each descriptor identifies `resourceId`, `resourceVersionId`, exact SHA-256 `digest`, `size` and `mediaType`. A displayed logical name may use the existing portable-name sanitizer. Do not include filesystem locations, URLs, credentials, vault references or arbitrary metadata. Export choice concerns ResourceVersion content; Run envelopes remain mandatory historical content. Product copy must explain that omitting resource files does not remove historical messages or derived text already present in the Workspace.

Each omitted non-Purged ResourceVersion must have exactly one matching descriptor. Reject descriptors for unknown/Purged versions, duplicate version identities, mismatched resource/digest/size/type, and undeclared missing bytes. Physical bytes can be shared by digest, but validation still checks every version identity. A Blob required as a Run envelope must remain embedded even if another ResourceVersion has the same digest. Do not rewrite Manifest/Run/Journal/resource facts to accommodate absent files.

Use one assessment path for preview, hydration and actual import:

1. Verify archive structure, locally shipped schema, logical reference closure, all embedded content and immutable history exactly as today.
2. Separate declared external content from invalid or undeclared missing content. Invalid references, corrupted checksums or forged descriptors remain hard failures for both preview and import.
3. For valid external descriptors with absent bytes, preview returns `canImport: false`, bounded missing-resource identities and stable reason codes. Actual import rejects before checkpoint creation, archive retention or target Blob ingestion.
4. A supplied filename, digest string or latest attachment is insufficient. Stream and hash the actual bytes, verify exact size, and bind them to the frozen ResourceVersion. Do not fetch arbitrary paths/URLs described by a Bundle.

The descriptor list is presentation/transport metadata; `facts`, historical identities and semantic checksums do not change merely because bytes were omitted.

## Hydration and recovery

The explicit `hydrate(thinBundle, suppliedFiles)` adapter validates files in a private transient directory and produces a complete Bundle. It has no Workspace, Journal, receipt or checkpoint writes. `POST /api/bundle/hydrate` accepts bounded multipart files named bundle and resource:<resourceVersionId>, in any order. The Node adapter uses pinned MIT Fastify Busboy 3.2.2, generated private paths, serialized disk writers and complete cleanup on parse/quota/disconnect failure. Supplied filenames or server-local paths are never opened. The actual HTTP artifact has been tested through interrupted retained-archive recovery.

The completed ZIP receives a new archive digest while preserving portable facts and semantic checksums. Feed that completed Bundle through the existing preview/import/checkpoint/retain path. Reuse archive quotas and cleanup on both success and failure. The user's original thin archive and supplied files remain unchanged.

This avoids a recovery defect: retaining the original thin ZIP while ingesting temporary extra files would leave a blobs-ready checkpoint unable to restore after restart or deletion of the original upload. A complete retained artifact reuses existing encrypted recovery, digest locks and Purge inventory without a second class of external-file pins. Managed backups should always use full exports.

## Endpoint mapping and credentials

Preflight must expose historical requirements and current local readiness separately. Report source model/endpoint references, explicit selected local model/endpoint references and the selected local endpoint version. Matching a display name is not authority to map; ambiguous choices remain unresolved. Read safe catalog metadata and project only the required fields: credential configuration, allow-no-key and known health/error status. Do not return endpoint URL/header configuration or credentials in the Bundle preflight DTO.

`credential_required: true` is a portable configuration requirement, not proof that a secret existed at the source or that a target key is valid. A local no-key provider may satisfy its configuration deliberately; known invalid/revoked-key state remains visible. A failed `/models` discovery is not proof that manually configured Chat is unavailable. Missing local execution configuration does not prevent restoring complete historical data, but it must block claims that execution is ready.

For the minimum implementation, preview provides an explicit mapping plan and the UI applies chosen future preferences using the existing SetWorkspaceModel/SetConversationModel commands after successful import. Those are separate journaled user choices; the import itself preserves the original semantic checksum. Preview/import must reevaluate catalog existence and version rather than trusting a stale preview result. Do not claim returned mapping suggestions are persisted execution bindings.

If import must persist mappings atomically without changing future preference facts, that requires an explicit Workspace-scoped local-binding contract and dedicated UoW metadata persistence. It is not currently implemented and must not be improvised by rewriting historical model IDs. Endpoint-only mapping is insufficient because current Chat and Replay resolve model IDs.

Portable Exact Replay remains blocked by `portable_input_reference`/configuration differences. A mapping must never erase these differences or rewrite an old Run/Manifest. Explicit Partial or Current-model execution records the actual target configuration in a new Run through the existing lifecycle.

## Required focused verification

| Unit | Required evidence |
| --- | --- |
| Compatibility | Existing inner v1/v2 full Bundles remain readable; default export behavior is unchanged; unsupported version fails explicitly. |
| Export choice | Full/thin exports cover multiple versions, shared digests, attachment and Context-source resources, Purged tombstones and mandatory Run envelopes. |
| Descriptor integrity | Unknown/duplicate/Purged descriptors, wrong version/digest/size and undeclared missing bytes fail; a same-name or newer file cannot substitute. |
| Preview parity | Preview and import use the same assessment; absent declared bytes are explained and block activation; preview writes no checkpoint/fact/key and calls no model. |
| Hydration | Exact bytes produce a complete readable Bundle with unchanged portable facts/history checksum; source inputs survive failure; private transient files are cleaned. |
| Restart recovery | Interrupt after blobs-ready, delete original uploads, reopen the target and recover from the retained complete artifact; retries remain idempotent. |
| Mapping and credentials | Ambiguous names, unavailable models, no-key endpoints, invalid keys, discovery failure and stale endpoint versions remain distinct; explicit choices affect new execution only. |
| History and security | Manifest/Provenance/Journal checksums roundtrip; historical model/endpoint IDs remain unchanged; no operational path or secret enters descriptors or reports. |

Reuse fixtures in `server/infrastructure/portable-attachment-history.test.ts`, `portable-workspace.test.ts`, `portable-export-security.test.ts`, `e2e/m09-default-bundle.e2e.test.ts` and `e2e/m16-restore-drill.e2e.test.ts`. Derive execution from the existing package configuration: `pnpm vitest run <affected files> --maxWorkers=1 --testTimeout=30000`, followed by typecheck and applicable M02/M04 boundaries. No tests were run for this read-only contract review. Production UI changes and desktop/narrow visual acceptance remain subject to the existing preview workflow.

## Current callable surface and evidence

`GET /api/v1/workspaces/:workspaceId/bundle?includeResources=false` exports a thin v3 Bundle; absent/true keeps the compatible full export. Managed backups always remain full. Invalid option values fail. `POST /api/bundle/preview` returns documentVersion, canImport, missingResourceCount, at most 1000 exact missing descriptors, explicit truncation, and at most 1000 historical execution requirements. Missing bytes produce external_content_required; import rejects BUNDLE_EXTERNAL_CONTENT_REQUIRED before creating a checkpoint or retained/keyed copy. The content assessment, owner check, immutable history checks and private cleanup are shared by preview and import.

Two adapter cases pass for multiple versions/shared digest, Context-source bytes, tombstones, mandatory Run envelopes, semantic equality, forged/duplicate/unknown/wrong descriptors, missing undeclared bytes, unsupported versions and combined quotas. Actual HTTP case plus eleven existing export/history/security regressions pass (12 total); typecheck, affected lint, M02 and M04 pass. Thin export scanner validates the real document and scans embedded bytes, reporting omittedResourceVersions rather than claiming absent files were scanned. Its executable is replaced only in the adapter control test; production Gitleaks controls remain the existing separate commands.

The pure hydration adapter and HydrateWorkspaceBundle Application command now exist. They consume supplied byte streams bound to frozen resourceVersionId, verify actual size/digest, reject unknown/duplicate/missing supply, and write a standalone complete ZIP with unchanged facts and empty externalResources. Shared digests can satisfy several exact versions using one file. Private filenames are generated locally; supplied names/paths are never opened. Cumulative supplied-byte quota applies before deduplication. The standalone artifact remains readable after original staging disposal; failures clean transient files and preserve inputs. Application checks human archive owner before hydration and performs no Domain/model work. Two focused adapter/Application cases pass; typecheck/lint/M02/M04 pass after keeping transport types out of Application-port imports in the contract project.

HTTP hydration and independent reopened-store recovery of its completed retained archive are implemented in `dc7376b`. Actual bytes, portable/checkpoint checksums and source preservation are verified; duplicate activated recovery has zero ingest/model calls. Three upload parser cases and extended Application capability/owner/cleanup regressions pass. The complete artifact has no dependency on original upload staging.

Preview and import accept an optional `X-Rhiza-Bundle-Mappings` JSON array (12 KiB HTTP limit, at most 64 choices). A choice binds historical modelSpecRef/providerEndpointRef to targetModelId/targetProviderEndpointRef/targetEndpointVersion. Unknown historical pairs, duplicate plans, extra fields, malformed IDs or oversized plans fail before checkpoint creation. No display-name matching selects a target. `executionConfiguration` groups historical pairs with run counts, at most 1000 results, total count and truncation. It returns chosen IDs/current endpoint version and fixed reasons for missing models/endpoints, endpoint mismatch/change, missing credentials and known invalid keys. Deliberate no-key configuration can be ready; failed directory discovery alone does not block a manual model. Stale health observations are ignored. Only safe ID/version/configuration metadata is returned, without URL, headers, credentials or raw diagnostics.

Configuration ready means local configuration presence and known diagnostics; no authentication/model probe is performed. Both operations reevaluate the same helper against current safe catalog metadata. Import can restore complete history even when configuration is unresolved/blocked and returns its fresh assessment. It does not persist choices. Existing Workspace/Conversation preference commands apply separately after import. Actual HTTP verification changes an endpoint after preview, checks import/preflight parity, restores unchanged historical checksum, applies a separate future preference and preserves Run/Manifest content with Exact Replay still blocked. Pure fixtures cover no-key/invalid/degraded/stale health, rejected forged plans and bounded output. Production UI and visual/formal acceptance still prevent INH-130 completion.
