"""Read-only wrapper around the unchanged repository publication verifier."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
source, bundle, expected_sha = sys.argv[1:]
source = Path(source).resolve()
script = source / '.github/scripts/verify-nightly-local-publication.py'
os.environ['GITHUB_SHA'] = expected_sha
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['GIT_OPTIONAL_LOCKS'] = '0'
reads = set()
blocked = []

def audit(event, args):
    if event == 'open':
        path, mode, flags = args
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            blocked.append('file_write')
            raise PermissionError('read_only_verification')
        if isinstance(path, (str, bytes)):
            p = Path(os.fsdecode(path)).resolve()
            if p.is_relative_to(source) and p.is_file():
                reads.add(p.relative_to(source).as_posix())
    if event in {'os.mkdir', 'os.remove', 'os.rmdir', 'os.rename', 'os.link', 'os.symlink',
                 'os.chmod', 'os.chown', 'os.truncate', 'os.utime', 'subprocess.Popen',
                 'os.system', 'socket.connect', 'socket.bind'}:
        blocked.append(event)
        raise PermissionError('read_only_verification')

sys.addaudithook(audit)
sys.argv = [str(script), '--root', str(Path(bundle).resolve())]
result = {'status': 'pass', 'exit_code': 0, 'github_sha': expected_sha,
          'python_version': sys.version.split()[0], 'writes_and_network_denied': True}
captured_out, captured_err = io.StringIO(), io.StringIO()
try:
    with contextlib.redirect_stdout(captured_out), contextlib.redirect_stderr(captured_err):
        runpy.run_path(str(script), run_name='__main__')
except BaseException as error:
    if not isinstance(error, SystemExit) or error.code not in (None, 0):
        result.update(status='fail', exit_code=1, exception_type=type(error).__name__)
        if isinstance(error, SystemExit) and isinstance(error.code, str):
            # The repository verifier emits fixed bounded errors; arbitrary diagnostics stay in memory.
            result['verifier_message'] = error.code[:200] if error.code.startswith(('local ', 'publication ', 'unexpected ')) else 'unclassified_verifier_exit'
        trace = []
        tb = error.__traceback__
        while tb:
            p = Path(tb.tb_frame.f_code.co_filename)
            if p.is_absolute() and p.is_relative_to(source):
                trace.append({'file': p.relative_to(source).as_posix(), 'line': tb.tb_lineno,
                              'function': tb.tb_frame.f_code.co_name})
            tb = tb.tb_next
        result['source_frames'] = trace
result['blocked_actions'] = blocked
result['captured_output_bytes'] = len(captured_out.getvalue().encode()) + len(captured_err.getvalue().encode())
source_paths = sorted(reads)
result['source_files_read'] = [
    {'path': p, 'sha256': hashlib.sha256((source / p).read_bytes()).hexdigest()}
    for p in source_paths
]
print(json.dumps(result, sort_keys=True))
raise SystemExit(result['exit_code'])
