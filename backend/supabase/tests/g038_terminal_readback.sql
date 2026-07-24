-- Exact G038 terminal delta readback.  This statement is read-only and returns one row.
WITH
private_schema AS (
  SELECT n.oid, n.nspowner,
         pg_catalog.pg_get_userbyid(n.nspowner) AS owner_name,
         n.nspacl
  FROM pg_catalog.pg_namespace AS n
  WHERE n.nspname = 'account_deletion_private'
),
schema_acl_expected(grantor_name, grantee_name, privilege_type, is_grantable) AS (
  VALUES
    ('privacy_workflow_owner', 'privacy_workflow_owner', 'CREATE', false),
    ('privacy_workflow_owner', 'privacy_workflow_owner', 'USAGE', false)
),
schema_acl_actual AS (
  SELECT grantor.rolname AS grantor_name,
         grantee.rolname AS grantee_name,
         acl.privilege_type, acl.is_grantable
  FROM private_schema AS n
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
  ) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
),
private_table AS (
  SELECT c.oid, c.relowner, pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
         c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class AS c
  JOIN private_schema AS n ON n.oid = c.relnamespace
  WHERE c.relname = 'reauth_proofs' AND c.relkind = 'r'
),
column_rows AS (
  SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name,
         a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
  FROM private_table AS t
  JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
  LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
),
constraint_rows AS (
  SELECT c.conname, c.contype
  FROM private_table AS t
  JOIN pg_catalog.pg_constraint AS c ON c.conrelid = t.oid
),
policy_rows AS (
  SELECT p.polname, p.polcmd, p.polpermissive,
         ARRAY(
           SELECT COALESCE(r.rolname, 'PUBLIC')
           FROM pg_catalog.unnest(p.polroles) AS role_oid(oid)
           LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = role_oid.oid
           ORDER BY 1
         ) AS roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
  FROM pg_catalog.pg_policy AS p
  JOIN private_table AS t ON t.oid = p.polrelid
),
index_rows AS (
  SELECT i.relname, x.indisprimary, x.indisunique,
         pg_catalog.pg_get_indexdef(i.oid) AS definition
  FROM pg_catalog.pg_index AS x
  JOIN private_table AS t ON t.oid = x.indrelid
  JOIN pg_catalog.pg_class AS i ON i.oid = x.indexrelid
),
private_acl AS (
  SELECT COALESCE(grantor.rolname, 'PUBLIC') AS grantor_name,
         COALESCE(grantee.rolname, 'PUBLIC') AS grantee_name,
         acl.privilege_type, acl.is_grantable
  FROM private_table AS t
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE((SELECT c.relacl FROM pg_catalog.pg_class AS c WHERE c.oid = t.oid),
             pg_catalog.acldefault('r', t.relowner))
  ) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
),
function_expected(signature, grantor, grantee) AS (
  VALUES
    ('public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)', 'privacy_workflow_owner', 'privacy_workflow_owner'),
    ('public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)', 'postgres', 'service_role'),
    ('public.read_current_account_deletion_status(uuid,text,text)', 'privacy_workflow_owner', 'privacy_workflow_owner'),
    ('public.read_current_account_deletion_status(uuid,text,text)', 'postgres', 'authenticated'),
    ('public.issue_account_deletion_reauth_proof(uuid)', 'privacy_workflow_owner', 'privacy_workflow_owner'),
    ('public.issue_account_deletion_reauth_proof(uuid)', 'postgres', 'authenticated'),
    ('public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text)', 'privacy_workflow_owner', 'privacy_workflow_owner'),
    ('public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'privacy_workflow_owner', 'privacy_workflow_owner'),
    ('public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'postgres', 'authenticated')
),
function_oids AS (
  SELECT e.signature, pg_catalog.to_regprocedure(e.signature) AS oid
  FROM (SELECT DISTINCT signature FROM function_expected) AS e
),
function_actual AS (
  SELECT f.signature, COALESCE(grantor.rolname, 'PUBLIC') AS grantor,
         COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
         acl.privilege_type, acl.is_grantable
  FROM function_oids AS f
  JOIN pg_catalog.pg_proc AS p ON p.oid = f.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
),
terminal_membership_expected(role_name, member_name, grantor_name, admin_option, inherit_option, set_option) AS (
  VALUES
    ('privacy_workflow_owner', 'postgres', 'supabase_admin', true, false, false),
    ('privacy_retention_operator_approver', 'postgres', 'supabase_admin', true, false, false),
    ('privacy_retention_legal_approver', 'postgres', 'supabase_admin', true, false, false),
    ('privacy_retention_activation_operator', 'postgres', 'supabase_admin', true, false, false)
),
terminal_membership_actual AS (
  SELECT role.rolname, member.rolname, grantor.rolname,
         membership.admin_option, membership.inherit_option, membership.set_option
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
  JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
  WHERE role.rolname IN (
    'privacy_workflow_owner', 'privacy_retention_operator_approver',
    'privacy_retention_legal_approver', 'privacy_retention_activation_operator'
  ) OR member.rolname IN (
    'privacy_workflow_owner', 'privacy_retention_operator_approver',
    'privacy_retention_legal_approver', 'privacy_retention_activation_operator'
  )
)
SELECT
  (SELECT count(*) = 1 AND min(owner_name) = 'privacy_workflow_owner' FROM private_schema) AS schema_exact,
  (SELECT NOT EXISTS (SELECT * FROM schema_acl_expected EXCEPT SELECT * FROM schema_acl_actual)
          AND NOT EXISTS (SELECT * FROM schema_acl_actual EXCEPT SELECT * FROM schema_acl_expected)) AS schema_acl_exact,
  (SELECT count(*) = 1 AND min(owner_name) = 'privacy_workflow_owner'
          AND bool_and(relrowsecurity AND relforcerowsecurity) FROM private_table)
    AND (SELECT count(*) = 10
          AND string_agg(attname || ':' || type_name || ':' || attnotnull::text, ',' ORDER BY attname) =
          'actor_user_id:uuid:true,consumed_at:timestamp with time zone:false,expires_at:timestamp with time zone:true,idempotency_key:text:false,issued_at:timestamp with time zone:true,password_reauthenticated_at:timestamp with time zone:true,proof_id:uuid:true,request_id:uuid:false,session_id:uuid:true,target_user_id:uuid:true'
          AND count(*) FILTER (WHERE attname = 'proof_id' AND default_expression = 'gen_random_uuid()') = 1
          AND count(*) FILTER (WHERE attname = 'issued_at' AND default_expression = 'clock_timestamp()') = 1
          AND count(*) FILTER (WHERE attname NOT IN ('proof_id', 'issued_at') AND default_expression IS NOT NULL) = 0
         FROM column_rows)
    AND (SELECT count(*) = 4
          AND string_agg(conname || ':' || contype::text, ',' ORDER BY conname) =
          'reauth_proofs_consumption_metadata_check:c,reauth_proofs_expiry_check:c,reauth_proofs_pkey:p,reauth_proofs_self_target_check:c'
         FROM constraint_rows) AS table_exact,
  (SELECT count(*) = 7 AND bool_and(grantor_name = 'privacy_workflow_owner'
          AND grantee_name = 'privacy_workflow_owner' AND NOT is_grantable)
          AND array_agg(privilege_type ORDER BY privilege_type) =
              ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
     FROM private_acl) AS table_acl_exact,
  (SELECT count(*) = 1 AND bool_and(polname = 'g028_reauth_proof_owner_access'
          AND polcmd = '*' AND polpermissive AND roles = ARRAY['privacy_workflow_owner']
          AND qual = 'true' AND with_check = 'true') FROM policy_rows) AS policies_exact,
  (SELECT count(*) = 2
          AND count(*) FILTER (WHERE relname = 'reauth_proofs_pkey' AND indisprimary AND indisunique) = 1
          AND count(*) FILTER (WHERE relname = 'reauth_proofs_expiry_idx' AND NOT indisprimary
              AND NOT indisunique AND definition ~ ' USING btree \(expires_at\)$') = 1
     FROM index_rows) AS indices_exact,
  (SELECT count(*) = 5 AND count(oid) = 5 FROM function_oids) AS rpc_overloads_exact,
  (SELECT count(*) = 5 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('apply_account_deletion_database_cleanup',
       'read_current_account_deletion_status','issue_account_deletion_reauth_proof',
       'consume_account_deletion_reauth_proof','begin_account_deletion_apply_with_reauth')) AS rpc_set_exact,
  NOT EXISTS (
    SELECT 1 FROM function_oids AS f JOIN pg_catalog.pg_proc AS p ON p.oid=f.oid
    WHERE pg_catalog.pg_get_userbyid(p.proowner) <> 'privacy_workflow_owner'
       OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  ) AS rpc_owner_search_path_exact,
  (SELECT NOT EXISTS ((SELECT signature, grantor, grantee FROM function_expected)
                       EXCEPT (SELECT signature, grantor, grantee FROM function_actual WHERE privilege_type='EXECUTE' AND NOT is_grantable))
          AND NOT EXISTS ((SELECT signature, grantor, grantee FROM function_actual WHERE privilege_type='EXECUTE' AND NOT is_grantable)
                          EXCEPT (SELECT signature, grantor, grantee FROM function_expected))
          AND NOT EXISTS (SELECT 1 FROM function_actual
                          WHERE privilege_type <> 'EXECUTE' OR is_grantable)) AS rpc_acl_exact,
  pg_catalog.to_regprocedure('public.read_current_account_deletion_status(uuid,text,text,text)') IS NULL AS old_status_overload_absent,
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
    WHERE role.rolname = 'privacy_workflow_owner'
      AND member.rolname = 'postgres'
      AND grantor.rolname = 'postgres'
  ) AS transient_membership_absent,
  (SELECT NOT EXISTS (SELECT * FROM terminal_membership_expected EXCEPT SELECT * FROM terminal_membership_actual)
          AND NOT EXISTS (SELECT * FROM terminal_membership_actual EXCEPT SELECT * FROM terminal_membership_expected))
    AS terminal_memberships_exact,
  (SELECT count(*) = 0 FROM account_deletion_private.reauth_proofs) AS reauth_proofs_empty_exact;
