# ADR-007: Workspace graph is a bounded, rebuildable read model

- Status: Accepted
- Date: 2026-09-05
- Baseline: Rhiza V4.2 M07

## Context

Rhiza needs one graph vocabulary across conversations, messages, resources, runs and later object families. The existing `DiscussionNode` graph is a product-write model and cannot safely become the public query contract. Graph reads must remain bounded, while layout and projector bookkeeping must not leak into Domain or `GraphView`.

## Decision

`ObjectRef { workspaceId, objectType, objectId, versionId? }` is the stable identity used by graph contracts. `objectType` and `relationType` are additive strings; the catalog maps the current legacy relations to `derived_from`, `references`, `related_to` and `merged_into` without closing the set.

`workspace_objects` and `graph_relations` are rebuildable projection tables. A per-workspace checkpoint records the applied Domain Journal sequence and semantic checksum. Normal reads acquire the Workspace write lock, read Current State, Run records and removal history consistently, and reconcile changed rows into the active projection namespace in the same transaction as its checkpoint. An explicit rebuild writes a fresh immutable namespace, verifies the complete write by completing the transaction, then switches `projection_aliases`; the previous namespace remains available for rollback.

`graph_layouts` and `graph_layout_nodes` own coordinates independently of the semantic object registry. Current legacy node coordinates are migration input and a compatibility fallback only. Rebuild seeds missing layout rows and preserves existing coordinates and collapsed state; layout is excluded from the graph semantic checksum. Archive remains visible as lifecycle metadata, while bounded graph queries include only active relations in traversal.

The HTTP contract exposes neighborhood, path, tree and changes queries. Neighborhood depth is at most 3, results are capped at 500 objects and 2,000 relations, and list queries use checkpoint-bound cursors for independent object and relation pages. Clients retain cross-page relations and render them when both endpoints are loaded; stale cursors require a refresh. Changes with a different checkpoint explicitly request a bounded paginated reset. GraphView receives only the UI-facing adapter model, never projection versions, checkpoints, SQL rows or Journal envelopes.

## Consequences

- New object and relation families do not require a schema enum migration.
- Current State remains authoritative; projection data may be dropped and rebuilt.
- Rebuild is operationally safe because readers change versions only through the alias.
- M07 does not choose the final M18 graph interface or introduce Workflow semantics.
