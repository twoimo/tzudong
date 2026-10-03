"""Real concurrent subprocess admission, with synthetic work and no API calls."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[3]
CLI=ROOT/'backend/bin/stage_cache.py'


class StageExecutionTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name)
        self.input=self.root/'input.jsonl';self.input.write_text('{"input":1}\n')
        self.output=self.root/'output.jsonl';self.receipt=self.root/'receipt.json'
        self.calls=self.root/'calls.txt';self.started=self.root/'started'
        self.worker=self.root/'worker.py'
        self.worker.write_text('''from pathlib import Path
import sys,time
root=Path(sys.argv[1])
with (root/'calls.txt').open('a') as f:f.write('work\\n')
(root/'started').touch()
time.sleep(0.15)
(root/'output.jsonl').write_text('{"result":1}\\n')
''')

    def command(self):
        return [sys.executable,str(CLI),'run','--receipt',str(self.receipt),'--input',str(self.input),
                '--output',str(self.output),'--',sys.executable,str(self.worker),str(self.root)]

    def test_overlapping_processes_execute_once_and_publish_one_valid_receipt(self):
        with subprocess.Popen(self.command(),stdout=subprocess.PIPE,stderr=subprocess.PIPE) as first:
            with subprocess.Popen(self.command(),stdout=subprocess.PIPE,stderr=subprocess.PIPE) as second:
                first.communicate(timeout=10);second.communicate(timeout=10)
                self.assertEqual(sorted([first.returncode,second.returncode]),[0,10])
        self.assertEqual(self.calls.read_text().splitlines(),['work'])
        self.assertEqual(json.loads(self.output.read_text()),{'result':1})
        self.assertTrue(self.receipt.is_file())

    def test_input_change_or_corrupted_output_is_not_reused(self):
        self.assertEqual(subprocess.run(self.command(),capture_output=True,timeout=10).returncode,0)
        self.output.write_text('{broken')
        self.assertEqual(subprocess.run(self.command(),capture_output=True,timeout=10).returncode,0)
        self.input.write_text('{"input":2}\n')
        self.assertEqual(subprocess.run(self.command(),capture_output=True,timeout=10).returncode,0)
        self.assertEqual(len(self.calls.read_text().splitlines()),3)

    def test_failed_command_cannot_publish_a_completion(self):
        self.worker.write_text('import sys;sys.exit(42)\n')
        self.assertEqual(subprocess.run(self.command(),capture_output=True,timeout=10).returncode,42)
        self.assertFalse(self.receipt.exists())

    def test_changed_input_during_work_prevents_receipt_publication(self):
        self.worker.write_text("from pathlib import Path\nimport sys\nr=Path(sys.argv[1]);(r/'input.jsonl').write_text('{\\\"input\\\":9}\\n');(r/'output.jsonl').write_text('{\\\"result\\\":1}\\n')\n")
        self.assertEqual(subprocess.run(self.command(),capture_output=True,timeout=10).returncode,1)
        self.assertFalse(self.receipt.exists())

    @unittest.skipUnless(shutil.which('bash') and shutil.which('jq'), 'Bash and jq required')
    def test_actual_step08_dispatch_serializes_two_overlapping_invocations(self):
        script=ROOT/'backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh'
        copy=self.root/'backend/restaurant-crawling/scripts'/script.name
        copy.parent.mkdir(parents=True)
        assets=self.root/'asset.txt';assets.write_text('synthetic asset')
        (copy.parent/'final_merge_chunk.mjs').write_text('synthetic asset')
        data=self.root/'data'
        for directory in ('meta','transcript','crawling'):(data/directory).mkdir(parents=True)
        video='ABCDEFGHIJK'
        (data/'meta'/f'{video}.jsonl').write_text('{"title":"fixture"}\n')
        (data/'transcript'/f'{video}.jsonl').write_text('{"transcript":["fixture"]}\n')
        stub=self.root/'dispatch_worker.py'
        stub.write_text('''from pathlib import Path
import sys,time
r=Path(sys.argv[1])
with (r/'calls.txt').open('a') as f:f.write('work\\n')
time.sleep(0.15)
(r/'data/crawling/ABCDEFGHIJK.jsonl').write_text('{"restaurants":[{"name":"fixture"}]}\\n')
''')
        overrides='''
PROJECT_ROOT="$FX_BACKEND"
PROMPT_FILE="$FX_ASSET"; CHUNK_PLANNER="$FX_ASSET"; MERGE_RESULTS="$FX_ASSET"
PARSER_SCRIPT="$FX_ASSET"; GEMINI_CHUNK_API="$FX_ASSET"
get_local_python_cmd() { echo "$PYTHON_CMD"; }
get_channel_data_path() { echo "$FX_DATA_REL"; }
get_channel_name() { echo fixture; }
process_video_chunks() { "$PYTHON_CMD" "$FX_WORKER" "$FX_ROOT"; }
main() { process_channel tzuyang; }
'''
        source=script.read_text();anchor='if [[ "${1:-}" == "--stage-worker" ]]; then\n    if [[ $# -ne 8'
        self.assertEqual(source.count(anchor),1)
        copy.write_text(source.replace(anchor,overrides+'\n'+anchor,1))
        env=os.environ.copy();env.update(PYTHON_CMD=sys.executable,FX_BACKEND=str(ROOT/'backend'),FX_ROOT=str(self.root),
            FX_DATA_REL=os.path.relpath(data,ROOT/'backend'),FX_ASSET=str(assets),FX_WORKER=str(stub))
        bash='/opt/homebrew/bin/bash' if Path('/opt/homebrew/bin/bash').is_file() else shutil.which('bash')
        command=[bash,str(copy),'--channel','tzuyang','--url','https://www.youtube.com/watch?v='+video]
        with subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as first:
            with subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as second:
                _,first_error=first.communicate(timeout=15);_,second_error=second.communicate(timeout=15)
                self.assertEqual(first.returncode,0,first_error.decode()[-500:])
                self.assertEqual(second.returncode,0,second_error.decode()[-500:])
        self.assertEqual(self.calls.read_text().splitlines(),['work'])
        self.assertTrue((data/'crawling/.receipts'/f'{video}.json').is_file())


if __name__=='__main__':unittest.main()
