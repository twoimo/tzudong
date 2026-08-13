from __future__ import annotations

import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FUNCTION_SOURCE = (
    REPOSITORY_ROOT
    / "backend/supabase/local-inputs/functions/naver-geocode/index.ts"
)
DISPATCHER_SOURCE = (
    REPOSITORY_ROOT
    / "backend/supabase/local-inputs/functions/main/index.ts"
)


class LocalNaverGeocodeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FUNCTION_SOURCE.read_text(encoding="utf-8")
        cls.dispatcher_source = DISPATCHER_SOURCE.read_text(encoding="utf-8")

    def test_local_dispatcher_allowlists_only_the_fixture_without_env_forwarding(self):
        for contract in (
            "LOCAL_TEST_ONLY:NOT_PRODUCTION",
            '["naver-geocode", "/home/deno/functions/naver-geocode"]',
            "segments[0]",
            "LOCAL_FUNCTIONS.get(functionName)",
            "EdgeRuntime.userWorkers.create",
            "memoryLimitMb: 64",
            "workerTimeoutMs: 5_000",
            "envVars: []",
            '{ error: "Local function not found" }',
            '{ error: "Local function unavailable" }',
        ):
            self.assertIn(contract, self.dispatcher_source)
        self.assertEqual(self.dispatcher_source.count("/home/deno/functions/"), 1)
        self.assertNotIn("Deno.env", self.dispatcher_source)
        self.assertNotIn("globalThis.fetch", self.dispatcher_source)
        self.assertNotRegex(self.dispatcher_source, r"(?:^|[=;(]\s*)fetch\s*\(")
        self.assertNotRegex(
            self.dispatcher_source,
            re.compile(r"console\.(?:log|error|warn)\s*\("),
        )

    def test_fixture_is_explicitly_local_only_and_never_calls_a_provider(self):
        self.assertIn("LOCAL_TEST_ONLY:NOT_PRODUCTION", self.source)
        self.assertIn(
            "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:naver-geocode-fixture-v1",
            self.source,
        )
        self.assertNotRegex(self.source, r"\bfetch\s*\(")
        self.assertNotIn("openapi.naver.com", self.source)
        self.assertNotIn("naveropenapi.apigw.ntruss.com", self.source)
        self.assertNotIn("Deno.env", self.source)

    def test_only_seeded_restaurant_coordinates_are_returnable(self):
        for value in (
            'roadAddress: "서울특별시 중구 세종대로 110"',
            'jibunAddress: "서울특별시 중구 태평로1가 31"',
            'englishAddress: "110 Sejong-daero, Jung-gu, Seoul"',
            'x: "126.978"',
            'y: "37.5665"',
            'roadAddress: "서울특별시 중구 을지로 30"',
            'jibunAddress: "서울특별시 을지로1가 50"',
            'englishAddress: "30 Eulji-ro, Jung-gu, Seoul"',
            'x: "126.97885"',
            'y: "37.56695"',
        ):
            self.assertIn(value, self.source)
        self.assertEqual(len(re.findall(r'roadAddress: "', self.source)), 2)
        self.assertEqual(len(re.findall(r'jibunAddress: "', self.source)), 2)

    def test_request_and_response_are_bounded_and_unknown_queries_return_no_match(self):
        for contract in (
            "const MAX_BODY_BYTES = 1024",
            "const MAX_QUERY_LENGTH = 200",
            'request.method !== "POST"',
            'mediaType !== "application/json"',
            "Number(count) < 1",
            "Number(count) > 3",
            "CONTROL_CHARACTERS.test(query)",
            "QUERY_FIXTURE_INDEXES.get(query) ?? []",
            "indexes.slice(0, Number(count))",
            "return jsonResponse({ addresses })",
            '"cache-control": "no-store"',
        ):
            self.assertIn(contract, self.source)
        self.assertNotRegex(self.source, re.compile(r"console\.(?:log|error|warn)\s*\("))

    def test_manifest_bound_kong_is_the_only_browser_cors_owner(self):
        self.assertIn('request.method === "OPTIONS"', self.source)
        self.assertIn("Kong route is the sole browser CORS boundary", self.source)
        self.assertIn("Deno.serve(handleNaverGeocode)", self.source)
        self.assertNotIn("access-control-allow-origin", self.source.lower())
        self.assertNotIn("access-control-allow-headers", self.source.lower())
        self.assertNotIn("access-control-allow-methods", self.source.lower())
        self.assertNotIn('"*"', self.source)


if __name__ == "__main__":
    unittest.main()
