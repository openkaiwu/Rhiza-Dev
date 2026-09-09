DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rhiza_projects p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.state->'fileChunks','[]'::jsonb)) item WHERE item ? 'contentRef') THEN
    RAISE EXCEPTION 'Cannot remove sealed file chunk protection before restoring content';
  END IF;
END $$;
ALTER TABLE rhiza_projects DROP CONSTRAINT file_chunks_sealed_storage_valid;
DROP FUNCTION rhiza_file_chunks_storage_valid(jsonb);
DROP FUNCTION rhiza_file_chunk_ref_valid(jsonb);
