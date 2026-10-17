"""Deterministic local coverage for caption preparation; no provider or vault."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

from backend.knowledge_graph import caption_osk_adapter as c
from backend.knowledge_graph import osk_projection as projection


def video_id(prefix, index):
    return f"{prefix}{index:010d}"


class FakeApi:
    def __init__(self, engine):
        self.engine = engine
        self.calls = []
        self.interrupt_once = False
        self.before_update = None
        self.after_update = None

    def update_node(self, *, name, body, expect_hash):
        if self.before_update:
            self.before_update(name)
        node = self.engine.nodes[name]
        if node["hash"] != expect_hash:
            raise RuntimeError("cas")
        self.calls.append(name)
        node["body"] = body
        node["hash"] = "sha256:" + c.digest(body.encode())
        if self.after_update:
            self.after_update(name)
        if self.interrupt_once:
            self.interrupt_once = False
            raise KeyboardInterrupt("synthetic interruption after committed update")


class FakeEngine:
    def __init__(self, root, video_ids):
        self.lock = root / "fake-engine.lock"
        self.nodes = {}
        self.read_hook = None
        for index, vid in enumerate(video_ids, 1):
            name = "YT-tzuyang-Video-" + vid
            body = "# Caption source\n\nCaption conflicts remain unresolved.\n"
            self.nodes[name] = {
                "name": name,
                "path": c.SPACE + "/" + name + ".md",
                "id": f"synthetic-{index}",
                "hash": "sha256:" + c.digest(body.encode()),
                "body": body,
                "meta": {
                    "summary": "Unverified synthetic captions",
                    "derived-from": f"[[https://www.youtube.com/watch?v={vid}]]",
                    "updated": "before",
                },
            }
        self.api = FakeApi(self)

    def read(self, name):
        if self.read_hook:
            self.read_hook(name)
        value = self.nodes.get(name)
        return copy.deepcopy(value) if value else None


class Fixture:
    def __init__(self, root, *, videos, streams=(), shorts=()):
        self.root = root
        self.channel = root / "channel"
        (self.channel / "source" / "analysis").mkdir(parents=True)
        self.memberships = {}
        rows = {
            "videos": [{"id": vid, "duration": 100, "liveStatus": None, "channelId": None} for vid in videos],
            "streams": [{"id": vid, "duration": 100, "liveStatus": "was_live", "channelId": None} for vid in streams],
            "shorts": [{"id": vid, "duration": None, "liveStatus": None, "channelId": None} for vid in shorts],
        }
        for tab in ("videos", "streams", "shorts"):
            path = root / (tab + ".json")
            path.write_text(json.dumps({
                "schema": "synthetic-membership/v1",
                "tab": tab,
                "channelId": c.CHANNEL_ID,
                "entryCount": len(rows[tab]),
                "rows": rows[tab],
            }))
            self.memberships[tab] = path

    def add_review(self, vid, *, content="synthetic captions only\n", directory=None):
        folder = directory or vid
        versions = {}
        for key, language in (("ko", "ko"), ("koOrig", "ko-orig")):
            subtitle = f"source/corpus/subs/{vid}.{language}.vtt"
            transcript = f"source/analysis/{vid}/transcript.{language}.txt"
            for relative in (subtitle, transcript):
                path = self.channel / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content + language)
            versions[key] = {
                "subtitleFile": subtitle,
                "transcriptFile": transcript,
                "subtitleSha256": c.digest((self.channel / subtitle).read_bytes()),
                "transcriptSha256": c.digest((self.channel / transcript).read_bytes()),
            }
        review = self.channel / "source" / "analysis" / folder / "caption-review.json"
        review.parent.mkdir(parents=True, exist_ok=True)
        review.write_text(json.dumps({
            "videoId": vid,
            "title": "Synthetic title",
            "sourceVersions": versions,
            "visualStatus": "unverified",
        }))
        return review


class CaptionInventoryTests(unittest.TestCase):
    def test_deterministic_1071_inventory_stable_sort_and_bound(self):
        with tempfile.TemporaryDirectory(prefix="caption-1071-") as directory:
            root = Path(directory)
            videos = [video_id("V", index) for index in range(1053)]
            streams = [video_id("S", index) for index in range(18)]
            shorts = [video_id("H", index) for index in range(81)]
            # Input order is deliberately unrelated to target order.
            fixture = Fixture(root, videos=list(reversed(videos)), streams=list(reversed(streams)), shorts=shorts)
            selected = [videos[9], videos[1]]
            for vid in selected:
                fixture.add_review(vid)
            engine = FakeEngine(root, selected)

            first = c.plan(engine, fixture.channel, fixture.memberships, 1)
            second = c.plan(engine, fixture.channel, dict(reversed(list(fixture.memberships.items()))), 1)

            self.assertEqual(first, second)
            coverage = first["coverageRevision"]
            self.assertEqual(coverage["eligibleCount"], 1071)
            self.assertEqual(coverage["shortsExcludedCount"], 81)
            self.assertEqual(coverage["eligibleCaptionReviewCount"], 2)
            self.assertEqual(coverage["eligibleWithoutCaptionCount"], 1069)
            self.assertEqual(first["selection"]["selectedVideoIds"], [videos[1]])
            self.assertEqual(first["selection"]["deferredCount"], 1)
            self.assertEqual(c.validate_plan(first), first["planSha256"])

    def test_new_changed_duplicate_missing_and_corrupt_caption_inputs(self):
        with tempfile.TemporaryDirectory(prefix="caption-inputs-") as directory:
            root = Path(directory)
            vids = [video_id("V", index) for index in range(3)]
            fixture = Fixture(root, videos=vids)
            fixture.add_review(vids[1])
            engine = FakeEngine(root, vids)

            missing = c.plan(engine, fixture.channel, fixture.memberships, 3)
            self.assertEqual(missing["coverageRevision"]["eligibleWithoutCaptionCount"], 2)
            self.assertEqual(missing["selection"]["selectedVideoIds"], [vids[1]])

            fixture.add_review(vids[0])
            new = c.plan(engine, fixture.channel, fixture.memberships, 3)
            self.assertNotEqual(new["coverageRevision"]["sourceSetSha256"], missing["coverageRevision"]["sourceSetSha256"])
            self.assertEqual(new["selection"]["selectedVideoIds"], [vids[0], vids[1]])

            changed = fixture.channel / f"source/analysis/{vids[1]}/transcript.ko.txt"
            changed.write_text("changed after plan")
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_SOURCE_HASH_MISMATCH"):
                c.apply(engine, fixture.channel, fixture.memberships, new, root / "checkpoints", 3)

            fixture.add_review(vids[1], directory=video_id("D", 1))
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_REVIEW_DUPLICATE"):
                c.source_inventory(fixture.channel, fixture.memberships)

        with tempfile.TemporaryDirectory(prefix="caption-corrupt-") as directory:
            root = Path(directory)
            vid = video_id("V", 1)
            fixture = Fixture(root, videos=[vid])
            review = fixture.channel / "source" / "analysis" / vid / "caption-review.json"
            review.parent.mkdir(parents=True)
            review.write_text('{"videoId":')
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_SOURCE_INVALID"):
                c.source_inventory(fixture.channel, fixture.memberships)

    def test_duplicate_membership_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="caption-membership-") as directory:
            root = Path(directory)
            vid = video_id("V", 1)
            fixture = Fixture(root, videos=[vid, vid])
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_COVERAGE_INVALID"):
                c.source_inventory(fixture.channel, fixture.memberships)

    def test_membership_parse_and_hash_use_one_byte_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="caption-membership-snapshot-") as directory:
            root = Path(directory)
            vid = video_id("V", 1)
            fixture = Fixture(root, videos=[vid])
            original = fixture.memberships["videos"].read_bytes()
            replacement = json.dumps({
                "tab": "videos", "channelId": c.CHANNEL_ID,
                "entryCount": 0, "rows": [],
            }).encode()
            read_file = c._read_anchored_file_snapshot

            def mutate_after_read(path, *args, **kwargs):
                data = read_file(path, *args, **kwargs)
                if Path(path) == fixture.memberships["videos"]:
                    fixture.memberships["videos"].write_bytes(replacement)
                return data

            with mock.patch.object(c, "_read_anchored_file_snapshot", side_effect=mutate_after_read):
                record, ids, admitted, _, data = c._membership_file(
                    fixture.memberships["videos"], "videos"
                )
            self.assertEqual(data, original)
            self.assertEqual(record["sha256"], c.digest(original))
            self.assertEqual(ids, {vid})
            self.assertEqual(admitted, {vid})
            self.assertEqual(fixture.memberships["videos"].read_bytes(), replacement)

    def test_membership_linked_parent_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="caption-membership-parent-link-") as directory:
            root = Path(directory)
            vid = video_id("V", 1)
            fixture = Fixture(root, videos=[vid])
            outside = root / "outside"
            outside.mkdir()
            external_membership = outside / "videos.json"
            external_membership.write_bytes(fixture.memberships["videos"].read_bytes())
            linked = root / "linked"
            linked.symlink_to(outside, target_is_directory=True)
            memberships = dict(fixture.memberships)
            memberships["videos"] = linked / "videos.json"

            with self.assertRaisesRegex(c.PublicationError, "CAPTION_COVERAGE_INVALID"):
                c.source_inventory(fixture.channel, memberships)

    def test_active_or_upcoming_membership_never_admits_longform(self):
        with tempfile.TemporaryDirectory(prefix="caption-active-live-") as directory:
            root = Path(directory)
            vids = [video_id("V", index) for index in range(4)]
            fixture = Fixture(root, videos=vids)
            for vid in vids:
                fixture.add_review(vid)
            videos = json.loads(fixture.memberships["videos"].read_text())
            for row, status in zip(videos["rows"], ("is_live", "is_upcoming", "post_live", None)):
                row["liveStatus"] = status
            fixture.memberships["videos"].write_text(json.dumps(videos))
            streams = json.loads(fixture.memberships["streams"].read_text())
            streams["rows"] = [{"id": vids[3], "liveStatus": "is_live", "channelId": None}]
            streams["entryCount"] = 1
            fixture.memberships["streams"].write_text(json.dumps(streams))

            coverage, candidates, _ = c.source_inventory(fixture.channel, fixture.memberships)
            self.assertEqual(coverage["eligibleCount"], 0)
            self.assertEqual(candidates, [])


class CaptionApplyTests(unittest.TestCase):
    def make_case(self, root, count=2):
        vids = [video_id("V", index) for index in range(count)]
        fixture = Fixture(root, videos=list(reversed(vids)))
        for vid in vids:
            fixture.add_review(vid)
        engine = FakeEngine(root, vids)
        return vids, fixture, engine, c.plan(engine, fixture.channel, fixture.memberships, count)

    def test_interruption_exact_resume_and_update_once(self):
        with tempfile.TemporaryDirectory(prefix="caption-resume-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root)
            engine.api.interrupt_once = True
            with self.assertRaises(KeyboardInterrupt):
                c.apply(engine, fixture.channel, fixture.memberships, saved, root / "checkpoints", 2)
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vids[0]])

            resumed = c.apply(engine, fixture.channel, fixture.memberships, saved, root / "checkpoints", 2)
            self.assertEqual(len(resumed["results"]), 2)
            self.assertTrue(resumed["results"][0]["reused"])
            self.assertFalse(resumed["independentFullVisualVerified"])
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vid for vid in vids])

            again = c.apply(engine, fixture.channel, fixture.memberships, saved, root / "checkpoints", 2)
            self.assertTrue(all(item["reused"] for item in again["results"]))
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vid for vid in vids])
            for vid in vids:
                metadata = projection._metadata(engine.read("YT-tzuyang-Video-" + vid)["body"])
                self.assertEqual(metadata["analysisStatus"], "pending")
                self.assertEqual(metadata["evidence"][0]["status"], "unverified")
                self.assertIsNone(metadata["evidence"][0]["endSeconds"])

    def test_apply_reads_each_mutable_source_once_then_resumes_from_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="caption-source-read-count-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=2)
            checkpoints = root / "checkpoints"
            read_file = c._read_file_snapshot
            read_membership = c._read_anchored_file_snapshot
            reads = []

            def count_read(path, *args, **kwargs):
                reads.append(Path(path))
                return read_file(path, *args, **kwargs)

            def count_membership(path, *args, **kwargs):
                reads.append(Path(path))
                return read_membership(path, *args, **kwargs)

            with mock.patch.object(c, "_read_file_snapshot", side_effect=count_read), \
                    mock.patch.object(c, "_read_anchored_file_snapshot", side_effect=count_membership):
                first = c.apply(
                    engine, fixture.channel, fixture.memberships, saved, checkpoints, 2
                )
            # Three memberships plus review/subtitle/transcript inputs (5 per video).
            self.assertEqual(len(reads), 13)
            self.assertEqual(len(reads), len(set(reads)))
            self.assertEqual(first["sourceSnapshot"]["mutableSourceReadCount"], 13)
            self.assertEqual(first["sourceSnapshot"]["manifestFileSha256Count"], 13)

            reads.clear()
            with mock.patch.object(c, "_read_file_snapshot", side_effect=count_read), \
                    mock.patch.object(c, "_read_anchored_file_snapshot", side_effect=count_membership):
                resumed = c.apply(
                    engine, fixture.channel, fixture.memberships, saved, checkpoints, 2
                )
            self.assertEqual(reads, [])
            self.assertEqual(resumed["sourceSnapshot"]["mutableSourceReadCount"], 0)
            self.assertTrue(all(item["reused"] for item in resumed["results"]))

    def test_cas_preimage_checks_whole_pending_set_before_write(self):
        with tempfile.TemporaryDirectory(prefix="caption-cas-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root)
            name = "YT-tzuyang-Video-" + vids[-1]
            engine.nodes[name]["body"] += "\nHuman addition"
            engine.nodes[name]["hash"] = "sha256:" + c.digest(engine.nodes[name]["body"].encode())
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_NODE_CHANGED"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, root / "checkpoints", 2)
            self.assertEqual(engine.api.calls, [])

    def test_registered_pilot_body_is_preserved_and_not_reselected(self):
        with tempfile.TemporaryDirectory(prefix="caption-preserve-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root)
            first = saved["targets"][0]
            name = first["name"]
            engine.nodes[name]["body"] = first["body"]
            engine.nodes[name]["hash"] = "sha256:" + c.digest(first["body"].encode())
            preserved = engine.nodes[name]["body"]

            next_plan = c.plan(engine, fixture.channel, fixture.memberships, 2)
            self.assertEqual(next_plan["selection"]["alreadyRegisteredCount"], 1)
            self.assertEqual(next_plan["selection"]["selectedVideoIds"], [vids[1]])
            self.assertEqual(engine.nodes[name]["body"], preserved)

    def test_stale_source_and_invalid_untimed_evidence_are_preserved_but_not_current(self):
        with tempfile.TemporaryDirectory(prefix="caption-stale-source-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root, count=1)
            target = saved["targets"][0]
            node = engine.nodes[target["name"]]
            node["body"] = target["body"]
            node["hash"] = "sha256:" + c.digest(node["body"].encode())
            fixture.add_review(vids[0], content="new valid source bytes\n")

            stale = c.plan(engine, fixture.channel, fixture.memberships, 1)
            self.assertEqual(stale["selection"]["alreadyRegisteredCount"], 0)
            self.assertEqual(stale["selection"]["staleRegisteredCount"], 1)
            self.assertEqual(stale["selection"]["selectedVideoIds"], [])
            self.assertEqual(engine.nodes[target["name"]]["body"], target["body"])

        with tempfile.TemporaryDirectory(prefix="caption-invalid-untimed-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=1)
            target = saved["targets"][0]
            invalid = target["body"].replace('"startSeconds":0', '"startSeconds":17', 1)
            engine.nodes[target["name"]]["body"] = invalid
            engine.nodes[target["name"]]["hash"] = "sha256:" + c.digest(invalid.encode())

            stale = c.plan(engine, fixture.channel, fixture.memberships, 1)
            self.assertEqual(stale["selection"]["alreadyRegisteredCount"], 0)
            self.assertEqual(stale["selection"]["staleRegisteredCount"], 1)
            self.assertEqual(engine.nodes[target["name"]]["body"], invalid)

    def test_membership_change_after_snapshot_uses_captured_revision(self):
        with tempfile.TemporaryDirectory(prefix="caption-membership-race-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=1)
            original_read = engine.read_hook
            fired = False

            def remove_target(_name):
                nonlocal fired
                if fired:
                    return
                fired = True
                fixture.memberships["videos"].write_text(json.dumps({
                    "tab": "videos", "channelId": c.CHANNEL_ID,
                    "entryCount": 0, "rows": [],
                }))

            engine.read_hook = remove_target
            result = c.apply(
                engine, fixture.channel, fixture.memberships, saved, root / "checkpoints", 1
            )
            engine.read_hook = original_read
            self.assertEqual(len(engine.api.calls), 1)
            self.assertEqual(result["sourceSnapshot"]["status"], "captured")
            self.assertEqual(
                result["sourceSnapshot"]["coverageRevision"],
                saved["coverageRevision"]["revision"],
            )
            self.assertFalse(result["sourceSnapshot"]["currentMutableSourcesCheckedAfterCapture"])

    def test_snapshot_survives_membership_change_and_resumes_once(self):
        with tempfile.TemporaryDirectory(prefix="caption-membership-resume-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root, count=2)
            changed_membership = json.dumps({
                "tab": "videos", "channelId": c.CHANNEL_ID,
                "entryCount": 0, "rows": [],
            }).encode()

            def change_after_first_update(_name):
                fixture.memberships["videos"].write_bytes(changed_membership)

            engine.api.after_update = change_after_first_update
            engine.api.interrupt_once = True
            checkpoints = root / "checkpoints"
            with self.assertRaises(KeyboardInterrupt):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 2)
            engine.api.after_update = None
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vids[0]])
            self.assertTrue((checkpoints / saved["planSha256"] / c.SOURCE_SNAPSHOT_FILE).is_file())
            self.assertEqual(fixture.memberships["videos"].read_bytes(), changed_membership)

            resumed = c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 2)
            self.assertTrue(resumed["results"][0]["reused"])
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vid for vid in vids])

    def test_update_entry_change_keeps_captured_snapshot_and_does_not_touch_external_files(self):
        with tempfile.TemporaryDirectory(prefix="caption-update-entry-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root, count=1)
            checkpoints = root / "checkpoints"
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "sentinel"
            sentinel.write_text("preserve")
            changed = json.dumps({
                "tab": "videos", "channelId": c.CHANNEL_ID,
                "entryCount": 2,
                "rows": [
                    {"id": vids[0], "duration": 100, "liveStatus": None, "channelId": None},
                    {"id": video_id("V", 99), "duration": 100, "liveStatus": None, "channelId": None},
                ],
            }).encode()

            def mutate_membership_at_update_entry(_name):
                fixture.memberships["videos"].write_bytes(changed)

            engine.api.before_update = mutate_membership_at_update_entry
            result = c.apply(
                engine, fixture.channel, fixture.memberships, saved, checkpoints, 1
            )
            self.assertEqual(engine.api.calls, ["YT-tzuyang-Video-" + vids[0]])
            self.assertEqual(fixture.memberships["videos"].read_bytes(), changed)
            self.assertEqual(sentinel.read_text(), "preserve")
            self.assertEqual(list(outside.glob("*.json")), [])
            self.assertEqual(
                result["sourceSnapshot"]["coverageRevision"],
                saved["coverageRevision"]["revision"],
            )
            snapshot = checkpoints / saved["planSha256"] / c.SOURCE_SNAPSHOT_FILE
            wrapper = json.loads(snapshot.read_text())
            self.assertEqual(
                wrapper["sha256"], c.digest(c.canonical(wrapper["payload"]).encode())
            )
            later = c.plan(engine, fixture.channel, fixture.memberships, 1)
            self.assertEqual(later["selection"]["alreadyRegisteredCount"], 0)
            self.assertEqual(later["selection"]["staleRegisteredCount"], 1)
            wrapper["payload"]["channelFiles"][0]["base64"] = "AA=="
            wrapper["sha256"] = c.digest(c.canonical(wrapper["payload"]).encode())
            snapshot.write_text(c.canonical(wrapper))
            with self.assertRaisesRegex(
                    c.PublicationError, "CAPTION_SOURCE_SNAPSHOT_INVALID"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            self.assertEqual(len(engine.api.calls), 1)
            self.assertEqual(sentinel.read_text(), "preserve")

    def test_checkpoint_plan_and_file_symlinks_never_escape_owned_root(self):
        with tempfile.TemporaryDirectory(prefix="caption-checkpoint-symlink-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=1)
            checkpoints = root / "checkpoints"
            checkpoints.mkdir(mode=0o700)
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "sentinel"
            sentinel.write_text("preserve")
            (checkpoints / saved["planSha256"]).symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_CHECKPOINT_INVALID"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            self.assertEqual(sentinel.read_text(), "preserve")
            self.assertEqual(engine.api.calls, [])
            self.assertEqual(list(outside.glob("*.json")), [])

        with tempfile.TemporaryDirectory(prefix="caption-checkpoint-file-symlink-") as directory:
            root = Path(directory)
            vids, fixture, engine, saved = self.make_case(root, count=1)
            checkpoints = root / "checkpoints"
            checkpoints.mkdir(mode=0o700)
            plan_directory = checkpoints / saved["planSha256"]
            plan_directory.mkdir(mode=0o700)
            external = root / "external.json"
            external.write_text("preserve")
            (plan_directory / (vids[0] + ".json")).symlink_to(external)
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_CHECKPOINT_CORRUPT"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            self.assertEqual(external.read_text(), "preserve")
            self.assertEqual(engine.api.calls, [])

    def test_concurrent_plan_directory_replacement_cannot_write_external_target(self):
        with tempfile.TemporaryDirectory(prefix="caption-checkpoint-race-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=1)
            checkpoints = root / "checkpoints"
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "sentinel"
            sentinel.write_text("preserve")

            def replace_plan_directory(_name):
                plan_directory = checkpoints / saved["planSha256"]
                plan_directory.rename(checkpoints / (saved["planSha256"] + ".moved"))
                plan_directory.symlink_to(outside, target_is_directory=True)

            engine.api.after_update = replace_plan_directory
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_CHECKPOINT_INVALID"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            self.assertEqual(sentinel.read_text(), "preserve")
            self.assertEqual(list(outside.glob("*.json")), [])
            self.assertEqual(len(engine.api.calls), 1)

    def test_corrupt_checkpoint_blocks_replay(self):
        with tempfile.TemporaryDirectory(prefix="caption-checkpoint-") as directory:
            root = Path(directory)
            _, fixture, engine, saved = self.make_case(root, count=1)
            checkpoints = root / "checkpoints"
            c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            checkpoint = next(checkpoints.rglob("*.json"))
            checkpoint.write_text("{}")
            with self.assertRaisesRegex(c.PublicationError, "CAPTION_CHECKPOINT_CORRUPT"):
                c.apply(engine, fixture.channel, fixture.memberships, saved, checkpoints, 1)
            self.assertEqual(len(engine.api.calls), 1)


class PrivateOutputTests(unittest.TestCase):
    def test_exact_0600_exclusive_output_under_permissive_and_restrictive_umask(self):
        with tempfile.TemporaryDirectory(prefix="tzudong-private-output-") as directory:
            for mask in (0o000, 0o777):
                with self.subTest(umask=mask):
                    path = Path(directory) / str(mask)
                    previous = os.umask(mask)
                    try:
                        c.write_private_output(path, {"synthetic": "자막"})
                    finally:
                        os.umask(previous)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                    before = path.read_bytes()
                    with self.assertRaises(FileExistsError):
                        c.write_private_output(path, {"replacement": True})
                    self.assertEqual(path.read_bytes(), before)
                    link = path.with_suffix(".link")
                    link.symlink_to(path)
                    with self.assertRaises(FileExistsError):
                        c.write_private_output(link, {"replacement": True})
                    self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
