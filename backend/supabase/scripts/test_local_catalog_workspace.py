import copy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import local_catalog_workspace as catalog


def row(identifier="11111111-1111-4111-8111-111111111111"):
    result = dict.fromkeys(catalog.FIELDS)
    result.update(id=identifier, approved_name="식당", status="approved", categories=["한식"])
    return result


class LocalWorkingCatalogTests(unittest.TestCase):
    def test_review_omits_timestamps_counters_and_identical_records(self):
        baseline = [row()]
        current = copy.deepcopy(baseline)
        current[0].update(updated_at="2026-09-09", youtube_meta={"viewCount": 999})
        self.assertEqual(catalog.review_changes(baseline, current), [])

    def test_review_preserves_field_changes_and_explicit_selection(self):
        first, second = row(), row("22222222-2222-4222-8222-222222222222")
        baseline = [first, second]
        current = copy.deepcopy(baseline)
        current[0].update(approved_name="수정 식당", lat=37.5, lng=127.0)
        current[1]["status"] = "hold"
        selected = catalog.review_changes(baseline, current, [first["id"]])
        self.assertEqual(selected, [{"id": first["id"], "kind": "changed_fields", "fields": {
            "approved_name": {"before": "식당", "after": "수정 식당"},
            "lat": {"before": None, "after": 37.5}, "lng": {"before": None, "after": 127.0},
        }}])
        self.assertEqual(catalog.review_changes(baseline, current)[1]["fields"]["status"]["after"], "hold")
        self.assertEqual(baseline[0]["approved_name"], "식당")

    def test_review_does_not_infer_deletes_or_inserts_from_membership(self):
        first, second = row(), row("22222222-2222-4222-8222-222222222222")
        self.assertEqual(catalog.review_changes([first], [second]), [
            {"id": first["id"], "kind": "missing_locally", "fields": {}},
            {"id": second["id"], "kind": "local_only", "fields": {}},
        ])
        self.assertEqual(catalog.review_changes([first], [])[0]["kind"], "missing_locally")

    def test_review_rejects_unknown_selection_and_duplicate_ids(self):
        with self.assertRaisesRegex(catalog.CatalogError, "review_selection_invalid"):
            catalog.review_changes([row()], [row()], ["not-an-imported-id"])
        with self.assertRaisesRegex(catalog.CatalogError, "review_rows_invalid"):
            catalog.review_changes([row()], [row(), row()])

    def test_review_baseline_requires_matching_applied_readback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = {"schema": "local-working-catalog-v1", "source": catalog.HOSTED_PROJECT_REF,
                    "project": "fixture", "rows": [row()]}
            digest = catalog.sha(plan)
            catalog.private_write(root / (digest + ".preview.json"), plan)
            receipt = {"schema": plan["schema"], "preview_sha256": digest, "project": "fixture",
                       "result": "applied_and_read_back", **catalog.summary(plan["rows"])}
            receipt_path = root / (digest + ".receipt.json")
            catalog.private_write(receipt_path, receipt)
            self.assertEqual(catalog.load_baseline(root, digest, "fixture"), plan)
            self.assertEqual(catalog.discover_baseline(root, "fixture"), digest)
            with self.assertRaisesRegex(catalog.CatalogError, "preview_binding_invalid"):
                catalog.load_baseline(root, digest, "other-project")
            receipt["projection_sha256"] = "0" * 64
            receipt_path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(catalog.CatalogError, "baseline_receipt_invalid"):
                catalog.load_baseline(root, digest, "fixture")
            with self.assertRaisesRegex(catalog.CatalogError, "baseline_receipt_invalid"):
                catalog.discover_baseline(root, "fixture")

    def test_auto_baseline_does_not_guess_missing_or_multiple_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(catalog.CatalogError, 'baseline_selection_required'):
                catalog.discover_baseline(root, 'fixture')
            for digest in ['a' * 64, 'b' * 64]:
                catalog.private_write(root / (digest + '.receipt.json'), {})
            with self.assertRaisesRegex(catalog.CatalogError, 'baseline_selection_required'):
                catalog.discover_baseline(root, 'fixture')

    def test_private_review_reader_rejects_symlinks_and_shared_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target.json"
            catalog.private_write(target, {})
            link = Path(directory) / "link.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(catalog.CatalogError, "preview_permissions_invalid"):
                catalog.read_private_json(link)
            target.chmod(0o644)
            with self.assertRaisesRegex(catalog.CatalogError, "preview_permissions_invalid"):
                catalog.read_private_json(target)

    def test_review_command_only_reads_local_db_and_reuses_identical_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "working-catalog"
            workspace.mkdir(mode=0o700)
            plan = {"schema": "local-working-catalog-v1", "source": catalog.HOSTED_PROJECT_REF,
                    "project": "fixture", "rows": [row()]}
            digest = catalog.sha(plan)
            catalog.private_write(workspace / (digest + ".preview.json"), plan)
            catalog.private_write(workspace / (digest + ".receipt.json"), {
                "schema": plan["schema"], "preview_sha256": digest, "project": "fixture",
                "result": "applied_and_read_back", **catalog.summary(plan["rows"]),
            })
            class Executor:
                def _binding(self):
                    return None, root, None
                def _expected_project(self):
                    return "fixture"
                def run(self, *args):
                    raise AssertionError("review must not write database")
            current = {"digest": "a" * 32, "rows": [row()]}
            arguments = ["catalog", "review"]
            with patch.object(catalog, "executor", return_value=(Executor(), None)), \
                    patch.object(catalog, "fetch", side_effect=AssertionError("no hosted request")), \
                    patch.object(catalog.sys, "argv", arguments), \
                    patch.object(catalog, "local_state", return_value=current):
                for _ in range(2):
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        catalog.main()
                    report = json.loads(output.getvalue())
                    self.assertEqual(report["changed_records"], 0)
                    self.assertIs(report["safe_to_apply"], False)
                self.assertEqual(len(list(workspace.glob("*.review.json"))), 1)
                review = catalog.read_private_json(next(workspace.glob("*.review.json")))
                self.assertIs(review["hosted_revalidation_required"], True)
            with patch.object(catalog, "executor", return_value=(Executor(), None)), \
                    patch.object(catalog.sys, "argv", arguments), \
                    patch.object(catalog, "local_state", side_effect=[current, {**current, "digest": "b" * 32}]):
                with self.assertRaisesRegex(catalog.CatalogError, "local_changed"):
                    catalog.main()

    def test_multiple_restaurants_per_video_require_compatible_catalog(self):
        preflight = {"video_only_index_present": True, "multi_restaurant_videos": 74, "composite_duplicate_groups": 0}
        self.assertTrue(catalog.identity_blocked(preflight))
        preflight["video_only_index_present"] = False
        self.assertFalse(catalog.identity_blocked(preflight))
        preflight["composite_duplicate_groups"] = 1
        self.assertTrue(catalog.identity_blocked(preflight))

    def test_local_edits_and_extra_rows_are_preserved(self):
        source = [row()]
        changed = copy.deepcopy(source)
        changed[0]["approved_name"] = "운영자 수정"
        for local in (changed, source + [row("22222222-2222-4222-8222-222222222222")]):
            with self.assertRaisesRegex(catalog.CatalogError, "local_working_changes_preserved"):
                catalog.mode({"rows": local}, source)

    def test_repeat_import_is_unchanged(self):
        source = [row()]
        self.assertEqual(catalog.mode({"rows": source}, source), "unchanged")

    def test_metadata_diagnostics_are_not_carried(self):
        item = row()
        item["youtube_meta"] = {"title": "영상", "publishedAt": "2026-01-01", "diagnostic": "private", "title_extra": {"token": "private"}}
        self.assertEqual(catalog.normalize([item])[0]["youtube_meta"], {"title": "영상", "publishedAt": "2026-01-01"})
        self.assertTrue({"phone", "created_by", "updated_by_admin_id", "evaluation_results", "db_error_details"}.isdisjoint(catalog.FIELDS))

    def test_duplicate_ids_and_unexpected_status_rejected(self):
        with self.assertRaises(catalog.CatalogError):
            catalog.normalize([row(), row()])
        item = row()
        item["status"] = "unexpected"
        with self.assertRaises(catalog.CatalogError):
            catalog.normalize([item])

    def test_redirect_is_denied(self):
        with self.assertRaisesRegex(catalog.CatalogError, "source_redirect_denied"):
            catalog.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.org")

    def test_changed_source_total_stops_pagination(self):
        class Response:
            def __init__(self, total):
                self.headers = {"Content-Range": "0-0/" + str(total)}
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self, size):
                return catalog.canonical([row()])
        with patch.object(catalog, "build_opener") as opener:
            opener.return_value.open.side_effect = [Response(2), Response(3)]
            with self.assertRaisesRegex(catalog.CatalogError, "source_changed"):
                catalog.fetch("test-key")
            self.assertTrue(all(call.args[0].get_method() == "GET" for call in opener.return_value.open.call_args_list))


if __name__ == "__main__":
    unittest.main()
