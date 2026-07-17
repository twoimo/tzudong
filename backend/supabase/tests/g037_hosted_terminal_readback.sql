-- G037 terminal readback. Read-only assertions emit only booleans and fingerprints.
SELECT
  count(*) = 40 AS exact_terminal_ledger_count,
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
      '02420dbf7782d8991a2f43999c723283b9fdde2754f1dd38834474a81017b8a1',
      ARRAY['p_item_id', 'p_admin_user_id', 'p_restaurant_data', 'success', 'message', 'created_restaurant_id']::text[]
    ),
    (
      'public.approve_edit_submission_item(uuid,uuid,jsonb)',
      'a88dccb8f26370629ca6dd0b84a8e7681393c16c4e687d709bd3d6bfc8aa6b68',
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
          pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(prosrc), '\s+', ' ', 'g')),
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
  count(*) = 2 AS exact_approval_oid_count,
  COALESCE(bool_and(source_body_sha256_matches), false) AS approval_source_body_sha256_matches,
  COALESCE(bool_and(exact_catalog_attributes_match), false) AS approval_exact_catalog_attributes_match,
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
