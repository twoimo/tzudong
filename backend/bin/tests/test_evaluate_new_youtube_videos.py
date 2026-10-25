#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import copy
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "backend" / "bin" / "evaluate_new_youtube_videos.py"
spec = importlib.util.spec_from_file_location("evaluate_new_youtube_videos", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

transform_spec = importlib.util.spec_from_file_location(
    "evaluate_new_video_transform", ROOT / "backend/restaurant-evaluation/scripts/12-transform.py"
)
transform = importlib.util.module_from_spec(transform_spec)
assert transform_spec and transform_spec.loader
transform_spec.loader.exec_module(transform)


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def terminal_rows(video_id: str, names: list[str]) -> list[dict]:
    """Real transform of complete negative Rule/LAAJ results, not approval."""
    payload = {
        'youtube_link': f'https://www.youtube.com/watch?v={video_id}',
        'evaluation_target': {name: True for name in names},
        'restaurants': [{'origin_name': name, 'address': 'fixture address'} for name in names],
        'evaluation_results': {
            'location_match_TF': [{'origin_name': name, 'eval_value': False, 'match_status': 'pending'} for name in names],
        },
    }
    for key, value in {
        'category_validity_TF': False, 'visit_authenticity': 0,
        'rb_inference_score': 0, 'rb_grounding_TF': False,
        'review_faithfulness_score': 0, 'category_TF': False,
    }.items():
        items = [{'name': name, 'eval_value': value, 'eval_basis': 'fixture evidence'} for name in names]
        payload['evaluation_results'][key] = {'values': items} if key == 'visit_authenticity' else items
    return transform.transform_json_object(payload, 'results', 'tzuyang')


class EvaluateNewYoutubeVideosTests(unittest.TestCase):
    def test_mixed_not_selection_transform_does_not_complete_selected_restaurant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evaluation = root / 'backend/restaurant-evaluation/data/tzuyang'
            video_id = 'abcdefghijk'
            selection = {
                'youtube_link': f'https://www.youtube.com/watch?v={video_id}',
                'evaluation_target': {'selected': True, 'unlocated': False},
                'restaurants': [
                    {'origin_name': 'selected', 'address': 'fixture address'},
                    {'origin_name': 'unlocated', 'address': None},
                ],
            }
            write_rows(evaluation / f'evaluation/selection/{video_id}.jsonl', [selection])
            write_rows(evaluation / f'evaluation/notSelection/{video_id}.jsonl', [selection])
            # This is the real 12-transform output when 09 succeeds but rule fails.
            rows = transform.transform_json_object(selection, 'notSelection', 'tzuyang')
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(row['is_notSelected'] is True for row in rows))
            write_rows(evaluation / 'evaluation/transforms.jsonl', rows)
            self.assertEqual(module._locally_evaluated_ids(evaluation), set())
            before = (evaluation / 'evaluation/transforms.jsonl').read_bytes()
            with patch.object(module, 'REPO_ROOT', root), patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_load_urls', return_value=[selection['youtube_link']]), \
                patch.object(module, '_write_urls') as writes, patch.object(module, '_run', return_value=0):
                self.assertEqual(module.main(['--limit', '1']), 1)
                self.assertEqual(writes.call_args.args[1], [selection['youtube_link']])
            self.assertEqual((evaluation / 'evaluation/transforms.jsonl').read_bytes(), before)

    def test_all_selected_names_need_complete_evaluation_but_negative_scores_are_terminal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evaluation = Path(tmp)
            video_id = 'abcdefghijk'
            selection = {'youtube_link': f'https://www.youtube.com/watch?v={video_id}',
                         'evaluation_target': {'first': True, 'second': True, 'unlocated': False}}
            write_rows(evaluation / f'evaluation/selection/{video_id}.jsonl', [selection])
            output = evaluation / 'evaluation/transforms.jsonl'
            rows = terminal_rows(video_id, ['first', 'second'])
            self.assertTrue(all(row['geocoding_success'] is False for row in rows))
            write_rows(output, rows[:1])
            self.assertEqual(module._locally_evaluated_ids(evaluation), set())
            write_rows(output, rows)
            self.assertEqual(module._locally_evaluated_ids(evaluation), {video_id})
            # Reusing terminal artifacts must not call a provider or re-run 09–12.
            with patch.object(module, 'REPO_ROOT', evaluation), \
                patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_fresh_locally_evaluated_ids', return_value={video_id}), \
                patch.object(module, '_load_urls', return_value=[selection['youtube_link']]), \
                patch.object(module, '_write_urls'), patch.object(module, '_run', return_value=0) as run:
                self.assertEqual(module.main(['--limit', '1']), 0)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0][1], str(module.SCRIPTS['collect_urls']))

    def test_selected_terminal_requires_canonical_values_and_rejects_fallbacks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evaluation = Path(tmp)
            video_id = 'abcdefghijk'
            write_rows(evaluation / f'evaluation/selection/{video_id}.jsonl', [{
                'youtube_link': f'https://www.youtube.com/watch?v={video_id}', 'evaluation_target': {'selected': True},
            }])
            good = terminal_rows(video_id, ['selected'])[0]
            variants = []
            for key in good['evaluation_results']:
                row = copy.deepcopy(good)
                del row['evaluation_results'][key]
                variants.append(row)
            for key, values in {
                'visit_authenticity': [None, True, '1', -1, 3, 10 ** 400, float('nan'), float('inf')],
                'rb_inference_score': [None, 3],
                'review_faithfulness_score': [None, 1.1],
                'rb_grounding_TF': [None, 0, 'false'],
                'category_TF': [None, 1],
                'category_validity_TF': [None, 1],
                'location_match_TF': [None, 1],
            }.items():
                for value in values:
                    row = copy.deepcopy(good)
                    row['evaluation_results'][key]['eval_value'] = value
                    variants.append(row)
            for flag in ('is_notSelected', 'is_missing'):
                variants.append({**good, flag: True})
            variants.append({**good, 'evaluation_results': None})
            failed = copy.deepcopy(good)
            failed['evaluation_results']['location_match_TF']['match_status'] = 'failed'
            variants.append(failed)
            for index, row in enumerate(variants):
                with self.subTest(variant=index):
                    write_rows(evaluation / 'evaluation/transforms.jsonl', [row])
                    self.assertEqual(module._locally_evaluated_ids(evaluation), set())

    def test_latest_selection_identity_and_names_control_terminal_reuse(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evaluation = Path(tmp)
            video_id = 'abcdefghijk'
            selection = {'youtube_link': f'https://www.youtube.com/watch?v={video_id}',
                         'evaluation_target': {'old': True}}
            path = evaluation / f'evaluation/selection/{video_id}.jsonl'
            write_rows(evaluation / 'evaluation/transforms.jsonl', terminal_rows(video_id, ['old']))
            write_rows(path, [selection])
            self.assertEqual(module._locally_evaluated_ids(evaluation), {video_id})
            for latest in [
                {**selection, 'evaluation_target': {'new': True}},
                {**selection, 'youtube_link': 'https://www.youtube.com/watch?v=bbbbbbbbbbb'},
                {**selection, 'evaluation_target': {'old': 'true'}},
                {**selection, 'evaluation_target': []},
            ]:
                write_rows(path, [selection, latest])
                self.assertEqual(module._locally_evaluated_ids(evaluation), set())
            path.write_text(json.dumps(selection) + '\n{')
            self.assertEqual(module._locally_evaluated_ids(evaluation), set())

    def test_orphan_transform_requires_every_row_to_be_terminal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evaluation = Path(tmp)
            video_id = 'abcdefghijk'
            output = evaluation / 'evaluation/transforms.jsonl'
            good = terminal_rows(video_id, ['complete'])[0]
            incomplete = {**good, 'origin_name': 'incomplete', 'trace_id': 'other',
                          'is_missing': True, 'evaluation_results': None}
            for rows in [[incomplete], [good, incomplete],
                         [good, {'youtube_link': good['youtube_link'], 'is_missing': True}]]:
                with self.subTest(rows=len(rows)):
                    write_rows(output, rows)
                    self.assertEqual(module._locally_evaluated_ids(evaluation), set())
            write_rows(output, [good])
            self.assertEqual(module._locally_evaluated_ids(evaluation), {video_id})

    def test_permanent_no_transcript_is_excluded_before_the_video_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            excluded, eligible = 'aaaaaaaaaaa', 'bbbbbbbbbbb'
            urls = [f'https://www.youtube.com/watch?v={video}' for video in (excluded, eligible)]
            ledger = root / 'backend/data/no_transcript_link/no_transcript_permanent.json'
            ledger.parent.mkdir(parents=True)
            ledger.write_text(json.dumps([{'youtube_link': urls[0], 'retry_num': 3}]))
            targets = []
            def run(argv, env, *, required=True):
                if str(module.SCRIPTS['target']) in argv:
                    video = argv[argv.index('--video-id') + 1]
                    targets.append(video)
                    write_rows(root / f'backend/restaurant-evaluation/data/tzuyang/evaluation/notSelection/{video}.jsonl', [{
                        'youtube_link': f'https://www.youtube.com/watch?v={video}',
                        'is_notSelected': True, 'notSelected_reason': 'no_restaurants',
                    }])
                return 0
            with patch.object(module, 'REPO_ROOT', root), patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_load_urls', return_value=urls), \
                patch.object(module, '_write_urls'), patch.object(module, '_run', side_effect=run):
                # The synthetic target alone has no producer receipts: not complete.
                self.assertEqual(module.main(['--limit', '1']), 1)
            self.assertEqual(targets, [eligible])

    def test_permanent_ledger_uses_valid_canonical_entries_and_any_qualifying_duplicate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'REPO_ROOT', Path(tmp)):
            ledger = Path(tmp) / 'backend/data/no_transcript_link/no_transcript_permanent.json'
            ledger.parent.mkdir(parents=True)
            url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
            qualified = {'youtube_link': url, 'retry_num': 3}
            first = {**qualified, 'retry_num': 1}
            invalid = [None, [], 'row', {}, *[{**qualified, 'retry_num': value}
                       for value in [None, True, '3', -1, 1, 2, float('inf')]],
                       {**qualified, 'youtube_link': 'aaaaaaaaaaa'},
                       {**qualified, 'youtube_link': 'https://youtu.be/aaaaaaaaaaa'},
                       {**qualified, 'youtube_link': url + '&extra=true'}]
            ledger.write_text(json.dumps(invalid))
            self.assertEqual(module._permanent_no_transcript_ids(), set())
            for duplicates in ([first, qualified], [qualified, first]):
                ledger.write_text(json.dumps(invalid + duplicates))
                self.assertEqual(module._permanent_no_transcript_ids(), {'aaaaaaaaaaa'})
            for content in ('{', '{}', 'null', ''):
                ledger.write_text(content)
                self.assertEqual(module._permanent_no_transcript_ids(), set())

    def test_first_no_transcript_does_not_exclude_or_complete_the_video(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'REPO_ROOT', Path(tmp)):
            url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
            ledger = Path(tmp) / 'backend/data/no_transcript_link/no_transcript_permanent.json'
            ledger.parent.mkdir(parents=True)
            ledger.write_text(json.dumps([{'youtube_link': url, 'retry_num': 1}]))
            before = ledger.read_bytes()
            with patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_load_urls', return_value=[url]), \
                patch.object(module, '_write_urls'), patch.object(module, '_run', return_value=0) as run:
                self.assertEqual(module.main(['--limit', '1']), 1)
                self.assertTrue(any(str(module.SCRIPTS['target']) in call.args[0] for call in run.call_args_list))
            self.assertEqual(ledger.read_bytes(), before)
            self.assertEqual(module._locally_evaluated_ids(Path(tmp)), set())

    def test_invalid_transform_json_fails_before_stages_and_preserves_original_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'REPO_ROOT', Path(tmp)):
            output = Path(tmp) / 'backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl'
            write_rows(output, terminal_rows('abcdefghijk', ['fixture']))
            output.write_bytes(output.read_bytes() + b'{')
            before = output.read_bytes()
            with patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_run') as run:
                self.assertEqual(module.main(['--limit', '1']), 2)
                run.assert_not_called()
            self.assertEqual(output.read_bytes(), before)

    def test_empty_successful_stages_do_not_complete_a_new_video(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'REPO_ROOT', Path(tmp)), \
            patch.object(module, 'assert_hosted_target'), \
            patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
            patch.object(module, '_load_urls', side_effect=[[], ['https://www.youtube.com/watch?v=abcdefghijk']]), \
            patch.object(module, '_write_urls') as writes, \
            patch.object(module, '_run', return_value=0):
            self.assertNotEqual(module.main(['--limit', '1']), 0)
            self.assertEqual(writes.call_args.args[1], ['https://www.youtube.com/watch?v=abcdefghijk'])

    def test_partial_failure_keeps_completed_artifacts_and_returns_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / 'backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl'
            def run(argv, env, *, required=True):
                if str(module.SCRIPTS['transform']) in argv:
                    output.parent.mkdir(parents=True)
                    output.write_text(json.dumps({'youtube_link': 'https://www.youtube.com/watch?v=abcdefghijk', 'trace_id': 'first', 'origin_name': 'fixture'}) + '\n')
                return 0
            with patch.object(module, 'REPO_ROOT', root), patch.object(module, 'assert_hosted_target'), \
                patch.object(module, 'fetch_hosted_restaurant_snapshot', return_value=([], [])), \
                patch.object(module, '_load_urls', side_effect=[[], ['https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/watch?v=bbbbbbbbbbb']]), \
                patch.object(module, '_write_urls'), patch.object(module, '_run', side_effect=run):
                self.assertNotEqual(module.main(['--limit', '2']), 0)
                self.assertEqual(json.loads(output.read_text())['trace_id'], 'first')

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
            module, "_fresh_locally_evaluated_ids", return_value={"FZoO4d0tU40"}
        ), patch.object(module, "_write_urls"), patch.object(
            module, "_run", side_effect=fake_run
        ):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertTrue(str(calls[0][1]).endswith("01-collect-urls.py"))

    def test_only_terminal_valid_identity_outcomes_are_reusable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "evaluation" / "selection").mkdir(parents=True)
            (root / "evaluation" / "notSelection").mkdir(parents=True)
            link = lambda video_id: f'https://www.youtube.com/watch?v={video_id}'
            (root / "evaluation" / "selection" / "aaaaaaaaaaa.jsonl").write_text(json.dumps({'youtube_link': link('aaaaaaaaaaa')}))
            skipped = {'youtube_link': link('bbbbbbbbbbb'), 'is_notSelected': True, 'notSelected_reason': 'no_restaurants'}
            skipped_path = root / 'evaluation/notSelection/bbbbbbbbbbb.jsonl'
            skipped_path.write_text(json.dumps(skipped) + '\n')
            transformed = terminal_rows('ccccccccccc', ['fixture'])[0]
            (root / 'evaluation/transforms.jsonl').write_text(json.dumps(transformed) + '\n')
            self.assertEqual(module._locally_evaluated_ids(root), {'bbbbbbbbbbb', 'ccccccccccc'})
            for invalid in [{}, {**skipped, 'youtube_link': link('ddddddddddd')}, {**skipped, 'is_notSelected': False},
                            {**skipped, 'notSelected_reason': ''}, {**skipped, 'evaluation_target': []},
                            {**skipped, 'evaluation_target': {'fixture': True}}]:
                skipped_path.write_text(json.dumps(invalid) + '\n')
                self.assertEqual(module._locally_evaluated_ids(root), {'ccccccccccc'})
            skipped_path.write_text(json.dumps(skipped) + '\n{')
            self.assertEqual(module._locally_evaluated_ids(root), {'ccccccccccc'})

    def test_rejects_invalid_limit(self) -> None:
        self.assertEqual(module.main(["--limit", "0"]), 2)
        self.assertEqual(module.main(["--limit", "9"]), 2)
    def test_continues_when_optional_context_fails(self) -> None:
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
            module, "_fresh_locally_evaluated_ids", side_effect=[set(), {'dNTE6DuEWGg'}]
        ), patch.object(module, "_run", side_effect=fake_run):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
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
            module, "_fresh_locally_evaluated_ids", side_effect=[set(), {'aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'}]
        ), patch.object(
            module, "_is_short_video", side_effect=lambda _crawling, video_id: video_id == "aaaaaaaaaaa"
        ), patch.object(
            module, "_mark_crawl_not_selected", side_effect=mark
        ), patch.object(module, "_run", side_effect=fake_run):
            code = module.main(["--channel", "tzuyang", "--limit", "3"])

        self.assertEqual(code, 0)
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
