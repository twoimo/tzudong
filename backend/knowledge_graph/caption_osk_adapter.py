"""Append-only caption registration through exact-pinned OSK APIs.

No provider/collector calls. Planning reads exact named nodes; execute is explicit.
The saved plan is the CAS preimage, not an approval or a video completion receipt.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph.longform_analysis import file_lock
from backend.knowledge_graph.osk_publication import Engine, SPACE, PublicationError

IDS = ('F93TnnxCNvY', '3Z-ngM3DVi0', 'BTyT60UWiLc', '-C4280KT3S4',
       'Tsy8xRjMpB0', 'xRf_bhPFZrY', 'zkOBLQUSEr0', 'DNGGl1-jFcU', 'Ck5UrobZuKA')
RECEIPT = '## Tzudong caption registration receipt'

def fail(code):
    raise PublicationError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def file_binding(path, root):
    root = root.resolve(strict=True)
    relative = Path(path)
    if relative.is_absolute() or '..' in relative.parts:
        fail('CAPTION_SOURCE_INVALID')
    p = root / relative
    if any(x.is_symlink() for x in [p, *p.parents] if x.is_relative_to(root)) or not p.resolve().is_relative_to(root):
        fail('CAPTION_SOURCE_INVALID')
    data = p.read_bytes()
    if len(data) > 4 * 1024 * 1024:
        fail('CAPTION_SOURCE_INVALID')
    return {'path': relative.as_posix(), 'sha256': digest(data), 'bytes': len(data)}

def source_bindings(root, vid):
    review_path = f'source/analysis/{vid}/caption-review.json'
    review = json.loads((root / review_path).read_text())
    if review.get('videoId') != vid or set(review.get('sourceVersions', {})) != {'ko', 'koOrig'}:
        fail('CAPTION_SOURCE_INVALID')
    bindings = [file_binding(review_path, root)]
    for version in review['sourceVersions'].values():
        for field, hash_keys in [('subtitleFile', ('subtitleSha256', 'sourceSha256')),
                                 ('transcriptFile', ('transcriptSha256',))]:
            binding = file_binding(version[field], root)
            expected = [version[k] for k in hash_keys if k in version]
            if not expected or any(h != binding['sha256'] for h in expected):
                fail('CAPTION_SOURCE_HASH_MISMATCH')
            bindings.append(binding)
    return sorted(bindings, key=lambda x: x['path'])

def append_registration(before, vid, bindings, coverage):
    if projection._metadata(before['body']) is not None or RECEIPT in before['body']:
        fail('CAPTION_NODE_ALREADY_REGISTERED')
    metadata = {'schemaVersion': 1, 'kind': 'video', 'videoId': vid, 'analysisStatus': 'pending',
                'displayLabel': f'{vid} · 자막 1차 검토', 'evidence': [
                    {'videoId': vid, 'startSeconds': 0, 'endSeconds': None,
                     'url': f'https://www.youtube.com/watch?v={vid}', 'status': 'unverified'}]}
    receipt = {'schema': 'tzudong-caption-registration/v1', 'videoId': vid,
               'originalBodySha256': digest(before['body'].encode()), 'sourceFiles': bindings,
               'coverageRevision': coverage, 'observation': 'caption-first-pass',
               'independentFullVisualVerified': False, 'independentAudioVerified': False,
               'evidenceIntervalMeaning': 'Untimed source link; start=0/end=null is not viewing coverage.',
               'modelConfigBinding': None}
    result = before['body'] + '\n\n' + projection.METADATA_HEADING + '\n```json\n' + canonical(metadata) + '\n```\n\n' + RECEIPT + '\n```json\n' + canonical(receipt) + '\n```\n'
    if projection._metadata(result) != metadata:
        fail('CAPTION_NODE_BODY_INVALID')
    projection._evidence(metadata['evidence'])
    return result

def check_node(node, vid):
    name = 'YT-tzuyang-Video-' + vid
    if not node or node.get('name') != name or node.get('path') != SPACE + '/' + name + '.md':
        fail('CAPTION_NODE_PREIMAGE_MISMATCH')


def plan(engine, root, memberships):
    records = []
    for tab, path in memberships.items():
        data = json.loads(path.read_text())
        if data.get('tab') != tab or data.get('channelId') != 'UCfpaSruWW3S4dibonKXENjA':
            fail('CAPTION_COVERAGE_INVALID')
        records.append({'tab': tab, 'sha256': digest(path.read_bytes()), 'entryCount': len(data['rows'])})
    eligible = set()
    for path in memberships.values():
        for row in json.loads(path.read_text())['rows']:
            if not projection.VIDEO_ID.fullmatch(row['id']) or row['id'] in eligible:
                fail('CAPTION_COVERAGE_INVALID')
            eligible.add(row['id'])
    if not set(IDS) <= eligible:
        fail('CAPTION_COVERAGE_INVALID')
    coverage = {'schema': 'caption-membership-revision/v1', 'eligibleCount': len(eligible),
                'inputs': sorted(records, key=lambda x: x['tab'])}
    coverage['revision'] = digest(canonical(coverage).encode())
    targets = []
    for vid in IDS:
        node = engine.read('YT-tzuyang-Video-' + vid)
        check_node(node, vid)
        bindings = source_bindings(root, vid)
        body = append_registration(node, vid, bindings, coverage)
        targets.append({'videoId': vid, 'name': node['name'], 'path': node['path'], 'id': node['id'],
                        'beforeHash': node['hash'], 'beforeBodySha256': digest(node['body'].encode()),
                        'meta': node['meta'], 'sourceFiles': bindings, 'body': body,
                        'targetBodySha256': digest(body.encode())})
    return {'schema': 'tzudong-caption-plan/v1', 'coverageRevision': coverage, 'targets': targets,
            'providerCalls': 0, 'sharedVaultWrites': 0}


def validate_plan(saved):
    if saved.get('schema') != 'tzudong-caption-plan/v1' or [t['videoId'] for t in saved['targets']] != list(IDS):
        fail('CAPTION_PLAN_INVALID')
    coverage = dict(saved['coverageRevision']); revision = coverage.pop('revision')
    if digest(canonical(coverage).encode()) != revision:
        fail('CAPTION_PLAN_INVALID')
    for t in saved['targets']:
        check_node(t, t['videoId'])
        body = t['body']
        if digest(body.encode()) != t['targetBodySha256']:
            fail('CAPTION_PLAN_INVALID')
        original, separator, suffix = body.rpartition('\n\n' + projection.METADATA_HEADING)
        if not separator or digest(original.encode()) != t['beforeBodySha256']:
            fail('CAPTION_PLAN_INVALID')
        before = {'body': original}
        if append_registration(before, t['videoId'], t['sourceFiles'], saved['coverageRevision']) != body:
            fail('CAPTION_PLAN_INVALID')


def apply(engine, root, saved):
    validate_plan(saved)
    results = []
    with file_lock(engine.lock):
        # Check the entire set before the first mutation; do not silently replan.
        for t in saved['targets']:
            if source_bindings(root, t['videoId']) != t['sourceFiles']:
                fail('CAPTION_SOURCE_CHANGED')
            current = engine.read(t['name']); check_node(current, t['videoId'])
            if current['id'] != t['id'] or any(current['meta'].get(k) != v for k, v in t['meta'].items() if k != 'updated') or (current['hash'] != t['beforeHash'] and current['body'] != t['body']):
                fail('CAPTION_NODE_CHANGED')
        for t in saved['targets']:
            if source_bindings(root, t['videoId']) != t['sourceFiles']:
                fail('CAPTION_SOURCE_CHANGED')
            current = engine.read(t['name']); check_node(current, t['videoId'])
            if current['id'] != t['id']:
                fail('CAPTION_NODE_CHANGED')
            reused = current['body'] == t['body']
            if not reused:
                if current['hash'] != t['beforeHash']:
                    fail('CAPTION_NODE_CHANGED')
                try:
                    engine.api.update_node(name=t['name'], body=t['body'], expect_hash=current['hash'])
                except Exception:
                    # Only readback may resolve an uncertain ACK; never resend.
                    pass
            after = engine.read(t['name']); check_node(after, t['videoId'])
            if after['body'] != t['body'] or after['id'] != t['id'] or any(
                    after['meta'].get(k) != v for k, v in t['meta'].items() if k != 'updated'):
                fail('CAPTION_WRITE_READBACK_REQUIRED')
            results.append({'name': t['name'], 'afterHash': after['hash'], 'reused': reused})
    return {'code': 'CAPTION_REGISTRATION_READBACK', 'results': results, 'providerCalls': 0,
            'independentVideoCompletion': False, 'coverageRevision': saved['coverageRevision']}


def write_private_output(path, result):
    data = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        # Preserve exact 0600 even when the caller has a restrictive umask.
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)


def main():
    p = argparse.ArgumentParser();p.add_argument('--vault', type=Path, required=True);p.add_argument('--engine', type=Path, required=True)
    p.add_argument('--channel-root', type=Path, required=True);p.add_argument('--videos-membership', type=Path);p.add_argument('--streams-membership', type=Path)
    p.add_argument('--plan', type=Path);p.add_argument('--execute', action='store_true');p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    try:
        if args.output.exists() or args.output.resolve().is_relative_to(args.vault.resolve()):
            fail('CAPTION_OUTPUT_INVALID')
        engine = Engine(args.vault, args.engine);engine.overview()
        if args.execute:
            if not args.plan: fail('CAPTION_PLAN_REQUIRED')
            result = apply(engine, args.channel_root.resolve(), json.loads(args.plan.read_text()))
        else:
            if not args.videos_membership or not args.streams_membership: fail('CAPTION_COVERAGE_INVALID')
            result = plan(engine, args.channel_root.resolve(), {'videos': args.videos_membership, 'streams': args.streams_membership})
        write_private_output(args.output, result)
        print(json.dumps({'code': 'CAPTION_PLAN_READY' if not args.execute else result['code'], 'providerCalls': 0}))
    except Exception as exc:
        code = str(exc) if isinstance(exc, PublicationError) else 'CAPTION_ADAPTER_FAILED'
        print(json.dumps({'code': code}));return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
