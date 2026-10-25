"""Exercise the actual shell admission loop with finished child jobs."""
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import json
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / '08-chunk-multimodal-crawling.sh'


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'POSIX Bash required')
class ChunkSlotReleaseTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('jq'), 'jq required')
    def test_multichunk_absence_is_kept_without_another_model_call(self):
        source = SCRIPT.read_text()
        condition = next(line.strip()[3:-6] for line in source.splitlines()
                         if line.strip().startswith('if [ "$total_chunks" -eq 1 ] ||'))
        with tempfile.TemporaryDirectory() as folder:
            response = Path(folder) / 'merged.json'
            cases = [({'restaurants': [], 'no_restaurant_reason': 'home meal'}, True),
                     ({'restaurants': [], 'no_restaurant_reason': ''}, False),
                     ({'restaurants': []}, False),
                     ({'restaurants': [{'origin_name': 'Test restaurant'}]}, False)]
            for payload, may_skip in cases:
                with self.subTest(payload=payload):
                    response.write_text(json.dumps(payload))
                    result = subprocess.run([shutil.which('bash'), '-c',
                        'total_chunks=2; JQ_EXE="$1"; raw_merged_response="$2"; if ' + condition + '; then echo preserve; else echo model; fi',
                        'test', shutil.which('jq'), str(response)], capture_output=True, text=True, timeout=3)
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(result.stdout.strip(), 'preserve' if may_skip else 'model')

    def test_finished_success_and_failure_both_release_the_slot(self):
        source = SCRIPT.read_text()
        loop = re.search(r'        while \[ \$\(jobs .*?\n        done', source, re.S)
        self.assertIsNotNone(loop)
        for child_code in (0, 1):
            with self.subTest(child_code=child_code):
                command = f'set +m\nmax_jobs=1\n(exit {child_code}) &\nsleep 0.05\n' + loop.group() + '\necho slot_released\n'
                process = subprocess.Popen([shutil.which('bash'), '-c', command], stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True, start_new_session=True)
                try:
                    output, _ = process.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.communicate()
                    self.fail('finished chunk keeps the admission loop waiting')
                self.assertEqual(process.returncode, 0)
                self.assertIn('slot_released', output)


if __name__ == '__main__':
    unittest.main()
