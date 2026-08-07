from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.supabase_rest import (
    SUPABASE_REST_CONFIGURATION_ERROR,
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
)


VALID_URL = "https://abcdefghijklmnopqrst.supabase.co"
VALID_SERVICE_ROLE_KEY = "sb_" + "secret_service_role_key_for_tests_only"
PUBLIC_URL = "https://public-project.example.invalid"
PUBLIC_KEY = "sb_publishable_public_key_for_tests_only"
INVALID_PRIVATE_SERVICE_ROLE_KEY = "sb_" + "secret_private_value_that_must_not_appear\n"
CONFIGURATION_DIAGNOSTIC = "❌ Supabase REST configuration invalid."
MIGRATION_SCRIPTS = (
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "migrate-embeddings-to-supabase.py",
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "migrate-restaurants-to-supabase.py",
)
RUNNER_PATH = BACKEND_ROOT / "storyboard-agent" / "scripts" / "run-storyboard-agent.py"
PUBLIC_SUPABASE_ALIASES = (
    "PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
)


def _main_function(source: str) -> ast.FunctionDef:
    module = ast.parse(source)
    return next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "main"
    )


def _is_resolver_call(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "resolve_privileged_supabase_rest_credentials"
        and not node.args
        and not node.keywords
    )


def _is_canonical_create_client_call(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "create_client"
        and len(node.args) == 2
        and all(isinstance(argument, ast.Attribute) for argument in node.args)
        and isinstance(node.args[0].value, ast.Name)
        and node.args[0].value.id == "credentials"
        and node.args[0].attr == "url"
        and isinstance(node.args[1].value, ast.Name)
        and node.args[1].value.id == "credentials"
        and node.args[1].attr == "service_role_key"
    )


class StoryboardMigrationSupabaseTrustTests(unittest.TestCase):
    def test_public_only_credentials_fail_before_migration_client_creation(self) -> None:
        with self.assertRaises(SupabaseRestConfigurationError) as raised:
            resolve_privileged_supabase_rest_credentials(
                {
                    "PUBLIC_SUPABASE_URL": PUBLIC_URL,
                    "SUPABASE_ANON_KEY": PUBLIC_KEY,
                }
            )

        diagnostic = str(raised.exception)
        self.assertEqual(SUPABASE_REST_CONFIGURATION_ERROR, diagnostic)
        self.assertNotIn(PUBLIC_URL, diagnostic)
        self.assertNotIn(PUBLIC_KEY, diagnostic)

        for script_path in MIGRATION_SCRIPTS:
            source = script_path.read_text(encoding="utf-8")
            main = _main_function(source)
            resolver_guard = next(
                node
                for node in main.body
                if isinstance(node, ast.Try)
                and any(_is_resolver_call(call) for call in ast.walk(node))
            )
            create_client_call = next(
                node
                for node in ast.walk(main)
                if _is_canonical_create_client_call(node)
            )

            with self.subTest(script=script_path.name):
                self.assertLess(resolver_guard.lineno, create_client_call.lineno)

    def test_configuration_errors_do_not_disclose_dedicated_credentials(self) -> None:
        with self.assertRaises(SupabaseRestConfigurationError) as raised:
            resolve_privileged_supabase_rest_credentials(
                {
                    "SUPABASE_URL": VALID_URL,
                    "SUPABASE_SERVICE_ROLE_KEY": INVALID_PRIVATE_SERVICE_ROLE_KEY,
                }
            )

        diagnostic = str(raised.exception)
        self.assertEqual(SUPABASE_REST_CONFIGURATION_ERROR, diagnostic)
        self.assertNotIn(VALID_URL, diagnostic)
        self.assertNotIn(INVALID_PRIVATE_SERVICE_ROLE_KEY.strip(), diagnostic)
    def test_dedicated_credentials_are_used_by_each_migration_client(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(
            {
                "SUPABASE_URL": f"{VALID_URL}/",
                "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
                "PUBLIC_SUPABASE_URL": PUBLIC_URL,
                "SUPABASE_ANON_KEY": PUBLIC_KEY,
            }
        )
        self.assertEqual(VALID_URL, credentials.url)
        self.assertEqual(VALID_SERVICE_ROLE_KEY, credentials.service_role_key)

        for script_path in MIGRATION_SCRIPTS:
            source = script_path.read_text(encoding="utf-8")
            main = _main_function(source)
            resolver_guard = next(
                node
                for node in main.body
                if isinstance(node, ast.Try)
                and any(_is_resolver_call(call) for call in ast.walk(node))
            )
            handler = next(
                handler
                for handler in resolver_guard.handlers
                if isinstance(handler.type, ast.Name)
                and handler.type.id == "SupabaseRestConfigurationError"
            )
            diagnostics = [
                call.args[0].value
                for call in ast.walk(handler)
                if isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == "print"
                and call.args
                and isinstance(call.args[0], ast.Constant)
                and isinstance(call.args[0].value, str)
            ]

            with self.subTest(script=script_path.name):
                self.assertTrue(any(isinstance(node, ast.Return) for node in handler.body))
                self.assertEqual([CONFIGURATION_DIAGNOSTIC], diagnostics)
                self.assertNotIn("credentials.url", ast.get_source_segment(source, handler) or "")
                self.assertNotIn("credentials.service_role_key", ast.get_source_segment(source, handler) or "")
                self.assertTrue(
                    any(
                        _is_canonical_create_client_call(node)
                        for node in ast.walk(main)
                    )
                )
                for alias in PUBLIC_SUPABASE_ALIASES:
                    self.assertNotIn(alias, source)

    def test_privileged_imports_use_the_fixed_local_backend_root(self) -> None:
        for source_path in (*MIGRATION_SCRIPTS, RUNNER_PATH):
            source = source_path.read_text(encoding="utf-8")

            with self.subTest(script=source_path.name):
                self.assertIn(
                    "CANONICAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]",
                    source,
                )
                self.assertIn(
                    "sys.path.remove(str(CANONICAL_BACKEND_ROOT))",
                    source,
                )
                self.assertIn(
                    "sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))",
                    source,
                )

        for source_path in MIGRATION_SCRIPTS:
            self.assertIn(
                "from utils.supabase_rest import (",
                source_path.read_text(encoding="utf-8"),
            )
    def test_runner_never_promotes_public_supabase_variables(self) -> None:
        source = RUNNER_PATH.read_text(encoding="utf-8")
        module = ast.parse(source)
        aliases = next(
            node
            for node in module.body
            if isinstance(node, ast.FunctionDef) and node.name == "apply_safe_env_aliases"
        )
        assigned_environment_keys = {
            target.slice.value
            for node in ast.walk(aliases)
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Subscript)
            and isinstance(target.value, ast.Attribute)
            and isinstance(target.value.value, ast.Name)
            and target.value.value.id == "os"
            and target.value.attr == "environ"
            and isinstance(target.slice, ast.Constant)
            and isinstance(target.slice.value, str)
        }

        self.assertEqual({"OPENAI_API_KEY"}, assigned_environment_keys)
        for alias in PUBLIC_SUPABASE_ALIASES:
            self.assertNotIn(alias, source)


if __name__ == "__main__":
    unittest.main()
