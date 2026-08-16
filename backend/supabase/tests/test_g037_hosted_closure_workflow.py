"""Parsed job-graph contracts for the G037 hosted closure workflow."""
import contextlib
import importlib.util
import io
import json
import re
import sys
from pathlib import Path
import types
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
                "ref": "${{ github.sha }}",
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
        self.assertNotIn("environment", remote)
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
            "timeout --signal=TERM --kill-after=5s 120s "
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
    def test_security_audit_trigger_covers_nonstandard_g037_manifest(self):
        workflow = (ROOT / ".github/workflows/security-audit.yml").read_text(encoding="utf8")
        self.assertIn("backend/supabase/scripts/g037-hosted-closure-requirements.txt", workflow)

    def test_read_only_workflow_argv_matches_imported_executor_parser_contract(self):
        remediation = types.ModuleType("g037_remediation_authorization")
        remediation.ExecutionAuthorizationEnvelope = dict
        remediation.authorize_exact_baseline = lambda *args, **kwargs: None
        remediation.POLICY = "test-policy"
        previous_remediation = sys.modules.get("g037_remediation_authorization")
        sys.modules["g037_remediation_authorization"] = remediation
        sys.path.insert(0, str(SCRIPTS))
        try:
            spec = importlib.util.spec_from_file_location("g037_executor", SCRIPTS / "g037_hosted_closure_executor.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        finally:
            sys.path.pop(0)
            if previous_remediation is None:
                del sys.modules["g037_remediation_authorization"]
            else:
                sys.modules["g037_remediation_authorization"] = previous_remediation

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(0, module.main(["validate"]))
        self.assertEqual(
            {"validate", "preflight", "readback", "runtime-probe", "reconciliation-readback"},
            module.MODES,
        )
        self.assertEqual("validate", json.loads(output.getvalue())["mode"])

        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as rejected:
                module.main(["execute"])
        self.assertEqual(2, rejected.exception.code)

    def test_runbook_records_local_only_execution_and_preexisting_freeze_continuity(self):
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
        numbered_steps = re.findall(r"(?m)^\d+\.\s+.*$", self.runbook)
        for step in numbered_steps:
            for mutation in re.finditer(
                r"\b(?:set(?: or change)?|change|update|configure)\b.*\b(?:G037_WRITE_FREEZE|GitHub (?:repository|environment) variables?)\b",
                step,
            ):
                self.assertRegex(step[: mutation.start()], r"(?:do|must)\s+not\s+$")
        for required in (
            "already active",
            "independently verify",
            "An absent or mismatched freeze state blocks execution",
            "must not set or change `G037_WRITE_FREEZE` or any GitHub repository or environment variable",
        ):
            self.assertIn(required, self.runbook)
        for required in (
            "Validate is database-free and rejects custody, expiry, source, freeze, and evidence mismatches",
            "Run local-only `g037_production_controller.py rehearse`",
            "Run local-only `g037_production_controller.py execute`",
            "exclusively created and directory-synced before secret admission or database connection",
        ):
            self.assertIn(required, self.runbook)
        self.assertNotIn("unfreeze", self.runbook.lower())


    def test_runbook_binds_local_remediation_authority_before_execution(self):
        sequence = (
            "g037_production_controller.py prepare",
            "Review the exact request bytes offline",
            "Run `finalize` through the same bootstrap",
            "legacy G035 capture, restore, and inspection receipts and the legacy signed authorization",
            "Build and sign the G037 remediation template offline",
            "`validate`, `rehearse`, and `execute` require the same seven legacy/execution files",
            "g037_production_controller.py validate",
            "g037_production_controller.py rehearse",
            "g037_production_controller.py execute",
        )
        positions = [self.runbook.index(item) for item in sequence]
        self.assertEqual(positions, sorted(positions))
        for required in (
            "fresh canonical **unsigned** assertion request",
            "create a detached signature with the fixed authorization public-key counterpart",
            "holds both files by descriptor",
            "Never supply any private signing-key path on the controller command line",
            "same seven legacy/execution files",
            "only valid marker location from the authenticated authorization ID and authorization hash",
            "retained on commit, rollback, ambiguity, and every failure",
            "After **any** attempt, including rollback",
            "No GitHub Actions job may execute this mutation",
        ):
            self.assertIn(required, self.runbook)
        self.assertIn(
            "Backup material, provider exports, credentials, raw URLs, row data, keys, and secrets never go to GitHub repositories, Actions artifacts, caches, logs, arguments, releases, or issues",
            self.runbook,
        )
if __name__ == "__main__":
    unittest.main()
