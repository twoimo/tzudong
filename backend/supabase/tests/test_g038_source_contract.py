"""Static inventory contract for every source admitted to the G038 successor."""
from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[3]
MANIFEST_PATH = ROOT / ".github" / "g038-account-deletion-successor.v1.json"
CONTRACT_PATH = ROOT / "backend" / "supabase" / "scripts" / "g038_successor_contract.py"
BOOTSTRAP_PATH = ROOT / "backend" / "supabase" / "scripts" / "g038_isolated_bootstrap.py"
SELECTED_MIGRATIONS = {
    "backend/supabase/migrations/20260713002600_g014_account_deletion_receipt_parity.sql",
    "backend/supabase/migrations/20260713002700_g028_account_deletion_reauth_proof.sql",
}
EXPECTED_INVENTORY = frozenset(
    {
        ".github/g034-hosted-migration-closure.v1.json",
        ".github/g038-account-deletion-successor.v1.json",
        ".github/workflows/g038-account-deletion-successor.yml",
        ".github/workflows/account-deletion-worker.yml",
        ".github/workflows/privacy-retention.yml",
        "apps/web/app/api/account/delete/route.ts",
        "apps/web/app/api/internal/account-deletion/route.ts",
        "apps/web/app/api/internal/privacy-retention/route.ts",
        "apps/web/integrations/supabase/types.ts",
        "apps/web/lib/privacy/account-deletion-reauth.ts",
        "apps/web/lib/privacy/account-deletion.ts",
        "apps/web/lib/privacy/account-deletion-worker.ts",
        "apps/web/lib/privacy/retention-runner.ts",
        "apps/web/scripts/run-account-deletion-worker.mjs",
        "apps/web/scripts/run-privacy-retention-schedule.mjs",
        "apps/web/tests-unit/account-deletion-contract.test.ts",
        "apps/web/tests-unit/account-deletion-reauth-contract.test.ts",
        "apps/web/tests-unit/account-deletion-worker.test.ts",
        "apps/web/tests-unit/privacy-retention.test.ts",
        "backend/supabase/docs/g038-account-deletion-successor-runbook.md",
        *SELECTED_MIGRATIONS,
        "backend/supabase/scripts/g035_hosted_recovery.py",
        "backend/supabase/scripts/g035_hosted_recovery_contract.py",
        "backend/supabase/scripts/g037_hosted_closure_contract.py",
        "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
        "backend/supabase/scripts/g038_clone_rehearsal.py",
        "backend/supabase/scripts/g038_isolated_bootstrap.py",
        "backend/supabase/scripts/g038_local_clone_adapter.py",
        "backend/supabase/scripts/g038_production_controller.py",
        "backend/supabase/scripts/g038_runtime_proof.py",
        "backend/supabase/scripts/g038_successor_authorization.py",
        "backend/supabase/scripts/g038_successor_contract.py",
        "backend/supabase/scripts/g038_successor_executor.py",
        "backend/supabase/scripts/g038_successor_source.py",
        "backend/supabase/scripts/g038_write_freeze.py",
        "backend/supabase/scripts/g040_recovery_source.py",
        "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
        "backend/supabase/tests/g038_terminal_readback.sql",
        "backend/supabase/tests/test_g038_clone_rehearsal.py",
        "backend/supabase/tests/test_g038_cross_clone_receipt.py",
        "backend/supabase/tests/test_g038_cross_module_contract.py",
        "backend/supabase/tests/test_g038_isolated_bootstrap.py",
        "backend/supabase/tests/test_g038_local_clone_adapter.py",
        "backend/supabase/tests/test_g038_production_controller.py",
        "backend/supabase/tests/test_g038_runtime_proof.py",
        "backend/supabase/tests/test_g038_source_contract.py",
        "backend/supabase/tests/test_g038_successor_authorization.py",
        "backend/supabase/tests/test_g038_successor_contract.py",
        "backend/supabase/tests/test_g038_successor_executor.py",
        "backend/supabase/tests/test_g038_successor_source.py",
        "backend/supabase/tests/test_g038_workflow.py",
        "backend/supabase/tests/test_g038_write_freeze.py",
    }
)
NORMAL_RUNTIME_SURFACES = frozenset(
    {
        ".github/workflows/account-deletion-worker.yml",
        ".github/workflows/privacy-retention.yml",
        "apps/web/app/api/internal/account-deletion/route.ts",
        "apps/web/app/api/internal/privacy-retention/route.ts",
        "apps/web/lib/privacy/account-deletion-worker.ts",
        "apps/web/lib/privacy/retention-runner.ts",
        "apps/web/scripts/run-account-deletion-worker.mjs",
        "apps/web/scripts/run-privacy-retention-schedule.mjs",
    }
)
EXPECTED_BOOTSTRAP_REQUIRED = EXPECTED_INVENTORY - SELECTED_MIGRATIONS
EXPECTED_NORMAL_REFERENCES = {
    ".github/workflows/account-deletion-worker.yml": {
        "apps/web/scripts/run-account-deletion-worker.mjs",
    },
    ".github/workflows/privacy-retention.yml": {
        "apps/web/scripts/run-privacy-retention-schedule.mjs",
    },
    "apps/web/app/api/internal/account-deletion/route.ts": {
        "apps/web/lib/privacy/account-deletion-worker.ts",
    },
    "apps/web/app/api/internal/privacy-retention/route.ts": {
        "apps/web/lib/privacy/retention-runner.ts",
    },
    "apps/web/tests-unit/account-deletion-worker.test.ts": {
        "apps/web/app/api/internal/account-deletion/route.ts",
        "apps/web/lib/privacy/account-deletion-worker.ts",
        "apps/web/scripts/run-account-deletion-worker.mjs",
    },
    "apps/web/tests-unit/privacy-retention.test.ts": {
        "apps/web/app/api/internal/privacy-retention/route.ts",
        "apps/web/lib/privacy/retention-runner.ts",
    },
}


def assignment(tree: ast.Module, name: str) -> ast.AST:
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(target, ast.Name) and target.id == name for target in targets):
                return node.value
    raise AssertionError(f"missing static assignment: {name}")


def string_collection(node: ast.AST, names: dict[str, str] | None = None) -> tuple[str, ...]:
    names = {} if names is None else names
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset":
        if len(node.args) != 1:
            raise AssertionError("frozenset inventory must have one literal argument")
        node = node.args[0]
    if not isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        raise AssertionError("inventory must be a static collection")
    values = []
    for element in node.elts:
        if isinstance(element, ast.Constant) and isinstance(element.value, str):
            values.append(element.value)
        elif isinstance(element, ast.Name) and element.id in names:
            values.append(names[element.id])
        else:
            raise AssertionError("inventory contains a computed or non-string entry")
    return tuple(values)


class G038SourceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="ascii"))
        cls.contract = ast.parse(CONTRACT_PATH.read_text(encoding="utf8"), filename=str(CONTRACT_PATH))
        cls.bootstrap = ast.parse(BOOTSTRAP_PATH.read_text(encoding="utf8"), filename=str(BOOTSTRAP_PATH))

    def test_manifest_names_the_complete_sorted_unique_source_inventory(self):
        inventory = self.manifest["runtimeInventory"]
        self.assertEqual(len(inventory), len(set(inventory)))
        self.assertEqual(inventory, sorted(inventory))
        self.assertEqual(EXPECTED_INVENTORY, frozenset(inventory))
        for relative in inventory:
            self.assertTrue((ROOT / relative).is_file(), relative)

    def test_contract_inventory_is_the_same_complete_static_inventory(self):
        inventory = string_collection(assignment(self.contract, "RUNTIME_INVENTORY"))
        self.assertEqual(tuple(sorted(EXPECTED_INVENTORY)), inventory)
        self.assertEqual(self.manifest["runtimeInventory"], list(inventory))

    def test_isolated_bootstrap_requires_every_g038_runtime_source_and_test(self):
        manifest_name = assignment(self.bootstrap, "MANIFEST_PATH")
        self.assertIsInstance(manifest_name, ast.Constant)
        required = string_collection(
            assignment(self.bootstrap, "REQUIRED_RUNTIME_FILES"),
            {"MANIFEST_PATH": manifest_name.value},
        )
        self.assertEqual(EXPECTED_BOOTSTRAP_REQUIRED, frozenset(required))
        self.assertEqual(len(required), len(set(required)))
        self.assertTrue(frozenset(required).issubset(EXPECTED_INVENTORY))


    def test_entrypoint_local_imports_have_exact_transitive_inventory_closure(self):
        scripts = {
            Path(relative).stem: ROOT / relative
            for relative in EXPECTED_INVENTORY
            if relative.startswith("backend/supabase/scripts/") and relative.endswith(".py")
        }
        dependencies = {}
        for name, path in scripts.items():
            tree = ast.parse(path.read_bytes(), filename=str(path))
            imported = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.update(alias.name.partition(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    imported.add(node.module.partition(".")[0])
            dependencies[name] = imported & scripts.keys()
            unresolved_local = {
                imported_name
                for imported_name in imported
                if (ROOT / "backend" / "supabase" / "scripts" / f"{imported_name}.py").is_file()
                and imported_name not in scripts
            }
            self.assertEqual(set(), unresolved_local, f"{name} has unclosed local imports")

        closures = {}
        for entrypoint in (
            "g038_production_controller",
            "g038_runtime_proof",
            "g038_local_clone_adapter",
        ):
            closure = set()
            pending = [entrypoint]
            while pending:
                name = pending.pop()
                if name in closure:
                    continue
                closure.add(name)
                pending.extend(sorted(dependencies[name] - closure))
            closures[entrypoint] = closure

        self.assertEqual(
            {
                "g035_hosted_recovery",
                "g035_hosted_recovery_contract",
                "g037_hosted_closure_contract",
                "g038_clone_rehearsal",
                "g038_local_clone_adapter",
                "g038_production_controller",
                "g038_successor_authorization",
                "g038_successor_contract",
                "g038_successor_executor",
                "g038_successor_source",
                "g038_write_freeze",
                "g040_recovery_source",
                "preflight_g034_hosted_migration_closure",
            },
            closures["g038_local_clone_adapter"],
        )
        self.assertIn(
            ".github/g034-hosted-migration-closure.v1.json",
            EXPECTED_INVENTORY,
        )
    def test_only_02600_and_02700_are_selected_and_exclusions_remain_permanent(self):
        migration_paths = {row["path"] for row in self.manifest["migrations"]}
        migration_versions = tuple(row["version"] for row in self.manifest["migrations"])
        self.assertEqual(SELECTED_MIGRATIONS, migration_paths)
        self.assertEqual(("20260713002600", "20260713002700"), migration_versions)
        self.assertEqual(["20260713002500", "G026"], self.manifest["excludedSources"])
        admitted = "\n".join((*self.manifest["runtimeInventory"], *migration_paths))
        self.assertNotIn("20260713002500", admitted)
        self.assertNotIn("G026", admitted)

    def test_source_contract_is_static_and_never_imports_or_runs_hosted_code(self):
        tree = ast.parse(Path(__file__).read_text(encoding="utf8"))
        imports = {
            alias.name
            for node in tree.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names
        }
        self.assertEqual({"annotations", "ast", "json", "unittest", "Path"}, imports)
        calls = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        self.assertFalse({"exec", "eval", "__import__"} & calls)


if __name__ == "__main__":
    unittest.main()
