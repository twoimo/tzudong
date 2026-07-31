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
STORYBOARD_SUPABASE_SCRIPTS = (
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "01-bge-embed-and-store-supabase.py",
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "99-add-restaurants-to-documents.py",
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "99-openai-embed-and-store-supabase.py",
)
PROHIBITED_CREDENTIAL_ALIASES = (
    "PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE",
    "VITE_SUPABASE",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_KEY",
)
CONFIGURATION_DIAGNOSTIC = "❌ Supabase REST configuration invalid."


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


class StoryboardSupabaseTrustTests(unittest.TestCase):
    def test_public_only_credentials_are_rejected_without_disclosure(self) -> None:
        environment = {
            "PUBLIC_SUPABASE_URL": PUBLIC_URL,
            "SUPABASE_ANON_KEY": PUBLIC_KEY,
        }

        with self.assertRaises(SupabaseRestConfigurationError) as raised:
            resolve_privileged_supabase_rest_credentials(environment)

        diagnostic = str(raised.exception)
        self.assertEqual(SUPABASE_REST_CONFIGURATION_ERROR, diagnostic)
        self.assertNotIn(PUBLIC_URL, diagnostic)
        self.assertNotIn(PUBLIC_KEY, diagnostic)

    def test_scripts_fail_closed_before_canonical_client_creation(self) -> None:
        for source_path in STORYBOARD_SUPABASE_SCRIPTS:
            source = source_path.read_text(encoding="utf-8")
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

            with self.subTest(script=source_path.name):
                self.assertLess(resolver_guard.lineno, create_client_call.lineno)
                self.assertTrue(any(isinstance(node, ast.Return) for node in handler.body))
                self.assertEqual([CONFIGURATION_DIAGNOSTIC], diagnostics)
                self.assertNotIn("credentials.url", ast.get_source_segment(source, handler) or "")
                self.assertNotIn("credentials.service_role_key", ast.get_source_segment(source, handler) or "")

    def test_scripts_use_the_canonical_backend_resolver_without_fallbacks(self) -> None:
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

        for source_path in STORYBOARD_SUPABASE_SCRIPTS:
            source = source_path.read_text(encoding="utf-8")
            module = ast.parse(source)
            resolver_import = next(
                node
                for node in module.body
                if isinstance(node, ast.ImportFrom) and node.module == "utils.supabase_rest"
            )
            imported_names = {alias.name for alias in resolver_import.names}

            with self.subTest(script=source_path.name):
                self.assertIn("SupabaseRestConfigurationError", imported_names)
                self.assertIn("resolve_privileged_supabase_rest_credentials", imported_names)
                self.assertIn(
                    "CANONICAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]",
                    source,
                )
                self.assertIn("sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))", source)
                for alias in PROHIBITED_CREDENTIAL_ALIASES:
                    self.assertNotIn(alias, source)


if __name__ == "__main__":
    unittest.main()
