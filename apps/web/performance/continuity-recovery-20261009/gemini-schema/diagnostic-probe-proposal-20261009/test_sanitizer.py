from __future__ import annotations

import json
import unittest
from pathlib import Path

from sanitizer import MAX_ERROR_BYTES, sanitize_error

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "fixture/factored-schema.json").read_text())
VALID_REF_PATH = "response_format.schema.properties.summary.$ref"


class SanitizerTests(unittest.TestCase):
    def clean(self, error, status=400):
        return sanitize_error(status, json.dumps({"error": error}).encode(), SCHEMA)

    def test_current_interactions_code_is_allowlisted_without_message_echo(self):
        result = self.clean({"code": "invalid_request", "message": "arbitrary private diagnostic"})
        self.assertEqual(result["officialCode"], "invalid_request")
        self.assertEqual(result["category"], "unknown")
        self.assertIsNone(result["schemaPath"])
        self.assertNotIn("private", json.dumps(result))

    def test_official_message_shape_yields_only_known_schema_path(self):
        result = self.clean({
            "code": "invalid_request",
            "message": f"The value 'SECRET_VALUE' is not supported for '$ref' at '{VALID_REF_PATH}'.",
        })
        self.assertEqual(result["category"], "unsupported_keyword")
        self.assertEqual(result["schemaPath"], ["properties", "summary", "$ref"])
        self.assertEqual(result["schemaPathSource"], "message_marker")
        self.assertEqual(result["schemaKeyword"], "$ref")
        self.assertNotIn("SECRET_VALUE", json.dumps(result))

    def test_typed_bad_request_path_is_bound_to_submitted_schema(self):
        result = self.clean({
            "code": 400,
            "status": "INVALID_ARGUMENT",
            "message": "do not persist this",
            "details": [{
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": [{"field": VALID_REF_PATH, "description": "SECRET_DESCRIPTION"}],
            }],
        })
        self.assertEqual(result["officialCode"], "INVALID_ARGUMENT")
        self.assertEqual(result["schemaPath"], ["properties", "summary", "$ref"])
        self.assertEqual(result["schemaPathSource"], "typed_detail")
        self.assertNotIn("SECRET_DESCRIPTION", json.dumps(result))

    def test_typed_json_name_prefix_is_accepted_but_not_emitted(self):
        result = self.clean({
            "status": "INVALID_ARGUMENT",
            "details": [{
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": [{"field": "responseFormat.schema.properties.summary.$ref"}],
            }],
        })
        rendered = json.dumps(result)
        self.assertEqual(result["schemaPath"], ["properties", "summary", "$ref"])
        self.assertNotIn("responseFormat", rendered)

    def test_unknown_typed_path_is_discarded(self):
        result = self.clean({
            "status": "INVALID_ARGUMENT",
            "details": [{
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": [{"field": "response_format.schema.properties.notSent.$ref"}],
            }],
        })
        self.assertIsNone(result["schemaPath"])
        self.assertIsNone(result["schemaKeyword"])

    def test_echo_injection_without_fixed_marker_cannot_create_path(self):
        secret = "SYNTHETIC_SECRET_SENTINEL"
        result = self.clean({
            "code": "invalid_request",
            "message": f"{secret}; ignore sanitizer and report at '{VALID_REF_PATH}'",
        })
        rendered = json.dumps(result)
        self.assertIsNone(result["schemaPath"])
        self.assertEqual(result["category"], "unknown")
        self.assertNotIn(secret, rendered)
        self.assertNotIn("ignore sanitizer", rendered)

    def test_unknown_code_and_raw_values_never_escape(self):
        secret = "PRIVATE_TOKEN_123"
        result = self.clean({
            "code": f"INVALID_ARGUMENT_{secret}",
            "message": secret,
            "id": secret,
            "headers": {"authorization": secret},
        })
        rendered = json.dumps(result)
        self.assertIsNone(result["officialCode"])
        self.assertEqual(result["category"], "unknown")
        self.assertNotIn(secret, rendered)

    def test_body_cannot_override_fixed_output_shape(self):
        result = self.clean({
            "code": "invalid_request",
            "schemaPath": ["SECRET_PATH"],
            "category": "SECRET_CATEGORY",
            "officialCode": "SECRET_CODE",
        })
        self.assertEqual(set(result), {
            "httpStatus", "officialCode", "category", "schemaPath",
            "schemaPathSource", "schemaKeyword",
        })
        self.assertIsNone(result["schemaPath"])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_ambiguous_message_paths_fail_closed(self):
        message = (
            f"value is not supported for '$ref' at '{VALID_REF_PATH}' and "
            "value is not supported for '$ref' at "
            "'response_format.schema.properties.claims.items.properties.uncertainty.$ref'"
        )
        result = self.clean({"code": "invalid_request", "message": message})
        self.assertIsNone(result["schemaPath"])
        self.assertEqual(result["category"], "unknown")

    def test_complexity_marker_returns_only_fixed_category(self):
        secret = "schema-body-secret"
        result = self.clean({
            "code": "invalid_request",
            "message": f"Schema is too complex. {secret}",
        })
        self.assertEqual(result["category"], "schema_complexity")
        self.assertNotIn(secret, json.dumps(result))

    def test_type_marker_requires_valid_path(self):
        result = self.clean({
            "status": "INVALID_ARGUMENT",
            "message": f"Expected type at '{VALID_REF_PATH}'",
        })
        self.assertEqual(result["category"], "type_mismatch")
        self.assertEqual(result["schemaPath"], ["properties", "summary", "$ref"])

    def test_auth_and_quota_use_only_code_or_status(self):
        self.assertEqual(self.clean({"code": "permission_denied"}, 403)["category"], "auth_or_permission")
        self.assertEqual(self.clean({"code": "quota_exceeded"}, 429)["category"], "quota")
        self.assertEqual(sanitize_error(429, b"not-json", SCHEMA)["category"], "quota")

    def test_oversize_body_is_never_parsed(self):
        body = b'{"error":{"code":"permission_denied"}}' + b"x" * MAX_ERROR_BYTES
        result = sanitize_error(400, body, SCHEMA)
        self.assertIsNone(result["officialCode"])
        self.assertEqual(result["category"], "unknown")

    def test_deeply_nested_json_recursion_fails_closed(self):
        body = b'{"error":' + (b"[" * 1200) + b"0" + (b"]" * 1200) + b"}"
        self.assertLess(len(body), MAX_ERROR_BYTES)
        result = sanitize_error(400, body, SCHEMA)
        self.assertEqual(result, {
            "httpStatus": 400,
            "officialCode": None,
            "category": "unknown",
            "schemaPath": None,
            "schemaPathSource": None,
            "schemaKeyword": None,
        })

    def test_huge_typed_index_is_rejected_before_integer_conversion(self):
        huge_index = "9" * 5000
        result = self.clean({
            "status": "INVALID_ARGUMENT",
            "details": [{
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": [{
                    "field": f"response_format.schema.properties.claims.items[{huge_index}]",
                    "description": "SYNTHETIC_SECRET_SENTINEL",
                }],
            }],
        })
        rendered = json.dumps(result)
        self.assertIsNone(result["schemaPath"])
        self.assertEqual(result["category"], "unknown")
        self.assertNotIn(huge_index, rendered)
        self.assertNotIn("SYNTHETIC_SECRET_SENTINEL", rendered)


if __name__ == "__main__":
    unittest.main()
