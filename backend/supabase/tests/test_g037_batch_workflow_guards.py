"""Source-contract tests for G037 batch writer admission guards."""
from pathlib import Path
import json
import os
import subprocess
import unittest

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
FREEZE_GUARD = "vars.G037_WRITE_FREEZE == 'cleared'"


class G037BatchWorkflowGuardTests(unittest.TestCase):
    def test_all_scheduled_mutation_guards_deny_missing_or_invalid_clearance(self):
        cases = {
            "daily-crawler.yml": ["daily-compute", "daily-publish", "hosted-pending-apply"],
            "gdrive-frame-backfill.yml": ["backfill"],
            "youtube-kpi-snapshot.yml": ["capture"],
            "restaurant-refresh-cron.yml": ["refresh"],
            "account-deletion-worker.yml": ["dispatch"],
            "privacy-retention.yml": ["retain"],
        }
        expressions = []
        for name, jobs in cases.items():
            workflow = self._workflow(name)
            for job in jobs:
                condition = workflow["jobs"][job]["if"].strip().removeprefix("${{").removesuffix("}}").strip()
                expressions.append(condition.replace("needs.daily-compute", 'needs["daily-compute"]'))
        # Evaluate the actual Boolean expressions with every independent gate
        # satisfied. Only the real freeze value varies; no provider is invoked.
        script = r'''
        const expressions = JSON.parse(require('fs').readFileSync(0,'utf8'));
        const github = {repository:'twoimo/tzudong', ref:'refs/heads/main', ref_name:'main', ref_protected:true,
          event_name:'workflow_dispatch', event:{repository:{full_name:'twoimo/tzudong',default_branch:'main'}}};
        const needs = {'daily-compute':{outputs:{publication_ready:'true',publication_manifest_sha256:'fixture'}}};
        const values = [undefined,'','active','clear','invalid','cleared'];
        const results = expressions.map(expression => values.map(value => {
          const vars = {G037_WRITE_FREEZE:value,TZUDONG_DATA_BRANCH_PUBLISH:'1',TZUDONG_HOSTED_DATA_PLANE_APPROVED:'1'};
          return Boolean(Function('github','vars','needs','always','inputs','return ('+expression+')')(github,vars,needs,()=>true,{dry_run:true}));
        }));
        process.stdout.write(JSON.stringify(results));
        '''
        result = subprocess.run(["node", "-e", script], input=json.dumps(expressions),
            capture_output=True, text=True, check=True, env={"PATH": os.environ["PATH"]}, timeout=10)
        self.assertEqual(json.loads(result.stdout), [[False, False, False, False, False, True]] * 8)

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
