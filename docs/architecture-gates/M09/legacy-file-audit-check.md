# Known legacy file replicas — partial M09 evidence

`m09:files:audit` is read-only and requires the stopped deployment's PostgreSQL `DATABASE_URL` and explicit `RHIZA_UPLOAD_DIR`. It holds runtime ownership and the content-lifecycle lock, takes a repeatable-read snapshot of every Workspace's ResourceVersion digests, old attachment storage keys and retained import checkpoint digests, then checks their known raw-file locations plus abandoned import work directories. It prints counts only and fails when any is nonzero. The unit fixture verifies the four categories without removing files.

This cannot prove arbitrary unreferenced files, WAL, backup expiry or user-controlled exported Bundles are gone. No user-managed staging upload directory or backup policy has been audited; this partial check does not close `backup_retention` or `purge_replica_erasure`.
