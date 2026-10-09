"""Source contract for the post-five admin user-management RPC forward."""

import hashlib
import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
ACCEPTED = MIGRATIONS / "20260906053936_admin_management_group_catalog_slice.sql"
FORWARD = MIGRATIONS / "20261009101645_admin_user_management_rpc_forward.sql"
ACCEPTED_SHA256 = "4fea6a4912536cf1c1531b092d309f8206a7c6d28edd0558a9fceae940757b00"
FORWARD_SHA256 = "b96126240399e580ed6b7198edbd3d0af44b26ec5cab66073c037b331ec8eb26"

NAMES = (
    "read_admin_user_management_metadata",
    "read_admin_user_audit_events",
    "append_admin_user_audit_event",
)
BODY_HASHES = (
    "c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656",
    "b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e",
    "2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6",
)
POST_FIVE_BODY_HASHES = (
    "e2e2aea7a72440b151d69ceea13dab5855ba691199f74e065a2850b848004d99",
    "7132001985972c0e0fece15782ba7aac68338508f04ef3365733024a7c975cd5",
    "952f92d709f60b7f47168e0f4f6ff1b141ceae23f7cf3632db760f4ea2cd541d",
    "5fe3230899d7669896f562b5a7afa5e088761b3ecc26f531c13cf0953a569413",
    "2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1",
    "7a73f41ceaf7e8cf106e073e6f2ee791aeaafd16d8a6d2a6d11af3d1a8289304",
    "ab9c11c438e482bcdd1373ec3bb43a2abf579f535aad919a18a452930ec1912c",
    "b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1",
)


def function_definition(source: str, name: str) -> str:
    match = re.search(
        rf"CREATE FUNCTION public\.{name}\(.*?\n\$\$;",
        source,
        re.S,
    )
    if match is None:
        raise AssertionError(f"missing function {name}")
    return match.group()


class AdminUserManagementRpcForwardSourceContract(unittest.TestCase):
    def test_accepted_source_is_immutable_and_bodies_are_reused_exactly(self):
        accepted_bytes = ACCEPTED.read_bytes()
        forward_bytes = FORWARD.read_bytes()
        self.assertEqual(hashlib.sha256(accepted_bytes).hexdigest(), ACCEPTED_SHA256)
        self.assertEqual(hashlib.sha256(forward_bytes).hexdigest(), FORWARD_SHA256)

        accepted = accepted_bytes.decode()
        forward = forward_bytes.decode()
        for name in NAMES:
            self.assertEqual(function_definition(forward, name), function_definition(accepted, name))
        for body_hash in BODY_HASHES:
            self.assertIn(body_hash, forward)

    def test_forward_pins_exact_pg176_post_five_catalog_and_acl_preimage(self):
        source = FORWARD.read_text()
        self.assertIn("server_version_num')::integer <> 170006", source)
        for body_hash in POST_FIVE_BODY_HASHES:
            self.assertIn(body_hash, source)
        for body_hash in (
            "50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01",
            "b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a",
            "f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef",
            "345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d",
        ):
            self.assertIn(body_hash, source)
        self.assertIn("admin_user_forward_post_five_function_drift", source)
        self.assertIn("admin_user_forward_post_five_assertion_drift", source)
        self.assertIn("admin_user_forward_post_five_allowlist_drift", source)
        self.assertIn("admin_user_forward_post_five_cleanup_drift", source)
        self.assertEqual(source.count("FROM PUBLIC,anon,authenticated,service_role"), 4)
        self.assertEqual(source.count("TO service_role;"), 3)
        self.assertIn("member=v_runner) <> 1", source)
        self.assertIn("pg_catalog.pg_has_role(v_runner,v_owner,'USAGE')", source)
        self.assertEqual(
            source.count(
                "GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, "
                "INHERIT FALSE, SET TRUE GRANTED BY postgres;"
            ),
            4,
        )
        self.assertEqual(
            source.count("REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;"),
            4,
        )

    def test_forward_has_no_history_repair_or_transaction_control(self):
        source = FORWARD.read_text()
        self.assertNotIn("supabase_migrations.schema_migrations", source)
        self.assertNotRegex(source, r"(?im)^\s*(BEGIN|COMMIT|ROLLBACK)\s*;")
        self.assertNotIn("CREATE ROLE", source)
        self.assertNotIn("ALTER ROLE", source)
        self.assertNotIn("CREATE POLICY", source)
        self.assertNotIn("ALTER TABLE", source)
        self.assertNotIn("DELETE FROM privacy_retention.g014_public_rpc_allowlist", source)


if __name__ == "__main__":
    unittest.main()
