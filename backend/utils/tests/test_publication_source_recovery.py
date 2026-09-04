"""Read-only source contracts for the fail-closed publication recovery."""

from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ROUTE = ROOT / "apps/web/app/api/admin/publish-jobs/route.ts"
HELPER = ROOT / "apps/web/lib/admin-publish-jobs.ts"
WORKFLOW = ROOT / ".github/workflows/security-audit.yml"
PUBLICATION_SET = ROOT / "backend/deploy/publication-set.v1.json"
SCHEDULE = ROOT / "backend/deploy/publish-schedule.approved.json"
LOCAL_SCHEMA = ROOT / "backend/supabase/migrations/20260901000100_local_analytics_schema.sql"
PUBLICATION_RPCS = ROOT / "backend/supabase/migrations/20260901000200_pipeline_batch_upsert_publication_allowlist.sql"
ADAPTER = ROOT / "backend/pipeline_control/publication_adapter.py"
LOCAL_STACK = ROOT / "backend/supabase/scripts/local-stack.py"

PUBLICATION_MODULES = (
    "backend.bin.tests.test_publication_isolation_pbt",
    "backend.pipeline_control.test_publication_adapter_unittest",
    "backend.pipeline_control.test_publication_set_unittest",
    "backend.pipeline_control.test_publish_apply_unittest",
    "backend.pipeline_control.test_publish_batch_pbt",
    "backend.pipeline_control.test_publish_codes_pbt",
    "backend.pipeline_control.test_publish_hash_pbt",
    "backend.pipeline_control.test_publish_idempotency_pbt",
    "backend.pipeline_control.test_publish_payload_pbt",
    "backend.pipeline_control.test_publish_readback_pbt",
    "backend.pipeline_control.test_publish_schedule_unittest",
    "backend.pipeline_control.test_publish_worker_unittest",
    "backend.pipeline_control.tests.test_batch_upsert_publication_allowlist",
    "backend.supabase.tests.test_local_compose_inputs",
)


class PublicationSourceRecoveryTests(unittest.TestCase):
    def test_route_auth_and_local_gate_precede_body_and_client_work(self) -> None:
        source = ROUTE.read_text(encoding="utf-8")
        post = source[source.index("export async function POST"):source.index("export async function GET")]
        self.assertLess(post.index("requireAdmin()"), post.index("isTrustedSameOriginMutation(request)"))
        self.assertLess(post.index("isTrustedSameOriginMutation(request)"), post.index("isLocalPublishQueueAvailable()"))
        self.assertLess(post.index("isLocalPublishQueueAvailable()"), post.index("readBoundedJsonRequest"))
        self.assertLess(post.index("readBoundedJsonRequest"), post.index("createSupabaseServiceRoleClient()"))
        self.assertIn("const MAX_PUBLISH_JOB_REQUEST_BYTES = 4 * 1024", source)
        self.assertIn("response.headers.set('Cache-Control', 'no-store')", source)
        self.assertNotIn("PublishWorker", source)

    def test_queue_gate_and_row_projection_are_closed(self) -> None:
        source = HELPER.read_text(encoding="utf-8")
        # WHATWG URL.hostname retains brackets around an IPv6 literal.
        for exact in ("'localhost'", "'127.0.0.1'", "'[::1]'"):
            self.assertIn(exact, source)
        self.assertIn("TZUDONG_PUBLISH_QUEUE_ENABLED", source)
        self.assertIn("Object.keys(value).length !== 0", source)
        self.assertIn("PUBLISH_JOB_STATUSES.includes", source)
        self.assertIn("PUBLISH_JOB_RESULT_CODES.includes", source)
        self.assertIn("RFC3339_PATTERN.test(requestedAt)", source)
        self.assertIn("RFC3339_PATTERN.test(updatedAt)", source)

    def test_committed_approvals_remain_unresolved(self) -> None:
        publication_set = json.loads(PUBLICATION_SET.read_text(encoding="utf-8"))
        schedule = json.loads(SCHEDULE.read_text(encoding="utf-8"))
        for document in (publication_set, schedule):
            self.assertEqual(
                document["approval"],
                {"approverName": None, "approvedAt": None, "status": "unresolved"},
            )
        videos = next(table for table in publication_set["tables"] if table["table"] == "videos")
        self.assertEqual(videos["casKeyColumns"], ["id", "updated_at"])
        self.assertTrue({"youtube_link", "channel_name"}.issubset(videos["publishedColumns"]))

    def test_publication_migration_never_replaces_crawler_rpc(self) -> None:
        source = PUBLICATION_RPCS.read_text(encoding="utf-8")
        self.assertNotIn(
            "CREATE OR REPLACE FUNCTION pipeline_control.batch_upsert_restaurants",
            source,
        )
        self.assertIn("CREATE FUNCTION pipeline_control.publish_upsert_restaurants", source)
        self.assertIn("CREATE FUNCTION pipeline_control.publish_upsert_videos", source)
        self.assertIn("WHERE id = ANY", ADAPTER.read_text(encoding="utf-8"))
        self.assertNotIn("GRANT EXECUTE ON FUNCTION pipeline_control.publish_upsert", source)
        self.assertEqual(source.count("v_count > 200"), 2)
        self.assertEqual(source.count("SELECT privacy_retention.assert_g014_public_rpc_allowlist();"), 1)

    def test_adapter_is_inert_and_uses_only_fixed_sql_plans(self) -> None:
        source = ADAPTER.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported_roots = {
            alias.name.split(".", 1)[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported_roots.update(
            node.module.split(".", 1)[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        )
        self.assertTrue({"os", "psycopg2", "supabase"}.isdisjoint(imported_roots))
        self.assertNotIn("PIPELINE_CONTROL_DSN", source)
        self.assertNotIn("create_client", source)
        self.assertNotIn("connection()", source)
        self.assertNotIn("f\"SELECT", source)
        self.assertIn("SELECT pipeline_control.publish_upsert_restaurants(%s::jsonb)", source)
        self.assertIn("SELECT pipeline_control.publish_upsert_videos(%s::jsonb)", source)

    def test_local_schema_bounds_history_and_append_only_audit(self) -> None:
        source = LOCAL_SCHEMA.read_text(encoding="utf-8")
        self.assertIn("CHECK (status IN", source)
        self.assertIn("CHECK (stage IN ('preview', 'confirm', 'apply', 'readback'))", source)
        self.assertIn("preview_hash ~ '^[0-9a-f]{64}$'", source)
        self.assertIn("publish_history_counts_nonnegative", source)
        self.assertIn("row_count >= 0", source)
        self.assertIn(
            "REVOKE UPDATE, DELETE ON local_analytics.publish_audit_events",
            source,
        )
        self.assertNotIn("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA local_analytics TO anon", source)
        self.assertIn(
            "REVOKE ALL ON ALL TABLES IN SCHEMA local_analytics FROM PUBLIC, anon, authenticated",
            source,
        )

    def test_only_local_stack_exposes_queue_schema_to_postgrest(self) -> None:
        source = LOCAL_STACK.read_text(encoding="utf-8")
        self.assertIn(
            '"PGRST_DB_SCHEMAS": "public,storage,graphql_public,local_analytics"',
            source,
        )
        compose = (ROOT / "backend/supabase/docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS}", compose)

    def test_security_workflow_runs_every_publication_contract(self) -> None:
        source = WORKFLOW.read_text(encoding="utf-8")
        for module in PUBLICATION_MODULES:
            self.assertEqual(source.count(module), 1, module)
        self.assertIn(
            "bun test apps/web/tests-unit/publish-jobs-request-contract.test.ts",
            source,
        )
        for trigger in (
            "apps/web/app/api/admin/publish-jobs/**",
            "apps/web/lib/admin-publish-jobs.ts",
            "backend/supabase/migrations/20260901000100_local_analytics_schema.sql",
            "backend/supabase/migrations/20260901000200_pipeline_batch_upsert_publication_allowlist.sql",
            "backend/supabase/tests/test_local_compose_inputs.py",
        ):
            self.assertIn(trigger, source)
        self.assertNotIn("continue-on-error: true", source)


if __name__ == "__main__":
    unittest.main()
