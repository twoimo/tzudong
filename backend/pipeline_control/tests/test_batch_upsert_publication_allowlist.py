"""P2 follow-on (#16): server-side Publication_Set column allowlist on the
publication-only pipeline_control.publish_upsert_restaurants RPC.

These are source-contract tests over the NEW migration file. They assert that:
  * the allowlist migration is a new file (does not modify the immutable
    20260820040000_pipeline_batch_upsert.sql),
  * the allowlist contains exactly the Publication_Set published columns for
    public.restaurants plus the identity/CAS keys the insert/update logic uses,
  * excluded / non-published columns are not present in the allowlist,
  * the allowlist is enforced fail-closed (a non-admitted key raises the bounded
    batch_upsert_invalid code and no dynamic column list is built without the
    allowlist filter),
  * the crawler-owned batch_upsert_restaurants RPC is never replaced,
  * the CAS/readback semantics, REVOKE grants, and public RPC allowlist
    assertion are preserved,
  * the derivation matches backend/deploy/publication-set.v1.json.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
APPLIED = MIGRATIONS / "20260820040000_pipeline_batch_upsert.sql"
ALLOWLIST = MIGRATIONS / "20260901000200_pipeline_batch_upsert_publication_allowlist.sql"
PUBLICATION_SET = ROOT / "deploy" / "publication-set.v1.json"

# Publication_Set published columns for public.restaurants plus identity/CAS
# keys. Kept in sync with publication-set.v1.json and the migration allowlist.
IDENTITY_CAS_KEYS = {"id", "updated_at"}  # trace_id is already a published column
EXCLUDED_COLUMNS = {
    "created_by",
    "updated_by_admin_id",
    "review_count",
    "search_count",
    "weekly_search_count",
    "db_error_message",
    "db_error_details",
    "created_at",
}


def _published_columns() -> set[str]:
    data = json.loads(PUBLICATION_SET.read_text(encoding="utf-8"))
    for table in data["tables"]:
        if table["schema"] == "public" and table["table"] == "restaurants":
            return set(table["publishedColumns"])
    raise AssertionError("public.restaurants missing from publication-set.v1.json")


def _published_video_columns() -> set[str]:
    data = json.loads(PUBLICATION_SET.read_text(encoding="utf-8"))
    for table in data["tables"]:
        if table["schema"] == "public" and table["table"] == "videos":
            return set(table["publishedColumns"])
    raise AssertionError("public.videos missing from publication-set.v1.json")


class AllowlistMigrationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sql = ALLOWLIST.read_text(encoding="utf-8")

    def test_is_new_file_greater_than_immutable_source(self) -> None:
        self.assertTrue(ALLOWLIST.exists())
        self.assertTrue(APPLIED.exists())
        self.assertGreater(ALLOWLIST.name, "20260820040000_pipeline_batch_upsert.sql")
        # The applied migration and crawler-owned RPC are immutable; publication
        # receives a distinct narrow RPC rather than replacing that contract.
        self.assertIn("CREATE FUNCTION pipeline_control.publish_upsert_restaurants(p_rows jsonb)", self.sql)
        self.assertIn("CREATE FUNCTION pipeline_control.publish_upsert_videos(p_rows jsonb)", self.sql)
        self.assertNotIn(
            "CREATE OR REPLACE FUNCTION pipeline_control.batch_upsert_restaurants",
            self.sql,
        )

    def test_allowlist_contains_every_published_and_identity_column(self) -> None:
        published = _published_columns()
        self.assertEqual(len(published), 29)
        for column in published | IDENTITY_CAS_KEYS:
            self.assertIn(f"'{column}'", self.sql, f"allowlist missing admitted column {column}")

    def test_allowlist_excludes_non_published_columns(self) -> None:
        # Extract the ARRAY[...] allowlist literal and ensure excluded columns
        # are not quoted members of it.
        start = self.sql.index("v_allowed_columns constant text[] := ARRAY[")
        end = self.sql.index("];", start)
        literal = self.sql[start:end]
        for column in EXCLUDED_COLUMNS:
            self.assertNotIn(f"'{column}'", literal, f"excluded column {column} must not be in the allowlist")

    def test_non_admitted_column_is_fail_closed(self) -> None:
        # A payload key outside the allowlist is detected and rejected with the
        # bounded code before any write.
        self.assertIn("NOT (payload_key = ANY (v_allowed_columns))", self.sql)
        self.assertIn("IF v_bad_key IS NOT NULL THEN", self.sql)
        # The dynamic insert/update column lists are additionally filtered by the
        # allowlist so a non-admitted real column can never be written.
        self.assertEqual(self.sql.count("attribute.attname = ANY (v_allowed_columns)"), 4)

    def test_video_allowlist_includes_required_insert_columns(self) -> None:
        published = _published_video_columns()
        self.assertEqual(len(published), 10)
        self.assertEqual(
            {"youtube_link", "channel_name"} - published,
            set(),
            "required public.videos insert columns must be explicitly published",
        )
        video_start = self.sql.index("CREATE FUNCTION pipeline_control.publish_upsert_videos")
        video_sql = self.sql[video_start:]
        for column in published | {"id"}:
            self.assertIn(f"'{column}'", video_sql)
        self.assertIn("v_payload->>'youtube_link' IS NULL", video_sql)
        self.assertIn("v_payload->>'channel_name' IS NULL", video_sql)

    def test_publication_insert_preserves_identity_keys(self) -> None:
        restaurant_sql, video_sql = self.sql.split(
            "CREATE FUNCTION pipeline_control.publish_upsert_videos", maxsplit=1
        )
        self.assertNotIn("attribute.attname <> 'id'", restaurant_sql)
        self.assertIn("attribute.attname <> 'id'", video_sql)  # update set only
        self.assertIn("IF v_payload->>'id' IS NULL THEN", restaurant_sql)

    def test_preserves_cas_readback_and_grants(self) -> None:
        self.assertIn("v_count > 200", self.sql)
        self.assertIn("compare_and_set_conflict", self.sql)
        self.assertIn("target.updated_at IS NOT DISTINCT FROM $4", self.sql)
        self.assertIn("jsonb_agg(to_jsonb(restaurant)", self.sql)
        self.assertIn("inserted_count", self.sql)
        self.assertIn("ALTER FUNCTION pipeline_control.publish_upsert_restaurants(jsonb) OWNER TO postgres;", self.sql)
        self.assertIn("ALTER FUNCTION pipeline_control.publish_upsert_videos(jsonb) OWNER TO postgres;", self.sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", self.sql)
        self.assertNotIn("GRANT EXECUTE ON FUNCTION pipeline_control.publish_upsert_restaurants", self.sql)
        self.assertNotIn("GRANT EXECUTE ON FUNCTION pipeline_control.publish_upsert_videos", self.sql)
        self.assertIn("SELECT privacy_retention.assert_g014_public_rpc_allowlist();", self.sql)


if __name__ == "__main__":
    unittest.main()
