-- G037 terminal readback. Read-only assertions emit only booleans and fingerprints.
SELECT
  pg_catalog.count(*) = 41 AS exact_terminal_ledger_count,
  pg_catalog.encode(
    extensions.digest(
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('version', version, 'name', name, 'statements', statements)
          ORDER BY version, name
        )::text,
        '[]'
      ),
      'sha256'
    ),
    'hex'
  ) AS terminal_ledger_sha256
FROM supabase_migrations.schema_migrations;

WITH approval_expectations(signature, body_sha256, argnames) AS (
  VALUES
    (
      'public.approve_submission_item(uuid,uuid,jsonb)',
      '46023efb63c4555af0c97dbdc6d496b84566e5ecee8f8060229b96a599dfc418',
      ARRAY['p_item_id', 'p_admin_user_id', 'p_restaurant_data', 'success', 'message', 'created_restaurant_id']::text[]
    ),
    (
      'public.approve_edit_submission_item(uuid,uuid,jsonb)',
      'b689a8f3151f39c656da8718aa769a0a3ea76fa7d0f65e588cab4fea783c6fd2',
      ARRAY['p_item_id', 'p_admin_user_id', 'p_updated_data', 'success', 'message', 'restaurant_id']::text[]
    )
), approval_rows AS (
  SELECT
    expected.signature,
    expected.body_sha256,
    expected.argnames,
    procedure.oid,
    procedure.prokind,
    language.lanname,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proretset,
    procedure.prorettype,
    procedure.proallargtypes,
    procedure.proargmodes,
    procedure.proargnames,
    procedure.prosrc
  FROM approval_expectations AS expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
  WHERE namespace.nspname = 'public'
), approval_assertions AS (
  SELECT
    signature,
    oid IS NOT NULL
      AND pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(prosrc, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = body_sha256 AS source_body_sha256_matches,
    (
      prokind,
      lanname,
      prosecdef,
      COALESCE(proconfig, ARRAY[]::text[]),
      proretset,
      prorettype,
      COALESCE(proallargtypes, ARRAY[]::oid[]),
      COALESCE(proargmodes, ARRAY[]::"char"[]),
      COALESCE(proargnames, ARRAY[]::text[])
    ) = (
      'f'::"char",
      'plpgsql'::name,
      true,
      ARRAY['search_path=public']::text[],
      true,
      2249::oid,
      ARRAY[2950, 2950, 3802, 16, 25, 2950]::oid[],
      ARRAY['i', 'i', 'i', 't', 't', 't']::"char"[],
      argnames
    ) AS exact_catalog_attributes_match
  FROM approval_rows
)
SELECT
  pg_catalog.count(*) = 2 AS exact_approval_oid_count,
  COALESCE(pg_catalog.bool_and(source_body_sha256_matches), false) AS approval_source_body_sha256_matches,
  COALESCE(pg_catalog.bool_and(exact_catalog_attributes_match), false) AS approval_exact_catalog_attributes_match,
  pg_catalog.encode(
    extensions.digest(
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'signature', signature,
            'body', source_body_sha256_matches,
            'catalog', exact_catalog_attributes_match
          )
          ORDER BY signature
        )::text,
        '[]'
      ),
      'sha256'
    ),
    'hex'
  ) AS approval_contract_assertion_sha256
FROM approval_assertions;

SELECT
  pg_catalog.to_regclass('public.restaurants_backup') IS NULL AS backup_table_retired,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)' ELSE false END) AS no_function_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_views v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_view_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_matviews v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_matview_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND pg_catalog.pg_get_triggerdef(t.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_trigger_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.rulename <> '_RETURN' AND pg_catalog.pg_get_ruledef(r.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_rule_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE pg_catalog.pg_get_constraintdef(c.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_constraint_dependency;
WITH expected_roles(role_name) AS (
  VALUES
    ('privacy_workflow_owner'::name),
    ('privacy_retention_operator_approver'::name),
    ('privacy_retention_legal_approver'::name),
    ('privacy_retention_activation_operator'::name)
), role_rows AS (
  SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
         r.rolreplication, r.rolbypassrls, r.rolcanlogin
    FROM pg_catalog.pg_roles r JOIN expected_roles e ON e.role_name=r.rolname
), membership_rows AS (
  SELECT role_row.rolname AS role_name, member_row.rolname AS member_name,
         grantor_row.rolname AS grantor_name, m.admin_option, m.inherit_option, m.set_option
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles role_row ON role_row.oid=m.roleid
    JOIN pg_catalog.pg_roles member_row ON member_row.oid=m.member
    JOIN pg_catalog.pg_roles grantor_row ON grantor_row.oid=m.grantor
   WHERE role_row.rolname IN (SELECT role_name FROM expected_roles)
      OR member_row.rolname IN (SELECT role_name FROM expected_roles)
), expected_memberships(role_name,member_name,grantor_name,admin_option,inherit_option,set_option) AS (
  VALUES
    ('privacy_workflow_owner'::name,'postgres'::name,'supabase_admin'::name,true,false,false),
    ('privacy_retention_operator_approver'::name,'postgres'::name,'supabase_admin'::name,true,false,false),
    ('privacy_retention_legal_approver'::name,'postgres'::name,'supabase_admin'::name,true,false,false),
    ('privacy_retention_activation_operator'::name,'postgres'::name,'supabase_admin'::name,true,false,false)
)
SELECT
  (SELECT pg_catalog.count(*) FROM role_rows) = 4
    AND COALESCE((SELECT pg_catalog.bool_and(NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
      FROM role_rows),false) AS exact_managed_role_flags,
  NOT EXISTS ((SELECT * FROM membership_rows EXCEPT ALL SELECT * FROM expected_memberships)
    UNION ALL (SELECT * FROM expected_memberships EXCEPT ALL SELECT * FROM membership_rows)) AS exact_terminal_managed_memberships,
  COALESCE((SELECT pg_catalog.bool_and(pg_catalog.pg_has_role('postgres', role_name, 'member')
    AND NOT pg_catalog.pg_has_role('postgres', role_name, 'usage')
    AND NOT pg_catalog.pg_has_role('postgres', role_name, 'set'))
    FROM expected_roles),false) AS postgres_member_without_usage_or_set,
  pg_catalog.encode(extensions.digest(COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',role_name,'member',member_name,'grantor',grantor_name,
      'admin',admin_option,'inherit',inherit_option,'set',set_option)
      ORDER BY role_name,member_name,grantor_name)::text FROM membership_rows
  ),'[]'),'sha256'),'hex') AS managed_role_sha256;

-- Composed immutable source contract: G014 02000–02400 plus G016 20260801000300 terminal ACL fragments.
-- Terminal matrix SHA-256: 59b3d7d942241e70e24196251aef0dabfb999d986512a7d138e44cd2f57e490d (104 rows).
WITH expected_rpc(source_signature,grantee) AS (
  VALUES
    ('public.approve_submission_item(uuid,uuid,jsonb)', 'authenticated'::name),
    ('public.approve_submission_item(uuid,uuid,jsonb)', 'service_role'::name),
    ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'authenticated'::name),
    ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'service_role'::name),
    ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'authenticated'::name),
    ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'service_role'::name),
    ('public.make_user_admin(text)', 'service_role'::name),
    ('public.batch_insert_restaurants_from_jsonl(jsonb[])', 'service_role'::name),
    ('public.insert_restaurant_from_jsonl(jsonb)', 'service_role'::name),
    ('public.refresh_materialized_views()', 'service_role'::name),
    ('public.cleanup_old_notifications(integer)', 'service_role'::name),
    ('public.approve_restaurant(uuid,uuid)', 'service_role'::name),
    ('public.reject_restaurant(uuid,uuid,text)', 'service_role'::name),
    ('public.approve_restaurant_submission(uuid,uuid)', 'service_role'::name),
    ('public.reject_restaurant_submission(uuid,uuid,text)', 'service_role'::name),
    ('public.approve_new_restaurant_submission(uuid,uuid,jsonb)', 'service_role'::name),
    ('public.approve_edit_restaurant_submission(uuid,uuid,uuid[])', 'service_role'::name),
    ('public.reject_submission(uuid,uuid,text)', 'service_role'::name),
    ('public.reject_submission_item(uuid,uuid,text)', 'service_role'::name),
    ('public.apply_admin_user_db_mutation(uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text)', 'service_role'::name),
    ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'::name),
    ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'::name),
    ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'::name),
    ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'::name),
    ('public.review_restaurant_request(uuid,uuid,text,text,text)', 'service_role'::name),
    ('public.delete_pending_restaurant_submission(uuid,uuid,text)', 'service_role'::name),
    ('public.submit_restaurant_submission(uuid,text,text,text,text,text,text[],text,text)', 'service_role'::name),
    ('public.apply_restaurant_admin_destructive_action(uuid,text,text,uuid[],uuid,jsonb)', 'service_role'::name),
    ('public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)', 'service_role'::name),
    ('public.claim_admin_trend_job_request(text,interval)', 'service_role'::name),
    ('public.complete_admin_trend_job_request(uuid,text,uuid,jsonb)', 'service_role'::name),
    ('public.fail_admin_trend_job_request(uuid,text,text,jsonb)', 'service_role'::name),
    ('public.review_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,uuid,text,text,jsonb)', 'service_role'::name),
    ('public.approve_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,text,jsonb,text,text,uuid,text,jsonb)', 'service_role'::name),
    ('public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)', 'service_role'::name),
    ('public.revoke_release_auth_session_family(uuid,uuid,uuid,text)', 'service_role'::name),
    ('public.read_release_auth_revocation(uuid,uuid,uuid)', 'service_role'::name),
    ('public.read_release_auth_revocation_by_operation(uuid)', 'anon'::name),
    ('public.read_release_auth_revocation_by_operation(uuid)', 'authenticated'::name),
    ('public.get_current_auth_session_id()', 'authenticated'::name),
    ('public.is_current_auth_session_active()', 'authenticated'::name),
    ('public.get_current_privacy_policy_version()', 'authenticated'::name),
    ('public.get_current_privacy_policy_version()', 'service_role'::name),
    ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)', 'service_role'::name),
    ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)', 'service_role'::name),
    ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'authenticated'::name),
    ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'::name),
    ('public.read_privacy_guardian_status(uuid)', 'service_role'::name),
    ('public.create_user_notification(uuid,text,text,text,jsonb)', 'authenticated'::name),
    ('public.mark_notification_read(uuid)', 'authenticated'::name),
    ('public.mark_all_notifications_read()', 'authenticated'::name),
    ('public.delete_notification(uuid)', 'authenticated'::name),
    ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)', 'service_role'::name),
    ('public.marketing_campaign_receipt(uuid)', 'service_role'::name),
    ('public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)', 'service_role'::name),
    ('public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)', 'service_role'::name),
    ('public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)', 'service_role'::name),
    ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])', 'service_role'::name),
    ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)', 'service_role'::name),
    ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)', 'service_role'::name),
    ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)', 'service_role'::name),
    ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)', 'service_role'::name),
    ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)', 'service_role'::name),
    ('public.get_current_privacy_eligibility()', 'authenticated'::name),
    ('public.get_privacy_eligibility_for_user(uuid)', 'service_role'::name),
    ('public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
    ('public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)', 'service_role'::name),
    ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)', 'service_role'::name),
    ('public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)', 'service_role'::name),
    ('public.create_review_like_notification(uuid,uuid,uuid)', 'service_role'::name),
    ('public.preview_account_deletion(uuid,uuid,timestamptz)', 'service_role'::name),
    ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)', 'service_role'::name),
    ('public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
    ('public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)', 'service_role'::name),
    ('public.publish_account_deletion_policy(text,interval,interval,text,jsonb,text,text)', 'service_role'::name),
    ('public.activate_account_deletion_policy(text,text)', 'service_role'::name),
    ('public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
    ('public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
    ('public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
    ('public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
    ('public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
    ('public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)', 'service_role'::name),
    ('public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
    ('public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
    ('public.claim_next_account_deletion_external_job()', 'service_role'::name),
    ('public.read_current_account_deletion_status(uuid,text,text)', 'authenticated'::name),
    ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'service_role'::name),
    ('public.confirm_privacy_retention_run(uuid,text,text,text)', 'service_role'::name),
    ('public.apply_privacy_retention_run(uuid,text,text,integer)', 'service_role'::name),
    ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)', 'service_role'::name),
    ('public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)', 'service_role'::name),
    ('public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)', 'service_role'::name),
    ('public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)', 'service_role'::name),
    ('public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text)', 'service_role'::name),
    ('public.finalize_privacy_retention_run(uuid,text,text)', 'service_role'::name),
    ('public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)', 'service_role'::name),
    ('public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)', 'service_role'::name),
    ('public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'service_role'::name),
    ('public.ocr_log_metadata_is_safe(jsonb)', 'service_role'::name),
    ('public.allocate_short_url(text,uuid,uuid,text,text[])', 'service_role'::name),
    ('public.get_ocr_daily_quota_status()', 'authenticated'::name),
    ('public.reserve_ocr_daily_quota(uuid)', 'authenticated'::name),
    ('public.reserve_admin_provider_budget(uuid,text,uuid)', 'service_role'::name),
    ('public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'::name)
), resolved_rpc AS (
  SELECT source_signature,grantee,pg_catalog.to_regprocedure(source_signature) AS procedure_oid
    FROM expected_rpc
), actual_rpc AS (
  SELECT resolved_rpc.source_signature,resolved_rpc.grantee
    FROM resolved_rpc
   WHERE procedure_oid IS NOT NULL
     AND pg_catalog.has_function_privilege(grantee,procedure_oid,'EXECUTE')
), api_roles(grantee) AS (
  VALUES ('anon'::name),('authenticated'::name),('service_role'::name)
), public_api_acl AS (
  SELECT namespace.nspname || '.' || procedure.proname || '(' ||
         pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')' AS signature,api_roles.grantee::text AS grantee
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
    CROSS JOIN api_roles
   WHERE namespace.nspname='public'
     AND pg_catalog.has_function_privilege(api_roles.grantee,procedure.oid,'EXECUTE')
), unlisted_api_acl AS (
  SELECT signature,grantee FROM public_api_acl
  EXCEPT ALL
  SELECT namespace.nspname || '.' || procedure.proname || '(' ||
         pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')',grantee::text
    FROM resolved_rpc
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid=resolved_rpc.procedure_oid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
), expected_names(name) AS (
  SELECT DISTINCT pg_catalog.split_part(pg_catalog.split_part(source_signature,'.',2),'(',1)
    FROM expected_rpc
), unexpected_overloads AS (
  SELECT namespace.nspname || '.' || procedure.proname || '(' ||
         pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')' AS signature
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
    JOIN expected_names ON expected_names.name=procedure.proname
    LEFT JOIN (SELECT DISTINCT procedure_oid FROM resolved_rpc) resolved ON resolved.procedure_oid=procedure.oid
   WHERE namespace.nspname='public' AND resolved.procedure_oid IS NULL
), public_execute AS (
  SELECT namespace.nspname || '.' || procedure.proname || '(' ||
         pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')' AS signature
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
   WHERE namespace.nspname='public' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
)
SELECT
  COALESCE((SELECT pg_catalog.bool_and(procedure_oid IS NOT NULL) FROM resolved_rpc),false) AS static_public_rpc_sources_resolve,
  NOT EXISTS ((SELECT * FROM actual_rpc EXCEPT ALL SELECT * FROM expected_rpc)
    UNION ALL (SELECT * FROM expected_rpc EXCEPT ALL SELECT * FROM actual_rpc)) AS static_public_rpc_acl_matches,
  NOT EXISTS (SELECT 1 FROM public_execute) AS no_public_execute_on_public_functions,
  NOT EXISTS (SELECT 1 FROM unlisted_api_acl) AS no_unlisted_public_api_execute,
  NOT EXISTS (SELECT 1 FROM unexpected_overloads) AS no_unexpected_allowlisted_name_overloads;
