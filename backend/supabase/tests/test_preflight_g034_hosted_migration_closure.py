import importlib.util
import inspect
import json
import os
import sys
import tempfile
import types
import unittest
import re

import yaml
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts" / "preflight_g034_hosted_migration_closure.py"
ROOT = Path(__file__).parents[3]
WORKFLOW = ROOT / ".github" / "workflows" / "g034-hosted-migration-preflight.yml"
CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"
MUTATION_WORDS = re.compile(r"\b(?:apply|execute|rehearse|prepare)\b", re.IGNORECASE)
PRIVATE_KEY = re.compile(r"(?:BEGIN [A-Z ]*PRIVATE KEY|PRIVATE_KEY)", re.IGNORECASE)


def workflow_values(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from workflow_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from workflow_values(item)
    elif isinstance(value, str):
        yield value

spec = importlib.util.spec_from_file_location("g034_preflight", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeCursor:
    def __init__(self, fail_on=None, catalog_issue=None, definition=None):
        self.sql = []
        self.fail_on = fail_on
        self.catalog_issue = catalog_issue
        self.definition = definition
        self.closed = False
        self.last_sql = ""

    @staticmethod
    def tracked_definition(name):
        text = module.TRACKED_APPROVAL_SOURCE.read_text(encoding="utf-8")
        start = text.index(f"create or replace function public.{name}")
        body = module.extract_dollar_quoted_body(text[start:text.index("$$;", start) + 3])
        return (
            f"CREATE OR REPLACE FUNCTION public.{name}(uuid, uuid, jsonb)\n"
            "RETURNS record\nLANGUAGE plpgsql\nSECURITY DEFINER\n"
            "SET search_path TO 'public'\nAS $function$\n"
            f"{body}\n$function$;"
        )

    @staticmethod
    def catalog_attributes(name):
        argnames = next(item[4] for item in module.TRACKED_APPROVAL_FUNCTIONS if item[2] == name)
        return module.APPROVAL_CATALOG_ATTRIBUTES + (argnames,)

    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        self.last_sql = sql
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("database diagnostic containing a secret")

    def fetchall(self):
        if "schema_migrations" in self.last_sql:
            return [("20260531084516",)]
        if "pg_get_functiondef(procedure.oid)" in self.last_sql:
            name = "approve_edit_submission_item" if "approve_edit_submission_item" in self.sql[-1][1][0] else "approve_submission_item"
            definition = self.definition or self.tracked_definition(name)
            attributes = list(self.catalog_attributes(name))
            if self.catalog_issue == "wrong-definition":
                definition = definition.replace("public.restaurants", "public.restaurants_backup", 1)
            if self.catalog_issue == "body-mutation":
                definition = definition.replace("v_is_admin boolean", "v_is_admin integer", 1)
            if self.catalog_issue == "malformed-body":
                definition = definition.replace("$function$;", "$other$;", 1)
            attribute_index = {
                "wrong-prokind": 0,
                "wrong-language": 1,
                "wrong-prosecdef": 2,
                "wrong-proconfig": 3,
                "wrong-proretset": 4,
                "wrong-prorettype": 5,
                "wrong-proallargtypes": 6,
                "wrong-proargmodes": 7,
                "wrong-proargnames": 8,
            }.get(self.catalog_issue)
            if attribute_index is not None:
                attributes[attribute_index] = {
                    0: "p", 1: "sql", 2: False, 3: ("search_path=private",), 4: False,
                    5: 25, 6: (2950,), 7: ("i",), 8: ("wrong",),
                }[attribute_index]
            return [(definition, *attributes)]
        raise AssertionError(self.last_sql)

    def fetchone(self):
        if "to_regclass('public.restaurants_backup')" in self.last_sql:
            return (self.catalog_issue != "live-table",)
        if "restaurants_backup" in self.last_sql:
            return (self.catalog_issue in {"function-dependency", "view-dependency", "trigger-dependency", "rule-dependency", "fk-dependency"},)
        if "pg_catalog.pg_class AS class" in self.last_sql:
            return (self.catalog_issue not in {"missing", "wrong-schema", "wrong-name", "wrong-relkind", "decoy"},)
        if "pg_locks" in self.last_sql:
            return (0,)
        if "pg_roles" in self.last_sql:
            return (3,)
        raise AssertionError(self.last_sql)

    def close(self):
        self.closed = True

class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.closed = False
        self.commits = 0

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


class G034HostedPreflightTests(unittest.TestCase):
    def report(self):
        return {
            "blockers": [],
            "catalogFingerprint": None,
            "hostedLedgerFingerprint": None,
            "ledgerExpectedTerminal": "20260531084516",
            "prerequisites": {name: False for name in module.PREREQUISITE_NAMES},
        }

    def run_catalog(self, cursor):
        connection = FakeConnection(cursor)
        fake_psycopg = types.SimpleNamespace(connect=lambda url, autocommit: self.assert_connect(url, autocommit, connection))
        with patch.dict(sys.modules, {"psycopg": fake_psycopg}), patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://not-reported"}):
            report = self.report()
            module.catalog_preflight(report)
        return report, connection, cursor

    def assert_connect(self, url, autocommit, connection):
        self.assertEqual("postgresql://not-reported", url)
        self.assertTrue(autocommit)
        return connection

    def test_manifest_is_exact_selected_closure_and_later_gate(self):
        data = module.load_manifest(module.MANIFEST)
        self.assertEqual(28, len(data["migrations"]))
        self.assertEqual("20260627080000", data["migrations"][0]["version"])
        self.assertEqual("20260713002400", data["migrations"][-1]["version"])
        marketing = data["migrations"][-3]
        self.assertEqual(
            {
                "version": "20260713002200",
                "name": "g014_marketing_state_machine",
                "path": "backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql",
                "sha256": "a041f88d781ef50bfdf59feee2af3f09bc02fc64714fe335861ed5e7d99694a3",
            },
            marketing,
        )
        self.assertEqual("20260713002100", data["migrations"][-4]["version"])
        self.assertEqual("20260713002300", data["migrations"][-2]["version"])
        self.assertEqual(module.EXPECTED_EXCLUDED_VERSIONS, tuple(data["excludedVersions"]))
        self.assertNotIn("20260713002200", data["excludedVersions"])
        manifest_bytes = module.MANIFEST.read_bytes().replace(b"\r\n", b"\n")
        self.assertEqual(module.EXPECTED_MANIFEST_SHA256, module.hashlib.sha256(manifest_bytes).hexdigest())
    def test_manifest_accepts_crlf_but_rejects_bare_carriage_returns(self):
        canonical = module.MANIFEST.read_bytes().replace(b"\r\n", b"\n")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_bytes(canonical.replace(b"\n", b"\r\n"))
            self.assertEqual(module.load_manifest(module.MANIFEST), module.load_manifest(path))
            path.write_bytes(canonical.replace(b"\n", b"\r", 1))
            with self.assertRaisesRegex(ValueError, "manifest-lock-mismatch"):
                module.load_manifest(path)

    def test_manifest_rejects_canonical_path_and_semantic_drift(self):
        data = json.loads(module.MANIFEST.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            data["migrations"][0]["path"] = "backend/supabase/migrations/decoy.sql"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_manifest(path)
            data = json.loads(module.MANIFEST.read_text(encoding="utf-8"))
            data["cloneBackupRecoveryRequired"] = False
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_manifest(path)

    def test_first_sql_is_read_only_with_timeouts_and_explicit_rollback(self):
        report, connection, cursor = self.run_catalog(FakeCursor())
        self.assertEqual([], report["blockers"])
        self.assertEqual("BEGIN READ ONLY", cursor.sql[0][0])
        self.assertEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '5000ms'", "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL idle_in_transaction_session_timeout = '5000ms'"], [item[0] for item in cursor.sql[:4]])
        self.assertEqual("ROLLBACK", cursor.sql[-1][0])
        self.assertEqual(0, connection.commits)
        self.assertTrue(connection.closed)

    def test_catalog_artifact_uses_exact_named_prerequisites_and_fingerprints(self):
        report, _, _ = self.run_catalog(FakeCursor())
        expected = {
            "ledgerTerminalMatches": True,
            "noWaitingLocks": True,
            "publicApproveEditSubmissionItem": True,
            "publicApproveSubmissionItem": True,
            "publicRestaurants": True,
            "publicRestaurantsBackup": True,
            "requiredRolesPresent": True,
            "storageObjects": True,
        }
        self.assertEqual(expected, report["prerequisites"])
        self.assertEqual(module.fingerprint(["20260531084516"]), report["hostedLedgerFingerprint"])
        self.assertEqual(module.fingerprint(expected), report["catalogFingerprint"])
        self.assertNotIn("relations", report)
        self.assertNotIn("ledgerCount", report)
        self.assertNotIn("lockConflictCount", report)
        self.assertNotIn("requiredRoleCount", report)
        self.assertNotIn("targetRpcs", report)

    def test_exception_rolls_back_without_leaking_driver_error(self):
        report, connection, cursor = self.run_catalog(FakeCursor(fail_on="schema_migrations"))
        self.assertIn("catalog-read-failed", report["blockers"])
        self.assertNotIn("database diagnostic", report["blockers"])
        self.assertEqual("ROLLBACK", cursor.sql[-1][0])
        self.assertEqual(0, connection.commits)

    def test_catalog_identity_and_retirement_queries_are_oid_based(self):
        report, _, cursor = self.run_catalog(FakeCursor())
        self.assertEqual([], report["blockers"])
        catalog_sql = [sql for sql, _ in cursor.sql if "to_reg" in sql]
        procedure_checks = [(sql, params) for sql, params in cursor.sql if "to_regprocedure" in sql]
        self.assertTrue(catalog_sql)
        self.assertTrue(all("::text" not in sql for sql in catalog_sql))
        self.assertTrue(all("pg_namespace" in sql for sql in catalog_sql))
        self.assertTrue(all("(" in params[0] for _, params in procedure_checks))
        self.assertTrue(any("class.relkind = 'r'" in sql for sql in catalog_sql))
        self.assertTrue(all("procedure.proargtypes = %s::pg_catalog.oidvector" in sql for sql, _ in procedure_checks))
        self.assertEqual(["2950 2950 3802"] * len(procedure_checks), [params[3] for _, params in procedure_checks])
        self.assertTrue(all("procedure.prokind" in sql for sql, _ in procedure_checks))
        self.assertTrue(any("to_regclass('public.restaurants_backup') IS NULL" in sql for sql, _ in cursor.sql))
        self.assertTrue(all("restaurants_backup" not in str(params) for sql, params in cursor.sql if params))
    def test_retirement_function_scan_excludes_unsupported_prokinds_and_blocks_references(self):
        class Cursor:
            def __init__(self, referenced=False):
                self.referenced = referenced
                self.last_sql = ""
                self.executed = []
            def execute(self, sql):
                self.last_sql = sql
                self.executed.append(sql)
                if "pg_get_functiondef" in sql and "CASE WHEN procedure.prokind IN ('f', 'p') THEN pg_catalog.pg_get_functiondef(procedure.oid)" not in sql:
                    raise RuntimeError("WrongObjectType")
            def fetchone(self):
                return (self.referenced and "pg_get_functiondef" in self.last_sql,)
        cursor = Cursor()
        self.assertFalse(module.catalog_retirement_dependency_exists(cursor))
        self.assertTrue(any("pg_constraint AS catalog_constraint" in sql for sql in cursor.executed))
        self.assertTrue(all("pg_constraint AS constraint" not in sql for sql in cursor.executed))
        for kind in ("function", "procedure"):
            with self.subTest(kind=kind):
                self.assertTrue(module.catalog_retirement_dependency_exists(Cursor(referenced=True)))

    def test_retirement_gate_rejects_live_table_and_each_hidden_dependency_kind(self):
        for issue in ("live-table", "function-dependency", "view-dependency", "trigger-dependency", "rule-dependency", "fk-dependency"):
            with self.subTest(issue=issue):
                report, _, _ = self.run_catalog(FakeCursor(catalog_issue=issue))
                self.assertFalse(report["prerequisites"]["publicRestaurantsBackup"])
                self.assertIn("catalog-prerequisite", report["blockers"])

    def test_retirement_gate_rejects_stale_february_and_wrong_tracked_definitions(self):
        stale = FakeCursor.tracked_definition("approve_submission_item").replace(
            "public.restaurants", "public.restaurants_backup", 1
        )
        for cursor in (FakeCursor(definition=stale), FakeCursor(catalog_issue="wrong-definition")):
            with self.subTest(cursor=cursor.catalog_issue):
                report, _, _ = self.run_catalog(cursor)
                self.assertFalse(report["prerequisites"]["publicApproveSubmissionItem"])
                self.assertIn("catalog-prerequisite", report["blockers"])

    def test_source_derived_body_vectors_and_rendered_header_variants_pass(self):
        contract = module.approval_body_contract()
        self.assertEqual(
            "02420dbf7782d8991a2f43999c723283b9fdde2754f1dd38834474a81017b8a1",
            contract["public.approve_submission_item(uuid,uuid,jsonb)"]["body_hash"],
        )
        self.assertEqual(
            "a88dccb8f26370629ca6dd0b84a8e7681393c16c4e687d709bd3d6bfc8aa6b68",
            contract["public.approve_edit_submission_item(uuid,uuid,jsonb)"]["body_hash"],
        )
        definition = FakeCursor.tracked_definition("approve_submission_item")
        self.assertEqual(
            contract["public.approve_submission_item(uuid,uuid,jsonb)"]["body_hash"],
            module.body_fingerprint(module.extract_dollar_quoted_body(definition)),
        )
        statements = module.approval_source_statements()
        self.assertEqual(len(statements), 2)
        self.assertTrue(all("restaurants_backup" not in statement for statement in statements))
        self.assertIn("approve_submission_item", statements[0])
        self.assertIn("approve_edit_submission_item", statements[1])
        self.assertEqual(
            [module.hashlib.sha256(statement.encode("utf-8")).hexdigest() for statement in statements],
            [item[-1] for item in module.TRACKED_APPROVAL_FUNCTIONS],
        )

    def test_dollar_quoted_body_rejects_malformed_or_mismatched_delimiters(self):
        for definition in ("AS $$ body $tag$", "AS $tag$ body $$", "AS $$ body $$ AS $$"):
            with self.subTest(definition=definition):
                with self.assertRaises(ValueError):
                    module.extract_dollar_quoted_body(definition)

    def test_source_contract_rejects_authenticated_malformed_declaration(self):
        source = module.TRACKED_APPROVAL_SOURCE.read_bytes()
        start = source.index(b"create or replace function public.approve_submission_item")
        source = source[:start] + source[start:].replace(b"as $$", b"as $broken$", 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.sql"
            path.write_bytes(source)
            with patch.object(module, "TRACKED_APPROVAL_SOURCE_SHA256", module.hashlib.sha256(source).hexdigest()):
                with self.assertRaises(ValueError):
                    module.approval_body_contract(path)
    def test_source_contract_rejects_authenticated_duplicate_declaration(self):
        source = module.TRACKED_APPROVAL_SOURCE.read_bytes()
        start = source.index(b"create or replace function public.approve_submission_item")
        duplicate = source + b"\r\n" + source[start:source.index(b"$$;", start) + 3]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.sql"
            path.write_bytes(duplicate)
            with patch.object(module, "TRACKED_APPROVAL_SOURCE_SHA256", module.hashlib.sha256(duplicate).hexdigest()):
                with self.assertRaisesRegex(ValueError, "tracked-approval-declaration"):
                    module.approval_body_contract(path)

    def test_catalog_contract_rejects_body_and_every_attribute_drift(self):
        issues = (
            "body-mutation", "malformed-body", "wrong-prokind", "wrong-language", "wrong-prosecdef",
            "wrong-proconfig", "wrong-proretset", "wrong-prorettype", "wrong-proallargtypes",
            "wrong-proargmodes", "wrong-proargnames",
        )
        for issue in issues:
            with self.subTest(issue=issue):
                report, _, _ = self.run_catalog(FakeCursor(catalog_issue=issue))
                self.assertFalse(report["prerequisites"]["publicApproveSubmissionItem"])
                self.assertIn("catalog-prerequisite", report["blockers"])

    def test_shared_approval_catalog_contract_api_signature(self):
        signature = inspect.signature(module.approval_catalog_contract)
        self.assertEqual(
            {"cursor", "contract", "expected_proconfig"},
            set(signature.parameters),
        )
        self.assertEqual(
            module.APPROVAL_CATALOG_ATTRIBUTES[3],
            signature.parameters["expected_proconfig"].default,
        )
        self.assertEqual(
            inspect.Parameter.KEYWORD_ONLY,
            signature.parameters["expected_proconfig"].kind,
        )

    def test_validate_only_retains_unconditional_clone_backup_blocker(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "artifact.json"
            self.assertEqual(0, module.main(["--validate-only", "--artifact", str(artifact)]))
            report = json.loads(artifact.read_text(encoding="utf-8"))
        self.assertTrue(report["sourceValid"])
        self.assertFalse(report["safeToApply"])
        self.assertTrue(report["cloneBackupRecoveryRequired"])
        self.assertIn("clone-backup-recovery-required", report["blockers"])

    def test_validate_only_receipt_is_deterministic_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            self.assertEqual(0, module.main(["--validate-only", "--artifact", str(first)]))
            self.assertEqual(0, module.main(["--validate-only", "--artifact", str(second)]))
            first_report = json.loads(first.read_text(encoding="utf-8"))
            second_report = json.loads(second.read_text(encoding="utf-8"))
        self.assertEqual(first_report["preflightReceiptId"], second_report["preflightReceiptId"])
        self.assertRegex(first_report["preflightReceiptId"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            module.fingerprint(
                {
                    "catalogFingerprint": None,
                    "hostedLedgerFingerprint": None,
                    "manifestHash": first_report["manifestHash"],
                    "repositoryCommit": first_report["repositoryCommit"],
                    "sourceFingerprint": first_report["sourceFingerprint"],
                }
            ),
            first_report["preflightReceiptId"],
        )
        artifact = json.dumps(first_report)
        self.assertNotIn("postgresql://", artifact)
        self.assertNotIn("database diagnostic", artifact)
        self.assertNotIn("sourceHashes", first_report)

class G034HostedPreflightWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with WORKFLOW.open(encoding="utf8") as source:
            cls.workflow = yaml.safe_load(source)
        cls.job = cls.workflow["jobs"]["preflight"]

    def test_dispatch_and_read_only_job_graph_are_exact(self):
        self.assertEqual(
            {
                "commit_sha": {
                    "description": "Exact main commit SHA to preflight",
                    "required": True,
                    "type": "string",
                }
            },
            self.workflow[True]["workflow_dispatch"]["inputs"],
        )
        self.assertEqual({"contents": "read"}, self.workflow["permissions"])
        self.assertEqual({"preflight"}, set(self.workflow["jobs"]))
        self.assertNotIn("environment", self.job)
        self.assertEqual({"contents": "read"}, self.job["permissions"])
        self.assertIn("github.ref == 'refs/heads/main'", self.job["if"])
        self.assertIn("github.sha == inputs.commit_sha", self.job["if"])

    def test_checkout_is_exact_sha_detached_without_persisted_credentials(self):
        checkout = next(step for step in self.job["steps"] if step.get("uses") == CHECKOUT)
        self.assertEqual(
            {
                "ref": "${{ inputs.commit_sha }}",
                "fetch-depth": 1,
                "persist-credentials": False,
            },
            checkout["with"],
        )
        self.assertEqual(
            1,
            sum(step.get("uses") == CHECKOUT for step in self.job["steps"]),
        )

    def test_source_validation_precedes_only_read_only_credentialed_preflight(self):
        steps = self.job["steps"]
        focused = next(index for index, step in enumerate(steps) if step.get("name") == "Focused source tests")
        validate = next(index for index, step in enumerate(steps) if step.get("name") == "Validate bound source closure")
        credentialed = next(index for index, step in enumerate(steps) if step.get("name") == "Run bounded read-only catalog retirement preflight")
        self.assertLess(focused, validate)
        self.assertLess(validate, credentialed)
        self.assertEqual(
            {"SUPABASE_DB_URL": "${{ secrets.SUPABASE_DB_URL }}"},
            steps[credentialed]["env"],
        )
        self.assertEqual(
            "python backend/supabase/scripts/preflight_g034_hosted_migration_closure.py --artifact g034-hosted-preflight.json",
            steps[credentialed]["run"],
        )

    def test_actions_graph_has_no_private_key_or_mutation_path(self):
        serialized = "\n".join(workflow_values(self.workflow))
        self.assertNotRegex(serialized, PRIVATE_KEY)
        self.assertNotRegex(serialized, MUTATION_WORDS)
        self.assertNotIn("--apply", serialized)
        self.assertNotIn("apply-controller", serialized)
        self.assertNotIn("g037_production_controller.py", serialized)

if __name__ == "__main__":
    unittest.main()
