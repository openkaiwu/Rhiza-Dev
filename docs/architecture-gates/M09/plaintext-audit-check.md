# M09 historical plaintext audit (partial)

`m09:checks` now runs both the all-Workspace plaintext-replica count and scoped-key reference audit before the general checks. The plaintext audit counts committed/rejected receipts, Run inputs, Journal payloads, messages, manifests, nodes, segments, anchors, edges, attachments, resources, ResourceVersion Blob references, ContextItems and FileChunks in one database snapshot. It prints counts only and fails when any count is nonzero. Existing database constraints require sealed rows to remove inline authored fields; this audit identifies rows still awaiting migration.

Verification on this implementation:

- Embedded and isolated local PostgreSQL: `e2e/m09-purge-checkpoint.e2e.test.ts` passed 10/10 with PostgreSQL configured; the new case confirms an empty migrated database reports zero, while seeded legacy Node/Message/Journal/Context rows are counted.
- Isolated local PostgreSQL: all 0034 migrations applied; `pnpm run m09:plaintext:audit` reported zero for all 15 families on an empty database.
- A populated PostgreSQL migration rehearsal now starts with nonzero counts for all 15 audited families (including rejected receipts, Run input, Manifest, attachment, chunk, anchor and edge), seals each inline family in one-row batches, verifies repeat runs migrate zero, then seals the ResourceVersion Blob. The all-family plaintext audit becomes zero, the Workspace semantic checksum and portable Journal replay remain equal, and verified old-file reclamation preserves encrypted bytes. This is an isolated fixture, not the user-managed staging dataset.
- Unit 83 files/344 tests passed; default E2E 81 passed/56 PostgreSQL skipped; after the additional projection regression, isolated PostgreSQL E2E passed 139/139. An earlier full PostgreSQL run had one non-reproducing fixture `GET /api/workspace` 404 in `m06-runs`; its individual test and full file passed on retry. This fluctuation remains an observation, not a staging pass.
- Typecheck, affected-file ESLint, license verification, G0, strict M02 boundary, M04 Host boundary and production build passed.

This is not M09 closure. The audit has not run on user-managed staging or verified migration of its data; it does not scan historical blob files, WAL, backups or exported Bundles. Purge replica erasure and the M09 acceptance checklist remain pending.
