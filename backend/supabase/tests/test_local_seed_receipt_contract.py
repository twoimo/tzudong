import importlib.util
import inspect
import json
import sys
import tempfile
import unittest
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/local-stack.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("local_stack_receipt_contract_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local-stack.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_stack = _load_module()
MIGRATE_SCRIPT = ROOT / "backend/supabase/scripts/local-migrate.py"


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("local_migrate_receipt_contract_under_test", MIGRATE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local-migrate.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_migrate = _load_migration_module()
RECEIPT_FIELDS = (
    "action",
    "config_sha256",
    "env_provenance_sha256",
    "error_code",
    "generator_version",
    "input_provenance_sha256",
    "ok",
    "project_name",
    "renderer",
    "schema",
    "services",
)


def _write_deterministic_receipt(state: Path, action: str = "reset") -> bytes:
    local_stack._write_receipt(
        state,
        action,
        ok=True,
        project="nightly-ci",
        config_sha256="a" * 64,
        input_provenance_sha256="b" * 64,
        env_provenance_sha256="c" * 64,
        services=local_stack._service_receipts(
            [
                {"Service": "db", "State": "running", "Health": "healthy", "ID": "volatile-db-id"},
                {"Service": "auth", "State": "running", "Health": "healthy", "Names": "volatile-auth-name"},
            ]
        ),
    )
    return (state / "last-receipt.json").read_bytes()
def _receipt_rows(include_order_drift: bool = False):
    rows = [
        ["extensions", "vector", "extensions", "1.0", "postgres"],
        ["roles", "anon", False, False, False, False, []],
        ["schemas", "public", "postgres"],
        ["relations", "public", "sample", "r", "postgres"],
        ["columns", "public", "sample", 1, "id", "uuid", True, None],
        ["constraints", "public", "sample", "sample_pkey", "p", "PRIMARY KEY (id)"],
        ["indexes", "public", "sample", "sample_pkey", "CREATE UNIQUE INDEX sample_pkey"],
        ["functions", "public", "sample()", "void", False, "volatile", [], "a" * 64],
        ["policies", "public", "sample", "sample_policy", "SELECT", ["anon"], "true", None],
        ["triggers", "public", "sample", "sample_trigger", "BEFORE", ["INSERT"], "CREATE TRIGGER"],
        ["storage_buckets", "avatars", "avatars", True, 52428800, ["image/*"]],
        ["storage_policies", "storage", "objects", "local_nightly_avatar_insert", "INSERT", ["authenticated"], None, "(bucket_id = 'avatars'::text)"],
        [
            "storage_policies",
            "storage",
            "objects",
            "local_nightly_avatar_read",
            "SELECT",
            ["anon", "authenticated"],
            "(bucket_id = 'avatars'::text)",
            None,
        ],
        ["realtime_membership", "supabase_realtime", "public", "profiles"],
        ["auth_users", "nightly-ci", "nightly-ci@local.invalid", "authenticated", "authenticated", True],
        ["auth_identities", "nightly-ci", "email", "nightly-ci@local.invalid"],
        ["profiles", "nightly-ci", "nightly-ci", "Nightly CI", "user", "nightly-ci@local.invalid", "2026-01-01T00:00:00Z"],
        ["restaurants", "00000000-0000-4000-8000-000000000101", "nightly-trace-1", "정원분식", "approved", ["분식"], "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
        ["restaurants", "00000000-0000-4000-8000-000000000102", "nightly-trace-2", "명동칼국수", "approved", ["한식"], "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"],
        ["announcements", "00000000-0000-4000-8000-000000000201", "Local nightly fixture", "Deterministic local regression announcement.", True, True, 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
        ["seed_buckets", "avatars", "avatars", True],
        ["seed_realtime", "supabase_realtime", "public", "profiles"],
    ]
    if include_order_drift:
        rows.insert(5, ["columns", "public", "sample", 2, "name", "text", False, None])
        rows[4], rows[5] = rows[5], rows[4]
    return rows


def _receipt_ndjson(rows) -> bytes:
    return (
        "\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows) + "\n"
    ).encode("utf-8")


class LocalSeedReceiptContractTests(unittest.TestCase):
    def test_receipt_v1_has_fixed_fields_and_canonical_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = _write_deterministic_receipt(Path(directory))
        payload = json.loads(raw.decode("ascii"))

        self.assertEqual(payload["schema"], "local-stack-receipt-v1")
        self.assertEqual(tuple(payload), RECEIPT_FIELDS)
        self.assertEqual(list(payload), sorted(payload))
        self.assertEqual(
            raw,
            (json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"),
        )

    def test_receipt_serialization_is_nfc_compact_and_ascii(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            raw = _write_deterministic_receipt(Path(directory))
            decomposed_state = Path(directory) / "nfc"
            decomposed_project = "nightly-c\u0069\u0301"
            local_stack._write_receipt(
                decomposed_state,
                "reset",
                ok=True,
                project=decomposed_project,
                services=[],
            )
            normalized_payload = json.loads(
                (decomposed_state / "last-receipt.json").read_bytes().decode("ascii")
            )
        text = raw.decode("ascii")

        self.assertEqual(text, unicodedata.normalize("NFC", text))
        self.assertNotIn(": ", text)
        self.assertNotIn(", ", text)
        self.assertNotIn("\n", text[:-1])
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(normalized_payload["project_name"], unicodedata.normalize("NFC", decomposed_project))

    def test_logical_nightly_ci_identity_is_not_volatile_container_identity(self) -> None:
        self.assertEqual(local_stack._project_name(ROOT), local_stack._project_name(ROOT))
        self.assertRegex(local_stack._project_name(ROOT), r"^tzudong-local-[0-9a-f]{12}$")
        source = inspect.getsource(local_stack._write_receipt)
        self.assertIn('"project_name": project', source)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            local_stack._write_receipt(
                state,
                "reset",
                ok=True,
                project=local_stack._project_name(ROOT),
                services=[],
            )
            payload = json.loads((state / "last-receipt.json").read_bytes().decode("ascii"))
        self.assertEqual(payload["project_name"], local_stack._project_name(ROOT))

    def test_auth_service_receipt_is_allowlisted_and_redacted(self) -> None:
        rows = [
            {
                "Service": "auth",
                "State": "running",
                "Health": "healthy",
                "ID": "sha256:secret-container-id",
                "Names": "nightly-ci-auth-1",
                "Image": "supabase/gotrue:private-digest",
                "Command": "--db-password=do-not-persist",
            }
        ]
        services = local_stack._service_receipts(rows)
        auth = next(item for item in services if item["service"] == "auth")
        self.assertEqual(auth, {"service": "auth", "state": "running", "health": "healthy"})
        self.assertEqual([item["service"] for item in services], list(local_stack.EXPECTED_SERVICES))
        serialized = json.dumps(services, sort_keys=True)
        for secret in ("secret-container-id", "nightly-ci-auth-1", "private-digest", "do-not-persist"):
            self.assertNotIn(secret, serialized)

    def test_two_reset_receipts_are_byte_equal_for_equal_logical_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_raw = _write_deterministic_receipt(Path(first))
            second_raw = _write_deterministic_receipt(Path(second))
        self.assertEqual(first_raw, second_raw)

    def test_receipt_v1_serializes_nfc_compact_ascii_rows(self) -> None:
        raw = _receipt_ndjson(_receipt_rows())
        serialized = local_migrate.serialize_receipt_v1(raw)
        self.assertTrue(serialized.endswith(b"\n"))
        self.assertNotIn("정원분식".encode("utf-8"), serialized)
        self.assertIn(b"\\uc815\\uc6d0\\ubd84\\uc2dd", serialized)
        self.assertNotIn(b", ", serialized)
        self.assertNotIn(b": ", serialized)
        self.assertEqual(serialized, local_migrate.serialize_receipt_v1(serialized))

    def test_receipt_v1_rejects_missing_sections_and_order_drift(self) -> None:
        missing = _receipt_rows()[1:]
        with self.assertRaises(local_migrate.LocalMigrationError) as missing_error:
            local_migrate.parse_readback(_receipt_ndjson(missing))
        self.assertEqual(missing_error.exception.code, "receipt_section_missing")

        with self.assertRaises(local_migrate.LocalMigrationError) as order_error:
            local_migrate.parse_readback(_receipt_ndjson(_receipt_rows(include_order_drift=True)))
        self.assertEqual(order_error.exception.code, "receipt_row_order")

    def test_two_reset_comparator_compares_ordered_ledger_and_digests(self) -> None:
        project = local_stack._project_name(ROOT)
        ledger = [
            [
                "ledger",
                item["path"],
                item["ordinal"],
                item["sha256"],
                item["byteLength"],
                item["transaction"]["class"],
                "applied",
                local_migrate._expected_unit_evidence(item),
            ]
            for item in local_migrate.build_manifest()["source"]["files"]
        ]
        image_service_digests = {
            service: ["sha256:" + "1" * 64]
            for service in local_migrate.EXPECTED_SERVICES
        }
        stack_provenance = {
            "schema": "local-stack-provenance-v1",
            "project_name": project,
            "renderer": "v2.39.4",
            "generator_version": "local-stack-v1",
            "config_sha256": "a" * 64,
            "input_provenance_sha256": "b" * 64,
            "env_provenance_sha256": "c" * 64,
            "image_digests": ["sha256:" + "1" * 64],
            "image_service_digests": image_service_digests,
            "commit_sha256": "2" * 40,
        }
        receipt = {
            "schema": "local-receipt-v1",
            "serializer": "receipt-v1",
            "project_name": project,
            "stack_provenance": stack_provenance,
            "config_sha256": "a" * 64,
            "input_provenance_sha256": "b" * 64,
            "env_provenance_sha256": "c" * 64,
            "image_digests": ["sha256:" + "1" * 64],
            "image_service_digests": image_service_digests,
            "commit_sha256": "2" * 40,
            "ledger": ledger,
            "readback_sql_sha256": "b" * 64,
            "readback_sha256": "c" * 64,
            "catalog_sha256": "d" * 64,
            "seed_sha256": "e" * 64,
            "ledger_sha256": "f" * 64,
            "service_sha256": "0" * 64,
        }
        receipt["readback"] = _receipt_rows()
        receipt["service"] = [["service", "local", "14", "healthy"]]
        receipt.update(
            local_migrate._receipt_payload_digests(
                receipt["readback"],
                receipt["ledger"],
                receipt["service"],
                local_migrate.build_manifest(),
            )
        )
        bindings = local_migrate._current_source_bindings()
        receipt.update(bindings)
        stack_provenance.update({
            key: value
            for key, value in bindings.items()
            if key in {
                "input_source_manifest_sha256",
                "input_evidence_sha256",
                "compose_evidence_sha256",
                "function_source_sha256",
                "readback_sql_sha256",
                "environment_contract_sha256",
            }
        })
        sequence = [
            [
                "sequence",
                marker,
                ordinal,
                evidence,
                bindings["source_manifest_sha256"],
            ]
            for ordinal, (marker, evidence) in enumerate(
                (
                    ("prerequisite", bindings["prerequisite_sha256"]),
                    ("migration", bindings["source_chain_sha256"]),
                    ("closure", bindings["source_manifest_sha256"]),
                    ("platform-bootstrap", bindings["platform_bootstrap_evidence_sha256"]),
                    ("seed", bindings["seed_source_sha256"]),
                ),
                1,
            )
        ]
        receipt["sequence"] = sequence
        receipt["sequence_sha256"] = local_migrate._sha256_bytes(
            local_migrate._serialize_rows(sequence)
        )
        receipt["closure_binding_sha256"] = local_migrate._closure_binding_for_current_source(
            sequence[2][3]
        )
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "receipt-a.json"
            second = Path(directory) / "receipt-b.json"
            first.write_text(json.dumps(receipt), encoding="utf-8")
            second.write_text(json.dumps(receipt), encoding="utf-8")
            compared = local_migrate.compare_receipts(first, second)
            self.assertTrue(compared["equal"])
            self.assertIn("environment_contract_sha256", compared["comparedFields"])
            changed = dict(receipt)
            changed["seed_sha256"] = "1" * 64
            second.write_text(json.dumps(changed), encoding="utf-8")
            with self.assertRaises(local_migrate.LocalMigrationError) as mismatch:
                local_migrate.compare_receipts(first, second)
            self.assertEqual(mismatch.exception.code, "receipt_digest_mismatch")
            changed_environment = dict(receipt)
            changed_environment["environment_contract_sha256"] = "0" * 64
            changed_environment["stack_provenance"] = dict(receipt["stack_provenance"])
            changed_environment["stack_provenance"]["environment_contract_sha256"] = "0" * 64
            second.write_text(json.dumps(changed_environment), encoding="utf-8")
            with self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_manifest_mismatch"):
                local_migrate.compare_receipts(first, second)
            changed_closure = dict(receipt)
            changed_closure["closure_binding_sha256"] = "0" * 64
            second.write_text(json.dumps(changed_closure), encoding="utf-8")
            with self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_closure_binding"):
                local_migrate.compare_receipts(first, second)
            changed_readback = dict(receipt)
            changed_readback["readback_sql_sha256"] = "1" * 64
            second.write_text(json.dumps(changed_readback), encoding="utf-8")
            with self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_provenance_incomplete"):
                local_migrate.compare_receipts(first, second)
    def test_seed_invariants_reject_extra_rows_and_publication_memberships(self) -> None:
        for section, row, code in (
            (
                "announcements",
                ["announcements", "00000000-0000-4000-8000-000000000202", "extra", "extra", True, False, 0, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
                "receipt_announcement_fixture",
            ),
            (
                "seed_realtime",
                ["seed_realtime", "supabase_realtime", "public", "restaurants"],
                "receipt_realtime_fixture",
            ),
        ):
            rows = _receipt_rows()
            if section == "announcements":
                index = next(index for index, item in enumerate(rows) if item[0] == "seed_buckets")
                rows.insert(index, row)
            else:
                rows.append(row)
            with self.subTest(section=section):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, code)

    def test_auth_catalog_allowlist_rejects_extra_column(self) -> None:
        rows = [
            ["schemas", "auth", "supabase_admin"],
            *[
                ["relations", "auth", relation, "r", "supabase_admin"]
                for relation in local_migrate.AUTH_SCHEMA_COLUMN_ALLOWLIST
            ],
        ]
        for relation, columns in local_migrate.AUTH_SCHEMA_COLUMN_ALLOWLIST.items():
            for column_ordinal, column in enumerate(columns, 1):
                rows.append(["columns", "auth", relation, column_ordinal, column, "text", False, None])
        rows.append(["columns", "auth", "users", 999, "unexpected", "text", False, None])
        with self.assertRaises(local_migrate.LocalMigrationError) as error:
            local_migrate._validate_auth_catalog(rows)
        self.assertEqual(error.exception.code, "receipt_auth_columns")
    def test_error_receipt_uses_the_same_redacted_v1_shape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            payload = local_stack._error_receipt("reset", "nightly-ci", state, "renderer_version")
            raw = (state / "last-receipt.json").read_bytes()
        raw_payload = json.loads(raw.decode("ascii"))
        self.assertEqual(tuple(raw_payload), RECEIPT_FIELDS)
        self.assertEqual(raw_payload, payload)
        self.assertIsNone(payload["config_sha256"])
        self.assertEqual(payload["services"], [])
        self.assertEqual(payload["error_code"], "renderer_version")
    def test_seed_uses_loopback_gotrue_api_and_dynamic_uuid_without_receipt_exposure(self) -> None:
        source = (ROOT / "backend/supabase/scripts/local-seed.sql").read_text(encoding="utf-8")
        seed_branch = inspect.getsource(local_migrate.main)
        api_source = inspect.getsource(local_migrate._auth_api_create_and_login)
        self.assertNotIn("INSERT INTO auth.users", source)
        self.assertNotIn("INSERT INTO auth.identities", source)
        self.assertNotIn("CREATE POLICY", source)
        self.assertNotIn("CREATE PUBLICATION", source)
        self.assertIn("nightly_user_id", source)
        self.assertIn("AUTH_API_CREATE_PATH", api_source)
        self.assertIn("AUTH_API_LOGIN_PATH", api_source)
        self.assertIn("NIGHTLY_PASSWORD_ENV", seed_branch)
        self.assertIn("SERVICE_ROLE_KEY", api_source)
        self.assertIn("ANON_KEY", api_source)
        self.assertIn("auth/v1/admin/users", local_migrate.AUTH_API_CREATE_PATH)
        self.assertIn("auth/v1/token?grant_type=password", local_migrate.AUTH_API_LOGIN_PATH)
        payload = local_migrate._psql_stdin(
            b"SELECT :'nightly_user_id'::uuid;\n",
            {"nightly_user_id": "00000000-0000-4000-8000-000000000099"},
        )
        self.assertEqual(
            payload,
            b"\\set nightly_user_id 00000000-0000-4000-8000-000000000099\nSELECT :'nightly_user_id'::uuid;\n",
        )


if __name__ == "__main__":
    unittest.main()
