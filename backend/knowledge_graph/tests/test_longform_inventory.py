import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.knowledge_graph import longform_analysis
from backend.knowledge_graph import longform_inventory as module


class LongformInventoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.inventory = self.root / "inventory.json"
        self.receipt = self.root / "receipt.json"

    def shard(self, tab, rows):
        document = {
            "canonicalSourceOrQueueChanged": False,
            "channelId": module.CHANNEL_ID,
            "entryCount": len(rows),
            "exitCode": 0,
            "noMediaOrCaptionsDownloaded": True,
            "noPlaylistLimit": True,
            "observedAtUtc": "2026-10-09T00:34:32+00:00",
            "rawPersonalContactFieldsPersisted": False,
            "rawResponseBytes": 123,
            "rawResponseSha256": hashlib.sha256(tab.encode()).hexdigest(),
            "reportedPlaylistCount": len(rows),
            "rows": rows,
            "schema": module.SHARD_SCHEMA,
            "sourceUrl": f"{module.CHANNEL_URL}/{tab}",
            "tab": tab,
        }
        path = self.root / f"{tab}.json"
        data = module.canonical(document)
        path.write_bytes(data)
        return path, module.sha256_bytes(data)

    @staticmethod
    def row(video_id, *, duration, live_status=None):
        return {"id": video_id, "duration": duration, "liveStatus": live_status, "channelId": None}

    def inputs(self):
        videos = self.shard("videos", [self.row("ABCDEFGHIJK", duration=61)])
        streams = self.shard("streams", [self.row("LMNOPQRSTUV", duration=7201, live_status="was_live")])
        shorts = self.shard("shorts", [self.row("WXYZabcdefg", duration=None)])
        return {
            "videos_path": videos[0], "videos_sha256": videos[1],
            "streams_path": streams[0], "streams_sha256": streams[1],
            "shorts_path": shorts[0], "shorts_sha256": shorts[1],
            "inventory_path": self.inventory, "receipt_path": self.receipt,
        }

    @staticmethod
    def analysis_args(inputs):
        return SimpleNamespace(
            inventory=None,
            inventory_sha256=None,
            expected_longform_count=None,
            expected_inventory_rows=None,
            membership_videos=inputs["videos_path"],
            membership_videos_sha256=inputs["videos_sha256"],
            membership_streams=inputs["streams_path"],
            membership_streams_sha256=inputs["streams_sha256"],
            membership_shorts=inputs["shorts_path"],
            membership_shorts_sha256=inputs["shorts_sha256"],
            materialized_inventory=inputs["inventory_path"],
            materialization_receipt=inputs["receipt_path"],
        )

    def active_stream_inputs(self, status="is_live"):
        args = self.inputs()
        streams, streams_hash = self.shard("streams", [
            self.row("LMNOPQRSTUV", duration=7201, live_status="was_live"),
            self.row("LIVEstream1", duration=None, live_status=status),
        ])
        args.update(streams_path=streams, streams_sha256=streams_hash)
        return args

    def overlapping_inputs(self):
        overlap = "ABCDEFGHIJK"
        videos = self.shard("videos", [
            self.row(overlap, duration=61),
            self.row("VIDEOkeep01", duration=62),
        ])
        streams = self.shard("streams", [
            self.row(overlap, duration=7201, live_status="was_live"),
            self.row("STREAMkeep1", duration=7202, live_status="was_live"),
        ])
        shorts = self.shard("shorts", [self.row(overlap, duration=None)])
        return overlap, {
            "videos_path": videos[0], "videos_sha256": videos[1],
            "streams_path": streams[0], "streams_sha256": streams[1],
            "shorts_path": shorts[0], "shorts_sha256": shorts[1],
            "inventory_path": self.inventory, "receipt_path": self.receipt,
        }

    def test_materializes_deterministically_and_analysis_admits_exact_longform(self):
        args = self.inputs()
        first = module.materialize(**args)
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        second = module.materialize(**args)
        self.assertFalse(first["reused"])
        self.assertTrue(second["reused"])
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))
        self.assertEqual(first["counts"], {
            "videos": 1, "completedStreams": 1, "shortsExcluded": 1,
            "eligibleLongform": 2, "inventoryRows": 3,
        })
        self.assertEqual(first["invariants"]["rawTabMembershipCounts"], {
            "videos": 1, "streams": 1, "shorts": 1,
        })
        readback = module.readback(self.inventory, self.receipt)
        self.assertEqual(readback["inventory"]["sha256"], module.sha256_bytes(before[0]))
        rows, info = longform_analysis.load_inventory(self.inventory)
        self.assertEqual(len(rows), 2)
        self.assertEqual((info["videoTabCount"], info["completedStreamCount"], info["excludedShorts"]), (1, 1, 1))

    def test_changed_pinned_input_changes_both_outputs(self):
        args = self.inputs()
        module.materialize(**args)
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        videos, videos_hash = self.shard("videos", [self.row("ABCDEFGHIJK", duration=62)])
        args.update(videos_path=videos, videos_sha256=videos_hash)
        result = module.materialize(**args)
        self.assertNotEqual(before[0], self.inventory.read_bytes())
        self.assertNotEqual(before[1], self.receipt.read_bytes())
        self.assertEqual(result["counts"]["eligibleLongform"], 2)

    def test_wrong_hash_and_partial_membership_preserve_existing_outputs(self):
        args = self.inputs()
        module.materialize(**args)
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        with self.assertRaisesRegex(module.MaterializationError, "INPUT_SHA256_MISMATCH"):
            module.materialize(**{**args, "videos_sha256": "0" * 64})
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))

        document = json.loads(args["videos_path"].read_text())
        document["noPlaylistLimit"] = False
        changed = module.canonical(document)
        args["videos_path"].write_bytes(changed)
        with self.assertRaisesRegex(module.MaterializationError, "SHARD_CONTRACT_INVALID"):
            module.materialize(**{**args, "videos_sha256": module.sha256_bytes(changed)})
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))

    def test_duplicate_duration_and_invalid_stream_status_are_rejected(self):
        cases = (
            ("SHARD_DUPLICATE_VIDEO_ID", "videos", [
                self.row("ABCDEFGHIJK", duration=60), self.row("ABCDEFGHIJK", duration=60)]),
            ("SHARD_DURATION_INVALID", "videos", [self.row("ABCDEFGHIJK", duration=None)]),
            ("STREAM_LIVE_STATUS_INVALID", "streams", [self.row("LMNOPQRSTUV", duration=60, live_status="not_live")]),
        )
        for code, tab, rows in cases:
            with self.subTest(code=code):
                args = self.inputs()
                path, digest = self.shard(tab, rows)
                args[f"{tab}_path"] = path
                args[f"{tab}_sha256"] = digest
                with self.assertRaisesRegex(module.MaterializationError, code):
                    module.materialize(**args)

    def test_active_stream_memberships_are_preserved_then_excluded_by_analysis(self):
        for status in ("is_live", "is_upcoming", "post_live"):
            with self.subTest(status=status):
                args = self.active_stream_inputs(status)
                inventory, validation = module.build_inventory(
                    args["videos_path"], args["videos_sha256"],
                    args["streams_path"], args["streams_sha256"],
                    args["shorts_path"], args["shorts_sha256"],
                )
                rows, info = longform_analysis.load_inventory(
                    self.inventory, data=module.canonical(inventory),
                )
                active = next(row for row in inventory["videos"] if row["videoId"] == "LIVEstream1")
                self.assertEqual(active["liveStatus"], status)
                self.assertEqual(active["membership"]["streams"]["liveStatus"], status)
                self.assertNotIn("durationSeconds", active)
                self.assertEqual({row["videoId"] for row in rows}, {"ABCDEFGHIJK", "LMNOPQRSTUV"})
                self.assertEqual(info["excludedLiveNotReady"], 1)
                self.assertEqual(info["excludedLiveStatusCounts"][status], 1)
                self.assertEqual(validation["counts"], {
                    "videos": 1, "completedStreams": 1, "shortsExcluded": 1,
                    "eligibleLongform": 2, "inventoryRows": 4,
                })

    def test_cross_tab_memberships_merge_and_shorts_exclusion_wins(self):
        overlap, args = self.overlapping_inputs()
        inventory, validation = module.build_inventory(
            args["videos_path"], args["videos_sha256"],
            args["streams_path"], args["streams_sha256"],
            args["shorts_path"], args["shorts_sha256"],
        )
        merged = next(row for row in inventory["videos"] if row["videoId"] == overlap)
        self.assertTrue(all(merged["membership"][tab] is not None for tab in module.TABS))
        self.assertEqual(merged["liveStatus"], "was_live")
        rows, info = longform_analysis.load_inventory(
            self.inventory, data=module.canonical(inventory),
        )
        self.assertEqual({row["videoId"] for row in rows}, {"VIDEOkeep01", "STREAMkeep1"})
        self.assertEqual((info["videoTabCount"], info["completedStreamCount"], info["excludedShorts"]), (1, 1, 1))
        self.assertEqual(validation["counts"], {
            "videos": 1, "completedStreams": 1, "shortsExcluded": 1,
            "eligibleLongform": 2, "inventoryRows": 3,
        })
        self.assertEqual(validation["invariants"]["pairwiseIntersectionCounts"], {
            "videosStreams": 1, "videosShorts": 1, "streamsShorts": 1,
        })
        self.assertEqual(validation["invariants"]["rawTabMembershipCounts"], {
            "videos": 2, "streams": 2, "shorts": 1,
        })

    def test_inventory_from_args_accepts_active_stream_exclusion_counts(self):
        rows, info = longform_analysis._inventory_from_args(
            self.analysis_args(self.active_stream_inputs()),
        )
        self.assertEqual({row["videoId"] for row in rows}, {"ABCDEFGHIJK", "LMNOPQRSTUV"})
        self.assertEqual((info["videoTabCount"], info["completedStreamCount"], info["excludedLiveNotReady"]), (1, 1, 1))
        self.assertEqual(info["membershipCounts"]["videos"], info["videoTabCount"])

    def test_inventory_from_args_accepts_overlap_with_consumer_aligned_counts(self):
        _, args = self.overlapping_inputs()
        rows, info = longform_analysis._inventory_from_args(self.analysis_args(args))
        self.assertEqual({row["videoId"] for row in rows}, {"VIDEOkeep01", "STREAMkeep1"})
        self.assertEqual((info["videoTabCount"], info["completedStreamCount"], info["excludedShorts"]), (1, 1, 1))
        self.assertEqual(info["membershipCounts"]["videos"], info["videoTabCount"])
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["invariants"]["rawTabMembershipCounts"], {
            "videos": 2, "streams": 2, "shorts": 1,
        })

    def test_oversized_inventory_is_rejected_before_existing_outputs_change(self):
        args = self.inputs()
        inventory, _ = module.build_inventory(
            args["videos_path"], args["videos_sha256"],
            args["streams_path"], args["streams_sha256"],
            args["shorts_path"], args["shorts_sha256"],
        )
        maximum = len(module.canonical(inventory)) - 1
        self.inventory.write_bytes(b"preserve inventory")
        self.receipt.write_bytes(b"preserve receipt")
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        with patch.object(module, "MAX_INVENTORY_BYTES", maximum):
            with self.assertRaisesRegex(module.MaterializationError, "INVENTORY_CAPACITY_EXCEEDED"):
                module.materialize(**args)
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))

    def test_corrupt_outputs_are_replaced_and_readback_rejects_partial_pair(self):
        args = self.inputs()
        module.materialize(**args)
        expected = (self.inventory.read_bytes(), self.receipt.read_bytes())
        self.inventory.write_bytes(b"{partial")
        with self.assertRaises(module.MaterializationError):
            module.readback(self.inventory, self.receipt)
        module.materialize(**args)
        self.assertEqual(expected, (self.inventory.read_bytes(), self.receipt.read_bytes()))
        self.receipt.write_bytes(b"{}")
        module.materialize(**args)
        self.assertEqual(expected, (self.inventory.read_bytes(), self.receipt.read_bytes()))

    def test_second_replace_failure_rolls_back_existing_pair(self):
        args = self.inputs()
        module.materialize(**args)
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        videos, videos_hash = self.shard("videos", [self.row("ABCDEFGHIJK", duration=62)])
        args.update(videos_path=videos, videos_sha256=videos_hash)
        original_replace = module.os.replace
        failed = False

        def fail_receipt_once(source, target):
            nonlocal failed
            if Path(target) == self.receipt and not failed:
                failed = True
                raise OSError("fixture failure")
            return original_replace(source, target)

        with patch.object(module.os, "replace", side_effect=fail_receipt_once):
            with self.assertRaisesRegex(module.MaterializationError, "MATERIALIZATION_COMMIT_FAILED"):
                module.materialize(**args)
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))
        self.assertEqual(list(self.root.glob(".pending-*")), [])

    def test_second_stage_failure_preserves_outputs_and_cleans_first_stage(self):
        args = self.inputs()
        module.materialize(**args)
        before = (self.inventory.read_bytes(), self.receipt.read_bytes())
        videos, videos_hash = self.shard("videos", [self.row("ABCDEFGHIJK", duration=62)])
        args.update(videos_path=videos, videos_sha256=videos_hash)
        original_stage = module._stage
        calls = 0

        def fail_second_stage(path, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("fixture stage failure")
            return original_stage(path, data)

        with patch.object(module, "_stage", side_effect=fail_second_stage):
            with self.assertRaisesRegex(module.MaterializationError, "MATERIALIZATION_STAGE_FAILED"):
                module.materialize(**args)
        self.assertEqual(before, (self.inventory.read_bytes(), self.receipt.read_bytes()))
        self.assertEqual(list(self.root.glob(".pending-*")), [])

    def test_output_and_lock_aliases_never_modify_source_shards(self):
        args = self.inputs()
        source_paths = tuple(args[f"{tab}_path"] for tab in module.TABS)
        original = {path: path.read_bytes() for path in source_paths}

        with self.assertRaisesRegex(module.MaterializationError, "INPUT_OUTPUT_PATH_CONFLICT"):
            module.materialize(**{**args, "inventory_path": args["videos_path"]})
        self.assertEqual(original, {path: path.read_bytes() for path in source_paths})

        os.link(args["videos_path"], self.inventory)
        with self.assertRaisesRegex(module.MaterializationError, "INPUT_OUTPUT_PATH_CONFLICT"):
            module.materialize(**args)
        self.assertEqual(original, {path: path.read_bytes() for path in source_paths})
        self.inventory.unlink()

        os.link(args["streams_path"], self.receipt)
        with self.assertRaisesRegex(module.MaterializationError, "INPUT_OUTPUT_PATH_CONFLICT"):
            module.materialize(**args)
        self.assertEqual(original, {path: path.read_bytes() for path in source_paths})
        self.receipt.unlink()

        lock_path = self.inventory.parent / f".{self.inventory.name}.materialize.lock"
        os.link(args["shorts_path"], lock_path)
        with self.assertRaisesRegex(module.MaterializationError, "INPUT_OUTPUT_PATH_CONFLICT"):
            module.materialize(**args)
        self.assertEqual(original, {path: path.read_bytes() for path in source_paths})
        lock_path.unlink()

    def test_symlink_output_is_rejected_without_touching_target(self):
        args = self.inputs()
        target = self.root / "target.json"
        target.write_text("preserve")
        self.inventory.symlink_to(target)
        with self.assertRaisesRegex(module.MaterializationError, "OUTPUT_INVALID"):
            module.materialize(**args)
        self.assertEqual(target.read_text(), "preserve")

    def test_longform_cli_requires_complete_pinned_membership_contract(self):
        args = self.inputs()
        model = self.root / "model.json"
        model.write_text(json.dumps({
            "sourceUrl": "https://ai.google.dev/api/models",
            "checkedAt": "2026-10-09T00:00:00Z",
            "name": "models/gemini-3.8-flash",
            "inputTokenLimit": 1000,
            "outputTokenLimit": 100,
        }))
        argv = [
            "--membership-videos", str(args["videos_path"]),
            "--membership-videos-sha256", args["videos_sha256"],
            "--membership-streams", str(args["streams_path"]),
            "--membership-streams-sha256", args["streams_sha256"],
            "--membership-shorts", str(args["shorts_path"]),
            "--membership-shorts-sha256", args["shorts_sha256"],
            "--materialized-inventory", str(self.inventory),
            "--materialization-receipt", str(self.receipt),
            "--state-dir", str(self.root / "state"),
            "--model", "gemini-3.8-flash",
            "--model-evidence", str(model),
        ]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(longform_analysis.main(argv), 0)
        plan = json.loads(output.getvalue())
        self.assertEqual(plan["longformVideoCount"], 2)
        self.assertEqual(plan["inventorySource"], "pinned_membership_shards")
        self.assertEqual(plan["membershipCounts"]["shortsExcluded"], 1)
        incomplete = list(argv)
        receipt_index = incomplete.index("--materialization-receipt")
        del incomplete[receipt_index:receipt_index + 2]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(longform_analysis.main(incomplete), 2)

        pinned = [
            "--inventory", str(self.inventory),
            "--inventory-sha256", module.sha256_bytes(self.inventory.read_bytes()),
            "--state-dir", str(self.root / "state"),
            "--model", "gemini-3.8-flash", "--model-evidence", str(model),
        ]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(longform_analysis.main(pinned), 2)
            self.assertEqual(longform_analysis.main(pinned + [
                "--expected-longform-count", "1069",
                "--expected-inventory-rows", "1149",
            ]), 2)


class CurrentMembershipEquivalenceTests(unittest.TestCase):
    def test_current_memberships_materialize_the_verified_1071_population(self):
        project = Path(__file__).resolve().parents[3]
        shards = project / "apps/web/performance/longform-followthrough-20261009"
        expected_hashes = {
            "videos": "0bfc95e7dbcd45f02205ca4bd61b69145fb7196ab52052178a8c01006bfe7cbb",
            "streams": "619512bd137e62318ad443d9357efbfd6829c9bbe0acc4374fa473c812e5bfc5",
            "shorts": "b8eea784e4953a80e743dca5b5f30b05a8752a50585a2840940183eee3640d2f",
        }
        inventory, validation = module.build_inventory(
            shards / "fresh-videos-membership.json", expected_hashes["videos"],
            shards / "fresh-streams-membership.json", expected_hashes["streams"],
            shards / "fresh-shorts-membership.json", expected_hashes["shorts"],
        )
        self.assertEqual(validation["counts"], {
            "videos": 1053, "completedStreams": 18, "shortsExcluded": 81,
            "eligibleLongform": 1071, "inventoryRows": 1152,
        })
        self.assertEqual(validation["invariants"]["pairwiseIntersectionCounts"], {
            "videosStreams": 0, "videosShorts": 0, "streamsShorts": 0,
        })
        expected = Path("/Users/twoimo/.codex/runtime-cache/tzudong-longform-current-1071-h1051_q9/inventory-current-1071.json")
        if expected.is_file():
            self.assertEqual(module.canonical(inventory), expected.read_bytes())
            self.assertEqual(module.sha256_bytes(expected.read_bytes()),
                             "c94fcf5236af9388ad47ce984f993f42c157c5633417743f8d9b64d1a73cbd73")


if __name__ == "__main__":
    unittest.main()
