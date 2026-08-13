from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import py_compile
import stat
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).parents[3]
SOURCE = ROOT / "backend/supabase/scripts/prepare_hosted_ledger50_workspace.py"
SPEC = importlib.util.spec_from_file_location("hosted_workspace", SOURCE)
assert SPEC and SPEC.loader
workspace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workspace)


class HostedLedger50WorkspaceTests(unittest.TestCase):
    def test_git_binding_uses_pinned_git_and_sanitized_environment(self) -> None:
        commit = "a" * 40
        tree = "b" * 40
        outputs = iter(
            (
                commit,
                tree,
                "",
                "https://github.com/twoimo/tzudong.git",
                f"{commit}\trefs/heads/main",
            )
        )

        def run(*_args, **_kwargs):
            return MagicMock(stdout=next(outputs))

        with patch("subprocess.run", side_effect=run) as invoked:
            self.assertEqual(
                {"commit": commit, "tree": tree},
                workspace._git_binding(commit, tree),
            )
        self.assertEqual(5, invoked.call_count)
        for call in invoked.call_args_list:
            command = call.args[0]
            self.assertEqual(["/usr/bin/git", "-C", os.fspath(workspace.ROOT)], command[:3])
            self.assertNotIn("cwd", call.kwargs)
            self.assertEqual(
                {
                    "PATH": "/usr/bin:/bin",
                    "LC_ALL": "C",
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": "/dev/null",
                    "GIT_TERMINAL_PROMPT": "0",
                },
                call.kwargs["env"],
            )

    def test_dual_restore_loader_executes_pinned_source_not_poisoned_bytecode(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            source = Path(raw) / "validator.py"
            source.write_text("VALUE='cache!'\n", encoding="ascii")
            source.chmod(0o600)
            cached = Path(importlib.util.cache_from_source(os.fspath(source)))
            cached.parent.mkdir(mode=0o700)
            py_compile.compile(os.fspath(source), cfile=os.fspath(cached), doraise=True)
            source_info = source.stat()
            trusted = b"VALUE='source'\n"
            self.assertEqual(source_info.st_size, len(trusted))
            source.write_bytes(trusted)
            source.chmod(0o600)
            os.utime(
                source,
                ns=(source_info.st_atime_ns, source_info.st_mtime_ns),
            )
            with (
                patch.object(workspace, "DUAL_RESTORE_VALIDATOR", source),
                patch.object(
                    workspace,
                    "DUAL_RESTORE_VALIDATOR_SHA256",
                    hashlib.sha256(trusted).hexdigest(),
                ),
            ):
                loaded = workspace._dual_restore_module()
            self.assertEqual("source", loaded.VALUE)

    def test_source_contract_and_fail_closed_sentinels(self) -> None:
        pairs = workspace.predecessor_pairs()
        self.assertEqual(50, len(pairs))
        self.assertEqual(("20251219", "db_performance_optimization"), pairs[0])
        self.assertEqual(("20260804000500", "g041_auth_workflow_bridge"), pairs[-1])
        self.assertEqual(
            workspace.EXPECTED_PREDECESSOR_PAIR_SHA256,
            hashlib.sha256(
                json.dumps(pairs, ensure_ascii=True, separators=(",", ":")).encode()
            ).hexdigest(),
        )
        self.assertIn(b"RAISE EXCEPTION", workspace.SENTINEL)
        # The PL/pgSQL block has BEGIN, but it must never carry transaction
        # control that could commit a predecessor history row.
        self.assertNotIn("BEGIN;", workspace.SENTINEL.decode())
        self.assertNotIn("COMMIT", workspace.SENTINEL.decode())
        self.assertEqual(4, len(workspace.FORWARD_SOURCE_SHA256))

    def test_prepare_and_verify_exact_owner_only_workspace(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            target = parent / "workspace"
            receipt = workspace.prepare(target)
            self.assertEqual("hosted-ledger50-workspace-v1", receipt["schema"])
            self.assertEqual(50, receipt["predecessorCount"])
            self.assertEqual(4, receipt["forwardCount"])
            self.assertEqual(receipt, workspace.verify(target))
            migration_dir = target / "supabase/migrations"
            self.assertEqual(54, len(tuple(migration_dir.iterdir())))
            for path in (target, target / "supabase", migration_dir):
                self.assertEqual(0o700, stat.S_IMODE(path.lstat().st_mode))
            for path in migration_dir.iterdir():
                self.assertEqual(0o600, stat.S_IMODE(path.lstat().st_mode))
                self.assertEqual(1, path.lstat().st_nlink)

    def test_verify_rejects_missing_modified_extra_symlink_and_hardlink(self) -> None:
        scenarios = ("missing", "modified", "extra", "symlink", "hardlink")
        for scenario in scenarios:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory(
                dir=Path.home()
            ) as raw:
                parent = Path(raw).resolve()
                parent.chmod(0o700)
                target = parent / "workspace"
                workspace.prepare(target)
                migration_dir = target / "supabase/migrations"
                victim = migration_dir / next(iter(workspace.FORWARD_SOURCE_SHA256))
                if scenario == "missing":
                    victim.unlink()
                elif scenario == "modified":
                    victim.write_bytes(victim.read_bytes() + b"\n")
                    victim.chmod(0o600)
                elif scenario == "extra":
                    extra = migration_dir / "20260814010400_hosted_extra.sql"
                    extra.write_bytes(b"SELECT 1;\n")
                    extra.chmod(0o600)
                elif scenario == "symlink":
                    payload = victim.read_bytes()
                    victim.unlink()
                    other = parent / "outside.bin"
                    other.write_bytes(payload)
                    victim.symlink_to(other)
                else:
                    other = parent / "outside.bin"
                    os.link(victim, other)
                with self.assertRaises(workspace.WorkspaceError):
                    workspace.verify(target)

    def test_verify_rejects_extra_root_and_supabase_inputs(self) -> None:
        scenarios = ("root", "supabase")
        for scenario in scenarios:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory(
                dir=Path.home()
            ) as raw:
                parent = Path(raw).resolve()
                parent.chmod(0o700)
                target = parent / "workspace"
                workspace.prepare(target)
                extra = (
                    target / "roles.sql"
                    if scenario == "root"
                    else target / "supabase/roles.sql"
                )
                extra.write_text("-- forbidden extra input\n", encoding="utf-8")
                extra.chmod(0o600)
                with self.assertRaisesRegex(
                    workspace.WorkspaceError, "workspace_file_set_invalid"
                ):
                    workspace.verify(target)

    def test_prepare_rejects_unsafe_parent_and_existing_output(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o722)
            with self.assertRaisesRegex(workspace.WorkspaceError, "workspace_parent_invalid"):
                workspace.prepare(parent / "workspace")
            parent.chmod(0o700)
            existing = parent / "workspace"
            existing.mkdir()
            with self.assertRaisesRegex(workspace.WorkspaceError, "workspace_output_invalid"):
                workspace.prepare(existing)

    def test_validate_plan_requires_exact_four(self) -> None:
        plan = (
            "DRY RUN: migrations will *not* be pushed to the database.\n"
            "Would push these migrations:\n"
            + "".join(f" • {name}\n" for name in workspace.FORWARD_SOURCE_SHA256)
        ).encode()
        self.assertEqual(
            tuple(workspace.FORWARD_SOURCE_SHA256),
            workspace._validate_plan(plan, tuple(workspace.FORWARD_SOURCE_SHA256)),
        )
        with self.assertRaisesRegex(workspace.WorkspaceError, "dry_run_plan_invalid"):
            workspace._validate_plan(
                plan + b" * 20260814010400_extra.sql\n",
                tuple(workspace.FORWARD_SOURCE_SHA256),
            )

    def test_plan_and_ledger_admit_only_exact_remaining_prefix_suffix(self) -> None:
        rows = workspace._expected_forward_rows()
        names = tuple(workspace.FORWARD_SOURCE_SHA256)
        for prefix in range(5):
            with self.subTest(prefix=prefix):
                self.assertEqual(rows[:prefix], workspace._validated_forward_prefix(rows[:prefix]))
                remaining = names[prefix:]
                plan = (
                    "DRY RUN: migrations will *not* be pushed to the database.\n"
                    + "".join(f" • {name}\n" for name in remaining)
                ).encode()
                self.assertEqual(remaining, workspace._validate_plan(plan, remaining))
        with self.assertRaisesRegex(
            workspace.WorkspaceError, "remote_ledger_contract_invalid"
        ):
            workspace._validated_forward_prefix((rows[1],))
        drift = (rows[0][0], rows[0][1], rows[0][2], "0" * 64)
        with self.assertRaisesRegex(
            workspace.WorkspaceError, "remote_ledger_contract_invalid"
        ):
            workspace._validated_forward_prefix((drift,))

    def test_run_cli_uses_fixed_target_and_never_admits_optional_inputs(self) -> None:
        cli = Path("/private/owner/supabase")
        target = Path("/private/owner/workspace")
        pgpass = Path("/private/owner/.pgpass")
        completed = MagicMock(returncode=0, stdout=b"ok", stderr=b"")
        with patch("subprocess.run", return_value=completed) as run:
            workspace._run_cli(
                cli,
                target,
                "postgresql://postgres@db.example/postgres",
                pgpass,
                dry_run=True,
            )
            workspace._run_cli(
                cli,
                target,
                "postgresql://postgres@db.example/postgres",
                pgpass,
                dry_run=False,
            )
        commands = [item.args[0] for item in run.call_args_list]
        self.assertEqual(
            [
                str(cli), "--workdir", str(target), "db", "push", "--db-url",
                "postgresql://postgres@db.example/postgres", "--yes", "--dry-run",
            ],
            commands[0],
        )
        self.assertEqual(commands[0][:-1], commands[1])
        for command in commands:
            self.assertNotIn("--include-all", command)
            self.assertNotIn("--include-roles", command)
            self.assertNotIn("--include-seed", command)
            self.assertNotIn("migration", command)
            self.assertNotIn("repair", command)
        for invocation in run.call_args_list:
            self.assertEqual(target, invocation.kwargs["cwd"])
            self.assertEqual(str(pgpass), invocation.kwargs["env"]["PGPASSFILE"])

    def test_execute_orders_dry_run_reverify_push_and_terminal_readback(self) -> None:
        binding = {"commit": "a" * 40, "tree": "b" * 40}
        before = {
            "predecessorCount": 50,
            "predecessorStatementRoot": workspace.EXPECTED_PREDECESSOR_STATEMENT_ROOT,
            "forwardCount": 0,
            "forwardVersions": [],
        }
        after = {
            **before,
            "forwardCount": 4,
            "forwardVersions": list(workspace.FORWARD_VERSIONS),
        }
        plan = (
            "DRY RUN: migrations will *not* be pushed to the database.\n"
            + "".join(f" • {name}\n" for name in workspace.FORWARD_SOURCE_SHA256)
        ).encode()
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            output = parent / "receipt"
            events: list[str] = []

            ledger_values = iter((before, before, after))

            def ledger(_entries):
                value = next(ledger_values)
                events.append(f"ledger-{value['forwardCount']}")
                return value

            def run_cli(_cli, _workspace, _url, _pgpass, *, dry_run: bool):
                events.append("dry-run" if dry_run else "push")
                return plan if dry_run else b"push complete\n"

            def verify(_target):
                events.append("verify")
                return {}

            with (
                patch.object(workspace, "_require_external_path", side_effect=lambda path, **_: path),
                patch.object(workspace, "_git_binding", return_value=binding),
                patch.object(
                    workspace, "_validate_recovery_evidence",
                    return_value={"status": "passed"},
                ) as validate_recovery,
                patch.object(workspace, "verify", side_effect=verify),
                patch.object(workspace, "validate_cli"),
                patch.object(
                    workspace,
                    "_service_entries",
                    return_value={
                        "host": "db.example", "port": "5432", "dbname": "postgres",
                        "user": "postgres", "password": "secret",
                    },
                ) as service_entries,
                patch.object(workspace, "_database_url", return_value="postgresql://bound"),
                patch.object(workspace, "_remote_ledger", side_effect=ledger),
                patch.object(workspace, "_run_cli", side_effect=run_cli),
                patch.object(workspace, "_execute_readbacks", return_value={"fixture.sql": "c" * 64}),
            ):
                receipt = workspace.execute(
                    Path("/private/workspace"),
                    output,
                    Path("/private/supabase"),
                    Path("/private/service"),
                    "g035",
                    Path("/private/capture.json"),
                    Path("/private/dual.json"),
                    Path("/private/archive.age"),
                    Path("/private/docker"),
                    "a" * 40,
                    "b" * 40,
                    workspace.EXPECTED_PROJECT_REF,
                )
            self.assertEqual("applied-and-read-back", receipt["status"])
            self.assertEqual(
                [
                    "verify", "ledger-0", "dry-run", "verify", "ledger-0",
                    "verify", "push", "ledger-4", "verify",
                ],
                events,
            )
            self.assertEqual(3, validate_recovery.call_count)
            self.assertEqual(3, service_entries.call_count)
            self.assertFalse((output / ".pgpass").exists())
            self.assertTrue((output / "dry-run-receipt.json").is_file())
            self.assertTrue((output / "apply-receipt.json").is_file())

    def test_execute_never_pushes_after_invalid_dry_run(self) -> None:
        binding = {"commit": "a" * 40, "tree": "b" * 40}
        before = {
            "predecessorCount": 50,
            "predecessorStatementRoot": workspace.EXPECTED_PREDECESSOR_STATEMENT_ROOT,
            "forwardCount": 0,
            "forwardVersions": [],
        }
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            output = parent / "receipt"
            run_cli = MagicMock(return_value=b"not a dry run plan")
            with (
                patch.object(workspace, "_require_external_path", side_effect=lambda path, **_: path),
                patch.object(workspace, "_git_binding", return_value=binding),
                patch.object(workspace, "_validate_recovery_evidence", return_value={"status": "passed"}),
                patch.object(workspace, "verify", return_value={}),
                patch.object(workspace, "validate_cli"),
                patch.object(
                    workspace,
                    "_service_entries",
                    return_value={
                        "host": "db.example", "port": "5432", "dbname": "postgres",
                        "user": "postgres", "password": "secret",
                    },
                ),
                patch.object(workspace, "_database_url", return_value="postgresql://bound"),
                patch.object(workspace, "_remote_ledger", return_value=before),
                patch.object(workspace, "_run_cli", run_cli),
                self.assertRaisesRegex(workspace.WorkspaceError, "dry_run_plan_invalid"),
            ):
                workspace.execute(
                    Path("/private/workspace"), output, Path("/private/supabase"),
                    Path("/private/service"), "g035", Path("/private/capture.json"),
                    Path("/private/dual.json"), Path("/private/archive.age"),
                    Path("/private/docker"),
                    "a" * 40, "b" * 40,
                    workspace.EXPECTED_PROJECT_REF,
                )
            self.assertEqual(1, run_cli.call_count)
            self.assertTrue((output / "failure-receipt.json").is_file())

    def test_execute_failure_records_exact_partial_prefix_without_retry(self) -> None:
        binding = {"commit": "a" * 40, "tree": "b" * 40}
        versions = list(workspace.FORWARD_VERSIONS)
        prefix_two = {
            "predecessorCount": 50,
            "predecessorStatementRoot": workspace.EXPECTED_PREDECESSOR_STATEMENT_ROOT,
            "forwardCount": 2,
            "forwardVersions": versions[:2],
        }
        prefix_three = {
            **prefix_two,
            "forwardCount": 3,
            "forwardVersions": versions[:3],
        }
        remaining = tuple(workspace.FORWARD_SOURCE_SHA256)[2:]
        plan = (
            "DRY RUN: migrations will *not* be pushed to the database.\n"
            + "".join(f" • {name}\n" for name in remaining)
        ).encode()
        ledger_values = iter((prefix_two, prefix_two, prefix_three))
        run_calls: list[bool] = []

        def run_cli(_cli, _workspace, _url, _pgpass, *, dry_run: bool):
            run_calls.append(dry_run)
            if dry_run:
                return plan
            raise workspace.WorkspaceError("supabase_cli_execution_failed")

        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            output = parent / "receipt"
            with (
                patch.object(workspace, "_require_external_path", side_effect=lambda path, **_: path),
                patch.object(workspace, "_git_binding", return_value=binding),
                patch.object(workspace, "_validate_recovery_evidence", return_value={"status": "passed"}),
                patch.object(workspace, "verify", return_value={}),
                patch.object(workspace, "validate_cli"),
                patch.object(
                    workspace,
                    "_service_entries",
                    return_value={
                        "host": "db.example", "port": "5432", "dbname": "postgres",
                        "user": "postgres", "password": "secret",
                    },
                ),
                patch.object(workspace, "_database_url", return_value="postgresql://bound"),
                patch.object(workspace, "_remote_ledger", side_effect=lambda _entries: next(ledger_values)),
                patch.object(workspace, "_run_cli", side_effect=run_cli),
                self.assertRaisesRegex(
                    workspace.WorkspaceError, "supabase_cli_execution_failed"
                ),
            ):
                workspace.execute(
                    Path("/private/workspace"), output, Path("/private/supabase"),
                    Path("/private/service"), "g035", Path("/private/capture.json"),
                    Path("/private/dual.json"), Path("/private/archive.age"),
                    Path("/private/docker"),
                    "a" * 40, "b" * 40, workspace.EXPECTED_PROJECT_REF,
                )
            self.assertEqual([True, False], run_calls)
            failure = json.loads((output / "failure-receipt.json").read_text())
            self.assertFalse(failure["retryAttempted"])
            self.assertEqual("push", failure["stage"])
            self.assertEqual("exact-prefix-read-back", failure["postFailureRemote"]["status"])
            self.assertEqual(3, failure["postFailureRemote"]["forwardCount"])
            self.assertEqual(versions[:3], failure["postFailureRemote"]["forwardVersions"])
            self.assertFalse((output / ".pgpass").exists())

    def test_execute_terminal_prefix_is_readback_only(self) -> None:
        binding = {"commit": "a" * 40, "tree": "b" * 40}
        terminal = {
            "predecessorCount": 50,
            "predecessorStatementRoot": workspace.EXPECTED_PREDECESSOR_STATEMENT_ROOT,
            "forwardCount": 4,
            "forwardVersions": list(workspace.FORWARD_VERSIONS),
        }
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            output = parent / "receipt"
            run_cli = MagicMock()
            with (
                patch.object(workspace, "_require_external_path", side_effect=lambda path, **_: path),
                patch.object(workspace, "_git_binding", return_value=binding),
                patch.object(workspace, "_validate_recovery_evidence", return_value={"status": "passed"}),
                patch.object(workspace, "verify", return_value={}),
                patch.object(workspace, "validate_cli"),
                patch.object(
                    workspace,
                    "_service_entries",
                    return_value={
                        "host": "db.example", "port": "5432", "dbname": "postgres",
                        "user": "postgres", "password": "secret",
                    },
                ),
                patch.object(workspace, "_database_url", return_value="postgresql://bound"),
                patch.object(workspace, "_remote_ledger", return_value=terminal),
                patch.object(workspace, "_run_cli", run_cli),
                patch.object(workspace, "_execute_readbacks", return_value={"fixture.sql": "c" * 64}),
            ):
                receipt = workspace.execute(
                    Path("/private/workspace"), output, Path("/private/supabase"),
                    Path("/private/service"), "g035", Path("/private/capture.json"),
                    Path("/private/dual.json"), Path("/private/archive.age"),
                    Path("/private/docker"),
                    "a" * 40, "b" * 40, workspace.EXPECTED_PROJECT_REF,
                )
            run_cli.assert_not_called()
            self.assertEqual("already-applied-and-read-back", receipt["status"])
            self.assertFalse((output / "dry-run-receipt.json").exists())
            self.assertTrue((output / "apply-receipt.json").is_file())

    def test_success_is_not_written_when_credential_cleanup_fails(self) -> None:
        binding = {"commit": "a" * 40, "tree": "b" * 40}
        terminal = {
            "predecessorCount": 50,
            "predecessorStatementRoot": workspace.EXPECTED_PREDECESSOR_STATEMENT_ROOT,
            "forwardCount": 4,
            "forwardVersions": list(workspace.FORWARD_VERSIONS),
        }
        with tempfile.TemporaryDirectory(dir=Path.home()) as raw:
            parent = Path(raw).resolve()
            parent.chmod(0o700)
            output = parent / "receipt"
            with (
                patch.object(workspace, "_require_external_path", side_effect=lambda path, **_: path),
                patch.object(workspace, "_git_binding", return_value=binding),
                patch.object(workspace, "_validate_recovery_evidence", return_value={"status": "passed"}),
                patch.object(workspace, "verify", return_value={}),
                patch.object(workspace, "validate_cli"),
                patch.object(
                    workspace,
                    "_service_entries",
                    return_value={
                        "host": "db.example", "port": "5432", "dbname": "postgres",
                        "user": "postgres", "password": "secret",
                    },
                ),
                patch.object(workspace, "_remote_ledger", return_value=terminal),
                patch.object(workspace, "_execute_readbacks", return_value={"fixture.sql": "c" * 64}),
                patch.object(
                    workspace, "_remove_secret",
                    side_effect=workspace.WorkspaceError("credential_custody_failed"),
                ),
                self.assertRaisesRegex(workspace.WorkspaceError, "credential_custody_failed"),
            ):
                workspace.execute(
                    Path("/private/workspace"), output, Path("/private/supabase"),
                    Path("/private/service"), "g035", Path("/private/capture.json"),
                    Path("/private/dual.json"), Path("/private/archive.age"),
                    Path("/private/docker"),
                    "a" * 40, "b" * 40, workspace.EXPECTED_PROJECT_REF,
                )
            self.assertFalse((output / "apply-receipt.json").exists())
            failure = json.loads((output / "failure-receipt.json").read_text())
            self.assertEqual("credential_cleanup", failure["stage"])

    def test_recovery_evidence_binds_capture_archive_dual_restore_and_commit(self) -> None:
        commit = "a" * 40
        summary = {
            "schema": "local-dual-restore-rehearsal-v2",
            "status": "restored_compared_and_cleaned",
            "receiptSha256": "1" * 64,
            "sourceCommit": commit,
            "runtimeSourceRoot": "2" * 64,
            "captureReceiptSha256": "3" * 64,
            "archiveSha256": "4" * 64,
            "captureReceiptMtimeNs": 1_800_000_000_000_000_000,
            "archiveMtimeNs": 1_800_000_000_000_000_000,
            "ledgerCount": 50,
            "ledgerSha256": workspace.EXPECTED_PREDECESSOR_PAIR_SHA256,
            "restorableCatalogSha256": "5" * 64,
            "managedCatalogSha256": "6" * 64,
            "restoreRunReceiptIds": ["7" * 64, "8" * 64],
            "g035RestoreReceiptSha256": ["9" * 64, "9" * 64],
            "restoreReceiptBytesSha256": ["a" * 64, "b" * 64],
            "restoreReceiptMtimeNs": [
                1_800_000_000_000_000_000,
                1_800_000_000_000_000_001,
            ],
            "runtimeConfigurationSha256": [
                workspace.EXPECTED_RUNTIME_CONFIGURATION_SHA256,
                workspace.EXPECTED_RUNTIME_CONFIGURATION_SHA256,
            ],
            "postgresCustomTreeRoot": workspace.EXPECTED_POSTGRES_CUSTOM_TREE_ROOT,
            "cleanupReceiptSha256": "c" * 64,
            "cleanupLiveReadback": True,
            "observedAtUnixSeconds": 1_800_000_000,
            "hostedMutations": 0,
        }
        validator = MagicMock()
        validator.validate_dual_restore_receipt.return_value = summary
        with patch.object(workspace, "_dual_restore_module", return_value=validator):
            receipt = workspace._validate_recovery_evidence(
                Path("/private/capture.json"),
                Path("/private/dual.json"),
                Path("/private/archive.age"),
                commit,
                Path("/private/docker"),
            )
        self.assertEqual("4" * 64, receipt["archiveSha256"])
        self.assertFalse(receipt["managedPitrAvailable"])
        self.assertEqual(
            workspace.EXPECTED_RUNTIME_CONFIGURATION_SHA256,
            receipt["runtimeConfigurationSha256"],
        )
        self.assertEqual(
            workspace.EXPECTED_POSTGRES_CUSTOM_TREE_ROOT,
            receipt["postgresCustomTreeRoot"],
        )
        self.assertRegex(receipt["validationSummarySha256"], r"^[a-f0-9]{64}$")
        validator.validate_dual_restore_receipt.assert_called_once_with(
            Path("/private/dual.json"),
            Path("/private/capture.json"),
            Path("/private/archive.age"),
            workspace.ROOT,
            commit,
            docker_binary="/private/docker",
        )
        invalid = dict(summary)
        invalid["cleanupLiveReadback"] = False
        validator.validate_dual_restore_receipt.return_value = invalid
        with (
            patch.object(workspace, "_dual_restore_module", return_value=validator),
            self.assertRaisesRegex(workspace.WorkspaceError, "recovery_evidence_invalid"),
        ):
            workspace._validate_recovery_evidence(
                Path("/private/capture.json"), Path("/private/dual.json"),
                Path("/private/archive.age"), commit, Path("/private/docker"),
            )

        for key, value in (
            ("runtimeConfigurationSha256", ["0" * 64, "0" * 64]),
            ("postgresCustomTreeRoot", "0" * 64),
        ):
            invalid = dict(summary)
            invalid[key] = value
            validator.validate_dual_restore_receipt.return_value = invalid
            with (
                patch.object(workspace, "_dual_restore_module", return_value=validator),
                self.assertRaisesRegex(
                    workspace.WorkspaceError, "recovery_evidence_invalid"
                ),
            ):
                workspace._validate_recovery_evidence(
                    Path("/private/capture.json"), Path("/private/dual.json"),
                    Path("/private/archive.age"), commit, Path("/private/docker"),
                )

    def test_final_freeze_rejects_recovery_or_service_drift(self) -> None:
        entries = {
            "host": "db.example", "port": "5432", "dbname": "postgres",
            "user": "postgres", "password": "secret",
        }
        arguments = {
            "workspace": Path("/private/workspace"),
            "cli": Path("/private/supabase"),
            "service_file": Path("/private/service"),
            "service_name": "g035",
            "entries": entries,
            "pgpass": Path("/private/.pgpass"),
            "pgpass_data": b"bound",
            "capture_receipt": Path("/private/capture.json"),
            "dual_restore_receipt": Path("/private/dual.json"),
            "encrypted_archive": Path("/private/archive.age"),
            "docker": Path("/private/docker"),
            "expected_commit": "a" * 40,
            "expected_tree": "b" * 40,
            "recovery": {"validationSummarySha256": "c" * 64},
        }
        with (
            patch.object(workspace, "_git_binding"),
            patch.object(workspace, "validate_cli"),
            patch.object(workspace, "verify"),
            patch.object(workspace, "_forward_statement_contracts"),
            patch.object(workspace, "_verify_secret"),
            patch.object(workspace, "_service_entries", return_value=entries),
            patch.object(
                workspace, "_validate_recovery_evidence",
                return_value={"validationSummarySha256": "d" * 64},
            ),
            self.assertRaisesRegex(workspace.WorkspaceError, "recovery_evidence_invalid"),
        ):
            workspace._freeze_execution_inputs(**arguments)
        with (
            patch.object(workspace, "_git_binding"),
            patch.object(workspace, "validate_cli"),
            patch.object(workspace, "verify"),
            patch.object(workspace, "_forward_statement_contracts"),
            patch.object(workspace, "_verify_secret"),
            patch.object(
                workspace, "_service_entries",
                return_value={**entries, "host": "other.example"},
            ),
            self.assertRaisesRegex(workspace.WorkspaceError, "service_contract_invalid"),
        ):
            workspace._freeze_execution_inputs(**arguments)

    def test_database_probes_set_bounded_server_timeouts(self) -> None:
        psycopg = MagicMock()
        with patch.dict("sys.modules", {"psycopg": psycopg}):
            workspace._connect(
                {
                    "host": "db.example", "port": "5432", "dbname": "postgres",
                    "user": "postgres", "password": "secret", "sslmode": "verify-full",
                    "sslrootcert": "/private/ca.crt", "connect_timeout": "20",
                },
                autocommit=False,
            )
        options = psycopg.connect.call_args.kwargs["options"]
        self.assertIn("default_transaction_read_only=on", options)
        self.assertIn("statement_timeout=120000", options)
        self.assertIn("lock_timeout=5000", options)
        self.assertIn("idle_in_transaction_session_timeout=60000", options)

    def test_cli_database_url_sets_the_same_server_timeouts(self) -> None:
        url = workspace._database_url(
            {
                "host": "db.example", "port": "5432", "dbname": "postgres",
                "user": "postgres", "sslmode": "verify-full",
                "sslrootcert": "/private/ca.crt", "connect_timeout": "20",
            }
        )
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        self.assertEqual(["verify-full"], query["sslmode"])
        self.assertEqual(["/private/ca.crt"], query["sslrootcert"])
        self.assertEqual(["20"], query["connect_timeout"])
        self.assertEqual(
            [
                "-c statement_timeout=120000 -c lock_timeout=5000 "
                "-c idle_in_transaction_session_timeout=60000"
            ],
            query["options"],
        )


if __name__ == "__main__":
    unittest.main()
