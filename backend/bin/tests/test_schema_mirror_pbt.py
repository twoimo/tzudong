"""Property-based test for the Schema_Mirror_Report classification completeness.

Feature: platform-modernization, Property 17: Schema_Mirror_Report 분류 완전성
Validates: Requirements 9.3, 9.4, 9.5

This exercises the pure report builder in ``backend/bin/schema_mirror_report.py``
without a live database. ``backend/bin`` scripts are standalone (no
``__init__.py``), so the module is loaded by path — the same loading pattern the
sibling ``test_schema_mirror_report_unittest.py`` uses.

The property generates random Local and Hosted schema snapshots (tables,
columns, constraints, RPCs) with a controlled set of injected differences, then
builds the report and asserts:

  * all five difference categories are always present, including zero-count
    categories (Requirement 9.3);
  * every injected difference appears in exactly one of the five categories
    exactly once, and identical objects appear in none (Requirement 9.3);
  * the defect / approved-local-only classification is exactly correct — a
    ``schema_mirror_defect`` is raised iff a Hosted-only item exists or an
    unenumerated Local-only table exists, and an enumerated Local-only table is
    approved rather than a defect (Requirements 9.4, 9.5).

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
# Scenario generator.
#
# Each scenario carries an independently-sized count for every injected
# difference kind. Distinct name prefixes keep every generated object name
# unique across kinds, so the (objectName, differenceClass) pairs the report
# emits are unambiguous and countable. Difference-bearing tables carry exactly
# ONE kind of difference (a column-diff table has identical constraints and vice
# versa) so that each injected difference is a single, distinct reported item.
# ---------------------------------------------------------------------------

_COUNT = st.integers(min_value=0, max_value=4)


@st.composite
def mirror_scenarios(draw):
    n_identical = draw(_COUNT)  # same on both sides -> reported in no category
    n_local_approved = draw(_COUNT)  # local-only, enumerated -> approved, no defect
    n_local_unapproved = draw(_COUNT)  # local-only, NOT enumerated -> defect
    n_hosted_only = draw(_COUNT)  # hosted-only table -> defect
    n_col_local = draw(_COUNT)  # shared table, local-only column -> no defect
    n_col_hosted = draw(_COUNT)  # shared table, hosted-only column -> defect
    n_con_local = draw(_COUNT)  # shared table, local-only constraint -> no defect
    n_con_hosted = draw(_COUNT)  # shared table, hosted-only constraint -> defect
    n_rpc_local = draw(_COUNT)  # local-only RPC -> no defect
    n_rpc_hosted = draw(_COUNT)  # hosted-only RPC -> defect

    def shape(columns=("id",), constraints=()):
        return smr.TableShape(
            columns=frozenset(columns), constraints=frozenset(constraints)
        )

    local_tables: dict[str, object] = {}
    hosted_tables: dict[str, object] = {}
    local_rpcs: set[str] = set()
    hosted_rpcs: set[str] = set()

    # Expected mapping: objectName -> (category key, is_defect).
    expected: dict[str, tuple[str, bool]] = {}
    local_only_enumeration: set[str] = set()

    # Identical shared tables: present on both sides, reported nowhere.
    for i in range(n_identical):
        name = f"public.identical_{i}"
        local_tables[name] = shape(("id", "same"), ("pk",))
        hosted_tables[name] = shape(("id", "same"), ("pk",))

    # Local-only tables that ARE enumerated in the Local_Only_Schema (approved).
    for i in range(n_local_approved):
        obj = f"approved_{i}"
        name = f"local_analytics.{obj}"
        local_tables[name] = shape()
        local_only_enumeration.add(name)
        expected[obj] = ("localOnlyTables", False)

    # Local-only tables that are NOT enumerated (unapproved -> defect).
    for i in range(n_local_unapproved):
        obj = f"rogue_{i}"
        name = f"public.{obj}"
        local_tables[name] = shape()
        expected[obj] = ("localOnlyTables", True)

    # Hosted-only tables (defect).
    for i in range(n_hosted_only):
        obj = f"hostedonly_{i}"
        name = f"public.{obj}"
        hosted_tables[name] = shape()
        expected[obj] = ("hostedOnlyTables", True)

    # Shared tables with a local-only extra column (difference, not a defect).
    for i in range(n_col_local):
        obj = f"collocal_{i}"
        name = f"public.{obj}"
        local_tables[name] = shape(("id", f"lcol{i}"))
        hosted_tables[name] = shape(("id",))
        expected[obj] = ("columnSetDifferences", False)

    # Shared tables with a hosted-only extra column (defect).
    for i in range(n_col_hosted):
        obj = f"colhosted_{i}"
        name = f"public.{obj}"
        local_tables[name] = shape(("id",))
        hosted_tables[name] = shape(("id", f"hcol{i}"))
        expected[obj] = ("columnSetDifferences", True)

    # Shared tables with a local-only extra constraint (difference, not defect).
    for i in range(n_con_local):
        obj = f"conlocal_{i}"
        name = f"public.{obj}"
        local_tables[name] = shape(("id",), (f"lcon{i}",))
        hosted_tables[name] = shape(("id",), ())
        expected[obj] = ("constraintDifferences", False)

    # Shared tables with a hosted-only extra constraint (defect).
    for i in range(n_con_hosted):
        obj = f"conhosted_{i}"
        name = f"public.{obj}"
        local_tables[name] = shape(("id",), ())
        hosted_tables[name] = shape(("id",), (f"hcon{i}",))
        expected[obj] = ("constraintDifferences", True)

    # RPC present only in Local (difference, not a defect).
    for i in range(n_rpc_local):
        obj = f"rpclocal_{i}"
        local_rpcs.add(f"public.{obj}")
        expected[obj] = ("rpcNameDifferences", False)

    # RPC present only in Hosted (defect).
    for i in range(n_rpc_hosted):
        obj = f"rpchosted_{i}"
        hosted_rpcs.add(f"public.{obj}")
        expected[obj] = ("rpcNameDifferences", True)

    local = smr.SchemaSnapshot(tables=local_tables, rpcs=frozenset(local_rpcs))
    hosted = smr.SchemaSnapshot(tables=hosted_tables, rpcs=frozenset(hosted_rpcs))
    return {
        "local": local,
        "hosted": hosted,
        "local_only_enumeration": sorted(local_only_enumeration),
        "expected": expected,
    }


class SchemaMirrorClassificationCompletenessTests(unittest.TestCase):
    # Feature: platform-modernization, Property 17: Schema_Mirror_Report 분류 완전성
    # Validates: Requirements 9.3, 9.4, 9.5
    @settings(max_examples=100, deadline=None)
    @given(scenario=mirror_scenarios())
    def test_property_17_classification_completeness(self, scenario) -> None:
        report = smr.build_schema_mirror_report(
            local=scenario["local"],
            hosted=scenario["hosted"],
            local_only_tables=scenario["local_only_enumeration"],
        )
        expected = scenario["expected"]

        # Requirement 9.3: the report is complete and enumerates exactly the five
        # difference classes, including any that are empty.
        self.assertTrue(report["complete"])
        self.assertEqual(set(report["categories"].keys()), set(smr.CATEGORY_KEYS))

        # Collect every reported (objectName, differenceClass) pair, and group
        # object names by category.
        reported_pairs: list[tuple[str, str]] = []
        objects_by_category: dict[str, list[str]] = {}
        for key in smr.CATEGORY_KEYS:
            category = report["categories"][key]
            # count must equal the number of items in the category.
            self.assertEqual(category["count"], len(category["items"]))
            names_here: list[str] = []
            for item in category["items"]:
                # Every item carries schema, object, and difference classification.
                self.assertIn("schemaName", item)
                self.assertIn("objectName", item)
                self.assertIn("differenceClass", item)
                reported_pairs.append((item["objectName"], item["differenceClass"]))
                names_here.append(item["objectName"])
            objects_by_category[key] = names_here

        # Requirement 9.3: each injected difference appears exactly once — no
        # duplicate classification across (or within) categories.
        self.assertEqual(len(reported_pairs), len(set(reported_pairs)))

        # The set of reported object names is exactly the set of injected
        # differences: nothing extra (identical objects are reported nowhere)
        # and nothing missing.
        reported_objects = [obj for obj, _ in reported_pairs]
        self.assertEqual(sorted(reported_objects), sorted(expected.keys()))
        self.assertEqual(len(reported_objects), len(set(reported_objects)))

        # Each injected difference lands in exactly its expected category.
        for obj, (expected_category, _is_defect) in expected.items():
            self.assertIn(obj, objects_by_category[expected_category])
            # And in no other category.
            for key in smr.CATEGORY_KEYS:
                if key != expected_category:
                    self.assertNotIn(obj, objects_by_category[key])

        # Requirements 9.4 / 9.5: the defect verdict is exactly the disjunction
        # of "some injected difference is a Hosted-only / unenumerated item".
        expected_defect = any(is_defect for _, (_, is_defect) in expected.items())
        self.assertEqual(report["mirrorPass"], not expected_defect)
        self.assertEqual(
            report["errorCode"],
            smr.SCHEMA_MIRROR_DEFECT if expected_defect else None,
        )

        # The defect list contains exactly the injected defect object names.
        expected_defect_objects = {
            obj for obj, (_, is_defect) in expected.items() if is_defect
        }
        reported_defect_objects = {d["objectName"] for d in report["defects"]}
        self.assertEqual(reported_defect_objects, expected_defect_objects)

        # Requirement 9.5: enumerated Local-only tables are marked approved with
        # the operator-approval reference and are never defects; unenumerated
        # Local-only tables are the opposite.
        for item in report["categories"]["localOnlyTables"]["items"]:
            _, is_defect = expected[item["objectName"]]
            if is_defect:
                self.assertFalse(item["approvedLocalOnly"])
                self.assertIsNone(item["operatorApprovalReference"])
            else:
                self.assertTrue(item["approvedLocalOnly"])
                self.assertEqual(
                    item["operatorApprovalReference"],
                    smr.LOCAL_ONLY_APPROVAL_REFERENCES.get(
                        f"{item['schemaName']}.{item['objectName']}", smr.LOCAL_ONLY_APPROVAL_REFERENCE),
                )


if __name__ == "__main__":
    unittest.main()
