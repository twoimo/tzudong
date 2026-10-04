-- Extend the exact service-only invoker contract by one bounded page read RPC.
BEGIN;
DO $page_invoker_contract$
DECLARE target oid; name text; definition text; source text; before_metadata jsonb; after_metadata jsonb; anchor text; expected text[]; rewritten text;
BEGIN
 FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
  target:=pg_catalog.to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
  expected:=CASE WHEN name='definer' THEN ARRAY['3a367f4fbe71cd16b77e446042f8f4675f87a7fd233ab171c6cc401ed242aeb9','8b6e377032108a9ffbef45a029e4cc19fffcf643bac6c0e65c25a1b58c5ce3da'] ELSE ARRAY['09d7990c97934dcac3bd94a592f9ec1f844594403bd7f85b6c3893dd956cc7e6','f4e6e6b4d5c05d7dc44cd46689911a5113f5f513ff37677737749c9d9928634d'] END;
  anchor:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
  SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' INTO definition,source,before_metadata FROM pg_catalog.pg_proc p
   WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::pg_catalog.regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL OR NOT(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')=ANY(expected))
   OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'G014_PAGE_INVOKER_SOURCE_DRIFT'; END IF;
  rewritten:=replace(source,anchor,$addition$      'public.admin_evaluation_page(jsonb,integer,uuid,text)',
$addition$||anchor);
  EXECUTE replace(definition,source,rewritten);
  SELECT pg_catalog.to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF after_metadata IS DISTINCT FROM before_metadata OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM rewritten
   THEN RAISE EXCEPTION 'G014_PAGE_INVOKER_READBACK_DRIFT'; END IF;
 END LOOP;
END;
$page_invoker_contract$;
COMMIT;
