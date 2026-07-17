"""Source-contract tests for G037 batch writer admission guards."""
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
FREEZE_GUARD = "vars.G037_WRITE_FREEZE != 'active'"


class G037BatchWorkflowGuardTests(unittest.TestCase):
    def _workflow(self, name):
        with (WORKFLOWS / name).open(encoding="utf8") as source:
            return yaml.safe_load(source)

    def _service_role_writers(self, workflow):
        writers = {}
        for job_name, job in workflow["jobs"].items():
            for step in job.get("steps", []):
                if "SUPABASE_SERVICE_ROLE_KEY" in step.get("env", {}):
                    writers[(job_name, step["name"])] = step["run"].strip()
        return writers

    def test_restaurant_refresh_writer_is_exactly_freeze_guarded(self):
        workflow = self._workflow("restaurant-refresh-cron.yml")
        self.assertEqual(
            self._service_role_writers(workflow),
            {
                ("refresh", "Run approved restaurant freshness scan"): (
                    "set -euo pipefail\n"
                    "args=(--mode \"$RESTAURANT_REFRESH_MODE\" --limit \"$RESTAURANT_REFRESH_LIMIT\" --json)\n"
                    "if [ \"$RESTAURANT_REFRESH_DRY_RUN\" = \"true\" ]; then\n"
                    "  args+=(--dry-run)\n"
                    "else\n"
                    "  args+=(--allow-db-write)\n"
                    "fi\n"
                    "node scripts/restaurant-refresh-cron.mjs \"${args[@]}\""
                )
            },
        )
        self.assertEqual(
            workflow["jobs"]["refresh"]["if"],
            "github.ref_name == github.event.repository.default_branch && " + FREEZE_GUARD,
        )

    def test_youtube_kpi_writer_is_exactly_freeze_guarded(self):
        workflow = self._workflow("youtube-kpi-snapshot.yml")
        self.assertEqual(
            self._service_role_writers(workflow),
            {
                ("capture", "Capture YouTube KPI snapshot"): "node scripts/capture-youtube-kpi-snapshot.mjs"
            },
        )
        self.assertEqual(
            workflow["jobs"]["capture"]["if"],
            "github.ref_name == github.event.repository.default_branch && " + FREEZE_GUARD,
        )


if __name__ == "__main__":
    unittest.main()
