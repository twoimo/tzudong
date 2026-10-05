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

SOURCE = Path('/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong')
OUT = Path(__file__).resolve().parent
RUN = 37197431551
SHA = 'b12fc956de63e1b9d73ac812098107f5b3578903'
BASELINE = '7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd'
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
assert patch[:4] == [header, 'index 413fbd9..09b4a40 100644', f'--- a/{TARGET}', f'+++ b/{TARGET}']
old = command(['git', 'show', f'{SHA}:{TARGET}'])
assert old == command(['git', 'show', f'{BASELINE}:{TARGET}'])
assert old == (SOURCE / TARGET).read_bytes()
assert blob(old).startswith('413fbd9')
original = old.decode().splitlines(keepends=True)
result, cursor, index, hunks = [], 0, 4, []
while index < len(patch):
    match = re.fullmatch(r'@@ -(\d+),(\d+) \+(\d+),(\d+) @@ export type Database = \{', patch[index])
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
assert blob(generated).startswith('09b4a40')
added = [line[1:] for line in patch[4:] if line.startswith('+')]
assert len(added) == 397 and not any(line.startswith('-') for line in patch[4:])
objects = [re.fullmatch(r'      ([a-z_]+): \{', line).group(1) for line in added if re.fullmatch(r'      ([a-z_]+): \{', line)]
assert len(objects) == 17
assert sum(name.startswith('admin_storyboard_production_') for name in objects) == 7
assert sum(name.startswith('storyboard_production_') for name in objects) == 10
# Only schema identifiers, type keywords, braces, array syntax and nullability.
assert all(re.fullmatch(r'[ A-Za-z0-9_?:\[\]{}",|;]*', line) for line in added)
(OUT / 'nightly-37197431551-generated.patch').write_text('\n'.join(patch) + '\n')
(OUT / 'database.types.generated.ts').write_bytes(generated)
write_json('typegen-source-evidence.json', {
    'run_id': RUN, 'attempt': 1, 'run_sha': SHA, 'baseline': BASELINE,
    'generated_target': TARGET, 'result': 'generated_success_diff_exit_1',
    'old_git_blob': blob(old), 'new_git_blob': blob(generated),
    'old_sha256': hashlib.sha256(old).hexdigest(), 'new_sha256': hashlib.sha256(generated).hexdigest(),
    'run_source_equals_baseline': True, 'hunks': hunks, 'added_lines': len(added), 'deleted_lines': 0,
    'added_schema_objects': objects, 'raw_logs_persisted': False, 'source_modified': False,
    'generated_bytes_recovered_from_exact_diff': True,
    'secondary_failures': 'lane_aggregate_and_diagnostics_follow_typegen_failure_not_independent_findings',
})
artifact = zipfile.ZipFile(io.BytesIO(command([
    'gh', 'api', 'repos/twoimo/tzudong/actions/artifacts/11301404718/zip',
])))
preflight = json.loads(artifact.read('local-image-pull-preflight.json'))
typegen = preflight.get('typegen', {})
safe = {}
for key in ('status', 'failure_class', 'cli_version', 'image', 'pull_reference', 'platform', 'image_id', 'repo_digest'):
    value = typegen.get(key)
    if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_.:/@-]{1,240}', value):
        safe[key] = value
write_json('nightly-generator-metadata.json', {'typegen': safe, 'raw_artifact_persisted': False})
print(json.dumps({'code': 'exact_generated_source_retained', 'added_lines': len(added), 'git_blob': blob(generated)}))
