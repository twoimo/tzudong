"""Source custody and bounded SQL checks for canonical index normalization."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from backend.supabase.scripts import recover_public_index_dedup_replay_prerequisites as recovery


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/recover_public_index_dedup_replay_prerequisites.py"
KEEPER = (
    b"CREATE INDEX idx_transcript_embeddings_bge_video_id "
    b"ON public.transcript_embeddings_bge USING btree (video_id);\n"
)
CANDIDATE = (
    b"CREATE INDEX idx_bge_embeddings_video_id "
    b"ON public.transcript_embeddings_bge USING btree (video_id);\n"
)
ROLES = (
    b"CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_idx\n"
    b"  ON public.user_roles (user_id, role);\n"
)
BGE_DROP = b"DROP INDEX public.idx_bge_embeddings_video_id RESTRICT;\n"
ROLES_DROP = b"DROP INDEX public.user_roles_user_id_role_idx RESTRICT;\n"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class PublicIndexDedupReplayPrerequisitesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / recovery.SOURCE_PATH).read_bytes()
        cls.roles_source = (ROOT / recovery.ROLES_SOURCE_PATH).read_bytes()

    def test_exact_source_definitions_actions_and_receipt_are_bound(self) -> None:
        sql, receipt = recovery.recover(self.source, self.roles_source)
        self.assertEqual(
            sql,
            recovery.PREFIX + BGE_DROP + ROLES_DROP + CANDIDATE + ROLES + KEEPER + b"COMMIT;\n",
        )
        self.assertEqual(sql.count(b"DROP INDEX "), 2)
        self.assertEqual(sql.count(b"CREATE INDEX "), 2)
        self.assertEqual(sql.count(b"CREATE UNIQUE INDEX "), 1)
        self.assertEqual(sql[len(recovery.PREFIX):].count(b"IF NOT EXISTS"), 1)
        self.assertEqual(receipt["schemaVersion"], 2)
        self.assertEqual(receipt["sources"], [
            {"path": recovery.SOURCE_PATH, "sha256": sha256(self.source), "byteLength": len(self.source)},
            {"path": recovery.ROLES_SOURCE_PATH, "sha256": sha256(self.roles_source), "byteLength": len(self.roles_source)},
        ])
        self.assertEqual(receipt["outputSha256"], sha256(sql))
        definitions = [
            ("public.idx_bge_embeddings_video_id", CANDIDATE, recovery.SOURCE_PATH),
            ("public.user_roles_user_id_role_idx", ROLES, recovery.ROLES_SOURCE_PATH),
            ("public.idx_transcript_embeddings_bge_video_id", KEEPER, recovery.SOURCE_PATH),
        ]
        self.assertEqual(receipt["indexes"], [{
            "name": name, "definitionSourcePath": path,
            "definitionSha256": sha256(statement), "definitionBytes": len(statement),
        } for name, statement, path in definitions])
        actions = [
            ("drop-index-restrict", "public.idx_bge_embeddings_video_id", BGE_DROP, None),
            ("drop-index-restrict", "public.user_roles_user_id_role_idx", ROLES_DROP, None),
            *[("create-source-index", name, statement, path) for name, statement, path in definitions],
        ]
        self.assertEqual(receipt["actions"], [{
            "kind": kind, "index": name, "sourcePath": path,
            "sqlSha256": sha256(statement), "sqlBytes": len(statement),
        } for kind, name, statement, path in actions])
        self.assertEqual(receipt["dataRowsCopied"], 0)
        self.assertFalse(receipt["canonicalMigrationsChanged"])
        self.assertFalse(receipt["publicExecutionGranted"])
        self.assertIn("not execution or hosted-state evidence", receipt["scope"])
        self.assertEqual(receipt["protection"]["protectedListBodySha256"], recovery.PROTECTED_LIST_BODY_SHA256)
        self.assertIn("manifest rows are not read", receipt["protection"]["verification"])

    def test_any_baseline_tamper_is_rejected(self) -> None:
        for source in (
            self.source + b"\n",
            self.source.replace(CANDIDATE, CANDIDATE.replace(b"transcript_", b"document_")),
            self.source.replace(KEEPER, KEEPER.replace(b"video_id);", b"chunk_index);")),
            self.source.replace(KEEPER, b""),
        ):
            with self.subTest(digest=sha256(source)):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_SOURCE_DRIFT$"):
                    recovery.recover(source, self.roles_source)

    def test_any_roles_source_tamper_is_rejected(self) -> None:
        for roles in (
            self.roles_source + b"\n",
            self.roles_source.replace(ROLES, ROLES.replace(b"UNIQUE ", b"")),
            self.roles_source.replace(ROLES, b""),
            self.source,
        ):
            with self.subTest(digest=sha256(roles)):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_ROLES_SOURCE_DRIFT$"):
                    recovery.recover(self.source, roles)

    def test_baseline_definition_pins_reject_wrong_duplicate_or_missing_statements(self) -> None:
        for statement in (CANDIDATE, KEEPER):
            for replacement in (
                statement.replace(b"video_id);", b"chunk_index);"),
                statement + statement,
                b"",
            ):
                source = self.source.replace(statement, replacement)
                # Updating the complete source pin alone cannot change either definition.
                with self.subTest(definition=statement, digest=sha256(source)), \
                     patch.object(recovery, "SOURCE_SHA256", sha256(source)), \
                     patch.object(recovery, "SOURCE_BYTE_LENGTH", len(source)):
                    with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_DEFINITION_DRIFT$"):
                        recovery.recover(source, self.roles_source)

    def test_roles_definition_pin_rejects_wrong_duplicate_or_missing_statement(self) -> None:
        for replacement in (
            ROLES.replace(b"user_id, role", b"role, user_id"),
            ROLES.replace(b"UNIQUE ", b""),
            ROLES + ROLES,
            b"",
        ):
            roles = self.roles_source.replace(ROLES, replacement)
            with self.subTest(digest=sha256(roles)), \
                 patch.object(recovery, "ROLES_SOURCE_SHA256", sha256(roles)), \
                 patch.object(recovery, "ROLES_SOURCE_BYTE_LENGTH", len(roles)):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_DEFINITION_DRIFT$"):
                    recovery.recover(self.source, roles)

    def test_complete_preflight_and_fixed_locks_precede_any_ddl(self) -> None:
        sql, _ = recovery.recover(self.source, self.roles_source)
        preflight, actions = sql.split(b"$public_index_dedup_replay_prerequisite$;\n", 1)
        for guard in (
            b"current_database() <> 'postgres'",
            b"current_user <> 'postgres' OR session_user <> 'postgres'",
            b"server_version_num')::integer / 10000 <> 15",
            b"transaction_read_only') <> 'off'",
            b"to_regnamespace('supabase_migrations') IS NOT NULL",
            b"PUBLIC_INDEX_DEDUP_REPLAY_KEEPER_ALREADY_PRESENT",
            b"p.proname = 'g014_catalog_protected_relations'",
            b"c.relname = 'g014_catalog_contract_manifest'",
            b"PUBLIC_INDEX_DEDUP_REPLAY_PROTECTION_SOURCE_DRIFT",
            b"PUBLIC_INDEX_DEDUP_REPLAY_PROTECTED_OBJECT",
            b"PUBLIC_INDEX_DEDUP_REPLAY_MANIFEST_METADATA_DRIFT",
            b"PUBLIC_INDEX_DEDUP_REPLAY_MANIFEST_TRIGGER_DRIFT",
            b"PUBLIC_INDEX_DEDUP_REPLAY_TARGET_COLUMN_DRIFT",
            recovery.PROTECTED_LIST_BODY_SHA256.encode(),
            recovery.APPEND_ONLY_BODY_SHA256.encode(),
            b"c.relrowsecurity AND c.relforcerowsecurity",
            b"t.tgenabled = 'O' AND t.tgtype = 27",
            b"PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_MISSING",
            b"PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_DRIFT",
            b"PUBLIC_INDEX_DEDUP_REPLAY_DEPENDENCY_DENIED",
            b"pg_constraint WHERE conindid = index_oid",
            b"refobjid = index_oid",
            b"d.refobjid = table_oid",
            b"d.refobjsubid = ANY(column_numbers)",
            b"'indisunique', false",
            b"'indrelid', table_oid",
            b"'indclass', array_to_string(operator_classes, ' ')",
            b"'indcollation', array_to_string(collations, ' ')",
            b"SET LOCAL lock_timeout = '1s'",
            b"SET LOCAL statement_timeout = '15s'",
            b"LOCK TABLE public.document_embeddings_bge, public.transcript_embeddings_bge,\n    public.user_roles IN ACCESS EXCLUSIVE MODE;",
        ):
            self.assertIn(guard, preflight)
        self.assertNotIn(b"DROP INDEX ", preflight)
        self.assertNotIn(b"CREATE INDEX ", preflight)
        self.assertNotIn(b"FROM privacy_retention.", sql)
        self.assertNotIn(b"to_regprocedure(", sql)
        self.assertNotIn(b"SET LOCAL ROLE", sql)
        self.assertTrue(actions.startswith(BGE_DROP + ROLES_DROP))
        for forbidden in (b"CASCADE", b"ALTER ", b"DELETE ", b"UPDATE ", b"INSERT ", b"GRANT ", b"REVOKE "):
            self.assertNotIn(forbidden, sql)

    def test_protected_list_pin_reconstructs_from_exact_g014_sources(self) -> None:
        source = (ROOT / recovery.PROTECTED_LIST_SOURCE_PATH).read_bytes()
        extension = (ROOT / recovery.PROTECTED_LIST_EXTENSION_PATH).read_bytes()
        self.assertEqual(sha256(source), recovery.PROTECTED_LIST_SOURCE_SHA256)
        self.assertEqual(sha256(extension), recovery.PROTECTED_LIST_EXTENSION_SHA256)
        definition = source.split(
            b"CREATE OR REPLACE FUNCTION privacy_retention.g014_catalog_protected_relations()", 1,
        )[1]
        body = definition.split(b"AS $function$", 1)[1].split(b"$function$;", 1)[0]
        anchors = re.findall(rb"\$known_anchor\$(.*?)\$known_anchor\$", extension, re.DOTALL)
        replacements = re.findall(rb"\$known_replacement\$(.*?)\$known_replacement\$", extension, re.DOTALL)
        self.assertEqual(len(anchors), 1)
        self.assertEqual(len(replacements), 1)
        self.assertEqual(body.count(anchors[0]), 1)
        final_body = body.replace(anchors[0], replacements[0], 1)
        self.assertEqual(len(final_body), recovery.PROTECTED_LIST_BODY_BYTE_LENGTH)
        self.assertEqual(sha256(final_body), recovery.PROTECTED_LIST_BODY_SHA256)
        relations = re.findall(rb"\('([^']+)', '([^']+)'\)", final_body)
        self.assertEqual(len(relations), recovery.PROTECTED_LIST_RELATION_COUNT)
        self.assertEqual(len(set(relations)), recovery.PROTECTED_LIST_RELATION_COUNT)
        for table in (b"document_embeddings_bge", b"transcript_embeddings_bge", b"user_roles"):
            self.assertNotIn((b"public", table), relations)

    def test_manifest_trigger_body_pin_matches_the_original_append_only_source(self) -> None:
        source = (ROOT / recovery.APPEND_ONLY_SOURCE_PATH).read_bytes()
        definition = source.split(
            b"CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_append_only()", 1,
        )[1]
        body = definition.split(b"AS $function$", 1)[1].split(b"$function$;", 1)[0]
        self.assertEqual(sha256(body), recovery.APPEND_ONLY_BODY_SHA256)
        self.assertIn(b"RAISE EXCEPTION", body)
        self.assertIn(b"USING ERRCODE = '55000'", body)

    def test_cli_rejects_roles_tamper_before_creating_either_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad_roles = root / "roles.sql"
            bad_roles.write_bytes(self.roles_source + b"\n")
            output, receipt = root / "recovery.sql", root / "receipt.json"
            result = subprocess.run([
                sys.executable, "-B", str(SCRIPT), "--source", str(ROOT / recovery.SOURCE_PATH),
                "--roles-source", str(bad_roles), "--output", str(output), "--receipt", str(receipt),
            ], capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_ROLES_SOURCE_DRIFT", result.stderr)
            self.assertFalse(output.exists())
            self.assertFalse(receipt.exists())

    def test_cli_requires_roles_source_and_preserves_existing_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, receipt = root / "recovery.sql", root / "receipt.json"
            command = [
                sys.executable, "-B", str(SCRIPT), "--source", str(ROOT / recovery.SOURCE_PATH),
                "--output", str(output), "--receipt", str(receipt),
            ]
            missing = subprocess.run(command, capture_output=True, timeout=5)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn(b"--roles-source", missing.stderr)
            self.assertFalse(output.exists())
            self.assertFalse(receipt.exists())
            output.write_bytes(b"retain existing SQL\n")
            receipt.write_text(json.dumps({"retain": True}))
            existing = subprocess.run(
                [*command, "--roles-source", str(ROOT / recovery.ROLES_SOURCE_PATH)],
                capture_output=True, timeout=5,
            )
            self.assertNotEqual(existing.returncode, 0)
            self.assertEqual(output.read_bytes(), b"retain existing SQL\n")
            self.assertEqual(json.loads(receipt.read_text()), {"retain": True})


if __name__ == "__main__":
    unittest.main()
