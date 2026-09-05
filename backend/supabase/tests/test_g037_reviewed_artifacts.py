"""Historical approval provenance must not silently authorize changed code."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.supabase.tests import g037_reviewed_artifacts as evidence


class ReviewedArtifactTests(unittest.TestCase):
    def test_both_reviewed_git_bytes_and_current_correction_are_verified(self):
        self.assertEqual(evidence.reviewed_sha256(evidence.EXECUTOR), evidence.REVIEWED_SHA256)
        self.assertNotEqual(hashlib.sha256(evidence.EXECUTOR.read_bytes()).hexdigest(), evidence.REVIEWED_SHA256)

    def test_unrecorded_current_source_change_is_rejected(self):
        original = Path.read_bytes
        def read(path):
            value = original(path)
            return value + b'\n' if path == evidence.EXECUTOR else value
        with patch.object(Path, 'read_bytes', read):
            with self.assertRaisesRegex(AssertionError, 'unrecorded_current_source_drift'):
                evidence.reviewed_sha256(evidence.EXECUTOR)

    def test_wrong_reviewed_git_bytes_are_rejected(self):
        with patch.object(evidence.subprocess, 'check_output', return_value=b'wrong historical source'):
            with self.assertRaisesRegex(AssertionError, 'reviewed_git_source_drift'):
                evidence.reviewed_sha256(evidence.EXECUTOR)

    def test_transition_cannot_grant_execution_or_change_reviewed_identity(self):
        source = json.loads(evidence.TRANSITION.read_text())
        for change in ({'newHostedExecutionAuthorizedByThisFile': True},
                       {'freshExactMainAuthorizationRequired': False},
                       {'reviewedCommit': '0' * 40}, {'reviewedSha256': '0' * 64}):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'transition.json'
                path.write_text(json.dumps({**source, **change}))
                with patch.object(evidence, 'TRANSITION', path), self.assertRaises(AssertionError):
                    evidence.reviewed_sha256(evidence.EXECUTOR)

    def test_unrelated_artifact_hash_remains_bound_to_current_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'approval.json'
            for content in (b'original', b'changed'):
                path.write_bytes(content)
                self.assertEqual(evidence.reviewed_sha256(path), hashlib.sha256(content).hexdigest())
