"""Provenance checks for the single index missing from historical reconstruction."""

import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.supabase.scripts import recover_public_index_dedup_replay_prerequisites as recovery


ROOT = Path(__file__).resolve().parents[3]
STATEMENT = (
    b"CREATE INDEX idx_transcript_embeddings_bge_video_id "
    b"ON public.transcript_embeddings_bge USING btree (video_id);\n"
)


class PublicIndexDedupReplayPrerequisitesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / recovery.SOURCE_PATH).read_bytes()

    def test_extracts_only_the_exact_pinned_create_statement(self) -> None:
        sql, receipt = recovery.recover(self.source)
        self.assertEqual(sql, recovery.PREFIX + STATEMENT + b"COMMIT;\n")
        self.assertEqual(sql.count(b"CREATE INDEX "), 1)
        self.assertNotIn(b"IF NOT EXISTS", sql)
        self.assertEqual(receipt["sourceSha256"], hashlib.sha256(self.source).hexdigest())
        self.assertEqual(receipt["sourceByteLength"], len(self.source))
        self.assertEqual(receipt["outputSha256"], hashlib.sha256(sql).hexdigest())
        self.assertEqual(receipt["indexes"], [{
            "name": "public.idx_transcript_embeddings_bge_video_id",
            "definitionSha256": hashlib.sha256(STATEMENT).hexdigest(),
            "definitionBytes": len(STATEMENT),
        }])
        self.assertEqual(receipt["dataRowsCopied"], 0)
        self.assertFalse(receipt["canonicalMigrationsChanged"])
        self.assertFalse(receipt["publicExecutionGranted"])

    def test_any_baseline_tamper_is_rejected(self) -> None:
        for source in (
            self.source + b"\n",
            self.source.replace(STATEMENT, STATEMENT.replace(b"video_id);", b"chunk_index);")),
            self.source.replace(STATEMENT, b""),
        ):
            with self.subTest(digest=hashlib.sha256(source).hexdigest()):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_SOURCE_DRIFT$"):
                    recovery.recover(source)

    def test_definition_pin_independently_rejects_wrong_or_duplicate_index(self) -> None:
        for source in (
            self.source.replace(STATEMENT, STATEMENT.replace(b"video_id);", b"chunk_index);")),
            self.source.replace(STATEMENT, STATEMENT + STATEMENT),
            self.source.replace(STATEMENT, b""),
        ):
            # A future source-pin update alone must not silently widen this recovery.
            with self.subTest(digest=hashlib.sha256(source).hexdigest()), \
                 patch.object(recovery, "SOURCE_SHA256", hashlib.sha256(source).hexdigest()), \
                 patch.object(recovery, "SOURCE_BYTE_LENGTH", len(source)):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_DEFINITION_DRIFT$"):
                    recovery.recover(source)

    def test_execution_fence_rejects_hosted_or_existing_keeper_state(self) -> None:
        sql, _ = recovery.recover(self.source)
        for guard in (
            b"current_database() <> 'postgres'",
            b"current_user <> 'postgres' OR session_user <> 'postgres'",
            b"server_version_num')::integer / 10000 <> 15",
            b"transaction_read_only') <> 'off'",
            b"to_regnamespace('supabase_migrations') IS NOT NULL",
            b"to_regclass('public.idx_transcript_embeddings_bge_video_id') IS NOT NULL",
            b"PUBLIC_INDEX_DEDUP_REPLAY_KEEPER_ALREADY_PRESENT",
            b"SET LOCAL lock_timeout = '1s'",
            b"LOCK TABLE public.transcript_embeddings_bge IN ACCESS EXCLUSIVE MODE",
        ):
            self.assertIn(guard, sql)
        self.assertLess(sql.index(b"PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_EXECUTOR_DENIED"),
                        sql.index(STATEMENT))


if __name__ == "__main__":
    unittest.main()
