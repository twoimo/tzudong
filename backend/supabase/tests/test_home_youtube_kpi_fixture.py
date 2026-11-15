"""Offline source/ownership guards; real SQL execution is the separate runner."""
import copy
import importlib.util
import json
from pathlib import Path
from subprocess import CompletedProcess
import tempfile
import unittest
from unittest.mock import patch

from backend.supabase.tests import home_youtube_kpi_fixture as fixture
from backend.supabase.tests import run_home_youtube_kpi_rpc as runner


class HomeKpiFixtureGuards(unittest.TestCase):
    def test_exact_preimages_reconstruct_and_add_without_changing_old_source_bytes(self):
        migration = fixture.MIGRATION.read_text()
        for definitions in [fixture.hosted_definitions(), fixture.canonical_definitions()]:
            for name in ["assert_g014_definer_contract", "assert_g014_catalog_contract"]:
                source = fixture.body(definitions[name])
                self.assertIn(fixture.digest(source), migration)
                addition = fixture.previous.tagged(migration, "home_kpi_invoker")
                if name.endswith("catalog_contract"):
                    addition = addition.replace("v_signature", "v_expected.source_signature").replace("v_oid", "v_procedure")
                after = fixture.expected_patched_body(definitions[name], name)
                self.assertEqual(after.count(addition), 1)
                self.assertEqual(after.replace(addition, "", 1), source)
                # This is the actual catalog loop, not a replacement validator.
                if name.endswith("catalog_contract"):
                    self.assertIn("undeclared SECURITY INVOKER", fixture.catalog_loop_sql(definitions[name]))

    def test_corrupt_hosted_preimage_is_rejected_before_any_database_operation(self):
        document = json.loads(fixture.PREIMAGES.read_text())
        for mutation in ["body", "acl", "owner"]:
            candidate = copy.deepcopy(document)
            item = candidate["functions"]["assert_g014_definer_contract"]
            if mutation == "body":
                item["definition"] = item["definition"].replace("END;", "END;\n", 1)
            elif mutation == "acl":
                item["acl"] += ",anon=X/privacy_workflow_owner"
            else:
                item["owner"] = "postgres"
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "preimage.json"
                path.write_text(json.dumps(candidate))
                with patch.object(fixture, "PREIMAGES", path):
                    with self.assertRaisesRegex(ValueError, "HOME_KPI_FIXTURE_PREIMAGE"):
                        fixture.hosted_definitions()

    def test_canonical_migration_inventory_admits_exact_new_source(self):
        path = fixture.ROOT / "backend/supabase/scripts/local-migrate.py"
        spec = importlib.util.spec_from_file_location("home_kpi_local_migrate", path)
        module = importlib.util.module_from_spec(spec)
        import sys
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        records = module.build_manifest()["source"]["files"]
        record = next(item for item in records if item["path"] == str(fixture.MIGRATION.relative_to(fixture.ROOT)))
        self.assertEqual(record["sha256"], fixture.digest(fixture.MIGRATION.read_bytes()))
        self.assertEqual(module._execution_body(record), fixture.MIGRATION.read_bytes())
        self.assertEqual(record["transaction"]["class"], "transactional")
        self.assertFalse(record["transaction"]["hasBegin"])
        self.assertFalse(record["transaction"]["hasCommit"])
        _setup, wrapped = module._source_execution_parts(record, record["ordinal"] - 1)
        self.assertEqual(wrapped, b"BEGIN;\n" + fixture.MIGRATION.read_bytes() + b"\nCOMMIT;\n")

    def test_private_command_diagnostics_are_bounded(self):
        self.assertEqual(runner.safe_failure("ERROR: 42501: synthetic private detail"), "HOME_KPI_SQL_42501")
        self.assertEqual(runner.safe_failure("ERROR: HOME_KPI_SOURCE_DRIFT detail=private"), "HOME_KPI_SOURCE_DRIFT")
        self.assertEqual(runner.safe_failure("synthetic private detail"), "HOME_KPI_COMMAND_FAILED")
        with patch.object(runner.subprocess, "run", return_value=CompletedProcess([], 1, "", "synthetic private detail")):
            with self.assertRaisesRegex(runner.FixtureFailure, "^HOME_KPI_COMMAND_FAILED$"):
                runner.OwnedDatabase.command(["docker", "inspect", "fixture"])

    def test_remote_docker_rejected_before_pull_or_container_creation(self):
        database = runner.OwnedDatabase()
        with patch.object(runner.shutil, "which", return_value="/usr/bin/docker"), \
                patch.dict(runner.os.environ, {"DOCKER_HOST": "tcp://fixture.invalid:2375"}), \
                patch.object(database, "command") as command:
            with self.assertRaisesRegex(runner.FixtureFailure, "HOME_KPI_REMOTE_DOCKER_DENIED"):
                database.start()
            command.assert_not_called()

    def test_migration_execution_preserves_bytes_inside_psql_single_transaction(self):
        database = runner.OwnedDatabase()
        source = fixture.MIGRATION.read_text()
        with patch.object(database, "owned"), patch.object(database, "command") as command:
            database.sql(source, "kpi_hosted", "postgres", single_transaction=True)
        arguments = command.call_args.args[0]
        self.assertIn("--single-transaction", arguments)
        self.assertIn("--file=-", arguments)
        self.assertIn("ON_ERROR_STOP=1", arguments)
        self.assertEqual(command.call_args.kwargs["sql"], "\\set VERBOSITY verbose\n" + source)

    def test_ambiguous_launch_cleanup_reconciles_only_exact_owned_container(self):
        database = runner.OwnedDatabase()
        database.launch_attempted = True
        database.image_id = runner.IMAGE_CONFIG
        identity = "a" * 64
        inspected = {"Id": identity, "Config": {"Labels": {runner.LABEL: database.token}},
                     "HostConfig": {"NetworkMode": "none", "PortBindings": None}, "Image": runner.IMAGE_CONFIG}
        calls = []
        def command(args, **_kwargs):
            calls.append(args)
            if args[1] == "inspect":
                return CompletedProcess(args, 0, json.dumps([inspected]), "")
            if args[1] == "ps":
                return CompletedProcess(args, 0, identity + "\n" if "--no-trunc" in args else "", "")
            return CompletedProcess(args, 0, "", "")
        with patch.object(database, "command", side_effect=command):
            self.assertTrue(database.cleanup())
        self.assertEqual([args for args in calls if args[1] == "rm"], [["docker", "rm", "--force", "--volumes", database.name]])

        database.container_id = identity
        inspected["Config"]["Labels"][runner.LABEL] = "someone-else"
        calls.clear()
        with patch.object(database, "command", side_effect=command):
            with self.assertRaisesRegex(runner.FixtureFailure, "HOME_KPI_CONTAINER_IDENTITY"):
                database.cleanup()
        self.assertFalse(any(args[1] == "rm" for args in calls))


if __name__ == "__main__":
    unittest.main()
