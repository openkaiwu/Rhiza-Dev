# M09 Bundle / Provenance browser check (partial)

- Environment: isolated local embedded store and upload directory, Vite UI at `127.0.0.1:4173`, local API at `127.0.0.1:8787`; no provider or staging database configured.
- Export: downloaded `workspace.rhiza` from the seeded Workspace through the visible UI.
- Preview: selected that archive and saw a successful integrity preview with 2 messages, 0 runs, 0 resource versions, and the original Workspace ID.
- Conflict protection: importing the archive into the same store showed “目标工作区已存在，导入不会覆盖”; the existing Workspace remained visible.
- Provenance: the seeded legacy assistant message exposed a “查看来源” panel that explicitly reported no complete execution snapshot, with output ID and missing input indicated.
- Visual check: [desktop Bundle and provenance](bundle-desktop.jpg) at 1440×900 and [narrow provenance](provenance-narrow.jpg) at 390×844. The narrow panel can be dismissed and the conversation remains readable.

This is not the M09 browser Gate: clean-store import, post-import Replay, a real Run-backed provenance record, and staging-backed execution remain unverified. The seeded legacy message is not evidence of Replay correctness. The in-app browser runtime rejected the existing `window.prompt()` used by “新建”, so that control could not establish the distinct Workspace needed for a browser-only clean-store round trip.
