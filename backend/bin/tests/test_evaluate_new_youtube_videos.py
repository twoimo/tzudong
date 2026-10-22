#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import hashlib
import contextlib
import io
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from backend.utils.stage_cache import complete, fingerprint


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "backend" / "bin" / "evaluate_new_youtube_videos.py"
spec = importlib.util.spec_from_file_location("evaluate_new_youtube_videos", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


def certified_partial_video(root: Path, video_id: str) -> tuple[Path, Path, Path]:
    crawling = root / "backend/restaurant-crawling/data/tzuyang"
    evaluation = root / "backend/restaurant-evaluation/data/tzuyang"

    def stage(base: Path, folder: str, row: dict) -> Path:
        output = base / folder / f"{video_id}.jsonl"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(row) + "\n", encoding="utf-8")
        complete(output.parent / ".receipts" / f"{video_id}.json", "input", [output])
        return output

    stage(crawling, "crawling", {"restaurants": [
        {"origin_name": "A", "address": "address A"},
        {"origin_name": "B", "address": "address B"},
    ]})
    selection = stage(evaluation, "evaluation/selection", {
        "evaluation_target": {"A": True, "B": True},
        "restaurants": [{"origin_name": "A"}, {"origin_name": "B"}],
    })
    crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
    complete(selection.parent / ".receipts" / f"{video_id}.json", fingerprint(
        [crawl_output], assets=[module.SCRIPTS["target"]], settings="tzuyang"
    ), [selection])
    stage(evaluation, "evaluation/rule_results", {})
    stage(evaluation, "evaluation/laaj_results", {})
    output = evaluation / "evaluation/transforms.jsonl"
    output.write_text(json.dumps({
        "trace_id": "trace-a", "origin_name": "A",
        "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
    }) + "\n", encoding="utf-8")
    ledger = output.parent / ".receipts/transform.json"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_text(json.dumps({
        "schemaVersion": 2, "recordCount": 1,
        "outputHash": hashlib.sha256(output.read_bytes()).hexdigest(),
        "groups": {f"results:{video_id}": {"records": ["trace-a"]}},
    }), encoding="utf-8")
    return crawling, selection, output


def hosted_dry_run(root: Path, video_id: str) -> str:
    urls = root / "backend/restaurant-crawling/data/tzuyang/urls.txt"
    urls.parent.mkdir(parents=True, exist_ok=True)
    if not urls.is_file():
        urls.write_text(f"https://www.youtube.com/watch?v={video_id}\n", encoding="utf-8")
    original_urls = urls.read_bytes()
    output = io.StringIO()
    with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
        patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(["hosted-A"], [video_id])), \
        patch.object(module, "_run", return_value=0), contextlib.redirect_stdout(output):
        assert module.main(["--limit", "1", "--dry-run"]) == 0
    assert urls.read_bytes() == original_urls
    return output.getvalue()


class EvaluateNewYoutubeVideosTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root_patch = patch.object(module, "REPO_ROOT", Path(temporary.name))
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_shared_runner_failure_prevents_both_preview_and_apply(self) -> None:
        import contextlib
        import io
        from backend.bin import run_hosted_new_video_pipeline as runner
        for args in ([], ['--dry-run']):
            with self.subTest(args=args), patch.object(runner, '_load_backend_env'), \
                patch.dict('os.environ', {'G037_WRITE_FREEZE': 'cleared'}), \
                patch.object(runner, 'cadence_source_preflight'), \
                patch.object(runner, 'env_contract_preflight'), \
                patch.object(runner, '_apply_local_runtime_environment'), \
                patch.object(runner, '_run', return_value=7) as command, \
                contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(args), 7)
                self.assertEqual(command.call_count, 1)
                self.assertEqual(command.call_args.args[0][1], str(runner.EVALUATE))

    def test_skips_when_all_urls_already_hosted(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            return 0

        with patch.object(module, "assert_hosted_target"), patch.object(
            module,
            "fetch_hosted_restaurant_snapshot",
            return_value=([], ["abcdefghijk"]),
        ), patch.object(module, "_load_urls", return_value=["https://www.youtube.com/watch?v=abcdefghijk"]), patch.object(
            module, "_write_urls"
        ), patch.object(module, "_run", side_effect=fake_run):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertTrue(str(calls[0][1]).endswith("01-collect-urls.py"))

    def test_skips_urls_already_locally_evaluated(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            return 0

        with patch.object(module, "assert_hosted_target"), patch.object(
            module,
            "fetch_hosted_restaurant_snapshot",
            return_value=([], []),
        ), patch.object(
            module,
            "_load_urls",
            return_value=["https://www.youtube.com/watch?v=FZoO4d0tU40"],
        ), patch.object(
            module, "_locally_evaluated_ids", return_value={"FZoO4d0tU40"}
        ), patch.object(module, "_write_urls"), patch.object(
            module, "_run", side_effect=fake_run
        ):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertTrue(str(calls[0][1]).endswith("01-collect-urls.py"))

    def test_only_certified_final_or_real_empty_video_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, evaluation = root / "crawling", root / "evaluation"

            def stage(base: Path, folder: str, video_id: str, row: dict) -> Path:
                output = base / folder / f"{video_id}.jsonl"
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(row) + "\n", encoding="utf-8")
                complete(output.parent / ".receipts" / f"{video_id}.json", "input", [output])
                return output

            stage(crawling, "crawling", "empty", {"restaurants": []})
            stage(evaluation, "evaluation/notSelection", "empty", {
                "evaluation_target": {}, "is_notSelected": True,
                "notSelected_reason": "no_restaurants",
            })
            # The 09 receipt is stored beside selection even when only
            # notSelection was written.
            empty_output = evaluation / "evaluation/notSelection/empty.jsonl"
            complete(evaluation / "evaluation/selection/.receipts/empty.json", "input", [empty_output])

            stage(crawling, "crawling", "partial", {"restaurants": [{"origin_name": "A"}]})
            stage(evaluation, "evaluation/selection", "partial", {
                "evaluation_target": {"A": True}, "restaurants": [{"origin_name": "A"}],
            })

            stage(crawling, "crawling", "complete", {"restaurants": [
                {"origin_name": "A"}, {"origin_name": "B"},
            ]})
            stage(evaluation, "evaluation/selection", "complete", {
                "evaluation_target": {"A": True, "B": True},
                "restaurants": [{"origin_name": "A"}, {"origin_name": "B"}],
            })
            stage(evaluation, "evaluation/rule_results", "complete", {})
            laaj = stage(evaluation, "evaluation/laaj_results", "complete", {})
            output = evaluation / "evaluation/transforms.jsonl"
            output.write_text("".join(json.dumps({
                "trace_id": trace, "origin_name": name, "youtube_link":
                "https://www.youtube.com/watch?v=complete",
            }) + "\n" for trace, name in (("trace-a", "A"), ("trace-b", "B"))), encoding="utf-8")
            ledger = output.parent / ".receipts/transform.json"
            ledger.parent.mkdir(parents=True, exist_ok=True)
            ledger.write_text(json.dumps({
                "schemaVersion": 2, "recordCount": 2,
                "outputHash": hashlib.sha256(output.read_bytes()).hexdigest(),
                "groups": {"results:complete": {"records": ["trace-a", "trace-b"]}},
            }), encoding="utf-8")

            for video_id in ("empty", "complete"):
                inputs = [crawling / "crawling" / f"{video_id}.jsonl"]
                outputs = [path for path in (
                    evaluation / "evaluation/selection" / f"{video_id}.jsonl",
                    evaluation / "evaluation/notSelection" / f"{video_id}.jsonl",
                ) if path.is_file()]
                complete(evaluation / "evaluation/selection/.receipts" / f"{video_id}.json",
                         fingerprint(inputs, assets=[module.SCRIPTS["target"]], settings="evaluation"),
                         outputs)

            self.assertEqual(module._locally_evaluated_ids(evaluation, crawling), {"empty", "complete"})
            laaj.write_text("changed\n", encoding="utf-8")
            self.assertEqual(module._locally_evaluated_ids(evaluation, crawling), {"empty"})
            laaj.write_text("{}\n", encoding="utf-8")
            ledger.write_text(json.dumps({
                "schemaVersion": 2, "recordCount": 2,
                "outputHash": hashlib.sha256(output.read_bytes()).hexdigest(),
                "groups": {"results:complete": {"records": ["trace-a"]}},
            }), encoding="utf-8")
            self.assertEqual(module._locally_evaluated_ids(evaluation, crawling), {"empty"})

    def test_hosted_one_row_does_not_hide_certified_second_restaurant(self) -> None:
        video_id = "abcdefghijk"
        url = f"https://www.youtube.com/watch?v={video_id}"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, selection, transformed = certified_partial_video(root, video_id)
            urls = crawling / "urls.txt"
            urls.write_text(url + "\n", encoding="utf-8")
            original_urls = urls.read_bytes()
            original_selection = selection.read_bytes()
            calls: list[str] = []

            def collect(argv: list[str], _env: dict[str, str], *, required: bool = True) -> int:
                calls.append(Path(argv[1]).name)
                urls.write_text(url + "\n", encoding="utf-8")
                return 0

            def dry_run() -> str:
                output = io.StringIO()
                with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
                    patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(["hosted-A"], [video_id])), \
                    patch.object(module, "_run", side_effect=collect), contextlib.redirect_stdout(output):
                    self.assertEqual(module.main(["--limit", "1", "--dry-run"]), 0)
                self.assertEqual(urls.read_bytes(), original_urls)
                self.assertEqual(selection.read_bytes(), original_selection)
                return output.getvalue()

            first = dry_run()
            self.assertIn(f"newVideoIds=['{video_id}']", first)
            self.assertIn("partialRecoveryVideoCount=1", first)
            self.assertEqual(calls, ["01-collect-urls.py"])

            # Completion and partial classification must share one snapshot.
            with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
                patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(["hosted-A"], [video_id])), \
                patch.object(module, "_run", side_effect=collect), \
                patch.object(module, "_transformed_names", side_effect=[
                    {video_id: {"A"}}, {video_id: {"A", "B"}},
                ]) as snapshots, contextlib.redirect_stdout(io.StringIO()) as same_snapshot_output:
                self.assertEqual(module.main(["--limit", "1", "--dry-run"]), 0)
            self.assertEqual(snapshots.call_count, 1)
            self.assertIn(f"newVideoIds=['{video_id}']", same_snapshot_output.getvalue())

            def fail_transcript(argv: list[str], _env: dict[str, str], *, required: bool = True) -> int:
                return 9 if Path(argv[1]).name == "03-collect-transcript.js" else collect(argv, _env)

            failed_output = io.StringIO()
            with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
                patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(["hosted-A"], [video_id])), \
                patch.object(module, "_run", side_effect=fail_transcript), contextlib.redirect_stdout(failed_output):
                self.assertEqual(module.main(["--limit", "1"]), 1)
            self.assertEqual(urls.read_bytes(), original_urls)
            self.assertIn(f"videoFailed={video_id}", failed_output.getvalue())
            self.assertIn("failedVideoCount=1", failed_output.getvalue())

            # Once the selected B row is committed, evaluation need not rerun;
            # pending-apply's existing trace-level contract handles hosted B.
            transformed.write_text(transformed.read_text(encoding="utf-8") + json.dumps({
                "trace_id": "trace-b", "origin_name": "B", "youtube_link": url,
            }) + "\n", encoding="utf-8")
            ledger = transformed.parent / ".receipts/transform.json"
            ledger.write_text(json.dumps({
                "schemaVersion": 2, "recordCount": 2,
                "outputHash": hashlib.sha256(transformed.read_bytes()).hexdigest(),
                "groups": {f"results:{video_id}": {"records": ["trace-a", "trace-b"]}},
            }), encoding="utf-8")
            self.assertIn("newVideoCount=0", dry_run())

    def test_stale_selection_recomputes_current_09_targets_without_writing(self) -> None:
        video_id = "abcdefghijk"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, selection, transformed = certified_partial_video(root, video_id)
            crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
            selection_receipt = selection.parent / ".receipts" / f"{video_id}.json"
            url = f"https://www.youtube.com/watch?v={video_id}"
            transformed.write_text(transformed.read_text(encoding="utf-8") + json.dumps({
                "trace_id": "trace-b", "origin_name": "B", "youtube_link": url,
            }) + "\n", encoding="utf-8")
            (transformed.parent / ".receipts/transform.json").write_text(json.dumps({
                "schemaVersion": 2, "recordCount": 2,
                "outputHash": hashlib.sha256(transformed.read_bytes()).hexdigest(),
                "groups": {f"results:{video_id}": {"records": ["trace-a", "trace-b"]}},
            }), encoding="utf-8")
            original_selection = selection.read_bytes()
            original_receipt = selection_receipt.read_bytes()
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))

            # Current certified extraction adds C; old 09 A+B is no longer terminal.
            restaurants = [
                {"origin_name": name, "address": f"address {name}"} for name in ("A", "B", "C")
            ]
            crawl_output.write_text(json.dumps({"restaurants": restaurants}) + "\n", encoding="utf-8")
            complete(crawl_output.parent / ".receipts" / f"{video_id}.json", "input", [crawl_output])
            self.assertIn("partialRecoveryVideoCount=1", hosted_dry_run(root, video_id))
            self.assertEqual(selection.read_bytes(), original_selection)
            self.assertEqual(selection_receipt.read_bytes(), original_receipt)

            # A changed extraction with the same selected A+B needs no recovery.
            restaurants.pop()
            crawl_output.write_text(json.dumps({
                "restaurants": restaurants, "recollect_version": {"changed": True},
            }) + "\n", encoding="utf-8")
            complete(crawl_output.parent / ".receipts" / f"{video_id}.json", "input", [crawl_output])
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))
            self.assertEqual(selection.read_bytes(), original_selection)
            self.assertEqual(selection_receipt.read_bytes(), original_receipt)

    def test_hosted_partial_requires_valid_transform_snapshot(self) -> None:
        video_id = "abcdefghijk"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _crawling, _selection, transformed = certified_partial_video(root, video_id)
            original = transformed.read_bytes()
            self.assertIn("partialRecoveryVideoCount=1", hosted_dry_run(root, video_id))
            transformed.write_bytes(original + b"{}\n")
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))
            transformed.write_bytes(original)
            (transformed.parent / ".receipts/transform.json").unlink()
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))

    def test_stale_recalculation_rejects_input_change_during_read(self) -> None:
        video_id = "abcdefghijk"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, _selection, _transformed = certified_partial_video(root, video_id)
            crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
            crawl_output.write_text(json.dumps({"restaurants": [
                {"origin_name": name, "address": f"address {name}"} for name in ("A", "B", "C")
            ]}) + "\n", encoding="utf-8")
            receipt = crawl_output.parent / ".receipts" / f"{video_id}.json"
            complete(receipt, "input", [crawl_output])

            def change_input(*_args: object) -> set[str]:
                crawl_output.write_text(json.dumps({"restaurants": [
                    {"origin_name": name, "address": f"address {name}"} for name in ("A", "B", "D")
                ]}) + "\n", encoding="utf-8")
                complete(receipt, "input", [crawl_output])
                return {"A", "B", "C"}

            with patch.object(module, "_current_09_targets", side_effect=change_input) as recalculate:
                self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))
            recalculate.assert_called_once()

    def test_certified_all_false_selection_recovers_new_current_target(self) -> None:
        video_id = "abcdefghijk"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, selection, transformed = certified_partial_video(root, video_id)
            crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
            crawl_receipt = crawl_output.parent / ".receipts" / f"{video_id}.json"
            selection_receipt = selection.parent / ".receipts" / f"{video_id}.json"
            not_selection = selection.parent.parent / "notSelection" / f"{video_id}.jsonl"
            not_selection.parent.mkdir(parents=True)
            old_restaurants = [{"origin_name": "A", "address": None}]
            crawl_output.write_text(json.dumps({"restaurants": old_restaurants}) + "\n", encoding="utf-8")
            complete(crawl_receipt, "input", [crawl_output])
            previous_row = json.dumps({"evaluation_target": {"A": False},
                                       "restaurants": old_restaurants}) + "\n"
            selection.write_text(previous_row, encoding="utf-8")
            not_selection.write_text(previous_row, encoding="utf-8")
            old_input_hash = fingerprint([crawl_output], assets=[module.SCRIPTS["target"]], settings="tzuyang")
            complete(selection_receipt, old_input_hash, [selection, not_selection])
            transformed.write_bytes(b"")
            (transformed.parent / ".receipts/transform.json").write_text(json.dumps({
                "schemaVersion": 2, "recordCount": 0,
                "outputHash": hashlib.sha256(b"").hexdigest(), "groups": {},
            }), encoding="utf-8")
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))

            crawl_output.write_text(json.dumps({"restaurants": old_restaurants + [
                {"origin_name": "C", "address": "address C"},
            ]}) + "\n", encoding="utf-8")
            complete(crawl_receipt, "input", [crawl_output])
            previous_selection = selection.read_bytes()
            previous_receipt = selection_receipt.read_bytes()
            self.assertIn("partialRecoveryVideoCount=1", hosted_dry_run(root, video_id))
            self.assertEqual(selection.read_bytes(), previous_selection)
            self.assertEqual(selection_receipt.read_bytes(), previous_receipt)

            malformed = json.dumps({"evaluation_target": {"A": False, " ": False}}) + "\n"
            selection.write_text(malformed, encoding="utf-8")
            not_selection.write_text(malformed, encoding="utf-8")
            complete(selection_receipt, old_input_hash, [selection, not_selection])
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))
            selection_receipt.unlink()
            self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))

    def test_hosted_partial_rejects_mixed_invalid_selection_targets(self) -> None:
        video_id = "abcdefghijk"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, selection, _transformed = certified_partial_video(root, video_id)
            evaluation = root / "backend/restaurant-evaluation/data/tzuyang"
            crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
            receipt = selection.parent / ".receipts" / f"{video_id}.json"
            expected = fingerprint([crawl_output], assets=[module.SCRIPTS["target"]], settings="tzuyang")
            for targets in ({"A": True, " ": True}, {"A": True, "B": 1}):
                with self.subTest(targets=targets):
                    selection.write_text(json.dumps({"evaluation_target": targets}) + "\n", encoding="utf-8")
                    complete(receipt, expected, [selection])
                    self.assertFalse(module._hosted_partial_recovery_has_evidence(
                        crawling, evaluation, video_id, module._transformed_names(evaluation), "tzuyang"
                    ))
                    self.assertIn("newVideoCount=0", hosted_dry_run(root, video_id))

    def test_fresh_videos_take_priority_and_uncertified_hosted_is_excluded(self) -> None:
        partial_id = "abcdefghijk"
        unproven_id = "uuuuuuuuuuu"
        fresh_ids = ("nnnnnnnnnnn", "mmmmmmmmmmm")
        urls_after = [f"https://www.youtube.com/watch?v={video_id}"
                      for video_id in (partial_id, unproven_id, *fresh_ids)]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling, selection, _transformed = certified_partial_video(root, partial_id)
            urls = crawling / "urls.txt"
            urls.write_text(urls_after[0] + "\n", encoding="utf-8")
            original_urls = urls.read_bytes()

            def collect(_argv: list[str], _env: dict[str, str], *, required: bool = True) -> int:
                urls.write_text("\n".join(urls_after) + "\n", encoding="utf-8")
                return 0

            def dry_run(limit: int) -> str:
                output = io.StringIO()
                with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
                    patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(
                        ["hosted-A", "hosted-unknown"], [partial_id, unproven_id]
                    )), \
                    patch.object(module, "_run", side_effect=collect), contextlib.redirect_stdout(output):
                    self.assertEqual(module.main(["--limit", str(limit), "--dry-run"]), 0)
                self.assertEqual(urls.read_bytes(), original_urls)
                return output.getvalue()

            self.assertIn(f"newVideoIds=['{fresh_ids[0]}']", dry_run(1))
            all_selected = dry_run(3)
            self.assertIn(f"newVideoIds=['{fresh_ids[0]}', '{fresh_ids[1]}', '{partial_id}']", all_selected)
            self.assertIn("partialRecoveryVideoCount=1", all_selected)
            # A damaged selection cannot authorize hosted re-evaluation.
            selection.write_text("{}\n", encoding="utf-8")
            self.assertIn(f"newVideoIds=['{fresh_ids[0]}', '{fresh_ids[1]}']", dry_run(3))
            # A certified but empty target set is also insufficient evidence.
            selection.write_text(json.dumps({"evaluation_target": {}}) + "\n", encoding="utf-8")
            complete(selection.parent / ".receipts" / f"{partial_id}.json", "input", [selection])
            self.assertIn(f"newVideoIds=['{fresh_ids[0]}', '{fresh_ids[1]}']", dry_run(3))

    def test_full_fresh_limit_does_not_inspect_later_hosted_evidence(self) -> None:
        fresh_id = "nnnnnnnnnnn"
        hosted_id = "abcdefghijk"
        urls_after = [f"https://www.youtube.com/watch?v={video_id}"
                      for video_id in (fresh_id, hosted_id)]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            crawling = root / "backend/restaurant-crawling/data/tzuyang"
            urls = crawling / "urls.txt"
            urls.parent.mkdir(parents=True)
            urls.write_text(urls_after[1] + "\n", encoding="utf-8")
            original_urls = urls.read_bytes()

            def collect(_argv: list[str], _env: dict[str, str], *, required: bool = True) -> int:
                urls.write_text("\n".join(urls_after) + "\n", encoding="utf-8")
                return 0

            output = io.StringIO()
            with patch.object(module, "REPO_ROOT", root), patch.object(module, "assert_hosted_target"), \
                patch.object(module, "fetch_hosted_restaurant_snapshot", return_value=(["hosted-A"], [hosted_id])), \
                patch.object(module, "_run", side_effect=collect), \
                patch.object(module, "_hosted_partial_recovery_has_evidence") as inspect_hosted, \
                contextlib.redirect_stdout(output):
                self.assertEqual(module.main(["--limit", "1", "--dry-run"]), 0)
            inspect_hosted.assert_not_called()
            self.assertIn(f"newVideoIds=['{fresh_id}']", output.getvalue())
            self.assertEqual(urls.read_bytes(), original_urls)

    def test_transcript_failure_reports_retryable_video_and_restores_urls(self) -> None:
        video_url = "https://www.youtube.com/watch?v=abcdefghijk"
        previous_url = "https://www.youtube.com/watch?v=zzzzzzzzzzz"
        writes: list[list[str]] = []
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            return 9 if str(argv[1]).endswith("03-collect-transcript.js") else 0

        output = io.StringIO()
        with patch.object(module, "assert_hosted_target"), patch.object(
            module, "fetch_hosted_restaurant_snapshot", return_value=([], ["zzzzzzzzzzz"])
        ), patch.object(
            module, "_load_urls", side_effect=[[previous_url], [previous_url, video_url]]
        ), patch.object(module, "_write_urls", side_effect=lambda _path, urls: writes.append(urls)), patch.object(
            module, "_locally_evaluated_ids", return_value=set()
        ), patch.object(module, "_is_short_video", return_value=False), patch.object(
            module, "_run", side_effect=fake_run
        ), patch.object(module, "_transformed_names", return_value={}), patch.object(
            module, "_video_state", return_value="selection_incomplete"
        ), contextlib.redirect_stdout(output):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])

        self.assertEqual(code, 1)
        self.assertTrue(any(str(call[1]).endswith("03-collect-transcript.js") for call in calls))
        self.assertFalse(any("09-target-selection.py" in str(call[1]) for call in calls))
        self.assertIn(previous_url, writes[-1])
        self.assertIn(video_url, writes[-1])
        self.assertIn("videoFailed=abcdefghijk reasons=transcript_failed,selection_incomplete", output.getvalue())
        self.assertIn("failedVideoCount=1", output.getvalue())

    def test_rule_failure_cannot_be_masked_by_old_completed_outputs(self) -> None:
        video_url = "https://www.youtube.com/watch?v=abcdefghijk"

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            return 7 if str(argv[1]).endswith("10-rule-evaluation.py") else 0

        output = io.StringIO()
        with patch.object(module, "assert_hosted_target"), patch.object(
            module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
        ), patch.object(module, "_load_urls", side_effect=[[], [video_url]]), patch.object(
            module, "_write_urls"
        ), patch.object(module, "_locally_evaluated_ids", return_value=set()), patch.object(
            module, "_is_short_video", return_value=False
        ), patch.object(module, "certified", return_value=True), patch.object(
            module, "_video_state", return_value="completed"
        ), patch.object(module, "_transformed_names", return_value={}), patch.object(
            module, "_run", side_effect=fake_run
        ), contextlib.redirect_stdout(output):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])

        self.assertEqual(code, 1)
        self.assertIn("videoFailed=abcdefghijk reasons=rule_failed", output.getvalue())
        self.assertIn("completedVideoCount=0", output.getvalue())
        self.assertIn("failedVideoCount=1", output.getvalue())

    def test_latest_url_is_first_and_old_failed_url_remains_retryable(self) -> None:
        newest = "https://www.youtube.com/watch?v=nnnnnnnnnnn"
        old_failed = "https://www.youtube.com/watch?v=ooooooooooo"
        collected_calls: list[list[str]] = []
        urls = module.REPO_ROOT / "backend/restaurant-crawling/data/tzuyang/urls.txt"
        urls.parent.mkdir(parents=True)
        original = (old_failed + "\n").encode()
        urls.write_bytes(original)

        def fake_run(argv: list[str], _env: dict[str, str], *, required: bool = True) -> int:
            collected_calls.append(argv)
            return 0

        def dry_run(local_done: set[str]) -> str:
            output = io.StringIO()
            with patch.object(module, "assert_hosted_target"), patch.object(
                module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
            ), patch.object(
                module, "_load_urls", side_effect=[[old_failed], [newest, old_failed]]
            ), patch.object(
                module, "_locally_evaluated_ids", return_value=local_done
            ), patch.object(module, "_run", side_effect=fake_run), contextlib.redirect_stdout(output):
                self.assertEqual(module.main(["--limit", "1", "--dry-run"]), 0)
            self.assertEqual(urls.read_bytes(), original)
            return output.getvalue()

        self.assertIn("newVideoIds=['nnnnnnnnnnn']", dry_run(set()))
        self.assertIn("newVideoIds=['ooooooooooo']", dry_run({"nnnnnnnnnnn"}))
        self.assertTrue(all("--latest-first" in call for call in collected_calls))

    def test_invalid_channel_cannot_create_paths_or_read_hosted(self) -> None:
        with patch.object(module, "stage_lock") as lock, patch.object(
            module, "fetch_hosted_restaurant_snapshot"
        ) as fetch, contextlib.redirect_stdout(io.StringIO()):
            for channel in ("../escape", "/tmp/escape", "a/b", "a\\b", "", "a" * 65):
                with self.subTest(channel=channel):
                    self.assertEqual(module.main(["--channel", channel]), 2)
            lock.assert_not_called()
            fetch.assert_not_called()
            self.assertEqual(list(module.REPO_ROOT.iterdir()), [])

    def test_collection_failure_restores_urls_before_releasing_batch(self) -> None:
        urls = module.REPO_ROOT / "backend/restaurant-crawling/data/tzuyang/urls.txt"
        urls.parent.mkdir(parents=True)
        prior = "https://www.youtube.com/watch?v=aaaaaaaaaaa\n"
        urls.write_text(prior, encoding="utf-8")
        def failed_collect(_argv, _env, *, required=True):
            urls.write_text("https://www.youtube.com/watch?v=bbbbbbbbbbb\n", encoding="utf-8")
            return 7
        with patch.object(module, "assert_hosted_target"), patch.object(
            module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
        ), patch.object(module, "_run", side_effect=failed_collect) as run, \
            contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(module.main([]), 7)
            self.assertEqual(urls.read_text(encoding="utf-8"), prior)
            self.assertEqual(run.call_count, 1)

    def test_failed_or_dry_collection_preserves_exact_bytes_or_absence(self) -> None:
        urls = module.REPO_ROOT / "backend/restaurant-crawling/data/tzuyang/urls.txt"
        urls.parent.mkdir(parents=True)
        for prior in (None, b"  https://www.youtube.com/watch?v=aaaaaaaaaaa  \r\n\r\n"):
            for dry in (False, True):
                with self.subTest(prior_exists=prior is not None, dry=dry):
                    urls.unlink(missing_ok=True)
                    if prior is not None:
                        urls.write_bytes(prior)
                    def collect(_argv, _env, *, required=True):
                        urls.write_text("https://www.youtube.com/watch?v=bbbbbbbbbbb\n", encoding="utf-8")
                        return 0 if dry else 7
                    with patch.object(module, "assert_hosted_target"), patch.object(
                        module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
                    ), patch.object(module, "_run", side_effect=collect), \
                        contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(module.main(["--dry-run"] if dry else []), 0 if dry else 7)
                    if prior is None:
                        self.assertFalse(urls.exists())
                    else:
                        self.assertEqual(urls.read_bytes(), prior)

    def test_collection_interrupt_restores_prior_urls_and_preserves_exit(self) -> None:
        urls = module.REPO_ROOT / "backend/restaurant-crawling/data/tzuyang/urls.txt"
        urls.parent.mkdir(parents=True)
        prior = "https://www.youtube.com/watch?v=aaaaaaaaaaa\n"
        for interrupted in (KeyboardInterrupt(), SystemExit(9)):
            with self.subTest(exception=type(interrupted).__name__):
                urls.write_text(prior, encoding="utf-8")
                def collect(_argv, _env, *, required=True):
                    urls.write_text("https://www.youtube.com/watch?v=bbbbbbbbbbb\n", encoding="utf-8")
                    raise interrupted
                with patch.object(module, "assert_hosted_target"), patch.object(
                    module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
                ), patch.object(module, "_run", side_effect=collect), \
                    contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(type(interrupted)) as caught:
                        module.main([])
                    self.assertIs(caught.exception, interrupted)
                    self.assertEqual(urls.read_text(encoding="utf-8"), prior)

    def test_interrupted_child_exit_race_keeps_original_exception(self) -> None:
        child = Mock()
        child.wait.side_effect = [KeyboardInterrupt(), 0]
        child.kill.side_effect = ProcessLookupError()
        process = Mock()
        process.__enter__ = Mock(return_value=child)
        process.__exit__ = Mock(return_value=False)
        with patch.object(module.subprocess, "Popen", return_value=process):
            with self.assertRaises(KeyboardInterrupt):
                module._run(["unused-synthetic-child"], {})
        self.assertEqual(child.wait.call_count, 2)

    def test_rejects_invalid_limit(self) -> None:
        self.assertEqual(module.main(["--limit", "0"]), 2)
        self.assertEqual(module.main(["--limit", "9"]), 2)
    def test_optional_context_failure_does_not_prevent_downstream_attempt(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            joined = " ".join(argv)
            if "03-1-generate-transcript-context.py" in joined:
                if required:
                    raise SystemExit("context_should_be_optional")
                return 1
            return 0

        with patch.object(module, "assert_hosted_target"), patch.object(
            module,
            "fetch_hosted_restaurant_snapshot",
            return_value=([], []),
        ), patch.object(
            module,
            "_load_urls",
            side_effect=[
                [],
                ["https://www.youtube.com/watch?v=dNTE6DuEWGg"],
            ],
        ), patch.object(module, "_write_urls"), patch.object(
            module, "_locally_evaluated_ids", return_value=set()
        ), patch.object(module, "_run", side_effect=fake_run):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 1)  # mocked stages wrote no certified output
        self.assertTrue(any("08-chunk-multimodal-crawling.sh" in " ".join(call) for call in calls))

    def test_shorts_do_not_block_evaluation_of_the_other_videos(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            if "08-chunk-multimodal-crawling.sh" in " ".join(argv):
                if required:
                    raise SystemExit("chunk_failure_should_not_abort")
                return 1
            return 0

        marked: list[str] = []

        def mark(evaluation, video_id: str, reason: str) -> None:
            marked.append(video_id)
            self.assertEqual(reason, "shorts:is_shorts_le_180")

        with patch.object(module, "assert_hosted_target"), patch.object(
            module, "fetch_hosted_restaurant_snapshot", return_value=([], [])
        ), patch.object(
            module,
            "_load_urls",
            side_effect=[
                [],
                [
                    "https://www.youtube.com/watch?v=aaaaaaaaaaa",
                    "https://www.youtube.com/watch?v=bbbbbbbbbbb",
                    "https://www.youtube.com/watch?v=ccccccccccc",
                ],
            ],
        ), patch.object(module, "_write_urls"), patch.object(
            module, "_locally_evaluated_ids", return_value=set()
        ), patch.object(
            module, "_is_short_video", side_effect=lambda _crawling, video_id: video_id == "aaaaaaaaaaa"
        ), patch.object(
            module, "_mark_crawl_not_selected", side_effect=mark
        ), patch.object(module, "certified", return_value=True), patch.object(
            module, "_run", side_effect=fake_run
        ):
            code = module.main(["--channel", "tzuyang", "--limit", "3"])

        self.assertEqual(code, 1)  # mocked stages wrote no certified output
        self.assertEqual(marked, ["aaaaaaaaaaa"])
        evaluated = [
            call[call.index("--video-id") + 1]
            for call in calls
            if "--video-id" in call and str(call[1]).endswith("09-target-selection.py")
        ]
        self.assertEqual(evaluated, ["bbbbbbbbbbb", "ccccccccccc"])
    def test_laaj_script_keeps_absolute_evaluation_path(self) -> None:
        script = (
            ROOT
            / "backend"
            / "restaurant-evaluation"
            / "scripts"
            / "11-laaj-evaluation.sh"
        )
        text = script.read_text(encoding="utf-8")
        self.assertIn('if [[ "$EVALUATION_PATH" = /* ]]; then', text)
        self.assertIn('--video-id) VIDEO_ID_FILTER="$2"; shift 2 ;;', text)
        self.assertIn('VIDEO_IDS=("$VIDEO_ID_FILTER")', text)
        self.assertIn('FULL_EVALUATION_PATH="$EVALUATION_PATH"', text)
        self.assertIn(
            "Node.js API Health Check 실패 & Gemini CLI 미설치. Node API로 평가를 계속합니다.",
            text,
        )
        self.assertNotIn(
            "Node.js API Health Check 실패 & Gemini CLI 미설치. 평가를 건너뜁니다.",
            text,
        )
    def test_target_and_rule_accept_video_id(self) -> None:
        target = (
            ROOT / "backend/restaurant-evaluation/scripts/09-target-selection.py"
        ).read_text(encoding="utf-8")
        rule = (
            ROOT / "backend/restaurant-evaluation/scripts/10-rule-evaluation.py"
        ).read_text(encoding="utf-8")
        self.assertIn('--video-id', target)
        self.assertIn("if not requested and reusable(receipt, input_hash, existing_outputs)", target)
        self.assertIn('--video-id', rule)
        self.assertIn("if not requested and reusable(receipt, input_hash, [output_file])", rule)

    def test_shared_runner_calls_evaluate_then_apply(self) -> None:
        runner = (
            ROOT / "backend/bin/run_hosted_new_video_pipeline.py"
        ).read_text(encoding="utf-8")
        self.assertIn("evaluate_new_youtube_videos.py", runner)
        self.assertIn("apply_hosted_pending_candidates.py", runner)
        self.assertIn("TZUDONG_PIPELINE_SOURCE", runner)

if __name__ == "__main__":
    unittest.main()
