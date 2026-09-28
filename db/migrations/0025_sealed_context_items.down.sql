DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_projects p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.state->'contextItems','[]'::jsonb)) item WHERE item ? 'contentRef') THEN
    RAISE EXCEPTION 'Cannot remove sealed context item protection before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_projects DROP CONSTRAINT context_items_sealed_storage_valid;
DROP FUNCTION rhiza_context_items_storage_valid(jsonb);
DROP FUNCTION rhiza_context_item_ref_valid(jsonb);
