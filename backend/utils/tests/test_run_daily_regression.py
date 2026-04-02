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

    def _run_script(
        self,
        *,
        transcript_exit: int = 0,
        final_sync_stage_failure: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        project_root = self.root / "project"
        state_dir = self.root / "state"
        self._build_fixture(project_root, state_dir)

        env = os.environ.copy()
        env.update(
            {
                "HOME": str(self.root / "home"),
                "PATH": f"{project_root / 'bin'}:{env.get('PATH', '')}",
                "PIPELINE_STDOUT_MODE": "on",
                "RUN_DAILY_LOG_DIR": str(project_root / "tmp" / "logs"),
                "RUN_DAILY_ARCHIVE_DIR": str(project_root / "tmp" / "logs" / "archive"),
                "RUN_DAILY_CURRENT_LOG_LINK": str(project_root / "tmp" / "logs" / "current.log"),
                "RUN_DAILY_SUMMARY_PATH": str(project_root / "tmp" / "summary.md"),
                "RUN_DAILY_TEST_STATE_DIR": str(state_dir),
                "RUN_DAILY_TEST_TRANSCRIPT_EXIT": str(transcript_exit),
                "RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE": "1" if final_sync_stage_failure else "0",
                "PYTHON_CMD": "python3",
            }
        )
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
        (project_root / "backend" / "restaurant-crawling" / "data" / "tzuyang" / "transcript").mkdir(
            parents=True, exist_ok=True
        )
        (project_root / "backend" / "restaurant-crawling" / "data" / "tzuyang" / "crawling").mkdir(
            parents=True, exist_ok=True
        )
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

        cmd="${1:-}"
        shift || true

        case "$cmd" in
          rev-parse)
            if [ "${1:-}" = "--abbrev-ref" ] && [ "${2:-}" = "HEAD" ]; then
              echo "data"
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
              exit 0
            fi
            if [ "${1:-}" = "--staged" ] && [ "${2:-}" = "--quiet" ]; then
              if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$(current_sync_index)" -eq 3 ]; then
                exit 1
              fi
              exit 0
            fi
            ;;
          ls-files)
            if printf '%s' "$*" | grep -q -- '--others --modified'; then
              if [ "${RUN_DAILY_TEST_FINAL_SYNC_STAGE_FAILURE:-0}" = "1" ] && [ "$(current_sync_index)" -eq 3 ]; then
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
          rm|commit|pull|push|fetch|show-ref|checkout)
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
