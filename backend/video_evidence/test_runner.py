import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from . import runner


class EvidenceRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.caption = self.root / 'captions.jsonl'
        self.caption.write_text(json.dumps({'transcript': [
            {'start': 0, 'duration': 2, 'text': '식당 방문'},
            {'start': 3, 'duration': 2, 'text': '짬뽕 식사'},
        ]}))

    def test_caption_only_does_not_probe_or_hash_video(self):
        with patch.object(runner.frames, 'get_metadata', side_effect=AssertionError('decode forbidden')):
            result = runner.inspect(video=self.root/'missing.mp4', caption_path=self.caption,
                output_root=self.root/'out', mode='transcript')
        receipt = json.loads(Path(result['manifest']).read_text())
        self.assertEqual(result['frames'], 0)
        self.assertEqual(result['segments'], 2)
        self.assertIsNone(receipt['video_source_sha256'])
        self.assertEqual(runner.digest(Path(result['manifest'])), result['sha256'])

    def test_missing_captions_fail_closed(self):
        with self.assertRaisesRegex(runner.EvidenceError, 'CAPTIONS_UNAVAILABLE'):
            runner.inspect(video=None, caption_path=None, output_root=self.root/'out', mode='transcript')

    def test_nullable_caption_duration_preserves_timestamp(self):
        self.caption.write_text(json.dumps({'transcript': [
            {'start': 12.5, 'end': None, 'duration': None, 'text': '매장 방문'},
            {'start': 15, 'end': 18, 'duration': None, 'text': '식사'},
        ]}))
        parsed = runner.captions(self.caption)
        self.assertEqual([(row['start'], row['end']) for row in parsed], [(12.5, 12.5), (15, 18)])

    def test_invalid_range_and_nan_fail_before_output(self):
        for start, end in [(2, 1), (float('nan'), 3), (-1, 3)]:
            with self.assertRaisesRegex(runner.EvidenceError, 'EVIDENCE_RANGE_INVALID'):
                runner.inspect(video=None, caption_path=self.caption,
                    output_root=self.root/'out', mode='transcript', start=start, end=end)
        self.assertFalse((self.root/'out').exists())

    def test_real_ffmpeg_cues_and_keyframe_budget(self):
        video = self.root/'source.mp4'
        completed = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
            'testsrc2=size=320x240:rate=12:duration=6', '-c:v', 'libx264', '-g', '12',
            '-pix_fmt', 'yuv420p', str(video)], capture_output=True, timeout=30)
        self.assertEqual(completed.returncode, 0, 'FIXTURE_VIDEO_FAILED')
        result = runner.inspect(video=video, caption_path=self.caption, output_root=self.root/'out',
            start=0, end=6, timestamps=(1.5, 4.5), max_frames=4, resolution=256)
        receipt = json.loads(Path(result['manifest']).read_text())
        self.assertGreaterEqual(result['frames'], 2)
        self.assertLessEqual(result['frames'], 4)
        self.assertTrue(receipt['scope']['full_video'])
        for frame in receipt['frames']:
            self.assertEqual(runner.digest(Path(frame['path'])), frame['sha256'])
        self.assertEqual(receipt['video_source_sha256'], runner.digest(video))


if __name__ == '__main__':
    unittest.main()
