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
CONTROLLER_PATH = ROOT / "backend" / "supabase" / "scripts" / "g040_production_controller.py"
G035_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "g035-hosted-recovery.yml"
G035_RUNBOOK_PATH = ROOT / "backend" / "supabase" / "docs" / "g035-hosted-recovery-runbook.md"
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
        with G035_WORKFLOW_PATH.open(encoding="utf8") as source:
            cls.g035_workflow = yaml.safe_load(source)
        cls.g035_workflow_source = G035_WORKFLOW_PATH.read_text(encoding="utf8")
        cls.g035_runbook = G035_RUNBOOK_PATH.read_text(encoding="utf8")
        cls.program = receipt_program(cls.workflow)
        cls.controller_source = CONTROLLER_PATH.read_text(encoding="utf8")
        cls.controller = ast.parse(cls.controller_source)

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

    def test_runbook_documents_the_exact_g040_pre_execute_sequence(self):
        stages = re.findall(
            r'--entrypoint "\$(?:CONTROLLER|AUTHORITY)" -- ([a-z-]+)',
            self.runbook,
        )
        self.assertEqual(
            [
                "validate-source",
                "diagnose",
                "production-backup",
                "prepare",
                "build-request",
                "verify",
                "execute",
                "readback",
            ],
            stages,
        )
        self.assertRegex(
            self.runbook,
            re.compile(
                r"--entrypoint backend/supabase/scripts/g037_production_controller\.py -- prepare \\\n"
                r".*?--service-file '<SERVICE_FILE>' --service-name g040-production --pgpass-file '<PGPASS_FILE>'",
                re.DOTALL,
            ),
        )
        verify_index = stages.index("verify")
        self.assertEqual(["verify", "execute"], stages[verify_index : verify_index + 2])
        self.assertIn(
            "G040 authority `verify` is the no-database pre-execute authority gate.",
            self.runbook,
        )
        self.assertIn(
            "reopens and revalidates the exact finalized G037 assertion, all five evidence files, and every G040 custody and authorization input before mutation",
            self.runbook,
        )
        self.assertIn(
            "requires a direct non-superuser `postgres` session with `CREATEROLE` and `postgres` database ownership",
            self.runbook,
        )
        self.assertIn("It neither grants local custody nor switches roles", self.runbook)
        self.assertNotIn("strict `supabase_admin` session/database custody", self.runbook)

    def test_execute_revalidates_g040_custody_before_its_only_mutation_call(self):
        functions = {
            node.name: node
            for node in self.controller.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        execute_calls = [
            node
            for node in ast.walk(functions["execute"])
            if isinstance(node, ast.Call)
        ]
        authorization = next(
            node
            for node in execute_calls
            if isinstance(node.func, ast.Name) and node.func.id == "_authorization"
        )
        revalidation = next(
            node
            for node in execute_calls
            if isinstance(node.func, ast.Name)
            and node.func.id == "_revalidate_production_custody"
        )
        mutation = next(
            node
            for node in execute_calls
            if isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "authority"
            and node.func.attr == "consume_one_shot_attempt"
        )
        self.assertLess(authorization.lineno, revalidation.lineno)
        self.assertLess(revalidation.lineno, mutation.lineno)

        freeze_calls = [
            node
            for node in ast.walk(functions["_backup_freeze"])
            if isinstance(node, ast.Call)
        ]
        self.assertTrue(
            any(
                isinstance(node.func, ast.Name)
                and node.func.id == "validate_operator_assertion"
                for node in freeze_calls
            )
        )
        self.assertTrue(
            any(
                isinstance(node.func, ast.Name)
                and node.func.id == "_stable_bytes"
                for node in freeze_calls
            )
        )
        self.assertTrue(
            any(
                isinstance(node, ast.Compare)
                and isinstance(node.left, ast.Call)
                and isinstance(node.left.func, ast.Name)
                and node.left.func.id == "len"
                and len(node.left.args) == 1
                and isinstance(node.left.args[0], ast.Attribute)
                and isinstance(node.left.args[0].value, ast.Name)
                and node.left.args[0].value.id == "args"
                and node.left.args[0].attr == "freeze_evidence"
                and any(
                    isinstance(comparator, ast.Constant)
                    and comparator.value == 5
                    for comparator in node.comparators
                )
                for node in ast.walk(functions["_backup_freeze"])
            )
        )

    def test_source_contract_keeps_g037_validation_outside_g040_authority(self):
        self.assertNotRegex(
            self.runbook,
            r"--entrypoint backend/supabase/scripts/g037_production_controller\.py -- validate\b",
        )
        self.assertNotIn("G037 controller `validate`", self.runbook)
        self.assertNotIn("full G037 `validate`", self.runbook)
        self.assertNotIn("g037_production_controller", self.controller_source)
    def test_g035_restore_custody_uses_exact_bootstrap_and_closes_pipe_writer(self):
        dispatch = self.g035_workflow[True]["workflow_dispatch"]
        expected_modes = [
            "validate",
            "capture",
            "short-url-remediation-inspect",
            "short-url-remediation-apply",
            "short-url-remediation-verify",
            "clone-apply",
            "local-postflight",
        ]
        self.assertEqual(expected_modes, dispatch["inputs"]["mode"]["options"])
        invocations = re.findall(r"\brun_g035\s+([a-z-]+)\b", self.g035_workflow_source)
        self.assertEqual(expected_modes, invocations)
        self.assertNotIn("G035_OFFLINE_IDENTITY_FILE", self.g035_workflow_source)
        self.assertNotIn("G035_DECRYPT_COMMAND", self.g035_workflow_source)
        self.assertNotIn("restore-verify)", self.g035_workflow_source)
        workflow_surface = "\n".join(str(value) for value in scalar_values(self.g035_workflow))
        self.assertNotRegex(workflow_surface, r"(?i)restore-verify|identity[-_ ]?(?:file|path|handle|fd)|decrypt|private[-_ ]?key|--inkey|fallback|compatibility")
        self.assertNotRegex(
            self.g035_workflow_source,
            r"(?m)^\s*(?!git show\b)[^\n]*python(?:3(?:\.\d+)?)?\s+[^\n]*g035_hosted_recovery\.py\b",
        )
        self.assertIn('git show "$source_commit:$bootstrap" | python -I -', self.g035_workflow_source)
        self.assertIn('--authorized-final-commit "$source_commit"', self.g035_workflow_source)
        self.assertIn('--entrypoint "$entrypoint" -- "$@"', self.g035_workflow_source)
        for runbook in (self.runbook,):
            lines = runbook.splitlines()
            indexes = [index for index, line in enumerate(lines) if "restore-verify" in line]
            self.assertEqual(1, len(indexes))
            start = indexes[0]
            while start and lines[start - 1].rstrip().endswith("\\"):
                start -= 1
            end = indexes[0]
            while lines[end].rstrip().endswith("\\"):
                end += 1
            command = "\n".join(lines[start : end + 1])
            self.assertTrue(command.startswith('git show "$AUTHORIZED_COMMIT:$BOOTSTRAP" | <approved-selective-inheritance-custodian>'))
            self.assertIn("--close-writer-after-write -- python3 -I -B -", command)
            self.assertIn('--repository-root "$PWD" --authorized-final-commit "$AUTHORIZED_COMMIT"', command)
            self.assertIn('--entrypoint "$RESTORE_ENTRYPOINT" -- restore-verify', command)
            self.assertEqual(2, command.count("--identity-fd 3"))
            self.assertIn("--restore-receipt", command)
            self.assertNotRegex(command, r"(?:^|\s)>(?:\s|$)")
            self.assertNotRegex(command, r"--identity-(?:file|path)\b|--private-key\b|--key-reference\b|--inkey\b")
            self.assertNotRegex(command, r"(?i)\b(?:fallback|compatibility)\b|retain(?:s|ed)?\s+(?:the\s+)?(?:pipe\s+)?writer|leave(?:s|ing)?\s+(?:the\s+)?(?:pipe\s+)?writer\s+open")
            self.assertIn("--identity-handle <canonical-inherited-handle>", runbook)
            self.assertNotRegex(
                runbook,
                r"(?m)^\s*(?:<[^>]+>\s+--\s+)?(?:[^\s]+\s+)*python(?:3(?:\.\d+)?)?\s+[^\n]*g035_hosted_recovery\.py\s+restore-verify\b",
            )
            self.assertNotRegex(runbook, r"(?i)signer/key-reference path|--inkey\b|<[^>]*(?:private|key)[^>]*path[^>]*>")
        self.assertIn(
            "backend/supabase/scripts/g035_dual_restore_custody_launcher.py",
            self.g035_runbook,
        )
        self.assertIn(
            "the only executable restore path in this runbook is the committed dual-restore",
            self.g035_runbook,
        )
        self.assertNotIn("<approved-selective-inheritance-custodian>", self.g035_runbook)
        self.assertNotIn("--identity-handle", self.g035_runbook)
        self.assertNotIn("--inkey", self.g035_runbook)


if __name__ == "__main__":
    unittest.main()
