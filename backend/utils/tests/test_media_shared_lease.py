"""Real POSIX FFmpeg leases, owned temp contexts only; no TTL/PID reclamation."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT=Path(__file__).resolve().parents[3]
HELPER=ROOT/'backend/utils/media_lease_exec.py'
FFMPEG=shutil.which('ffmpeg')
NODE='/opt/homebrew/opt/node@24/bin/node'

def comm(pid):
    return subprocess.run(['ps','-p',str(pid),'-o','comm='],capture_output=True,text=True).stdout.strip()

class MediaLeaseTests(unittest.TestCase):
    def test_native_children_keep_slots_after_node_parent_sigkill(self):
        if not FFMPEG or os.name!='posix':self.skipTest('POSIX ffmpeg required')
        with tempfile.TemporaryDirectory(prefix='tzudong-media-lease-test-') as d:
            directory=Path(d).resolve()/'slots'
            code="""import {spawn} from 'node:child_process';import {sharedMediaInvocation} from './backend/utils/resource-budget.mjs';
const children=Array.from({length:4},()=>{const v=sharedMediaInvocation(process.env.TEST_FFMPEG,['-nostdin','-v','error','-re','-f','lavfi','-i','testsrc2=size=64x64:rate=4','-t','2','-f','null','-']);return spawn(v.file,v.args,{stdio:['pipe','ignore','ignore'],detached:true});});
console.log(JSON.stringify(children.map(c=>c.pid)));setInterval(()=>{},1000);"""
            env=dict(os.environ,PIPELINE_MEDIA_RESOURCE_DIR=str(directory),RUN_DAILY_PYTHON=sys.executable,TEST_FFMPEG=FFMPEG)
            parent=subprocess.Popen([NODE,'--input-type=module','-e',code],cwd=ROOT,env=env,stdout=subprocess.PIPE,text=True)
            pids=json.loads(parent.stdout.readline());waiting=None
            try:
                deadline=time.monotonic()+5
                while not all(Path(comm(pid)).name=='ffmpeg' for pid in pids):
                    if time.monotonic()>deadline:self.fail('FFMPEG_ADMISSION_NOT_OBSERVED')
                    time.sleep(.02)
                parent.kill();parent.wait(timeout=2)
                waiting=subprocess.Popen([sys.executable,str(HELPER),str(directory),'--',FFMPEG,'-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=64x64:rate=4','-frames:v','1','-f','null','-'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
                time.sleep(.15)
                self.assertIsNone(waiting.poll())
                self.assertNotEqual(Path(comm(waiting.pid)).name,'ffmpeg')
                # Parents are dead; the live native children still own all slots.
                self.assertTrue(all(Path(comm(pid)).name=='ffmpeg' for pid in pids))
                self.assertEqual(waiting.wait(timeout=6),0)
                # Explicit cancellation releases a native tool's slot, restart works.
                child=subprocess.Popen([sys.executable,str(HELPER),str(directory),'--',FFMPEG,'-nostdin','-v','error','-re','-f','lavfi','-i','testsrc2=size=64x64:rate=4','-t','5','-f','null','-'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                try:
                    deadline=time.monotonic()+3
                    while Path(comm(child.pid)).name!='ffmpeg':
                        if time.monotonic()>deadline:self.fail('RESTART_NOT_OBSERVED')
                        time.sleep(.02)
                    child.terminate();child.wait(timeout=3)
                finally:
                    if child.poll() is None:child.kill();child.wait()
                    child.stdin.close()
                failed=subprocess.run([sys.executable,str(HELPER),str(directory),'--','/does/not/exist'],stdin=subprocess.DEVNULL,capture_output=True)
                self.assertEqual(failed.returncode,126)
                self.assertEqual(len(list(directory.glob('*.lock'))),4)
            finally:
                if parent.poll() is None:parent.kill();parent.wait()
                parent.stdout.close()
                if waiting:
                    if waiting.poll() is None:waiting.kill();waiting.wait()
                    waiting.stdin.close()
                for pid in pids:
                    if Path(comm(pid)).name=='ffmpeg':
                        try:os.kill(pid,9)
                        except ProcessLookupError:pass
