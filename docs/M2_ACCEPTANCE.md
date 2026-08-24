# M2 Acceptance — Rhiza Domain & Persistence

> **Historical Evidence Only(2026-08-22)**:本文件是 Legacy 里程碑验收证据,其编号不定义当前 Milestone。当前基线见 `docs/Rhiza_开发路线图_V4.1_20260824.md`(统一 M01+ 编号)。

## Delivered

- `WorkspaceRepository` isolates the application from JSON and PostgreSQL storage.
- PostgreSQL persistence is enabled explicitly with `postgresPersistence=true` and uses a bounded connection pool.
- Project, Node, Segment, Event, provenance/version fields, graph relations, manifests and attachments restore from relational tables.
- Each mutation is committed in one transaction and records a durable audit event.
- Event ordering uses a per-node indexed database ordinal rather than timestamp ties.
- Node archive/restore is distinct from irreversible graph-node deletion; archived nodes are read-only.

## Verification

Run the complete gate:

```bash
npm run verify:m2
```

The embedded PostgreSQL suite applies and rolls back all migrations, exercises transactional recovery, and restores a 1002-event project in stable order. When `DATABASE_URL` is present, the same migration suite also runs against the real PostgreSQL service.
