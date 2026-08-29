DROP TRIGGER IF EXISTS workspace_events_append_only ON workspace_events;
DROP FUNCTION IF EXISTS rhiza_reject_workspace_event_mutation();
DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS workspace_events;
DROP TABLE IF EXISTS workspace_event_heads;
