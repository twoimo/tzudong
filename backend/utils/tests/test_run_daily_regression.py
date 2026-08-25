from __future__ import annotations

import argparse
import json
import errno
import io
import hashlib
import os
import shutil
import stat
import tarfile
import subprocess
import shlex
import textwrap
import time
from datetime import datetime, timezone
import unittest
from unittest import mock
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable, Optional
from backend.utils import run_daily_helpers


BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
RUN_DAILY_SOURCE = BACKEND_ROOT / "utils" / "tests" / "fixtures" / "run_daily.sh.legacy"
RUN_DAILY_HELPER_SOURCE = BACKEND_ROOT / "utils" / "run_daily_helpers.py"
ENV_CONTRACT_SOURCE = BACKEND_ROOT / "bin" / "check_env_contract.py"
PRODUCTION_FIXTURE_CHECK_SOURCE = BACKEND_ROOT / "bin" / "check_production_contract_fixtures.py"
ACTIONS_BUDGET_CHECK_SOURCE = BACKEND_ROOT / "bin" / "check_actions_budget.py"
DAILY_CRAWLER_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "daily-crawler.yml"
GDRIVE_BACKFILL_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "gdrive-frame-backfill.yml"
CHUNK_MULTIMODAL_SCRIPT = BACKEND_ROOT / "restaurant-crawling" / "scripts" / "08-chunk-multimodal-crawling.sh"
PUBLISHER_VALIDATOR_SOURCE = BACKEND_ROOT / "bin" / "validate_daily_publication_bundle.py"
PYTHON_BIN = os.environ.get("TZUDONG_TEST_PYTHON") or sys.executable
PRIVILEGED_SUPABASE_CLIENT_SOURCES = (
    BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "audit_refined_data_status.py",
    BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "validate_verified_place_correction_e2e.py",
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "02-video-caption-store-supabase.py",
)


def _resolve_bash_bin() -> str | None:
    override = os.environ.get("TZUDONG_TEST_BASH")
    if override:
        return override
    preferred = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
    ]
    for candidate in preferred:
        if Path(candidate).is_file():
            return candidate
    return shutil.which("bash") or shutil.which("bash.exe")


BASH_BIN = _resolve_bash_bin()


def _to_bash_path(path_value: Path | str) -> str:
    text = str(path_value)
    if os.name != "nt":
        return text
    normalized = Path(os.path.abspath(text)).as_posix()
    if len(normalized) >= 3 and normalized[1:3] == ":/":
        return f"/{normalized[0].lower()}{normalized[2:]}"
    return normalized





class GDriveUploadContractTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.frames_dir = self.root / "frames"
        self.frames_dir.mkdir()
        self.expected_path = self.root / "current-upload-expected.json"
        self.status_path = self.root / "current-upload-status.json"
        self.files_from_path = self.root / "current-upload-files-from.txt"
        self.residual_queue_path = self.root / "gdrive-upload-residual-queue.jsonl"
        self.run_id = "test-gdrive-run"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_gdrive_expected_manifest_includes_recent_frames_and_residual_retry(self) -> None:
        recent = self.frames_dir / "recent.jpg"
        old = self.frames_dir / "old.webp"
        recent.write_text("recent\n", encoding="utf-8")
        old.write_text("old\n", encoding="utf-8")
        old_time = time.time() - (3 * 60 * 60)
        os.utime(old, (old_time, old_time))
        old_stat = old.stat()
        old_item = {
            "relativePath": "old.webp",
            "size": old_stat.st_size,
            "mtimeEpoch": int(old_stat.st_mtime),
            "dedupeKey": f"old.webp:{old_stat.st_size}:{int(old_stat.st_mtime)}",
            "md5": hashlib.md5(old.read_bytes()).hexdigest(),
            "fileIdentity": {
                "device": old_stat.st_dev,
                "inode": old_stat.st_ino,
                "mtimeNs": old_stat.st_mtime_ns,
                "ctimeNs": old_stat.st_ctime_ns,
            },
            "required": True,
            "reason": "new_frame",
            "sourceState": "local",
            "state": "pending_local",
            "stagingShard": None,
            "remotePath": "gdrive:frames/old.webp",
        }
        queue_entry = {
            "schemaVersion": 2,
            "firstSeenAt": "2026-04-28T00:00:00Z",
            "firstSeenEpoch": int(time.time()),
            "lastAttemptAt": "2026-04-28T00:00:00Z",
            "attempts": 1,
            "lastExitCode": 124,
            "item": old_item,
        }
        self.residual_queue_path.write_text(
            json.dumps(queue_entry, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--remote-root",
            "gdrive:frames",
            "--recent-minutes",
            "120",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.assertEqual(2, expected["expectedCount"])
        self.assertEqual(["old.webp", "recent.jpg"], [item["relativePath"] for item in expected["items"]])
        self.assertEqual("residual_retry", expected["items"][0]["reason"])
        self.assertEqual("old.webp\nrecent.jpg\n", "".join(sorted(self.files_from_path.read_text(encoding="utf-8").splitlines(True))))

    def test_gdrive_remote_verification_requires_matching_md5(self) -> None:
        frame = self.frames_dir / "verified.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        remote_list_path = self.root / "remote-list.json"
        proof_path = self.root / "remote-proof.json"
        verified_path = self.root / "verified-remote.txt"
        remote_list_path.write_text(
            json.dumps(
                [
                    {
                        "Path": "verified.jpg",
                        "Size": expected["items"][0]["size"],
                        "Hashes": {"MD5": expected["items"][0]["md5"]},
                    },
                    {
                        "Path": "stale-same-size.jpg",
                        "Size": expected["items"][0]["size"],
                        "Hashes": {"MD5": "00000000000000000000000000000000"},
                    },
                ],
                sort_keys=True,
            ),
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-remote-verification",
            "--expected-manifest",
            str(self.expected_path),
            "--remote-list",
            str(remote_list_path),
            "--output",
            str(proof_path),
            "--verified-files-output",
            str(verified_path),
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        self.assertEqual(run_daily_helpers.REMOTE_VERIFICATION_RECEIPT_TYPE, proof["receiptType"])
        self.assertEqual(self.run_id, proof["runId"])
        self.assertEqual(64, len(proof["expectedManifestSha256"]))
        self.assertEqual(1, proof["verifiedCount"])
        self.assertEqual(2, proof["remoteHashCount"])
        self.assertEqual(["verified.jpg"], proof["verifiedRelativePaths"])
        self.assertEqual(1, len(proof["itemReceipts"]))
        self.assertEqual(proof, json.loads(verified_path.read_text(encoding="utf-8")))

    def test_gdrive_expected_manifest_requires_explicit_exact_empty_manifest(self) -> None:
        missing = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--source-root",
            str(self.frames_dir),
            "--exit-code",
            "0",
            "--skipped",
            "true",
        )
        self.assertNotEqual(0, missing.returncode, self._format_process_output(missing))
        self.assertIn("GDRIVE_EXPECTED_MANIFEST_INVALID code=MISSING", missing.stderr)
        self.assertFalse(self.status_path.exists())

        invalid_empty_payloads = (
            {"schemaVersion": 1, "expectedCount": 0, "uploadableCount": 0, "items": []},
            {"schemaVersion": 2, "expectedCount": 1, "uploadableCount": 0, "items": []},
            {"schemaVersion": 2, "expectedCount": 0, "uploadableCount": 1, "items": []},
        )
        for payload in invalid_empty_payloads:
            with self.subTest(payload=payload):
                self.expected_path.write_text(json.dumps(payload), encoding="utf-8")
                invalid = self._helper(
                    "write-gdrive-upload-status",
                    "--expected-manifest",
                    str(self.expected_path),
                    "--output",
                    str(self.status_path),
                    "--source-root",
                    str(self.frames_dir),
                    "--exit-code",
                    "0",
                    "--skipped",
                    "true",
                )
                self.assertNotEqual(0, invalid.returncode, self._format_process_output(invalid))
                self.assertIn("GDRIVE_EXPECTED_MANIFEST_INVALID", invalid.stderr)
                self.assertFalse(self.status_path.exists())

        self.expected_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "sourceRoot": str(self.frames_dir),
                    "expectedCount": 0,
                    "uploadableCount": 0,
                    "items": [],
                }
            ),
            encoding="utf-8",
        )
        valid = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--source-root",
            str(self.frames_dir),
            "--exit-code",
            "0",
            "--skipped",
            "true",
        )
        self.assertEqual(0, valid.returncode, self._format_process_output(valid))
        self.assertEqual("skipped", json.loads(self.status_path.read_text(encoding="utf-8"))["status"])

    def test_gdrive_residual_queue_rejects_malformed_record_without_rewrite(self) -> None:
        frame = self.frames_dir / "queued.jpg"
        frame.write_bytes(b"queued")
        self._write_expected()
        item = json.loads(self.expected_path.read_text(encoding="utf-8"))["items"][0]
        first = json.dumps(self._residual_entry(item), sort_keys=True).encode("utf-8")
        last = json.dumps(self._residual_entry(item, attempts=1), sort_keys=True).encode("utf-8")
        queue_bytes = first + b"\n" + b'{"malformed":\n' + last + b"\n"
        self.residual_queue_path.write_bytes(queue_bytes)
        self.expected_path.write_bytes(b"unchanged expected artifact\n")
        self.files_from_path.write_bytes(b"unchanged files-from artifact\n")

        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn(
            "GDRIVE_RESIDUAL_QUEUE_INVALID_RECORD line=2 code=JSON",
            result.stderr,
        )
        self.assertEqual(queue_bytes, self.residual_queue_path.read_bytes())
        self.assertEqual(b"unchanged expected artifact\n", self.expected_path.read_bytes())
        self.assertEqual(b"unchanged files-from artifact\n", self.files_from_path.read_bytes())
    def test_count_frame_files_counts_supported_extensions_recursively(self) -> None:
        (self.frames_dir / "nested").mkdir()
        (self.frames_dir / "recent.jpg").write_text("jpg\n", encoding="utf-8")
        (self.frames_dir / "nested" / "clip.JPEG").write_text("jpeg\n", encoding="utf-8")
        (self.frames_dir / "nested" / "clip.webp").write_text("webp\n", encoding="utf-8")
        (self.frames_dir / "ignore.png").write_text("png\n", encoding="utf-8")

        result = self._helper("count-frame-files", "--frames-dir", str(self.frames_dir))

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual("3", result.stdout.strip())

    def test_print_summary_flow_guide_keeps_beginner_flow_block(self) -> None:
        result = self._helper("print-summary-flow-guide")

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("TZUDONG PIPELINE FLOW", result.stdout)
        self.assertIn("Phase 4", result.stdout)
        self.assertTrue(result.stdout.endswith("+----------------------------------------------------------------------------------------------------------+\n"))

    def test_resolve_policy_action_keeps_fail_closed_policy_matrix(self) -> None:
        cases = [
            ("Step 13 (Supabase)", "missing_external_dependency", "end_to_end", "0", "optional_skip"),
            ("Step 08 (Chunk Multimodal)", "quota_exhausted", "end_to_end", "1", "required_failure"),
            ("Step 08 (Chunk Multimodal)", "quota_exhausted", "end_to_end", "0", "optional_skip"),
            ("Step 11 (LAAJ Evaluation)", "timeout_incomplete", "local", "0", "optional_skip"),
            ("Step 11 (LAAJ Evaluation)", "timeout_incomplete", "end_to_end", "0", "required_failure"),
            ("New Step", "new_issue", "end_to_end", "0", "required_failure:unknown"),
        ]

        for step_name, issue_kind, policy_mode, pending_work, expected in cases:
            with self.subTest(
                step_name=step_name,
                issue_kind=issue_kind,
                policy_mode=policy_mode,
                pending_work=pending_work,
            ):
                result = self._helper(
                    "resolve-policy-action",
                    "--step-name",
                    step_name,
                    "--issue-kind",
                    issue_kind,
                    "--policy-mode",
                    policy_mode,
                    "--pending-step08-work",
                    pending_work,
                )

                self.assertEqual(0, result.returncode, self._format_process_output(result))
                self.assertEqual(expected, result.stdout.strip())

    def test_policy_message_helpers_keep_timeout_fail_closed_text(self) -> None:
        timeout_message = self._helper(
            "render-timeout-guard-message",
            "--elapsed-minutes",
            "47",
            "--max-minutes",
            "45",
        )
        self.assertEqual(0, timeout_message.returncode, self._format_process_output(timeout_message))
        self.assertEqual(
            "파이프라인 시간 제한 도달 (47m/45m). 남은 단계 건너뜁니다.",
            timeout_message.stdout.strip(),
        )

        unknown_warning = self._helper(
            "render-policy-unknown-warning",
            "--step-name",
            "New Step",
            "--issue-kind",
            "new_issue",
        )
        self.assertEqual(0, unknown_warning.returncode, self._format_process_output(unknown_warning))
        self.assertIn("fail-closed", unknown_warning.stdout)
        self.assertIn("New Step|new_issue", unknown_warning.stdout)

        summary_note = self._helper(
            "render-policy-summary-note",
            "--step-name",
            "Phase 3",
            "--issue-kind",
            "timeout_incomplete",
        )
        self.assertEqual(0, summary_note.returncode, self._format_process_output(summary_note))
        self.assertEqual("Phase 3 skipped before entry (timeout_incomplete)", summary_note.stdout.strip())

    def test_step08_message_helper_keeps_prerequisite_quota_and_downstream_text(self) -> None:
        cases = [
            (
                ("node-prerequisite-failure", "@google/genai"),
                "필수 Node 패키지 누락(@google/genai)으로 실행 생략. 먼저 'cd backend && npm ci' 를 실행하세요.",
            ),
            (("node-prerequisite-downstream-reason", ""), "Step 08 Node prerequisite 미충족"),
            (
                ("gemini-runtime-prerequisite-failure", ""),
                "Gemini API 키 또는 Web fallback 세션(gemini_cookies.local.json/Chrome CDP) 미설정으로 실행 생략",
            ),
            (("gemini-runtime-prerequisite-downstream-reason", ""), "Step 08 Gemini runtime prerequisite 미충족"),
            (
                ("quota-detected-warning", ""),
                "할당량 초과(Quota Error) 감지됨. 데이터 일관성을 위해 이후 평가 단계(Step 09~13)를 모두 건너뜁니다.",
            ),
            (("quota-policy-issue", ""), "Gemini quota 초과 (exit=42)"),
            (("quota-downstream-reason", ""), "Step 08 quota 초과"),
            (("login-expired-failure", ""), "Google 로그인 세션 만료 (exit=44)"),
            (("login-expired-downstream-reason", ""), "Step 08 로그인 prerequisite 미충족"),
            (
                ("login-expired-action", ""),
                "해결 방법: 'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login' 을 실행하여 수동 로그인하세요.",
            ),
            (("generic-failure-required", "27"), "Step 08 실패 (exit=27)"),
            (("generic-failure-downstream-reason", ""), "Step 08 실패"),
        ]

        for (message_kind, detail), expected in cases:
            with self.subTest(message_kind=message_kind):
                result = self._helper(
                    "render-step08-message",
                    "--message-kind",
                    message_kind,
                    "--detail",
                    detail,
                )

                self.assertEqual(0, result.returncode, self._format_process_output(result))
                self.assertEqual(expected, result.stdout.strip())

    def test_gdrive_expected_manifest_preserves_old_missing_residual(self) -> None:
        missing_item = {
            "relativePath": "missing-old.jpg",
            "size": 1,
            "mtimeEpoch": 1,
            "dedupeKey": "missing-old.jpg:1:1",
            "md5": "0" * 32,
            "fileIdentity": {
                "device": 1,
                "inode": 1,
                "mtimeNs": 1,
                "ctimeNs": 1,
            },
            "required": True,
            "reason": "residual_retry",
            "sourceState": "missing_local",
            "state": "missing_local",
            "stagingShard": None,
            "remotePath": "gdrive:frames/missing-old.jpg",
        }
        old_epoch = int(time.time()) - (30 * 24 * 60 * 60)
        self.residual_queue_path.write_text(
            json.dumps(
                self._residual_entry(missing_item, attempts=5, first_seen_epoch=old_epoch),
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--remote-root",
            "gdrive:frames",
            "--retention-days",
            "7",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.assertEqual(1, expected["expectedCount"])
        self.assertEqual(1, expected["missingLocalCount"])
        self.assertEqual("missing_local", expected["items"][0]["state"])
        self.assertEqual("missing-old.jpg", expected["items"][0]["relativePath"])
        self.assertEqual("", self.files_from_path.read_text(encoding="utf-8"))

    def test_workflow_upload_step_keeps_validation_status_scope(self) -> None:
        workflow = DAILY_CRAWLER_WORKFLOW.read_text(encoding="utf-8")
        upload_step = workflow.split("- name: Upload Results to GDrive", 1)[1].split("- name: Upload GDrive Status Artifacts", 1)[0]

        self.assertIn("RUN_DAILY_TARGET_BRANCH: data", upload_step)
        self.assertNotIn("github.event.inputs.checkout_ref", upload_step)
        self.assertIn('GDRIVE_STATUS_SCOPE_PATH="${GDRIVE_STATUS_PATH%/}/$STATUS_SCOPE"', upload_step)
        self.assertIn('GDrive status scope path: $GDRIVE_STATUS_SCOPE_PATH', upload_step)
        self.assertIn('GDRIVE_UPLOAD_MAX_FILES: "0"', upload_step)
        self.assertIn('--max-items "${GDRIVE_UPLOAD_MAX_FILES:-0}"', upload_step)
        self.assertIn("write-gdrive-upload-batches", upload_step)
        self.assertIn("write-gdrive-staging-shards", upload_step)
        self.assertIn("write-gdrive-remote-verification", upload_step)
        self.assertIn("rclone check", upload_step)
        self.assertIn("--hash", upload_step)
        self.assertNotIn("--size-only", upload_step)
        self.assertIn("current-upload-batches.json", workflow)
        self.assertIn("current-upload-remote-proof.json", workflow)
        self.assertIn("github.ref_protected", workflow)
        self.assertIn("current-upload-staging-manifest.json", workflow)

    def test_workflows_validate_canonical_env_contracts_without_mutable_bootstrap(self) -> None:
        daily_workflow = DAILY_CRAWLER_WORKFLOW.read_text(encoding="utf-8")
        backfill_workflow = GDRIVE_BACKFILL_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("python3 backend/bin/check_env_contract.py --profile daily", daily_workflow)
        self.assertIn("python3 backend/bin/check_env_contract.py --profile hosted-pending-apply", daily_workflow)
        self.assertIn("apply_hosted_pending_candidates.py", daily_workflow)
        self.assertIn("vars.TZUDONG_HOSTED_DATA_PLANE_APPROVED", daily_workflow)
        self.assertIn("node backend/bin/check_gemini_runtime.mjs", daily_workflow)
        self.assertIn("Lite GHA skips Gemini API availability as a hard gate.", daily_workflow)
        self.assertIn("--require-api-available", daily_workflow)
        self.assertIn("allow_budget_risk", daily_workflow)
        self.assertIn('GEMINI_CLI_TRUST_WORKSPACE: "false"', daily_workflow)
        self.assertIn("npm ci --ignore-scripts", daily_workflow)
        self.assertIn("RUN_DAILY_DISABLE_MUTABLE_PROVIDER_FALLBACK=true", daily_workflow)
        for mutable_bootstrap in (
            "pip install --upgrade",
            "npm install -g",
            "curl -fsSL",
            "deno-version: v2.x",
            "ollama pull",
            "camoufox fetch",
            "antigravity.google/cli/install.sh",
        ):
            self.assertNotIn(mutable_bootstrap, daily_workflow)
        self.assertIn("python3 backend/bin/check_env_contract.py --profile gdrive-backfill", backfill_workflow)
        self.assertIn("Check Actions budget posture before backfill", backfill_workflow)
        self.assertNotIn("Record budget skip", backfill_workflow)
        self.assertNotIn("steps.budget.outputs.soft_gate != 'critical'", backfill_workflow)
        self.assertIn("YOUTUBE_API_KEY_BYEON: ${{ secrets.YOUTUBE_API_KEY }}", daily_workflow)
        self.assertIn("GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}", daily_workflow)
        self.assertNotIn("AGY_SETTINGS_JSON: ${{ secrets.AGY_SETTINGS_JSON }}", daily_workflow)
        self.assertNotIn("AGY_CREDENTIAL_B64: ${{ secrets.AGY_CREDENTIAL_B64 }}", daily_workflow)
    def test_env_contract_guard_fails_closed_without_printing_values(self) -> None:
        env = os.environ.copy()
        for name in (
            "YOUTUBE_API_KEY_BYEON",
            "GEMINI_API_KEY",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "NAVER_CLIENT_ID_BYEON",
            "NAVER_CLIENT_SECRET_BYEON",
            "NCP_MAPS_KEY_ID_BYEON",
            "NCP_MAPS_KEY_BYEON",
            "RCLONE_CONFIG_BASE64",
            "GEMINI_CREDENTIALS_BASE64",
        ):
            env.pop(name, None)
        env.update({
            "YOUTUBE_API_KEY_BYEON": "stub-youtube",
            "GEMINI_API_KEY": "stub-gemini",
            "SUPABASE_URL": "https://stub.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "stub-service-role",
            "NAVER_CLIENT_ID_BYEON": "stub-naver-id",
            "NAVER_CLIENT_SECRET_BYEON": "stub-naver-secret",
            "NCP_MAPS_KEY_ID_BYEON": "stub-ncp-id",
            "NCP_MAPS_KEY_BYEON": "stub-ncp-key",
            "RCLONE_CONFIG_BASE64": "stub-rclone",
        })

        ok = subprocess.run(
            [PYTHON_BIN, str(ENV_CONTRACT_SOURCE), "--profile", "daily", "--json"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(0, ok.returncode, self._format_process_output(ok))
        ok_payload = json.loads(ok.stdout)
        self.assertTrue(ok_payload["ok"])
        self.assertNotIn("stub-gemini", ok.stdout)
        self.assertNotIn("stub-service-role", ok.stdout)

        env["GEMINI_CREDENTIALS_BASE64"] = "oauth-secret-value"
        env["AGY_CREDENTIAL_B64"] = "agy-oauth-secret-value"
        oauth_ok = subprocess.run(
            [PYTHON_BIN, str(ENV_CONTRACT_SOURCE), "--profile", "daily", "--json"],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(0, oauth_ok.returncode, self._format_process_output(oauth_ok))
        oauth_payload = json.loads(oauth_ok.stdout)
        self.assertIn("GEMINI_CREDENTIALS_BASE64", oauth_payload["runtimeAliasesPresent"])
        self.assertIn("AGY_CREDENTIAL_B64", oauth_payload["runtimeAliasesPresent"])
        self.assertNotIn("oauth-secret-value", oauth_ok.stdout)
        self.assertNotIn("agy-oauth-secret-value", oauth_ok.stdout)

    def test_gdrive_expected_manifest_caps_batch_and_queues_overflow(self) -> None:
        for name in ("a.jpg", "b.jpg", "c.jpg"):
            (self.frames_dir / name).write_text(f"{name}\n", encoding="utf-8")

        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--remote-root",
            "gdrive:frames",
            "--run-id",
            self.run_id,
            "--max-items",
            "2",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.assertEqual(2, expected["expectedCount"])
        self.assertEqual(2, expected["maxItems"])
        self.assertEqual(1, expected["overflowCount"])
        self.assertEqual(2, expected["uploadableCount"])
        self.assertEqual(["a.jpg", "b.jpg"], [item["relativePath"] for item in expected["items"]])
        self.assertEqual("a.jpg\nb.jpg\n", self.files_from_path.read_text(encoding="utf-8"))
        queue = [json.loads(line) for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(1, len(queue))
        self.assertEqual("c.jpg", queue[0]["item"]["relativePath"])
        self.assertEqual(0, queue[0]["attempts"])

        verified_path = self.root / "verified-receipt.json"
        self._write_remote_receipt(verified_path, {"a.jpg", "b.jpg"})
        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--verification-receipt",
            str(verified_path),
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--completion-proof",
            "remote_manifest_check",
            "--exit-code",
            "0",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("backfill_required", status["status"])
        self.assertEqual(1, status["residualCount"])
        self.assertEqual(1, status["pendingBacklogCount"])
        queue = [json.loads(line) for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(["c.jpg"], [entry["item"]["relativePath"] for entry in queue])

    def test_gdrive_backfill_workflow_has_lease_and_remote_proof(self) -> None:
        workflow = GDRIVE_BACKFILL_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("schedule:", workflow)
        self.assertEqual(1, workflow.count("cron: '0 21 * * *'"))
        self.assertEqual(1, workflow.count("cron: '0 23 * * *'"))
        self.assertEqual(2, workflow.count("cron: '0 "))
        self.assertIn("workflow_run:", workflow)
        self.assertIn('workflows: ["Crawler"]', workflow)
        self.assertIn("types: [completed]", workflow)
        self.assertIn("github.event.workflow_run.event == 'schedule'", workflow)
        self.assertIn("github.event.workflow_run.head_branch == github.event.repository.default_branch", workflow)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", workflow)
        self.assertIn("github.ref_protected", workflow)
        self.assertIn("MAX_BACKFILL_BATCHES: ${{ github.event.inputs.max_batches || '1' }}", workflow)
        self.assertIn("MAX_BACKFILL_ITEMS: ${{ github.event.inputs.max_items || '500' }}", workflow)
        self.assertIn("check_actions_budget.py", workflow)
        self.assertIn("GitHub Actions budget posture", workflow)
        self.assertNotIn("Record budget skip", workflow)
        self.assertNotIn("steps.budget.outputs.soft_gate != 'critical'", workflow)
        self.assertIn("concurrency:", workflow)
        self.assertIn("gdrive-frame-backfill", workflow)
        self.assertIn("backfill.lock.json", workflow)
        self.assertIn("rclone check", workflow)
        self.assertNotIn("--size-only", workflow)
        self.assertIn("--hash", workflow)
        self.assertIn(
            "ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
            workflow,
        )
        self.assertIn("fetch-depth: 0", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("Bind trusted backfill source", workflow)
        self.assertIn('test "$(git rev-parse HEAD)" = "$TRIGGER_SHA"', workflow)
        self.assertIn('git merge-base --is-ancestor "$TRIGGER_SHA" "origin/$DEFAULT_BRANCH"', workflow)
        self.assertIn("--upload-mode backfill", workflow)
        self.assertIn('--completion-proof "$COMPLETION_PROOF"', workflow)
        self.assertNotIn("--completion-proof remote_manifest_check", workflow)
        self.assertIn("remote_manifest_check", workflow)
        self.assertIn("actions/upload-artifact@v7.0.1", workflow)
        self.assertIn("STATUS_SCOPE_SAFE", workflow)
        self.assertIn("status_scope must match [A-Za-z0-9._-]+", workflow)
        self.assertNotIn("backend/log/cron/gdrive-upload-staging/**", workflow)
        self.assertNotIn("backend/log/cron/current-upload-rclone.log", workflow)
        self.assertIn("trap cleanup_lock EXIT", workflow)
        self.assertIn("set +e", workflow)
        self.assertIn("BACKFILL_EXIT", workflow)
        self.assertIn("RCLONE_LOG_ABS", workflow)
        self.assertIn("FILES_FROM_ABS", workflow)
        self.assertIn("STAGING_MANIFEST_DIR", workflow)
        self.assertIn("stagingManifestItems", workflow)
        self.assertIn("MAX_BACKFILL_ITEMS", workflow)
        self.assertIn("maxSelectedItemCount", workflow)
        self.assertIn("Backfill preflight:", workflow)
        self.assertIn("Backfill plan telemetry:", workflow)
        self.assertIn("backlogDetected", workflow)
        self.assertIn("backlogReason", workflow)
        self.assertIn("stagingManifestCount", workflow)
        self.assertIn("stagingItemCount", workflow)
        self.assertNotIn("reasons.append(f'stagingManifests=", workflow)
        self.assertNotIn("reasons.append(f'stagingItems=", workflow)
        self.assertIn("No GDrive backfill backlog detected; exiting.", workflow)
        self.assertLess(
            workflow.index("No GDrive backfill backlog detected; exiting."),
            workflow.index('rclone copyto "$WORK_DIR/backfill.lock.json" "$LOCK_REMOTE"'),
        )
        self.assertIn("REMOTE_LIST_JSON", workflow)
        self.assertIn("remoteVerifiedCount", workflow)
        self.assertIn("remoteVerifiedBeforeCount", workflow)
        self.assertIn("No staged shards to backfill; writing cumulative remote status.", workflow)
        self.assertIn('rclone lsjson "$GDRIVE_FRAMES_PATH"', workflow)
        self.assertIn("extract-gdrive-backfill-shard", workflow)
        self.assertIn("archiveSha256", workflow)
        self.assertIn("sourceManifestBinding", workflow)
        self.assertIn("backfill-shard-*.receipt.json", workflow)
        self.assertNotIn("tar -xzf", workflow)
        self.assertNotIn('--staging-manifest "$STAGING_MANIFEST"', workflow)
        self.assertNotIn('../../../$RCLONE_LOG', workflow)
        self.assertNotIn('../../../$FILES_FROM', workflow)
        self.assertIn('exit "$BACKFILL_EXIT"', workflow)

    def test_security_audit_workflow_and_dependabot_cover_supply_chain(self) -> None:
        security_workflow = (REPO_ROOT / ".github" / "workflows" / "security-audit.yml").read_text(encoding="utf-8")
        dependabot = (REPO_ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        crawling_requirements = (REPO_ROOT / "backend" / "restaurant-crawling" / "scripts" / "requirements.txt").read_text(encoding="utf-8")
        pipeline_requirements = (REPO_ROOT / "backend" / "pipeline" / "requirements.txt").read_text(encoding="utf-8")

        self.assertIn("npm audit --audit-level=moderate", security_workflow)
        self.assertIn("python -m pip_audit", security_workflow)
        self.assertIn("backend/restaurant-crawling/scripts/requirements.txt", security_workflow)
        self.assertIn("backend/supabase/scripts/g037-hosted-closure-requirements.txt", security_workflow)
        self.assertIn("backend/pipeline-control/requirements.txt", security_workflow)
        self.assertIn('directory: "/backend/pipeline-control"', dependabot)
        self.assertIn('directory: "/backend/restaurant-crawling/scripts"', dependabot)
        self.assertEqual(dependabot.count('target-branch: "develop"'), 6)
        self.assertEqual(dependabot.count('applies-to: "version-updates"'), 2)
        self.assertEqual(dependabot.count('          - "minor"'), 2)
        self.assertEqual(dependabot.count('          - "patch"'), 2)
        self.assertIn('dependency-name: "@types/node"', dependabot)
        self.assertIn('dependency-name: "eslint"', dependabot)
        self.assertEqual(
            dependabot.count('          - "version-update:semver-major"'),
            2,
        )
        for dependency in (
            "next",
            "@next/bundle-analyzer",
            "eslint-config-next",
            "typescript-eslint",
        ):
            self.assertIn(f'dependency-name: "{dependency}"', dependabot)
        self.assertEqual(dependabot.count('          - ">=16.3.0"'), 3)
        self.assertEqual(dependabot.count('          - ">8.63.0"'), 1)
        self.assertNotIn("git+https://github.com/yt-dlp/yt-dlp.git@master", crawling_requirements)
        self.assertIn("yt-dlp[default]==", crawling_requirements)
        self.assertNotIn("\nrequests\n", crawling_requirements)
        self.assertIn("langgraph==", pipeline_requirements)
        self.assertNotIn("langchain-core>=", pipeline_requirements)
        g038_workflow = (REPO_ROOT / ".github" / "workflows" / "g038-account-deletion-successor.yml").read_text(encoding="utf-8")
        self.assertIn("cryptography==50.0.0", g038_workflow)
        self.assertIn("cffi==2.0.0", g038_workflow)
        self.assertNotIn("cffi==1.17.1", g038_workflow)

    def test_chunk_multimodal_only_uses_chrome_impersonation_when_available(self) -> None:
        script = CHUNK_MULTIMODAL_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("--list-impersonate-targets", script)
        self.assertIn("grep -Eq", script)
        self.assertIn("^[[:space:]]*Chrome-", script)
        self.assertIn("yt_impersonate_flags=(--impersonate Chrome)", script)
        self.assertIn("Chrome impersonation target unavailable", script)
        self.assertIn('"${yt_impersonate_flags[@]}"', script)

    def test_gdrive_upload_status_timeout_records_partial_and_residual_queue(self) -> None:
        frame = self.frames_dir / "pending.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "124",
            "--timeout",
            "true",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("partial", status["status"])
        self.assertTrue(status["timeout"])
        self.assertEqual(1, status["expectedCount"])
        self.assertEqual(1, status["attemptedCount"])
        self.assertEqual(1, status["residualCount"])
        self.assertEqual(
            status["expectedCount"],
            status["uploadedCount"] + status["skippedExistingCount"] + status["residualCount"],
        )
        queue_lines = [line for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(1, len(queue_lines))
        self.assertIn("pending.jpg", queue_lines[0])

    def test_observed_daily_run_skipped_upload_status_artifact_contract(self) -> None:
        """Lock the schema shape observed from a successful main daily run artifact."""
        observed_status = {
            "schemaVersion": 2,
            "runId": "25435432129",
            "policy": "warn",
            "inputPolicy": "warn",
            "uploadMode": "skip",
            "expectedCount": 0,
            "attemptedCount": 0,
            "uploadedCount": 0,
            "uploadedCountConfidence": "exact",
            "skippedExistingCount": 0,
            "verifiedCount": 0,
            "residualCount": 0,
            "pendingBacklogCount": 0,
            "pendingLocalCount": 0,
            "stagedShardItemCount": 0,
            "missingLocalCount": 0,
            "stagedShardCount": 0,
            "maxResidualAttempts": 0,
            "backfillThresholdAttempts": 3,
            "timeout": False,
            "exitCode": 0,
            "status": "skipped",
            "terminalIncomplete": False,
            "completionProof": "none",
            "verificationRequired": False,
            "dedupeKey": "relativePath:size:mtime",
            "residualQueuePath": None,
            "notes": [],
        }

        expected_keys = {
            "schemaVersion",
            "runId",
            "policy",
            "inputPolicy",
            "uploadMode",
            "expectedCount",
            "attemptedCount",
            "uploadedCount",
            "uploadedCountConfidence",
            "skippedExistingCount",
            "verifiedCount",
            "residualCount",
            "pendingBacklogCount",
            "pendingLocalCount",
            "stagedShardItemCount",
            "missingLocalCount",
            "stagedShardCount",
            "maxResidualAttempts",
            "backfillThresholdAttempts",
            "timeout",
            "exitCode",
            "status",
            "terminalIncomplete",
            "completionProof",
            "verificationRequired",
            "dedupeKey",
            "residualQueuePath",
            "notes",
        }

        self.assertEqual(expected_keys, set(observed_status))
        self.assertEqual(2, observed_status["schemaVersion"])
        self.assertEqual("skipped", observed_status["status"])
        self.assertEqual(0, observed_status["exitCode"])
        self.assertFalse(observed_status["terminalIncomplete"])
        self.assertEqual(
            observed_status["expectedCount"],
            observed_status["verifiedCount"]
            + observed_status["skippedExistingCount"]
            + observed_status["residualCount"],
        )
        self.assertEqual(0, observed_status["pendingBacklogCount"])
        self.assertEqual("none", observed_status["completionProof"])

    def test_gdrive_upload_status_success_requires_remote_proof_and_clears_matching_residual(self) -> None:
        frame = self.frames_dir / "done.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        verified_path = self.root / "verified-receipt.json"
        self._write_remote_receipt(verified_path)
        self.residual_queue_path.write_text(
            json.dumps(self._residual_entry(expected["items"][0], attempts=2), sort_keys=True) + "\n",
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--verification-receipt",
            str(verified_path),
            "--completion-proof",
            "remote_manifest_check",
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "0",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("complete", status["status"])
        self.assertEqual("remote_manifest_check", status["completionProof"])
        self.assertEqual(1, status["verifiedCount"])
        self.assertEqual(0, status["uploadedCount"])
        self.assertEqual(0, status["skippedExistingCount"])
        self.assertEqual("unknown", status["uploadedCountConfidence"])
        self.assertEqual(0, status["residualCount"])
        self.assertEqual("", self.residual_queue_path.read_text(encoding="utf-8"))

    def test_gdrive_upload_status_rejects_size_only_proof_as_terminal(self) -> None:
        frame = self.frames_dir / "same-size-stale-risk.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--completion-proof",
            "remote_size_check",
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "0",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("backfill_required", status["status"])
        self.assertEqual(0, status["verifiedCount"])
        self.assertEqual(1, status["residualCount"])
        self.assertEqual("remote_size_check", status["completionProof"])

    def test_run_daily_summary_manifest_records_runtime_telemetry(self) -> None:
        summary_path = self.root / "runtime-summary.json"
        result = self._helper(
            "write-summary-manifest",
            "--output",
            str(summary_path),
            "--date",
            "2026-05-01",
            "--final-status",
            "OK",
            "--final-exit-code",
            "0",
            "--github-run-id",
            "25206693886",
            "--github-run-attempt",
            "1",
            "--github-run-url",
            "https://github.com/twoimo/tzudong/actions/runs/25206693886",
            "--github-workflow",
            "Crawler",
            "--github-event-name",
            "workflow_dispatch",
            "--execution-branch",
            "main",
            "--target-branch",
            "data",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        self.assertEqual("OK", summary["finalStatus"])
        self.assertEqual("25206693886", summary["runtime"]["githubRunId"])
        self.assertEqual(
            "https://github.com/twoimo/tzudong/actions/runs/25206693886",
            summary["runtime"]["githubRunUrl"],
        )
        self.assertEqual("main", summary["runtime"]["executionBranch"])
        self.assertEqual("data", summary["runtime"]["targetBranch"])

    def test_run_daily_summary_manifest_records_structured_step_events(self) -> None:
        summary_path = self.root / "step-events-summary.json"
        result = self._helper(
            "write-summary-manifest",
            "--output",
            str(summary_path),
            "--date",
            "2026-05-01",
            "--final-status",
            "WARN",
            "--final-exit-code",
            "0",
            "--step-event",
            "completed\tStep 1 (URL Collection)\t12\t\t",
            "--step-event",
            "downstream_skipped\tStep 09~13 (Evaluation)\t\tStep 08 quota 초과\tStep 08 (Chunk Multimodal)",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        self.assertEqual(
            [
                {
                    "durationSeconds": 12,
                    "name": "Step 1 (URL Collection)",
                    "status": "completed",
                },
                {
                    "name": "Step 09~13 (Evaluation)",
                    "reason": "Step 08 quota 초과",
                    "status": "downstream_skipped",
                    "upstreamStep": "Step 08 (Chunk Multimodal)",
                },
            ],
            summary["stepEvents"],
        )

    def test_run_daily_summary_manifest_rejects_unknown_step_event_status(self) -> None:
        summary_path = self.root / "invalid-step-events-summary.json"
        result = self._helper(
            "write-summary-manifest",
            "--output",
            str(summary_path),
            "--date",
            "2026-05-01",
            "--final-status",
            "ERROR",
            "--final-exit-code",
            "1",
            "--step-event",
            "unknown\tStep 1 (URL Collection)\t0\t\t",
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("invalid step event status: unknown", result.stderr)
        self.assertFalse(summary_path.exists())

    def test_run_daily_summary_manifest_validate_rejects_invalid_json(self) -> None:
        summary_path = self.root / "invalid-summary.json"
        summary_path.write_text("not json\n", encoding="utf-8")

        result = self._helper(
            "validate-summary-manifest",
            "--input",
            str(summary_path),
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Expecting value", result.stderr)

    def test_run_daily_summary_manifest_repairs_mojibaked_cli_text(self) -> None:
        summary_path = self.root / "mojibake-summary.json"
        reason = "Google 로그인 세션 만료"
        mojibake_reason = reason.encode("utf-8").decode("latin-1")

        result = self._helper(
            "write-summary-manifest",
            "--output",
            str(summary_path),
            "--date",
            "2026-05-01",
            "--final-status",
            "ERROR",
            "--final-exit-code",
            "1",
            "--failed-required-step",
            f"Step 08 (Chunk Multimodal) - {mojibake_reason}",
            "--downstream-skip",
            f"Step 09~13 (Evaluation) - {mojibake_reason}",
            "--step-event",
            f"failed\tStep 08 (Chunk Multimodal)\t\t{mojibake_reason}\t",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        self.assertIn(reason, summary["failedRequiredSteps"][0])
        self.assertIn(reason, summary["downstreamSkips"][0])
        self.assertEqual(reason, summary["stepEvents"][0]["reason"])

    def test_gdrive_upload_status_embeds_in_summary_manifest_when_requested(self) -> None:
        frame = self.frames_dir / "summary.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()
        summary_path = self.root / "current-summary.json"
        summary_path.write_text(json.dumps({"finalStatus": "OK"}, sort_keys=True), encoding="utf-8")

        verified_path = self.root / "summary-verified-receipt.json"
        self._write_remote_receipt(verified_path)

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--summary-manifest",
            str(summary_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--verification-receipt",
            str(verified_path),
            "--completion-proof",
            "remote_manifest_check",
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "0",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        self.assertEqual("OK", summary["finalStatus"])
        self.assertEqual("complete", summary["gdriveUpload"]["status"])
        self.assertEqual(1, summary["gdriveUpload"]["expectedCount"])
        self.assertEqual(1, summary["gdriveUpload"]["verifiedCount"])
        self.assertEqual("ok", summary["gdriveUpload"]["operatorMessage"]["severity"])
        self.assertIn("GDrive upload verified", summary["gdriveUpload"]["operatorMessage"]["summary"])

    def test_gdrive_upload_status_preserves_missing_residual_entries_on_skip(self) -> None:
        stale_file = self.frames_dir / "stale.jpg"
        stale_file.write_text("stale\n", encoding="utf-8")
        stale_stat = stale_file.stat()
        stale_item = {
            "relativePath": "stale.jpg",
            "size": stale_stat.st_size,
            "mtimeEpoch": int(stale_stat.st_mtime),
            "dedupeKey": f"stale.jpg:{stale_stat.st_size}:{int(stale_stat.st_mtime)}",
            "md5": hashlib.md5(stale_file.read_bytes()).hexdigest(),
            "fileIdentity": {
                "device": stale_stat.st_dev,
                "inode": stale_stat.st_ino,
                "mtimeNs": stale_stat.st_mtime_ns,
                "ctimeNs": stale_stat.st_ctime_ns,
            },
            "required": True,
            "reason": "residual_retry",
            "sourceState": "local",
            "state": "pending_local",
            "stagingShard": None,
            "remotePath": "gdrive:frames/stale.jpg",
        }
        missing_item = {
            "relativePath": "missing.jpg",
            "size": 1,
            "mtimeEpoch": 1,
            "dedupeKey": "missing.jpg:1:1",
            "md5": "0" * 32,
            "fileIdentity": {
                "device": 1,
                "inode": 1,
                "mtimeNs": 1,
                "ctimeNs": 1,
            },
            "required": True,
            "reason": "residual_retry",
            "sourceState": "missing_local",
            "state": "missing_local",
            "stagingShard": None,
            "remotePath": "gdrive:frames/missing.jpg",
        }
        old_epoch = int(time.time()) - (8 * 24 * 60 * 60)
        self.residual_queue_path.write_text(
            json.dumps(
                self._residual_entry(stale_item, first_seen_epoch=old_epoch),
                sort_keys=True,
            )
            + "\n"
            + json.dumps(self._residual_entry(missing_item), sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        self.expected_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "sourceRoot": str(self.frames_dir),
                    "expectedCount": 0,
                    "uploadableCount": 0,
                    "items": [],
                }
            ),
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "0",
            "--skipped",
            "true",
            "--retention-days",
            "7",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("backfill_required", status["status"])
        self.assertEqual("backfill_required", status["policy"])
        self.assertEqual("warning", status["operatorMessage"]["severity"])
        self.assertIn("requires backfill", status["operatorMessage"]["summary"])
        self.assertIn("backfill workflow", status["operatorMessage"]["action"])
        self.assertEqual(1, status["missingLocalCount"])
        self.assertEqual(1, status["residualCount"])
        queue = [json.loads(line) for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(1, len(queue))
        self.assertEqual("missing_local", queue[0]["state"])
        self.assertEqual("missing.jpg", queue[0]["item"]["relativePath"])

    def test_gdrive_upload_status_escalates_repeated_residual_to_backfill_required(self) -> None:
        frame = self.frames_dir / "repeat.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.residual_queue_path.write_text(
            json.dumps(
                self._residual_entry(
                    expected["items"][0],
                    attempts=2,
                    last_exit_code=124,
                ),
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "124",
            "--timeout",
            "true",
            "--backfill-threshold-attempts",
            "3",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("backfill_required", status["status"])
        self.assertEqual("backfill_required", status["policy"])
        self.assertEqual(3, status["maxResidualAttempts"])
        queue = [json.loads(line) for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(3, queue[0]["attempts"])


    def test_gdrive_upload_batches_respect_file_and_byte_limits(self) -> None:
        for index, size in enumerate([5, 6, 7], start=1):
            (self.frames_dir / f"batch-{index}.jpg").write_text("x" * size, encoding="utf-8")
        self._write_expected()
        batch_manifest = self.root / "batches.json"
        batch_dir = self.root / "batches"

        result = self._helper(
            "write-gdrive-upload-batches",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(batch_manifest),
            "--output-dir",
            str(batch_dir),
            "--max-files",
            "2",
            "--max-bytes",
            "11",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        manifest = json.loads(batch_manifest.read_text(encoding="utf-8"))
        self.assertEqual(2, manifest["batchCount"])
        self.assertEqual([2, 1], [batch["itemCount"] for batch in manifest["batches"]])
        self.assertTrue((batch_dir / "batch-0001.txt").exists())
        self.assertTrue((batch_dir / "batch-0002.txt").exists())

    def test_gdrive_staging_shards_archive_unverified_local_items(self) -> None:
        uploaded = self.frames_dir / "uploaded.jpg"
        pending = self.frames_dir / "pending.jpg"
        uploaded.write_text("uploaded\n", encoding="utf-8")
        pending.write_text("pending\n", encoding="utf-8")
        self._write_expected()
        verified_path = self.root / "verified-receipt.json"
        self._write_remote_receipt(verified_path, {"uploaded.jpg"})
        staging_manifest = self.root / "staging.json"
        staging_dir = self.root / "staging"

        result = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--verification-receipt",
            str(verified_path),
            "--source-root",
            str(self.frames_dir),
            "--remote-staging-root",
            "gdrive:status/main/staging/run-1",
            "--max-files",
            "10",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        manifest = json.loads(staging_manifest.read_text(encoding="utf-8"))
        self.assertEqual(1, manifest["stagedShardCount"])
        self.assertEqual(1, manifest["stagedShardItemCount"])
        self.assertEqual("pending.jpg", manifest["shards"][0]["items"][0]["relativePath"])
        self.assertTrue((staging_dir / "shard-0001.tar.gz").exists())
        shard = manifest["shards"][0]
        self.assertEqual(
            {"device", "inode", "mode"},
            set(shard["archiveIdentity"]),
        )
        self.assertEqual(64, len(shard["archiveSha256"]))
        self.assertEqual((staging_dir / "shard-0001.tar.gz").stat().st_size, shard["archiveSize"])
        verified = self._helper(
            "verify-gdrive-staging-shards",
            "--staging-manifest",
            str(staging_manifest),
            "--expected-manifest",
            str(self.expected_path),
        )
        self.assertEqual(0, verified.returncode, self._format_process_output(verified))
        self.assertEqual("ok", verified.stdout.strip())

    def test_gdrive_staging_rejects_stale_receipt_before_archive_creation(self) -> None:
        frame = self.frames_dir / "same-path.jpg"
        frame.write_bytes(b"before")
        self._write_expected()
        receipt_path = self.root / "stale-verification-receipt.json"
        self._write_remote_receipt(receipt_path)

        frame.write_bytes(b"after!")
        self._write_expected()
        staging_manifest = self.root / "stale-staging.json"
        staging_dir = self.root / "stale-staging"
        result = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--verification-receipt",
            str(receipt_path),
            "--source-root",
            str(self.frames_dir),
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("GDRIVE_VERIFICATION_RECEIPT_INVALID code=BINDING", result.stderr)
        self.assertFalse(staging_manifest.exists())
        self.assertFalse(staging_dir.exists())
    def test_gdrive_staging_archive_verification_rejects_replacement_and_tampering(self) -> None:
        pending = self.frames_dir / "pending.jpg"
        pending.write_bytes(b"pending\n")
        self._write_expected()
        staging_manifest = self.root / "staging.json"
        staging_dir = self.root / "staging"
        staged = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--source-root",
            str(self.frames_dir),
        )
        self.assertEqual(0, staged.returncode, self._format_process_output(staged))
        baseline = json.loads(staging_manifest.read_text(encoding="utf-8"))
        archive_path = staging_dir / "shard-0001.tar.gz"
        archive_bytes = archive_path.read_bytes()

        def write_manifest(payload: dict) -> None:
            staging_manifest.write_text(json.dumps(payload), encoding="utf-8")

        def reset_archive() -> None:
            if archive_path.exists() or archive_path.is_symlink():
                archive_path.unlink()
            archive_path.write_bytes(archive_bytes)

        def write_archive(member_name: str, contents: bytes) -> None:
            if archive_path.exists() or archive_path.is_symlink():
                archive_path.unlink()
            with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
                member = tarfile.TarInfo(member_name)
                member.size = len(contents)
                member.mode = 0o600
                member.mtime = 0
                archive.addfile(member, io.BytesIO(contents))

        def refreshed_payload() -> dict:
            payload = json.loads(json.dumps(baseline))
            archive_stat = archive_path.stat()
            payload["shards"][0].update(
                {
                    "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
                    "archiveSize": archive_stat.st_size,
                    "archiveIdentity": {
                        "device": archive_stat.st_dev,
                        "inode": archive_stat.st_ino,
                        "mode": archive_stat.st_mode,
                    },
                }
            )
            return payload

        def verify_failure(code: str) -> None:
            verified = self._helper(
                "verify-gdrive-staging-shards",
                "--staging-manifest",
                str(staging_manifest),
                "--expected-manifest",
                str(self.expected_path),
            )
            self.assertNotEqual(0, verified.returncode, self._format_process_output(verified))
            self.assertTrue(
                "GDRIVE_STAGING_ARCHIVE_INVALID" in verified.stderr
                or "GDRIVE_STAGING_RECEIPT_INVALID" in verified.stderr,
                self._format_process_output(verified),
            )

        reset_archive()
        write_manifest(baseline)
        verify_failure("IDENTITY")

        external_archive = self.root / "external.tar.gz"
        external_archive.write_bytes(archive_bytes)
        reset_archive()
        try:
            os.symlink(str(external_archive), str(archive_path))
        except (NotImplementedError, OSError):
            pass
        else:
            write_manifest(baseline)
            verify_failure("OPEN")

        write_archive("../escape.jpg", b"pending\n")
        write_manifest(refreshed_payload())
        verify_failure("MEMBER_PATH")

        write_archive("pending.jpg", b"pending\n")
        write_manifest(baseline)
        verify_failure("SHA256")

        size_payload = refreshed_payload()
        size_payload["shards"][0]["archiveSize"] += 1
        write_manifest(size_payload)
        verify_failure("SIZE")

        identity_payload = refreshed_payload()
        identity_payload["shards"][0]["archiveIdentity"]["mode"] ^= stat.S_IXUSR
        write_manifest(identity_payload)
        verify_failure("IDENTITY")
    def test_gdrive_backfill_receiver_rejects_adversarial_archives_and_accepts_valid_archive(self) -> None:
        pending = self.frames_dir / "pending.jpg"
        pending_bytes = b"pending\n"
        pending.write_bytes(pending_bytes)
        self._write_expected()
        staging_manifest = self.root / "staging.json"
        staging_dir = self.root / "staging"
        staged = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--source-root",
            str(self.frames_dir),
            "--remote-staging-root",
            "gdrive:status/main/staging/run-test",
        )
        self.assertEqual(0, staged.returncode, self._format_process_output(staged))
        baseline = json.loads(staging_manifest.read_text(encoding="utf-8"))["shards"][0]
        archive_path = staging_dir / "shard-0001.tar.gz"
        original_archive = archive_path.read_bytes()
        selected_files = self.root / "selected-files.txt"
        selected_files.write_text("pending.jpg\n", encoding="utf-8")
        receiver_root = self.root / "receiver"
        receiver_root.mkdir()

        def bound_contract() -> dict:
            contract = json.loads(json.dumps(baseline))
            archive_stat = archive_path.stat()
            binding = {
                "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
                "archiveSize": archive_stat.st_size,
                "archiveIdentity": {
                    "device": archive_stat.st_dev,
                    "inode": archive_stat.st_ino,
                    "mode": archive_stat.st_mode,
                },
            }
            contract.update(binding)
            contract["archiveReceipt"].update(binding)
            return contract

        def write_contract(label: str, contract: dict) -> Path:
            contract_path = self.root / f"{label}.contract.json"
            contract_path.write_text(
                json.dumps(contract, sort_keys=True),
                encoding="utf-8",
            )
            return contract_path

        def receive(label: str, contract: dict) -> subprocess.CompletedProcess[str]:
            return self._helper(
                "extract-gdrive-backfill-shard",
                "--archive",
                str(archive_path),
                "--shard-contract",
                str(write_contract(label, contract)),
                "--expected-manifest",
                str(self.expected_path),
                "--files-from",
                str(selected_files),
                "--output-dir",
                str(receiver_root / label),
                "--output-receipt",
                str(receiver_root / f"{label}.receipt.json"),
            )

        def assert_rejected(label: str, contract: dict) -> None:
            result = receive(label, contract)
            self.assertNotEqual(0, result.returncode, self._format_process_output(result))
            self.assertIn(
                "GDRIVE_STAGING_ARCHIVE_INVALID",
                result.stderr,
                self._format_process_output(result),
            )

        def write_regular_archive(members: list[tuple[str, bytes]]) -> None:
            archive_path.unlink()
            with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
                for name, contents in members:
                    member = tarfile.TarInfo(name)
                    member.size = len(contents)
                    member.mode = 0o600
                    member.mtime = 0
                    archive.addfile(member, io.BytesIO(contents))

        def write_link_archive(link_type: bytes) -> None:
            archive_path.unlink()
            with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
                member = tarfile.TarInfo("pending.jpg")
                member.type = link_type
                member.linkname = "../outside.jpg"
                member.size = 0
                archive.addfile(member)

        archive_path.write_bytes(b"digest drift")
        assert_rejected("digest-drift", baseline)

        write_regular_archive([("../pending.jpg", pending_bytes)])
        assert_rejected("traversal", bound_contract())

        write_link_archive(tarfile.SYMTYPE)
        assert_rejected("symlink", bound_contract())

        write_link_archive(tarfile.LNKTYPE)
        assert_rejected("hardlink", bound_contract())

        write_regular_archive(
            [("pending.jpg", pending_bytes), ("pending.jpg", pending_bytes)]
        )
        assert_rejected("duplicate", bound_contract())

        write_regular_archive(
            [("pending.jpg", pending_bytes), ("PENDING.JPG", pending_bytes)]
        )
        assert_rejected("case-collision", bound_contract())

        write_regular_archive([("pending.jpg", pending_bytes + b"x")])
        assert_rejected("over-limit", bound_contract())

        write_regular_archive([])
        assert_rejected("missing-member", bound_contract())

        write_regular_archive(
            [("pending.jpg", pending_bytes), ("extra.jpg", b"unexpected\n")]
        )
        assert_rejected("extra-member", bound_contract())

        archive_path.write_bytes(original_archive + b"changed remote shard")
        assert_rejected("changed-remote-shard", baseline)

        archive_path.write_bytes(original_archive)
        valid = receive("valid", baseline)
        self.assertEqual(0, valid.returncode, self._format_process_output(valid))
        receipt = json.loads(valid.stdout)
        self.assertEqual(baseline["archiveSha256"], receipt["archiveSha256"])
        self.assertEqual(
            baseline["archiveReceipt"]["expectedManifestSha256"],
            receipt["sourceManifestBinding"]["expectedManifestSha256"],
        )
        self.assertEqual(["pending.jpg"], [item["relativePath"] for item in receipt["items"]])
        self.assertEqual(
            pending_bytes,
            (receiver_root / "valid" / "pending.jpg").read_bytes(),
        )
    @unittest.skipUnless(os.name == "nt", "Windows handle pinning is Windows-specific")
    def test_windows_gdrive_staging_retains_trusted_handles_across_junction_swaps(self) -> None:
        source_child = self.frames_dir / "nested"
        source_child.mkdir()
        (source_child / "pending.jpg").write_bytes(b"pending\n")
        self._write_expected()

        output_root = self.root / "output-root"
        staging_dir = output_root / "staging"
        output_root.mkdir()
        external = self.root / "external"
        external.mkdir()
        external_sentinels = {
            external / "sentinel.txt": "external sentinel\n",
            external / "shard-0001.tar.gz": "external archive\n",
        }
        for path, contents in external_sentinels.items():
            path.write_text(contents, encoding="utf-8")

        attempted: set[str] = set()
        blocked: set[str] = set()
        moved: list[tuple[Path, Path]] = []
        verify_root = False
        api = run_daily_helpers._windows_api()
        ctypes = api["ctypes"]
        native_open_calls: list[tuple[int, int, int, int]] = []
        native_nt_create_file = api["NtCreateFile"]

        def observe_nt_create_file(*native_args: object) -> int:
            attributes = ctypes.cast(
                native_args[2],
                ctypes.POINTER(api["ObjectAttributes"]),
            ).contents
            unicode_name = attributes.object_name.contents
            native_open_calls.append(
                (
                    int(native_args[1]),
                    int(native_args[8]),
                    int(unicode_name.length),
                    int(unicode_name.maximum_length),
                )
            )
            return int(native_nt_create_file(*native_args))

        def replace_with_junction(label: str, original: Path) -> None:
            attempted.add(label)
            replacement = original.with_name(f"{original.name}-{label}-moved")
            try:
                os.replace(original, replacement)
            except OSError:
                blocked.add(label)
                return
            moved.append((original, replacement))
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", f'mklink /J "{original}" "{external}"'],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode:
                raise AssertionError(f"could not create junction for {label}: {result.stderr}")

        def hook(stage: str, path: Path) -> None:
            if stage == "gdrive-source-root-pinned":
                replace_with_junction("source-root", self.frames_dir)
            elif stage == "gdrive-output-root-pinned":
                replace_with_junction("output-root", output_root)
                replace_with_junction("staging-child", staging_dir)
            elif stage == "gdrive-temp-archive-pinned" and path.name.endswith(".tmp"):
                replace_with_junction("temporary-archive", path)
            elif stage == "gdrive-final-archive-pinned" and path.name == "shard-0001.tar.gz":
                replace_with_junction("final-archive", path)
            elif stage == "gdrive-verification-root-pinned" and verify_root:
                replace_with_junction("verification-root", staging_dir)

        staging_args = argparse.Namespace(
            expected_manifest=str(self.expected_path),
            output=str(self.root / "staging-manifest.json"),
            output_dir=str(staging_dir),
            verified_files_from="",
            verification_receipt="",
            run_id=self.run_id,
            source_root=str(self.frames_dir),
            remote_staging_root="gdrive:status/main/staging/test",
            max_files=10,
            max_bytes=512 * 1024 * 1024,
            generated_at="",
        )
        try:
            with mock.patch.dict(api, {"NtCreateFile": observe_nt_create_file}):
                with mock.patch.object(run_daily_helpers, "_WINDOWS_RUNTIME_TEST_HOOK", hook):
                    payload = run_daily_helpers.create_gdrive_staging_shards(staging_args)
                    self.assertEqual(1, payload["stagedShardCount"])
                    verify_root = True
                    shard = payload["shards"][0]
                    run_daily_helpers._verify_published_staging_archive(
                        Path(shard["archivePath"]).parent,
                        shard["archiveName"],
                        shard["items"],
                        shard,
                    )
        finally:
            for original, replacement in reversed(moved):
                if original.is_symlink():
                    original.unlink()
                elif original.exists():
                    os.rmdir(original)
                if replacement.exists():
                    os.replace(replacement, original)

        expected_labels = {
            "output-root",
            "staging-child",
            "source-root",
            "temporary-archive",
            "final-archive",
            "verification-root",
        }
        self.assertEqual(expected_labels, attempted)
        self.assertEqual(expected_labels, blocked)
        self.assertTrue(native_open_calls)
        wchar_size = ctypes.sizeof(api["wintypes"].WCHAR)
        for desired_access, options, name_length, maximum_name_length in native_open_calls:
            self.assertEqual(api["SYNCHRONIZE"], desired_access & api["SYNCHRONIZE"])
            self.assertEqual(
                api["FILE_OPEN_REPARSE_POINT"],
                options & api["FILE_OPEN_REPARSE_POINT"],
            )
            self.assertEqual(
                api["FILE_SYNCHRONOUS_IO_NONALERT"],
                options & api["FILE_SYNCHRONOUS_IO_NONALERT"],
            )
            self.assertEqual(name_length + wchar_size, maximum_name_length)
        self.assertTrue((staging_dir / "shard-0001.tar.gz").is_file())
        for path, contents in external_sentinels.items():
            self.assertEqual(contents, path.read_text(encoding="utf-8"))
    def test_gdrive_manifest_paths_reject_absolute_traversal_separators_and_unsafe_archive_names(self) -> None:
        (self.frames_dir / "safe.jpg").write_bytes(b"safe")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        unsafe_paths = (
            "/absolute.jpg",
            "../traversal.jpg",
            "nested\\mixed.jpg",
            "C:/drive.jpg",
            "nested//empty.jpg",
            "NUL.jpg",
            "safe.jpg:ads",
            f"{'x' * 129}.jpg",
        )

        for index, unsafe_path in enumerate(unsafe_paths, start=1):
            with self.subTest(relative_path=unsafe_path):
                expected["items"][0]["relativePath"] = unsafe_path
                self.expected_path.write_text(json.dumps(expected), encoding="utf-8")
                batch_manifest = self.root / f"unsafe-batch-{index}.json"
                batch_dir = self.root / f"unsafe-batch-{index}"
                batch = self._helper(
                    "write-gdrive-upload-batches",
                    "--expected-manifest",
                    str(self.expected_path),
                    "--output",
                    str(batch_manifest),
                    "--output-dir",
                    str(batch_dir),
                    "--source-root",
                    str(self.frames_dir),
                )
                self.assertNotEqual(0, batch.returncode, self._format_process_output(batch))
                self.assertFalse(batch_manifest.exists())
                self.assertFalse(batch_dir.exists())

                staging_manifest = self.root / f"unsafe-staging-{index}.json"
                staging_dir = self.root / f"unsafe-staging-{index}"
                staging = self._helper(
                    "write-gdrive-staging-shards",
                    "--expected-manifest",
                    str(self.expected_path),
                    "--output",
                    str(staging_manifest),
                    "--output-dir",
                    str(staging_dir),
                    "--source-root",
                    str(self.frames_dir),
                )
                self.assertNotEqual(0, staging.returncode, self._format_process_output(staging))
                self.assertFalse(staging_manifest.exists())
                self.assertFalse(staging_dir.exists())

    def test_gdrive_expected_rejects_external_symlink_and_reparse_directory(self) -> None:
        external_root = self.root / "external"
        external_root.mkdir()
        sentinel = external_root / "sentinel.jpg"
        sentinel.write_bytes(b"external-sentinel")
        cases = (
            ("external-file.jpg", sentinel, False),
            ("external-directory", external_root, True),
        )

        for link_name, target, target_is_directory in cases:
            with self.subTest(link_name=link_name):
                linked_path = self.frames_dir / link_name
                try:
                    os.symlink(str(target), str(linked_path), target_is_directory=target_is_directory)
                except (NotImplementedError, OSError) as exc:
                    self.skipTest(f"symlink/reparse fixture unavailable: {exc}")
                try:
                    result = self._helper(
                        "write-gdrive-upload-expected",
                        "--frames-dir",
                        str(self.frames_dir),
                        "--output",
                        str(self.expected_path),
                        "--files-from-output",
                        str(self.files_from_path),
                        "--residual-queue",
                        str(self.residual_queue_path),
                    )
                    self.assertNotEqual(0, result.returncode, self._format_process_output(result))
                    self.assertEqual(b"external-sentinel", sentinel.read_bytes())
                finally:
                    linked_path.unlink()

    def test_gdrive_expected_rejects_hard_linked_external_media(self) -> None:
        external = self.root / "external-hard-link.jpg"
        external.write_bytes(b"hard-link-sentinel")
        linked_path = self.frames_dir / "hard-link.jpg"
        try:
            os.link(str(external), str(linked_path))
        except OSError as exc:
            self.skipTest(f"hard-link fixture unavailable: {exc}")

        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual(b"hard-link-sentinel", external.read_bytes())
        self.assertFalse(self.expected_path.exists())

    def test_gdrive_expected_skips_fifo_and_device_inputs_when_supported(self) -> None:
        created = []
        if os.name != "nt" and hasattr(os, "mkfifo"):
            fifo = self.frames_dir / "stream.jpg"
            try:
                os.mkfifo(str(fifo))
                created.append(fifo)
            except OSError:
                pass
        if os.name != "nt" and hasattr(os, "mknod") and hasattr(os, "makedev"):
            device = self.frames_dir / "device.jpg"
            try:
                os.mknod(str(device), stat.S_IFCHR | 0o600, os.makedev(1, 3))
                created.append(device)
            except OSError:
                pass
        if not created:
            self.skipTest("FIFO/device fixtures unavailable")

        self._write_expected()

        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.assertEqual([], expected["items"])
        self.assertEqual("", self.files_from_path.read_text(encoding="utf-8"))

    def test_gdrive_rejects_manifest_mutation_and_rename_before_batch_or_archive(self) -> None:
        mutated = self.frames_dir / "mutated.jpg"
        renamed = self.frames_dir / "renamed.jpg"
        mutated.write_bytes(b"before")
        renamed.write_bytes(b"rename")
        self._write_expected()

        mutated.write_bytes(b"after!")
        batch_manifest = self.root / "mutated-batches.json"
        batch = self._helper(
            "write-gdrive-upload-batches",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(batch_manifest),
            "--output-dir",
            str(self.root / "mutated-batches"),
            "--source-root",
            str(self.frames_dir),
        )
        self.assertNotEqual(0, batch.returncode, self._format_process_output(batch))
        self.assertFalse(batch_manifest.exists())

        self._write_expected()
        moved = self.frames_dir / "renamed-away.jpg"
        renamed.replace(moved)
        renamed.write_bytes(b"rename")
        staging_manifest = self.root / "renamed-staging.json"
        staging_dir = self.root / "renamed-staging"
        staging = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--source-root",
            str(self.frames_dir),
        )
        self.assertNotEqual(0, staging.returncode, self._format_process_output(staging))
        self.assertFalse(staging_manifest.exists())
        self.assertFalse((staging_dir / "shard-0001.tar.gz").exists())

    def test_gdrive_valid_nested_media_preserves_safe_batch_and_archive_identity(self) -> None:
        nested = self.frames_dir / "nested"
        nested.mkdir()
        media = nested / "safe-media.jpeg"
        media.write_bytes(b"nested-media")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.assertEqual(
            {"device", "inode", "mtimeNs", "ctimeNs"},
            set(expected["items"][0]["fileIdentity"]),
        )

        self.assertEqual("nested/safe-media.jpeg\n", self.files_from_path.read_text(encoding="utf-8"))
        batch_manifest = self.root / "nested-batches.json"
        batch_dir = self.root / "nested-batches"
        batch = self._helper(
            "write-gdrive-upload-batches",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(batch_manifest),
            "--output-dir",
            str(batch_dir),
            "--source-root",
            str(self.frames_dir),
        )
        self.assertEqual(0, batch.returncode, self._format_process_output(batch))
        self.assertEqual("nested/safe-media.jpeg\n", (batch_dir / "batch-0001.txt").read_text(encoding="utf-8"))

        staging_manifest = self.root / "nested-staging.json"
        staging_dir = self.root / "nested-staging"
        staging = self._helper(
            "write-gdrive-staging-shards",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(staging_manifest),
            "--output-dir",
            str(staging_dir),
            "--source-root",
            str(self.frames_dir),
        )
        self.assertEqual(0, staging.returncode, self._format_process_output(staging))
        with tarfile.open(staging_dir / "shard-0001.tar.gz", "r:gz") as archive:
            self.assertEqual(["nested/safe-media.jpeg"], archive.getnames())
            extracted = archive.extractfile("nested/safe-media.jpeg")
            self.assertIsNotNone(extracted)
            self.assertEqual(b"nested-media", extracted.read())
            extracted.close()
    def test_rclone_exit_zero_without_remote_proof_requires_backfill(self) -> None:
        frame = self.frames_dir / "weak.jpg"
        frame.write_text("frame\n", encoding="utf-8")
        self._write_expected()

        result = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--source-root",
            str(self.frames_dir),
            "--remote-root",
            "gdrive:frames",
            "--exit-code",
            "0",
            "--completion-proof",
            "rclone_exit_zero",
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        status = json.loads(self.status_path.read_text(encoding="utf-8"))
        self.assertEqual("backfill_required", status["status"])
        self.assertTrue(status["verificationRequired"])
        self.assertEqual(1, status["residualCount"])
        queue = [json.loads(line) for line in self.residual_queue_path.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(True, queue[0]["item"]["verificationRequired"])

    def test_gdrive_status_rejects_path_only_and_unbound_receipts_without_queue_loss(self) -> None:
        frame = self.frames_dir / "same-path.jpg"
        frame.write_bytes(b"before")
        self._write_expected()
        receipt_path = self.root / "verification-receipt.json"
        stale_receipt = self._write_remote_receipt(receipt_path)

        frame.write_bytes(b"after!")
        self._write_expected()
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        self.residual_queue_path.write_text(
            json.dumps(self._residual_entry(expected["items"][0]), sort_keys=True) + "\n",
            encoding="utf-8",
        )
        queue_before = self.residual_queue_path.read_bytes()
        self.status_path.write_bytes(b"prior status\n")

        missing = self._helper(
            "write-gdrive-upload-status",
            "--expected-manifest",
            str(self.expected_path),
            "--output",
            str(self.status_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--completion-proof",
            "remote_manifest_check",
            "--source-root",
            str(self.frames_dir),
            "--exit-code",
            "0",
        )
        self.assertNotEqual(0, missing.returncode, self._format_process_output(missing))
        self.assertIn("GDRIVE_VERIFICATION_RECEIPT_INVALID code=MISSING", missing.stderr)
        self.assertEqual(b"prior status\n", self.status_path.read_bytes())
        self.assertEqual(queue_before, self.residual_queue_path.read_bytes())
        def assert_rejected(raw_receipt: bytes, code: str) -> None:
            receipt_path.write_bytes(raw_receipt)
            result = self._helper(
                "write-gdrive-upload-status",
                "--expected-manifest",
                str(self.expected_path),
                "--output",
                str(self.status_path),
                "--residual-queue",
                str(self.residual_queue_path),
                "--verification-receipt",
                str(receipt_path),
                "--completion-proof",
                "remote_manifest_check",
                "--source-root",
                str(self.frames_dir),
                "--exit-code",
                "0",
            )
            self.assertNotEqual(0, result.returncode, self._format_process_output(result))
            self.assertIn(
                f"GDRIVE_VERIFICATION_RECEIPT_INVALID code={code}",
                result.stderr,
            )
            self.assertEqual(b"prior status\n", self.status_path.read_bytes())
            self.assertEqual(queue_before, self.residual_queue_path.read_bytes())

        assert_rejected(
            json.dumps(stale_receipt, sort_keys=True).encode("utf-8"),
            "BINDING",
        )
        fresh_receipt = self._write_remote_receipt(receipt_path)

        assert_rejected(b"same-path.jpg\n", "PATH_ONLY")
        assert_rejected(b'{"schemaVersion":2}', "REQUIRED_FIELD")

        duplicate = json.loads(json.dumps(fresh_receipt))
        duplicate["verifiedCount"] = 2
        duplicate["receiptCount"] = 2
        duplicate["verifiedRelativePaths"].append("same-path.jpg")
        duplicate["itemReceipts"].append(
            json.loads(json.dumps(duplicate["itemReceipts"][0]))
        )
        assert_rejected(json.dumps(duplicate, sort_keys=True).encode("utf-8"), "DUPLICATE")

        extra = json.loads(json.dumps(fresh_receipt))
        extra["verifiedCount"] = 2
        extra["receiptCount"] = 2
        extra["verifiedRelativePaths"].append("extra.jpg")
        extra_item = json.loads(json.dumps(extra["itemReceipts"][0]))
        extra_item["relativePath"] = "extra.jpg"
        extra["itemReceipts"].append(extra_item)
        assert_rejected(json.dumps(extra, sort_keys=True).encode("utf-8"), "EXTRA")

        stale_run = json.loads(json.dumps(fresh_receipt))
        stale_run["runId"] = "other-run"
        assert_rejected(json.dumps(stale_run, sort_keys=True).encode("utf-8"), "BINDING")

        stale_manifest = json.loads(json.dumps(fresh_receipt))
        stale_manifest["expectedManifestSha256"] = "0" * 64
        assert_rejected(json.dumps(stale_manifest, sort_keys=True).encode("utf-8"), "BINDING")

        wrong_identity = json.loads(json.dumps(fresh_receipt))
        wrong_identity["itemReceipts"][0]["fileIdentity"]["inode"] += 1
        assert_rejected(
            json.dumps(wrong_identity, sort_keys=True).encode("utf-8"),
            "IDENTITY",
        )
    def test_write_queue_faults_preserve_prior_records_and_owned_temp_cleanup(self) -> None:
        queue_path = self.root / "fault-injected-queue.jsonl"
        prior_entries = [{"record": "prior"}]
        next_entries = [{"record": "prior"}, {"record": "next"}]
        run_daily_helpers._write_queue(queue_path, prior_entries)
        prior_bytes = queue_path.read_bytes()
        unrelated_temp = self.root / "unowned-queue-temp"
        unrelated_temp.write_bytes(b"keep")

        fault_contexts = (
            (
                "open",
                lambda: mock.patch.object(
                    run_daily_helpers.tempfile,
                    "mkstemp",
                    side_effect=OSError("open failure"),
                ),
            ),
            (
                "write",
                lambda: mock.patch.object(
                    run_daily_helpers.os,
                    "write",
                    side_effect=OSError("write failure"),
                ),
            ),
            (
                "file-fsync",
                lambda: mock.patch.object(
                    run_daily_helpers.os,
                    "fsync",
                    side_effect=OSError("fsync failure"),
                ),
            ),
            (
                "replace",
                lambda: mock.patch.object(
                    run_daily_helpers.os,
                    "replace",
                    side_effect=OSError("replace failure"),
                ),
            ),
            (
                "directory-fsync",
                lambda: mock.patch.object(
                    run_daily_helpers,
                    "_fsync_parent_directory",
                    side_effect=OSError("directory fsync failure"),
                ),
            ),
            (
                "enospc",
                lambda: mock.patch.object(
                    run_daily_helpers.os,
                    "write",
                    side_effect=OSError(errno.ENOSPC, "no space"),
                ),
            ),
        )

        for fault_name, context in fault_contexts:
            with self.subTest(fault=fault_name):
                with context():
                    with self.assertRaises(OSError):
                        run_daily_helpers._write_queue(queue_path, next_entries)
                self.assertEqual(prior_bytes, queue_path.read_bytes())
                self.assertEqual(b"keep", unrelated_temp.read_bytes())
                self.assertEqual(
                    [],
                    list(self.root.glob(f".{queue_path.name}.*.tmp")),
                )
    def _residual_entry(
        self,
        item: dict,
        *,
        attempts: int = 0,
        first_seen_epoch: Optional[int] = None,
        last_exit_code: int = 0,
    ) -> dict:
        return {
            "schemaVersion": 2,
            "firstSeenAt": "2026-04-28T00:00:00Z",
            "firstSeenEpoch": int(time.time()) if first_seen_epoch is None else first_seen_epoch,
            "lastAttemptAt": "2026-04-28T00:00:00Z",
            "attempts": attempts,
            "lastExitCode": last_exit_code,
            "item": item,
        }
    def _write_expected(self) -> None:
        result = self._helper(
            "write-gdrive-upload-expected",
            "--frames-dir",
            str(self.frames_dir),
            "--output",
            str(self.expected_path),
            "--files-from-output",
            str(self.files_from_path),
            "--residual-queue",
            str(self.residual_queue_path),
            "--remote-root",
            "gdrive:frames",
            "--run-id",
            self.run_id,
        )
        self.assertEqual(0, result.returncode, self._format_process_output(result))

    def _write_remote_receipt(
        self,
        receipt_path: Path,
        verified_paths: Optional[set[str]] = None,
    ) -> dict:
        expected = json.loads(self.expected_path.read_text(encoding="utf-8"))
        verified = (
            {item["relativePath"] for item in expected["items"]}
            if verified_paths is None
            else verified_paths
        )
        remote_list_path = self.root / f"{receipt_path.stem}-remote-list.json"
        remote_list_path.write_text(
            json.dumps(
                [
                    {
                        "Path": item["relativePath"],
                        "Size": item["size"],
                        "Hashes": {"MD5": item["md5"]},
                    }
                    for item in expected["items"]
                    if item["relativePath"] in verified
                ],
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        result = self._helper(
            "write-gdrive-remote-verification",
            "--expected-manifest",
            str(self.expected_path),
            "--remote-list",
            str(remote_list_path),
            "--output",
            str(receipt_path),
            "--run-id",
            self.run_id,
        )
        self.assertEqual(0, result.returncode, self._format_process_output(result))
        return json.loads(receipt_path.read_text(encoding="utf-8"))
    def _helper(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [PYTHON_BIN, str(RUN_DAILY_HELPER_SOURCE), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def _format_process_output(self, result: subprocess.CompletedProcess[str]) -> str:
        return f"exit={result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"


class DailyPublicationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.artifact = self.root / "artifact"
        self.artifact.mkdir()
        self.bundle = self.artifact / "daily-data-publication.tar"
        self.manifest = self.artifact / "publication-manifest.json"
        self.sidecar = self.artifact / "publication-manifest.sha256"
        self.repository = "owner/repository"
        self.execution_sha = "a" * 40
        self.base_sha = "b" * 40
        self.base_tree = "c" * 40
        self.relative_path = "backend/restaurant-crawling/data/published.json"
        self.data = b'{"published":true}\n'

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_manifest(self, *, path: str | None = None, mode: str = "0644") -> None:
        bundle_digest = hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        payload = {
            "schemaVersion": 1,
            "kind": "daily-data-publication",
            "repository": self.repository,
            "executionSha": self.execution_sha,
            "base": {"sha": self.base_sha, "tree": self.base_tree},
            "targetBranch": "data",
            "bundle": {
                "path": "daily-data-publication.tar",
                "size": self.bundle.stat().st_size,
                "sha256": bundle_digest,
            },
            "files": [
                {
                    "path": path or self.relative_path,
                    "mode": mode,
                    "size": len(self.data),
                    "sha256": hashlib.sha256(self.data).hexdigest(),
                }
            ],
        }
        self.manifest.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
        self.compute_manifest_sha256 = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.sidecar.write_text(
            f"{self.compute_manifest_sha256}  publication-manifest.json\n",
            encoding="ascii",
        )

    def _write_bundle(
        self,
        *,
        member_name: str | None = None,
        member_mode: int = 0o644,
        member_type: bytes | None = None,
        extra_member: bool = False,
    ) -> None:
        with tarfile.open(self.bundle, "w") as archive:
            member = tarfile.TarInfo(member_name or self.relative_path)
            member.mode = member_mode
            if member_type is not None:
                member.type = member_type
                member.linkname = "outside"
                member.size = 0
                archive.addfile(member)
            else:
                member.size = len(self.data)
                archive.addfile(member, io.BytesIO(self.data))
            if extra_member:
                extra = tarfile.TarInfo("backend/restaurant-evaluation/data/extra.json")
                extra.mode = 0o644
                extra.size = len(self.data)
                archive.addfile(extra, io.BytesIO(self.data))

    def _validator(
        self,
        command: str,
        *,
        base_sha: str | None = None,
        compute_manifest_sha256: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        arguments = [
            PYTHON_BIN,
            str(PUBLISHER_VALIDATOR_SOURCE),
            command,
            "--manifest",
            str(self.manifest),
            "--manifest-sha256",
            str(self.sidecar),
            "--bundle",
            str(self.bundle),
            "--expected-repository",
            self.repository,
            "--expected-execution-sha",
            self.execution_sha,
            "--expected-target-branch",
            "data",
            "--expected-base-sha",
            base_sha or self.base_sha,
            "--expected-base-tree",
            self.base_tree,
            "--expected-compute-manifest-sha256",
            compute_manifest_sha256 or self.compute_manifest_sha256,
            "--expected-artifact-digest",
            f"sha256:{'d' * 64}",
        ]
        if command == "extract":
            arguments.extend(("--destination", str(self.root / f"extracted-{time.monotonic_ns()}")))
        return subprocess.run(arguments, capture_output=True, text=True, check=False)

    def _verify(
        self,
        *,
        base_sha: str | None = None,
        compute_manifest_sha256: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return self._validator(
            "verify",
            base_sha=base_sha,
            compute_manifest_sha256=compute_manifest_sha256,
        )

    def _extract(self) -> subprocess.CompletedProcess[str]:
        return self._validator("extract")

    def test_publisher_source_separates_secret_compute_from_write_publish(self) -> None:
        workflow = DAILY_CRAWLER_WORKFLOW.read_text(encoding="utf-8")
        compute = workflow.split("  daily-compute:", 1)[1].split("  daily-publish:", 1)[0]
        publisher = workflow.split("  daily-publish:", 1)[1]

        self.assertIn("contents: read", compute)
        self.assertNotIn("contents: write", compute)
        self.assertIn("contents: write", publisher)
        self.assertIn("persist-credentials: false", compute)
        self.assertIn("persist-credentials: false", publisher)
        self.assertEqual(2, workflow.count("ref: ${{ github.sha }}"))
        self.assertNotIn("github.event.inputs.checkout_ref", workflow)
        self.assertIn("RUN_DAILY_WORKFLOW_COMPUTE: \"true\"", compute)
        self.assertIn("artifact-digest", compute)
        self.assertIn("publication_manifest_sha256", compute)
        self.assertIn("actions/download-artifact@", publisher)
        self.assertIn("EXPECTED_COMPUTE_MANIFEST_SHA256", publisher)
        self.assertIn("--expected-compute-manifest-sha256", publisher)
        self.assertIn("validate_daily_publication_bundle.py extract", publisher)
        self.assertIn("GIT_ASKPASS", publisher)
        self.assertNotIn("secrets.", publisher)
        for forbidden in (
            "SUPABASE_",
            "GDRIVE_",
            "GEMINI_",
            "YOUTUBE_",
            "NAVER_",
            "NCP_",
            "OPENAI_",
        ):
            self.assertNotIn(forbidden, publisher)

        run_daily = RUN_DAILY_SOURCE.read_text(encoding="utf-8")
        sync_section = run_daily.split("sync_data_to_remote() {", 1)[1].split("# ============================================================", 1)[0]
        self.assertLess(
            sync_section.index('if [ "$WORKFLOW_COMPUTE_MODE" = "true" ]; then'),
            sync_section.index("commit_and_push_current_repo_data"),
        )
        self.assertIn("workflow compute mode defers data publication", sync_section)
        self.assertIn("write-daily-publication-bundle", run_daily)

    def test_publisher_rejects_manifest_drift_and_base_mismatch(self) -> None:
        self._write_bundle()
        self._write_manifest()
        self.manifest.write_text("{}\n", encoding="utf-8")
        drift = self._verify()
        self.assertNotEqual(0, drift.returncode)
        self.assertIn("compute-bound SHA-256", drift.stderr)

        current_manifest_sha256 = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        sidecar_drift = self._verify(compute_manifest_sha256=current_manifest_sha256)
        self.assertNotEqual(0, sidecar_drift.returncode)
        self.assertIn("sidecar", sidecar_drift.stderr)

        self._write_manifest()
        base_mismatch = self._verify(base_sha="e" * 40)
        self.assertNotEqual(0, base_mismatch.returncode)
        self.assertIn("base does not match", base_mismatch.stderr)

    def test_publisher_rejects_whole_artifact_replacement_against_compute_digest(self) -> None:
        self._write_bundle()
        self._write_manifest()
        original_compute_manifest_sha256 = self.compute_manifest_sha256

        self.data = b'{"published":false}\n'
        self._write_bundle()
        self._write_manifest()
        internally_consistent = self._verify()
        self.assertEqual(0, internally_consistent.returncode, internally_consistent.stderr)

        replacement = self._verify(compute_manifest_sha256=original_compute_manifest_sha256)
        self.assertNotEqual(0, replacement.returncode)
        self.assertIn("compute-bound SHA-256", replacement.stderr)

    def test_publisher_rejects_unsafe_artifact_members_and_executables(self) -> None:
        self._write_bundle(member_name="../outside.json")
        self._write_manifest()
        traversal = self._extract()
        self.assertNotEqual(0, traversal.returncode)
        self.assertIn("unexpected member", traversal.stderr)

        self._write_bundle(member_type=tarfile.SYMTYPE)
        self._write_manifest()
        symlink = self._extract()
        self.assertNotEqual(0, symlink.returncode)
        self.assertIn("member type is unsafe", symlink.stderr)

        self._write_bundle(member_mode=0o755)
        self._write_manifest(mode="0755")
        executable = self._verify()
        self.assertNotEqual(0, executable.returncode)
        self.assertIn("mode is not permitted", executable.stderr)

        self._write_bundle(extra_member=True)
        self._write_manifest()
        extra_member = self._extract()
        self.assertNotEqual(0, extra_member.returncode)
        self.assertIn("unexpected member", extra_member.stderr)

    def test_publication_forbidden_name_regex_allows_video_id_with_log_substring(self) -> None:
        """Video IDs like kvXlRgISLog or ZddLoGspggw contain 'log' but are not secrets."""
        regex = run_daily_helpers._PUBLICATION_FORBIDDEN_NAME_RE
        # Must NOT match: video IDs that happen to contain 'log'/'token' as substring
        self.assertIsNone(regex.search("kvXlRgISLog"))
        self.assertIsNone(regex.search("ZddLoGspggw"))
        self.assertIsNone(regex.search("aTokenBig123"))  # camelCase embedded
        self.assertIsNone(regex.search("xLoGy"))
        self.assertIsNone(regex.search("blogpost"))
        # MUST match: actual secret/log filenames
        self.assertIsNotNone(regex.search("credentials"))
        self.assertIsNotNone(regex.search("oauth_credentials"))
        self.assertIsNotNone(regex.search("cookies"))
        self.assertIsNotNone(regex.search("secret_key"))
        self.assertIsNotNone(regex.search("access_token"))
        self.assertIsNotNone(regex.search("api-token"))
        self.assertIsNotNone(regex.search("password"))
        self.assertIsNotNone(regex.search("user_password"))
        self.assertIsNotNone(regex.search("run.log"))  # stem is 'run'
        self.assertIsNotNone(regex.search("upload-log"))
        self.assertIsNotNone(regex.search("pipeline_log"))
        self.assertIsNotNone(regex.search("cookie.bak"))
        self.assertIsNotNone(regex.search("credential"))


class BackendGuardrailScriptTests(unittest.TestCase):
    maxDiff = None
    def test_gemini_defaults_prefer_37_flash_only(self) -> None:
        config = (REPO_ROOT / "backend" / "config" / "channels.yaml").read_text(encoding="utf-8")
        crawling_script = (
            REPO_ROOT / "backend" / "restaurant-crawling" / "scripts" / "08-chunk-multimodal-crawling.sh"
        ).read_text(encoding="utf-8")
        laaj_script = (
            REPO_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "11-laaj-evaluation.sh"
        ).read_text(encoding="utf-8")
        final_merge = (
            REPO_ROOT / "backend" / "restaurant-crawling" / "scripts" / "final_merge_chunk.mjs"
        ).read_text(encoding="utf-8")
        map_crawling = (
            REPO_ROOT / "backend" / "restaurant-crawling" / "scripts" / "05-map-url-crawling.js"
        ).read_text(encoding="utf-8")
        runtime_preflight = (REPO_ROOT / "backend" / "bin" / "check_gemini_runtime.mjs").read_text(
            encoding="utf-8"
        )

        self.assertIn('- "gemini-3.7-flash"', config)
        self.assertNotIn('- "gemini-3.6-flash"', config)
        self.assertNotIn('- "gemini-3.5-flash"', config)
        self.assertIn('PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3.7-flash}"', crawling_script)
        self.assertIn('FALLBACK_MODEL="${FALLBACK_MODEL:-gemini-3.7-flash}"', crawling_script)
        self.assertIn('GEMINI_THINKING_LEVEL="${GEMINI_THINKING_LEVEL:-LOW}"', crawling_script)
        self.assertIn('GEMINI_CHUNK_THINKING_LEVEL="${GEMINI_CHUNK_THINKING_LEVEL:-$GEMINI_THINKING_LEVEL}"', crawling_script)
        self.assertIn('GEMINI_FINAL_MERGE_THINKING_LEVEL="${GEMINI_FINAL_MERGE_THINKING_LEVEL:-MEDIUM}"', crawling_script)
        self.assertIn("process.env.GEMINI_FINAL_MERGE_THINKING_LEVEL", final_merge)
        self.assertIn("'MEDIUM'", final_merge)
        self.assertIn("process.env.GEMINI_MAP_THINKING_LEVEL", map_crawling)
        self.assertIn("'MEDIUM'", map_crawling)
        self.assertIn('PRIMARY_MODEL="${PRIMARY_MODEL:-gemini-3.7-flash}"', laaj_script)
        self.assertIn('FALLBACK_MODEL="${LAAJ_FALLBACK_MODEL:-gemini-3.7-flash}"', laaj_script)
        self.assertIn('LAAJ_THINKING_LEVEL="${LAAJ_THINKING_LEVEL:-MEDIUM}"', laaj_script)
        self.assertIn("process.env.CURRENT_MODEL || process.env.PRIMARY_MODEL || 'gemini-3.7-flash'", runtime_preflight)
        self.assertIn("process.env.GEMINI_PREFLIGHT_THINKING_LEVEL", runtime_preflight)
        self.assertIn("'LOW'", runtime_preflight)

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_production_contract_fixture_checker_reports_transform_drift(self) -> None:
        transforms = self.root / "transforms.jsonl"
        output = self.root / "fixture-status.json"
        transforms.write_text(
            json.dumps(
                {
                    "trace_id": "trace-1",
                    "youtube_link": "https://www.youtube.com/watch?v=fixture1",
                    "channel_name": "tzuyang",
                    "origin_name": "계약식당",
                    "source_type": "geminiCLI",
                    "lat": 37.5,
                    "lng": 127.0,
                    "evaluation_results": {"location_match_TF": []},
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            + "\n"
            + json.dumps(
                {
                    "trace_id": "trace-1",
                    "youtube_link": "https://www.youtube.com/watch?v=fixture1",
                    "channel_name": "tzuyang",
                    "origin_name": "중복식당",
                    "source_type": "geminiCLI",
                    "lat": 37.6,
                    "lng": 127.1,
                    "evaluation_results": {"location_match_TF": []},
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        result = subprocess.run(
            [
                PYTHON_BIN,
                str(PRODUCTION_FIXTURE_CHECK_SOURCE),
                "--transforms-jsonl",
                str(transforms),
                "--output",
                str(output),
                "--fail-on-error",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(1, result.returncode, self._format_process_output(result))
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual("error", payload["status"])
        self.assertEqual(1, payload["checks"]["transformJsonl"]["errorCount"])
        self.assertEqual("duplicate_trace_id", payload["checks"]["transformJsonl"]["validationErrors"][0]["rule"])

    def test_actions_budget_checker_writes_unknown_without_token(self) -> None:
        output = self.root / "actions-budget.json"
        env = os.environ.copy()
        env.pop("GITHUB_TOKEN", None)
        result = subprocess.run(
            [
                PYTHON_BIN,
                str(ACTIONS_BUDGET_CHECK_SOURCE),
                "--repository",
                "twoimo/tzudong",
                "--workflow",
                "daily-crawler.yml",
                "--output",
                str(output),
                "--checked-at",
                "2026-05-07T00:00:00Z",
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual("unknown", payload["status"])
        self.assertEqual("repository_or_token_missing", payload["detail"])
        self.assertEqual("unknown", payload["repositoryVisibility"])

    def _format_process_output(self, result: subprocess.CompletedProcess[str]) -> str:
        return f"exit={result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"


class RunDailyRegressionTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_privileged_supabase_clients_use_canonical_service_role_credentials(self) -> None:
        prohibited_environment_names = (
            "VITE_SUPABASE_",
            "NEXT_PUBLIC_SUPABASE_",
            "PUBLIC_SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_KEY",
        )
        for source_path in PRIVILEGED_SUPABASE_CLIENT_SOURCES:
            source = source_path.read_text(encoding="utf-8")
            with self.subTest(source=source_path.name):
                self.assertIn("resolve_privileged_supabase_rest_credentials", source)
                self.assertIn("SupabaseRestConfigurationError", source)
                self.assertIn(
                    "create_client(credentials.url, credentials.service_role_key)",
                    source,
                )
                for environment_name in prohibited_environment_names:
                    self.assertNotIn(environment_name, source)

        required_credentials = '[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]'
        run_daily_source = RUN_DAILY_SOURCE.read_text(encoding="utf-8")
        for readiness_function, next_function in (
            ("has_supabase_migration_credentials() {", "has_supabase_insert_credentials() {"),
            ("has_supabase_insert_credentials() {", "has_youtube_api_key()"),
        ):
            readiness = run_daily_source.split(readiness_function, 1)[1].split(next_function, 1)[0]
            with self.subTest(readiness_function=readiness_function):
                self.assertIn(required_credentials, readiness)
                self.assertNotIn("VITE_SUPABASE_", readiness)
                self.assertNotIn("SUPABASE_KEY", readiness)


    def test_happy_path_exits_zero(self) -> None:
        result = self._run_script()

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        manifest = self._read_manifest()
        self.assertEqual("OK", manifest["finalStatus"])
        self.assertEqual(0, manifest["finalExitCode"])
        self.assertEqual([], manifest["failedRequiredSteps"])
        self.assertEqual([], manifest["optionalSkips"])
        self.assertEqual([], manifest["downstreamSkips"])
        self.assertTrue(manifest["noWorkShortCircuit"])
        self.assertEqual("end_to_end", manifest["policyMode"])
        completed_events = {
            event["name"]: event
            for event in manifest["stepEvents"]
            if event["status"] == "completed"
        }
        for step_name in (
            "Step 3 (Transcript)",
            "Step 3.1 (Context Generation)",
            "Step 4 (Heatmap & Frames)",
        ):
            self.assertIn(step_name, completed_events)
            self.assertIsInstance(completed_events[step_name]["durationSeconds"], int)
            self.assertGreaterEqual(completed_events[step_name]["durationSeconds"], 0)
        self.assertIn("[TIMING] Step 3 (Transcript):", result.stdout)
        self.assertIn("[TIMING] Step 3.1 (Context Generation):", result.stdout)
        self.assertIn("[TIMING] Step 4 (Heatmap & Frames):", result.stdout)
        self.assertIn("[METRIC] Step 4 frame files (directory total): before=0, after=1, delta=1", result.stdout)

    def test_transcript_failure_returns_non_zero_exit(self) -> None:
        result = self._run_script(transcript_exit=17)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Transcript 비정상 종료 (exit: 17)", result.stdout)

    def test_final_sync_failure_returns_non_zero_exit(self) -> None:
        result = self._run_script(final_sync_stage_failure=True)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("simulated git add failure", self._format_process_output(result))

    def test_missing_gemini_key_skips_chunk_step_and_returns_non_zero_exit(self) -> None:
        result = self._run_script(env_overrides={"GEMINI_API_KEY_BYEON": None}, force_phase3=True)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Step 08 (Chunk Multimodal) 실패", result.stdout)
        self.assertIn("Gemini API 키", result.stdout)
        self.assertNotIn("모든 필수 단계가 완료되었습니다!", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertEqual(1, manifest["finalExitCode"])
        self.assertTrue(any("Step 08 (Chunk Multimodal)" in item for item in manifest["failedRequiredSteps"]))
        self.assertEqual([], manifest["optionalSkips"])
        self.assertTrue(any("Step 09~13 (Evaluation)" in item for item in manifest["downstreamSkips"]))
        self.assertTrue(
            any(
                event["name"] == "Step 08 (Chunk Multimodal)" and event["status"] == "failed"
                for event in manifest["stepEvents"]
            )
        )
        self.assertTrue(
            any(
                event["name"] == "Step 09~13 (Evaluation)"
                and event["status"] == "downstream_skipped"
                and event["upstreamStep"] == "Step 08 (Chunk Multimodal)"
                for event in manifest["stepEvents"]
            )
        )

    def test_step08_quota_policy_remains_required_when_pending_work_exists(self) -> None:
        result = self._run_script(
            env_overrides={"RUN_DAILY_VERIFY_REQUIRED_SCENARIO": "step08_quota"},
            force_phase3=True,
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Gemini quota 초과", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertTrue(any("Step 08 (Chunk Multimodal)" in item for item in manifest["failedRequiredSteps"]))
        self.assertTrue(
            any(
                event["name"] == "Step 08 (Chunk Multimodal)" and event["status"] == "failed"
                for event in manifest["stepEvents"]
            )
        )

    def test_step08_login_expired_exit_records_required_failure_and_downstream_skip(self) -> None:
        result = self._run_script(
            env_overrides={"RUN_DAILY_TEST_CHUNK_EXIT": "44"},
            force_phase3=True,
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Google 로그인 세션 만료 (exit=44)", result.stdout)
        self.assertIn("Step 08 로그인 prerequisite 미충족", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertTrue(
            any(
                "Step 08 (Chunk Multimodal)" in item and "Google 로그인 세션 만료 (exit=44)" in item
                for item in manifest["failedRequiredSteps"]
            )
        )
        self.assertTrue(
            any(
                "Step 09~13 (Evaluation)" in item and "Step 08 로그인 prerequisite 미충족" in item
                for item in manifest["downstreamSkips"]
            )
        )
        self.assertTrue(
            any(
                event["name"] == "Step 09~13 (Evaluation)"
                and event["status"] == "downstream_skipped"
                and event["reason"] == "Step 08 로그인 prerequisite 미충족"
                and event["upstreamStep"] == "Step 08 (Chunk Multimodal)"
                for event in manifest["stepEvents"]
            )
        )

    def test_public_only_supabase_env_skips_insert_stage_in_local_mode(self) -> None:
        result = self._run_script(
            env_overrides={
                "SUPABASE_URL": None,
                "SUPABASE_SERVICE_ROLE_KEY": None,
                "PUBLIC_SUPABASE_URL": "https://public.stub.supabase.co",
                "NEXT_PUBLIC_SUPABASE_URL": "https://public.stub.supabase.co",
                "VITE_SUPABASE_PUBLISHABLE_KEY": "stub-publishable-key",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": "stub-anon-key",
            },
            force_phase3=True,
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Step 13 (Supabase) 선택 건너뜀", result.stdout)
        self.assertIn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY", result.stdout)
        self.assertNotIn("[Step 13] Insert to Supabase...", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("WARN", manifest["finalStatus"])
        self.assertEqual(0, manifest["finalExitCode"])
        self.assertTrue(any("Step 13 (Supabase)" in item for item in manifest["optionalSkips"]))
        self.assertEqual([], manifest["failedRequiredSteps"])
        self.assertEqual([], manifest["downstreamSkips"])
        self.assertTrue(
            any(
                event["name"] == "Step 13 (Supabase)" and event["status"] == "optional_skipped"
                for event in manifest["stepEvents"]
            )
        )

    def test_dedicated_supabase_credentials_enable_insert_stage(self) -> None:
        result = self._run_script(force_phase3=True)

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("[Step 13] Insert to Supabase...", result.stdout)
        self.assertIn("성공 (Insert): 0", result.stdout)

        manifest = self._read_manifest()
        self.assertTrue(
            any(
                event["name"] == "Step 13 (Supabase)" and event["status"] == "completed"
                for event in manifest["stepEvents"]
            )
        )

    def test_supabase_insert_failure_returns_non_zero_exit(self) -> None:
        result = self._run_script(supabase_insert_exit=23, force_phase3=True)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Step 13 (Supabase) 실패", result.stdout)
        self.assertIn("필수 단계 실패가 감지되었습니다", result.stdout)
        self.assertNotIn("모든 필수 단계가 완료되었습니다!", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertEqual(1, manifest["finalExitCode"])
        self.assertTrue(any("Step 13 (Supabase)" in item for item in manifest["failedRequiredSteps"]))

    def test_manifest_write_failure_returns_non_zero_exit(self) -> None:
        blocked_manifest_dir = self.root / "project" / "tmp" / "blocked-manifest"

        def fixture_mutator(_project_root: Path, _state_dir: Path) -> None:
            blocked_manifest_dir.parent.mkdir(parents=True, exist_ok=True)
            blocked_manifest_dir.write_text("not a directory\n", encoding="utf-8")

        result = self._run_script(
            env_overrides={"RUN_DAILY_MANIFEST_PATH": str(blocked_manifest_dir / "current-summary.json")},
            fixture_mutator=fixture_mutator,
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("run_daily summary manifest write failed", result.stdout)
        self.assertIn("success exit downgraded to failure", result.stdout)
        self.assertFalse((blocked_manifest_dir / "current-summary.json").exists())

    def test_manifest_readback_failure_returns_non_zero_exit(self) -> None:
        result = self._run_script(
            env_overrides={"RUN_DAILY_TEST_CORRUPT_SUMMARY_MANIFEST_AFTER_WRITE": "1"}
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("run_daily summary manifest write failed or readback failed", result.stdout)
        self.assertIn("summary manifest readback:", result.stdout)
        self.assertIn("success exit downgraded to failure", result.stdout)

    def test_branch_safe_mode_failure_still_writes_summary_manifest(self) -> None:
        result = self._run_script(env_overrides={"RUN_DAILY_TEST_CURRENT_BRANCH": "main"})

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("FORCE_BRANCH_SWITCH=1", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertEqual(1, manifest["finalExitCode"])
        self.assertTrue(any("Branch Check" in item for item in manifest["failedRequiredSteps"]))
        self.assertEqual([], manifest["optionalSkips"])
        self.assertEqual([], manifest["downstreamSkips"])
        self.assertEqual("data", manifest["runtime"]["targetBranch"])

    def test_split_worktree_failure_still_writes_summary_manifest(self) -> None:
        result = self._run_script(
            env_overrides={
                "CI": "true",
                "RUN_DAILY_EXECUTION_BRANCH": "main",
                "RUN_DAILY_TARGET_BRANCH": "data",
                "RUN_DAILY_TEST_CURRENT_BRANCH": "main",
                "RUN_DAILY_TEST_WORKTREE_ADD_FAILURE": "1",
            }
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("실행용 코드와 데이터 동기화 브랜치 분리 준비 실패", result.stdout)

        manifest = self._read_manifest()
        self.assertEqual("ERROR", manifest["finalStatus"])
        self.assertEqual(1, manifest["finalExitCode"])
        self.assertTrue(any("Split Data Sync Worktree" in item for item in manifest["failedRequiredSteps"]))
        self.assertEqual("main", manifest["runtime"]["executionBranch"])
        self.assertEqual("data", manifest["runtime"]["targetBranch"])

    def test_ci_validation_target_branch_uses_checked_out_branch_for_sync(self) -> None:
        target_branch = "verify-target"
        result = self._run_script(
            env_overrides={
                "CI": "true",
                "RUN_DAILY_EXECUTION_BRANCH": target_branch,
                "RUN_DAILY_TARGET_BRANCH": target_branch,
                "RUN_DAILY_TEST_CURRENT_BRANCH": target_branch,
                "RUN_DAILY_TEST_PENDING_DATA_CHANGES": "1",
            }
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn(f"현재 작업 브랜치: {target_branch}", result.stdout)
        self.assertIn(f"[Final] '{target_branch}' 브랜치에 최종 데이터 저장...", result.stdout)
        self.assertIn(f"{target_branch} 브랜치 업데이트 완료 (Final Sync)", result.stdout)
        self.assertNotIn("브랜치 전환 완료: data", result.stdout)

        git_log = (self.root / "state" / "git_commands.log").read_text(encoding="utf-8")
        self.assertIn(f"pull --rebase --autostash origin {target_branch}", git_log)
        self.assertIn(f"push origin {target_branch}", git_log)
        self.assertNotIn("origin data", git_log)
        self.assertNotIn("worktree add", git_log)

    def test_default_branch_execution_syncs_data_via_split_worktree(self) -> None:
        result = self._run_script(
            env_overrides={
                "CI": "true",
                "RUN_DAILY_EXECUTION_BRANCH": "main",
                "RUN_DAILY_TARGET_BRANCH": "data",
                "RUN_DAILY_TEST_CURRENT_BRANCH": "main",
                "RUN_DAILY_TEST_PENDING_DATA_CHANGES": "1",
            }
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("코드는 'main' 브랜치에서 실행하고 데이터는 'data' 브랜치로 동기화합니다.", result.stdout)
        self.assertIn("현재 작업 브랜치: main", result.stdout)
        self.assertIn("[Final] 'data' 브랜치에 최종 데이터 저장...", result.stdout)
        self.assertNotIn("브랜치 전환 완료: data", result.stdout)

        git_log = (self.root / "state" / "git_commands.log").read_text(encoding="utf-8")
        self.assertIn("pull --rebase --autostash origin main", git_log)
        self.assertIn("worktree add --force", git_log)
        self.assertIn("pull --rebase --autostash origin data", git_log)
        self.assertIn("push origin data", git_log)
        self.assertIn("worktree remove --force", git_log)
        self.assertNotIn("checkout data", git_log)

        summary = (self.root / "project" / "tmp" / "summary.md").read_text(encoding="utf-8")
        self.assertIn("**Execution Branch**: [`main`]", summary)
        self.assertIn("**Data Sync Branch**: [`data`]", summary)
        self.assertIn("TZUDONG PIPELINE FLOW", summary)

        project_data_dir = self.root / "project" / "backend" / "restaurant-crawling" / "data"
        self.assertTrue((project_data_dir / "credentials.json").exists())
        self.assertTrue((project_data_dir / "cookies.txt").exists())

    def test_default_branch_execution_initializes_missing_data_sync_branch(self) -> None:
        result = self._run_script(
            env_overrides={
                "CI": "true",
                "RUN_DAILY_EXECUTION_BRANCH": "main",
                "RUN_DAILY_TARGET_BRANCH": "data",
                "RUN_DAILY_TEST_CURRENT_BRANCH": "main",
                "RUN_DAILY_TEST_REMOTE_BRANCH_MISSING": "data",
                "RUN_DAILY_TEST_PENDING_DATA_CHANGES": "0",
            }
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("원격 동기화 브랜치가 없어 현재 실행 브랜치에서 초기화합니다: data", result.stdout)
        self.assertIn("동기화 브랜치 초기 push 완료: data", result.stdout)
        self.assertIn("코드는 'main' 브랜치에서 실행하고 데이터는 'data' 브랜치로 동기화합니다.", result.stdout)

        git_log = (self.root / "state" / "git_commands.log").read_text(encoding="utf-8")
        self.assertIn("ls-remote --exit-code --heads origin data", git_log)
        self.assertIn("worktree add --force", git_log)
        self.assertIn("push -u origin data", git_log)
        self.assertNotIn("fetch origin data", git_log)
        self.assertNotIn("pull --rebase --autostash origin data", git_log)
    def test_daily_log_replaces_planted_current_link_without_touching_sentinel(self) -> None:
        sentinel = self.root / "external-current-sentinel.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")

        def plant_current_link(project_root: Path, _state_dir: Path) -> None:
            log_dir = project_root / "tmp" / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            try:
                (log_dir / "current.log").symlink_to(sentinel)
            except OSError as exc:
                self.skipTest(f"symbolic links are unavailable: {exc}")

        result = self._run_script(fixture_mutator=plant_current_link)

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual("unchanged\n", sentinel.read_text(encoding="utf-8"))
        current_log = self.root / "project" / "tmp" / "logs" / "current.log"
        self.assertTrue(current_log.is_symlink())
        self.assertTrue((current_log.parent / current_log.readlink()).is_file())

    def test_daily_log_rejects_planted_log_link_without_touching_sentinel(self) -> None:
        sentinel = self.root / "external-daily-sentinel.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        def plant_daily_link(project_root: Path, _state_dir: Path) -> None:
            log_dir = project_root / "tmp" / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            try:
                (log_dir / f"daily_{run_date}.log").symlink_to(sentinel)
            except OSError as exc:
                self.skipTest(f"symbolic links are unavailable: {exc}")

        result = self._run_script(
            env_overrides={"TZ": "UTC"},
            fixture_mutator=plant_daily_link,
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual("unchanged\n", sentinel.read_text(encoding="utf-8"))
    def test_daily_log_helper_appends_and_archives_previous_run(self) -> None:
        log_root = self.root / "logs"
        prepare_args = [
            PYTHON_BIN,
            str(RUN_DAILY_HELPER_SOURCE),
            "prepare-daily-log",
            "--log-root",
            str(log_root),
            "--archive-relative",
            "archive",
            "--current-log-relative",
            "current.log",
            "--date",
            "2026-07-13",
        ]
        prepared = subprocess.run(
            prepare_args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(0, prepared.returncode, self._format_process_output(prepared))
        _archive, root_device, root_inode = prepared.stdout.strip().split("|")
        appended = subprocess.run(
            [
                PYTHON_BIN,
                str(RUN_DAILY_HELPER_SOURCE),
                "append-daily-log",
                "--log-root",
                str(log_root),
                "--log-name",
                "daily_2026-07-13.log",
                "--root-device",
                root_device,
                "--root-inode",
                root_inode,
                "--no-stdout",
            ],
            input="first run\n",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(0, appended.returncode, self._format_process_output(appended))

        archived = subprocess.run(
            prepare_args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        self.assertEqual(0, archived.returncode, self._format_process_output(archived))
        archive_relative, _root_device, _root_inode = archived.stdout.strip().split("|")
        self.assertTrue(archive_relative.startswith("archive/daily_2026-07-13_"))
        self.assertEqual("first run\n", (log_root / archive_relative).read_text(encoding="utf-8"))
        self.assertEqual("", (log_root / "daily_2026-07-13.log").read_text(encoding="utf-8"))
        self.assertTrue((log_root / "current.log").is_symlink())

    def test_mirror_data_root_skips_identical_files_and_updates_changed_files(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        source.mkdir()
        target.mkdir()
        (source / "same.jsonl").write_text('{"same": true}\n', encoding="utf-8")
        (target / "same.jsonl").write_text('{"same": true}\n', encoding="utf-8")
        (source / "changed.jsonl").write_text('{"version": 2}\n', encoding="utf-8")
        (target / "changed.jsonl").write_text('{"version": 1}\n', encoding="utf-8")
        (target / "stale.jsonl").write_text('{"stale": true}\n', encoding="utf-8")

        same_before = (target / "same.jsonl").stat().st_mtime_ns

        result = self._run_mirror_data_root(source, target)

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual('{"same": true}\n', (target / "same.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(same_before, (target / "same.jsonl").stat().st_mtime_ns)
        self.assertEqual('{"version": 2}\n', (target / "changed.jsonl").read_text(encoding="utf-8"))
        self.assertFalse((target / "stale.jsonl").exists())
    def test_mirror_data_root_rejects_source_and_destination_link_swaps(self) -> None:
        external = self.root / "external"
        external.mkdir()
        sentinel = external / "sentinel.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        source = self.root / "source"
        source.mkdir()
        (source / "item.jsonl").write_text('{"ok": true}\n', encoding="utf-8")

        source_link = self.root / "source-link"
        try:
            source_link.symlink_to(external, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"symbolic links are unavailable: {exc}")
        result = self._run_mirror_data_root(source_link, self.root / "target")
        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual("unchanged\n", sentinel.read_text(encoding="utf-8"))

        target_link = self.root / "target-link"
        target_link.symlink_to(external, target_is_directory=True)
        result = self._run_mirror_data_root(source, target_link)
        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual("unchanged\n", sentinel.read_text(encoding="utf-8"))

    @unittest.skipUnless(sys.platform == "darwin", "macOS system path aliases are platform-specific")
    def test_runtime_paths_admit_only_exact_macos_system_aliases(self) -> None:
        system_temp = Path(self.tmp.name)
        self.assertEqual("var", system_temp.parts[1])
        normalized = run_daily_helpers._absolute_runtime_path(str(system_temp / "logs"))

        self.assertEqual(
            Path("/private/var").joinpath(*system_temp.parts[2:], "logs"),
            normalized,
        )

        external = self.root / "external-alias-target"
        external.mkdir()
        user_alias = self.root / "user-alias"
        user_alias.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "must not be a symbolic link"):
            run_daily_helpers._open_or_create_runtime_root(
                str(user_alias),
                create=False,
                operator_owned=False,
            )

    @unittest.skipUnless(os.name == "nt", "Windows handle pinning is Windows-specific")
    def test_windows_mirror_blocks_mid_operation_root_and_child_junction_swaps(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        external = self.root / "external"
        (source / "nested").mkdir(parents=True)
        (target / "nested").mkdir(parents=True)
        (external / "nested").mkdir(parents=True)
        (source / "nested" / "item.jsonl").write_text('{"source": true}\n', encoding="utf-8")
        (target / "nested" / "item.jsonl").write_text('{"target": true}\n', encoding="utf-8")
        (external / "item.jsonl").write_text('{"external": "child"}\n', encoding="utf-8")
        (external / "nested" / "item.jsonl").write_text('{"external": "root"}\n', encoding="utf-8")
        sentinels = {
            path: path.read_text(encoding="utf-8")
            for path in (external / "item.jsonl", external / "nested" / "item.jsonl")
        }
        blocked: list[str] = []
        moved: list[tuple[Path, Path]] = []
        attempted = False

        def hook(stage: str, path: Path) -> None:
            nonlocal attempted
            if stage != "before-mutation" or attempted or path.name != "nested":
                return
            attempted = True
            for label, original in (("root", target), ("child", target / "nested")):
                replacement = original.with_name(f"{original.name}-moved")
                try:
                    os.replace(original, replacement)
                except OSError:
                    blocked.append(label)
                    continue
                moved.append((original, replacement))
                subprocess.run(
                    ["cmd.exe", "/d", "/c", f'mklink /J "{original}" "{external}"'],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                )

        try:
            with mock.patch.object(run_daily_helpers, "_WINDOWS_RUNTIME_TEST_HOOK", hook):
                run_daily_helpers.mirror_data_root(str(source), str(target))
        finally:
            for original, replacement in reversed(moved):
                if original.is_symlink():
                    original.unlink()
                elif original.exists():
                    os.rmdir(original)
                if replacement.exists():
                    os.replace(replacement, original)

        self.assertTrue(attempted)
        self.assertEqual(["root", "child"], blocked)
        self.assertEqual('{"source": true}\n', (target / "nested" / "item.jsonl").read_text(encoding="utf-8"))
        for path, contents in sentinels.items():
            self.assertEqual(contents, path.read_text(encoding="utf-8"))

    @unittest.skipUnless(os.name == "nt", "Windows handle pinning is Windows-specific")
    def test_windows_daily_log_blocks_mid_operation_root_and_child_junction_swaps(self) -> None:
        log_root = self.root / "logs"
        external = self.root / "external"
        (external / "archive").mkdir(parents=True)
        (external / "daily_2026-07-13.log").write_text("external root\n", encoding="utf-8")
        (external / "archive" / "daily_2026-07-13.log").write_text("external child\n", encoding="utf-8")
        sentinels = {
            path: path.read_text(encoding="utf-8")
            for path in (
                external / "daily_2026-07-13.log",
                external / "archive" / "daily_2026-07-13.log",
            )
        }
        blocked: list[str] = []
        moved: list[tuple[Path, Path]] = []
        root_attempted = False
        child_attempted = False

        def attempt(label: str, original: Path) -> None:
            replacement = original.with_name(f"{original.name}-moved")
            try:
                os.replace(original, replacement)
            except OSError:
                blocked.append(label)
                return
            moved.append((original, replacement))
            subprocess.run(
                ["cmd.exe", "/d", "/c", f'mklink /J "{original}" "{external}"'],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )

        def hook(stage: str, path: Path) -> None:
            nonlocal root_attempted, child_attempted
            if stage != "before-mutation":
                return
            if path == log_root and not root_attempted:
                root_attempted = True
                attempt("root", log_root)
            elif path.name == "archive" and not child_attempted:
                child_attempted = True
                attempt("child", log_root / "archive")

        try:
            with mock.patch.object(run_daily_helpers, "_WINDOWS_RUNTIME_TEST_HOOK", hook):
                _archive, root_device, root_inode = run_daily_helpers.prepare_daily_log(
                    str(log_root),
                    "archive",
                    "current.log",
                    "2026-07-13",
                )
                with mock.patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(b"entry\n"), encoding="utf-8")):
                    run_daily_helpers.append_daily_log(
                        str(log_root),
                        "daily_2026-07-13.log",
                        root_device,
                        root_inode,
                        False,
                    )
                archive_relative, _root_device, _root_inode = run_daily_helpers.prepare_daily_log(
                    str(log_root),
                    "archive",
                    "current.log",
                    "2026-07-13",
                )
        finally:
            for original, replacement in reversed(moved):
                if original.is_symlink():
                    original.unlink()
                elif original.exists():
                    os.rmdir(original)
                if replacement.exists():
                    os.replace(replacement, original)

        self.assertTrue(root_attempted)
        self.assertTrue(child_attempted)
        self.assertEqual(["root", "child"], blocked)
        self.assertTrue(archive_relative.startswith("archive/daily_2026-07-13_"))
        for path, contents in sentinels.items():
            self.assertEqual(contents, path.read_text(encoding="utf-8"))

    def test_mirror_data_root_returns_non_zero_when_directory_creation_fails(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        (source / "nested").mkdir(parents=True)
        target.mkdir()
        (source / "nested" / "item.jsonl").write_text('{"ok": true}\n', encoding="utf-8")
        (target / "nested").write_text("not a directory\n", encoding="utf-8")

        result = self._run_mirror_data_root(source, target)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 하위 디렉터리 생성 실패", result.stderr)

    def test_mirror_data_root_returns_non_zero_when_target_root_creation_fails(self) -> None:
        source = self.root / "source"
        blocked_parent = self.root / "blocked"
        target = blocked_parent / "target"
        source.mkdir()
        blocked_parent.write_text("not a directory\n", encoding="utf-8")

        result = self._run_mirror_data_root(source, target)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 대상 디렉터리 생성 실패", result.stderr)

    @unittest.skipIf(os.name == "nt", "Windows does not enforce POSIX chmod denial for this shell fixture")
    def test_mirror_data_root_returns_non_zero_when_source_list_fails(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        source.mkdir()
        target.mkdir()
        source.chmod(0)

        result = self._run_mirror_data_root_with_restored_permissions(
            source,
            target,
            restored_paths=[source],
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 소스 목록 생성 실패", result.stderr)

    @unittest.skipIf(os.name == "nt", "Windows does not enforce POSIX chmod denial for this shell fixture")
    def test_mirror_data_root_returns_non_zero_when_target_list_fails(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        blocked_child = target / "blocked"
        source.mkdir()
        blocked_child.mkdir(parents=True)
        blocked_child.chmod(0)

        result = self._run_mirror_data_root_with_restored_permissions(
            source,
            target,
            restored_paths=[blocked_child],
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 대상 목록 생성 실패", result.stderr)

    @unittest.skipIf(os.name == "nt", "Windows does not enforce POSIX chmod denial for this shell fixture")
    def test_mirror_data_root_returns_non_zero_when_copy_fails(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        source.mkdir()
        target.mkdir()
        (source / "item.jsonl").write_text('{"ok": true}\n', encoding="utf-8")
        target.chmod(0o555)

        result = self._run_mirror_data_root_with_restored_permissions(
            source,
            target,
            restored_paths=[target],
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 파일 복사 실패", result.stderr)

    @unittest.skipIf(os.name == "nt", "Windows does not enforce POSIX chmod denial for this shell fixture")
    def test_mirror_data_root_returns_non_zero_when_stale_remove_fails(self) -> None:
        source = self.root / "source"
        target = self.root / "target"
        source.mkdir()
        stale_dir = target / "nested"
        stale_dir.mkdir(parents=True)
        (stale_dir / "stale.jsonl").write_text('{"stale": true}\n', encoding="utf-8")
        stale_dir.chmod(0o555)

        result = self._run_mirror_data_root_with_restored_permissions(
            source,
            target,
            restored_paths=[stale_dir],
        )

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("데이터 미러링 stale 파일 제거 실패", result.stderr)

    def _run_script(
        self,
        *,
        transcript_exit: int = 0,
        supabase_insert_exit: int = 0,
        final_sync_stage_failure: bool = False,
        env_overrides: dict[str, str | None] | None = None,
        force_phase3: bool = False,
        fixture_mutator: Optional[Callable[[Path, Path], None]] = None,
    ) -> subprocess.CompletedProcess[str]:
        project_root = self.root / "project"
        state_dir = self.root / "state"
        self._build_fixture(project_root, state_dir)
        if fixture_mutator is not None:
            fixture_mutator(project_root, state_dir)
        if force_phase3:
            (project_root / "backend" / "restaurant-crawling" / "data" / "tzuyang" / "transcript" / "pending.jsonl").write_text(
                '{"stub": true}\n', encoding="utf-8"
            )

        git_log_path = state_dir / "git_commands.log"
        git_log_path.unlink(missing_ok=True)

        env = os.environ.copy()
        env.update(
            {
                "HOME": str(self.root / "home"),
                "PATH": f"{project_root / 'bin'}:{env.get('PATH', '')}",
                "PIPELINE_STDOUT_MODE": "on",
                "YOUTUBE_API_KEY_BYEON": "stub-youtube-key",
                "GEMINI_API_KEY_BYEON": "stub-gemini-key",
                "SUPABASE_URL": "https://stub.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "stub-service-role",
                "RUN_DAILY_LOG_DIR": str(project_root / "tmp" / "logs"),
                "RUN_DAILY_ARCHIVE_DIR": str(project_root / "tmp" / "logs" / "archive"),
                "RUN_DAILY_CURRENT_LOG_LINK": str(project_root / "tmp" / "logs" / "current.log"),
                "RUN_DAILY_SUMMARY_PATH": str(project_root / "tmp" / "summary.md"),
                "RUN_DAILY_MANIFEST_PATH": str(project_root / "tmp" / "current-summary.json"),
                "RUN_DAILY_TEST_STATE_DIR": str(state_dir),
                "RUN_DAILY_TEST_CURRENT_BRANCH": "data",
                "RUN_DAILY_TEST_GIT_LOG_PATH": str(git_log_path),
                "RUN_DAILY_TEST_PENDING_DATA_CHANGES": "0",
                "RUN_DAILY_TEST_TRANSCRIPT_EXIT": str(transcript_exit),
                "RUN_DAILY_TEST_SUPABASE_INSERT_EXIT": str(supabase_insert_exit),
                "RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE": "1" if final_sync_stage_failure else "0",
                "PYTHON_CMD": "python3",
            }
        )
        if env_overrides:
            for key, value in env_overrides.items():
                if value is None:
                    env.pop(key, None)
                else:
                    env[key] = value
        if os.name == "nt":
            env["PATH"] = ":".join([_to_bash_path(project_root / "bin"), env.get("PATH", "")])
            for key in (
                "HOME",
                "RUN_DAILY_LOG_DIR",
                "RUN_DAILY_ARCHIVE_DIR",
                "RUN_DAILY_CURRENT_LOG_LINK",
                "RUN_DAILY_SUMMARY_PATH",
                "RUN_DAILY_MANIFEST_PATH",
                "RUN_DAILY_TEST_STATE_DIR",
                "RUN_DAILY_TEST_GIT_LOG_PATH",
            ):
                if env.get(key):
                    env[key] = _to_bash_path(env[key])
        Path(self.root / "home").mkdir(parents=True, exist_ok=True)

        if not BASH_BIN:
            self.skipTest("bash is not available in PATH")
        script_path = shlex.quote(_to_bash_path(project_root / "backend" / "run_daily.sh"))
        fixture_bin = shlex.quote(_to_bash_path(project_root / "bin"))
        return subprocess.run(
            [BASH_BIN, "-lc", f"export PATH={fixture_bin}:$PATH; exec bash {script_path}"],
            cwd=project_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
        )

    def _read_manifest(self) -> dict:
        manifest_path = self.root / "project" / "tmp" / "current-summary.json"
        self.assertTrue(manifest_path.exists(), f"manifest missing: {manifest_path}")
        import json

        return json.loads(manifest_path.read_text(encoding="utf-8"))

    def _run_mirror_data_root_with_restored_permissions(
        self,
        source: Path,
        target: Path,
        *,
        restored_paths: list[Path],
    ) -> subprocess.CompletedProcess[str]:
        try:
            return self._run_mirror_data_root(source, target)
        finally:
            for path in restored_paths:
                path.chmod(0o755)

    def _run_mirror_data_root(self, source: Path, target: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                PYTHON_BIN,
                str(RUN_DAILY_HELPER_SOURCE),
                "mirror-data-root",
                "--source-root",
                str(source),
                "--target-root",
                str(target),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def _build_fixture(self, project_root: Path, state_dir: Path) -> None:
        (project_root / "backend" / "config").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "utils").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "restaurant-crawling" / "scripts").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "restaurant-evaluation" / "scripts").mkdir(parents=True, exist_ok=True)
        crawling_data_root = project_root / "backend" / "restaurant-crawling" / "data"
        (crawling_data_root / "tzuyang" / "transcript").mkdir(parents=True, exist_ok=True)
        (crawling_data_root / "tzuyang" / "crawling").mkdir(parents=True, exist_ok=True)
        (crawling_data_root / "credentials.json").write_text('{"type":"service_account"}\n', encoding="utf-8")
        (crawling_data_root / "cookies.txt").write_text('SID=stub\n', encoding="utf-8")
        (
            project_root
            / "backend"
            / "restaurant-evaluation"
            / "data"
            / "tzuyang"
            / "evaluation"
            / "rule_results"
        ).mkdir(parents=True, exist_ok=True)
        (
            project_root
            / "backend"
            / "restaurant-evaluation"
            / "data"
            / "tzuyang"
            / "evaluation"
            / "laaj_results"
        ).mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "node_modules" / "dotenv").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "node_modules" / "ffmpeg-static").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "node_modules" / "ffprobe-static").mkdir(parents=True, exist_ok=True)
        (project_root / "backend" / "node_modules" / "@google" / "genai").mkdir(parents=True, exist_ok=True)
        (project_root / "bin").mkdir(parents=True, exist_ok=True)
        state_dir.mkdir(parents=True, exist_ok=True)

        shutil.copy2(RUN_DAILY_SOURCE, project_root / "backend" / "run_daily.sh")
        shutil.copy2(RUN_DAILY_HELPER_SOURCE, project_root / "backend" / "utils" / "run_daily_helpers.py")

        self._write_executable(
            project_root / "backend" / "config" / "runtime_paths.sh",
            """
            #!/usr/bin/env bash

            tzudong_runtime_paths_init() {
              local project_root="${1:-$(pwd)}"
              export TZUDONG_PROJECT_ROOT="${TZUDONG_PROJECT_ROOT:-$project_root}"
              export TZUDONG_BACKEND_ROOT="${TZUDONG_BACKEND_ROOT:-$project_root/backend}"
              export RUN_DAILY_LOG_DIR="${RUN_DAILY_LOG_DIR:-$TZUDONG_BACKEND_ROOT/log/cron}"
              export RUN_DAILY_ARCHIVE_DIR="${RUN_DAILY_ARCHIVE_DIR:-$RUN_DAILY_LOG_DIR/archive}"
              export RUN_DAILY_CURRENT_LOG_LINK="${RUN_DAILY_CURRENT_LOG_LINK:-$RUN_DAILY_LOG_DIR/current.log}"
              export RUN_DAILY_SUMMARY_PATH="${RUN_DAILY_SUMMARY_PATH:-$TZUDONG_PROJECT_ROOT/summary.md}"
            }

            tzudong_runtime_paths_ensure() {
              mkdir -p "$RUN_DAILY_LOG_DIR" "$RUN_DAILY_ARCHIVE_DIR"
              mkdir -p "$(dirname "$RUN_DAILY_SUMMARY_PATH")"
            }
            """,
        )
        self._write_executable(
            project_root / "backend" / "restaurant-crawling" / "scripts" / "08-chunk-multimodal-crawling.sh",
            """
            #!/usr/bin/env bash
            echo "청크 멀티모달 크롤링 완료"
            exit "${RUN_DAILY_TEST_CHUNK_EXIT:-0}"
            """,
        )
        self._write_executable(
            project_root / "backend" / "restaurant-evaluation" / "scripts" / "11-laaj-evaluation.sh",
            """
            #!/usr/bin/env bash
            echo "LAAJ 평가 완료"
            echo "성공: 0"
            exit 0
            """,
        )

        self._write_executable(project_root / "bin" / "python", self._python_stub())
        self._write_executable(project_root / "bin" / "python3", self._python_stub())
        self._write_executable(project_root / "bin" / "node", self._node_stub())
        self._write_executable(project_root / "bin" / "timeout", self._timeout_stub())
        self._write_executable(project_root / "bin" / "git", self._git_stub())

    def _write_executable(self, path: Path, content: str) -> None:
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)

    def _python_stub(self) -> str:
        real_python = shlex.quote(_to_bash_path(PYTHON_BIN))
        return """
        #!/usr/bin/env bash
        if [ "${1:-}" = "-V" ] || [ "${1:-}" = "--version" ]; then
          echo "Python 3.11.9"
          exit 0
        fi

        script_name="$(basename "${1:-}")"
        if [ "$script_name" = "run_daily_helpers.py" ]; then
          converted_args=()
          for arg in "$@"; do
            case "$arg" in
              /[a-zA-Z]/*)
                drive="${arg:1:1}"
                rest="${arg:2}"
                converted_args+=("${drive^^}:$rest")
                ;;
              *)
                converted_args+=("$arg")
                ;;
            esac
          done
          exec __REAL_PYTHON__ "${converted_args[@]}"
        fi

        case "$script_name" in
          01-collect-urls.py)
            echo "URL 수집 중..."
            ;;
          02-collect-meta.py)
            echo "메타데이터 수집 완료: 0개"
            ;;
          02-1-migrate-meta-to-supabase.py)
            echo "meta migration ok"
            ;;
          02-5-cleanup-orphans.py)
            echo "orphan cleanup ok"
            ;;
          03-1-generate-transcript-context.py)
            echo "Context generation for stub-video completed"
            ;;
          09-target-selection.py)
            echo "대상 비디오: 0개"
            ;;
          10-rule-evaluation.py)
            echo "Rule 평가 완료!"
            echo "성공: 0"
            ;;
          12-transform.py)
            echo "변환 완료: 0개"
            ;;
          13-supabase-insert.py)
            if [ "${RUN_DAILY_TEST_SUPABASE_INSERT_EXIT:-0}" != "0" ]; then
              echo "simulated supabase insert failure" >&2
              exit "${RUN_DAILY_TEST_SUPABASE_INSERT_EXIT}"
            fi
            echo "성공 (Insert): 0"
            echo "건너뜀 (중복): 0"
            ;;
        esac
        exit 0
        """.replace("__REAL_PYTHON__", real_python)

    def _node_stub(self) -> str:
        return """
        #!/usr/bin/env bash
        if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--version" ]; then
          echo "v20.11.1"
          exit 0
        fi

        script_name="$(basename "${1:-}")"
        case "$script_name" in
          03-collect-transcript.js)
            if [ "${RUN_DAILY_TEST_TRANSCRIPT_EXIT:-0}" != "0" ]; then
              echo "simulated transcript failure" >&2
              exit "${RUN_DAILY_TEST_TRANSCRIPT_EXIT}"
            fi
            echo "자막 수집 완료"
            echo "성공 1개"
            ;;
          04-extract-frames-with-heatmap.js)
            mkdir -p backend/restaurant-crawling/data/frames/stub-video
            printf 'stub-frame\n' > backend/restaurant-crawling/data/frames/stub-video/frame-001.jpg
            echo "Heatmap saved"
            echo "Frames extracted"
            ;;
        esac
        exit 0
        """

    def _timeout_stub(self) -> str:
        return """
        #!/usr/bin/env bash
        if [ "${1:-}" = "--foreground" ]; then
          shift
        fi
        if printf '%s' "${1:-}" | grep -Eq '^[0-9]+s$'; then
          shift
        fi
        exec "$@"
        """

    def _git_stub(self) -> str:
        return """
        #!/usr/bin/env bash
        set -eu

        state_dir="${RUN_DAILY_TEST_STATE_DIR:?missing RUN_DAILY_TEST_STATE_DIR}"
        sync_index_file="$state_dir/sync_index"
        current_branch_file="$state_dir/current_branch"
        git_log_file="${RUN_DAILY_TEST_GIT_LOG_PATH:-}"

        current_sync_index() {
          if [ -f "$sync_index_file" ]; then
            cat "$sync_index_file"
          else
            echo 0
          fi
        }

        set_sync_index() {
          printf '%s' "$1" > "$sync_index_file"
        }

        current_branch() {
          if [ -f "$current_branch_file" ]; then
            cat "$current_branch_file"
          else
            printf '%s' "${RUN_DAILY_TEST_CURRENT_BRANCH:-data}"
          fi
        }

        set_current_branch() {
          printf '%s' "$1" > "$current_branch_file"
        }

        has_pending_data_changes() {
          [ "${RUN_DAILY_TEST_PENDING_DATA_CHANGES:-0}" = "1" ]
        }

        is_missing_remote_branch() {
          [ -n "${RUN_DAILY_TEST_REMOTE_BRANCH_MISSING:-}" ] && [ "${RUN_DAILY_TEST_REMOTE_BRANCH_MISSING}" = "$1" ]
        }

        cmd="${1:-}"
        shift || true
        if [ -n "$git_log_file" ]; then
          printf '%s %s\n' "$cmd" "$*" >> "$git_log_file"
        fi

        case "$cmd" in
          config)
            if [ "${1:-}" = "user.name" ]; then
              echo "Test Runner"
              exit 0
            fi
            if [ "${1:-}" = "user.email" ]; then
              echo "test@example.com"
              exit 0
            fi
            ;;
          rev-parse)
            if [ "${1:-}" = "--abbrev-ref" ] && [ "${2:-}" = "HEAD" ]; then
              current_branch
              exit 0
            fi
            if [ "${1:-}" = "--short" ]; then
              echo "stub123"
              exit 0
            fi
            ;;
          diff)
            if [ "${1:-}" = "--quiet" ] && [ "${2:-}" = "--" ]; then
              next_index=$(( $(current_sync_index) + 1 ))
              set_sync_index "$next_index"
              if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$next_index" -eq 3 ]; then
                exit 1
              fi
              if has_pending_data_changes; then
                exit 1
              fi
              exit 0
            fi
            if [ "${1:-}" = "--staged" ] && [ "${2:-}" = "--quiet" ]; then
              if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$(current_sync_index)" -eq 3 ]; then
                exit 1
              fi
              if has_pending_data_changes; then
                exit 1
              fi
              exit 0
            fi
            ;;
          ls-files)
            if printf '%s' "$*" | grep -q -- '--others --modified'; then
              if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$(current_sync_index)" -eq 3 ]; then
                echo "backend/restaurant-crawling/data/stub.json"
              elif has_pending_data_changes; then
                echo "backend/restaurant-crawling/data/stub.json"
              fi
              exit 0
            fi
            if printf '%s' "$*" | grep -q -- '--others --exclude-standard'; then
              if has_pending_data_changes; then
                echo "backend/restaurant-crawling/data/stub.json"
              fi
              exit 0
            fi
            exit 0
            ;;
          add)
            if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$(current_sync_index)" -eq 3 ]; then
              echo "simulated git add failure" >&2
              exit 1
            fi
            exit 0
            ;;
          checkout)
            if [ "${1:-}" = "-b" ]; then
              set_current_branch "${2:-}"
            elif [ -n "${1:-}" ]; then
              set_current_branch "$1"
            fi
            exit 0
            ;;
          worktree)
            subcmd="${1:-}"
            shift || true
            case "$subcmd" in
              add)
                target_path=""
                while [ "$#" -gt 0 ]; do
                  case "$1" in
                    --force)
                      shift
                      ;;
                    -b)
                      shift 2
                      ;;
                    *)
                      if [ -z "$target_path" ]; then
                        target_path="$1"
                      fi
                      shift
                      ;;
                  esac
                done
                if [ "${RUN_DAILY_TEST_WORKTREE_ADD_FAILURE:-0}" = "1" ]; then
                  echo "simulated worktree add failure" >&2
                  exit 1
                fi
                mkdir -p "$target_path"
                exit 0
                ;;
              remove)
                target_path=""
                while [ "$#" -gt 0 ]; do
                  case "$1" in
                    --force)
                      shift
                      ;;
                    *)
                      target_path="$1"
                      shift
                      ;;
                  esac
                done
                rm -rf "$target_path"
                exit 0
                ;;
            esac
            ;;
          ls-remote)
            branch="${4:-}"
            if is_missing_remote_branch "$branch"; then
              exit 2
            fi
            exit 0
            ;;
          rm|commit|pull|push|fetch|show-ref)
            exit 0
            ;;
          merge-base)
            exit 0
            ;;
        esac

        exit 0
        """

    def _format_process_output(self, result: subprocess.CompletedProcess[str]) -> str:
        return f"exit={result.returncode}\\nSTDOUT:\\n{result.stdout}\\nSTDERR:\\n{result.stderr}"


if __name__ == "__main__":
    unittest.main()
