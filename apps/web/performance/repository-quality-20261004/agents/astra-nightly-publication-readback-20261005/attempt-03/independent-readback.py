"""GET-only readback. Persist exclusive, minimized evidence in this new directory."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
OUT = Path(__file__).resolve().parent
sys.pycache_prefix = str(OUT / 'unused-bytecode-cache')
SOURCE = Path('/Users/twoimo/.codex/worktrees/nightly-quality-20261004/tzudong')
ORIGINAL = Path('/Users/twoimo/.codex/worktrees/179f/tzudong')
REPO = 'twoimo/tzudong'
RUN = 37233565208
ATTEMPT = 1
LOCAL_SHA = '2f9460ab93de8705237e68480793578c096b3619'
SHA = 'b90154e22e6b4ba089275c7ae6d53e7274feae98'
TAG = 'v1.2.4-nightly.37233565208.gb90154e22e6b'
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', GIT_OPTIONAL_LOCKS='0', GH_PROMPT_DISABLED='1')
checks = []
report = {'schema': 'independent-nightly-publication-readback-v1',
          'started_at': datetime.now(timezone.utc).isoformat(), 'checks': checks,
          'scope': {'repository': REPO, 'run_id': RUN, 'head_sha': SHA,
                    'source_checkout': str(SOURCE), 'original_checkout': str(ORIGINAL),
                    'write_root': str(OUT), 'remote_methods': ['GET'],
                    'raw_logs_env_bodies_user_rows_persisted': False}}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def check(code, condition, fatal=True):
    checks.append({'check': code, 'pass': bool(condition)})
    if not condition and fatal:
        raise RuntimeError(code)

def fresh(path, data):
    check('write_within_authorized_root', path.resolve().is_relative_to(OUT))
    with path.open('xb') as stream:
        stream.write(data)

def save_json(name, payload):
    fresh(OUT / name, (json.dumps(payload, indent=2, sort_keys=True) + '\n').encode())

def command(args, cwd=SOURCE):
    proc = subprocess.run(args, cwd=cwd, env=ENV, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=90)
    if proc.returncode:
        status = re.findall(r'HTTP [0-9]{3}', proc.stderr.decode(errors='replace'))
        raise RuntimeError('read_only_command_failed:' + args[0] + ':' + ','.join(status))
    return proc.stdout

def git(*args, cwd=SOURCE):
    return command(['git', *args], cwd).decode().strip()

def api(path, binary=False):
    args = ['gh', 'api', '--method', 'GET', 'repos/' + REPO + '/' + path]
    if binary and path.startswith('releases/assets/'):
        args += ['-H', 'Accept: application/octet-stream']
    data = command(args)
    return data if binary else json.loads(data)

def pick(data, fields):
    return {k: data.get(k) for k in fields.split()}

def local_state(root):
    status = git('status', '--porcelain=v1', '--untracked-files=all', cwd=root)
    return {'head': git('rev-parse', 'HEAD', cwd=root),
            'tree': git('rev-parse', 'HEAD^{tree}', cwd=root),
            'status_sha256': sha(status.encode()), 'clean': not status}

def validate_bytes(name, data, policy):
    check('size_bound:' + name, len(data) <= 256 * 1024)
    if name == 'publication-boundary.txt':
        check('canonical_boundary', data == policy.BOUNDARY_MARKER)
        return
    payload = json.loads(data)
    check('top_level_schema:' + name, isinstance(payload, dict) and set(payload) == policy.EXPECTED_FIELDS[name])
    marker, value = policy.EXPECTED_MARKERS[name]
    check('schema_marker:' + name, payload.get(marker) == value)
    encoded = json.dumps(payload, separators=(',', ':'))
    check('no_credential_shaped_values:' + name, '[REDACTED]' not in encoded and not policy.CREDENTIAL_VALUE.search(encoded))
    policy.reject_credential_fields(payload, name)

def verify_bundle(label, path):
    proc = subprocess.run([sys.executable, '-B', str(OUT / 'run-internal-verifier.py'),
                           str(SOURCE), str(path), SHA], cwd=SOURCE, env=ENV,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    try:
        result = json.loads(proc.stdout)
    except ValueError:
        result = {'status': 'fail', 'exit_code': proc.returncode,
                  'reason': 'wrapper_did_not_return_bounded_json',
                  'stdout_bytes': len(proc.stdout), 'stderr_bytes': len(proc.stderr)}
    save_json(label + '-verifier.json', result)
    check(label + '_internal_verifier', proc.returncode == 0 and result.get('status') == 'pass', fatal=False)
    return result

try:
    report['source_before'] = local_state(SOURCE)
    report['original_before'] = local_state(ORIGINAL)
    report['source_initial_assumption_changed'] = report['source_before']['head'] != LOCAL_SHA or not report['source_before']['clean']
    report['source_expected_head'] = LOCAL_SHA
    check('source_tree_equals_task_expected_tree', report['source_before']['tree'] == git('rev-parse', LOCAL_SHA + '^{tree}'))
    requests = {
        'branch': 'branches/main', 'run': f'actions/runs/{RUN}',
        'jobs': f'actions/runs/{RUN}/jobs?per_page=100',
        'artifacts': f'actions/runs/{RUN}/artifacts?per_page=100',
        'release': 'releases/tags/' + TAG, 'tag': 'git/ref/tags/' + TAG,
        'commit': 'git/commits/' + SHA, 'issue': 'issues/2843',
    }
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {key: pool.submit(api, path) for key, path in requests.items()}
        remote = {key: f.result() for key, f in pending.items()}
    branch, run, release = remote['branch'], remote['run'], remote['release']
    report['main_before'] = {'sha': branch['commit']['sha'], 'protected': branch['protected']}
    report['run'] = pick(run, 'id name event head_branch head_sha path run_attempt status conclusion html_url created_at updated_at')
    report['main_tree_sha'] = remote['commit']['tree']['sha']
    check('current_protected_main_is_run_head', branch['protected'] and branch['commit']['sha'] == SHA)
    check('entire_local_source_tree_equals_current_main', report['main_tree_sha'] == report['source_before']['tree'])
    check('canonical_complete_run_identity', run['id'] == RUN and run['run_attempt'] == ATTEMPT
          and run['head_sha'] == SHA and run['head_branch'] == 'main'
          and run['path'] == '.github/workflows/nightly-local-regression.yml'
          and run['status'] == 'completed' and run['conclusion'] == 'success')
    jobs = remote['jobs']['jobs']
    report['jobs'] = [dict(pick(j, 'id name status conclusion head_sha'),
                           steps=[pick(s, 'number name status conclusion') for s in j['steps']]) for j in jobs]
    check('local_and_publish_completed_success', len(jobs) == 2 and {j['name'] for j in jobs} == {'Local', 'Publish'}
          and all(j['status'] == 'completed' and j['conclusion'] == 'success' and j['head_sha'] == SHA for j in jobs))
    steps = {s['name']: s for j in jobs for s in j['steps']}
    for name in ['Run local nightly unit regression', 'Run local nightly browser regression',
                 'Aggregate local nightly lane outcomes', 'Build row-free local publication evidence',
                 'Verify generated Supabase types match the local catalog',
                 'Verify publication bundle before artifact persistence',
                 'Stop and remove disposable local stack',
                 'Verify trusted publication ref and artifact boundary', 'Publish sanitized nightly prerelease']:
        check('step_success:' + name, steps.get(name, {}).get('conclusion') == 'success')
    report['incident_management_step'] = pick(steps['Manage scheduled nightly incident'], 'name status conclusion')
    report['issue'] = pick(remote['issue'], 'number title state html_url created_at updated_at closed_at')
    # Raw issue body stays in memory; retain only constrained run references and lane identifiers.
    issue_body = remote['issue'].get('body') or ''
    report['issue']['body_run_ids'] = sorted(set(re.findall(r'https://github\.com/twoimo/tzudong/actions/runs/([0-9]+)', issue_body)))
    report['issue']['body_mentions'] = {k: k.lower() in issue_body.lower() for k in ('unit', 'e2e', 'cleanup', 'Local')}
    policy_paths = [
        '.github/nightly-local-publication-allowlist.txt', '.github/workflows/nightly-local-regression.yml',
        '.github/workflows/nightly-regression.yml', '.github/scripts/build-nightly-local-publication.py',
        '.github/scripts/verify-nightly-local-publication.py', 'docs/agents/verification.md',
        'docs/agents/release.md', 'docs/agents/privacy.md',
    ]
    def policy_readback(path):
        result = api('contents/' + path + '?ref=' + SHA)
        check('policy_contents_base64:' + path, result.get('encoding') == 'base64')
        live = base64.b64decode(result['content'])
        local = (SOURCE / path).read_bytes()
        return {'path': path, 'github_blob_sha': result['sha'], 'github_sha256': sha(live),
                'local_sha256': sha(local), 'byte_length': len(local), 'match': live == local}
    with ThreadPoolExecutor(max_workers=4) as pool:
        report['policy_files'] = list(pool.map(policy_readback, policy_paths))
    check('current_main_policy_bytes_match_local', all(p['match'] for p in report['policy_files']))
    spec = importlib.util.spec_from_file_location('readback_policy', SOURCE / '.github/scripts/verify-nightly-local-publication.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    names = policy.load_allowlist()
    report['allowlist'] = names
    report['artifact_inventory'] = [pick(a, 'id name size_in_bytes digest expired created_at updated_at') for a in remote['artifacts']['artifacts']]
    matches = [a for a in remote['artifacts']['artifacts'] if a['name'] == f'nightly-local-publication-{RUN}-{ATTEMPT}']
    check('unique_exact_publication_artifact', len(matches) == 1)
    artifact = matches[0]
    check('artifact_valid_run_binding', not artifact['expired'] and artifact['workflow_run']['id'] == RUN
          and artifact['workflow_run']['head_sha'] == SHA and artifact['workflow_run']['head_branch'] == 'main')
    check('zip_download_size_bound', 0 < artifact['size_in_bytes'] <= 4 * 1024 * 1024)
    archive = api(f'actions/artifacts/{artifact["id"]}/zip', binary=True)
    check('github_artifact_zip_digest', 'sha256:' + sha(archive) == artifact['digest'])
    check('github_artifact_zip_size', len(archive) == artifact['size_in_bytes'])
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        info = zipped.infolist()
        check('zip_exact_flat_allowlist', len(info) == len(names) and {i.filename for i in info} == set(names))
        check('zip_no_symlink_directory_or_encryption', all(not i.is_dir() and not stat.S_ISLNK(i.external_attr >> 16)
                                                          and not i.flag_bits & 1 for i in info))
        check('zip_uncompressed_size_bounds', all(i.file_size <= 256 * 1024 for i in info) and sum(i.file_size for i in info) <= 4 * 1024 * 1024)
        contents = {n: zipped.read(n) for n in names}
    for n, data in contents.items():
        validate_bytes(n, data, policy)
    fresh(OUT / 'publication-artifact.zip', archive)
    artifact_dir = OUT / 'artifact'
    artifact_dir.mkdir(mode=0o700)
    for n, data in contents.items():
        fresh(artifact_dir / n, data)
    report['artifact'] = dict(pick(artifact, 'id name digest size_in_bytes created_at updated_at'),
                              actual_sha256=sha(archive), actual_size=len(archive),
                              files=[{'name': n, 'bytes': len(contents[n]), 'sha256': sha(contents[n])} for n in names])
    artifact_result = verify_bundle('artifact', artifact_dir)
    check('prerelease_identity', release['tag_name'] == TAG and release['prerelease'] and not release['draft']
          and release['target_commitish'] == SHA)
    check('release_tag_resolves_to_run_head', remote['tag']['object']['type'] == 'commit' and remote['tag']['object']['sha'] == SHA)
    report['release'] = pick(release, 'id tag_name target_commitish draft prerelease immutable html_url created_at published_at')
    report['release']['tag_object'] = pick(remote['tag']['object'], 'type sha')
    # Never persist release body. Validate only the exact source/run references in memory.
    body = release.get('body') or ''
    report['release']['body_commit_reference_matches'] = SHA in body
    report['release']['body_run_reference_matches'] = f'https://github.com/{REPO}/actions/runs/{RUN}' in body
    check('release_body_exact_source_and_run_reference', report['release']['body_commit_reference_matches'] and report['release']['body_run_reference_matches'])
    assets = release['assets']
    check('prerelease_exact_asset_allowlist', len(assets) == len(names) and {a['name'] for a in assets} == set(names))
    def asset_readback(asset):
        name = asset['name']
        check('asset_uploaded_size_bound:' + name, asset['state'] == 'uploaded' and 0 < asset['size'] <= 256 * 1024)
        data = api(f'releases/assets/{asset["id"]}', binary=True)
        validate_bytes(name, data, policy)
        check('release_asset_size:' + name, len(data) == asset['size'])
        check('release_asset_api_digest:' + name, asset['digest'] == 'sha256:' + sha(data))
        check('release_asset_equals_artifact:' + name, data == contents[name])
        record = dict(pick(asset, 'id name size digest state created_at updated_at'), actual_sha256=sha(data), artifact_bytes_equal=True)
        return name, data, record
    with ThreadPoolExecutor(max_workers=4) as pool:
        downloaded = list(pool.map(asset_readback, assets))
    release_dir = OUT / 'prerelease'
    release_dir.mkdir(mode=0o700)
    for name, data, record in downloaded:
        fresh(release_dir / name, data)
    report['release']['assets'] = [item[2] for item in downloaded]
    release_result = verify_bundle('prerelease', release_dir)
    report['internal_verifier'] = {'artifact': artifact_result['status'], 'prerelease': release_result['status']}
    # Bind every file actually consumed by both verifier processes to the trusted main tree.
    bound_reads = {}
    for result in (artifact_result, release_result):
        for entry in result.get('source_files_read', []):
            path = entry['path']
            trusted_bytes = command(['git', 'show', SHA + ':' + path])
            trusted_sha256 = sha(trusted_bytes)
            check('verifier_read_matches_trusted_main:' + path, entry['sha256'] == trusted_sha256)
            check('verifier_source_read_still_same:' + path, sha((SOURCE / path).read_bytes()) == trusted_sha256)
            bound_reads[path] = {'path': path, 'sha256': trusted_sha256}
    report['verified_source_read_bindings'] = list(bound_reads.values())

    summary = json.loads(contents['local-migration-summary.json'])
    smoke = json.loads(contents['local-closure-smoke.json'])
    browser = json.loads(contents['local-browser-route-diagnostics.json'])
    report['bounded_receipt_summary'] = {
        'commit_sha256': summary['commit_sha256'], 'ledger_count': summary['ledger_count'],
        'readback_row_count': summary['readback_row_count'], 'sequence_count': len(summary['sequence']),
        'source_chain_sha256': summary['source_chain_sha256'],
        'closure_function_count': smoke['functionCount'], 'closure_smoke_status': smoke['closureSmoke']['status'],
        'rpc_passed': smoke['rpcSmoke']['passed'], 'rpc_failed': smoke['rpcSmoke']['failed'],
        'candidate_rpc_count': smoke['candidateRpcSmoke']['candidateCount'],
        'candidate_rpc_passed': smoke['candidateRpcSmoke']['passed'],
        'browser_test_groups': len(browser['tests']), 'browser_record_count': browser['record_count'],
        'browser_request_count': browser['request_count'],
    }
    branch_after = api('branches/main')
    report['main_after'] = {'sha': branch_after['commit']['sha'], 'protected': branch_after['protected']}
    release_after = api('releases/' + str(release['id']))
    asset_fields = 'id name size digest state updated_at'
    before_assets = sorted((pick(a, asset_fields) for a in assets), key=lambda a: a['name'])
    after_assets = sorted((pick(a, asset_fields) for a in release_after['assets']), key=lambda a: a['name'])
    check('release_assets_stable_during_readback', before_assets == after_assets)
    check('main_still_same_protected_head', report['main_after'] == report['main_before'])
    report['source_after'] = local_state(SOURCE)
    report['original_after'] = local_state(ORIGINAL)
    check('source_checkout_unchanged', report['source_after'] == report['source_before'])
    check('original_checkout_status_unchanged', report['original_after'] == report['original_before'])
    report['technical_recovery_evidence_complete'] = all(c['pass'] for c in checks)
    report['automatic_issue_closure_eligible'] = run['event'] == 'schedule' and report['technical_recovery_evidence_complete']
    report['manual_issue_closure_evidence_sufficient'] = report['technical_recovery_evidence_complete']
    report['issue_mutated'] = False
    report['limitations'] = [
        'workflow_dispatch run; scheduled-run incident auto-closure policy was not exercised',
        'source checkout changed concurrently before attempt 02; committed tree remains identical, and every verifier-read file was checked against the trusted main Git object',
        'allowlisted browser request groups are not a complete Playwright test-count report; unit totals are not published',
        'public row-free evidence cannot independently reconstruct private runtime rows or prove hosted/production state',
        'GitHub release immutable=false; hashes describe this readback instant',
        'operations document tag example differs from actual workflow tag; workflow source and observed tag were used',
    ]
except BaseException as error:
    report['technical_recovery_evidence_complete'] = False
    report['failure'] = {'type': type(error).__name__, 'code': str(error) if isinstance(error, RuntimeError) else 'unclassified_readback_failure'}
finally:
    report['completed_at'] = datetime.now(timezone.utc).isoformat()
    # Do not append a write check while serializing its own check list.
    with (OUT / 'readback.json').open('x') as stream:
        json.dump(report, stream, indent=2, sort_keys=True)
        stream.write('\n')
    print(json.dumps({'status': 'pass' if report.get('technical_recovery_evidence_complete') else 'fail',
                      'checks': len(checks), 'failed_checks': [c['check'] for c in checks if not c['pass']],
                      'failure': report.get('failure'), 'evidence': str(OUT / 'readback.json')}, indent=2))
raise SystemExit(0 if report.get('technical_recovery_evidence_complete') else 1)
