"""Regression guards for the repository-wide G037 write freeze admission."""

from pathlib import Path
import unittest

import yaml


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FREEZE_GUARD = "vars.G037_WRITE_FREEZE != 'active'"
BACKFILL_ADMISSION = (
    "(github.event_name != 'workflow_dispatch' || "
    "github.ref_name == github.event.repository.default_branch) && "
    "(github.event_name != 'workflow_run' || "
    "(github.event.workflow_run.conclusion == 'success' && "
    "github.event.workflow_run.head_branch == github.event.repository.default_branch && "
    "github.event.workflow_run.event == 'schedule')) && "
    "vars.G037_WRITE_FREEZE != 'active'"
)



class G037CoreWorkflowGuardTests(unittest.TestCase):
    def load_workflow(self, relative_path: str) -> dict:
        with (REPOSITORY_ROOT / relative_path).open(encoding="utf-8") as workflow_file:
            return yaml.safe_load(workflow_file)

    def assert_writer_job_is_frozen_before_secrets(
        self, workflow: dict, job_name: str
    ) -> dict:
        job = workflow["jobs"][job_name]
        self.assertIn(FREEZE_GUARD, job["if"])

        secret_steps = [
            step["name"]
            for step in job["steps"]
            if "secrets." in yaml.safe_dump(step, sort_keys=False)
        ]
        self.assertTrue(secret_steps, f"{job_name} must have protected secret access")
        return job

    def test_daily_crawl_writer_inventory_is_job_admission_guarded(self) -> None:
        workflow = self.load_workflow(".github/workflows/daily-crawler.yml")
        job = self.assert_writer_job_is_frozen_before_secrets(workflow, "daily-crawl")

        # The existing default-branch admission remains in effect when unfrozen.
        self.assertIn("github.event.repository.default_branch", job["if"])

        run_daily_step = next(
            step for step in job["steps"] if step["name"] == "Run Daily Pipeline"
        )
        self.assertEqual(
            run_daily_step["run"].strip(),
            "chmod +x backend/run_daily.sh\nbash backend/run_daily.sh",
        )

        run_daily_source = (REPOSITORY_ROOT / "backend/run_daily.sh").read_text(
            encoding="utf-8"
        )
        for writer_command in (
            "$PYTHON_CMD backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py --channel tzuyang",
            "$PYTHON_CMD backend/restaurant-evaluation/scripts/13-supabase-insert.py --channel tzuyang",
            'run_git_with_timeout "$network_timeout" git push origin "$SYNC_BRANCH"',
        ):
            self.assertIn(writer_command, run_daily_source)

        gdrive_upload_step = next(
            step for step in job["steps"] if step["name"] == "Upload Results to GDrive"
        )
        for writer_command in (
            'rclone copy . "$GDRIVE_FRAMES_PATH"',
            'rclone copy "$STAGING_DIR" "$GDRIVE_STAGING_SCOPE_PATH"',
        ):
            self.assertIn(writer_command, gdrive_upload_step["run"])

    def test_backfill_writer_inventory_is_job_admission_guarded(self) -> None:
        workflow = self.load_workflow(".github/workflows/gdrive-frame-backfill.yml")
        job = self.assert_writer_job_is_frozen_before_secrets(workflow, "backfill")
        self.assertEqual(job["if"], BACKFILL_ADMISSION)

        # The existing trusted-event/default-branch admission remains in effect when unfrozen.
        self.assertIn("github.event.workflow_run.conclusion == 'success'", job["if"])
        self.assertIn("github.event.repository.default_branch", job["if"])

        backfill_step = next(
            step for step in job["steps"] if step["name"] == "Backfill staged frame shards"
        )
        for writer_command in (
            'rclone copyto "$WORK_DIR/backfill.lock.json" "$LOCK_REMOTE"',
            'rclone copy . "$GDRIVE_FRAMES_PATH"',
            'rclone deletefile "$LOCK_REMOTE"',
        ):
            self.assertIn(writer_command, backfill_step["run"])


if __name__ == "__main__":
    unittest.main()
