"""Property-based test for Local_Only_Schema × Publication_Set isolation.

Feature: platform-modernization, Property 18: Local_Only_Schema × Publication_Set 분리
Validates: Requirement 9.6

This exercises the publication-isolation logic in
``backend/bin/schema_mirror_report.py`` — the ``_build_publication_isolation``
helper as surfaced on ``build_schema_mirror_report``'s ``publicationIsolation``
field — without a live database. ``backend/bin`` scripts are standalone (no
``__init__.py``), so the module is loaded by path, matching the sibling
``test_schema_mirror_report_unittest.py`` and ``test_schema_mirror_pbt.py``.

Requirement 9.6 keeps the count of tables enumerated in BOTH the
Local_Only_Schema and the Publication_Set at zero, and records the intersection
check count in the Schema_Mirror_Report. The property generates random
Local_Only_Schema enumerations and Publication_Set table sets (sometimes
overlapping, sometimes disjoint), computes the isolation summary, and asserts:

  * ``intersectionCheckCount`` equals the number of Local_Only_Schema tables —
    one membership check per table (Requirement 9.6);
  * ``isolated`` is True iff the true set intersection is empty, and
    ``intersectionTables`` / ``intersectionSize`` reflect that exact
    intersection;
  * the canonical ``local_analytics`` enumeration used against a realistic
    Publication_Set (``public.restaurants`` / ``public.videos``) has an empty
    intersection — the design's expected steady state.

Runnable via ``python -m unittest`` from the repo root. Requires ``hypothesis``.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Load the standalone backend/bin module by path (no package import available).
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "backend" / "bin" / "schema_mirror_report.py"

_spec = importlib.util.spec_from_file_location("schema_mirror_report", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
smr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smr)


# ---------------------------------------------------------------------------
# Table-name strategy.
#
# Names are drawn from a small shared universe of schemas and objects so that
# an independently drawn Local_Only_Schema set and Publication_Set set overlap
# for some examples and stay disjoint for others — the isolation check must be
# correct in both cases.
# ---------------------------------------------------------------------------

_SCHEMAS = st.sampled_from(["local_analytics", "public", "staging", "reporting"])
_OBJECTS = st.sampled_from(
    [
        "restaurants",
        "videos",
        "parity_results",
        "publish_jobs",
        "staging_videos",
        "benchmark_runs",
        "phase_reports",
        "crawl_evidence",
    ]
)

_QUALIFIED = st.builds(lambda s, o: f"{s}.{o}", _SCHEMAS, _OBJECTS)

# A trivial, matching Local/Hosted snapshot: the isolation summary does not
# depend on the schema comparison, so an empty (identical) pair keeps the report
# complete without introducing unrelated defects.
_EMPTY_SNAPSHOT = smr.SchemaSnapshot(tables={}, rpcs=frozenset())


class PublicationIsolationProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 18: Local_Only_Schema × Publication_Set 분리
    # Validates: Requirement 9.6
    @settings(max_examples=100, deadline=None)
    @given(
        local_only=st.sets(_QUALIFIED, max_size=8),
        publication_set=st.sets(_QUALIFIED, max_size=8),
    )
    def test_property_18_isolation(self, local_only, publication_set) -> None:
        report = smr.build_schema_mirror_report(
            local=_EMPTY_SNAPSHOT,
            hosted=_EMPTY_SNAPSHOT,
            local_only_tables=sorted(local_only),
            publication_set_tables=sorted(publication_set),
        )
        iso = report["publicationIsolation"]

        # The Hosted read is available here, so the report is complete and the
        # isolation summary is present.
        self.assertTrue(report["complete"])

        # (a) One membership check per Local_Only_Schema table.
        self.assertEqual(iso["intersectionCheckCount"], len(local_only))
        self.assertEqual(iso["localOnlyTableCount"], len(local_only))
        self.assertEqual(iso["publicationSetTableCount"], len(publication_set))

        # (b) isolated is True iff the true set intersection is empty; the
        # reported intersection tables/size mirror the actual intersection.
        true_intersection = local_only & publication_set
        self.assertEqual(iso["intersectionSize"], len(true_intersection))
        self.assertEqual(set(iso["intersectionTables"]), true_intersection)
        self.assertEqual(iso["intersectionTables"], sorted(true_intersection))
        self.assertEqual(iso["isolated"], len(true_intersection) == 0)

    # Feature: platform-modernization, Property 18: Local_Only_Schema × Publication_Set 분리
    # Validates: Requirement 9.6
    @settings(max_examples=100, deadline=None)
    @given(
        # A realistic Publication_Set: the canonical public publish targets plus
        # arbitrary extra public/reporting/staging tables that never live in the
        # local_analytics schema.
        extra_public=st.sets(
            st.builds(
                lambda s, o: f"{s}.{o}",
                st.sampled_from(["public", "reporting", "staging"]),
                st.sampled_from(
                    ["restaurants", "videos", "reviews", "kpi", "map_pins"]
                ),
            ),
            max_size=6,
        )
    )
    def test_property_18_canonical_local_analytics_is_isolated(
        self, extra_public
    ) -> None:
        publication_set = sorted(
            {"public.restaurants", "public.videos"} | extra_public
        )
        report = smr.build_schema_mirror_report(
            local=_EMPTY_SNAPSHOT,
            hosted=_EMPTY_SNAPSHOT,
            # local_only_tables=None selects the built-in canonical enumeration.
            local_only_tables=None,
            publication_set_tables=publication_set,
        )
        iso = report["publicationIsolation"]

        # The canonical local_analytics enumeration shares no table with any
        # realistic public Publication_Set: intersection is 0 and isolated.
        self.assertEqual(iso["intersectionSize"], 0)
        self.assertEqual(iso["intersectionTables"], [])
        self.assertTrue(iso["isolated"])
        # One check per canonical Local_Only_Schema table.
        self.assertEqual(
            iso["intersectionCheckCount"], len(smr.LOCAL_ONLY_QUALIFIED_TABLES)
        )


if __name__ == "__main__":
    unittest.main()
