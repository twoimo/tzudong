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
        ["storage_buckets", "ad-banner-images", "ad-banner-images", True, 52428800, ["image/*", "video/*"]],
        ["storage_buckets", "avatars", "avatars", True, 52428800, ["image/*"]],
        ["storage_buckets", "profile-avatars", "profile-avatars", True, 2097152, ["image/*"]],
        ["storage_buckets", "review-photos", "review-photos", True, 5242880, ["image/*"]],
        ["storage_buckets", "youtube-thumbnail-releases", "youtube-thumbnail-releases", False, 10485760, ["image/png"]],
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
        ["storage_policies", "storage", "objects", "tzudong_ad_banner_delete_admin", "DELETE", ["authenticated"], "ad-banner-images user_roles user_account_status active foldername uid()", None],
        ["storage_policies", "storage", "objects", "tzudong_ad_banner_insert_admin", "INSERT", ["authenticated"], None, "ad-banner-images user_roles user_account_status active foldername uid()"],
        ["storage_policies", "storage", "objects", "tzudong_ad_banner_update_admin", "UPDATE", ["authenticated"], "ad-banner-images user_roles user_account_status active foldername uid()", "ad-banner-images user_roles user_account_status active foldername uid()"],
        ["storage_policies", "storage", "objects", "tzudong_profile_avatar_delete_own", "DELETE", ["authenticated"], "profile-avatars foldername uid()", None],
        ["storage_policies", "storage", "objects", "tzudong_profile_avatar_insert_own", "INSERT", ["authenticated"], None, "profile-avatars foldername uid()"],
        ["storage_policies", "storage", "objects", "tzudong_profile_avatar_update_own", "UPDATE", ["authenticated"], "profile-avatars foldername uid()", "profile-avatars foldername uid()"],
        ["storage_policies", "storage", "objects", "tzudong_public_media_read", "SELECT", ["anon", "authenticated"], "ad-banner-images profile-avatars review-photos", None],
        ["storage_policies", "storage", "objects", "tzudong_review_photo_delete_own", "DELETE", ["authenticated"], "review-photos foldername uid()", None],
        ["storage_policies", "storage", "objects", "tzudong_review_photo_insert_own", "INSERT", ["authenticated"], None, "review-photos foldername uid()"],
        ["storage_policies", "storage", "objects", "tzudong_review_photo_update_own", "UPDATE", ["authenticated"], "review-photos foldername uid()", "review-photos foldername uid()"],
        ["realtime_membership", "supabase_realtime", "public", "notifications"],
        ["realtime_membership", "supabase_realtime", "public", "profiles"],
        ["realtime_membership", "supabase_realtime", "public", "review_likes"],
        ["realtime_membership", "supabase_realtime", "public", "reviews"],
        ["public_read_function_grants", "is_current_user_active_admin()", "anon", False],
        ["public_read_function_grants", "is_current_user_active_admin()", "authenticated", True],
        ["public_read_function_grants", "is_current_user_active_admin()", "privacy_workflow_owner", True],
        ["public_read_function_grants", "is_current_user_active_admin()", "service_role", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "anon", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "authenticated", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "privacy_workflow_owner", True],
        ["public_read_function_grants", "is_user_admin(uuid)", "service_role", False],
        ["public_read_table_grants", "ad_banners", "anon", True, False, False, False],
        ["public_read_table_grants", "ad_banners", "authenticated", True, True, True, True],
        ["public_read_table_grants", "ad_banners", "service_role", True, True, True, True],
        ["public_read_table_grants", "announcements", "anon", True, False, False, False],
        ["public_read_table_grants", "announcements", "authenticated", True, True, True, True],
        ["public_read_table_grants", "announcements", "service_role", True, True, True, True],
        ["public_read_policies", "ad_banners", "tzudong_ad_banners_delete_admin", "DELETE", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", None],
        ["public_read_policies", "ad_banners", "tzudong_ad_banners_insert_admin", "INSERT", ["authenticated"], None, "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)"],
        ["public_read_policies", "ad_banners", "tzudong_ad_banners_select_active", "SELECT", ["anon", "authenticated"], "(is_active = true)", None],
        ["public_read_policies", "ad_banners", "tzudong_ad_banners_select_admin", "SELECT", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", None],
        ["public_read_policies", "ad_banners", "tzudong_ad_banners_update_admin", "UPDATE", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)"],
        ["public_read_policies", "announcements", "tzudong_announcements_delete_admin", "DELETE", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", None],
        ["public_read_policies", "announcements", "tzudong_announcements_insert_admin", "INSERT", ["authenticated"], None, "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)"],
        ["public_read_policies", "announcements", "tzudong_announcements_select_active", "SELECT", ["anon", "authenticated"], "(is_active = true)", None],
        ["public_read_policies", "announcements", "tzudong_announcements_select_admin", "SELECT", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", None],
        ["public_read_policies", "announcements", "tzudong_announcements_update_admin", "UPDATE", ["authenticated"], "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)", "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)"],
        ["caller_bound_admin_policies", "restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_insert", "INSERT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_select", "SELECT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_update", "UPDATE", ["authenticated"], 2, 0, 0],
        ["caller_bound_admin_policies", "restaurant_refresh_runs", "restaurant_refresh_runs_admin_insert", "INSERT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_refresh_runs", "restaurant_refresh_runs_admin_select", "SELECT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_refresh_runs", "restaurant_refresh_runs_admin_update", "UPDATE", ["authenticated"], 2, 0, 0],
        ["caller_bound_admin_policies", "restaurant_request_review_audit", "Admins can view request review audit", "SELECT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_requests", "Admins can update requests", "UPDATE", ["authenticated"], 2, 0, 0],
        ["caller_bound_admin_policies", "restaurant_requests", "Admins can view all requests", "SELECT", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_requests", "Restaurant requests select policy", "SELECT", ["authenticated"], 1, 1, 0],
        ["caller_bound_admin_policies", "restaurant_submission_items", "Admins can delete submission items", "DELETE", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_submission_items", "Admins can update submission items", "UPDATE", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_submission_items", "Submission items insert policy", "INSERT", ["authenticated"], 1, 1, 0],
        ["caller_bound_admin_policies", "restaurant_submission_items", "Submission items select policy", "SELECT", ["authenticated"], 1, 1, 0],
        ["caller_bound_admin_policies", "restaurant_submissions", "Admins can update all submissions", "UPDATE", ["authenticated"], 1, 0, 0],
        ["caller_bound_admin_policies", "restaurant_submissions", "Restaurant submissions select policy", "SELECT", ["authenticated"], 1, 1, 0],
        ["caller_bound_admin_policies", "restaurants", "restaurants_authenticated_admin_update", "UPDATE", ["authenticated"], 2, 0, 0],
        ["caller_bound_admin_policies", "short_urls", "Admins can delete short URLs", "DELETE", ["authenticated"], 1, 0, 0],
        ["admin_data_rpcs", "public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)", "uuid", "privacy_workflow_owner", True, "volatile", ['search_path=""'], True, False, False, True],
        ["admin_data_rpcs", "public.read_admin_user_audit_events(integer)", "TABLE(id uuid, actor_user_id uuid, target_user_id uuid, action text, reason text, status text, correlation_id uuid, applied_at timestamp with time zone, error_code text, created_at timestamp with time zone, audit_counts jsonb, audit_flags jsonb)", "privacy_workflow_owner", True, "stable", ['search_path=""'], True, False, False, True],
        ["admin_data_rpcs", "public.read_admin_user_ids_for_management()", "TABLE(user_id uuid)", "privacy_workflow_owner", True, "stable", ['search_path=""'], True, False, False, True],
        ["admin_data_rpcs", "public.read_admin_user_management_metadata(uuid[])", "TABLE(user_id uuid, username text, nickname text, avatar_url text, profile_role text, profile_created_at timestamp with time zone, profile_updated_at timestamp with time zone, is_admin boolean, account_status text)", "privacy_workflow_owner", True, "stable", ['search_path=""'], True, False, False, True],
        ["admin_data_table_grants", "admin_audit_events", False, False, False, False],
        ["admin_data_table_grants", "profiles", False, False, False, False],
        ["admin_data_table_grants", "user_account_status", False, False, False, False],
        ["admin_data_table_grants", "user_roles", False, False, False, False],
        ["admin_map_overlay_rpc", "public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,text,text,text,uuid,text,jsonb)", "jsonb", "privacy_workflow_owner", True, "volatile", ['search_path=""'], True, False, False, True, True, False, False, False, True],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlay_audit_events", "anon", False, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlay_audit_events", "authenticated", False, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlay_audit_events", "privacy_workflow_owner", True, True, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlay_audit_events", "service_role", False, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlays", "anon", False, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlays", "authenticated", False, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlays", "privacy_workflow_owner", True, True, True, False, False, False, False],
        ["admin_map_overlay_table_grants", "admin_restaurant_map_overlays", "service_role", True, False, False, False, False, False, False],
        ["admin_map_overlay_table_grants", "restaurants", "privacy_workflow_owner", True, False, False, False, False, False, False],
        ["admin_map_overlay_policies", "admin_restaurant_map_overlay_audit_events", "tzudong_admin_map_overlay_audit_owner_insert", "INSERT", ["privacy_workflow_owner"], None, "true"],
        ["admin_map_overlay_policies", "admin_restaurant_map_overlay_audit_events", "tzudong_admin_map_overlay_audit_owner_select", "SELECT", ["privacy_workflow_owner"], "true", None],
        ["admin_map_overlay_policies", "admin_restaurant_map_overlays", "tzudong_admin_map_overlays_owner_insert", "INSERT", ["privacy_workflow_owner"], None, "true"],
        ["admin_map_overlay_policies", "admin_restaurant_map_overlays", "tzudong_admin_map_overlays_owner_select", "SELECT", ["privacy_workflow_owner"], "true", None],
        ["admin_map_overlay_policies", "admin_restaurant_map_overlays", "tzudong_admin_map_overlays_owner_update", "UPDATE", ["privacy_workflow_owner"], "true", "true"],
        ["auth_users", "nightly-ci", "nightly-ci@local.invalid", "authenticated", "authenticated", True],
        ["auth_identities", "nightly-ci", "email", "nightly-ci@local.invalid"],
        ["profiles", "nightly-ci", "nightly-ci", "Nightly CI", "user", "nightly-ci@local.invalid", "2026-01-01T00:00:00Z"],
        ["user_roles", "nightly-ci", "admin"],
        ["user_account_status", "nightly-ci", "active", True],
        [
            "privacy_policy_fixture",
            "local-nightly-policy",
            "2026-08-04.1",
            "ko-KR",
            "published",
            "6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1",
            True,
        ],
        [
            "privacy_age_profile",
            "nightly-ci",
            "age_14_plus",
            "self_attestation",
            "eligible",
            "2026-08-04.1",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        ],
        [
            "youtube_channel_snapshot",
            "local-nightly-channel-snapshot",
            "local-nightly-channel",
            "[LOCAL TEST] Nightly channel fixture",
            "@local-nightly",
            1000,
            100000,
            100,
            False,
            True,
            0,
            0,
            0,
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1",
        ],
        ["restaurants", "00000000-0000-4000-8000-000000000101", "nightly-trace-1", "정원분식", "approved", ["분식"], "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
        ["restaurants", "00000000-0000-4000-8000-000000000102", "nightly-trace-2", "명동칼국수", "approved", ["한식"], "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"],
        ["announcements", "00000000-0000-4000-8000-000000000201", "Local nightly fixture", "Deterministic local regression announcement.", True, True, 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
        ["seed_buckets", "ad-banner-images", "ad-banner-images", True],
        ["seed_buckets", "avatars", "avatars", True],
        ["seed_buckets", "profile-avatars", "profile-avatars", True],
        ["seed_buckets", "review-photos", "review-photos", True],
        ["seed_buckets", "youtube-thumbnail-releases", "youtube-thumbnail-releases", False],
        ["seed_realtime", "supabase_realtime", "public", "notifications"],
        ["seed_realtime", "supabase_realtime", "public", "profiles"],
        ["seed_realtime", "supabase_realtime", "public", "review_likes"],
        ["seed_realtime", "supabase_realtime", "public", "reviews"],
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
        for line in serialized.splitlines():
            parsed = json.loads(line)
            self.assertEqual(
                line,
                json.dumps(
                    parsed,
                    ensure_ascii=True,
                    separators=(",", ":"),
                ).encode("ascii"),
            )
        self.assertEqual(serialized, local_migrate.serialize_receipt_v1(serialized))

    def test_receipt_v1_rejects_missing_sections_and_order_drift(self) -> None:
        missing = _receipt_rows()[1:]
        with self.assertRaises(local_migrate.LocalMigrationError) as missing_error:
            local_migrate.parse_readback(_receipt_ndjson(missing))
        self.assertEqual(missing_error.exception.code, "receipt_section_missing")

        with self.assertRaises(local_migrate.LocalMigrationError) as order_error:
            local_migrate.parse_readback(_receipt_ndjson(_receipt_rows(include_order_drift=True)))
        self.assertEqual(order_error.exception.code, "receipt_row_order")

    def test_public_read_contract_rejects_grant_and_policy_drift(self) -> None:
        cases = (
            (
                "public_read_function_grants",
                "is_user_admin(uuid)",
                3,
                True,
                "receipt_public_read_function_grants",
            ),
            (
                "public_read_table_grants",
                "ad_banners",
                4,
                True,
                "receipt_public_read_table_grants",
            ),
            (
                "public_read_policies",
                "tzudong_announcements_select_active",
                5,
                "is_active OR is_user_admin(arbitrary_uuid)",
                "receipt_public_read_policies",
            ),
        )
        for section, identity, field, replacement, expected_code in cases:
            rows = _receipt_rows()
            target = next(
                row for row in rows
                if row[0] == section and identity in row[1:3]
            )
            target[field] = replacement
            with self.subTest(section=section, identity=identity):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, expected_code)

    def test_admin_boundary_receipt_rejects_policy_rpc_and_table_grant_drift(self) -> None:
        cases = (
            (
                "caller_bound_admin_policies",
                "Restaurant requests select policy",
                7,
                1,
                "receipt_caller_bound_admin_policies",
            ),
            (
                "admin_data_rpcs",
                "public.read_admin_user_ids_for_management()",
                7,
                False,
                "receipt_admin_data_rpcs",
            ),
            (
                "admin_data_table_grants",
                "profiles",
                2,
                True,
                "receipt_admin_data_table_grants",
            ),
        )
        for section, identity, field, replacement, expected_code in cases:
            rows = _receipt_rows()
            target = next(
                row for row in rows
                if row[0] == section and identity in row[1:3]
            )
            target[field] = replacement
            with self.subTest(section=section, identity=identity):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, expected_code)

    def test_admin_map_overlay_receipt_rejects_rpc_grant_and_policy_drift(self) -> None:
        cases = (
            (
                "admin_map_overlay_rpc",
                "public.apply_admin_restaurant_map_overlay_action",
                13,
                True,
                "receipt_admin_map_overlay_rpc",
            ),
            (
                "admin_map_overlay_table_grants",
                "service_role",
                4,
                True,
                "receipt_admin_map_overlay_table_grants",
            ),
            (
                "admin_map_overlay_policies",
                "tzudong_admin_map_overlays_owner_update",
                6,
                "false",
                "receipt_admin_map_overlay_policies",
            ),
        )
        for section, identity, field, replacement, expected_code in cases:
            rows = _receipt_rows()
            target = next(
                row for row in rows
                if row[0] == section and any(
                    isinstance(value, str) and identity in value
                    for value in row[1:3]
                )
            )
            target[field] = replacement
            with self.subTest(section=section, identity=identity):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, expected_code)

    def test_manifest_contains_exactly_seventy_six_immutable_units(self) -> None:
        manifest = local_migrate.build_manifest()
        self.assertEqual(local_migrate.EXPECTED_LEDGER_UNITS, 76)
        self.assertEqual(len(manifest["source"]["files"]), 76)
        self.assertEqual(
            manifest["source"]["files"][-1]["path"],
            "backend/supabase/migrations/20260812000700_local_profile_leaderboard_page_convergence.sql",
        )
        self.assertEqual(
            manifest["source"]["files"][-1]["transaction"]["class"],
            "self_committing",
        )

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
                index = next(
                    index
                    for index, item in enumerate(rows)
                    if item[0] == "seed_realtime" and item[3] > row[3]
                )
                rows.insert(index, row)
            with self.subTest(section=section):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, code)

    def test_seed_invariants_reject_privacy_fixture_drift_and_provenance_loss(self) -> None:
        cases = (
            ("privacy_policy_fixture", 4, "draft", "receipt_privacy_policy_fixture"),
            ("privacy_policy_fixture", 5, "0" * 64, "receipt_privacy_policy_fixture"),
            (
                "privacy_policy_fixture",
                8,
                "hosted-approval",
                "receipt_privacy_policy_fixture",
            ),
            ("privacy_age_profile", 2, "under_14", "receipt_privacy_age_profile"),
            ("privacy_age_profile", 4, "blocked", "receipt_privacy_age_profile"),
            ("privacy_age_profile", 5, "2026-01-01.1", "receipt_privacy_age_profile"),
        )
        for section, field, replacement, expected_code in cases:
            rows = _receipt_rows()
            target = next(row for row in rows if row[0] == section)
            target[field] = replacement
            with self.subTest(section=section, field=field):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, expected_code)

    def test_seed_invariants_reject_youtube_snapshot_provenance_drift(self) -> None:
        for field, replacement in (
            (2, "hosted-channel"),
            (3, "Tzuyang"),
            (15, "youtube-data-api"),
        ):
            rows = _receipt_rows()
            target = next(row for row in rows if row[0] == "youtube_channel_snapshot")
            target[field] = replacement
            with self.subTest(field=field):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(
                    error.exception.code,
                    "receipt_youtube_channel_snapshot",
                )

    def test_seed_invariants_reject_weakened_storage_policy_contracts(self) -> None:
        for field, replacement in ((4, "SELECT"), (5, ["public"]), (7, "bucket only")):
            rows = _receipt_rows()
            policy = next(
                row for row in rows
                if row[0] == "storage_policies" and row[3] == "tzudong_profile_avatar_insert_own"
            )
            policy[field] = replacement
            with self.subTest(field=field):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate.parse_readback(_receipt_ndjson(rows))
                self.assertEqual(error.exception.code, "receipt_storage_policy_fixture")

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
        login_source = inspect.getsource(local_migrate._auth_api_login_existing)
        self.assertNotIn("INSERT INTO auth.users", source)
        self.assertNotIn("INSERT INTO auth.identities", source)
        self.assertNotIn("CREATE POLICY", source)
        self.assertNotIn("CREATE PUBLICATION", source)
        self.assertIn("nightly_user_id", source)
        self.assertIn("AUTH_API_CREATE_PATH", api_source)
        self.assertIn("AUTH_API_LOGIN_PATH", login_source)
        self.assertIn("NIGHTLY_PASSWORD_ENV", seed_branch)
        self.assertIn("SERVICE_ROLE_KEY", api_source)
        self.assertIn("ANON_KEY", login_source)
        self.assertIn("_existing_auth_api_user_id", seed_branch)
        self.assertIn("_auth_api_ledger_reseed_sql", seed_branch)
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

    def test_repeat_seed_reuses_only_an_exact_applied_auth_api_receipt(self) -> None:
        class Executor:
            def __init__(self, row: str) -> None:
                self.row = row

            def capture(self, _sql: bytes) -> bytes:
                return (self.row + "\n").encode("utf-8") if self.row else b""

        user_id = "00000000-0000-4000-8000-000000000099"
        exact = "|".join((
            "nightly-ci",
            "nightly-ci@local.invalid",
            user_id,
            "2xx",
            "none",
            "2xx",
            "none",
            "applied",
        ))
        self.assertEqual(
            local_migrate._existing_auth_api_user_id(Executor(exact)),
            user_id,
        )
        self.assertIsNone(local_migrate._existing_auth_api_user_id(Executor("")))
        for drifted in (
            exact.replace("|applied", "|running"),
            exact.replace("|none|2xx", "|provider_error|2xx"),
            exact.replace(user_id, "not-a-uuid"),
        ):
            with self.subTest(drifted=drifted):
                with self.assertRaises(local_migrate.LocalMigrationError) as error:
                    local_migrate._existing_auth_api_user_id(Executor(drifted))
                self.assertEqual(error.exception.code, "auth_receipt_ledger")

        reseed_sql = local_migrate._auth_api_ledger_reseed_sql(user_id).decode("utf-8")
        self.assertIn("status='applied'", reseed_sql)
        self.assertIn("SET status='running'", reseed_sql)
        self.assertNotIn("create_status=EXCLUDED", reseed_sql)


if __name__ == "__main__":
    unittest.main()
