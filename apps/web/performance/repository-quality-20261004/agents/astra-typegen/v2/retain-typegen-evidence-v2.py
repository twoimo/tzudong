#!/usr/bin/env python3
"""Retain only validated TypeScript source and bounded metadata from one run.

GitHub response bodies and original logs stay in process memory. This script
does not change the source checkout or use a database/Docker/remote mutation.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

SOURCE = Path('/Users/twoimo/.codex/worktrees/nightly-quality-20261004/tzudong')
OUT = Path(__file__).resolve().parent
RUN = 37203397175
SHA = '45b462af17c3640f26aa8828a304bac3f4186238'
BASELINE = 'f06365d668111f8c32815e019b51f8eb81c27a2d'
TARGET = 'apps/web/integrations/supabase/database.types.ts'


def command(args):
    result = subprocess.run(args, cwd=SOURCE, capture_output=True)
    if result.returncode:
        raise SystemExit('read_command_failed')
    return result.stdout


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')


run = json.loads(command(['gh', 'api', f'repos/twoimo/tzudong/actions/runs/{RUN}']))
assert run['head_sha'] == SHA and run['run_attempt'] == 1
archive = zipfile.ZipFile(io.BytesIO(command([
    'gh', 'api', f'repos/twoimo/tzudong/actions/runs/{RUN}/logs',
])))
lines = archive.read('Local/18_Verify generated Supabase types match the local catalog.txt').decode().splitlines()
# Remove exactly the log timestamp and its separator, preserving diff context.
lines = [re.sub(r'^\d{4}-\d\d-\d\dT[\d:.]+Z ', '', line) for line in lines]
header = f'diff --git a/{TARGET} b/{TARGET}'
start = lines.index(header)
patch = []
for line in lines[start:]:
    if line.startswith('##['):
        break
    assert line.startswith(('diff --git ', 'index ', '--- ', '+++ ', '@@ ', ' ', '+', '-'))
    patch.append(line)
assert patch[:4] == [header, 'index 09b4a40..64a9faa 100644', f'--- a/{TARGET}', f'+++ b/{TARGET}']
old = command(['git', 'show', f'{SHA}:{TARGET}'])
assert old == command(['git', 'show', f'{BASELINE}:{TARGET}'])
assert old == (SOURCE / TARGET).read_bytes()
assert blob(old).startswith('09b4a40')
original = old.decode().splitlines(keepends=True)
result, cursor, index, hunks = [], 0, 4, []
while index < len(patch):
    match = re.fullmatch(r'@@ -(\d+),(\d+) \+(\d+),(\d+) @@.*', patch[index])
    assert match
    old_start, old_count, new_start, new_count = map(int, match.groups())
    result.extend(original[cursor:old_start - 1])
    cursor = old_start - 1
    assert len(result) == new_start - 1
    index += 1
    consumed = produced = 0
    while index < len(patch) and not patch[index].startswith('@@ '):
        marker, value = patch[index][0], patch[index][1:] + '\n'
        assert marker in ' +-' and '\x1b' not in value and '\r' not in value
        if marker in ' -':
            assert original[cursor] == value
            cursor += 1
            consumed += 1
        if marker in ' +':
            result.append(value)
            produced += 1
        index += 1
    assert (consumed, produced) == (old_count, new_count)
    hunks.append({'old_start': old_start, 'old_count': old_count, 'new_start': new_start, 'new_count': new_count})
result.extend(original[cursor:])
generated = ''.join(result).encode()
assert blob(generated).startswith('64a9faa')
added = [line[1:] for line in patch[4:] if line.startswith('+')]
deleted = [line[1:] for line in patch[4:] if line.startswith('-')]
assert len(added) == len(deleted) == 10 and len(hunks) == 5
assert all(re.fullmatch(r'[ A-Za-z0-9_?:\[\]{}",|;()=]*', line) for line in added + deleted)
objects = []
(OUT / 'nightly-37203397175-generated.patch').write_text('\n'.join(patch) + '\n')
(OUT / 'database.types.generated.ts').write_bytes(generated)
write_json('typegen-source-evidence.json', {
    'run_id': RUN, 'attempt': 1, 'run_sha': SHA, 'baseline': BASELINE,
    'generated_target': TARGET, 'result': 'generated_success_diff_exit_1',
    'old_git_blob': blob(old), 'new_git_blob': blob(generated),
    'old_sha256': hashlib.sha256(old).hexdigest(), 'new_sha256': hashlib.sha256(generated).hexdigest(),
    'run_source_equals_baseline': True, 'hunks': hunks, 'added_lines': len(added), 'deleted_lines': len(deleted),
    'added_schema_objects': objects, 'raw_logs_persisted': False, 'source_modified': False,
    'generated_bytes_recovered_from_exact_diff': True,
    'secondary_failures': 'lane_aggregate_and_diagnostics_follow_typegen_failure_not_independent_findings',
})
print(json.dumps({'code':'exact_generated_helpers_retained','added_lines':len(added),'deleted_lines':len(deleted),'git_blob':blob(generated)}))
