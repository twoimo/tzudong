"""Checkpoint bounds and interrupted publication; no engine or provider."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.knowledge_graph import publication_checkpoint as checkpoint
from backend.knowledge_graph import longform_analysis as analysis


def ledger(count=100):
    return {'binding': {'scope': '00_Scope/tzudong', 'videoId': 'ABCDEFGHIJK'},
            'source': {'receiptSha256': 'a' * 64}, 'state': 'running',
            'nodes': {f'TZ-Claim-ABCDEFGHIJK-{i:06d}': {'state': 'complete', 'hash': 'sha256:' + 'b' * 64,
                        'targetSha256': 'c' * 64} for i in range(count)}}


class PublicationCheckpointTests(unittest.TestCase):
    def test_legacy_and_hierarchical_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'video.json'
            value = ledger(2)
            checkpoint.save(path, value)
            self.assertEqual(analysis.checked_document(path), value)
            self.assertEqual(checkpoint.load(path), value)
            value = ledger()
            with patch.object(checkpoint, 'MAX_BYTES', 4096), patch.object(checkpoint, 'MAX_ITEMS', 3), patch.object(checkpoint, 'FANOUT', 2):
                checkpoint.save(path, value)
                root = analysis.checked_document(path)
                self.assertEqual(root['format'], checkpoint.FORMAT)
                self.assertGreater(root['nodePages'][0]['level'], 1)
                self.assertEqual(checkpoint.load(path), value)
                self.assertTrue(all(page.stat().st_size <= 4096 for page in (Path(directory) / '.checkpoint-pages').iterdir()))
                old = set((Path(directory) / '.checkpoint-pages').iterdir())
                value['nodes']['TZ-Claim-ABCDEFGHIJK-000000']['hash'] = 'sha256:' + 'd' * 64
                checkpoint.save(path, value)
                self.assertEqual(checkpoint.load(path), value)
                self.assertTrue(old.issubset(set((Path(directory) / '.checkpoint-pages').iterdir())))

    def test_corruption_and_scope_substitution_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(checkpoint, 'MAX_BYTES', 4096):
            path = Path(directory) / 'video.json'
            checkpoint.save(path, ledger())
            root = analysis.checked_document(path)
            for transform in (lambda value: value.update(totalNodes=99), lambda value: value['binding'].update(scope='foreign')):
                changed = copy.deepcopy(root)
                transform(changed)
                analysis.atomic_document(path, changed)
                with self.assertRaisesRegex(analysis.AnalysisError, 'PUBLICATION_CHECKPOINT_INVALID'):
                    checkpoint.load(path)
            analysis.atomic_document(path, root)
            page = Path(directory) / '.checkpoint-pages' / (root['nodePages'][0]['sha256'] + '.json')
            page.write_bytes(page.read_bytes() + b' ')
            with self.assertRaisesRegex(analysis.AnalysisError, 'PUBLICATION_CHECKPOINT_INVALID'):
                checkpoint.load(path)

    def test_interrupted_root_replace_preserves_old_complete_generation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(checkpoint, 'MAX_BYTES', 4096):
            path = Path(directory) / 'video.json'
            old = ledger()
            checkpoint.save(path, old)
            updated = copy.deepcopy(old)
            updated['state'] = 'complete'
            write = analysis.atomic_document
            def interrupt(target, payload):
                if target == path:
                    raise OSError('isolated failure before root commit')
                write(target, payload)
            with patch.object(analysis, 'atomic_document', side_effect=interrupt), self.assertRaises(OSError):
                checkpoint.save(path, updated)
            self.assertEqual(checkpoint.load(path), old)


if __name__ == '__main__':
    unittest.main()
