-- Pin pipeline outbox SECURITY DEFINER functions to the trusted search_path
-- set used by local-function-runtime-scan. Existing 20260820050000 used
-- pipeline_control, public which counts as unresolved.

ALTER FUNCTION pipeline_control.enqueue_outbox(jsonb)
    SET search_path TO public, extensions, pg_catalog;

ALTER FUNCTION pipeline_control.claim_outbox(integer, uuid)
    SET search_path TO public, extensions, pg_catalog;

ALTER FUNCTION pipeline_control.ack_outbox(bigint[], uuid)
    SET search_path TO public, extensions, pg_catalog;
