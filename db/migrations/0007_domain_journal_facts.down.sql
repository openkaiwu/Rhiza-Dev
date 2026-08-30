DROP TRIGGER IF EXISTS workspace_events_reject_truncate ON workspace_events;
DROP TRIGGER IF EXISTS workspace_events_append_only ON workspace_events;
DROP FUNCTION IF EXISTS rhiza_reject_workspace_event_mutation();
DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS workspace_events;
DROP TABLE IF EXISTS workspace_event_heads;
ALTER TABLE rhiza_attachments DROP COLUMN IF EXISTS chunk_count;
ALTER TABLE rhiza_attachments DROP COLUMN IF EXISTS summary;
