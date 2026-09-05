"""Offline contracts: no credentials, network, remote writes or raw publication."""
import base64
import contextlib
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch, MagicMock

from backend.bin import gdrive_frame_inventory as inv

ROOT = Path(__file__).resolve().parents[3]


def item(rel, size=10, mtime=1, md5="a" * 32):
    return {"relativePath": rel, "size": size, "mtimeEpoch": mtime, "md5": md5}


def expected(items):
    return {"schemaVersion": 1, "remoteRoot": inv.FRAMES, "expectedCount": len(items), "items": items}


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

    def test_exact_read_commands_capture_stderr_only_in_memory(self):
        for operation in ["inventory"]:
            child = MagicMock(); child.stdout = io.BytesIO(b"[]"); child.wait.return_value = 0; child.poll.return_value = 0
            child.stderr = io.BytesIO(b"")
            with patch.object(inv.subprocess, "Popen", return_value=child) as launch:
                self.assertEqual(inv.read_remote(operation, {"PATH": "/usr/bin:/bin"}), b"[]")
            args = launch.call_args.args[0]
            self.assertEqual(args[:6], ["rclone", "lsjson", inv.FRAMES, "--recursive", "--files-only", "--hash"])
            self.assertEqual(launch.call_args.kwargs["stderr"], subprocess.PIPE)
            self.assertFalse(launch.call_args.kwargs["shell"])
            self.assertIn("--drive-skip-shortcuts", args)
            self.assertEqual(args[args.index("--config") + 1], "/dev/null")
        with self.assertRaisesRegex(inv.InventoryError, "OPERATION_INVALID"):
            inv.read_remote("copy", {})
        with patch.object(inv.subprocess, "Popen") as launch:
            with self.assertRaisesRegex(inv.InventoryError, "OPERATION_INVALID"):
                inv.read_remote("expected", {})
            launch.assert_not_called()

    def test_transport_failure_and_oversize_do_not_retain_diagnostics(self):
        with patch.object(inv.subprocess, "Popen", side_effect=OSError("token=sentinel-private")):
            with self.assertRaisesRegex(inv.InventoryError, "^REMOTE_LAUNCH_FAILED$"):
                inv.read_remote("inventory", {})
        child = MagicMock(); child.stdout = io.BytesIO(b"12345"); child.poll.return_value = None
        child.stderr = io.BytesIO(b"")
        with patch.object(inv, "MAX_BYTES", 4), patch.object(inv.subprocess, "Popen", return_value=child):
            with self.assertRaisesRegex(inv.InventoryError, "INPUT_TOO_LARGE"):
                inv.read_remote("inventory", {})
        child.kill.assert_called_once()

    def test_nonzero_and_timeout_fail_closed_even_with_parseable_stdout(self):
        for timed_out in [False, True]:
            child = MagicMock(); child.stdout = io.BytesIO(b"[]")
            child.stderr = io.BytesIO(b"")
            child.wait.return_value = 0 if timed_out else 3; child.poll.return_value = 0
            timer = MagicMock()
            def make_timer(_seconds, callback):
                if timed_out:
                    timer.start.side_effect = callback
                return timer
            with patch.object(inv.subprocess, "Popen", return_value=child), patch.object(inv.threading, "Timer", side_effect=make_timer):
                with self.assertRaisesRegex(inv.InventoryError, "^REMOTE_TIMEOUT$" if timed_out else "^REMOTE_READ_FAILED$"):
                    inv.read_remote("inventory", {})
            timer.cancel.assert_called_once()
            timer.join.assert_called_once()

    def test_main_failure_redaction_and_drift_stops_transport(self):
        with patch.object(inv, "source_binding", return_value="a" * 40), patch.object(inv, "child_environment", return_value={}) as config, \
                patch.object(inv, "load_expected", side_effect=inv.InventoryError("EXPECTED_IDENTITY_DRIFT")), \
                patch.object(inv, "read_remote") as read, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inv.main(), 1)
        read.assert_not_called()
        config.assert_not_called()
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


class RemoteDiagnosticsTest(unittest.TestCase):
    def run_child(self, script):
        # Real OS pipes, entirely local child, no config or network access.
        popen = subprocess.Popen
        def launch(_args, **kwargs):
            return popen([sys.executable, "-B", "-c", script], **kwargs)
        with patch.object(inv.subprocess, "Popen", side_effect=launch):
            return inv.read_remote("inventory", {"PATH": "/usr/bin:/bin"})

    def test_fixed_marker_allowlist_and_unknown_fallback(self):
        for message, code in [
            (b"unknown flag: --private", "REMOTE_FLAG_UNSUPPORTED"),
            (b"oauth2: cannot fetch token: private", "REMOTE_AUTH_FAILED"),
            (b"invalid_grant: private", "REMOTE_AUTH_FAILED"),
            (b"insufficientPermissions: private", "REMOTE_PERMISSION_DENIED"),
            (b"userRateLimitExceeded: private", "REMOTE_RATE_LIMITED"),
            (b"directory not found: private", "REMOTE_PATH_NOT_FOUND"),
            (b"dial tcp: no such host: private", "REMOTE_NETWORK_FAILED"),
            (b"unknown provider failure with token=private", "REMOTE_READ_FAILED"),
        ]:
            with self.subTest(code=code):
                self.assertEqual(inv.remote_error_code(message), code)

    def test_stderr_flood_before_stdout_does_not_deadlock_or_escape(self):
        with patch.object(inv, "REMOTE_TIMEOUT_SECONDS", 5), self.assertRaises(inv.RemoteReadError) as caught:
            self.run_child("import os; os.write(2,b'invalid_grant token=sentinel-private\\n'); "
                           "[os.write(2,b'x'*4096) for _ in range(512)]; os.write(1,b'[]'); raise SystemExit(7)")
        self.assertEqual(str(caught.exception), "REMOTE_AUTH_FAILED")
        self.assertEqual(caught.exception.receipt, {"remoteStatus": "exited", "remoteExitCode": 7, "diagnosticTruncated": True})
        self.assertNotIn("sentinel", repr(caught.exception.__dict__))

    def test_prefix_cap_discards_late_markers_and_success_warnings(self):
        with patch.object(inv, "REMOTE_TIMEOUT_SECONDS", 5), self.assertRaises(inv.RemoteReadError) as caught:
            self.run_child("import os; os.write(2,b'x'*32768+b'invalid_grant'); raise SystemExit(1)")
        self.assertEqual(str(caught.exception), "REMOTE_READ_FAILED")
        self.assertTrue(caught.exception.receipt["diagnosticTruncated"])
        self.assertEqual(self.run_child("import os; os.write(2,b'invalid_grant sentinel'); os.write(1,b'[]')"), b"[]")

    def test_real_timeout_and_stdout_limit_reap_child(self):
        with patch.object(inv, "REMOTE_TIMEOUT_SECONDS", 0.2), self.assertRaises(inv.RemoteReadError) as caught:
            self.run_child("import time; time.sleep(10)")
        self.assertEqual(str(caught.exception), "REMOTE_TIMEOUT")
        self.assertEqual(caught.exception.receipt["remoteStatus"], "timed_out")
        self.assertEqual(caught.exception.receipt["remoteExitCode"], -9)
        with patch.object(inv, "MAX_BYTES", 3), patch.object(inv, "REMOTE_TIMEOUT_SECONDS", 5), \
                self.assertRaisesRegex(inv.InventoryError, "^INPUT_TOO_LARGE$"):
            self.run_child("import os,time; os.write(1,b'12345'); os.write(2,b'x'*65536); time.sleep(10)")

    def test_main_publishes_only_fixed_receipt_for_remote_failure(self):
        error = inv.RemoteReadError("REMOTE_AUTH_FAILED", "exited", 7, True)
        with patch.object(inv, "source_binding", return_value="a" * 40), \
                patch.object(inv, "load_expected", return_value=b"{}"), \
                patch.object(inv, "child_environment", return_value={}), \
                patch.object(inv, "read_remote", side_effect=error), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inv.main(), 1)
        report = json.loads(output.getvalue())
        self.assertEqual(set(report), {"schemaVersion", "status", "code", "sourceSha", "inputSha256",
                                     "validatorSourceSha256", "remoteStatus", "remoteExitCode", "diagnosticTruncated"})
        self.assertEqual(report["code"], "REMOTE_AUTH_FAILED")
        self.assertEqual(report["remoteExitCode"], 7)
        for value in [True, -129, 256, "private"]:
            self.assertIsNone(inv.RemoteReadError("REMOTE_READ_FAILED", "exited", value).receipt["remoteExitCode"])

    def test_stderr_read_failure_kills_child_and_redacts_exception(self):
        child = MagicMock(); child.stdout = io.BytesIO(b"[]")
        child.stderr.read.side_effect = OSError("token=sentinel-private")
        child.wait.return_value = -9; child.poll.return_value = -9
        with patch.object(inv.subprocess, "Popen", return_value=child), self.assertRaises(inv.RemoteReadError) as caught:
            inv.read_remote("inventory", {})
        self.assertEqual(str(caught.exception), "REMOTE_IO_FAILED")
        self.assertEqual(caught.exception.receipt["remoteStatus"], "io_failed")
        child.kill.assert_called_once()
        child.stderr.close.assert_called_once()
        self.assertTrue(child.stdout.closed)


class ImmutableExpectedTest(unittest.TestCase):
    def test_retained_fixture_exact_identity_and_minimal_fields(self):
        raw = inv.load_expected()
        self.assertEqual(len(raw), 22915062)
        self.assertEqual(inv.digest(raw), "a8df74b60b8e56f5438bcd9a038da4b410d5f586ec182a7bd9f29e4f74a94b1d")
        payload = inv.parse(raw)
        self.assertEqual(payload["expectedCount"], 192095)
        self.assertEqual(len({r["relativePath"] for r in payload["items"]}), 149645)
        self.assertEqual(sum(r["md5"] is None for r in payload["items"]), 191849)
        self.assertEqual(raw, inv.canonical(inv.expected_identity(payload)))

    def test_operational_metadata_rejected(self):
        for level in ("root", "item"):
            payload = expected([item("a")])
            (payload if level == "root" else payload["items"][0])["runId"] = "private"
            with self.assertRaises(inv.InventoryError):
                inv.expected_identity(payload)

    def test_missing_corrupt_and_oversized_compressed_source(self):
        corrupt = bytearray(inv.EXPECTED_FILE.read_bytes()); corrupt[20] ^= 1
        for content in (b"bad", bytes(corrupt), b"x" * (inv.EXPECTED_GZIP_BYTES + 1)):
            mocked = MagicMock()
            mocked.open.return_value.__enter__.return_value = io.BytesIO(content)
            with patch.object(inv, "EXPECTED_FILE", mocked), self.assertRaisesRegex(inv.InventoryError, "EXPECTED_GZIP_INTEGRITY"):
                inv.load_expected()
        mocked = MagicMock(); mocked.open.side_effect = OSError("private-path-token")
        with patch.object(inv, "EXPECTED_FILE", mocked), self.assertRaisesRegex(inv.InventoryError, "^EXPECTED_FILE_INVALID$"):
            inv.load_expected()

    def test_decompression_limit_crc_truncation_and_raw_integrity(self):
        good = gzip.compress(b"12345", mtime=0)
        corrupt = bytearray(good); corrupt[-8] ^= 1
        cases = [(good, 4, "EXPECTED_TOO_LARGE"), (good, 5, "EXPECTED_RAW_INTEGRITY"),
                 (good, 6, "EXPECTED_RAW_INTEGRITY"), (good[:-1], 5, "EXPECTED_FILE_INVALID"),
                 (bytes(corrupt), 5, "EXPECTED_FILE_INVALID")]
        for content, limit, code in cases:
            mocked = MagicMock(); mocked.open.return_value.__enter__.return_value = io.BytesIO(content)
            with self.subTest(code=code, limit=limit), patch.object(inv, "EXPECTED_FILE", mocked), \
                    patch.object(inv, "EXPECTED_GZIP_BYTES", len(content)), \
                    patch.object(inv, "EXPECTED_GZIP_SHA256", inv.digest(content)), \
                    patch.object(inv, "EXPECTED_RAW_BYTES", limit), self.assertRaisesRegex(inv.InventoryError, "^" + code + "$"):
                inv.load_expected()

    def test_mutable_remote_expected_is_never_used(self):
        def inventory_only(operation, env):
            self.assertEqual(operation, "inventory")
            return b"[]"
        with patch.object(inv, "source_binding", return_value="a" * 40), \
                patch.object(inv, "child_environment", return_value={}), \
                patch.object(inv, "read_remote", side_effect=inventory_only) as read, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(inv.main(), 2)
        read.assert_called_once_with("inventory", {})
        report = json.loads(output.getvalue())
        self.assertEqual(report["inputSha256"], inv.EXPECTED_IDENTITY_SHA256)
        self.assertEqual(report["counts"]["expectedCount"], 192095)
        self.assertEqual(report["counts"]["duplicateExpectedRowCount"], 84900)
        self.assertEqual(report["counts"]["conflictingExpectedSizePathCount"], 917)
        self.assertEqual(sum(report["counts"][key + "Count"] for key in report["manifestHashes"]), 192095)
        self.assertLess(len(output.getvalue()), 2000)
        self.assertNotIn("relativePath", output.getvalue())


class WorkflowGuardTest(unittest.TestCase):
    def test_invalid_dispatch_fails_and_retains_bounded_summary_before_credentials(self):
        import tempfile
        import textwrap
        text = (ROOT / ".github/workflows/gdrive-frame-inventory.yml").read_text()
        job = text.split("  inventory:\n", 1)[1].split("    steps:\n", 1)[0]
        self.assertNotIn("if:", job)
        step = text.split("      - name: Validate dispatch binding without credentials\n", 1)[1].split("      - name:", 1)[0]
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        self.assertLess(text.index("Validate dispatch binding"), text.index("Checkout exact protected main source"))
        for valid in ("true", "false", "", "unknown"):
            with self.subTest(valid=valid), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(["/bin/bash", "-c", script], capture_output=True, text=True,
                                        env={"PATH": os.environ["PATH"], "RUNNER_TEMP": directory, "BINDING_VALID": valid})
                path = Path(directory) / "gdrive-frame-inventory/summary.json"
                self.assertEqual(result.returncode, 0 if valid == "true" else 1)
                if valid == "true":
                    self.assertFalse(path.exists())
                else:
                    self.assertEqual(json.loads(path.read_text()), {"schemaVersion": 1, "status": "failed", "code": "SOURCE_BINDING_FAILED"})
                self.assertEqual(result.stdout, "")

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
