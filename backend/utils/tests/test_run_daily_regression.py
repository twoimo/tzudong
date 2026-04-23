from __future__ import annotations

import os
import shutil
import stat
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


BACKEND_ROOT = Path(__file__).resolve().parents[2]
RUN_DAILY_SOURCE = BACKEND_ROOT / "run_daily.sh"


class RunDailyRegressionTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_happy_path_exits_zero(self) -> None:
        result = self._run_script()

        self.assertEqual(0, result.returncode, self._format_process_output(result))

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

    def test_supabase_key_only_skips_insert_stage_in_local_mode(self) -> None:
        result = self._run_script(
            env_overrides={
                "SUPABASE_SERVICE_ROLE_KEY": None,
                "VITE_SUPABASE_PUBLISHABLE_KEY": None,
                "SUPABASE_KEY": "stub-legacy-key",
            },
            force_phase3=True,
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Step 13 (Supabase) 선택 건너뜀", result.stdout)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY 또는 VITE_SUPABASE_PUBLISHABLE_KEY", result.stdout)

    def test_supabase_insert_failure_returns_non_zero_exit(self) -> None:
        result = self._run_script(supabase_insert_exit=23, force_phase3=True)

        self.assertNotEqual(0, result.returncode, self._format_process_output(result))
        self.assertIn("Step 13 (Supabase) 실패", result.stdout)
        self.assertIn("필수 단계 실패가 감지되었습니다", result.stdout)
        self.assertNotIn("모든 필수 단계가 완료되었습니다!", result.stdout)

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

        project_data_dir = self.root / "project" / "backend" / "restaurant-crawling" / "data"
        self.assertTrue((project_data_dir / "credentials.json").exists())
        self.assertTrue((project_data_dir / "cookies.txt").exists())

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

        mirror_script = textwrap.dedent(
            f"""
            set -euo pipefail
            source <(sed -n '/^mirror_data_root()/,/^mirror_data_files_to_sync_worktree()/p' {RUN_DAILY_SOURCE} | sed '$d')
            mirror_data_root {source} {target}
            """
        )

        result = subprocess.run(
            ["/bin/bash", "-lc", mirror_script],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(0, result.returncode, self._format_process_output(result))
        self.assertEqual('{"same": true}\n', (target / "same.jsonl").read_text(encoding="utf-8"))
        self.assertEqual(same_before, (target / "same.jsonl").stat().st_mtime_ns)
        self.assertEqual('{"version": 2}\n', (target / "changed.jsonl").read_text(encoding="utf-8"))
        self.assertFalse((target / "stale.jsonl").exists())

    def _run_script(
        self,
        *,
        transcript_exit: int = 0,
        supabase_insert_exit: int = 0,
        final_sync_stage_failure: bool = False,
        env_overrides: dict[str, str | None] | None = None,
        force_phase3: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        project_root = self.root / "project"
        state_dir = self.root / "state"
        self._build_fixture(project_root, state_dir)
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
        Path(env["HOME"]).mkdir(parents=True, exist_ok=True)

        return subprocess.run(
            ["/bin/bash", str(project_root / "backend" / "run_daily.sh")],
            cwd=project_root,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

    def _build_fixture(self, project_root: Path, state_dir: Path) -> None:
        (project_root / "backend" / "config").mkdir(parents=True, exist_ok=True)
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
        return """
        #!/usr/bin/env bash
        if [ "${1:-}" = "-V" ] || [ "${1:-}" = "--version" ]; then
          echo "Python 3.11.9"
          exit 0
        fi

        script_name="$(basename "${1:-}")"
        case "$script_name" in
          01-collect-urls.py)
            echo "URL 수집 중..."
            ;;
          02-collect-meta.py)
            echo "메타데이터 수집 완료: 0개"
            ;;
          02.1-migrate-meta-to-supabase.py)
            echo "meta migration ok"
            ;;
          02.5-cleanup-orphans.py)
            echo "orphan cleanup ok"
            ;;
          03.1-generate-transcript-context.py)
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
        """

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
