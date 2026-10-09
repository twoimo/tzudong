"""Separate append-only title enrichment; v1 caption registration stays byte-exact.

Planning uses current public API preimages and exact local title sources only.
This module has no provider/download calls. Shared apply is an explicit caller
step; callers must review the private plan before using apply().
"""
import hashlib
import json
import re
from pathlib import Path
from backend.knowledge_graph import caption_osk_adapter as caption
from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph.longform_analysis import file_lock

HEADING = '## Tzudong caption title enrichment'
SCHEMA = 'tzudong-caption-title/v1'
PLAN = 'tzudong-caption-title-plan/v1'


def fail(code):
    raise caption.PublicationError(code)


def title_fields(body, video_id):
    # Read a standalone registry section only, never examples in code fences.
    lines = body.splitlines(); markers = []; fence = None
    for i, line in enumerate(lines):
        match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if match:
            run, tail = match.groups()
            if fence is None: fence = (run[0], len(run))
            elif run[0] == fence[0] and len(run) >= fence[1] and not tail.strip(): fence = None
            continue
        if fence is None and line == HEADING: markers.append(i)
    if not markers: return None
    if len(markers) != 1: fail('CAPTION_TITLE_INVALID')
    i = markers[0] + 1
    if i >= len(lines) or lines[i] != '```json': fail('CAPTION_TITLE_INVALID')
    end = next((j for j in range(i + 1, len(lines)) if lines[j] == '```'), None)
    if end is None: fail('CAPTION_TITLE_INVALID')
    try:
        value = json.loads('\n'.join(lines[i + 1:end]), object_pairs_hook=projection._unique_object)
    except (ValueError, RecursionError, projection.ProjectionError): fail('CAPTION_TITLE_INVALID')
    required = {'schema', 'videoId', 'displayTitle', 'titleSha256', 'reviewSha256', 'indexSha256', 'observation'}
    if not isinstance(value, dict) or set(value) != required or value['schema'] != SCHEMA or value['videoId'] != video_id or value['observation'] != 'caption-first-pass': fail('CAPTION_TITLE_INVALID')
    title = value['displayTitle']
    if not isinstance(title, str) or not title.strip() or len(title) > 512 or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in title): fail('CAPTION_TITLE_INVALID')
    if any(not isinstance(value[k], str) or not re.fullmatch('[a-f0-9]{64}', value[k]) for k in ['titleSha256', 'reviewSha256', 'indexSha256']) or caption.digest(title.encode()) != value['titleSha256']: fail('CAPTION_TITLE_INVALID')
    return {'displayTitle': title, 'displayStage': 'caption-first-pass'}


def source_title(root, vid):
    review_path = f'source/analysis/{vid}/caption-review.json'; index_path = 'source/corpus/video-index.json'
    bindings = [caption.file_binding(path, root) for path in [review_path, index_path]]
    review_bytes = (root / review_path).read_bytes(); index_bytes = (root / index_path).read_bytes()
    if caption.digest(review_bytes) != bindings[0]['sha256'] or caption.digest(index_bytes) != bindings[1]['sha256']: fail('CAPTION_TITLE_SOURCE_CHANGED')
    review = json.loads(review_bytes); rows = json.loads(index_bytes)
    title = review.get('title'); matches = [row for row in rows if isinstance(row, dict) and row.get('id') == vid] if isinstance(rows, list) else []
    if review.get('videoId') != vid or len(matches) != 1 or matches[0].get('title') != title: fail('CAPTION_TITLE_SOURCE_INVALID')
    receipt = {'schema': SCHEMA, 'videoId': vid, 'displayTitle': title, 'titleSha256': caption.digest(title.encode()) if isinstance(title, str) else '', 'reviewSha256': bindings[0]['sha256'], 'indexSha256': bindings[1]['sha256'], 'observation': 'caption-first-pass'}
    title_fields('\n' + HEADING + '\n```json\n' + caption.canonical(receipt) + '\n```\n', vid)
    return receipt, bindings


def enriched_body(before, vid, receipt):
    metadata = projection._metadata(before['body'])
    if not metadata or metadata.get('kind') != 'video' or metadata.get('videoId') != vid or metadata.get('analysisStatus') != 'pending' or caption.RECEIPT not in before['body'] or title_fields(before['body'], vid) is not None: fail('CAPTION_TITLE_PREIMAGE_INVALID')
    return before['body'] + '\n\n' + HEADING + '\n```json\n' + caption.canonical(receipt) + '\n```\n'


def make_plan(records, root):
    if [r.get('name') for r in records] != ['YT-tzuyang-Video-' + vid for vid in caption.IDS]: fail('CAPTION_TITLE_PLAN_INVALID')
    targets = []
    for vid, before in zip(caption.IDS, records):
        caption.check_node(before, vid)
        if not re.fullmatch('sha256:[a-f0-9]{64}', str(before.get('hash'))) or not isinstance(before.get('id'), str) or not isinstance(before.get('meta'), dict): fail('CAPTION_TITLE_PREIMAGE_INVALID')
        receipt, bindings = source_title(root, vid); body = enriched_body(before, vid, receipt)
        targets.append({'videoId': vid, 'name': before['name'], 'path': before['path'], 'id': before['id'], 'meta': before['meta'], 'beforeHash': before['hash'], 'beforeBody': before['body'], 'beforeBodySha256': caption.digest(before['body'].encode()), 'body': body, 'targetBodySha256': caption.digest(body.encode()), 'sourceFiles': bindings})
    return {'schema': PLAN, 'targets': targets, 'providerCalls': 0, 'independentVideoCompletion': False}


def validate_plan(plan):
    if not isinstance(plan, dict) or plan.get('schema') != PLAN or [t.get('videoId') for t in plan.get('targets', [])] != list(caption.IDS): fail('CAPTION_TITLE_PLAN_INVALID')
    for t in plan['targets']:
        caption.check_node(t, t['videoId'])
        if caption.digest(t['beforeBody'].encode()) != t['beforeBodySha256'] or caption.digest(t['body'].encode()) != t['targetBodySha256'] or not re.fullmatch('sha256:[a-f0-9]{64}', str(t['beforeHash'])): fail('CAPTION_TITLE_PLAN_INVALID')
        # The exact append is rebuilt, preserving v1 metadata/receipt as prefix.
        fields = title_fields(t['body'], t['videoId'])
        source = t['sourceFiles']
        expected_paths = [f"source/analysis/{t['videoId']}/caption-review.json", 'source/corpus/video-index.json']
        if not fields or len(source) != 2 or [s.get('path') for s in source] != expected_paths or any(not re.fullmatch('[a-f0-9]{64}', str(s.get('sha256'))) for s in source): fail('CAPTION_TITLE_PLAN_INVALID')
        receipt = {'schema': SCHEMA, 'videoId': t['videoId'], 'displayTitle': fields['displayTitle'], 'titleSha256': caption.digest(fields['displayTitle'].encode()), 'reviewSha256': source[0]['sha256'], 'indexSha256': source[1]['sha256'], 'observation': 'caption-first-pass'}
        if enriched_body({'body': t['beforeBody']}, t['videoId'], receipt) != t['body']: fail('CAPTION_TITLE_PLAN_INVALID')


def apply(engine, root, plan):
    validate_plan(plan); results = []
    def current_target(t):
        receipt, bindings = source_title(root, t['videoId'])
        if bindings != t['sourceFiles'] or enriched_body({'body': t['beforeBody']}, t['videoId'], receipt) != t['body']: fail('CAPTION_TITLE_SOURCE_CHANGED')
        current = engine.read(t['name']); caption.check_node(current, t['videoId'])
        if current['id'] != t['id'] or any(current['meta'].get(k) != v for k, v in t['meta'].items() if k != 'updated') or (current['body'] != t['body'] and (current['hash'] != t['beforeHash'] or current['body'] != t['beforeBody'])): fail('CAPTION_TITLE_NODE_CHANGED')
        return current
    with file_lock(engine.lock):
        for t in plan['targets']: current_target(t)
        for t in plan['targets']:
            current = current_target(t); reused = current['body'] == t['body']
            if not reused: engine.api.update_node(name=t['name'], body=t['body'], expect_hash=current['hash'])
            after = engine.read(t['name']); caption.check_node(after, t['videoId'])
            if after['id'] != t['id'] or after['body'] != t['body'] or any(after['meta'].get(k) != v for k, v in t['meta'].items() if k != 'updated'): fail('CAPTION_TITLE_READBACK_REQUIRED')
            results.append({'name': t['name'], 'afterHash': after['hash'], 'reused': reused})
    return {'schema': 'tzudong-caption-title-readback/v1', 'results': results, 'providerCalls': 0, 'independentVideoCompletion': False}
