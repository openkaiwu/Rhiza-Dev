# M05 Domain Journal migration runbook

Use this runbook when enabling the V4.2 Domain Journal on an existing PostgreSQL deployment. The embedded PGlite backend applies schema migrations automatically; existing workspaces still need the same baseline backfill step.

## Before deployment

1. Back up the database using the deployment's normal PostgreSQL backup procedure.
2. Stop writers or put the service in maintenance mode.
3. Deploy the M05 build and run `pnpm run db:migrate`.
4. Confirm migration `0007_domain_journal_facts` is present in `rhiza_schema_migrations`.

## Establish the historical baseline

Run:

```sh
DATABASE_URL=<postgres-url> pnpm run journal:backfill
```

The command emits one `workspace.baseline.backfilled` event containing a versioned semantic snapshot and one committed receipt per legacy workspace. Its command id is stable, so rerunning it is safe and produces no additional events. Workspaces created after M05 already carry their initial snapshot in `workspace.created` and are left unchanged.

For the default embedded backend, omit `DATABASE_URL`; set `RHIZA_EMBEDDED_DATA_DIR` only when the deployment uses a non-default data directory.

## Verify before reopening writes

Run:

```sh
pnpm run verify:g0
pnpm run verify:m02:boundaries
pnpm run m05:checks
```

Confirm that each populated workspace has a `workspace_event_heads` row, a sequence-1 baseline event, and a committed `backfill:workspace-baseline:v1` receipt. Then reopen writers and verify that one normal command advances the workspace sequence and writes its state, event, and receipt together.

Compare a relational workspace with its retained legacy JSON source without writing either side:

```sh
pnpm run journal:reconcile -- <workspace.json>
```

The command exits non-zero and prints both semantic checksums when any covered domain field differs. Missing source/target data or unapplied embedded migrations fail explicitly; reconciliation does not seed Workspaces or apply migrations.

## Import a legacy JSON workspace

Keep JSON out of the production request path. Import a legacy file explicitly:

```sh
pnpm run workspace:import-json -- <workspace.json>
```

The importer writes through the relational adapter, rereads the aggregate, compares semantic checksums, and establishes the baseline. Preserve the source JSON until the checksum and baseline checks succeed.

## Recovery and rollback

- If migration or backfill fails, keep writers stopped, fix the cause, and rerun. Applied baselines are idempotent. If business events already exist without a sequence-1 baseline, backfill fails with `JOURNAL_BASELINE_ORDER_CONFLICT`; restore the pre-enable backup and run backfill before reopening writers rather than rewriting event sequences.
- If a command fails before commit, retry with the same command id. Infrastructure failures do not create rejected receipts; deterministic client rejections do.
- A deployment rollback must leave `workspace_events`, `workspace_event_heads`, and `command_receipts` intact. The 0007 down migration is for disposable/test databases only, not production rollback.
- Journal rows are append-only. Never repair them with `UPDATE` or `DELETE`; restore from backup or append an explicit compensating fact in a later catalog version.
