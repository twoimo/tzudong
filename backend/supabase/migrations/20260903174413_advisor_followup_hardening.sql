-- Source-only follow-up for the bounded 2026-09-03 Security Advisor review.
-- This file does not assert that the migration has been applied. It pins the
-- remaining SECURITY INVOKER functions to trusted schemas and validates four
-- project-owned constraints that were intentionally introduced NOT VALID.
-- public/extension CREATE privilege must remain unavailable to PUBLIC or Data
-- API roles. The vector extension is public in the reviewed hosted catalog and
-- extensions in the disposable local reconstruction, so its schema is resolved
-- from pg_extension while the reviewed hosted signatures remain explicit.

-- The hosted catalog contains this invoker trigger function, but the canonical
-- source chain did not. Recover its exact bounded behavior before applying the
-- 26-function path hardening set. Existing ownership/ACL intent is normalized
-- to the observed postgres-only execution surface.
CREATE OR REPLACE FUNCTION public.touch_admin_workflow_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.touch_admin_workflow_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_admin_workflow_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

DO $harden_functions$
DECLARE
  v_signature text;
  v_resolved_signature text;
  v_oid regprocedure;
  v_vector_schema name;
  v_signatures constant text[] := ARRAY[
    'public.canonicalize_youtube_link(text)',
    'public.extract_youtube_video_id(text)',
    'public.get_all_approved_restaurant_names()',
    'public.get_categories_by_restaurant_name_or_youtube_url(text,text)',
    'public.get_video_captions_for_range(text,integer,integer,integer)',
    'public.get_video_metadata_filtered(integer,integer,text)',
    'public.match_documents_bge(public.vector,double precision,integer,jsonb)',
    'public.match_documents_hybrid(public.vector,jsonb,double precision,double precision,integer)',
    'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
    'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
    'public.normalize_restaurant_identity_name(text)',
    'public.prevent_last_active_admin_status_change()',
    'public.prevent_last_admin_role_delete()',
    'public.prevent_last_admin_role_update()',
    'public.prevent_profile_role_client_change()',
    'public.resolve_restaurant_identity_name(text,text,text,text)',
    'public.search_restaurants_by_category(text,integer)',
    'public.search_restaurants_by_name(text,integer)',
    'public.search_video_ids_by_query(public.vector,jsonb,double precision,double precision,integer)',
    'public.set_admin_restaurant_map_overlays_updated_at()',
    'public.set_admin_trend_schema_foundation_updated_at()',
    'public.set_admin_user_preferences_updated_at()',
    'public.set_documents_updated_at()',
    'public.storyboard_sparse_dot_product(jsonb,jsonb)',
    'public.touch_admin_workflow_updated_at()',
    'public.update_announcements_updated_at()'
  ];
BEGIN
  SELECT namespace.nspname
    INTO v_vector_schema
    FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
   WHERE extension.extname = 'vector';

  IF v_vector_schema IS NULL
     OR v_vector_schema NOT IN ('public', 'extensions') THEN
    RAISE EXCEPTION 'advisor_hardening_vector_schema_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.nspname IN ('public', 'extensions')
       AND (
         pg_catalog.has_schema_privilege('anon', namespace.oid, 'CREATE')
         OR pg_catalog.has_schema_privilege('authenticated', namespace.oid, 'CREATE')
         OR pg_catalog.has_schema_privilege('service_role', namespace.oid, 'CREATE')
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(
                 namespace.nspacl,
                 pg_catalog.acldefault('n', namespace.nspowner)
               )
             ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'CREATE'
         )
       )
  ) THEN
    RAISE EXCEPTION 'advisor_hardening_schema_not_trusted';
  END IF;

  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_resolved_signature := pg_catalog.replace(
      v_signature,
      'public.vector',
      pg_catalog.quote_ident(v_vector_schema) || '.vector'
    );
    v_oid := pg_catalog.to_regprocedure(v_resolved_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'advisor_hardening_function_missing';
    END IF;
    IF (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid) THEN
      RAISE EXCEPTION 'advisor_hardening_function_not_invoker';
    END IF;
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions',
      v_oid::text
    );
  END LOOP;
END;
$harden_functions$;

DO $catalog_preflight$
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conname = ANY (ARRAY[
       'admin_audit_events_whitelisted_contract',
       'account_deletion_requests_reason_code_allowed',
       'account_deletion_requests_count_summary_safe',
       'account_deletion_request_items_reason_code_allowed'
     ])
       AND NOT constraint_row.convalidated
  ) <> 4 THEN
    RAISE EXCEPTION 'advisor_hardening_constraint_preflight_failed';
  END IF;
END;
$catalog_preflight$;

ALTER TABLE public.admin_audit_events
  VALIDATE CONSTRAINT admin_audit_events_whitelisted_contract;
ALTER TABLE public.account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_reason_code_allowed;
ALTER TABLE public.account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_count_summary_safe;
ALTER TABLE public.account_deletion_request_items
  VALIDATE CONSTRAINT account_deletion_request_items_reason_code_allowed;

-- Advancing validated state changes exactly four G014 manifest values. Retain
-- the immutable table boundary by using its owner only for this bounded update,
-- restoring membership state, and re-running the complete catalog assertion.
DO $catalog_membership$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid = 'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
  ) INTO v_membership_exists;
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
    INTO v_set_option;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE WHEN v_supports_set_option
        THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user
    );
    PERFORM pg_catalog.set_config('advisor.remove_membership', 'true', true);
    PERFORM pg_catalog.set_config('advisor.restore_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config('advisor.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('advisor.restore_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('advisor.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('advisor.restore_set_false', 'false', true);
  END IF;
END;
$catalog_membership$;

SET LOCAL ROLE privacy_workflow_owner;

ALTER TABLE privacy_retention.g014_catalog_contract_manifest
  DISABLE TRIGGER g014_catalog_manifest_immutable;

DO $advance_catalog_manifest$
DECLARE
  v_updated integer;
BEGIN
  UPDATE privacy_retention.g014_catalog_contract_manifest AS manifest
     SET manifest_value = current_row.manifest_value
    FROM privacy_retention.g014_catalog_manifest_rows() AS current_row
   WHERE manifest.manifest_kind = 'constraint'
     AND manifest.manifest_kind = current_row.manifest_kind
     AND manifest.manifest_key = current_row.manifest_key
     AND manifest.manifest_key IN (
       pg_catalog.jsonb_build_object(
         'schema', 'public', 'relation', 'admin_audit_events',
         'constraint', 'admin_audit_events_whitelisted_contract'
       ),
       pg_catalog.jsonb_build_object(
         'schema', 'public', 'relation', 'account_deletion_requests',
         'constraint', 'account_deletion_requests_reason_code_allowed'
       ),
       pg_catalog.jsonb_build_object(
         'schema', 'public', 'relation', 'account_deletion_requests',
         'constraint', 'account_deletion_requests_count_summary_safe'
       ),
       pg_catalog.jsonb_build_object(
         'schema', 'public', 'relation', 'account_deletion_request_items',
         'constraint', 'account_deletion_request_items_reason_code_allowed'
       )
     )
     AND manifest.manifest_value IS DISTINCT FROM current_row.manifest_value;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 4 THEN
    RAISE EXCEPTION 'advisor_hardening_manifest_update_count';
  END IF;
END;
$advance_catalog_manifest$;

ALTER TABLE privacy_retention.g014_catalog_contract_manifest
  ENABLE TRIGGER g014_catalog_manifest_immutable;

RESET ROLE;

DO $catalog_membership_restore$
BEGIN
  IF pg_catalog.current_setting('advisor.restore_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  ELSIF pg_catalog.current_setting('advisor.remove_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  END IF;
END;
$catalog_membership_restore$;

DO $readback$
DECLARE
  v_signature text;
  v_resolved_signature text;
  v_oid regprocedure;
  v_vector_schema name;
  v_signatures constant text[] := ARRAY[
    'public.canonicalize_youtube_link(text)',
    'public.extract_youtube_video_id(text)',
    'public.get_all_approved_restaurant_names()',
    'public.get_categories_by_restaurant_name_or_youtube_url(text,text)',
    'public.get_video_captions_for_range(text,integer,integer,integer)',
    'public.get_video_metadata_filtered(integer,integer,text)',
    'public.match_documents_bge(public.vector,double precision,integer,jsonb)',
    'public.match_documents_hybrid(public.vector,jsonb,double precision,double precision,integer)',
    'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
    'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
    'public.normalize_restaurant_identity_name(text)',
    'public.prevent_last_active_admin_status_change()',
    'public.prevent_last_admin_role_delete()',
    'public.prevent_last_admin_role_update()',
    'public.prevent_profile_role_client_change()',
    'public.resolve_restaurant_identity_name(text,text,text,text)',
    'public.search_restaurants_by_category(text,integer)',
    'public.search_restaurants_by_name(text,integer)',
    'public.search_video_ids_by_query(public.vector,jsonb,double precision,double precision,integer)',
    'public.set_admin_restaurant_map_overlays_updated_at()',
    'public.set_admin_trend_schema_foundation_updated_at()',
    'public.set_admin_user_preferences_updated_at()',
    'public.set_documents_updated_at()',
    'public.storyboard_sparse_dot_product(jsonb,jsonb)',
    'public.touch_admin_workflow_updated_at()',
    'public.update_announcements_updated_at()'
  ];
BEGIN
  SELECT namespace.nspname
    INTO v_vector_schema
    FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
   WHERE extension.extname = 'vector';

  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_resolved_signature := pg_catalog.replace(
      v_signature,
      'public.vector',
      pg_catalog.quote_ident(v_vector_schema) || '.vector'
    );
    v_oid := pg_catalog.to_regprocedure(v_resolved_signature);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = v_oid
        AND NOT procedure.prosecdef
        AND procedure.proconfig = ARRAY['search_path=pg_catalog, public, extensions']
    ) THEN
      RAISE EXCEPTION 'advisor_hardening_function_readback_failed';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = ANY (ARRAY[
      'admin_audit_events_whitelisted_contract',
      'account_deletion_requests_reason_code_allowed',
      'account_deletion_requests_count_summary_safe',
      'account_deletion_request_items_reason_code_allowed'
    ])
      AND NOT constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'advisor_hardening_constraint_readback_failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
       'privacy_retention.g014_catalog_contract_manifest'::pg_catalog.regclass
       AND trigger_row.tgname = 'g014_catalog_manifest_immutable'
       AND trigger_row.tgenabled = 'O'
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'advisor_hardening_manifest_trigger_readback_failed';
  END IF;

  PERFORM privacy_retention.assert_g014_catalog_manifest();
END;
$readback$;
