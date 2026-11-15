"""Source-bound prerequisites for the isolated home KPI RPC fixture.

The new RPC, registration transaction, full allowlist/definer validators and
catalog's actual public-RPC loop execute as real PostgreSQL code. Legacy private
helpers below provide metadata identities only; their business bodies are never
called. The full G014 relation/policy/manifest graph is not reproduced here.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from backend.supabase.tests import test_service_invoker_contract as previous

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
MIGRATION = MIGRATIONS / "20261115074830_home_youtube_kpi_metrics.sql"
PREIMAGES = Path(__file__).with_name("fixtures") / "home_kpi_g014_preimages_20261115.json"
BEHAVIOR = Path(__file__).with_name("home_youtube_kpi_rpc.sql")
ARCHIVE_BEHAVIOR = Path(__file__).with_name("home_youtube_kpi_archive_trigger.sql")
ARCHIVE_SOURCE = MIGRATIONS / "20261013093518_storyboard_gemini_execution_v1.sql"
ARCHIVE_SOURCE_SHA256 = "84d351dead86ef90040b6949fe4a6dc93eb91a783c1b7a78531c7f564ea4ff4e"
ARCHIVE_BODY_SHA256 = "a0c1789c2fc116c6b07a1d40e4c1aba0a0e3eec49602e34a4c70f8f74487adf9"
ARCHIVE_RELATIONS = ["projects", "jobs", "assets", "events", "revisions", "restores"]
PREIMAGE_HASHES = {
    "assert_g014_definer_contract": "e879e3d3083f969cee5968b4064703bd7cc8227cc78e1950c78b06a8a0e5ddfa",
    "assert_g014_catalog_contract": "ef150f03928a8dfaeaa4365558408afe38454786f3965863219ba879b0d3ca05",
    "assert_g014_public_rpc_allowlist": "f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef",
}
CANONICAL_HASHES = {
    "assert_g014_definer_contract": "0f952ddc2eed4f592a5809cbb3371a1531c206b4152c34f3dca44f603e0c3e25",
    "assert_g014_catalog_contract": "2321fb4ecf9c7857b400ca2face09875bbd00852c54860b758c636106834069c",
}
CANONICAL_INPUTS = [
    "20260713002400_g014_retention_adapters_receipts.sql",
    "20260713002500_g014_catalog_contract.sql",
    "20260804000500_g041_auth_workflow_bridge.sql",
    "20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql",
    "20260812000600_local_profile_read_boundary_convergence.sql",
    "20260812000700_local_profile_leaderboard_page_convergence.sql",
    "20260813085342_current_profile_mutation_boundary.sql",
    "20261003113923_g014_service_invoker_contract.sql",
    "20261003172126_restaurant_review_manual_invoker_contract.sql",
    "20261003220841_admin_evaluation_page_invoker_contract.sql",
    "20261004050600_admin_evaluation_warning_invoker_contract.sql",
    "20261004194715_admin_evaluation_raw_warning_invoker_contract.sql",
    "20261103171649_restaurant_evidence_recovery.sql",
]


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def body(definition: str) -> str:
    match = re.search(r"AS \$(\w*)\$(.*)\$\1\$", definition, re.S)
    if not match:
        raise ValueError("HOME_KPI_FIXTURE_DEFINITION")
    return match.group(2)


def hosted_definitions() -> dict[str, str]:
    document = json.loads(PREIMAGES.read_text())
    functions = document["functions"]
    if document["schemaVersion"] != 1 or set(functions) != set(PREIMAGE_HASHES):
        raise ValueError("HOME_KPI_FIXTURE_PREIMAGE")
    for name, item in functions.items():
        if (item["bodySha256"] != PREIMAGE_HASHES[name]
                or digest(body(item["definition"])) != PREIMAGE_HASHES[name]
                or item["owner"] != "privacy_workflow_owner"
                or item["securityDefiner"] is not True
                or item["config"] != ['search_path=""']
                or item["acl"] != "{privacy_workflow_owner=X/privacy_workflow_owner}"):
            raise ValueError("HOME_KPI_FIXTURE_PREIMAGE")
    return {name: item["definition"] for name, item in functions.items()}


def canonical_definitions() -> dict[str, str]:
    """Reproduce the existing recovery fixture's admitted canonical variant."""
    result = hosted_definitions()
    base = previous.MIGRATION.read_text()
    recovery = (MIGRATIONS / CANONICAL_INPUTS[-1]).read_text()
    for name, definition in previous.definitions()[0].items():
        source = previous.tagged(definition, "function")
        anchor = previous.tagged(base, name + "_anchor")
        source = previous.replace_exact(source, anchor, previous.tagged(base, name + "_addition") + anchor)
        for filename in CANONICAL_INPUTS[8:11]:
            patch = (MIGRATIONS / filename).read_text()
            addition = previous.tagged(patch, "signature" if "manual" in filename else "addition")
            anchor = previous.tagged(patch, "anchor")
            source = previous.replace_exact(source, anchor, addition + anchor)
            if "manual" in filename:
                anchor = previous.tagged(patch, name + "_lock")
                source = previous.replace_exact(source, anchor, anchor.replace(previous.tagged(patch, "tick"), previous.tagged(patch, "manual")))
        patch = (MIGRATIONS / CANONICAL_INPUTS[11]).read_text()
        for tag in ["record_addition", "addition"]:
            anchor = previous.tagged(patch, "anchor")
            source = previous.replace_exact(source, anchor, previous.tagged(patch, tag) + anchor)
        anchor = "    IF " + ("v_signature" if name == "definer" else "v_expected.source_signature") + " IN (\n      'public.match_storyboard_documents_hybrid"
        addition = previous.tagged(recovery, "recovery_invoker")
        if name == "catalog":
            addition = addition.replace("v_signature", "v_expected.source_signature").replace("v_oid", "v_procedure")
        source = previous.replace_exact(source, anchor, addition + anchor)
        key = "assert_g014_" + name + "_contract"
        if digest(source) != CANONICAL_HASHES[key]:
            raise ValueError("HOME_KPI_FIXTURE_CANONICAL")
        result[key] = definition.replace(previous.tagged(definition, "function"), source)
    return result


def expected_patched_body(definition: str, name: str) -> str:
    source = body(definition)
    addition = previous.tagged(MIGRATION.read_text(), "home_kpi_invoker")
    if name == "assert_g014_catalog_contract":
        addition = addition.replace("v_signature", "v_expected.source_signature").replace("v_oid", "v_procedure")
    anchor = "    IF " + ("v_signature" if name == "assert_g014_definer_contract" else "v_expected.source_signature") + " IN (\n      'public.match_storyboard_documents_hybrid"
    return previous.replace_exact(source, anchor, addition + anchor)


def archive_source_sql() -> str:
    """Use the exact applied trigger body/bindings, also matched to hosted SHA."""
    source = ARCHIVE_SOURCE.read_text()
    if (digest(source) != ARCHIVE_SOURCE_SHA256
            or digest(previous.tagged(source, "storyboard_archive_guard")) != ARCHIVE_BODY_SHA256):
        raise ValueError("HOME_KPI_FIXTURE_ARCHIVE_SOURCE")
    start = source.index("CREATE FUNCTION public.storyboard_production_reject_archived_write()")
    end = source.index("DO $storyboard_gemini_admin$", start)
    return source[start:end]


def setup_database_sql(definitions: dict[str, str], *, archive_execute_drift: bool = True) -> str:
    statements = ["""
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
REVOKE ALL ON SCHEMA privacy_retention FROM PUBLIC, anon, authenticated, service_role;
-- Hosted postgres already has effective USAGE through an existing role.
-- Reproduce that minimum name-resolution right without CREATE, owner SET or
-- EXECUTE on any private validator in this isolated synthetic database.
GRANT USAGE ON SCHEMA privacy_retention TO postgres;
GRANT USAGE ON SCHEMA public TO privacy_workflow_owner, privacy_auth_bridge, service_role, anon, authenticated;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist (
  function_schema name NOT NULL, function_name name NOT NULL,
  identity_arguments text NOT NULL, grantee name NOT NULL, source_signature text NOT NULL,
  PRIMARY KEY(function_schema,function_name,identity_arguments,grantee),
  UNIQUE(source_signature,grantee), CHECK(grantee IN ('anon','authenticated','service_role'))
);
ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON privacy_retention.g014_public_rpc_allowlist
  FOR ALL TO privacy_workflow_owner USING(true) WITH CHECK(true);
CREATE TABLE privacy_retention.privacy_retention_runs(id uuid);
CREATE TABLE public.admin_storyboard_production_projects(id uuid PRIMARY KEY, request jsonb NOT NULL);
CREATE TABLE public.youtube_video_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL, channel_id text NOT NULL,
  title text NOT NULL DEFAULT '제목 없음', published_at timestamptz, category_id text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
  view_count bigint NOT NULL DEFAULT 0 CHECK(view_count >= 0),
  like_count bigint NOT NULL DEFAULT 0 CHECK(like_count >= 0),
  comment_count bigint NOT NULL DEFAULT 0 CHECK(comment_count >= 0),
  bucket_started_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT timezone('utc',now()),
  source text NOT NULL DEFAULT 'youtube-data-api', UNIQUE(video_id,bucket_started_at)
);
ALTER TABLE public.youtube_video_kpi_snapshots OWNER TO postgres;
ALTER TABLE public.youtube_video_kpi_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.youtube_video_kpi_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.youtube_video_kpi_snapshots TO service_role;
CREATE INDEX youtube_video_kpi_snapshots_latest_idx ON public.youtube_video_kpi_snapshots(bucket_started_at DESC,published_at DESC);
CREATE INDEX youtube_video_kpi_snapshots_bucket_views_idx ON public.youtube_video_kpi_snapshots(bucket_started_at DESC,view_count DESC,video_id);
CREATE INDEX youtube_video_kpi_snapshots_video_idx ON public.youtube_video_kpi_snapshots(video_id,bucket_started_at DESC);
CREATE INDEX youtube_video_kpi_snapshots_channel_idx ON public.youtube_video_kpi_snapshots(channel_id,bucket_started_at DESC);
"""]
    # Only fields read by the real installed guard are modeled. Seed archived
    # and active rows before installing its six exact source-bound triggers.
    statements.append("INSERT INTO public.admin_storyboard_production_projects VALUES "
                      "('00000000-0000-0000-0000-000000000001','{\"workflow\":\"storyboard-mlx-v1\"}'),"
                      "('00000000-0000-0000-0000-000000000002','{\"workflow\":\"storyboard-gemini-v1\"}');")
    for suffix in ARCHIVE_RELATIONS:
        relation = "public.admin_storyboard_production_" + suffix
        if suffix != "projects":
            statements.append("CREATE TABLE " + relation + " (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES public.admin_storyboard_production_projects(id));"
                              "INSERT INTO " + relation + " VALUES "
                              "('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),"
                              "('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');")
        statements.append("ALTER TABLE " + relation + " OWNER TO postgres; ALTER TABLE " + relation
                          + " ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON " + relation + " TO service_role;")
    extra = body(definitions["assert_g014_definer_contract"]).split("UNION ALL VALUES", 1)[1].split("  LOOP", 1)[0]
    for signature in re.findall(r"'([^']+)'", extra):
        # Metadata-only private identities; no callable fixture business mocks.
        owner = "privacy_auth_bridge" if "append_audit" in signature else "privacy_workflow_owner"
        statements.append("CREATE FUNCTION " + signature + " RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT true'; ALTER FUNCTION " + signature + " OWNER TO " + owner + "; REVOKE ALL ON FUNCTION " + signature + " FROM PUBLIC,anon,authenticated,service_role;")
    for name, definition in definitions.items():
        statements.append(definition.rstrip(";\n") + "; ALTER FUNCTION privacy_retention." + name + "() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention." + name + "() FROM PUBLIC,anon,authenticated,service_role;")
    statements.append("SET ROLE privacy_workflow_owner; SELECT privacy_retention.assert_g014_public_rpc_allowlist(); SELECT privacy_retention.assert_g014_definer_contract(); RESET ROLE;")
    statements.append("SET ROLE postgres;\n" + archive_source_sql())
    if not archive_execute_drift:
        statements.append("REVOKE EXECUTE ON FUNCTION public.storyboard_production_reject_archived_write() FROM service_role;")
    statements.append("RESET ROLE;")
    return "\n".join(statements)


def catalog_loop_sql(definition: str) -> str:
    source = body(definition)
    start = source.index("  FOR v_expected IN\n    SELECT allowed.source_signature")
    end = source.index("  END LOOP;", start) + len("  END LOOP;")
    return ("SET ROLE privacy_workflow_owner; DO $home_kpi_catalog_loop$ DECLARE "
            "v_expected record; v_procedure oid; v_search_path text; v_is_definer boolean; BEGIN "
            + source[start:end] + " END; $home_kpi_catalog_loop$; RESET ROLE;")


STATE_SQL = """
SELECT jsonb_build_object(
  'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m),
  'validators',(SELECT jsonb_object_agg(proname,to_jsonb(p)) FROM pg_proc p
    WHERE p.oid IN ('privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure)),
  'registry',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_signature,grantee),'[]')
    FROM privacy_retention.g014_public_rpc_allowlist r),
  'table',(SELECT jsonb_build_object('acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity,'owner',relowner)
    FROM pg_class WHERE oid='public.youtube_video_kpi_snapshots'::regclass),
  'schema',(SELECT jsonb_build_object('acl',nspacl,'owner',nspowner)
    FROM pg_namespace WHERE nspname='privacy_retention'),
  'migrationSchemaAccess',jsonb_build_array(has_schema_privilege('postgres','privacy_retention','USAGE'),
    has_schema_privilege('postgres','privacy_retention','CREATE')),
  'columns',(SELECT jsonb_agg(jsonb_build_array(attname,attacl) ORDER BY attnum) FROM pg_attribute
    WHERE attrelid='public.youtube_video_kpi_snapshots'::regclass AND attnum>0 AND NOT attisdropped),
  'rpc',(SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_home_youtube_kpi_metrics(text[])')),
  'archiveGuard',(SELECT to_jsonb(p) FROM pg_proc p
    WHERE p.oid='public.storyboard_production_reject_archived_write()'::regprocedure),
  'archiveRoleExecute',jsonb_build_object(
    'anon',has_function_privilege('anon','public.storyboard_production_reject_archived_write()','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.storyboard_production_reject_archived_write()','EXECUTE'),
    'service_role',has_function_privilege('service_role','public.storyboard_production_reject_archived_write()','EXECUTE')),
  'archiveTriggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tgrelid,tgname) FROM pg_trigger t
    WHERE tgfoid='public.storyboard_production_reject_archived_write()'::regprocedure),
  'archiveDependencies',(SELECT jsonb_agg(to_jsonb(d) ORDER BY classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
    FROM pg_depend d WHERE (classid='pg_proc'::regclass AND objid='public.storyboard_production_reject_archived_write()'::regprocedure)
      OR (refclassid='pg_proc'::regclass AND refobjid='public.storyboard_production_reject_archived_write()'::regprocedure)),
  'archiveRelations',(SELECT jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl,
    'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN (
      'admin_storyboard_production_projects','admin_storyboard_production_jobs','admin_storyboard_production_assets',
      'admin_storyboard_production_events','admin_storyboard_production_revisions','admin_storyboard_production_restores')),
  'archiveRows',(SELECT jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value->>'id') FROM (
    SELECT 'projects' name,to_jsonb(r) value FROM public.admin_storyboard_production_projects r UNION ALL
    SELECT 'jobs',to_jsonb(r) FROM public.admin_storyboard_production_jobs r UNION ALL
    SELECT 'assets',to_jsonb(r) FROM public.admin_storyboard_production_assets r UNION ALL
    SELECT 'events',to_jsonb(r) FROM public.admin_storyboard_production_events r UNION ALL
    SELECT 'revisions',to_jsonb(r) FROM public.admin_storyboard_production_revisions r UNION ALL
    SELECT 'restores',to_jsonb(r) FROM public.admin_storyboard_production_restores r) archive_state_rows),
  'effectiveOwnerAccess',jsonb_build_array(pg_has_role('postgres','privacy_workflow_owner','SET'),
    pg_has_role('postgres','privacy_workflow_owner','USAGE'))
);
"""
