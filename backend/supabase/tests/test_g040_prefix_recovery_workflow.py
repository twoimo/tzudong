"""Fail-closed parsed contracts for the G040 GitHub source-validation boundary."""
from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "g040-prefix-recovery.yml"
RUNBOOK_PATH = ROOT / "backend" / "supabase" / "docs" / "g040-prefix-recovery-runbook.md"
CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
UPLOAD = "actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08"
FORBIDDEN_TEXT = re.compile(
    r"(?:secrets\.|vars\.|private[_ -]?key|BEGIN [A-Z ]*PRIVATE KEY|\bdsn\b|database_url|"
    r"service[_ -]?file|authorization|signature|diagnose|readback|prepare|execute|\bmode\b)",
    re.IGNORECASE,
)


def scalar_values(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from scalar_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from scalar_values(item)
    elif isinstance(value, str):
        yield value


def mapping_keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from mapping_keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from mapping_keys(item)


def receipt_program(workflow: dict[str, object]) -> ast.Module:
    step = next(
        item
        for item in workflow["jobs"]["source-validate"]["steps"]
        if item["name"] == "Verify recovery source and produce bounded receipt"
    )
    match = re.search(r"<<'PY'\n(?P<program>.*?)\n\s*PY$", step["run"], re.DOTALL)
    if match is None:
        raise AssertionError("receipt must be a checked-in Python program")
    return ast.parse(textwrap.dedent(match.group("program")))


def calls(program: ast.AST, attribute: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(program)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == attribute
    ]


class G040PrefixRecoveryWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with WORKFLOW_PATH.open(encoding="utf8") as source:
            cls.workflow = yaml.safe_load(source)
        cls.runbook = RUNBOOK_PATH.read_text(encoding="utf8")
        cls.program = receipt_program(cls.workflow)

    def test_dispatch_exposes_only_source_validate(self):
        dispatch = self.workflow[True]["workflow_dispatch"]
        self.assertEqual(
            {
                "commit_sha": {
                    "description": "Exact protected main commit SHA",
                    "required": True,
                    "type": "string",
                },
            },
            dispatch["inputs"],
        )
        self.assertEqual({"contents": "read"}, self.workflow["permissions"])
        self.assertEqual(
            {"group": "g040-prefix-recovery-source-validation", "cancel-in-progress": False},
            self.workflow["concurrency"],
        )

    def test_job_is_pinned_detached_and_has_no_hosted_service_surface(self):
        jobs = self.workflow["jobs"]
        self.assertEqual({"source-validate"}, set(jobs))
        job = jobs["source-validate"]
        self.assertEqual(
            "github.repository == 'twoimo/tzudong' && github.ref == 'refs/heads/main' && github.sha == inputs.commit_sha",
            job["if"],
        )
        self.assertEqual("ubuntu-24.04", job["runs-on"])
        self.assertEqual(10, job["timeout-minutes"])
        self.assertNotIn("services", job)
        self.assertNotIn("container", job)
        self.assertNotIn("environment", job)

        checkouts = [step for step in job["steps"] if step.get("uses") == CHECKOUT]
        self.assertEqual(1, len(checkouts))
        self.assertEqual(
            {"ref": "${{ inputs.commit_sha }}", "fetch-depth": 1, "persist-credentials": False},
            checkouts[0]["with"],
        )
        verification = next(step for step in job["steps"] if step["name"] == "Verify detached SHA binding")
        self.assertEqual({"EXPECTED_SHA": "${{ inputs.commit_sha }}"}, verification["env"])
        self.assertIn('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"', verification["run"])
        self.assertIn('test "$(git branch --show-current)" = ""', verification["run"])

    def test_receipt_program_calls_real_verifier_and_requires_exact_binding(self):
        imports = [node.names[0].name for node in self.program.body if isinstance(node, ast.Import)]
        self.assertIn("g040_recovery_source", imports)
        verifier_calls = calls(self.program, "verify_recovery_source")
        self.assertEqual(1, len(verifier_calls))
        verifier = verifier_calls[0]
        self.assertEqual("g040_recovery_source", verifier.func.value.id)
        self.assertEqual(2, len(verifier.args))
        self.assertEqual("Path", verifier.args[0].func.value.id)
        self.assertEqual("cwd", verifier.args[0].func.attr)
        self.assertEqual("EXPECTED_SHA", verifier.args[1].id)

        source_binding = [
            node
            for node in ast.walk(self.program)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "g040_recovery_source"
            and node.attr == "SourceBinding"
        ]
        self.assertEqual(1, len(source_binding))
        comparisons = [node for node in ast.walk(self.program) if isinstance(node, ast.Compare)]
        self.assertTrue(
            any(
                isinstance(node.left, ast.Attribute)
                and isinstance(node.left.value, ast.Name)
                and node.left.value.id == "binding"
                and node.left.attr == "final_commit"
                and any(isinstance(value, ast.Name) and value.id == "EXPECTED_SHA" for value in node.comparators)
                for node in comparisons
            )
        )
        self.assertTrue(
            any(
                isinstance(node.left, ast.Call)
                and isinstance(node.left.func, ast.Name)
                and node.left.func.id == "type"
                and any(isinstance(value, ast.Attribute) and value.attr == "SourceBinding" for value in node.comparators)
                for node in comparisons
            )
        )

    def test_workflow_fails_closed_on_mutation_credentials_paid_or_raw_artifact_additions(self):
        job = self.workflow["jobs"]["source-validate"]
        values = "\n".join(scalar_values(self.workflow))
        keys = "\n".join(mapping_keys(self.workflow))
        self.assertNotRegex(values, FORBIDDEN_TEXT)
        self.assertNotRegex(
            keys,
            r"(?i)(?:private[_ -]?key|\bdsn\b|database[_ -]?url|service[_ -]?file|authorization|signature|mode)",
        )
        self.assertNotRegex(values, r"(?i)(?:self-hosted|large(?:r)?|macos|windows|postgres|docker)")
        self.assertEqual({CHECKOUT, UPLOAD}, {step["uses"] for step in job["steps"] if "uses" in step})
        self.assertEqual(
            [
                "Checkout exact detached protected main revision",
                "Verify detached SHA binding",
                "Verify recovery source and produce bounded receipt",
                "Upload bounded sanitized source receipt",
                "Remove temporary source receipt",
            ],
            [step["name"] for step in job["steps"]],
        )

        upload = next(step for step in job["steps"] if step.get("uses") == UPLOAD)
        self.assertEqual(
            {
                "name": "g040-prefix-recovery-source-receipt",
                "path": "${{ runner.temp }}/g040-receipts/receipt.json",
                "if-no-files-found": "error",
            },
            upload["with"],
        )
        dictionaries = [node for node in ast.walk(self.program) if isinstance(node, ast.Dict)]
        receipt = next(
            node
            for node in dictionaries
            if [key.value for key in node.keys if isinstance(key, ast.Constant)]
            == ["schema", "status", "runtime_source_root"]
        )
        self.assertEqual(
            ["g040-prefix-recovery-source-receipt-v1", "source-verified"],
            [value.value for value in receipt.values[:2] if isinstance(value, ast.Constant)],
        )
        self.assertIsInstance(receipt.values[2], ast.Attribute)
        self.assertEqual("runtime_source_root", receipt.values[2].attr)
        dump = next(
            node
            for node in calls(self.program, "dump")
            if isinstance(node.func.value, ast.Name) and node.func.value.id == "json"
        )
        keywords = {keyword.arg: keyword.value for keyword in dump.keywords}
        self.assertEqual(True, keywords["sort_keys"].value)
        self.assertEqual(
            (",", ":"),
            tuple(value.value for value in keywords["separators"].elts),
        )

    def test_runbook_keeps_all_operational_modes_local_and_requires_rehearsal(self):
        for required in (
            "exposes only `validate`",
            "`diagnose` and `readback` require local restrictive service and custody artifacts",
            "`diagnose`, `readback`, `prepare`, and `execute` are local operator-only modes outside GitHub",
            "two independent free local PostgreSQL 17.6 clone rehearsals",
            "fresh encrypted capture",
            "one-shot authorization",
            "old freeze and old authority must never be reused",
            "`FULL_ESCAPED` is an expected classification",
            "Any partial or ambiguous classification blocks",
            "one transaction/one commit",
            "fixed local `readback`",
            "zero-cost",
        ):
            self.assertIn(required, self.runbook)
        self.assertIn("verify_recovery_source", self.runbook)
        self.assertIn("schema, status, and the runtime source-root hash", self.runbook)


if __name__ == "__main__":
    unittest.main()
