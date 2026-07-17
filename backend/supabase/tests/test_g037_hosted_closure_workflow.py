"""Parsed job-graph contracts for the G037 hosted closure workflow."""
import importlib.util
import inspect
import re
import sys
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).parents[3]
SCRIPTS = ROOT / "backend" / "supabase" / "scripts"
WORKFLOWS = ROOT / ".github" / "workflows"
CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
PYTHON = "actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065"
MUTATION_WORDS = re.compile(r"\b(?:apply|execute|rehearse|prepare)\b", re.IGNORECASE)
PRIVATE_KEY = re.compile(r"(?:BEGIN [A-Z ]*PRIVATE KEY|PRIVATE_KEY)", re.IGNORECASE)


def load_workflow(name: str) -> dict:
    with (WORKFLOWS / name).open(encoding="utf8") as source:
        return yaml.safe_load(source)


def values(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from values(item)
    elif isinstance(value, list):
        for item in value:
            yield from values(item)
    elif isinstance(value, str):
        yield value


def checkout_steps(job: dict) -> list[dict]:
    return [step for step in job["steps"] if step.get("uses") == CHECKOUT]


class G037HostedClosureWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = load_workflow("g037-hosted-closure.yml")
        cls.requirements = (SCRIPTS / "g037-hosted-closure-requirements.txt").read_text(encoding="utf8")
        cls.runbook = (ROOT / "backend/supabase/docs/g037-hosted-closure-runbook.md").read_text(encoding="utf8")

    def assert_exact_detached_checkout(self, job: dict) -> None:
        checkouts = checkout_steps(job)
        self.assertEqual(1, len(checkouts))
        self.assertEqual(
            {
                "ref": "${{ inputs.commit_sha }}",
                "fetch-depth": 1,
                "persist-credentials": False,
            },
            checkouts[0]["with"],
        )
        verification = next(step for step in job["steps"] if step.get("name") == "Verify detached SHA binding")
        self.assertEqual({"EXPECTED_SHA": "${{ inputs.commit_sha }}"}, verification["env"])
        self.assertIn('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"', verification["run"])
        self.assertIn('test "$(git branch --show-current)" = ""', verification["run"])

    def test_dispatch_graph_is_exact_and_serialized(self):
        dispatch = self.workflow[True]["workflow_dispatch"]
        self.assertEqual(
            {
                "commit_sha": {
                    "description": "Exact protected main commit SHA",
                    "required": True,
                    "type": "string",
                },
                "mode": {
                    "description": "Controller mode; validate is source-only and default.",
                    "required": True,
                    "default": "validate",
                    "type": "choice",
                    "options": ["validate", "preflight", "readback", "runtime-probe", "reconciliation-readback"],
                },
            },
            dispatch["inputs"],
        )
        self.assertEqual({"contents": "read"}, self.workflow["permissions"])
        self.assertEqual(
            {"group": "g037-hosted-closure", "cancel-in-progress": False},
            self.workflow["concurrency"],
        )
        self.assertEqual({"source-validation", "remote-readonly"}, set(self.workflow["jobs"]))

    def test_job_graph_binds_exact_sha_and_places_production_credentials_remotely(self):
        source = self.workflow["jobs"]["source-validation"]
        remote = self.workflow["jobs"]["remote-readonly"]
        admission = "github.repository == 'twoimo/tzudong' && github.ref == 'refs/heads/main' && github.sha == inputs.commit_sha"
        self.assertEqual(admission, source["if"])
        self.assertEqual(
            admission
            + " && (inputs.mode == 'preflight' || inputs.mode == 'readback' || inputs.mode == 'runtime-probe' || inputs.mode == 'reconciliation-readback')",
            remote["if"],
        )
        self.assert_exact_detached_checkout(source)
        self.assert_exact_detached_checkout(remote)
        self.assertNotIn("environment", source)
        self.assertEqual({"name": "production-hosted-migration-closure"}, remote["environment"])
        self.assertEqual("source-validation", remote["needs"])
        self.assertEqual({"contents": "read"}, self.workflow["permissions"])
        self.assertNotIn("permissions", source)
        self.assertNotIn("permissions", remote)

        source_values = list(values(source))
        self.assertNotIn("secrets.SUPABASE_DB_URL", "\n".join(source_values))
        controller = next(step for step in remote["steps"] if step.get("name") == "Run protected read-only controller")
        self.assertEqual(
            {
                "REQUESTED_MODE": "${{ inputs.mode }}",
                "SUPABASE_DB_URL": "${{ secrets.SUPABASE_DB_URL }}",
            },
            controller["env"],
        )
        self.assertEqual(
            "python backend/supabase/scripts/g037_hosted_closure_executor.py "
            '"$REQUESTED_MODE" --db-env SUPABASE_DB_URL > '
            '"$RUNNER_TEMP/g037-receipts/${REQUESTED_MODE}-${GITHUB_SHA}.json"\n',
            controller["run"].split("mkdir -p -- \"$RUNNER_TEMP/g037-receipts\"\n", 1)[1],
        )

    def test_actions_graph_has_only_read_only_modes_and_no_private_or_mutation_paths(self):
        remote = self.workflow["jobs"]["remote-readonly"]
        self.assertIn("inputs.mode == 'preflight'", remote["if"])
        self.assertIn("inputs.mode == 'readback'", remote["if"])
        self.assertIn("inputs.mode == 'runtime-probe'", remote["if"])
        self.assertIn("inputs.mode == 'reconciliation-readback'", remote["if"])
        self.assertNotIn("inputs.mode == 'validate'", remote["if"])

        workflow_values = "\n".join(values(self.workflow))
        self.assertNotRegex(workflow_values, PRIVATE_KEY)
        self.assertNotRegex(workflow_values, MUTATION_WORDS)
        self.assertNotIn("--apply", workflow_values)
        self.assertNotIn("apply-controller", workflow_values)
        self.assertNotIn("g037_production_controller.py", workflow_values)
        self.assertEqual({CHECKOUT, PYTHON, "actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08"}, {
            step["uses"]
            for job in self.workflow["jobs"].values()
            for step in job["steps"]
            if "uses" in step
        })

    def test_remote_job_installs_only_hash_locked_controller_dependencies(self):
        install = "python -m pip install --require-hashes --only-binary=:all: -r backend/supabase/scripts/g037-hosted-closure-requirements.txt"
        runs = [step.get("run", "") for step in self.workflow["jobs"]["remote-readonly"]["steps"]]
        self.assertEqual(1, sum(install in run for run in runs))
        for package in ("psycopg==", "cryptography==", "cffi==", "pycparser=="):
            self.assertIn(package, self.requirements)
        self.assertGreaterEqual(self.requirements.count("--hash=sha256:"), 5)

    def test_read_only_workflow_argv_matches_imported_executor_parser_contract(self):
        sys.path.insert(0, str(SCRIPTS))
        try:
            spec = importlib.util.spec_from_file_location("g037_executor", SCRIPTS / "g037_hosted_closure_executor.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
        parser_source = inspect.getsource(module.main)
        self.assertIn('p.add_argument("mode",choices=sorted(MODES))', parser_source)
        self.assertEqual(
            {"validate", "preflight", "readback", "runtime-probe", "reconciliation-readback"},
            module.MODES,
        )

    def test_runbook_records_local_only_execution_and_freeze_continuity(self):
        for required in (
            "local-only",
            "g037_production_controller.py execute",
            "owner-restricted offline evidence/key paths",
            "G037_WRITE_FREEZE=active",
            "keep the freeze active through G038",
            "zero-cost/no-paid-service",
            "G036",
            "exactly 28",
            "G026",
            "20260713002500",
            "20260713002600",
            "20260713002700",
            "rollback rehearsal",
            "Do not retry",
            "post-readback",
        ):
            self.assertIn(required, self.runbook)
        self.assertNotIn("unfreeze", self.runbook.lower())


if __name__ == "__main__":
    unittest.main()
