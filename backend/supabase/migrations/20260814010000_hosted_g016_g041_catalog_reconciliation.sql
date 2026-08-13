-- Adopt the exact hosted G016/G041 catalog without replaying the missing
-- 20260801000300 migration or either meaning of the collided 20260804000300
-- ledger identity.  Only the five collided runtime bodies and narrower ACLs
-- are changed here; the applied ledger remains provider-owned and immutable.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:hosted-g016-g041-reconciliation:v1', 0)
);

DO $ledger_preflight$
DECLARE
  v_collision_statements text[];
  v_ledger_root text;
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'hosted_g016_g041_ledger_missing';
  END IF;

  IF EXISTS (
    WITH expected(version, name) AS (
      VALUES
        ('20251219', 'db_performance_optimization'),
        ('20260118', 'create_ocr_logs'),
        ('20260425', 'allow_ocr_logs_user_insert'),
        ('20260506065538', 'optimize_auth_user_state_indexes'),
        ('20260506085634', 'optimize_app_query_indexes'),
        ('20260509000100', 'drop_server_costs'),
        ('20260509000200', 'drop_admin_ai_settings'),
        ('20260523093000', 'create_restaurant_popular_rank_snapshots'),
        ('20260525143908', 'create_youtube_kpi_snapshots'),
        ('20260526083932', 'add_youtube_channel_growth_snapshot_deltas'),
        ('20260531084217', 'harden_public_api_grants_and_rpcs'),
        ('20260531084516', 'tighten_public_table_data_api_grants'),
        ('20260627080000', 'storyboard_custom_gpt_rag_documents'),
        ('20260627153000', 'storyboard_documents_hybrid_v2_indexes'),
        ('20260627154500', 'storyboard_documents_hybrid_rrf_type_fix'),
        ('20260702000100', 'restaurant_request_review_lifecycle'),
        ('20260704000100', 'restaurant_submission_submit_contract'),
        ('20260704000200', 'restaurant_destructive_admin_audit'),
        ('20260707000100', 'admin_restaurant_map_overlays'),
        ('20260707000200', 'admin_restaurant_map_overlay_audit_apply'),
        ('20260707000300', 'admin_trend_schema_foundation'),
        ('20260707000400', 'admin_trend_job_request_rpcs'),
        ('20260707000500', 'admin_trend_proposal_review_rpc'),
        ('20260707000600', 'admin_trend_proposal_approval_rpc'),
        ('20260711000100', 'release_auth_session_revocation'),
        ('20260712000100', 'g010_privacy_foundation'),
        ('20260712000200', 'g010_notification_marketing'),
        ('20260712000300', 'g010_account_deletion'),
        ('20260712000400', 'g010_retention_separation'),
        ('20260712000500', 'g010_incident_workflow'),
        ('20260712000600', 'g010_ocr_log_minimization'),
        ('20260713000100', 'g013_short_url_security'),
        ('20260713000200', 'g013_ocr_quota_security'),
        ('20260713000300', 'g013_admin_provider_budgets'),
        ('20260713000450', 'g013_address_admin_approval'),
        ('20260713002000', 'g014_public_api_private_boundary'),
        ('20260713002100', 'g014_privacy_workflows'),
        ('20260713002200', 'g014_marketing_state_machine'),
        ('20260713002300', 'g014_account_deletion_state_machine'),
        ('20260713002400', 'g014_retention_adapters_receipts'),
        ('20260713002500', 'g014_catalog_contract'),
        ('20260713002600', 'g014_account_deletion_receipt_parity'),
        ('20260713002700', 'g028_account_deletion_reauth_proof'),
        ('20260801000100', 'g016_privacy_audit_owner_policy'),
        ('20260801000200', 'g016_onboarding_confirmation_freshness'),
        ('20260804000100', 'g041_privacy_audit_lock_privilege'),
        ('20260804000200', 'g041_privacy_onboarding_workflow_privileges'),
        ('20260804000300', 'g041_privacy_eligibility_auth_boundary'),
        ('20260804000400', 'g041_auth_boundary_closure'),
        ('20260804000500', 'g041_auth_workflow_bridge')
    ), actual AS (
      SELECT version::text, name::text
      FROM supabase_migrations.schema_migrations
    )
    SELECT 1 FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) OR (
    SELECT pg_catalog.count(*)
    FROM supabase_migrations.schema_migrations
  ) <> 50 THEN
    RAISE EXCEPTION 'hosted_g016_g041_exact_ledger_drift';
  END IF;

  SELECT pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.json_agg(
                 pg_catalog.json_build_array(
                   migration.version::text,
                   migration.name::text,
                   migration.statements
                 ) ORDER BY migration.version::text
               )::text,
               'UTF8'
             )
           ),
           'hex'
         )
    INTO v_ledger_root
  FROM supabase_migrations.schema_migrations AS migration;

  IF v_ledger_root IS DISTINCT FROM
       'ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4'
     OR (
       SELECT pg_catalog.count(*)
       FROM supabase_migrations.schema_migrations
       WHERE statements IS NULL
     ) <> 0
     OR (
       SELECT pg_catalog.count(*)
       FROM supabase_migrations.schema_migrations
       WHERE pg_catalog.cardinality(statements) = 0
     ) <> 7 THEN
    RAISE EXCEPTION 'hosted_g016_g041_exact_ledger_statement_root_drift';
  END IF;

  SELECT statements INTO v_collision_statements
  FROM supabase_migrations.schema_migrations
  WHERE version::text = '20260804000300'
    AND name::text = 'g041_privacy_eligibility_auth_boundary';

  IF pg_catalog.cardinality(v_collision_statements) <> 7
     OR pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(pg_catalog.to_json(v_collision_statements)::text, 'UTF8')
       ),
       'hex'
     ) IS DISTINCT FROM
       'c7c33f0f76e5b3a949e48af75d117104ce15bbe5c9a37d34ea98dff8e10d2547' THEN
    RAISE EXCEPTION 'hosted_g016_g041_collision_statement_vector_drift';
  END IF;
END
$ledger_preflight$;

DO $catalog_preflight$
DECLARE
  v_expected record;
  v_oid pg_catalog.regprocedure;
  v_source_sha256 text;
  v_expected_grantees name[];
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_identities') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_session_leases') IS NULL
     OR pg_catalog.to_regrole('privacy_auth_bridge') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_privacy_eligibility_receipt(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_require_service_role()') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_catalog_contract()') IS NULL THEN
    RAISE EXCEPTION 'hosted_g016_g041_catalog_prerequisite_missing';
  END IF;

  FOR v_expected IN
    SELECT * FROM (VALUES
      ('privacy_retention.g016_reattest_privacy_onboarding(uuid,uuid,text)', 'ccaf453fb015baaf69e8aa5c33a563406a83f72c5ba20791d6fc637f84f96d27', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_current_privacy_eligibility()', '3e5d9508cecee2ae37be085646879e683c17576cb49a175e124a47038831bf45', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_privacy_eligibility_for_user(uuid)', '21c64036761984944707abbbd5740c9466ab3d4af46995624d57ff9113010ad6', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_current_auth_session_id()', 'c525ffdb57c558f34374313330f9404ba6ed399b13b8d48486848c8a95ef1003', 's'::"char", 'uuid'::pg_catalog.regtype),
      ('public.is_current_auth_session_active()', '5c3a92cf51a592ac8b5a00193f40d161170c672bb592e4a037625712ee4270d8', 'v'::"char", 'boolean'::pg_catalog.regtype)
    ) AS expected(signature, source_sha256, volatility, return_type)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    SELECT pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
             'hex'
           )
      INTO v_source_sha256
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_oid
       AND procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
       AND procedure.prosecdef
       AND procedure.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
       AND procedure.provolatile = v_expected.volatility
       AND procedure.prolang = (
         SELECT language.oid
         FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'plpgsql'
       )
       AND procedure.prorettype = v_expected.return_type
       AND NOT procedure.proretset
       AND procedure.prokind = 'f'
       AND NOT procedure.proleakproof
       AND procedure.proparallel = 'u';
    IF v_oid IS NULL
       OR v_source_sha256 IS NULL
       OR v_source_sha256 IS DISTINCT FROM v_expected.source_sha256 THEN
      RAISE EXCEPTION 'hosted_g016_g041_function_prerequisite_drift: %',
        v_expected.signature;
    END IF;

    v_expected_grantees := CASE v_expected.signature
      WHEN 'public.get_current_privacy_eligibility()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      WHEN 'public.get_privacy_eligibility_for_user(uuid)'
        THEN ARRAY['privacy_workflow_owner', 'service_role']::name[]
      WHEN 'public.get_current_auth_session_id()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      WHEN 'public.is_current_auth_session_active()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      ELSE ARRAY['privacy_workflow_owner']::name[]
    END;
    IF (
      SELECT pg_catalog.array_agg(grantee_name ORDER BY grantee_name)
      FROM (
        SELECT COALESCE(role_row.rolname, 'PUBLIC') AS grantee_name
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = acl.grantee
        WHERE procedure.oid = v_oid
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
      ) AS grants
    ) IS DISTINCT FROM v_expected_grantees
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE procedure.oid = v_oid
           AND (acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)
       ) THEN
      RAISE EXCEPTION 'hosted_g016_g041_function_acl_prerequisite_drift: %',
        v_expected.signature;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
    )
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'privacy_retention.assert_g014_public_rpc_allowlist()'::pg_catalog.regprocedure
  ) IS DISTINCT FROM
    'f23203a0d27fc2d51b73a87df87c86288b052614b7035b93675656c89223d203'
     OR (
       SELECT pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
       )
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure
     ) IS DISTINCT FROM
       'e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67'
     OR (
       SELECT pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
       )
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid =
         'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
     ) IS DISTINCT FROM
       '9f5b15cc3d0c0b11d39053759409ce359ae8acda3669ed0b1dc40ee6612ef73d' THEN
    RAISE EXCEPTION 'hosted_g016_g041_assertion_source_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM privacy_retention.g014_public_rpc_allowlist
    WHERE source_signature =
      'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
      AND grantee = 'service_role'::name
  ) <> 1
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.g014_public_rpc_allowlist
       WHERE source_signature =
         'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
     ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_allowlist_prerequisite_drift';
  END IF;

  IF EXISTS (
    WITH expected(signature) AS (
      VALUES
        ('public.cosine_distance(halfvec,halfvec)'),
        ('public.cosine_distance(sparsevec,sparsevec)'),
        ('public.cosine_distance(vector,vector)'),
        ('public.l1_distance(halfvec,halfvec)'),
        ('public.l1_distance(sparsevec,sparsevec)'),
        ('public.l1_distance(vector,vector)'),
        ('public.vector_negative_inner_product(vector,vector)')
    ), resolved AS (
      SELECT expected.signature,
             pg_catalog.to_regprocedure(expected.signature) AS function_oid
      FROM expected
    )
    SELECT 1
    FROM resolved
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = resolved.function_oid
    WHERE procedure.oid IS NULL
       OR procedure.proowner <> 'supabase_admin'::pg_catalog.regrole
       OR procedure.prosecdef
       OR procedure.provolatile <> 'i'
       OR procedure.proparallel <> 's'
       OR procedure.proleakproof
       OR procedure.proretset
       OR procedure.prokind <> 'f'
       OR procedure.prolang <> (
         SELECT language.oid
         FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'c'
       )
       OR procedure.prorettype <> 'double precision'::pg_catalog.regtype
       OR procedure.proconfig IS NOT NULL
       OR EXISTS (
         WITH expected_acl(grantee, is_grantable) AS (
           VALUES
             ('PUBLIC'::name, false),
             ('anon'::name, false),
             ('authenticated'::name, false),
             ('postgres'::name, false),
             ('service_role'::name, false),
             ('supabase_admin'::name, false)
         ), actual_acl(grantee, is_grantable) AS (
           SELECT
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
             acl.is_grantable
           FROM pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
           ) AS acl
           WHERE acl.privilege_type = 'EXECUTE'
         )
         SELECT 1
         FROM (
           (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
           UNION ALL
           (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
         ) AS difference
       )
  ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_vector_helper_prerequisite_drift';
  END IF;
END
$catalog_preflight$;

DO $membership$
BEGIN
  IF session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_roles AS role_row
       WHERE role_row.rolname = 'postgres'
         AND NOT role_row.rolsuper
         AND role_row.rolcreaterole
     )
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'MEMBER')
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'USAGE')
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'SET')
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'privacy_auth_bridge'::name,
             'postgres'::name,
             false, true, true
           )
       ), actual AS (
         SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
                pg_catalog.pg_get_userbyid(membership.member)::name,
                pg_catalog.pg_get_userbyid(membership.grantor)::name,
                membership.admin_option,
                membership.inherit_option,
                membership.set_option
         FROM pg_catalog.pg_auth_members AS membership
         WHERE membership.roleid =
                 'privacy_workflow_owner'::pg_catalog.regrole
            OR membership.member =
                 'privacy_workflow_owner'::pg_catalog.regrole
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_membership_prerequisite_drift';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT privacy_workflow_owner TO %I '
    || 'WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY %I',
    session_user,
    session_user
  );

  IF EXISTS (
    WITH expected(
      role_name, member_name, grantor_name,
      admin_option, inherit_option, set_option
    ) AS (
      VALUES
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'supabase_admin'::name,
          true, false, false
        ),
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'postgres'::name,
          false, true, true
        ),
        (
          'privacy_workflow_owner'::name,
          'privacy_auth_bridge'::name,
          'postgres'::name,
          false, true, true
        )
    ), actual AS (
      SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
             pg_catalog.pg_get_userbyid(membership.member)::name,
             pg_catalog.pg_get_userbyid(membership.grantor)::name,
             membership.admin_option,
             membership.inherit_option,
             membership.set_option
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid =
              'privacy_workflow_owner'::pg_catalog.regrole
         OR membership.member =
              'privacy_workflow_owner'::pg_catalog.regrole
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_membership_acquire_drift';
  END IF;
END
$membership$;

-- The seven vector-extension helpers are provider-owned by supabase_admin.
-- The hosted migration executor is the non-superuser postgres role and has no
-- membership in supabase_admin, so it cannot legally rewrite those ACLs.  The
-- exact live ACL and immutable C-function metadata are pinned before and after
-- convergence instead of pretending that a provider-owned revoke succeeded.

SET LOCAL ROLE privacy_workflow_owner;

-- Normalize every preserved OID to its complete intended executor set before
-- replacing the body.  CREATE OR REPLACE alone would retain an unknown ACL.
REVOKE ALL ON FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility()
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid)
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_auth_session_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_auth_session_id()
  FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_current_auth_session_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_current_auth_session_active()
  FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION privacy_retention.g016_reattest_privacy_onboarding(
  p_challenge_id uuid,
  p_user_id uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_challenge privacy_retention.privacy_onboarding_challenges%ROWTYPE;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_event_count integer := 0;
  v_audit_id uuid;
  v_idempotency_prefix text := 'onb' || pg_catalog.replace(p_challenge_id::text, '-', '');
BEGIN
  SELECT * INTO v_challenge
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_challenge.consumed_at IS NOT NULL
     OR v_challenge.expires_at <= pg_catalog.clock_timestamp()
     OR v_challenge.age_band <> 'age_14_plus'
     OR v_profile.age_band IS DISTINCT FROM v_challenge.age_band
     OR v_profile.status <> 'eligible' THEN
    RAISE EXCEPTION 'privacy_onboarding_reattest_invalid' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy-publication-state', 0)
  );
  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND OR v_policy.id IS DISTINCT FROM v_challenge.policy_version_id THEN
    RAISE EXCEPTION 'privacy_current_policy_required' USING ERRCODE = '23514';
  END IF;

  UPDATE privacy_retention.privacy_age_profiles AS profile
  SET attested_at = pg_catalog.clock_timestamp(),
      method = 'self_attestation',
      status = 'eligible',
      policy_version_id = v_policy.id
  WHERE profile.user_id = p_user_id;

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
    source, correlation_id, idempotency_key
  ) VALUES (
    p_user_id, 'self', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256,
    p_source, p_challenge_id, v_idempotency_prefix || 'required'
  );
  v_event_count := v_event_count + 1;

  IF COALESCE((v_challenge.requested_consents ->> 'email')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'email_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'email');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'sms')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'sms');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'push')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'push_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'push');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_email')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightemail');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_sms')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightsms');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_push')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightpush');
    v_event_count := v_event_count + 1;
  END IF;

  UPDATE privacy_retention.privacy_onboarding_challenges
  SET consumed_at = pg_catalog.clock_timestamp(), consumed_by_user_id = p_user_id
  WHERE id = p_challenge_id AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '55000';
  END IF;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_confirmed', p_user_id, p_user_id, p_challenge_id, p_challenge_id, 'applied',
    'ONBOARDING_CONFIRMED',
    pg_catalog.jsonb_build_object('consentEvents', v_event_count, 'eligible', true),
    pg_catalog.jsonb_build_object('route', '/api/privacy/onboarding')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'operationId', p_challenge_id::text, 'challengeId', p_challenge_id::text,
    'userId', p_user_id::text, 'policyVersionId', v_challenge.policy_version_id::text,
    'eligible', true, 'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object(
      'challengeConsumed', true, 'ageProfileRecorded', true, 'requiredConsentRecorded', true, 'eligible', true
    )),
    'auditId', v_audit_id::text, 'errorCode', NULL, 'ageStatus', 'eligible'
  );
END;
$function$;
REVOKE ALL ON FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_current_privacy_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_role text;
  v_user_id uuid;
  v_receipt jsonb;
  v_policy_version text;
BEGIN
  v_role := COALESCE(NULLIF(v_claims ->> 'role', ''), pg_catalog.current_setting('request.jwt.claim.role', true), '');
  BEGIN
    v_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END;
  IF v_role <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END IF;

  v_receipt := privacy_retention.g014_privacy_eligibility_receipt(v_user_id);
  SELECT policy.version INTO v_policy_version
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.id = NULLIF(v_receipt ->> 'policyVersionId', '')::uuid;
  RETURN v_receipt || pg_catalog.jsonb_build_object('policyVersion', v_policy_version);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_privacy_eligibility() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_privacy_eligibility_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_receipt jsonb;
  v_policy_version text;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_eligibility_user_required' USING ERRCODE = '22023';
  END IF;
  v_receipt := privacy_retention.g014_privacy_eligibility_receipt(p_user_id);
  SELECT policy.version INTO v_policy_version
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.id = NULLIF(v_receipt ->> 'policyVersionId', '')::uuid;
  RETURN v_receipt || pg_catalog.jsonb_build_object('policyVersion', v_policy_version);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_privacy_eligibility_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_current_auth_session_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_role text;
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  v_role := COALESCE(NULLIF(v_claims ->> 'role', ''), pg_catalog.current_setting('request.jwt.claim.role', true), '');
  BEGIN
    v_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
    v_session_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'session_id', ''), pg_catalog.current_setting('request.jwt.claim.session_id', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  IF v_role <> 'authenticated' OR v_user_id IS NULL OR v_session_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_session_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_current_auth_session_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_auth_session_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_current_auth_session_active()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_current_session_id uuid;
  v_current_user_id uuid;
  v_lease public.release_auth_session_leases%ROWTYPE;
BEGIN
  BEGIN
    v_current_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  v_current_session_id := public.get_current_auth_session_id();
  IF v_current_session_id IS NULL OR v_current_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.release_auth_identities AS identity
    WHERE identity.user_id = v_current_user_id
  ) THEN
    RETURN true;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_current_session_id::text, 0));
  SELECT * INTO v_lease
  FROM public.release_auth_session_leases AS lease
  WHERE lease.user_id = v_current_user_id
    AND lease.session_id = v_current_session_id
  FOR UPDATE;
  RETURN FOUND AND v_lease.expires_at > pg_catalog.clock_timestamp();
END;
$function$;
REVOKE ALL ON FUNCTION public.is_current_auth_session_active()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_auth_session_active() TO authenticated;

DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature =
  'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
  AND grantee = 'service_role'::name;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT namespace.nspname,
       procedure.proname,
       procedure.proargtypes::text,
       'service_role'::name,
       'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE procedure.oid = pg_catalog.to_regprocedure(
  'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
)
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;

DO $owner_readback$
DECLARE
  v_expected record;
  v_oid pg_catalog.regprocedure;
  v_hash text;
  v_expected_grantees name[];
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('privacy_retention.g016_reattest_privacy_onboarding(uuid,uuid,text)', '8a80f7558d2750b55e177356f7786d03b3de837fecb65b66a9a33496dc11ac0f', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_current_privacy_eligibility()', 'fb659a99a20294499a6330b01b43cb3a6c2177e937a87cf3c5d23360af865a78', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_privacy_eligibility_for_user(uuid)', '7e76e26a689fa918e3c76a4bcff866ab02663e1538f2cf8a347bf837ca830b47', 'v'::"char", 'jsonb'::pg_catalog.regtype),
      ('public.get_current_auth_session_id()', '641a85d0e6a9a2d7bee9a628b8e808a6c5e35132cf17483ebaaa448c4838fb95', 's'::"char", 'uuid'::pg_catalog.regtype),
      ('public.is_current_auth_session_active()', 'd1177c98850c47e495574fc37b3f5e636b5a546972654368a7dca296a2b7a668', 'v'::"char", 'boolean'::pg_catalog.regtype)
    ) AS expected(signature, source_sha256, volatility, return_type)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    SELECT pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
             'hex'
           )
      INTO v_hash
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_oid
       AND procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
       AND procedure.prosecdef
       AND procedure.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
       AND procedure.provolatile = v_expected.volatility
       AND procedure.prolang = (
         SELECT language.oid
         FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'plpgsql'
       )
       AND procedure.prorettype = v_expected.return_type
       AND NOT procedure.proretset
       AND procedure.prokind = 'f'
       AND NOT procedure.proleakproof
       AND procedure.proparallel = 'u';
    IF v_hash IS DISTINCT FROM v_expected.source_sha256 THEN
      RAISE EXCEPTION 'hosted_g016_g041_function_readback_drift: %',
        v_expected.signature;
    END IF;

    v_expected_grantees := CASE v_expected.signature
      WHEN 'public.get_current_privacy_eligibility()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      WHEN 'public.get_privacy_eligibility_for_user(uuid)'
        THEN ARRAY['privacy_workflow_owner', 'service_role']::name[]
      WHEN 'public.get_current_auth_session_id()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      WHEN 'public.is_current_auth_session_active()'
        THEN ARRAY['authenticated', 'privacy_workflow_owner']::name[]
      ELSE ARRAY['privacy_workflow_owner']::name[]
    END;
    IF (
      SELECT pg_catalog.array_agg(grantee_name ORDER BY grantee_name)
      FROM (
        SELECT COALESCE(role_row.rolname, 'PUBLIC') AS grantee_name
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = acl.grantee
        WHERE procedure.oid = v_oid
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
      ) AS grants
    ) IS DISTINCT FROM v_expected_grantees
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE procedure.oid = v_oid
           AND (acl.privilege_type <> 'EXECUTE' OR acl.is_grantable)
       ) THEN
      RAISE EXCEPTION 'hosted_g016_g041_function_acl_readback_drift: %',
        v_expected.signature;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
    FROM privacy_retention.g014_public_rpc_allowlist
    WHERE source_signature =
      'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
      AND grantee = 'service_role'::name
  ) <> 1
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.g014_public_rpc_allowlist
       WHERE source_signature =
         'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
     ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_allowlist_readback_drift';
  END IF;
END
$owner_readback$;

SELECT privacy_retention.assert_g014_catalog_contract();

RESET ROLE;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $closure_readback$
BEGIN
  IF EXISTS (
    WITH expected(signature) AS (
      VALUES
        ('public.cosine_distance(halfvec,halfvec)'),
        ('public.cosine_distance(sparsevec,sparsevec)'),
        ('public.cosine_distance(vector,vector)'),
        ('public.l1_distance(halfvec,halfvec)'),
        ('public.l1_distance(sparsevec,sparsevec)'),
        ('public.l1_distance(vector,vector)'),
        ('public.vector_negative_inner_product(vector,vector)')
    )
    SELECT 1
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
    WHERE procedure.proowner <> 'supabase_admin'::pg_catalog.regrole
       OR procedure.prosecdef
       OR procedure.provolatile <> 'i'
       OR procedure.proparallel <> 's'
       OR procedure.proleakproof
       OR procedure.proretset
       OR procedure.prokind <> 'f'
       OR procedure.prolang <> (
         SELECT language.oid
         FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'c'
       )
       OR procedure.prorettype <> 'double precision'::pg_catalog.regtype
       OR procedure.proconfig IS NOT NULL
       OR EXISTS (
         WITH expected_acl(grantee, is_grantable) AS (
           VALUES
             ('PUBLIC'::name, false),
             ('anon'::name, false),
             ('authenticated'::name, false),
             ('postgres'::name, false),
             ('service_role'::name, false),
             ('supabase_admin'::name, false)
         ), actual_acl(grantee, is_grantable) AS (
           SELECT
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
             acl.is_grantable
           FROM pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
           ) AS acl
           WHERE acl.privilege_type = 'EXECUTE'
         )
         SELECT 1
         FROM (
           (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
           UNION ALL
           (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
         ) AS difference
       )
  ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_vector_helper_acl_readback_drift';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.release_auth_identities', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'UPDATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'created_at', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'operation_id', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'user_id', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'session_id', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'refresh_sha256', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'privacy_workflow_owner', 'public.release_auth_session_leases', 'expires_at', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_session_closure_regressed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'privacy_auth_bridge'
      AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb
           OR rolreplication OR rolbypassrls)
  ) OR pg_catalog.to_regclass('privacy_retention.privacy_auth_users_bridge') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_auth_sessions_bridge') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_auth_identities_bridge') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_auth_refresh_tokens_bridge') IS NULL THEN
    RAISE EXCEPTION 'hosted_g016_g041_auth_bridge_closure_regressed';
  END IF;
END
$closure_readback$;

DO $membership_restore$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I',
    session_user,
    session_user
  );

  IF current_user IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'privacy_auth_bridge'::name,
             'postgres'::name,
             false, true, true
           )
       ), actual AS (
         SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
                pg_catalog.pg_get_userbyid(membership.member)::name,
                pg_catalog.pg_get_userbyid(membership.grantor)::name,
                membership.admin_option,
                membership.inherit_option,
                membership.set_option
         FROM pg_catalog.pg_auth_members AS membership
         WHERE membership.roleid =
                 'privacy_workflow_owner'::pg_catalog.regrole
            OR membership.member =
                 'privacy_workflow_owner'::pg_catalog.regrole
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_g016_g041_membership_restore_drift';
  END IF;
END
$membership_restore$;

NOTIFY pgrst, 'reload schema';
