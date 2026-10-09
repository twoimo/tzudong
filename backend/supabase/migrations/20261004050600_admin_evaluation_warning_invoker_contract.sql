-- Extend the exact service-only invoker contract by one bounded warning read RPC.
BEGIN;
DO $warning_invoker_contract$
DECLARE target oid; name text; definition text; source text; before_metadata jsonb; after_metadata jsonb; anchor text; expected text[]; rewritten text;
BEGIN
 FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
  target:=pg_catalog.to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
  expected:=CASE WHEN name='definer' THEN ARRAY['1ea03935159870f74ed59945aeabf99886dd006d976d4f8607499f41dabf00f2','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964'] ELSE ARRAY['5f110169d9bcef54fa4218c6e6370cec007dc098739a27ec6dc5cbd1100adfe5','9c96bfdf0c80af38fcfe61b4f36bbc22df99aca76be56ce2758e950a7a5e4d28'] END;
  anchor:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
  SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' INTO definition,source,before_metadata FROM pg_catalog.pg_proc p
   WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::pg_catalog.regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL OR NOT(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')=ANY(expected))
   OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'G014_WARNING_INVOKER_SOURCE_DRIFT'; END IF;
  rewritten:=replace(source,anchor,$addition$      'public.admin_evaluation_warning_groups(uuid[],text)',
$addition$||anchor);
  EXECUTE replace(definition,source,rewritten);
  SELECT pg_catalog.to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF after_metadata IS DISTINCT FROM before_metadata OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM rewritten
   THEN RAISE EXCEPTION 'G014_WARNING_INVOKER_READBACK_DRIFT'; END IF;
 END LOOP;
END;
$warning_invoker_contract$;
COMMIT;
