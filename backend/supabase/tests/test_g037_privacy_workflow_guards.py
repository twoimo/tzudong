"""Parsed workflow contracts for G037 privacy producer admission guards."""
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
FREEZE_GUARD = "vars.G037_WRITE_FREEZE != 'active'"


def load_workflow(name: str) -> tuple[str, dict]:
    source = (WORKFLOWS / name).read_text(encoding="utf8")
    return source, yaml.safe_load(source)


def step_named(steps: list[dict], name: str) -> dict:
    return next(step for step in steps if step["name"] == name)


class G037PrivacyWorkflowGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.account_source, cls.account = load_workflow("account-deletion-worker.yml")
        cls.retention_source, cls.retention = load_workflow("privacy-retention.yml")

    def assert_job_admission_guard(self, job: dict) -> None:
        self.assertEqual(next(iter(job)), "if")
        self.assertIn(FREEZE_GUARD, job["if"])
        self.assertLess(list(job).index("if"), list(job).index("runs-on"))
        self.assertNotIn("environment", job)

    def test_account_deletion_writer_job_is_guarded_before_environment_or_secrets(self):
        self.assertEqual(set(self.account["jobs"]), {"dispatch"})
        dispatch = self.account["jobs"]["dispatch"]
        self.assert_job_admission_guard(dispatch)

        writer = step_named(dispatch["steps"], "Dispatch bounded account deletion work")
        self.assertEqual(
            writer["env"],
            {
                "ACCOUNT_DELETION_WORKER_URL": "${{ secrets.ACCOUNT_DELETION_WORKER_URL }}",
                "ACCOUNT_DELETION_WORKER_CAPABILITY": "${{ secrets.ACCOUNT_DELETION_WORKER_CAPABILITY }}",
            },
        )
        self.assertEqual(writer["run"], "node scripts/run-account-deletion-worker.mjs --limit 10 --deadline-ms 10000")

    def test_retention_writer_job_is_guarded_before_environment_or_secrets(self):
        self.assertEqual(set(self.retention["jobs"]), {"retain"})
        retain = self.retention["jobs"]["retain"]
        self.assert_job_admission_guard(retain)

        scheduled_writer = step_named(retain["steps"], "Run scheduled privacy retention")
        self.assertEqual(scheduled_writer["if"], "github.event_name == 'schedule'")
        self.assertEqual(
            scheduled_writer["env"],
            {"PRIVACY_RETENTION_INTERNAL_CAPABILITY": "${{ secrets.PRIVACY_RETENTION_INTERNAL_CAPABILITY }}"},
        )
        self.assertEqual(scheduled_writer["run"], "node scripts/run-privacy-retention-schedule.mjs")
        self.assertEqual(retain["env"]["PRIVACY_RETENTION_ENDPOINT"], "https://internal.tzudong.app/api/internal/privacy-retention")

    def test_freeze_is_not_a_step_environment_sentinel(self):
        self.assertNotIn("G037_WRITE_FREEZE:", self.account_source)
        self.assertNotIn("G037_WRITE_FREEZE:", self.retention_source)


if __name__ == "__main__":
    unittest.main()
