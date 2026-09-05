"""Offline contracts: no credentials, network, remote writes or raw publication."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch, MagicMock

from backend.bin import gdrive_frame_inventory as inv

ROOT = Path(__file__).resolve().parents[3]


def item(rel, size=10, mtime=1, md5="a" * 32):
    value = {"relativePath": rel, "remotePath": inv.FRAMES + "/" + rel,
             "size": size, "mtimeEpoch": mtime, "dedupeKey": f"{rel}:{size}:{mtime}"}
    if md5 is not None:
        value["md5"] = md5
    return value


def expected(items):
    return {"schemaVersion": 2, "remoteRoot": inv.FRAMES, "expectedCount": len(items),
            "dedupeKey": "relativePath:size:mtime", "items": items}


def remote(rel, size=10, md5="a" * 32):
    return {"Path": rel, "Size": size, "IsDir": False, "Hashes": {} if md5 is None else {"MD5": md5}}


def validate(items, entries):
    source = expected(items)
    pin = inv.digest(inv.canonical(inv.expected_identity(source)))
    return inv.validate_inventory(inv.canonical(source), inv.canonical(entries), "a" * 40,
                                  expected_count=len(items), identity_pin=pin)


def encoded(text):
    return base64.b64encode(text.encode()).decode()


class InventoryValidationTest(unittest.TestCase):
    def test_reformatted_reordered_manifest_keeps_identity_not_raw_sha(self):
        source = expected([item("b.jpg"), item("a.jpg")])
        raw = inv.canonical(source)
        identity = inv.digest(inv.canonical(inv.expected_identity(source)))
        source["items"].reverse()
        pretty = json.dumps(source, indent=4).encode()
        self.assertNotEqual(inv.digest(raw), inv.digest(pretty))
        self.assertEqual(identity, inv.digest(inv.canonical(inv.expected_identity(inv.parse(pretty)))))
        report = inv.validate_inventory(pretty, inv.canonical([remote("a.jpg"), remote("b.jpg")]),
                                        "b" * 40, expected_count=2, identity_pin=identity)
        self.assertEqual(report["status"], "complete")
        self.assertEqual(report["counts"]["verifiedCount"], 2)
        self.assertNotIn("a.jpg", json.dumps(report))

    def test_identity_drift_in_path_size_mtime_or_hash_is_rejected(self):
        source = expected([item("a.jpg")])
        pin = inv.digest(inv.canonical(inv.expected_identity(source)))
        for changed in [item("b.jpg"), item("a.jpg", size=11), item("a.jpg", mtime=2), item("a.jpg", md5="b" * 32)]:
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(inv.InventoryError, "EXPECTED_IDENTITY_DRIFT"):
                    inv.validate_inventory(inv.canonical(expected([changed])), b"[]", "a" * 40,
                                           expected_count=1, identity_pin=pin)

    def test_count_conservation_and_hash_size_gaps(self):
        items = [item("a"), item("b"), item("c"), item("d"), item("e", md5=None), item("f")]
        result = validate(items, [remote("a"), remote("c", size=11), remote("d", md5="b" * 32),
                                  remote("e"), remote("f", md5=None), remote("extra")])
        counts = result["counts"]
        self.assertEqual([counts[k + "Count"] for k in ("verified", "missing", "mismatch", "unverified")], [1, 1, 2, 2])
        self.assertEqual(sum(counts[k + "Count"] for k in result["manifestHashes"]), counts["expectedCount"])
        self.assertEqual(counts["extraRemoteCount"], 1)
        self.assertEqual(counts["missingExpectedPathCount"], 1)
        self.assertEqual(counts["presentExpectedPathCount"], 5)
        self.assertEqual(result["status"], "gap")
        self.assertEqual(result["manifestHashes"]["verified"], inv.digest(inv.canonical(inv.expected_identity(expected([items[0]]))["items"])))

    def test_versioned_duplicate_paths_never_silently_collapse(self):
        result = validate([item("a", mtime=1), item("a", size=11, mtime=2)], [remote("a")])
        self.assertEqual(result["counts"]["unverifiedCount"], 2)
        self.assertEqual(result["counts"]["duplicateExpectedPathCount"], 1)
        self.assertEqual(result["counts"]["conflictingExpectedSizePathCount"], 1)
        self.assertEqual(result["counts"]["verifiedCount"], 0)
        self.assertEqual(result["counts"]["presentExpectedPathCount"], 1)
        with self.assertRaisesRegex(inv.InventoryError, "EXPECTED_DUPLICATE_IDENTITY"):
            validate([item("a"), item("a")], [])

    def test_duplicate_remote_paths_rejected_even_without_hash(self):
        for second in [remote("a"), remote("a", md5=None), remote("a", size=11)]:
            with self.assertRaisesRegex(inv.InventoryError, "INVENTORY_DUPLICATE_PATH"):
                validate([item("a")], [remote("a"), second])

    def test_path_hash_size_and_json_errors_fail_closed(self):
        for bad in ["../a", "/a", "a/../b", "a//b", "a\\b", "C:a", "a\n", "a/."]:
            with self.subTest(path=bad), self.assertRaisesRegex(inv.InventoryError, "PATH_INVALID"):
                inv.relative_path(bad)
        for bad in [True, -1, 1.5, "10", 2**53]:
            with self.assertRaisesRegex(inv.InventoryError, "SIZE_INVALID"):
                validate([item("a")], [remote("a", size=bad)])
        for bad in ["q" * 32, "a" * 31, 123]:
            with self.assertRaisesRegex(inv.InventoryError, "MD5_INVALID"):
                validate([item("a")], [remote("a", md5=bad)])
        for raw in [b'{"a":1,"a":2}', b'{"x":NaN}', b'\xff', b'[] trailing']:
            with self.assertRaises(inv.InventoryError):
                inv.parse(raw)
        with patch.object(inv, "MAX_BYTES", 3), self.assertRaisesRegex(inv.InventoryError, "INPUT_TOO_LARGE"):
            inv.parse(b"[123]")
        source = expected([item("a")]); source["expectedCount"] = 2
        with self.assertRaisesRegex(inv.InventoryError, "EXPECTED_CONTRACT_INVALID"):
            inv.expected_identity(source)
        entry = remote("a"); entry["Hashes"]["md5"] = "b" * 32
        with self.assertRaisesRegex(inv.InventoryError, "MD5_CONFLICT"):
            validate([item("a")], [entry])


class CredentialAndRunnerTest(unittest.TestCase):
    def test_only_selected_remote_reaches_child(self):
        config = "[gdrive]\ntype = drive\ntoken = sentinel-only-in-memory\n[other]\ntype = s3\nsecret_access_key = other-secret\n"
        with patch.dict(os.environ, {"RCLONE_CONFIG_OTHER_TYPE": "s3", "HTTPS_PROXY": "private", "GITHUB_TOKEN": "private"}):
            env = inv.child_environment(encoded(config))
        self.assertEqual(set(env), {"PATH", "RCLONE_CONFIG_GDRIVE_TYPE", "RCLONE_CONFIG_GDRIVE_TOKEN"})
        self.assertEqual(env["RCLONE_CONFIG_GDRIVE_TOKEN"], "sentinel-only-in-memory")

    def test_file_config_commands_defaults_and_wrong_remote_rejected(self):
        for config in ["[gdrive]\ntype=alias\nremote=elsewhere", "[gdrive]\ntype=drive\nservice_account_file=/private/key",
                       "[gdrive]\ntype=drive\ntoken=x\ntoken_command=echo secret", "[DEFAULT]\ntoken=x\n[gdrive]\ntype=drive",
                       "[gdrive]\ntype=drive\ntoken=x\ntoken=y", "[other]\ntype=drive\ntoken=x"]:
            with self.assertRaisesRegex(inv.InventoryError, "CONFIG_INVALID"):
                inv.child_environment(encoded(config))
        with self.assertRaisesRegex(inv.InventoryError, "CONFIG_INVALID"):
            inv.child_environment("not-base64")

    def test_exact_read_commands_discard_stderr_without_files(self):
        for operation in ["expected", "inventory"]:
            child = MagicMock(); child.stdout = io.BytesIO(b"[]"); child.wait.return_value = 0; child.poll.return_value = 0
            with patch.object(inv.subprocess, "Popen", return_value=child) as launch:
                self.assertEqual(inv.read_remote(operation, {"PATH": "/usr/bin:/bin"}), b"[]")
            args = launch.call_args.args[0]
            self.assertEqual(args[:3], ["rclone", "cat", inv.EXPECTED_REMOTE] if operation == "expected" else ["rclone", "lsjson", inv.FRAMES])
            self.assertEqual(launch.call_args.kwargs["stderr"], subprocess.DEVNULL)
            self.assertFalse(launch.call_args.kwargs["shell"])
            self.assertIn("--drive-skip-shortcuts", args)
            self.assertEqual(args[args.index("--config") + 1], "/dev/null")
        with self.assertRaisesRegex(inv.InventoryError, "OPERATION_INVALID"):
            inv.read_remote("copy", {})

    def test_transport_failure_and_oversize_do_not_retain_diagnostics(self):
        with patch.object(inv.subprocess, "Popen", side_effect=OSError("token=sentinel-private")):
            with self.assertRaisesRegex(inv.InventoryError, "^REMOTE_READ_FAILED$"):
                inv.read_remote("expected", {})
        child = MagicMock(); child.stdout = io.BytesIO(b"12345"); child.poll.return_value = None
        with patch.object(inv, "MAX_BYTES", 4), patch.object(inv.subprocess, "Popen", return_value=child):
            with self.assertRaisesRegex(inv.InventoryError, "INPUT_TOO_LARGE"):
                inv.read_remote("inventory", {})
        child.kill.assert_called_once()

    def test_nonzero_and_timeout_fail_closed_even_with_parseable_stdout(self):
        for timed_out in [False, True]:
            child = MagicMock(); child.stdout = io.BytesIO(b"[]")
            child.wait.return_value = 0 if timed_out else 3; child.poll.return_value = 0
            timer = MagicMock()
            def make_timer(_seconds, callback):
                if timed_out:
                    timer.start.side_effect = callback
                return timer
            with patch.object(inv.subprocess, "Popen", return_value=child), patch.object(inv.threading, "Timer", side_effect=make_timer):
                with self.assertRaisesRegex(inv.InventoryError, "^REMOTE_READ_FAILED$"):
                    inv.read_remote("inventory", {})
            timer.cancel.assert_called_once()
            timer.join.assert_called_once()

    def test_main_failure_redaction_and_drift_stops_second_call(self):
        with patch.object(inv, "source_binding", return_value="a" * 40), patch.object(inv, "child_environment", return_value={}), \
                patch.object(inv, "read_remote", return_value=inv.canonical(expected([item("a")]))) as read, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inv.main(), 1)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(json.loads(output.getvalue())["code"], "EXPECTED_IDENTITY_DRIFT")
        with patch.object(inv, "source_binding", side_effect=RuntimeError("token=sentinel-private")), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inv.main(), 1)
        self.assertNotIn("sentinel", output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["code"], "INVENTORY_FAILED")

    def test_protected_main_binding_rejects_other_contexts_and_sha(self):
        env = {"EXPECTED_MAIN_SHA": "a" * 40, "GITHUB_SHA": "a" * 40, "GITHUB_EVENT_NAME": "workflow_dispatch",
               "GITHUB_REF": "refs/heads/main", "GITHUB_REF_PROTECTED": "true", "GITHUB_REPOSITORY": "twoimo/tzudong"}
        with patch.object(inv.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"a" * 40 + b"\n")):
            self.assertEqual(inv.source_binding(env), "a" * 40)
            for key in env:
                with self.subTest(key=key), self.assertRaisesRegex(inv.InventoryError, "SOURCE_BINDING_FAILED"):
                    inv.source_binding({**env, key: "wrong"})
        with patch.object(inv.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"b" * 40)):
            with self.assertRaisesRegex(inv.InventoryError, "SOURCE_BINDING_FAILED"):
                inv.source_binding(env)


class WorkflowGuardTest(unittest.TestCase):
    def test_manual_exact_main_least_privilege_and_bounded_upload(self):
        text = (ROOT / ".github/workflows/gdrive-frame-inventory.yml").read_text()
        for required in ["workflow_dispatch:", "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'",
                         "github.ref_protected", "github.sha == inputs.main_sha", "contents: read", "persist-credentials: false",
                         "ref: ${{ github.sha }}", "python-version: '3.12.8'", "GDRIVE_RCLONE_CONFIG: ${{ secrets.GDRIVE_RCLONE_CONFIG }}",
                         "path: ${{ runner.temp }}/gdrive-frame-inventory/summary.json"]:
            self.assertIn(required, text)
        for forbidden in ["schedule:", "workflow_run:", "pull_request", "contents: write", "G037_WRITE_FREEZE", "continue-on-error:",
                          "rclone copy", "rclone sync", "rclone delete", "rclone.conf", "base64 -d", "status_scope:", "include-hidden-files: true"]:
            self.assertNotIn(forbidden, text)
        pins = [line.split("uses: ")[1].split(" #")[0] for line in text.splitlines() if "uses: " in line]
        self.assertEqual(pins, ["actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd", "actions/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405", "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"])
        backfill = (ROOT / ".github/workflows/gdrive-frame-backfill.yml").read_text()
        self.assertIn("vars.G037_WRITE_FREEZE == 'cleared'", backfill)
        self.assertIn("github.ref_protected", backfill)


if __name__ == "__main__":
    unittest.main()
