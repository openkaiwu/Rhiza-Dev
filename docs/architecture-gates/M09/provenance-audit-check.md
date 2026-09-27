# Provenance coverage audit — partial M09 evidence

`m09:provenance:audit` takes one PostgreSQL snapshot across every Workspace. It counts live Assistant outputs without a stored ProvenanceLink, links explicitly marked broken, and malformed or dangling recorded links. It reads no message body and fails when any of those counts is nonzero. The E2E fixture verifies missing, backfilled, broken and invalid states.

This proves only database coverage at the audited instant. It does not prove every Replay policy, source Blob integrity, historical exported Bundle, or user-managed staging data; `provenance_replay` remains pending until those checks and the real staging audit pass.
