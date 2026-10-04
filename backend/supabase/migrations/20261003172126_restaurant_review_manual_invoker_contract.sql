-- Extend the exact service-only invoker contract by one guarded manual RPC.
BEGIN;
DO $manual_invoker_contract$
DECLARE target oid; name text; definition text; source text; before_metadata jsonb; after_metadata jsonb; anchor text; lock_anchor text; expected text[]; rewritten text;
BEGIN
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
    target:=pg_catalog.to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
    IF name='definer' THEN
      expected:=ARRAY['065ace73391eac29c07ef05e3ca7ddd4e6caf41612b1f5898e19f8bea641b7a7','e493c6006fccf728f08813122c0251526b487bdaa27d4102d4a60193f54b56b4'];
      lock_anchor:=$definer_lock$WHEN v_signature IN (
              'public.restaurant_review_automation_tick(uuid)',$definer_lock$;
    ELSE
      expected:=ARRAY['c7b4beb25cbdbad1c851e3fa2b33280e623bed55cbe21b52d75bb743114f6bd6','e3dad767fb3fcd7dcf90da77b71ec18f6e328cc82e51fb6714f89a6c02f5857b'];
      lock_anchor:=$catalog_lock$WHEN v_expected.source_signature IN (
              'public.restaurant_review_automation_tick(uuid)',$catalog_lock$;
    END IF;
    anchor:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
    SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc,pg_catalog.to_jsonb(p)-'prosrc'
      INTO definition,source,before_metadata FROM pg_catalog.pg_proc p
      WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::pg_catalog.regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
    IF definition IS NULL OR NOT (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')=ANY(expected))
      OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1
      OR (length(source)-length(replace(source,lock_anchor,'')))/length(lock_anchor)<>1
      THEN RAISE EXCEPTION 'G014_MANUAL_INVOKER_SOURCE_DRIFT'; END IF;
    rewritten:=replace(source,anchor,$signature$      'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)',
$signature$||anchor);
    rewritten:=replace(rewritten,lock_anchor,replace(lock_anchor,$tick$              'public.restaurant_review_automation_tick(uuid)',$tick$,$manual$              'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)',
              'public.restaurant_review_automation_tick(uuid)',$manual$));
    EXECUTE replace(definition,source,rewritten);
    SELECT pg_catalog.to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target;
    IF after_metadata IS DISTINCT FROM before_metadata OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM rewritten
      THEN RAISE EXCEPTION 'G014_MANUAL_INVOKER_READBACK_DRIFT'; END IF;
  END LOOP;
END;
$manual_invoker_contract$;
COMMIT;
