"""Unit tests for the seed-fixture guard (Requirements 9.2, 9.8, 9.11).

Feature: platform-modernization, Task 7.

These exercise the pure logic in ``backend/bin/seed_fixture_guard.py`` without a
live database or migration run. ``backend/bin`` scripts are standalone, so the
module is loaded by path.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import hashlib
import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "backend" / "bin" / "seed_fixture_guard.py"

_spec = importlib.util.spec_from_file_location("seed_fixture_guard", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

MARKER = guard.LOCAL_TEST_ONLY_MARKER


def _marked(**extra):
    row = {"id": "00000000-0000-4000-8000-000000000101", "source": f"{MARKER}:nightly-ci:fixture-v1"}
    row.update(extra)
    return row


def _unmarked(**extra):
    row = {"id": "00000000-0000-4000-8000-000000000102", "approved_name": "정원분식"}
    row.update(extra)
    return row


class MarkerDetectionTests(unittest.TestCase):
    def test_marker_in_provenance_field_is_detected(self) -> None:
        self.assertTrue(guard.record_carries_marker(_marked()))

    def test_marker_as_prefix_matches(self) -> None:
        row = {"operator_approval_ref": f"{MARKER}:nightly-ci:privacy-policy-fixture-v1"}
        self.assertTrue(guard.record_carries_marker(row))

    def test_missing_marker_is_not_detected(self) -> None:
        self.assertFalse(guard.record_carries_marker(_unmarked()))

    def test_marker_detected_when_nested(self) -> None:
        row = {"id": "x", "meta": {"provenance": [f"{MARKER}"]}}
        self.assertTrue(guard.record_carries_marker(row))

    def test_case_variation_does_not_match(self) -> None:
        row = {"source": "local_test_only:not_production"}
        self.assertFalse(guard.record_carries_marker(row))

    def test_deeply_nested_beyond_bound_is_not_detected(self) -> None:
        # Build nesting deeper than MARKER_SCAN_MAX_DEPTH.
        value: object = MARKER
        for _ in range(guard.MARKER_SCAN_MAX_DEPTH + 2):
            value = {"nested": value}
        self.assertFalse(guard.record_carries_marker(value))


class SeedLoadEvaluationTests(unittest.TestCase):
    """Requirement 9.11: unmarked fixture load admits zero rows."""

    def test_all_marked_is_admitted(self) -> None:
        records = [_marked(), _marked(id="b", source=f"{MARKER}:x")]
        decision = guard.evaluate_seed_fixture_load(records)
        self.assertTrue(decision.admitted)
        self.assertIsNone(decision.code)
        self.assertEqual(decision.loadedRowCount, 2)
        self.assertEqual(decision.unmarkedRecordCount, 0)

    def test_any_unmarked_rejects_and_loads_zero(self) -> None:
        records = [_marked(), _unmarked(), _marked(id="c", source=f"{MARKER}:x")]
        decision = guard.evaluate_seed_fixture_load(records)
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.SEED_FIXTURE_MARKER_MISSING)
        # Fail closed and atomic: no rows admitted even though two are marked.
        self.assertEqual(decision.loadedRowCount, 0)
        self.assertEqual(decision.unmarkedRecordCount, 1)
        self.assertEqual(decision.totalRecordCount, 3)

    def test_empty_input_is_trivially_admitted(self) -> None:
        decision = guard.evaluate_seed_fixture_load([])
        self.assertTrue(decision.admitted)
        self.assertEqual(decision.loadedRowCount, 0)

    def test_admit_rows_returns_empty_tuple_when_rejected(self) -> None:
        rows, decision = guard.admit_seed_fixture_rows([_marked(), _unmarked()])
        self.assertEqual(rows, ())
        self.assertFalse(decision.admitted)

    def test_admit_rows_returns_all_when_admitted(self) -> None:
        records = [_marked(), _marked(id="b", source=f"{MARKER}:y")]
        rows, decision = guard.admit_seed_fixture_rows(records)
        self.assertEqual(len(rows), 2)
        self.assertTrue(decision.admitted)

    def test_decision_dict_is_bounded(self) -> None:
        decision = guard.evaluate_seed_fixture_load([_unmarked()])
        self.assertEqual(
            set(decision.as_dict().keys()),
            {
                "admitted",
                "code",
                "totalRecordCount",
                "unmarkedRecordCount",
                "loadedRowCount",
            },
        )


class PublicationExclusionTests(unittest.TestCase):
    """Requirement 9.8: marked records are excluded from publish input."""

    def test_marked_records_are_all_excluded(self) -> None:
        records = [_marked(), _marked(id="b", source=f"{MARKER}:y")]
        result = guard.exclude_marked_from_publication(records)
        self.assertEqual(result.keptRecordCount, 0)
        self.assertEqual(result.excludedRecordCount, 2)
        self.assertEqual(result.kept, ())

    def test_unmarked_records_are_kept(self) -> None:
        records = [_unmarked(), _marked()]
        result = guard.exclude_marked_from_publication(records)
        self.assertEqual(result.keptRecordCount, 1)
        self.assertEqual(result.excludedRecordCount, 1)


class AppliedMigrationImmutabilityTests(unittest.TestCase):
    """Requirement 9.2: applied migration content/filename changes are rejected."""

    APPLIED = frozenset({"20260124_create_restaurants.sql", "20260131_fix_search_rpc.sql"})

    def test_content_change_of_applied_is_rejected(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260124_create_restaurants.sql",
            change_kind=guard.CHANGE_CONTENT,
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_filename_change_of_applied_is_rejected(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260131_fix_search_rpc.sql",
            change_kind=guard.CHANGE_FILENAME,
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_delete_of_applied_is_rejected(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260131_fix_search_rpc.sql",
            change_kind=guard.CHANGE_DELETE,
            applied_filenames=self.APPLIED,
        )
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_new_file_addition_is_admitted(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260901000200_correction.sql",
            change_kind=guard.CHANGE_ADD_NEW_FILE,
            applied_filenames=self.APPLIED,
        )
        self.assertTrue(decision.admitted)
        self.assertIsNone(decision.code)

    def test_add_new_file_reusing_applied_name_is_rejected(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260124_create_restaurants.sql",
            change_kind=guard.CHANGE_ADD_NEW_FILE,
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_full_path_target_is_reduced_to_basename(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="backend/supabase/migrations/20260124_create_restaurants.sql",
            change_kind=guard.CHANGE_CONTENT,
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.targetFilename, "20260124_create_restaurants.sql")

    def test_unknown_change_kind_fails_closed(self) -> None:
        decision = guard.evaluate_migration_change(
            target_filename="20260124_create_restaurants.sql",
            change_kind="rewrite_history",
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_mutating_nonapplied_file_is_still_rejected(self) -> None:
        # There is no applied object to mutate; in-place mutation is never
        # admitted (correction is only via a new file).
        decision = guard.evaluate_migration_change(
            target_filename="20990101_not_applied.sql",
            change_kind=guard.CHANGE_CONTENT,
            applied_filenames=self.APPLIED,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)


class MigrationContentHashTests(unittest.TestCase):
    def _hash(self, content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def test_differing_content_of_applied_is_rejected(self) -> None:
        applied = {"20260124_create_restaurants.sql": self._hash("CREATE TABLE r();")}
        decision = guard.evaluate_migration_content_change(
            target_filename="20260124_create_restaurants.sql",
            new_content="CREATE TABLE r(id int);",
            applied_hashes=applied,
        )
        self.assertFalse(decision.admitted)
        self.assertEqual(decision.code, guard.APPLIED_MIGRATION_IMMUTABLE)

    def test_identical_content_is_noop_admitted(self) -> None:
        content = "CREATE TABLE r();"
        applied = {"20260124_create_restaurants.sql": self._hash(content)}
        decision = guard.evaluate_migration_content_change(
            target_filename="20260124_create_restaurants.sql",
            new_content=content,
            applied_hashes=applied,
        )
        self.assertTrue(decision.admitted)
        self.assertIsNone(decision.code)

    def test_new_filename_is_admitted(self) -> None:
        applied = {"20260124_create_restaurants.sql": self._hash("x")}
        decision = guard.evaluate_migration_content_change(
            target_filename="20260901000200_new.sql",
            new_content="CREATE TABLE q();",
            applied_hashes=applied,
        )
        self.assertTrue(decision.admitted)
        self.assertEqual(decision.changeKind, guard.CHANGE_ADD_NEW_FILE)


class AppliedMigrationLoaderTests(unittest.TestCase):
    def test_loader_reads_real_migrations_dir(self) -> None:
        applied = guard.load_applied_migration_filenames(repo_root=REPO_ROOT)
        # The tree carries the applied migration set; every entry is a bare
        # .sql filename (no path separators).
        self.assertTrue(applied)
        self.assertTrue(all(name.endswith(".sql") for name in applied))
        self.assertTrue(all("/" not in name for name in applied))

    def test_absent_dir_yields_empty_set(self) -> None:
        applied = guard.load_applied_migration_filenames(
            repo_root=REPO_ROOT, migrations_dir="backend/does/not/exist"
        )
        self.assertEqual(applied, frozenset())


if __name__ == "__main__":
    unittest.main()
