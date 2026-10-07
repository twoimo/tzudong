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
    def test_scan_includes_a_retained_output_when_its_producer_input_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);inputs=root/'inputs';outputs=root/'outputs'
            inputs.mkdir();outputs.mkdir()
            (outputs/'orphan.jsonl').write_text('{"old":true}\n')
            command=[sys.executable,str(CLI),'scan','--scan-dir',str(inputs),
                     '--scan-additional-dir',str(outputs),'--receipt',str(root/'receipts/{id}.json'),
                     '--input',str(inputs/'{id}.jsonl'),'--output',str(outputs/'{id}.jsonl')]
            result=subprocess.run(command,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0)
            self.assertEqual(result.stdout.splitlines(),['orphan'])

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
        splitter=copy.parent/'split_video_chunks.mjs';splitter.write_text('synthetic splitter')
        chunk_api=copy.parent/'gemini_chunk_video_request.mjs'
        chunk_api.write_text((script.parent/chunk_api.name).read_text())
        final_prompt=copy.parent.parent/'prompts/final_merge_prompt.txt';final_prompt.parent.mkdir(parents=True)
        final_prompt.write_text('synthetic merge prompt')
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
PARSER_SCRIPT="$FX_ASSET"; GEMINI_CHUNK_API="$FX_CHUNK_API"
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
            FX_DATA_REL=os.path.relpath(data,ROOT/'backend'),FX_ASSET=str(assets),FX_WORKER=str(stub),
            FX_CHUNK_API=str(chunk_api),PRIMARY_MODEL='gemini-3.7-flash',FALLBACK_MODEL='gemini-3.7-flash',
            GEMINI_CHUNK_THINKING_LEVEL='LOW')
        bash='/opt/homebrew/bin/bash' if Path('/opt/homebrew/bin/bash').is_file() else shutil.which('bash')
        command=[bash,str(copy),'--channel','tzuyang','--url','https://www.youtube.com/watch?v='+video]
        with subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as first:
            with subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as second:
                _,first_error=first.communicate(timeout=15);_,second_error=second.communicate(timeout=15)
                self.assertEqual(first.returncode,0,first_error.decode()[-500:])
                self.assertEqual(second.returncode,0,second_error.decode()[-500:])
        self.assertEqual(self.calls.read_text().splitlines(),['work'])
        receipt=data/'crawling/.receipts'/f'{video}.json'
        self.assertTrue(receipt.is_file())
        for index,asset in enumerate([splitter,final_prompt],2):
            asset.write_text(asset.read_text()+' changed')
            completed=subprocess.run(command,env=env,capture_output=True,timeout=15)
            self.assertEqual(completed.returncode,0,completed.stderr.decode()[-500:])
            self.assertEqual(len(self.calls.read_text().splitlines()),index)

        # Exercise the real shell cache arguments: generation policy bytes,
        # both model selections and thinking changes must invalidate a receipt.
        original_output=(data/'crawling'/f'{video}.jsonl').read_bytes()
        policy_source=chunk_api.read_text()
        changed_policy=policy_source.replace('temperature: 0.2','temperature: 0.3')
        self.assertNotEqual(changed_policy,policy_source)
        mutations=[lambda: chunk_api.write_text(changed_policy),
                   lambda: env.update(PRIMARY_MODEL='gemini-3.8-flash'),
                   lambda: env.update(FALLBACK_MODEL='gemini-2.5-flash'),
                   lambda: env.update(GEMINI_CHUNK_THINKING_LEVEL='HIGH')]
        for count,mutate in enumerate(mutations,4):
            before=json.loads(receipt.read_text())['inputHash']
            mutate()
            for expected_calls in (count,count):
                completed=subprocess.run(command,env=env,capture_output=True,timeout=15)
                self.assertEqual(completed.returncode,0,completed.stderr.decode()[-500:])
                self.assertEqual(len(self.calls.read_text().splitlines()),expected_calls)
                self.assertEqual((data/'crawling'/f'{video}.jsonl').read_bytes(),original_output)
                self.assertNotEqual(json.loads(receipt.read_text())['inputHash'],before)


if __name__=='__main__':unittest.main()
