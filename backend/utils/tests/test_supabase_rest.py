from __future__ import annotations

import base64
import json
import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.supabase_rest import (
    HOSTED_REST_REJECTED,
    MAX_SERVICE_ROLE_KEY_LENGTH,
    SUPABASE_REST_CONFIGURATION_ERROR,
    HostedRestRejected,
    SupabaseRestConfigurationError,
    hosted_rest_exit_code,
    live_insert_quota,
    resolve_privileged_supabase_rest_credentials,
    rest_url_is_hosted,
)


VALID_URL = "https://abcdefghijklmnopqrst.supabase.co"
VALID_SERVICE_ROLE_KEY = "sb_" + "secret_service_role_key_for_tests_only"


def environment(**overrides: object) -> dict[str, object]:
    return {
        "SUPABASE_URL": VALID_URL,
        "SUPABASE_SERVICE_ROLE_KEY": VALID_SERVICE_ROLE_KEY,
        **overrides,
    }


def jwt_with_role(role: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode("utf-8")).decode("ascii").rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.signature"


class SupabaseRestCredentialsTests(unittest.TestCase):
    def assert_invalid(self, values: dict[str, object]) -> None:
        with self.assertRaises(SupabaseRestConfigurationError) as raised:
            resolve_privileged_supabase_rest_credentials(values)
        self.assertEqual(SUPABASE_REST_CONFIGURATION_ERROR, str(raised.exception))

    def test_accepts_canonical_production_endpoint_and_service_role_key(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(
            environment(SUPABASE_URL=f"{VALID_URL}/")
        )

        self.assertEqual(VALID_URL, credentials.url)
        self.assertEqual(VALID_SERVICE_ROLE_KEY, credentials.service_role_key)

    def test_rejects_attacker_host_suffixes(self) -> None:
        for url in (
            "https://abcdefghijklmnopqrst.supabase.co.attacker.invalid",
            "https://attacker.invalid/abcdefghijklmnopqrst.supabase.co",
            "https://abcdefghijklmnopqrst.supabase.co.evil",
        ):
            with self.subTest(url=url):
                self.assert_invalid(environment(SUPABASE_URL=url))

    def test_rejects_noncanonical_project_reference_lengths_and_case(self) -> None:
        for url in (
            "https://short.supabase.co",
            "https://abcdefghijklmnopqrstu.supabase.co",
            "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
        ):
            with self.subTest(url=url):
                self.assert_invalid(environment(SUPABASE_URL=url))

    def test_rejects_unicode_confusable_hostnames(self) -> None:
        self.assert_invalid(environment(SUPABASE_URL="https://аbcdefghijklmnopqrst.supabase.co"))


    def test_rejects_url_credentials_and_nondefault_ports(self) -> None:
        for url in (
            "https://service:role@abcdefghijklmnopqrst.supabase.co",
            "https://abcdefghijklmnopqrst.supabase.co:8443",
            "https://abcdefghijklmnopqrst.supabase.co:443",
        ):
            with self.subTest(url=url):
                self.assert_invalid(environment(SUPABASE_URL=url))

    def test_rejects_paths_queries_and_fragments(self) -> None:
        for url in (
            "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
            "https://abcdefghijklmnopqrst.supabase.co/?target=attacker",
            "https://abcdefghijklmnopqrst.supabase.co/#fragment",
        ):
            with self.subTest(url=url):
                self.assert_invalid(environment(SUPABASE_URL=url))

    def test_rejects_http_in_production_even_with_loopback_opt_in(self) -> None:
        self.assert_invalid(
            environment(
                SUPABASE_URL="http://127.0.0.1:54321",
                SUPABASE_REST_ALLOW_LOOPBACK_HTTP="1",
                NODE_ENV="production",
            )
        )

    def test_rejects_public_fallback_only_environment(self) -> None:
        self.assert_invalid(
            {
                "VITE_SUPABASE_URL": VALID_URL,
                "VITE_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_not_service_role",
                "NEXT_PUBLIC_SUPABASE_URL": VALID_URL,
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": jwt_with_role("anon"),
                "SUPABASE_ANON_KEY": jwt_with_role("anon"),
            }
        )

    def test_rejects_missing_and_blank_dedicated_credentials(self) -> None:
        self.assert_invalid({"SUPABASE_URL": VALID_URL})
        self.assert_invalid(environment(SUPABASE_URL=""))
        self.assert_invalid(environment(SUPABASE_SERVICE_ROLE_KEY="   "))


    def test_rejects_public_key_substitution(self) -> None:
        for key in ("sb_publishable_not_service_role", jwt_with_role("anon")):
            with self.subTest(key_type=key.split(".")[0]):
                self.assert_invalid(environment(SUPABASE_SERVICE_ROLE_KEY=key))

    def test_rejects_control_bearing_and_oversized_values(self) -> None:
        for case, values in (
            ("key_control", environment(SUPABASE_SERVICE_ROLE_KEY="sb_" + "secret_bad\nkey")),
            (
                "key_oversized",
                environment(SUPABASE_SERVICE_ROLE_KEY="x" * (MAX_SERVICE_ROLE_KEY_LENGTH + 1)),
            ),
            ("url_control", environment(SUPABASE_URL=f"{VALID_URL}\x00")),
        ):
            with self.subTest(case=case):
                self.assert_invalid(values)

    def test_allows_http_loopback_only_with_explicit_test_opt_in(self) -> None:
        loopback_environment = environment(
            SUPABASE_URL="http://127.0.0.1:54321/",
            SUPABASE_REST_ALLOW_LOOPBACK_HTTP="1",
            NODE_ENV="test",
        )
        credentials = resolve_privileged_supabase_rest_credentials(loopback_environment)

        self.assertEqual("http://127.0.0.1:54321", credentials.url)
        self.assert_invalid(environment(SUPABASE_URL="http://127.0.0.1:54321", NODE_ENV="test"))
        self.assert_invalid(
            environment(
                SUPABASE_URL="http://127.0.0.2:54321",
                SUPABASE_REST_ALLOW_LOOPBACK_HTTP="1",
                NODE_ENV="development",
            )
        )

    def test_rejects_hosted_rest_when_local_db(self) -> None:
        with self.assertRaises(HostedRestRejected) as raised:
            resolve_privileged_supabase_rest_credentials(environment(TZUDONG_DATA_ENV="local_db"))
        self.assertEqual(HOSTED_REST_REJECTED, str(raised.exception))

    def test_rejects_hosted_rest_when_pipeline_live(self) -> None:
        with self.assertRaises(HostedRestRejected) as raised:
            resolve_privileged_supabase_rest_credentials(environment(TZUDONG_PIPELINE_LIVE="1"))
        self.assertEqual(HOSTED_REST_REJECTED, str(raised.exception))

    def test_allows_hosted_rest_without_local_or_live_flags(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(environment())
        self.assertEqual(VALID_URL, credentials.url)

    def test_allows_loopback_rest_for_local_db(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(
            environment(
                SUPABASE_URL="http://127.0.0.1:54321/",
                SUPABASE_REST_ALLOW_LOOPBACK_HTTP="1",
                NODE_ENV="test",
                TZUDONG_DATA_ENV="local_db",
                TZUDONG_PIPELINE_LIVE="1",
            )
        )
        self.assertEqual("http://127.0.0.1:54321", credentials.url)

    def test_hosted_rest_exit_code_is_fail_closed(self) -> None:
        self.assertEqual(1, hosted_rest_exit_code({"TZUDONG_PIPELINE_LIVE": "1"}))
        self.assertEqual(1, hosted_rest_exit_code({"TZUDONG_DATA_ENV": "local_db"}))
        self.assertTrue(rest_url_is_hosted("https://aqlcofblfxdrjhhdmarw.supabase.co"))
        self.assertFalse(rest_url_is_hosted("http://127.0.0.1:54321"))

    def test_live_insert_quota_defaults_to_one(self) -> None:
        self.assertIsNone(live_insert_quota({}))
        self.assertEqual(1, live_insert_quota({"TZUDONG_PIPELINE_LIVE": "1"}))
        self.assertEqual(0, live_insert_quota({"TZUDONG_PIPELINE_LIVE": "1", "LIVE_MAX_NEW_ITEMS": "0"}))
        self.assertEqual(3, live_insert_quota({"TZUDONG_PIPELINE_LIVE": "1", "LIVE_MAX_NEW_ITEMS": "3"}))

    def test_local_override_wins_over_hosted_url(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(
            environment(
                TZUDONG_DATA_ENV="local_db",
                TZUDONG_PIPELINE_LIVE="1",
                TZUDONG_LOCAL_SUPABASE_URL="http://127.0.0.1:18000/",
                TZUDONG_LOCAL_SUPABASE_SERVICE_ROLE_KEY=VALID_SERVICE_ROLE_KEY,
            )
        )
        self.assertEqual("http://127.0.0.1:18000", credentials.url)

    def test_loopback_rest_for_local_db_without_node_env_test(self) -> None:
        credentials = resolve_privileged_supabase_rest_credentials(
            environment(
                SUPABASE_URL="http://127.0.0.1:18000/",
                TZUDONG_DATA_ENV="local_db",
            )
        )
        self.assertEqual("http://127.0.0.1:18000", credentials.url)


if __name__ == "__main__":
    unittest.main()
