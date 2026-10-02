"""Run a profiler without exposing provider errors or public build configuration."""
import datetime
import json
from pathlib import Path
import subprocess
import sys
import threading

root = Path(__file__).resolve().parent
node = '/opt/homebrew/opt/node@24/bin/node'
stderr_size = [0]
process = subprocess.Popen([node, str(root / sys.argv[1]), *sys.argv[2:]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
def consume_stderr():
    for chunk in iter(lambda: process.stderr.read(8192), ''):
        stderr_size[0] += len(chunk)
thread = threading.Thread(target=consume_stderr)
thread.start()
for line in process.stdout:
    try:
        row = json.loads(line)
    except ValueError:
        continue
    allowed = ['mode','count','pair','position','kind','valid','clickMs','markers','expected','heap','gc','errors','passed','cycles']
    print(json.dumps({k: row[k] for k in allowed if k in row}), flush=True)
code = process.wait()
thread.join()
print(json.dumps({'profilerExit':code,'providerDiagnosticsStored':False,'stderrObserved':stderr_size[0]>0}), flush=True)
raise SystemExit(code)
