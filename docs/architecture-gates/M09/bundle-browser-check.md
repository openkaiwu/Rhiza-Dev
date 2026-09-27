# M09 Bundle / Provenance browser check (partial)

- Environment: isolated local embedded store and upload directory, Vite UI at `127.0.0.1:4173`, local API at `127.0.0.1:8787`; no provider or staging database configured.
- Export: downloaded `workspace.rhiza` from the seeded Workspace through the visible UI.
- Preview: selected that archive and saw a successful integrity preview with 2 messages, 0 runs, 0 resource versions, and the original Workspace ID.
- Conflict protection: importing the archive into the same store showed “目标工作区已存在，导入不会覆盖”; the existing Workspace remained visible.
- Provenance: the seeded legacy assistant message exposed a “查看来源” panel that explicitly reported no complete execution snapshot, with output ID and missing input indicated.
- Visual check: [desktop Bundle and provenance](bundle-desktop.jpg) at 1440×900 and [narrow provenance](provenance-narrow.jpg) at 390×844. The narrow panel can be dismissed and the conversation remains readable.

## Clean-store browser round trip · 2026-09-28

Using two new isolated Embedded PGlite directories and a local OpenAI-compatible fixture, the visible UI created one completed Chat Run in source Workspace `00000000-0000-4000-8000-000000000001`. Its Assistant message showed recorded provenance with Run `6a7e9012-5e99-4e9d-871a-7c80ee168775`, Manifest `23372ea0-54ee-4f3b-982c-5a1249af7f01`, model and endpoint identities. [Source desktop provenance](provenance-run-backed-desktop.png).

The UI downloaded `workspace.rhiza`. A fresh target started with default Workspace `00000000-0000-4000-8000-000000000002` so the original ID was free. Its visible preview reported 4 messages, 1 Run and 3 ResourceVersions; the confirmed import succeeded and selected the imported Workspace. The imported Assistant message resolved the same historical Run and Manifest via “查看来源”. A deliberately conflicting target with default ID `...0001` correctly refused overwrite. The imported Workspace then produced a completed Current-model Replay Run with the original Run as parent; [desktop](clean-import-replay-desktop.png) and [390×844 narrow](clean-import-replay-narrow.png) show the outcome. [Narrow provenance](provenance-run-backed-narrow.png) can scroll through the full source record above the composer.

The earlier `window.prompt()` limitation was bypassed by configuring a distinct target default Workspace ID, not by changing product code. This is a real local browser path with an isolated fixture, not a user-managed PostgreSQL staging or external-provider check. Backup expiry, complete Purge replica handling and full M09 Gate remain open.
