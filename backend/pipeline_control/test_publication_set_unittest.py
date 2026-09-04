"""Unit tests for the committed Publication_Set ledger artifact.

Covers task 11 (Requirements 10.1, 10.2): assert the committed
``backend/deploy/publication-set.v1.json`` parses, enumerates tables/columns
without wildcards, keeps ``publishedColumns`` and ``excludedColumns`` disjoint
per table, excludes the forbidden table families
(``local_analytics.*``, ``privacy_*``, ``*_audit_events``, ``user_*``,
``reviews``, ``youtube_*_kpi_snapshots``), carries the exact design C6/D5
column lists, and leaves the operator approval unresolved
(``approval.approverName`` is null).

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import re
import unittest

_LEDGER_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "deploy",
        "publication-set.v1.json",
    )
)

# Exact design C6/D5 column lists.
_RESTAURANT_PUBLISHED = [
    "approved_name", "origin_name", "naver_name", "google_name",
    "trace_id_name_source", "trace_id", "phone", "categories", "status",
    "source_type", "channel_name", "youtube_link", "youtube_meta",
    "description_map_url", "evaluation_results", "reasoning_basis",
    "tzuyang_review", "origin_address", "road_address", "jibun_address",
    "english_address", "address_elements", "lat", "lng",
    "geocoding_success", "geocoding_false_stage", "is_missing",
    "is_not_selected", "recollect_version",
]
_VIDEOS_PUBLISHED = [
    "youtube_link", "channel_name", "title", "published_at", "duration", "category", "meta_history",
    "view_count", "like_count", "comment_count",
]

# Forbidden table-name predicates per design D5 invariants and AGENTS.md.
_FORBIDDEN_PREDICATES = (
    ("local_analytics schema", lambda schema, table: schema == "local_analytics"),
    ("privacy_*", lambda schema, table: table.startswith("privacy_")),
    ("*_audit_events", lambda schema, table: table.endswith("_audit_events")),
    ("user_*", lambda schema, table: table.startswith("user_")),
    ("reviews", lambda schema, table: table == "reviews"),
    (
        "youtube_*_kpi_snapshots",
        lambda schema, table: table.startswith("youtube_")
        and table.endswith("_kpi_snapshots"),
    ),
)


class PublicationSetLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        with open(_LEDGER_PATH, "r", encoding="utf-8") as handle:
            self.raw = handle.read()
        self.doc = json.loads(self.raw)

    def test_ledger_parses_as_json_object(self) -> None:
        self.assertIsInstance(self.doc, dict)
        self.assertEqual(self.doc.get("schemaVersion"), 1)

    def test_no_wildcard_tokens_anywhere(self) -> None:
        # Requirement 10.1: explicit enumeration, no wildcard notation.
        self.assertNotIn("*", self.raw.replace("_kpi_snapshots", ""))
        for table in self.doc["tables"]:
            for column in table["publishedColumns"]:
                self.assertNotIn("*", column)
                self.assertFalse(re.search(r"[*%]", column), column)

    def test_tables_carry_identity_and_cas_keys(self) -> None:
        by_table = {t["table"]: t for t in self.doc["tables"]}
        self.assertEqual(by_table["restaurants"]["rowIdentityKeyColumns"], ["id"])
        self.assertEqual(
            by_table["restaurants"]["casKeyColumns"], ["id", "trace_id", "updated_at"]
        )
        self.assertEqual(by_table["videos"]["rowIdentityKeyColumns"], ["id"])
        self.assertEqual(by_table["videos"]["casKeyColumns"], ["id", "updated_at"])

    def test_exact_published_column_lists(self) -> None:
        by_table = {t["table"]: t for t in self.doc["tables"]}
        self.assertEqual(by_table["restaurants"]["publishedColumns"], _RESTAURANT_PUBLISHED)
        self.assertEqual(len(by_table["restaurants"]["publishedColumns"]), 29)
        self.assertEqual(by_table["videos"]["publishedColumns"], _VIDEOS_PUBLISHED)
        self.assertEqual(len(by_table["videos"]["publishedColumns"]), 10)

    def test_published_and_excluded_columns_are_disjoint(self) -> None:
        # Design D5 invariant: publishedColumns ∩ excludedColumns = ∅.
        excluded = self.doc["excludedColumns"]
        for table in self.doc["tables"]:
            key = f"{table['schema']}.{table['table']}"
            excluded_cols = set(excluded.get(key, []))
            published_cols = set(table["publishedColumns"])
            self.assertEqual(
                published_cols & excluded_cols,
                set(),
                f"published ∩ excluded must be empty for {key}",
            )

    def test_forbidden_table_families_absent(self) -> None:
        for table in self.doc["tables"]:
            schema = table["schema"]
            name = table["table"]
            for label, predicate in _FORBIDDEN_PREDICATES:
                self.assertFalse(
                    predicate(schema, name),
                    f"forbidden table family present: {schema}.{name} ({label})",
                )

    def test_operator_approval_unresolved(self) -> None:
        approval = self.doc["approval"]
        self.assertIsNone(approval["approverName"])
        self.assertIsNone(approval["approvedAt"])
        self.assertEqual(approval["status"], "unresolved")

    def test_derivation_references_design_sources(self) -> None:
        derivation = self.doc["derivation"]
        self.assertIn("RESTAURANT_MERGE_SELECT", derivation["publicReadSources"][0])
        self.assertTrue(
            any("batch_upsert_restaurants" in s for s in derivation["pipelineWriteSources"])
        )
        self.assertIn(
            "pipeline_control.publish_upsert_videos",
            derivation["pipelineWriteSources"],
        )


if __name__ == "__main__":
    unittest.main()
