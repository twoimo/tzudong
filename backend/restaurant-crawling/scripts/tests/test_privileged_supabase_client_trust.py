from __future__ import annotations

import base64
import ast
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.supabase_rest import (
    SUPABASE_REST_CONFIGURATION_ERROR,
    SupabaseRestConfigurationError,
)


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
SCRIPT_PATHS = (
    SCRIPTS_DIR / "02-1-migrate-meta-to-supabase.py",
    SCRIPTS_DIR / "06-1-transcript-document-with-meta.py",
)
EVALUATION_INSERT_SCRIPT = (
    BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py"
)
VALID_URL = "https://abcdefghijklmnopqrst.supabase.co"
VALID_SERVICE_ROLE_KEY = "sb_" + "secret_service_role_key_for_tests_only"
PUBLIC_KEY = "sb_publishable_public_key_for_tests_only"
MALFORMED_SERVICE_ROLE_KEY = "sb_" + "secret_service_role_key\n"


def jwt_with_role(role: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"role": role}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.signature"


def load_script(script_path: Path) -> types.ModuleType:
    module_name = f"privileged_supabase_client_{script_path.stem.replace('.', '_')}"
    module_spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    supabase_stub = types.ModuleType("supabase")
    supabase_stub.Client = object
    supabase_stub.create_client = lambda *_args: object()
    tqdm_stub = types.ModuleType("tqdm")
    tqdm_stub.tqdm = lambda iterable, **_kwargs: iterable

    with (
        patch.dict(sys.modules, {"supabase": supabase_stub, "tqdm": tqdm_stub}),
        patch("utils.runtime_paths.load_backend_env", return_value=None),
    ):
        module_spec.loader.exec_module(module)

    return module


class PrivilegedSupabaseClientTrustTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.modules = tuple(load_script(script_path) for script_path in SCRIPT_PATHS)

    def assert_no_client_for_invalid_environment(
        self, environment: dict[str, str]
    ) -> None:
        for module, script_path in zip(self.modules, SCRIPT_PATHS):
            calls: list[tuple[str, str]] = []

            def create_client(url: str, key: str) -> object:
                calls.append((url, key))
                return object()

            with self.subTest(script=script_path.name), patch.object(
                module, "create_client", side_effect=create_client
            ), patch.dict(os.environ, environment, clear=True):
                with self.assertRaises(SupabaseRestConfigurationError) as raised:
                    module.get_supabase_client()

            diagnostic = str(raised.exception)
            self.assertEqual(SUPABASE_REST_CONFIGURATION_ERROR, diagnostic)
            self.assertEqual([], calls)
            for value in environment.values():
                self.assertNotIn(value, diagnostic)

    def test_rejects_untrusted_or_incomplete_credentials_before_client_creation(self) -> None:
        cases = {
            "arbitrary_url": {
                "SUPABASE_URL": "https://attacker.example.invalid",
                "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
            },
            "public_fallback": {
                "NEXT_PUBLIC_SUPABASE_URL": VALID_URL,
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": jwt_with_role("anon"),
                "VITE_SUPABASE_URL": VALID_URL,
                "VITE_SUPABASE_PUBLISHABLE_KEY": PUBLIC_KEY,
            },
            "anon_key": {
                "SUPABASE_URL": VALID_URL,
                "SUPABASE_SERVICE_ROLE_KEY": jwt_with_role("anon"),
            },
            "legacy_generic_key": {
                "SUPABASE_URL": VALID_URL,
                "SUPABASE_KEY": VALID_SERVICE_ROLE_KEY,
            },
            "malformed_service_role_key": {
                "SUPABASE_URL": VALID_URL,
                "SUPABASE_SERVICE_ROLE_KEY": MALFORMED_SERVICE_ROLE_KEY,
            },
            "pipeline_local_sink_with_hosted_url": {
                "SUPABASE_URL": VALID_URL,
                "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
                "TZUDONG_DATA_SINK": "local_db",
                "TZUDONG_EXECUTION_MODE": "live",
            },
            "pipeline_artifact_sink_with_hosted_url": {
                "SUPABASE_URL": VALID_URL,
                "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
                "TZUDONG_DATA_SINK": "artifact_only",
                "TZUDONG_EXECUTION_MODE": "live",
            },
            "missing_canonical_configuration": {},
        }

        for case, environment in cases.items():
            with self.subTest(case=case):
                self.assert_no_client_for_invalid_environment(environment)

    def test_passes_only_the_validated_canonical_pair_to_the_client_factory(self) -> None:
        environment = {
            "SUPABASE_URL": VALID_URL,
            "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
            "NEXT_PUBLIC_SUPABASE_URL": "https://attacker.example.invalid",
            "SUPABASE_KEY": PUBLIC_KEY,
        }

        for module, script_path in zip(self.modules, SCRIPT_PATHS):
            calls: list[tuple[str, str]] = []
            expected_client = object()

            def create_client(url: str, key: str) -> object:
                calls.append((url, key))
                return expected_client

            with self.subTest(script=script_path.name), patch.object(
                module, "create_client", side_effect=create_client
            ), patch.dict(os.environ, environment, clear=True):
                client = module.get_supabase_client()

            self.assertIs(expected_client, client)
            self.assertEqual([(VALID_URL, VALID_SERVICE_ROLE_KEY)], calls)
    def test_entrypoints_emit_fixed_private_configuration_errors(self) -> None:
        environment = {
            "SUPABASE_URL": "https://attacker.example.invalid",
            "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
        }
        expected_diagnostics = (
            "[ERROR] Supabase REST configuration invalid.",
            "op=supabase_rest_configuration_invalid",
        )

        for index, (module, script_path, expected_diagnostic) in enumerate(
            zip(self.modules, SCRIPT_PATHS, expected_diagnostics)
        ):
            calls: list[tuple[str, str]] = []
            stdout = io.StringIO()
            stderr = io.StringIO()

            def create_client(url: str, key: str) -> object:
                calls.append((url, key))
                return object()

            with self.subTest(script=script_path.name), patch.object(
                module, "create_client", side_effect=create_client
            ), patch.dict(os.environ, environment, clear=True), patch.object(
                sys, "argv", [module.__file__]
            ), redirect_stdout(stdout), redirect_stderr(stderr):
                if index == 0:
                    with self.assertRaises(SystemExit) as raised:
                        module.main()
                    self.assertEqual(1, raised.exception.code)
                else:
                    module.main()

            output = stdout.getvalue() + stderr.getvalue()
            self.assertEqual([], calls)
            self.assertIn(expected_diagnostic, output)
            self.assertNotIn(environment["SUPABASE_URL"], output)
            self.assertNotIn(environment["SUPABASE_SERVICE_ROLE_KEY"], output)

    def test_meta_dry_run_never_constructs_a_privileged_client(self) -> None:
        meta_script = self.modules[0]

        with (
            patch.object(meta_script, "get_supabase_client") as get_client,
            patch.object(meta_script, "migrate_meta") as migrate_meta,
            patch.object(sys, "argv", [meta_script.__file__, "--dry-run"]),
            redirect_stdout(io.StringIO()),
        ):
            meta_script.main()

        get_client.assert_not_called()
        migrate_meta.assert_called_once_with(None, "tzuyang", dry_run=True)

    def test_sdk_import_is_lazy_and_follows_configuration_admission(self) -> None:
        cases = (
            (SCRIPT_PATHS[0], "get_supabase_client"),
            (SCRIPT_PATHS[1], "get_supabase_client"),
            (EVALUATION_INSERT_SCRIPT, "main"),
        )
        for script_path, guarded_function_name in cases:
            with self.subTest(script=script_path.name):
                tree = ast.parse(script_path.read_text(encoding="utf-8"))
                top_level_supabase_imports = [
                    node
                    for node in tree.body
                    if isinstance(node, ast.ImportFrom) and node.module == "supabase"
                ]
                self.assertEqual([], top_level_supabase_imports)
                guarded = next(
                    node
                    for node in tree.body
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name == guarded_function_name
                )
                calls = [
                    node
                    for node in ast.walk(guarded)
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                ]
                resolver_line = next(
                    node.lineno
                    for node in calls
                    if node.func.id == "resolve_privileged_supabase_rest_credentials"
                )
                sdk_loader_line = next(
                    node.lineno
                    for node in calls
                    if node.func.id == "_load_supabase_runtime"
                )
                self.assertLess(resolver_line, sdk_loader_line)


if __name__ == "__main__":
    unittest.main()
