-- Repair the local admin map-overlay write boundary after G041 removed every
-- direct auth-schema capability from privacy_workflow_owner. The public RPC
-- remains service-role-only and SECURITY DEFINER; its owner receives only the
-- exact table operations used by the function.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:local-admin-map-overlay-boundary-convergence:v1',
    0
  )
);

DO $$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass(
       'public.admin_restaurant_map_overlays'
     ) IS NULL
     OR pg_catalog.to_regclass(
       'public.admin_restaurant_map_overlay_audit_events'
     ) IS NULL
     OR pg_catalog.to_regclass('public.restaurants') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'local_admin_map_overlay_boundary_prerequisite_missing';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.apply_admin_restaurant_map_overlay_action(
  p_actor_user_id uuid,
  p_action text,
  p_restaurant_id uuid,
  p_overlay_type text,
  p_label text,
  p_description text,
  p_active_from timestamptz,
  p_active_until timestamptz,
  p_evidence jsonb,
  p_reason text,
  p_preview_hash text,
  p_payload_hash text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_request_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb;
  v_claims_role text;
  v_legacy_role text;
  v_restaurant public.restaurants%ROWTYPE;
  v_overlay_before public.admin_restaurant_map_overlays%ROWTYPE;
  v_overlay_after public.admin_restaurant_map_overlays%ROWTYPE;
  v_audit public.admin_restaurant_map_overlay_audit_events%ROWTYPE;
  v_before_snapshot jsonb := '{}'::jsonb;
  v_after_snapshot jsonb := '{}'::jsonb;
  v_request_metadata jsonb := '{}'::jsonb;
  v_now timestamptz := pg_catalog.timezone(
    'utc'::text,
    pg_catalog.now()
  );
BEGIN
  BEGIN
    v_claims := COALESCE(
      NULLIF(
        pg_catalog.current_setting('request.jwt.claims', true),
        ''
      )::jsonb,
      '{}'::jsonb
    );
    v_claims_role := NULLIF(v_claims ->> 'role', '');
    v_legacy_role := NULLIF(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    );
  EXCEPTION
    WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'overlay_service_role_required'
        USING ERRCODE = '42501';
  END;

  IF COALESCE(v_claims_role, v_legacy_role, '') <>
       'service_role'
     OR (
       v_claims_role IS NOT NULL
       AND v_legacy_role IS NOT NULL
       AND v_claims_role <> v_legacy_role
     ) THEN
    RAISE EXCEPTION 'overlay_service_role_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'overlay_actor_required';
  END IF;

  IF p_action IS NULL
     OR p_action NOT IN ('upsert_overlay', 'deactivate_overlay') THEN
    RAISE EXCEPTION 'overlay_action_invalid';
  END IF;

  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'overlay_restaurant_not_found';
  END IF;

  IF p_overlay_type IS NULL
     OR p_overlay_type NOT IN ('trend', 'seasonal') THEN
    RAISE EXCEPTION 'overlay_type_invalid';
  END IF;

  IF p_action = 'upsert_overlay'
     AND (
       p_label IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_label)) < 1
       OR pg_catalog.char_length(pg_catalog.btrim(p_label)) > 80
     ) THEN
    RAISE EXCEPTION 'overlay_label_invalid';
  END IF;

  IF p_description IS NOT NULL
     AND pg_catalog.char_length(p_description) > 500 THEN
    RAISE EXCEPTION 'overlay_description_invalid';
  END IF;

  IF p_active_from IS NOT NULL
     AND p_active_until IS NOT NULL
     AND p_active_from > p_active_until THEN
    RAISE EXCEPTION 'overlay_active_window_invalid';
  END IF;

  IF p_reason IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) < 1 THEN
    RAISE EXCEPTION 'overlay_reason_required';
  END IF;

  IF p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'overlay_hash_invalid';
  END IF;

  IF p_correlation_id IS NULL
     OR p_idempotency_key IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) < 1 THEN
    RAISE EXCEPTION 'overlay_idempotency_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_user_id::text || ':' || p_idempotency_key,
      0
    )
  );

  SELECT *
    INTO v_audit
    FROM public.admin_restaurant_map_overlay_audit_events AS audit_row
   WHERE audit_row.actor_user_id = p_actor_user_id
     AND audit_row.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_audit.payload_hash = p_payload_hash
       AND v_audit.correlation_id = p_correlation_id
       AND v_audit.restaurant_id = p_restaurant_id
       AND v_audit.overlay_type = p_overlay_type
       AND v_audit.action = p_action THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', v_audit.status,
        'replayed', true,
        'overlay', v_audit.after_snapshot,
        'audit', pg_catalog.to_jsonb(v_audit),
        'readback', pg_catalog.jsonb_build_object(
          'matchedPayloadHash', true,
          'matchedPreviewHash',
            COALESCE(
              v_audit.request_metadata ->> 'previewHash',
              ''
            ) = p_preview_hash,
          'restaurantId', v_audit.restaurant_id,
          'overlayType', v_audit.overlay_type
        )
      );
    END IF;

    RAISE EXCEPTION 'overlay_idempotency_conflict';
  END IF;

  -- A row lock on restaurants required UPDATE privilege for the definer even
  -- though this RPC never changes restaurants. Existence is sufficient here;
  -- the overlay row and actor/idempotency advisory lock serialize writes.
  SELECT *
    INTO v_restaurant
    FROM public.restaurants AS restaurant_row
   WHERE restaurant_row.id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'overlay_restaurant_not_found';
  END IF;

  SELECT *
    INTO v_overlay_before
    FROM public.admin_restaurant_map_overlays AS overlay_row
   WHERE overlay_row.restaurant_id = p_restaurant_id
     AND overlay_row.overlay_type = p_overlay_type
   FOR UPDATE;

  IF FOUND THEN
    v_before_snapshot := pg_catalog.to_jsonb(v_overlay_before);
  ELSIF p_action = 'deactivate_overlay' THEN
    RAISE EXCEPTION 'overlay_not_found_for_deactivate';
  END IF;

  IF p_action = 'upsert_overlay' THEN
    IF v_before_snapshot = '{}'::jsonb THEN
      INSERT INTO public.admin_restaurant_map_overlays (
        restaurant_id,
        overlay_type,
        label,
        description,
        active_from,
        active_until,
        evidence,
        is_active,
        created_by_admin_id,
        updated_by_admin_id
      ) VALUES (
        p_restaurant_id,
        p_overlay_type,
        pg_catalog.btrim(p_label),
        p_description,
        p_active_from,
        p_active_until,
        COALESCE(p_evidence, '{}'::jsonb),
        true,
        p_actor_user_id,
        p_actor_user_id
      )
      RETURNING * INTO v_overlay_after;
    ELSE
      UPDATE public.admin_restaurant_map_overlays AS overlay_row
         SET label = pg_catalog.btrim(p_label),
             description = p_description,
             active_from = p_active_from,
             active_until = p_active_until,
             evidence = COALESCE(p_evidence, '{}'::jsonb),
             is_active = true,
             updated_by_admin_id = p_actor_user_id
       WHERE overlay_row.restaurant_id = p_restaurant_id
         AND overlay_row.overlay_type = p_overlay_type
      RETURNING * INTO v_overlay_after;
    END IF;
  ELSE
    UPDATE public.admin_restaurant_map_overlays AS overlay_row
       SET is_active = false,
           evidence = COALESCE(
             overlay_row.evidence,
             '{}'::jsonb
           ) || pg_catalog.jsonb_build_object(
             'deactivatedAt', v_now,
             'deactivationReason', pg_catalog.btrim(p_reason),
             'deactivationPreviewHash', p_preview_hash,
             'deactivationPayloadHash', p_payload_hash
           ),
           updated_by_admin_id = p_actor_user_id
     WHERE overlay_row.restaurant_id = p_restaurant_id
       AND overlay_row.overlay_type = p_overlay_type
    RETURNING * INTO v_overlay_after;
  END IF;

  v_after_snapshot := pg_catalog.to_jsonb(v_overlay_after);
  v_request_metadata := COALESCE(
    p_request_metadata,
    '{}'::jsonb
  ) || pg_catalog.jsonb_build_object('previewHash', p_preview_hash);

  INSERT INTO public.admin_restaurant_map_overlay_audit_events (
    actor_user_id,
    action,
    restaurant_id,
    overlay_type,
    reason,
    before_snapshot,
    after_snapshot,
    correlation_id,
    idempotency_key,
    payload_hash,
    request_metadata,
    status
  ) VALUES (
    p_actor_user_id,
    p_action,
    p_restaurant_id,
    p_overlay_type,
    pg_catalog.btrim(p_reason),
    v_before_snapshot,
    v_after_snapshot,
    p_correlation_id,
    p_idempotency_key,
    p_payload_hash,
    v_request_metadata,
    'applied'
  )
  RETURNING * INTO v_audit;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'applied',
    'replayed', false,
    'overlay', v_after_snapshot,
    'audit', pg_catalog.to_jsonb(v_audit),
    'readback', pg_catalog.jsonb_build_object(
      'matchedPayloadHash', v_audit.payload_hash = p_payload_hash,
      'matchedPreviewHash',
        COALESCE(
          v_audit.request_metadata ->> 'previewHash',
          ''
        ) = p_preview_hash,
      'restaurantId', v_overlay_after.restaurant_id,
      'overlayType', v_overlay_after.overlay_type
    )
  );
END
$$;

ALTER FUNCTION public.apply_admin_restaurant_map_overlay_action(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb,
  text, text, text, uuid, text, jsonb
) OWNER TO privacy_workflow_owner;

REVOKE ALL ON FUNCTION public.apply_admin_restaurant_map_overlay_action(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb,
  text, text, text, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_restaurant_map_overlay_action(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, jsonb,
  text, text, text, uuid, text, jsonb
) TO service_role;

ALTER TABLE public.admin_restaurant_map_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_restaurant_map_overlay_audit_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_restaurant_map_overlays
  FROM PUBLIC, anon, authenticated, privacy_workflow_owner;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.admin_restaurant_map_overlays FROM service_role;
GRANT SELECT ON TABLE public.admin_restaurant_map_overlays TO service_role;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.admin_restaurant_map_overlays TO privacy_workflow_owner;

REVOKE ALL ON TABLE public.admin_restaurant_map_overlay_audit_events
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
GRANT SELECT, INSERT
  ON TABLE public.admin_restaurant_map_overlay_audit_events
  TO privacy_workflow_owner;

DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_select
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_insert
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_update
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlay_audit_owner_select
  ON public.admin_restaurant_map_overlay_audit_events;
DROP POLICY IF EXISTS tzudong_admin_map_overlay_audit_owner_insert
  ON public.admin_restaurant_map_overlay_audit_events;

CREATE POLICY tzudong_admin_map_overlays_owner_select
  ON public.admin_restaurant_map_overlays
  FOR SELECT TO privacy_workflow_owner
  USING (true);
CREATE POLICY tzudong_admin_map_overlays_owner_insert
  ON public.admin_restaurant_map_overlays
  FOR INSERT TO privacy_workflow_owner
  WITH CHECK (true);
CREATE POLICY tzudong_admin_map_overlays_owner_update
  ON public.admin_restaurant_map_overlays
  FOR UPDATE TO privacy_workflow_owner
  USING (true)
  WITH CHECK (true);

CREATE POLICY tzudong_admin_map_overlay_audit_owner_select
  ON public.admin_restaurant_map_overlay_audit_events
  FOR SELECT TO privacy_workflow_owner
  USING (true);
CREATE POLICY tzudong_admin_map_overlay_audit_owner_insert
  ON public.admin_restaurant_map_overlay_audit_events
  FOR INSERT TO privacy_workflow_owner
  WITH CHECK (true);

DO $$
DECLARE
  rpc_function regprocedure := pg_catalog.to_regprocedure(
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
  );
  rpc_source text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(function_row.oid)
    INTO rpc_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = rpc_function;

  IF rpc_function IS NULL
     OR rpc_source IS NULL
     OR position('request.jwt.claims' IN rpc_source) = 0
     OR position('request.jwt.claim.role' IN rpc_source) = 0
     OR position('auth.role()' IN rpc_source) <> 0
     OR position('FOR SHARE' IN pg_catalog.upper(rpc_source)) <> 0
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid = rpc_function
          AND (
            pg_catalog.pg_get_userbyid(function_row.proowner) <>
              'privacy_workflow_owner'
            OR function_row.prosecdef IS NOT TRUE
            OR function_row.provolatile <> 'v'
            OR function_row.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
          )
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', rpc_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', rpc_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', rpc_function, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'local_admin_map_overlay_rpc_contract_failed';
  END IF;

  IF pg_catalog.has_schema_privilege(
       'privacy_workflow_owner', 'auth', 'USAGE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.restaurants', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.restaurants', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlays', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_restaurant_map_overlays',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_restaurant_map_overlay_audit_events',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('anon'::name), ('authenticated'::name))
           AS denied(role_name)
        WHERE pg_catalog.has_table_privilege(
          denied.role_name,
          'public.admin_restaurant_map_overlays',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
           OR pg_catalog.has_table_privilege(
             denied.role_name,
             'public.admin_restaurant_map_overlay_audit_events',
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
           )
     ) THEN
    RAISE EXCEPTION 'local_admin_map_overlay_table_grant_contract_failed';
  END IF;

  IF EXISTS (
    WITH expected(
      relation_name, policy_name, command, normalized_using, normalized_check
    ) AS (
      VALUES
        (
          'admin_restaurant_map_overlay_audit_events',
          'tzudong_admin_map_overlay_audit_owner_insert',
          'a'::"char", NULL::text, 'true'::text
        ),
        (
          'admin_restaurant_map_overlay_audit_events',
          'tzudong_admin_map_overlay_audit_owner_select',
          'r'::"char", 'true'::text, NULL::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_insert',
          'a'::"char", NULL::text, 'true'::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_select',
          'r'::"char", 'true'::text, NULL::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_update',
          'w'::"char", 'true'::text, 'true'::text
        )
    ), actual AS (
      SELECT
        relation_row.relname AS relation_name,
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        policy_row.polroles,
        pg_catalog.pg_get_expr(
          policy_row.polqual, policy_row.polrelid
        ) AS normalized_using,
        pg_catalog.pg_get_expr(
          policy_row.polwithcheck, policy_row.polrelid
        ) AS normalized_check
        FROM pg_catalog.pg_policy AS policy_row
        JOIN pg_catalog.pg_class AS relation_row
          ON relation_row.oid = policy_row.polrelid
        JOIN pg_catalog.pg_namespace AS schema_row
          ON schema_row.oid = relation_row.relnamespace
       WHERE schema_row.nspname = 'public'
         AND relation_row.relname IN (
           'admin_restaurant_map_overlays',
           'admin_restaurant_map_overlay_audit_events'
         )
    )
    (SELECT
       relation_name, policy_name, command,
       ARRAY['privacy_workflow_owner'::regrole::oid],
       normalized_using, normalized_check
       FROM expected
     EXCEPT
     SELECT
       relation_name, policy_name, command, polroles,
       normalized_using, normalized_check
       FROM actual)
    UNION ALL
    (SELECT
       relation_name, policy_name, command, polroles,
       normalized_using, normalized_check
       FROM actual
     EXCEPT
     SELECT
       relation_name, policy_name, command,
       ARRAY['privacy_workflow_owner'::regrole::oid],
       normalized_using, normalized_check
       FROM expected)
  ) THEN
    RAISE EXCEPTION 'local_admin_map_overlay_policy_contract_failed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS sequence_row
      JOIN pg_catalog.pg_depend AS dependency
        ON dependency.objid = sequence_row.oid
       AND dependency.classid = 'pg_class'::regclass
       AND dependency.deptype IN ('a', 'i')
     WHERE sequence_row.relkind = 'S'
       AND dependency.refobjid IN (
         'public.admin_restaurant_map_overlays'::regclass,
         'public.admin_restaurant_map_overlay_audit_events'::regclass
       )
  ) THEN
    RAISE EXCEPTION 'local_admin_map_overlay_unexpected_sequence';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
