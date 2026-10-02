# Provider catalog contract (M16 / INH-132)

The existing ProviderStore and SecretVault remain the sole Provider configuration authority. Catalogs, endpoint IDs, model IDs, credentials, favorites, pins and the default active model are global to this local installation. Workspace and Conversation model preferences remain scoped references to these IDs. This preserves M06 identity and the existing Runtime boundary; it does not introduce a second registry or adaptive routing service.

## Persistence and historical identity

ProviderStore atomically replaces its JSON file through its existing serialized queue. A failed mutation rejects its caller and leaves later saves/retries usable. Secrets remain encrypted by the existing local AES-GCM vault; safe snapshots exclude both encrypted and plaintext credentials. Workspace export consumes its portable DTO, never this global store or the vault.

Saving an endpoint produces a strictly increasing `updatedAt` version, including two saves within one millisecond. Existing Run snapshots retain their original endpoint version. Discovery observations do not change this version, model IDs, saved preferences, active selection or historical Run inputs. Refresh adds new model IDs without removing manually configured or historically referenced models. Existing display names are retained.

`discoveryHealth` is an additive optional field on the existing provider record. Old catalogs read as `unknown`; no migration or ID backfill is required. A settings save clears previous health. Readers ignore observations belonging to another endpoint version. Code rollback may discard this diagnostic field but must preserve existing IDs and encrypted credential fields; no schema down migration or key rotation is involved.

## Discovery and health

Health describes the last explicit `/models` probe, not Chat availability. No paid completion, automatic probe, retry loop or capability inference is performed. `configured` still means credentials are present or no-key use is explicitly allowed. A manually entered model remains callable after discovery fails.

| Outcome | Stored status | Stable code | Recovery |
| --- | --- | --- | --- |
| No observation / configuration changed | unknown | none | Explicit refresh |
| Valid catalog, including empty | healthy | MODEL_DISCOVERY_OK | None |
| Missing required key | unconfigured | PROVIDER_NOT_CONFIGURED | Save credentials |
| Upstream 401 / 403 | invalid-key | PROVIDER_INVALID_KEY | Check key and permissions |
| Upstream 404 / 405 | degraded | MODEL_DISCOVERY_UNSUPPORTED | Enter model ID manually |
| Upstream 429 | degraded | MODEL_DISCOVERY_RATE_LIMITED | Retry later |
| Deadline | degraded | MODEL_DISCOVERY_TIMEOUT | Check endpoint, retry |
| Transport failure | degraded | MODEL_DISCOVERY_NETWORK | Check endpoint/network |
| Invalid or oversized body | degraded | MODEL_DISCOVERY_INVALID_RESPONSE | Correct endpoint; retain catalog |
| Other upstream failure | degraded | MODEL_DISCOVERY_FAILED | Retry later |

Observations contain only status, stable code, endpoint version, check time and successful model count. They never retain response bodies, headers, error text or credentials. API errors use fixed descriptions and explicit recovery actions; invalid-key/unsupported/invalid-response are not blindly retryable. HTTP 502 for an upstream credential refusal is distinct from local Workspace authorization.

Discovery has a deadline of min(AI timeout, 10 seconds), a 2 MiB body bound and at most 500 new catalog entries. Every entry is validated before any model is added. A stalled body is canceled at deadline. Redirects are rejected. Concurrent refreshes of the same endpoint version share one request. The final serialized mutation rechecks the endpoint version; stale success and failure cannot overwrite saved settings or health.

## Application and HTTP

All operations enter Application commands/queries and the existing ProviderManagement port. The global provider store remains the documented exception to Workspace UoW persistence; no Workspace contents are written by these operations.

- `GET /api/providers`: optional `search`, `providerId`, `favorite=true|false`, `pinned=true|false`, `sort=preferred|name|provider`. Defaults preserve pinned/favorite/name order with an ID tie-breaker. Filtered reads retain activeModelId and its file policy even if the active model is hidden. Queries do not persist filters.
- `POST /api/providers/:id/discover`: existing shape `{catalog}` on success; health is readable after failure.
- `POST /api/providers/discover`: `{providerIds, failedOnly?}`; 1–20 unique, existing IDs are validated before requests. At most three endpoints run concurrently. Response `{catalog, results}` preserves request order and reports succeeded/failed/skipped per endpoint. With failedOnly, only current-version failed observations are retried; unknown/healthy/stale observations are skipped. No automatic retries occur.
- Save, favorite/pin and selection APIs retain their existing request/response shapes.

## Evidence and remaining acceptance

`server/provider-service.test.ts` covers safe persisted health, credential errors, malformed catalogs, timeout/body cancellation, manual Chat after discovery failure, concurrent deduplication, stale settings rejection, failed store recovery, batch partial results/retry, and read-only filters. `server/app.test.ts` exercises the actual HTTP → Application → ProviderStore path, fixed recovery metadata and unchanged Workspace data. Existing settings/runtime characterization is retained. No new dependency or copied third-party code was needed: the existing registry, OpenAI-compatible adapter, native Fetch and serialized atomic store supply the required capabilities.

Production Provider UI and its desktop/narrow acceptance remain pending the UI prototype approval. The actual Bundle secret/export-negative fixture remains part of the separate portability/security unit; these catalog checks alone do not close that acceptance or the M16 Gate.
