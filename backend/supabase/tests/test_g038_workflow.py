"""Parsed fail-closed contract for the G038 source-only GitHub workflow."""
from __future__ import annotations

import copy
import re
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "g038-account-deletion-successor.yml"
CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
SETUP_PYTHON = "actions/setup-python@42375524e23c412d93fb67b49958b491fce71c38"
ATTEST = "actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be"
UPLOAD = "actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08"
JOB_IF = (
    "github.repository == 'twoimo/tzudong' && github.ref == 'refs/heads/main' "
    "&& github.sha == inputs.commit_sha"
)
FULL_SUITE_COMMAND = "python -I -m pytest -q backend/supabase/tests/test_g038*.py"
ACTION_PIN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}$")
DANGEROUS = re.compile(
    r"(?i)(?:\bpsql\b|\bsupabase\b[^\n]*(?:db|migration)|"
    r"\b(?:apply|execute|readback|prepare|capture|restore|insert|update|delete|grant|"
    r"revoke|alter|drop|truncate)\b|service[_ -]?role|database[_ -]?url|\bdsn\b|"
    r"private[_ -]?key|BEGIN [A-Z ]*PRIVATE KEY)"
)


def scalar_strings(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from scalar_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from scalar_strings(item)
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


def assert_safe_workflow(test: unittest.TestCase, workflow: dict) -> None:
    test.assertEqual({"workflow_dispatch"}, set(workflow[True]))
    test.assertEqual({"commit_sha": {"description": "Exact protected main commit SHA", "required": True, "type": "string"}}, workflow[True]["workflow_dispatch"]["inputs"])
    test.assertEqual({"contents": "read", "id-token": "write", "attestations": "write"}, workflow["permissions"])
    test.assertEqual({"group": "g038-account-deletion-successor-source-validation", "cancel-in-progress": False}, workflow["concurrency"])
    test.assertEqual({"source-validate"}, set(workflow["jobs"]))
    job = workflow["jobs"]["source-validate"]
    test.assertEqual(JOB_IF, job["if"])
    test.assertEqual("ubuntu-24.04", job["runs-on"])
    test.assertEqual(10, job["timeout-minutes"])
    test.assertFalse({"services", "container", "environment"} & set(job))
    test.assertNotIn("env", set(mapping_keys(workflow)))
    values = "\n".join(scalar_strings(workflow))
    test.assertNotRegex(values, r"(?i)\$\{\{\s*(?:secrets|vars)\.")
    test.assertNotRegex(values, DANGEROUS)
    test.assertNotRegex(values, r"(?i)(?:self-hosted|pull_request_target)")

    steps = job["steps"]
    names = [step["name"] for step in steps]
    test.assertEqual([
        "Checkout exact detached protected main revision",
        "Set up pinned Python",
        "Install pinned source-test dependencies",
        "Run full offline G038 source-test suite",
        "Create source receipt after successful source tests",
        "Attest exact source receipt",
        "Upload authenticated source receipt and exact attestation bundle",
        "Remove temporary source receipt",
    ], names)
    actions = [step["uses"] for step in steps if "uses" in step]
    test.assertEqual([CHECKOUT, SETUP_PYTHON, ATTEST, UPLOAD], actions)
    test.assertEqual(
        {"ref": "${{ github.sha }}", "fetch-depth": 0, "persist-credentials": False},
        steps[0]["with"],
    )
    test.assertEqual({"python-version": "3.12.10"}, steps[1]["with"])
    for action in actions:
        test.assertRegex(action, ACTION_PIN)
    test.assertEqual(FULL_SUITE_COMMAND, steps[3]["run"])
    test.assertLess(names.index("Run full offline G038 source-test suite"), names.index("Create source receipt after successful source tests"))
    receipt_step = steps[4]
    test.assertIn("validate-source", receipt_step["run"])
    test.assertEqual({"subject-path": "${{ runner.temp }}/g038-source-receipt/receipt.json"}, steps[5]["with"])
    upload = steps[6]
    test.assertNotIn("if", upload)
    test.assertEqual(UPLOAD, upload["uses"])
    test.assertEqual(
        "${{ runner.temp }}/g038-source-receipt/receipt.json\n${{ steps.source-attestation.outputs.bundle-path }}\n",
        upload["with"]["path"],
    )
    test.assertEqual("error", upload["with"]["if-no-files-found"])


class G038WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf8"))

    def test_workflow_is_exact_source_only_boundary(self):
        assert_safe_workflow(self, self.workflow)

    def test_failed_run_ordering_and_dangerous_mutations_are_rejected(self):
        mutations = []
        early_receipt = copy.deepcopy(self.workflow)
        steps = early_receipt["jobs"]["source-validate"]["steps"]
        steps.insert(2, steps.pop(4))
        mutations.append(early_receipt)
        always_upload = copy.deepcopy(self.workflow)
        always_upload["jobs"]["source-validate"]["steps"][6]["if"] = "${{ always() }}"
        mutations.append(always_upload)
        no_attestation = copy.deepcopy(self.workflow)
        no_attestation["jobs"]["source-validate"]["steps"].pop(5)
        mutations.append(no_attestation)
        wrong_attestation = copy.deepcopy(self.workflow)
        wrong_attestation["jobs"]["source-validate"]["steps"][5]["uses"] = "actions/attest-build-provenance@v2"
        mutations.append(wrong_attestation)
        production = copy.deepcopy(self.workflow)
        production["jobs"]["source-validate"]["steps"].append({"name": "extra", "run": "psql -f change.sql"})
        mutations.append(production)
        secret = copy.deepcopy(self.workflow)
        secret["jobs"]["source-validate"]["steps"][4]["env"] = {"TOKEN": "${{ secrets.TOKEN }}"}
        mutations.append(secret)
        for candidate in mutations:
            with self.subTest(candidate=candidate), self.assertRaises(AssertionError):
                assert_safe_workflow(self, candidate)


if __name__ == "__main__":
    unittest.main()
