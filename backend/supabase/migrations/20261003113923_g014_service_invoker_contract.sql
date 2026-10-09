-- Declare the exact service-only invokers introduced by evaluation, storyboard
-- and review automation. Existing RPC modes, grants and historical contracts
-- remain unchanged. Unknown invokers and security/grant drift still fail closed.
BEGIN;
DO $service_invoker_contract$
DECLARE
  function_name text;
  expected_before text[];
  anchor text;
  addition text;
  definition_before text;
  source_before text;
  source_after text;
  metadata_before jsonb;
  metadata_after jsonb;
  target oid;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'privacy_retention.assert_g014_definer_contract()',
    'privacy_retention.assert_g014_catalog_contract()'
  ] LOOP
    target := pg_catalog.to_regprocedure(function_name);
    IF function_name = 'privacy_retention.assert_g014_definer_contract()' THEN
      expected_before := ARRAY[
        'e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67',
        '6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d'
      ];
      anchor := $definer_anchor$    IF v_signature IN (
      'public.match_storyboard_documents_hybrid$definer_anchor$;
      addition := $definer_addition$    IF v_signature IN (
      'public.extract_youtube_video_id(text)',
      'public.normalize_restaurant_identity_name(text)',
      'public.admin_evaluation_revision()',
      'public.admin_evaluation_catalog_snapshot()',
      'public.storyboard_production_error_allowed(text)',
      'public.storyboard_production_final_status(jsonb,jsonb)',
      'public.storyboard_production_project_json(public.admin_storyboard_production_projects)',
      'public.storyboard_production_job_json(public.admin_storyboard_production_jobs)',
      'public.storyboard_production_snapshot(uuid,uuid)',
      'public.storyboard_production_auth_worker(text)',
      'public.storyboard_production_model_available(jsonb,text,text)',
      'public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)',
      'public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)',
      'public.record_app_web_vitals(text,text,text,text,smallint)',
      'public.record_app_web_vitals_bounded(text,text,text,text,smallint)',
      'public.restaurant_review_automation_status()',
      'public.restaurant_review_automation_preview(uuid,integer,integer)',
      'public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)',
      'public.restaurant_review_automation_tick(uuid)',
      'public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)',
      'public.resolve_restaurant_identity_name(text,text,text,text)'
    ) THEN
      IF v_is_definer OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_oid
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          AND p.proconfig IS NOT DISTINCT FROM CASE
            WHEN v_signature IN (
              'public.extract_youtube_video_id(text)',
              'public.normalize_restaurant_identity_name(text)',
              'public.resolve_restaurant_identity_name(text,text,text,text)'
            ) THEN ARRAY['search_path=pg_catalog, public, extensions']::text[]
            WHEN v_signature IN (
              'public.restaurant_review_automation_tick(uuid)',
              'public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)'
            ) THEN ARRAY['search_path=""','lock_timeout=2s']::text[]
            ELSE ARRAY['search_path=""']::text[]
          END
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
            ) AS acl
            WHERE acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
              OR acl.is_grantable
          )
      ) OR NOT EXISTS (
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature = v_signature AND allowed.grantee = 'service_role'
      ) OR EXISTS (
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature = v_signature AND allowed.grantee <> 'service_role'
      ) THEN
        RAISE EXCEPTION 'G014 service-only SECURITY INVOKER contract mismatch: %', v_signature;
      END IF;
      CONTINUE;
    END IF;
$definer_addition$;
    ELSE
      expected_before := ARRAY[
        '9f5b15cc3d0c0b11d39053759409ce359ae8acda3669ed0b1dc40ee6612ef73d',
        'c58fa9c66865db3f5e81513f9537084a9024ebe77863a1b22f4ddb37936c6998'
      ];
      anchor := $catalog_anchor$    IF v_expected.source_signature IN (
      'public.match_storyboard_documents_hybrid$catalog_anchor$;
      addition := $catalog_addition$    IF v_expected.source_signature IN (
      'public.extract_youtube_video_id(text)',
      'public.normalize_restaurant_identity_name(text)',
      'public.admin_evaluation_revision()',
      'public.admin_evaluation_catalog_snapshot()',
      'public.storyboard_production_error_allowed(text)',
      'public.storyboard_production_final_status(jsonb,jsonb)',
      'public.storyboard_production_project_json(public.admin_storyboard_production_projects)',
      'public.storyboard_production_job_json(public.admin_storyboard_production_jobs)',
      'public.storyboard_production_snapshot(uuid,uuid)',
      'public.storyboard_production_auth_worker(text)',
      'public.storyboard_production_model_available(jsonb,text,text)',
      'public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)',
      'public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)',
      'public.record_app_web_vitals(text,text,text,text,smallint)',
      'public.record_app_web_vitals_bounded(text,text,text,text,smallint)',
      'public.restaurant_review_automation_status()',
      'public.restaurant_review_automation_preview(uuid,integer,integer)',
      'public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)',
      'public.restaurant_review_automation_tick(uuid)',
      'public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)',
      'public.resolve_restaurant_identity_name(text,text,text,text)'
    ) THEN
      IF v_is_definer OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_procedure
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          AND p.proconfig IS NOT DISTINCT FROM CASE
            WHEN v_expected.source_signature IN (
              'public.extract_youtube_video_id(text)',
              'public.normalize_restaurant_identity_name(text)',
              'public.resolve_restaurant_identity_name(text,text,text,text)'
            ) THEN ARRAY['search_path=pg_catalog, public, extensions']::text[]
            WHEN v_expected.source_signature IN (
              'public.restaurant_review_automation_tick(uuid)',
              'public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)'
            ) THEN ARRAY['search_path=""','lock_timeout=2s']::text[]
            ELSE ARRAY['search_path=""']::text[]
          END
          AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
            ) AS acl
            WHERE acl.grantee NOT IN (p.proowner, 'service_role'::pg_catalog.regrole)
              OR acl.is_grantable
          )
      ) OR NOT EXISTS (
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature = v_expected.source_signature AND allowed.grantee = 'service_role'
      ) OR EXISTS (
        SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature = v_expected.source_signature AND allowed.grantee <> 'service_role'
      ) THEN
        RAISE EXCEPTION 'G014 service-only SECURITY INVOKER contract mismatch: %', v_expected.source_signature;
      END IF;
      CONTINUE;
    END IF;
$catalog_addition$;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(p.oid), p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
      INTO definition_before, source_before, metadata_before
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid = target
        AND p.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']::text[];
    IF definition_before IS NULL
       OR NOT (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_before,'UTF8')),'hex') = ANY(expected_before))
       OR (pg_catalog.length(source_before)-pg_catalog.length(pg_catalog.replace(source_before,anchor,'')))/pg_catalog.length(anchor) <> 1 THEN
      RAISE EXCEPTION 'G014_SERVICE_INVOKER_SOURCE_DRIFT';
    END IF;
    EXECUTE pg_catalog.replace(definition_before, anchor, addition || anchor);
    SELECT p.prosrc, pg_catalog.to_jsonb(p) - 'prosrc'
      INTO source_after, metadata_after FROM pg_catalog.pg_proc AS p WHERE p.oid = target;
    IF metadata_after IS DISTINCT FROM metadata_before
       OR source_after IS DISTINCT FROM pg_catalog.replace(source_before,anchor,addition || anchor) THEN
      RAISE EXCEPTION 'G014_SERVICE_INVOKER_READBACK_DRIFT';
    END IF;
  END LOOP;
END;
$service_invoker_contract$;
COMMIT;
