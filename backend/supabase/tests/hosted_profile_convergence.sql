BEGIN;

SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '10s';

DO $hosted_profile_contract$
DECLARE
  v_expected record;
  v_signature text;
  v_oid oid;
  v_predecessor_root text;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM supabase_migrations.schema_migrations
  ) <> 54
     OR (
       SELECT pg_catalog.count(*)
         FROM supabase_migrations.schema_migrations AS migration
        WHERE (migration.version, migration.name) IN (
          ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
          ('20260814010100', 'hosted_runtime_boundary_convergence'),
          ('20260814010200', 'hosted_public_profile_read_convergence'),
          ('20260814010300', 'hosted_current_profile_mutation')
         )
     ) <> 4
     OR EXISTS (
       SELECT 1
         FROM supabase_migrations.schema_migrations AS migration
        WHERE migration.version::text >= '20260814010000'
          AND (migration.version::text, migration.name::text) NOT IN (
            ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
            ('20260814010100', 'hosted_runtime_boundary_convergence'),
            ('20260814010200', 'hosted_public_profile_read_convergence'),
            ('20260814010300', 'hosted_current_profile_mutation')
          )
     ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_ledger_drift';
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
    INTO v_predecessor_root
    FROM supabase_migrations.schema_migrations AS migration
   WHERE migration.version::text < '20260814010000';

  IF v_predecessor_root IS DISTINCT FROM
       'ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4'
     OR (
       SELECT pg_catalog.count(*)
         FROM supabase_migrations.schema_migrations AS migration
        WHERE migration.version::text < '20260814010000'
          AND migration.statements IS NULL
     ) <> 0
     OR (
       SELECT pg_catalog.count(*)
         FROM supabase_migrations.schema_migrations AS migration
        WHERE migration.version::text < '20260814010000'
          AND pg_catalog.cardinality(migration.statements) = 0
     ) <> 7 THEN
    RAISE EXCEPTION 'hosted_profile_contract_predecessor_statement_root_drift';
  END IF;

  FOR v_expected IN
    SELECT expected.version,
           expected.name,
           expected.statement_count,
           expected.statements_sha256
      FROM (
        VALUES
          (
            '20260814010000'::text,
            'hosted_g016_g041_catalog_reconciliation'::text,
            41,
            'e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8'::text
          ),
          (
            '20260814010100'::text,
            'hosted_runtime_boundary_convergence'::text,
            140,
            'f1531c8479a872791a96ff5595459ef0adfa2f9b3104890d820c1fe4bea7dd07'::text
          ),
          (
            '20260814010200'::text,
            'hosted_public_profile_read_convergence'::text,
            57,
            'b29359016f9f53753af372bfb359251ebc71b94f94387f06f43e11b65cd6cea8'::text
          ),
          (
            '20260814010300'::text,
            'hosted_current_profile_mutation'::text,
            53,
            '45ebe6eb8dca03cdf4915adcab394ab8b7389252f1f37913760830f82fb6d727'::text
          )
      ) AS expected(version, name, statement_count, statements_sha256)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM supabase_migrations.schema_migrations AS migration
       WHERE migration.version::text = v_expected.version
         AND migration.name::text = v_expected.name
         AND pg_catalog.cardinality(migration.statements) =
           v_expected.statement_count
         AND pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.to_json(migration.statements)::text,
               'UTF8'
             )
           ),
           'hex'
         ) = v_expected.statements_sha256
    ) THEN
      RAISE EXCEPTION 'hosted_profile_contract_statement_vector_drift';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role_row
     WHERE role_row.rolname = 'privacy_workflow_owner'
       AND NOT role_row.rolsuper
       AND NOT role_row.rolinherit
       AND NOT role_row.rolcreaterole
       AND NOT role_row.rolcreatedb
       AND NOT role_row.rolcanlogin
       AND NOT role_row.rolreplication
       AND NOT role_row.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_owner_drift';
  END IF;

  IF EXISTS (
    WITH expected(
      role_name, member_name, grantor_name,
      admin_option, inherit_option, set_option
    ) AS (
      VALUES
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'postgres'::name,
          false, true, false
        ),
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'supabase_admin'::name,
          true, false, false
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
    SELECT 1 FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_owner_membership_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation_row
    WHERE relation_row.oid IN (
      'public.profiles'::pg_catalog.regclass,
      'public.reviews'::pg_catalog.regclass
    )
      AND relation_row.relkind = 'r'
      AND relation_row.relowner = 'postgres'::pg_catalog.regrole
      AND relation_row.relrowsecurity
      AND relation_row.relforcerowsecurity
  ) <> 2
     OR EXISTS (
       WITH expected(relation_oid, grantee, privileges) AS (
         VALUES
           ('public.profiles'::pg_catalog.regclass::oid, 'postgres'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]),
           ('public.profiles'::pg_catalog.regclass::oid, 'privacy_workflow_owner'::name,
             ARRAY['SELECT','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'anon'::name,
             ARRAY['SELECT']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'authenticated'::name,
             ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'postgres'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'privacy_workflow_owner'::name,
             ARRAY['DELETE','SELECT']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'service_role'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[])
       ), expected_acl(relation_oid, grantee, privilege_type, is_grantable) AS (
         SELECT expected.relation_oid, expected.grantee,
                privilege.privilege_type, false
         FROM expected
         CROSS JOIN LATERAL pg_catalog.unnest(expected.privileges)
           AS privilege(privilege_type)
       ), actual_acl(relation_oid, grantee, privilege_type, is_grantable) AS (
         SELECT relation_row.oid,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.privilege_type, acl.is_grantable
         FROM pg_catalog.pg_class AS relation_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(relation_row.relacl,
                    pg_catalog.acldefault('r', relation_row.relowner))
         ) AS acl
         WHERE relation_row.oid IN (
           'public.profiles'::pg_catalog.regclass,
           'public.reviews'::pg_catalog.regclass
         )
       )
       SELECT 1 FROM (
         (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
         UNION ALL
         (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_profile_relation_drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure,
        '6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d'::text
      ),
      (
        'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure,
        '33440eb6b1311aeac7f8d84161e4cb4e3dfe71c589dbc548e1e4f64755cba405'::text
      )
    ) AS expected(function_oid, source_sha256)
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = expected.function_oid
    WHERE procedure.proowner IS DISTINCT FROM
            'privacy_workflow_owner'::pg_catalog.regrole
       OR procedure.prosecdef IS DISTINCT FROM true
       OR procedure.proleakproof
       OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
       OR procedure.provolatile IS DISTINCT FROM 'v'::"char"
       OR procedure.prokind IS DISTINCT FROM 'f'::"char"
       OR procedure.proretset
       OR procedure.prorettype IS DISTINCT FROM 'void'::pg_catalog.regtype
       OR procedure.prolang IS DISTINCT FROM (
         SELECT language.oid
         FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'plpgsql'
       )
       OR procedure.proconfig IS DISTINCT FROM
            ARRAY['search_path=""']::text[]
       OR pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(procedure.prosrc, 'UTF8')
            ),
            'hex'
          ) IS DISTINCT FROM expected.source_sha256
       OR EXISTS (
         WITH expected_acl(grantee, is_grantable) AS (
           VALUES ('privacy_workflow_owner'::name, false)
         ), actual_acl(grantee, is_grantable) AS (
           SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
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
         SELECT 1 FROM (
           (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
           UNION ALL
           (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
         ) AS difference
       )
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_g014_assertion_drift';
  END IF;


  FOREACH v_signature IN ARRAY ARRAY[
    'public.read_public_profile_summaries(uuid[])',
    'public.read_public_profile_leaderboard(text,integer)',
    'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
    'public.update_current_profile_nickname(text)',
    'public.compare_and_set_current_profile_avatar(text,uuid)',
    'public.read_signup_profile_state(uuid,text)'
  ]::text[] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = v_oid
         AND (
           procedure.proowner IS DISTINCT FROM
             'privacy_workflow_owner'::pg_catalog.regrole
           OR procedure.prosecdef IS DISTINCT FROM true
           OR procedure.proleakproof
           OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
           OR procedure.prokind IS DISTINCT FROM 'f'::"char"
           OR procedure.proretset IS DISTINCT FROM
             (v_signature LIKE 'public.read_public_profile_%')
           OR procedure.prorettype IS DISTINCT FROM CASE
             WHEN v_signature LIKE 'public.read_public_profile_%'
               THEN 'record'::pg_catalog.regtype
             ELSE 'jsonb'::pg_catalog.regtype
           END
           OR procedure.provolatile IS DISTINCT FROM CASE
             WHEN v_signature IN (
               'public.update_current_profile_nickname(text)',
               'public.compare_and_set_current_profile_avatar(text,uuid)'
             ) THEN 'v'::"char"
             ELSE 's'::"char"
           END
           OR procedure.prolang IS DISTINCT FROM (
             SELECT language.oid
             FROM pg_catalog.pg_language AS language
             WHERE language.lanname = 'plpgsql'
           )
           OR procedure.proconfig IS DISTINCT FROM
             ARRAY['search_path=""']::text[]
           OR pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8')
             ),
             'hex'
           ) IS DISTINCT FROM CASE v_signature
             WHEN 'public.read_public_profile_summaries(uuid[])' THEN
               '4cb8958c9c9324fcd16aa9264fdebf6ef4e5e91493770ddf10d4c5c91d2e79f7'
             WHEN 'public.read_public_profile_leaderboard(text,integer)' THEN
               '23197c61bc37e7ba8366a3b6d99ea30f47812b520bcc0eaeb6712e54ea85a87e'
             WHEN 'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)' THEN
               'e8a132569e5ea419609003fdbeb2dcad6c8233d35584e850954e1d4488a62d19'
             WHEN 'public.update_current_profile_nickname(text)' THEN
               'b64bf274daa16ce4d53b7845c39697e22c9d01cae1c5e95ed4f43a45f7a46c44'
             WHEN 'public.compare_and_set_current_profile_avatar(text,uuid)' THEN
               'd03a55a5187ec6a6fe38bdc6a2992ec6ac5448b3c573d241b754682f106f78ec'
             WHEN 'public.read_signup_profile_state(uuid,text)' THEN
               '7d8317d463ac7f79361b6944b326968c254522fb350f6004c2f74acb72a9762d'
           END
         )
    ) THEN
      RAISE EXCEPTION 'hosted_profile_contract_function_metadata_drift';
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.read_public_profile_summaries(uuid[])',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'anon',
       'public.read_public_profile_summaries(uuid[])',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.update_current_profile_nickname(text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated',
       'public.compare_and_set_current_profile_avatar(text,uuid)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.read_signup_profile_state(uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_signup_profile_state(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(function_oid, grantee, is_grantable) AS (
      VALUES
        (
          'public.read_public_profile_summaries(uuid[])'::pg_catalog.regprocedure::oid,
          'anon'::name,
          false
        ),
        (
          'public.read_public_profile_summaries(uuid[])'::pg_catalog.regprocedure::oid,
          'authenticated'::name,
          false
        ),
        (
          'public.read_public_profile_leaderboard(text,integer)'::pg_catalog.regprocedure::oid,
          'anon'::name,
          false
        ),
        (
          'public.read_public_profile_leaderboard(text,integer)'::pg_catalog.regprocedure::oid,
          'authenticated'::name,
          false
        ),
        (
          'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::pg_catalog.regprocedure::oid,
          'anon'::name,
          false
        ),
        (
          'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::pg_catalog.regprocedure::oid,
          'authenticated'::name,
          false
        ),
        (
          'public.update_current_profile_nickname(text)'::pg_catalog.regprocedure::oid,
          'authenticated'::name,
          false
        ),
        (
          'public.compare_and_set_current_profile_avatar(text,uuid)'::pg_catalog.regprocedure::oid,
          'authenticated'::name,
          false
        ),
        (
          'public.read_signup_profile_state(uuid,text)'::pg_catalog.regprocedure::oid,
          'service_role'::name,
          false
        )
    ), actual AS (
      SELECT
        procedure.oid AS function_oid,
        CASE
          WHEN acl.grantee = 0 THEN 'PUBLIC'::name
          ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name
        END AS grantee,
        acl.is_grantable
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE procedure.oid IN (
         'public.read_public_profile_summaries(uuid[])'::pg_catalog.regprocedure,
         'public.read_public_profile_leaderboard(text,integer)'::pg_catalog.regprocedure,
         'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::pg_catalog.regprocedure,
         'public.update_current_profile_nickname(text)'::pg_catalog.regprocedure,
         'public.compare_and_set_current_profile_avatar(text,uuid)'::pg_catalog.regprocedure,
         'public.read_signup_profile_state(uuid,text)'::pg_catalog.regprocedure
       )
         AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee <> procedure.proowner
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(source_signature, grantee) AS (
      VALUES
        ('public.read_public_profile_summaries(uuid[])', 'anon'::name),
        ('public.read_public_profile_summaries(uuid[])', 'authenticated'::name),
        ('public.read_public_profile_leaderboard(text,integer)', 'anon'::name),
        ('public.read_public_profile_leaderboard(text,integer)', 'authenticated'::name),
        (
          'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
          'anon'::name
        ),
        (
          'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
          'authenticated'::name
        ),
        ('public.update_current_profile_nickname(text)', 'authenticated'::name),
        (
          'public.compare_and_set_current_profile_avatar(text,uuid)',
          'authenticated'::name
        ),
        ('public.read_signup_profile_state(uuid,text)', 'service_role'::name)
    ), actual AS (
      SELECT allowed.source_signature, allowed.grantee
        FROM privacy_retention.g014_public_rpc_allowlist AS allowed
       WHERE allowed.source_signature IN (
         'public.read_public_profile_summaries(uuid[])',
         'public.read_public_profile_leaderboard(text,integer)',
         'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
         'public.update_current_profile_nickname(text)',
         'public.compare_and_set_current_profile_avatar(text,uuid)',
         'public.read_signup_profile_state(uuid,text)'
       )
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_allowlist_drift';
  END IF;

  IF pg_catalog.to_regclass('public.profiles_active_nickname_key') IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
          AND constraint_row.conname = 'profiles_avatar_url_octet_length_check'
          AND constraint_row.contype = 'c'::"char"
          AND constraint_row.convalidated
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
          AND trigger_row.tgname = 'on_auth_user_created'
          AND trigger_row.tgfoid =
            'public.handle_new_user()'::pg_catalog.regprocedure
          AND trigger_row.tgtype = 5::smallint
          AND trigger_row.tgenabled = 'O'::"char"
          AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_structural_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = 'public.handle_new_user()'::pg_catalog.regprocedure
       AND (
         procedure.proowner IS DISTINCT FROM 'postgres'::pg_catalog.regrole
         OR procedure.prorettype IS DISTINCT FROM 'trigger'::pg_catalog.regtype
         OR procedure.proretset
         OR procedure.prokind IS DISTINCT FROM 'f'::"char"
         OR procedure.proleakproof
         OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
         OR procedure.prosecdef IS DISTINCT FROM true
         OR procedure.proconfig IS DISTINCT FROM
           ARRAY['search_path=""']::text[]
         OR procedure.provolatile IS DISTINCT FROM 'v'::"char"
         OR procedure.prolang IS DISTINCT FROM (
           SELECT language.oid
           FROM pg_catalog.pg_language AS language
           WHERE language.lanname = 'plpgsql'
         )
         OR pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8')
           ),
           'hex'
         ) IS DISTINCT FROM
           'de6b6688eefa025cfee0babdc4d12e1cd8b7c580810ab9c2f3be0270e85a86ea'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) AS acl
     WHERE procedure.oid = 'public.handle_new_user()'::pg_catalog.regprocedure
       AND acl.privilege_type = 'EXECUTE'
       AND acl.grantee <> procedure.proowner
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_signup_trigger_acl_drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public.user_stats'::pg_catalog.regclass
       AND relation.relkind = 'r'::"char"
       AND relation.relowner = 'postgres'::pg_catalog.regrole
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_user_stats_rls_drift';
  END IF;

  IF EXISTS (
    WITH expected(grantee, privilege_type, is_grantable) AS (
      VALUES
        ('anon'::name, 'SELECT'::text, false),
        ('authenticated'::name, 'SELECT'::text, false),
        ('postgres'::name, 'DELETE'::text, false),
        ('postgres'::name, 'INSERT'::text, false),
        ('postgres'::name, 'MAINTAIN'::text, false),
        ('postgres'::name, 'REFERENCES'::text, false),
        ('postgres'::name, 'SELECT'::text, false),
        ('postgres'::name, 'TRIGGER'::text, false),
        ('postgres'::name, 'TRUNCATE'::text, false),
        ('postgres'::name, 'UPDATE'::text, false),
        ('privacy_workflow_owner'::name, 'DELETE'::text, false),
        ('privacy_workflow_owner'::name, 'SELECT'::text, false),
        ('service_role'::name, 'DELETE'::text, false),
        ('service_role'::name, 'INSERT'::text, false),
        ('service_role'::name, 'MAINTAIN'::text, false),
        ('service_role'::name, 'REFERENCES'::text, false),
        ('service_role'::name, 'SELECT'::text, false),
        ('service_role'::name, 'TRIGGER'::text, false),
        ('service_role'::name, 'TRUNCATE'::text, false),
        ('service_role'::name, 'UPDATE'::text, false)
    ), actual AS (
      SELECT
        CASE
          WHEN acl.grantee = 0 THEN 'PUBLIC'::name
          ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name
        END AS grantee,
        acl.privilege_type,
        acl.is_grantable
        FROM pg_catalog.pg_class AS relation
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            relation.relacl,
            pg_catalog.acldefault('r', relation.relowner)
          )
       ) AS acl
       WHERE relation.oid = 'public.user_stats'::pg_catalog.regclass
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_user_stats_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(
      policy_name,
      command,
      role_names,
      using_expression,
      check_expression,
      permissive
    ) AS (
      VALUES
        (
          'User stats are viewable by everyone'::name,
          'r'::"char",
          ARRAY['PUBLIC'::name],
          'true'::text,
          NULL::text,
          true
        ),
        (
          'g014_account_deletion_source_access'::name,
          '*'::"char",
          ARRAY['privacy_workflow_owner'::name],
          'true'::text,
          'true'::text,
          true
        ),
        (
          'g014_privacy_workflow_owner_access'::name,
          'r'::"char",
          ARRAY['privacy_workflow_owner'::name],
          'true'::text,
          NULL::text,
          true
        )
    ), actual AS (
      SELECT
        policy.polname AS policy_name,
        policy.polcmd AS command,
        ARRAY(
          SELECT CASE
            WHEN role_oid = 0 THEN 'PUBLIC'::name
            ELSE pg_catalog.pg_get_userbyid(role_oid)::name
          END
            FROM pg_catalog.unnest(policy.polroles) AS role_oid
           ORDER BY 1
        )::name[] AS role_names,
        pg_catalog.pg_get_expr(
          policy.polqual, policy.polrelid, false
        ) AS using_expression,
        pg_catalog.pg_get_expr(
          policy.polwithcheck, policy.polrelid, false
        ) AS check_expression,
        policy.polpermissive AS permissive
        FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.user_stats'::pg_catalog.regclass
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_profile_contract_user_stats_policy_drift';
  END IF;

  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  PERFORM privacy_retention.assert_g014_catalog_contract();
END
$hosted_profile_contract$;

ROLLBACK;
