"""Immutable, fail-closed contract for the G037 hosted closure executor."""
from __future__ import annotations
import base64, hashlib, json, re, time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MANIFEST_RELATIVE_PATH = ".github/g034-hosted-migration-closure.v1.json"
MANIFEST_SHA256 = "1c81fd4fa4e6cd7a843241e8eb419a24bb9c329e6ab5a2c2f9d9acf1dd4ddf5c"
MODES = frozenset(("validate", "preflight", "readback", "runtime-probe", "reconciliation-readback"))
SELF_WRAPPING = ("20260712000400", "20260713002400")
FORBIDDEN_VERSIONS = frozenset(("20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002500", "20260713002600", "20260713002700"))
# A public key is intentionally embedded; no private material is accepted by this contract.
AUTHORIZATION_SCHEMA = "g037-hosted-closure-authorization-v1"
AUTHORIZATION_PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAZccE77vdHuSmTLuFobhH+JR3KQEWpf9x1z+BuVFSzpI=\n-----END PUBLIC KEY-----\n"
AUTHORIZATION_PUBLIC_KEY_SHA256 = "a9fd31ab443aea51d0f71ec63603c4cd46cdcc343b6b50df48f47902cbf95491"
BASELINE_PAIRS = (
    ("20251219","db_performance_optimization"),("20260118","create_ocr_logs"),
    ("20260425","allow_ocr_logs_user_insert"),("20260506065538","optimize_auth_user_state_indexes"),
    ("20260506085634","optimize_app_query_indexes"),("20260509000100","drop_server_costs"),
    ("20260509000200","drop_admin_ai_settings"),("20260523093000","create_restaurant_popular_rank_snapshots"),
    ("20260525143908","create_youtube_kpi_snapshots"),("20260526083932","add_youtube_channel_growth_snapshot_deltas"),
    ("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"),
)
# PostgreSQL 17 hosted CREATEROLE protocol.  Every source mutation is an
# ordered, source-pinned byte replacement; the ledger retains original vectors.
MANAGED_ROLES = (
    "privacy_workflow_owner",
    "privacy_retention_operator_approver",
    "privacy_retention_legal_approver",
    "privacy_retention_activation_operator",
)
ROLE_FLAGS = (False, False, False, False, False, False, False)
# role, member, grantor, admin_option, inherit_option, set_option
TRANSIENT_MANAGED_ROWS = (
    ("privacy_workflow_owner", "postgres", "postgres", False, True, True),
    ("privacy_workflow_owner", "postgres", "supabase_admin", True, False, False),
    ("privacy_retention_operator_approver", "postgres", "supabase_admin", True, False, False),
    ("privacy_retention_legal_approver", "postgres", "supabase_admin", True, False, False),
    ("privacy_retention_activation_operator", "postgres", "supabase_admin", True, False, False),
)
TERMINAL_MANAGED_ROWS = TRANSIENT_MANAGED_ROWS[1:]
# The only admissible hosted policy prestate besides absence.
DOCUMENTS_POLICY_COMPATIBILITY_VERSION = "20260627080000"
DOCUMENTS_POLICY_COMPATIBILITY_PRESTATE = (
    ("documents_delete_own", "DELETE", ("PUBLIC",), True, "(auth.uid() = user_id)", None),
    ("documents_insert_own", "INSERT", ("PUBLIC",), True, None, "(auth.uid() = user_id)"),
    ("documents_select_own", "SELECT", ("PUBLIC",), True, "(auth.uid() = user_id)", None),
    ("documents_update_own", "UPDATE", ("PUBLIC",), True, "(auth.uid() = user_id)", "(auth.uid() = user_id)"),
)
ROLE_PROTOCOL_VERSION = "g037-pg17-hosted-createrole-splice-v4"

_WORKFLOW_OWNER_SQL = b"""DO $g037_workflow_owner$
DECLARE
  v_expected boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'privacy_workflow_owner') THEN
    RAISE EXCEPTION 'privacy_workflow_owner must be absent before G037 create';
  END IF;
  CREATE ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  SELECT NOT EXISTS (
           (SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option
              FROM pg_catalog.pg_auth_members
             WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)
           EXCEPT ALL
           (VALUES ('privacy_workflow_owner','postgres','supabase_admin',true,false,false))
         )
     AND NOT EXISTS (
           (VALUES ('privacy_workflow_owner','postgres','supabase_admin',true,false,false))
           EXCEPT ALL
           (SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option
              FROM pg_catalog.pg_auth_members
             WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)
         )
     AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)=1
    INTO v_expected;
  IF NOT v_expected THEN RAISE EXCEPTION 'automatic workflow-owner membership drift'; END IF;
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
  GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) <> 2
     OR EXISTS ((SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)
               EXCEPT ALL
               (VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false)))
     OR EXISTS ((VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false))
               EXCEPT ALL
               (SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin) THEN
    RAISE EXCEPTION 'workflow-owner self-grant contract drift';
  END IF;
END;
$g037_workflow_owner$;"""
_WORKFLOW_SCHEMA_SQL = b"""DO $g037_workflow_schema$
BEGIN
  IF pg_catalog.to_regnamespace('privacy_retention') IS NULL
     OR (SELECT pg_catalog.pg_get_userbyid(nspowner)
         FROM pg_catalog.pg_namespace
         WHERE nspname='privacy_retention') NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'privacy_retention schema creation precondition drift';
  END IF;
  ALTER SCHEMA privacy_retention OWNER TO privacy_workflow_owner;
  IF (SELECT pg_catalog.pg_get_userbyid(nspowner)
      FROM pg_catalog.pg_namespace
      WHERE nspname='privacy_retention') IS DISTINCT FROM 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'privacy_retention schema owner postcondition drift';
  END IF;
END;
$g037_workflow_schema$;"""

_RETENTION_ROLES_SQL = b"""DO $g037_retention_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver'::name,'privacy_retention_legal_approver'::name,'privacy_retention_activation_operator'::name])) THEN
    RAISE EXCEPTION 'G014 retention roles must all be absent before create';
  END IF;

  CREATE ROLE privacy_retention_operator_approver NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  CREATE ROLE privacy_retention_legal_approver NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  CREATE ROLE privacy_retention_activation_operator NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']) OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))) <> 3
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']) AND (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolcanlogin))
     OR EXISTS ((SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option FROM pg_catalog.pg_auth_members WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator'])) OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator'])))
               EXCEPT ALL
               (VALUES ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false)))
     OR EXISTS ((VALUES ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false))
               EXCEPT ALL
               (SELECT roleid::regrole::text, member::regrole::text, grantor::regrole::text, admin_option, inherit_option, set_option FROM pg_catalog.pg_auth_members WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator'])) OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator'])))) THEN
    RAISE EXCEPTION 'automatic retention role membership drift';
  END IF;
END;
$g037_retention_roles$;"""

_ROLE_02000_SQL = b"""DO $g037_inflight_owner$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) <> 2
     OR EXISTS ((SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) EXCEPT ALL (VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false)))
     OR EXISTS ((VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false)) EXCEPT ALL (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)) THEN
    RAISE EXCEPTION 'workflow-owner in-flight contract drift';
  END IF;
END;
$g037_inflight_owner$;"""
_SCHEMA_OWNER_ASSERTION_SQL = b"""DO $g037_schema$
BEGIN
  IF (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname='privacy_retention') IS DISTINCT FROM 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'privacy_retention schema owner drift';
  END IF;
END;
$g037_schema$;"""
_TERMINAL_WORKFLOW_ASSERTION_SQL = b"""CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) <> 1
     OR EXISTS ((SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) EXCEPT ALL (VALUES ('privacy_workflow_owner','postgres','supabase_admin',true,false,false)))
     OR EXISTS ((VALUES ('privacy_workflow_owner','postgres','supabase_admin',true,false,false)) EXCEPT ALL (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)) THEN
    RAISE EXCEPTION 'workflow-owner terminal contract drift';
  END IF;
END;
$function$;"""
_INFLIGHT_WORKFLOW_ASSERTION_SQL = b"""  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) <> 2
     OR EXISTS ((SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole) EXCEPT ALL (VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false)))
     OR EXISTS ((VALUES ('privacy_workflow_owner','postgres','postgres',false,true,true),('privacy_workflow_owner','postgres','supabase_admin',true,false,false)) EXCEPT ALL (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)) THEN
    RAISE EXCEPTION 'workflow-owner in-flight contract drift';
  END IF;"""

# Immutable source-pinned literal records for the executor preflight verifier.
ROLE_SPLICES = (
    {"label": '00450-role', "version": '20260713000450', "old": b"DO $role$\nDECLARE\n  v_role record;\nBEGIN\n  SELECT role_row.oid,\n         role_row.rolsuper,\n         role_row.rolinherit,\n         role_row.rolcreaterole,\n         role_row.rolcreatedb,\n         role_row.rolreplication,\n         role_row.rolbypassrls,\n         role_row.rolcanlogin\n    INTO v_role\n    FROM pg_catalog.pg_roles AS role_row\n   WHERE role_row.rolname = 'privacy_workflow_owner';\n\n  IF NOT FOUND THEN\n    EXECUTE 'CREATE ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';\n  ELSIF v_role.rolsuper\n     OR v_role.rolinherit\n     OR v_role.rolcreaterole\n     OR v_role.rolcreatedb\n     OR v_role.rolreplication\n     OR v_role.rolbypassrls\n     OR v_role.rolcanlogin\n     OR EXISTS (\n       SELECT 1\n         FROM pg_catalog.pg_auth_members AS membership\n        WHERE membership.member = v_role.oid\n           OR membership.roleid = v_role.oid\n     ) THEN\n    RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';\n  END IF;\n\n  EXECUTE 'ALTER ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';\nEND;\n$role$;", "new": _WORKFLOW_OWNER_SQL, "start": 177, "end": 1331, "old_sha256": 'ae10ec3a522a2dad1397dc1cb6b1623acdb8b745e7e52d82bb461725170d2a4b', "new_sha256": '189673c68526e028c804d98298bb6410c51342c417019a0b9e5a0541e39c7257'},
    {"label": '00450-schema', "version": '20260713000450', "old": b'CREATE SCHEMA IF NOT EXISTS privacy_retention;', "new": _WORKFLOW_SCHEMA_SQL, "start": 1333, "end": 1379, "old_sha256": '1bd3d4ad35ada6c9299b292f44c84742ffebc6d9aa3c2247e6688321d12fee36', "new_sha256": 'd2629d0fc094b7b75170525e30bb5b345ae48f56339a595f5b503792330ec762'},
    {"label": '02000-role', "version": '20260713002000', "old": b"DO $role$\nDECLARE\n  v_role record;\nBEGIN\n  SELECT role_row.oid,\n         role_row.rolsuper,\n         role_row.rolinherit,\n         role_row.rolcreaterole,\n         role_row.rolcreatedb,\n         role_row.rolreplication,\n         role_row.rolbypassrls,\n         role_row.rolcanlogin\n  INTO v_role\n  FROM pg_catalog.pg_roles AS role_row\n  WHERE role_row.rolname = 'privacy_workflow_owner';\n\n  IF NOT FOUND THEN\n    EXECUTE 'CREATE ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';\n  ELSE\n    IF v_role.rolsuper\n       OR v_role.rolinherit\n       OR v_role.rolcreaterole\n       OR v_role.rolcreatedb\n       OR v_role.rolreplication\n       OR v_role.rolbypassrls\n       OR v_role.rolcanlogin THEN\n      RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';\n    END IF;\n\n    IF EXISTS (\n      SELECT 1\n      FROM pg_catalog.pg_auth_members AS membership\n      WHERE membership.member = v_role.oid\n         OR membership.roleid = v_role.oid\n    ) THEN\n      RAISE EXCEPTION 'privacy_workflow_owner has unexpected role membership or effective access';\n    END IF;\n  END IF;\n\n  EXECUTE 'ALTER ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';\nEND;\n$role$;", "new": _ROLE_02000_SQL, "start": 204, "end": 1492, "old_sha256": '722c208dcc6b50ae1eae9bca8386f3da6a843fdfeb42ec599b4357eded687e84', "new_sha256": '0df33b8a8cc87673d3d6c3bcbcc0eab6c17c967a44f33b416eede8e929068df5'},
    {"label": '02000-schema-pair', "version": '20260713002000', "old": b'CREATE SCHEMA IF NOT EXISTS privacy_retention;\nALTER SCHEMA privacy_retention OWNER TO privacy_workflow_owner;', "new": _SCHEMA_OWNER_ASSERTION_SQL, "start": 1494, "end": 1604, "old_sha256": '5dec71c0bb6729698a174817afe9326871dcc97bc1d0531f0a37074463901765', "new_sha256": 'ec74d291a3093a661d1856c0ef6472f57ca705f4f09612c4784f4fc46bea7844'},
    {"label": '02000-full-assertion-definition', "version": '20260713002000', "old": b"CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract()\nRETURNS void\nLANGUAGE plpgsql\nSET search_path = ''\nAS $function$\nDECLARE\n  v_role record;\nBEGIN\n  SELECT role_row.oid,\n         role_row.rolsuper,\n         role_row.rolinherit,\n         role_row.rolcreaterole,\n         role_row.rolcreatedb,\n         role_row.rolreplication,\n         role_row.rolbypassrls,\n         role_row.rolcanlogin\n  INTO v_role\n  FROM pg_catalog.pg_roles AS role_row\n  WHERE role_row.rolname = 'privacy_workflow_owner';\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'privacy_workflow_owner is missing';\n  END IF;\n  IF v_role.rolsuper\n     OR v_role.rolinherit\n     OR v_role.rolcreaterole\n     OR v_role.rolcreatedb\n     OR v_role.rolreplication\n     OR v_role.rolbypassrls\n     OR v_role.rolcanlogin THEN\n    RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';\n  END IF;\n  IF EXISTS (\n    SELECT 1\n    FROM pg_catalog.pg_auth_members AS membership\n    WHERE membership.member = v_role.oid\n       OR membership.roleid = v_role.oid\n  ) THEN\n    RAISE EXCEPTION 'privacy_workflow_owner has unexpected role membership or effective access';\n  END IF;\nEND;\n$function$;", "new": _TERMINAL_WORKFLOW_ASSERTION_SQL, "start": 4192, "end": 5379, "old_sha256": '50c4da47bb3f57203ca7bb95ab6d644833c12a98f8f5f84d87a4c50414c3bf9a', "new_sha256": 'ee3641f846a2459db7dcbf6391249ba9223c15172e3da1dab7b432facf1f8003'},
    {"label": '02000-in-flight-invocation', "version": '20260713002000', "old": b'  PERFORM privacy_retention.assert_g014_workflow_owner_contract();', "new": _INFLIGHT_WORKFLOW_ASSERTION_SQL, "start": 91459, "end": 91525, "old_sha256": '087e6706906fc0c0059fa68ddf0ae11ee1c235bfb2cba9ebd846dad441c21ea9', "new_sha256": '1ff662f7dbb0daf1c5a8f58430a3ae6657857766dcc7a4abe6b13a06c8138902'},
    {"label": '02400-role-block', "version": '20260713002400', "old": b"DO $g014_retention_approval_roles$\nDECLARE\n  v_role name;\nBEGIN\n  FOREACH v_role IN ARRAY ARRAY[\n    'privacy_retention_operator_approver'::name,\n    'privacy_retention_legal_approver'::name,\n    'privacy_retention_activation_operator'::name\n  ] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = v_role) THEN\n      EXECUTE pg_catalog.format(\n        'CREATE ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS',\n        v_role\n      );\n    ELSIF EXISTS (\n      SELECT 1\n      FROM pg_catalog.pg_roles AS role_row\n      WHERE role_row.rolname = v_role\n        AND (role_row.rolsuper OR role_row.rolreplication OR role_row.rolbypassrls)\n    ) THEN\n      RAISE EXCEPTION 'G014 retention approval role % has a privileged immutable attribute', v_role;\n    END IF;\n    EXECUTE pg_catalog.format(\n      'ALTER ROLE %I NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN',\n      v_role\n    );\n  END LOOP;\n\n  IF pg_catalog.pg_has_role('service_role', 'privacy_retention_operator_approver', 'member')\n     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_legal_approver', 'member')\n     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_activation_operator', 'member') THEN\n    RAISE EXCEPTION 'service_role cannot hold a G014 retention approval capability';\n  END IF;\nEND;\n$g014_retention_approval_roles$;", "new": _RETENTION_ROLES_SQL, "start": 10317, "end": 11707, "old_sha256": '93afc29f3cf6dc761318c940b86bacd62e66a359e439dd68317c48579610042c', "new_sha256": '55a7aa55e5d86f19345b94d84e313caa897992f41babdda13ff29e07d96c7a0a'},
)
ROLE_SPLICE_GROUPS = (
    {"version": '20260713000450', "source_sha256": 'f5d513aba329b3b1a6e12a76d8947f43c247257a379500d7ed5a45486f1c364a', "transformed_source_sha256": '7d888d55b95d4cb4bc45ed1afa47497043a78328920cd459b20028f969f3dafc', "original_vector_sha256": '24d10cdb1f74b3eaeee84f107f72ef92fccbfa080e6d872a52519cd1e3d108fe', "transformed_vector_sha256": '7a1dd216698644a7abde379d7cdfd29ac32cad95499b5af740dea46fc5f10c83'},
    {"version": '20260713002000', "source_sha256": 'b3bea6e4f4b1649d3f7eebd719386473a22534551cbff5f69cafc3a05844c6f9', "transformed_source_sha256": '937cc2e6170ea68eef2d6f4a5eeeab237de8f34e99e697c6681e9ffc55a368a5', "original_vector_sha256": '146a20c432cde5b3900f751d73f3dd6ef194542b415202998d13b92aa1e07a31', "transformed_vector_sha256": '2dfad4aada594530a41a6388ae5cb6a4af41b24daad32005cccda04325d4438e'},
    {"version": '20260713002400', "source_sha256": '3b89edc7ffe96a770d1f537267546c6229c823fc3c2d9b4c036ff008ca7c0b94', "transformed_source_sha256": '7fcd0eab337541c595e593f3a88e4662bdb246eddb8ee16b25b78c5ba797c491', "original_vector_sha256": 'dc72dca4154077e2e1c69ea9f85ca5a0e0d105af121daf1cca5f0253dcd162ad', "transformed_vector_sha256": 'db5701da7853d448b0c342ae2275496dc0825e42b4441b404e294bc3f26c8c6b'},
)
ROLE_PROTOCOL_EPILOGUE = b"""DO $g037_epilogue$
BEGIN
  IF EXISTS (
       (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option
          FROM pg_catalog.pg_auth_members
         WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
            OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
       )
       EXCEPT ALL
       (VALUES
         ('privacy_workflow_owner','postgres','postgres',false,true,true),
         ('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
         ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false)
       )
     )
     OR EXISTS (
       (VALUES
         ('privacy_workflow_owner','postgres','postgres',false,true,true),
         ('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
         ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false)
       )
       EXCEPT ALL
       (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option
          FROM pg_catalog.pg_auth_members
         WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
            OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
       )
     ) THEN
    RAISE EXCEPTION 'transient managed-role membership drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid='privacy_retention.assert_g014_workflow_owner_contract()'::pg_catalog.regprocedure AND n.nspname='privacy_retention' AND pg_catalog.pg_get_userbyid(p.proowner)='privacy_workflow_owner' AND l.lanname='plpgsql' AND NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'] AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='538264bd59607f4b2dcd1c4f4600f63a7961f4d9c761c975319e3a7804b56399') THEN
    RAISE EXCEPTION 'workflow-owner terminal assertion catalog drift';
  END IF;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres RESTRICT;
  IF EXISTS (
       (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option
          FROM pg_catalog.pg_auth_members
         WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
            OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
       )
       EXCEPT ALL
       (VALUES
         ('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
         ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false)
       )
     )
     OR EXISTS (
       (VALUES
         ('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
         ('privacy_retention_operator_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_legal_approver','postgres','supabase_admin',true,false,false),
         ('privacy_retention_activation_operator','postgres','supabase_admin',true,false,false)
       )
       EXCEPT ALL
       (SELECT roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option,inherit_option,set_option
          FROM pg_catalog.pg_auth_members
         WHERE roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
            OR member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY (ARRAY['privacy_workflow_owner','privacy_retention_operator_approver','privacy_retention_legal_approver','privacy_retention_activation_operator']))
       )
     ) THEN
    RAISE EXCEPTION 'terminal managed-role membership drift';
  END IF;
END;
$g037_epilogue$;"""
ROLE_PROTOCOL_EPILOGUE_SHA256 = "498505246f63b4130afeb089cb7b77532c23e31edf16c09ca1a4393479cc55b8"
ROLE_PROTOCOL_EPILOGUE_VECTOR_SHA256 = "e35114d17655152d87ecbe0a40b10162b9868a12df8cf67c8a0b3e759c27a3fd"

# The terminal allowlist is a deterministic composition of literal immutable
# source fragments.  It is deliberately not a snapshot of hosted state.
G014_RPC_ALLOWLIST_VERSION = "20260801000300"
G014_RPC_ALLOWLIST_FRAGMENTS = (
    ("20260713002000", "base", 22620, 30545, "cdcb24d308f8ebe8c3b7ab37e483fe2e9faf846d2814181aa52ee71ca9d13352"),
    ("20260713002100", "add", 71537, 72885, "3de6a2e37df45a6f0197d021e8c852c58540d8fc934e3119b60777e64744409f"),
    ("20260713002200", "add", 111451, 112094, "458c06ea8666b3184cc005da6a1220c36736bdade6652114c9d27f50a4899c5d"),
    ("20260713002300", "replace-account", 155888, 157982, "15930f6e2350b9114ac7690d575d5b2199b71721ea4aca4cc623303bbf1b9010"),
    ("20260713002300", "replace-external", 223520, 225247, "43958cd0c1019c9bd068ed2b999973fb88e8a31acad1fac1e9eaae5235c3d59a"),
    ("20260713002300", "add-claim", 300106, 300657, "15d968016ccd9220aefe0185aa6de46a7953cb4d5d9e8fa4ca34acf178c38b4d"),
    ("20260713002300", "add-status", 305066, 305638, "c1d2e32caca9df1e5428ddd492b8d0b3a43451c6e8e17de4b2a8662241ecf718"),
    ("20260713002400", "replace-retention", 151492, 153625, "0f9d37d62dd7b66a719894f4f8c2482c2213411dbadf491cdddaf6f4a1727a08"),
    ("20260801000300", "replace-confirm", 1, 959, "49180e710d99c1f828dcb205497d1c86a1989d431d112ac507886193bfa79b3f"),
)
G014_RPC_ALLOWLIST_SOURCES = (
    ("20260713002000", "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql", "b3bea6e4f4b1649d3f7eebd719386473a22534551cbff5f69cafc3a05844c6f9"),
    ("20260713002100", "backend/supabase/migrations/20260713002100_g014_privacy_workflows.sql", "0a06618bf56e426f3bfa671aa42b94195fa52fb50ccc6e3a4986f2c718336848"),
    ("20260713002200", "backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql", "a041f88d781ef50bfdf59feee2af3f09bc02fc64714fe335861ed5e7d99694a3"),
    ("20260713002300", "backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql", "6705f42b16cc3c9e5d25d5f9afebffc4be377c442aa0b90b737e22b333d0b36d"),
    ("20260713002400", "backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql", "3b89edc7ffe96a770d1f537267546c6229c823fc3c2d9b4c036ff008ca7c0b94"),
    ("20260801000300", "backend/supabase/migrations/20260801000300_g016_onboarding_allowlist_freshness.sql", "30a184ccaba1dc6c7d6798010381a38b8141ded441ad643628baeb21270d7c82"),
)
BASELINE_RPC_MATRIX = (
    ('public.approve_submission_item(uuid,uuid,jsonb)', 'authenticated'),
    ('public.approve_submission_item(uuid,uuid,jsonb)', 'service_role'),
    ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'authenticated'),
    ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'service_role'),
    ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'authenticated'),
    ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'service_role'),
    ('public.make_user_admin(text)', 'service_role'),
    ('public.batch_insert_restaurants_from_jsonl(jsonb[])', 'service_role'),
    ('public.insert_restaurant_from_jsonl(jsonb)', 'service_role'),
    ('public.refresh_materialized_views()', 'service_role'),
    ('public.cleanup_old_notifications(integer)', 'service_role'),
    ('public.approve_restaurant(uuid,uuid)', 'service_role'),
    ('public.reject_restaurant(uuid,uuid,text)', 'service_role'),
    ('public.approve_restaurant_submission(uuid,uuid)', 'service_role'),
    ('public.reject_restaurant_submission(uuid,uuid,text)', 'service_role'),
    ('public.approve_new_restaurant_submission(uuid,uuid,jsonb)', 'service_role'),
    ('public.approve_edit_restaurant_submission(uuid,uuid,uuid[])', 'service_role'),
    ('public.reject_submission(uuid,uuid,text)', 'service_role'),
    ('public.reject_submission_item(uuid,uuid,text)', 'service_role'),
    ('public.apply_admin_user_db_mutation(uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text)', 'service_role'),
    ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'),
    ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'),
    ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'),
    ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'),
    ('public.review_restaurant_request(uuid,uuid,text,text,text)', 'service_role'),
    ('public.delete_pending_restaurant_submission(uuid,uuid,text)', 'service_role'),
    ('public.submit_restaurant_submission(uuid,text,text,text,text,text,text[],text,text)', 'service_role'),
    ('public.apply_restaurant_admin_destructive_action(uuid,text,text,uuid[],uuid,jsonb)', 'service_role'),
    ('public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)', 'service_role'),
    ('public.claim_admin_trend_job_request(text,interval)', 'service_role'),
    ('public.complete_admin_trend_job_request(uuid,text,uuid,jsonb)', 'service_role'),
    ('public.fail_admin_trend_job_request(uuid,text,text,jsonb)', 'service_role'),
    ('public.review_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,uuid,text,text,jsonb)', 'service_role'),
    ('public.approve_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,text,jsonb,text,text,uuid,text,jsonb)', 'service_role'),
    ('public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)', 'service_role'),
    ('public.revoke_release_auth_session_family(uuid,uuid,uuid,text)', 'service_role'),
    ('public.read_release_auth_revocation(uuid,uuid,uuid)', 'service_role'),
    ('public.read_release_auth_revocation_by_operation(uuid)', 'anon'),
    ('public.read_release_auth_revocation_by_operation(uuid)', 'authenticated'),
    ('public.get_current_auth_session_id()', 'authenticated'),
    ('public.is_current_auth_session_active()', 'authenticated'),
    ('public.get_current_privacy_policy_version()', 'authenticated'),
    ('public.get_current_privacy_policy_version()', 'service_role'),
    ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)', 'service_role'),
    ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)', 'service_role'),
    ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'authenticated'),
    ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'),
    ('public.read_privacy_guardian_status(uuid)', 'service_role'),
    ('public.create_user_notification(uuid,text,text,text,jsonb)', 'authenticated'),
    ('public.mark_notification_read(uuid)', 'authenticated'),
    ('public.mark_all_notifications_read()', 'authenticated'),
    ('public.delete_notification(uuid)', 'authenticated'),
    ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)', 'service_role'),
    ('public.marketing_campaign_receipt(uuid)', 'service_role'),
    ('public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)', 'service_role'),
    ('public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)', 'service_role'),
    ('public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)', 'service_role'),
    ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])', 'service_role'),
    ('public.preview_account_deletion(uuid,uuid,timestamptz)', 'service_role'),
    ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)', 'service_role'),
    ('public.apply_account_deletion_database_cleanup(uuid,uuid)', 'service_role'),
    ('public.list_account_deletion_storage_objects(uuid,uuid)', 'service_role'),
    ('public.finalize_account_deletion_storage(uuid,uuid,boolean)', 'service_role'),
    ('public.finalize_account_deletion_auth(uuid,uuid,boolean)', 'service_role'),
    ('public.fail_account_deletion(uuid,uuid,text)', 'service_role'),
    ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'service_role'),
    ('public.confirm_privacy_retention_run(uuid,text,text,text)', 'service_role'),
    ('public.apply_privacy_retention_run(uuid,text,text,integer)', 'service_role'),
    ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)', 'service_role'),
    ('public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)', 'service_role'),
    ('public.finalize_privacy_retention_run(uuid,text,text)', 'service_role'),
    ('public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)', 'service_role'),
    ('public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)', 'service_role'),
    ('public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'service_role'),
    ('public.ocr_log_metadata_is_safe(jsonb)', 'service_role'),
    ('public.allocate_short_url(text,uuid,uuid,text,text[])', 'service_role'),
    ('public.get_ocr_daily_quota_status()', 'authenticated'),
    ('public.reserve_ocr_daily_quota(uuid)', 'authenticated'),
    ('public.reserve_admin_provider_budget(uuid,text,uuid)', 'service_role'),
    ('public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'),
)
BASELINE_RPC_MATRIX_SHA256 = "71129fbe994390a711ee262b7bf7ad3ed523afe4db8be563bc401d8c21111f22"
_ACCOUNT_INITIAL_NAMES = frozenset((
    "preview_account_deletion", "begin_account_deletion_apply",
    "apply_account_deletion_database_cleanup", "claim_account_deletion_external_phase",
    "list_account_deletion_storage_objects", "get_account_deletion_storage_work_items",
    "finalize_account_deletion_storage", "finalize_account_deletion_auth",
    "fail_account_deletion", "fail_account_deletion_external_phase",
    "publish_account_deletion_policy", "activate_account_deletion_policy",
))
_RETENTION_REPLACED_NAMES = frozenset((
    "activate_privacy_retention_adapter", "preview_privacy_retention_run",
    "confirm_privacy_retention_run", "apply_privacy_retention_run",
    "claim_privacy_retention_storage_items",
    "resolve_privacy_retention_provider_effect",
    "get_privacy_retention_provider_reconciliation_work",
    "ack_privacy_retention_storage_items", "finalize_privacy_retention_run",
))
_RPC_ADDITIONS = (
    ("public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)", "service_role"),
    ("public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)", "service_role"),
    ("public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)", "service_role"),
    ("public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)", "service_role"),
    ("public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)", "service_role"),
    ("public.get_current_privacy_eligibility()", "authenticated"),
    ("public.get_privacy_eligibility_for_user(uuid)", "service_role"),
    ("public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)", "service_role"),
    ("public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)", "service_role"),
    ("public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)", "service_role"),
    ("public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)", "service_role"),
    ("public.create_review_like_notification(uuid,uuid,uuid)", "service_role"),
    ("public.preview_account_deletion(uuid,uuid,timestamptz)", "service_role"),
    ("public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)", "service_role"),
    ("public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)", "service_role"),
    ("public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)", "service_role"),
    ("public.publish_account_deletion_policy(text,interval,interval,text,jsonb,text,text)", "service_role"),
    ("public.activate_account_deletion_policy(text,text)", "service_role"),
    ("public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)", "service_role"),
    ("public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)", "service_role"),
    ("public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)", "service_role"),
    ("public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)", "service_role"),
    ("public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)", "service_role"),
    ("public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)", "service_role"),
    ("public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)", "service_role"),
    ("public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)", "service_role"),
    ("public.claim_next_account_deletion_external_job()", "service_role"),
    ("public.read_current_account_deletion_status(uuid,text,text)", "authenticated"),
    ("public.preview_privacy_retention_run(text,timestamptz,integer,integer)", "service_role"),
    ("public.confirm_privacy_retention_run(uuid,text,text,text)", "service_role"),
    ("public.apply_privacy_retention_run(uuid,text,text,integer)", "service_role"),
    ("public.claim_privacy_retention_storage_items(uuid,text,text,integer)", "service_role"),
    ("public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)", "service_role"),
    ("public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)", "service_role"),
    ("public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)", "service_role"),
    ("public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text)", "service_role"),
    ("public.finalize_privacy_retention_run(uuid,text,text)", "service_role"),
)
def _rpc_name(row: tuple[str, str]) -> str:
    return row[0].split("(", 1)[0].rsplit(".", 1)[1]
def _without_names(rows: tuple[tuple[str, str], ...], names: frozenset[str]) -> tuple[tuple[str, str], ...]:
    return tuple(row for row in rows if _rpc_name(row) not in names)
_rpc_matrix_source = (
    _without_names(BASELINE_RPC_MATRIX, _ACCOUNT_INITIAL_NAMES | _RETENTION_REPLACED_NAMES)
    + _RPC_ADDITIONS
)
STATIC_RPC_MATRIX = (
    tuple(
        (signature, grantee)
        for signature, grantee in _rpc_matrix_source
        if signature != 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
    )
    + tuple(
        ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)', grantee)
        for signature, grantee in _rpc_matrix_source
        if signature == 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
    )
)
STATIC_RPC_MATRIX_SHA256 = "59b3d7d942241e70e24196251aef0dabfb999d986512a7d138e44cd2f57e490d"
CHECKPOINT_IDS = (
    "prelude-admission", "plan-prevalidated", "role-self-grant",
    "g013-vector-ledger", "g014-boundary-vector-ledger",
    "g014-retention-vector-ledger", "epilogue-transient-readback",
    "epilogue-revoke", "terminal-readback",
)
_VERSION = re.compile(r"^[0-9]{14}$"); _SHA = re.compile(r"^[a-f0-9]{64}$")
class ContractError(ValueError): pass

def no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result: raise ContractError("duplicate JSON object key")
        result[key] = value
    return result

def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
def digest(value: Any) -> str: return hashlib.sha256(canonical_bytes(value)).hexdigest()
def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024), b""): h.update(block)
    return h.hexdigest()
@dataclass(frozen=True)
class Migration: version:str; name:str; path:str; sha256:str
@dataclass(frozen=True)
class Manifest: migrations:tuple[Migration,...]; excluded_versions:frozenset[str]; ledger_terminal_version:str; closure_terminal_version:str

def repository_root(start: Path) -> Path:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate/MANIFEST_RELATIVE_PATH).is_file(): return candidate
    raise ContractError("repository root not found")
def load_manifest(root: Path) -> Manifest:
    path=root/MANIFEST_RELATIVE_PATH
    if path.is_symlink() or not path.is_file(): raise ContractError("manifest must be regular")
    try:
        raw=path.read_bytes().replace(b"\r\n",b"\n")
        if b"\r" in raw or hashlib.sha256(raw).hexdigest()!=MANIFEST_SHA256: raise ContractError("manifest hash mismatch")
        data=json.loads(raw, object_pairs_hook=no_duplicate_object)
    except (OSError,json.JSONDecodeError) as exc: raise ContractError("manifest unreadable") from exc
    rows=data.get("migrations"); excluded=data.get("excludedVersions")
    if not isinstance(data,dict) or data.get("schemaVersion")!=1 or not isinstance(rows,list) or len(rows)!=29 or not isinstance(excluded,list): raise ContractError("manifest inventory mismatch")
    entries=[]; seen=set(); previous=""
    for row in rows:
        if not isinstance(row,dict) or set(row)!={"version","name","path","sha256"}: raise ContractError("manifest fields mismatch")
        item=Migration(**row); expected=f"backend/supabase/migrations/{item.version}_{item.name}.sql"
        if not (_VERSION.fullmatch(item.version) and isinstance(item.name,str) and item.name and _SHA.fullmatch(item.sha256) and item.path==expected and item.version not in seen and item.version>previous and item.version not in FORBIDDEN_VERSIONS): raise ContractError("migration identity mismatch")
        entries.append(item); seen.add(item.version); previous=item.version
    forbidden=frozenset(excluded)
    if forbidden!=FORBIDDEN_VERSIONS or len(excluded)!=len(forbidden) or forbidden & seen: raise ContractError("excluded set mismatch")
    if data.get("ledgerTerminalVersion")!="20260531084516" or data.get("closureTerminalVersion")!="20260801000300": raise ContractError("terminal mismatch")
    return Manifest(tuple(entries),forbidden,data["ledgerTerminalVersion"],data["closureTerminalVersion"])
def validate_sources(root: Path) -> Manifest:
    manifest=load_manifest(root); directory=(root/"backend/supabase/migrations").resolve()
    for item in manifest.migrations:
        path=root/item.path
        if path.is_symlink() or not path.is_file() or path.resolve().parent!=directory or sha256_file(path)!=item.sha256: raise ContractError("migration source hash mismatch")
    return manifest
def expected_ledger(manifest: Manifest) -> tuple[tuple[str,str],...]:
    return tuple((item.version,item.name) for item in manifest.migrations)
def validate_ledger(manifest: Manifest, observed: Any) -> None:
    if not isinstance(observed,(list,tuple)) or tuple(tuple(x) for x in observed)!=expected_ledger(manifest): raise ContractError("ledger mismatch")
def terminal_spec(manifest: Manifest) -> str:
    """Return the single immutable authorization identity for G037 terminal state."""
    if not ROLE_SPLICES or not STATIC_RPC_MATRIX:
        raise ContractError("terminal specification requires complete pinned role splices and RPC matrix")
    return digest({
        "manifest": MANIFEST_SHA256,
        "migrations": [(item.version, item.sha256) for item in manifest.migrations],
        "managed_role_splices": tuple(
            (record["label"], record["version"], record["start"], record["end"],
             record["old_sha256"], record["new_sha256"])
            for record in ROLE_SPLICES
        ),
        "managed_role_splice_groups": tuple(
            (group["version"], group["source_sha256"], group["transformed_source_sha256"],
             group["original_vector_sha256"], group["transformed_vector_sha256"])
            for group in ROLE_SPLICE_GROUPS
        ),
        "g014_terminal": "20260713002400",
        "role_protocol": {
            "version": ROLE_PROTOCOL_VERSION,
            "roles": MANAGED_ROLES,
            "flags": ROLE_FLAGS,
            "transient_rows": TRANSIENT_MANAGED_ROWS,
            "terminal_rows": TERMINAL_MANAGED_ROWS,
            "epilogue_sha256": ROLE_PROTOCOL_EPILOGUE_SHA256,
            "documents_policy_compatibility": {
                "version": DOCUMENTS_POLICY_COMPATIBILITY_VERSION,
                "exact_prestate": DOCUMENTS_POLICY_COMPATIBILITY_PRESTATE,
            },
            "rpc_allowlist_version": G014_RPC_ALLOWLIST_VERSION,
            "rpc_allowlist_sources": G014_RPC_ALLOWLIST_SOURCES,
            "rpc_allowlist_fragments": G014_RPC_ALLOWLIST_FRAGMENTS,
            "rpc_matrix_sha256": STATIC_RPC_MATRIX_SHA256,
            "rpc_matrix": STATIC_RPC_MATRIX,
            "checkpoints": CHECKPOINT_IDS,
        },
    })
_FREEZE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{7,127}$")
_COMMIT = re.compile(r"^[a-f0-9]{40}$")
_FREEZE_ASSERTION_SCHEMA = "g037-write-freeze-assertion-v1"
_FREEZE_REQUEST_REQUIRED = frozenset((
    "schema", "freeze_id", "origin", "commit", "manifest_sha256",
    "relation_root", "acl_root", "source_root", "terminal_spec", "issued_at", "expires_at", "attestations",
))
_FREEZE_REQUIRED = _FREEZE_REQUEST_REQUIRED | {"signature"}
def validate_operator_assertion_request(
    value: Any, *, freeze_id: str, origin: str, relation_root: str, acl_root: str,
    commit: str | None = None, source_root: str | None = None, terminal_spec: str | None = None, now: int | None = None,
) -> None:
    """Verify the canonical unsigned operator request before offline signing."""
    if not isinstance(value,dict) or set(value)!=_FREEZE_REQUEST_REQUIRED:
        raise ContractError("freeze assertion request fields mismatch")
    if (not _FREEZE_ID.fullmatch(freeze_id) or value["schema"]!=_FREEZE_ASSERTION_SCHEMA
        or value["freeze_id"]!=freeze_id or value["origin"]!=origin
        or not _COMMIT.fullmatch(value["commit"]) or value["manifest_sha256"]!=MANIFEST_SHA256
        or value["relation_root"]!=relation_root or value["acl_root"]!=acl_root
        or (commit is not None and value["commit"]!=commit)
        or (source_root is not None and value.get("source_root")!=source_root)
        or (terminal_spec is not None and value.get("terminal_spec")!=terminal_spec)):
        raise ContractError("freeze assertion binding mismatch")
    issued, expires=value["issued_at"],value["expires_at"]; point=int(time.time()) if now is None else now
    if (not isinstance(issued,int) or isinstance(issued,bool) or not isinstance(expires,int)
        or isinstance(expires,bool) or issued>point+30 or issued<point-900
        or expires<=point or expires<=issued or expires-issued>1800):
        raise ContractError("freeze assertion stale")
    attest=value["attestations"]
    required={"no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write","producer_stop"}
    if not isinstance(attest,dict) or set(attest)!=required:
        raise ContractError("residual attestation absent")
    for channel in required:
        evidence=attest[channel]
        if (not isinstance(evidence,dict) or set(evidence)!={"status","evidence_sha256","observed_at"}
            or evidence["status"] is not True or not isinstance(evidence["observed_at"],int)
            or isinstance(evidence["observed_at"],bool) or not _SHA.fullmatch(evidence["evidence_sha256"])
            or evidence["observed_at"]>point+30 or evidence["observed_at"]<point-900
            or evidence["observed_at"]>issued):
            raise ContractError("residual attestation invalid")
def validate_operator_assertion(
    value: Any, *, freeze_id: str, origin: str, relation_root: str, acl_root: str,
    commit: str | None = None, source_root: str | None = None, terminal_spec: str | None = None, now: int | None = None,
) -> None:
    """Verify the signed source-pinned operator attestation."""
    if not isinstance(value,dict) or set(value)!=_FREEZE_REQUIRED:
        raise ContractError("freeze assertion fields mismatch")
    payload={k:v for k,v in value.items() if k!="signature"}
    validate_operator_assertion_request(payload,freeze_id=freeze_id,origin=origin,relation_root=relation_root,acl_root=acl_root,commit=commit,source_root=source_root,terminal_spec=terminal_spec,now=now)
    signature=value["signature"]
    if not isinstance(signature,str): raise ContractError("freeze assertion signature absent")
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(AUTHORIZATION_PUBLIC_KEY_PEM.encode()).verify(
            base64.b64decode(signature,validate=True), canonical_bytes(payload)
        )
    except Exception as exc:
        raise ContractError("freeze assertion signature invalid") from exc
