"""Bounded immutable publication checkpoint pages; legacy ledgers stay readable."""
from __future__ import annotations

import hashlib
from pathlib import Path
import re

from backend.knowledge_graph import longform_analysis as analysis

FORMAT = 'tzudong-publication-checkpoint/v2'
MAX_BYTES = 1024 * 1024
MAX_ITEMS = 2000
FANOUT = 128
MAX_DEPTH = 8


def fail():
    raise analysis.AnalysisError('PUBLICATION_CHECKPOINT_INVALID')


def save(path, ledger):
    raw = analysis.canonical(ledger)
    if len(raw) <= MAX_BYTES:
        analysis.atomic_document(path, ledger)
        return
    path = Path(path)
    directory = path.parent / '.checkpoint-pages'
    if directory.is_symlink():
        fail()
    directory.mkdir(parents=True, exist_ok=True)
    binding, source = analysis.digest(ledger['binding']), analysis.digest(ledger['source'])
    files = {}

    def emit(items, level):
        value = {'schemaVersion': 1, 'bindingSha256': binding, 'sourceSha256': source,
                 'level': level, 'items': items}
        data = analysis.canonical({'schemaVersion': 1, 'payload': value, 'sha256': analysis.digest(value)})
        if len(data) > MAX_BYTES:
            fail()
        sha = hashlib.sha256(data).hexdigest()
        name = sha + '.json'
        files[name] = (value, data)
        return {'sha256': sha, 'bytes': len(data), 'level': level,
                'count': sum(entry['count'] for entry in items) if level else len(items),
                'first': items[0]['first'] if level else items[0][0],
                'last': items[-1]['last'] if level else items[-1][0]}

    entries, batch, batch_bytes = [], [], 0
    for name, value in sorted(ledger['nodes'].items()):
        size = len(analysis.canonical([name, value])) + 1
        if batch and (len(batch) >= MAX_ITEMS or batch_bytes + size > MAX_BYTES - 1024):
            entries.append(emit(batch, 0))
            batch, batch_bytes = [], 0
        batch.append([name, value])
        batch_bytes += size
    if batch:
        entries.append(emit(batch, 0))
    level = 0
    while len(entries) > FANOUT:
        level += 1
        if level > MAX_DEPTH:
            fail()
        entries = [emit(entries[offset:offset + FANOUT], level) for offset in range(0, len(entries), FANOUT)]
    root = {key: ledger[key] for key in ('binding', 'source', 'state')}
    root.update(schemaVersion=2, format=FORMAT, totalNodes=len(ledger['nodes']), nodePages=entries)
    if len(analysis.canonical(root)) >= MAX_BYTES:
        fail()
    for name, (value, data) in files.items():
        target = directory / name
        if target.is_symlink():
            fail()
        if target.exists():
            with target.open('rb') as handle:
                if handle.read(MAX_BYTES + 1) != data:
                    fail()
        else:
            analysis.atomic_document(target, value)
    analysis.atomic_document(path, root)


def load(path):
    path = Path(path)
    root = analysis.checked_document(path)
    if root.get('format') != FORMAT:
        return root
    if set(root) != {'schemaVersion', 'format', 'binding', 'source', 'state', 'totalNodes', 'nodePages'} or root['schemaVersion'] != 2:
        fail()
    directory = path.parent / '.checkpoint-pages'
    if directory.is_symlink():
        fail()
    binding, source = analysis.digest(root['binding']), analysis.digest(root['source'])
    seen, nodes = set(), {}

    def visit(entries, expected=None):
        if not isinstance(entries, list) or len(entries) > FANOUT:
            fail()
        count, previous, shared_level = 0, '', expected
        for entry in entries:
            if (not isinstance(entry, dict) or set(entry) != {'sha256', 'bytes', 'level', 'count', 'first', 'last'}
                    or not isinstance(entry['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', entry['sha256'])
                    or entry['sha256'] in seen or type(entry['level']) is not int or not 0 <= entry['level'] <= MAX_DEPTH
                    or type(entry['count']) is not int or not 1 <= entry['count'] <= (1 << 53) - 1
                    or type(entry['bytes']) is not int or not 1 <= entry['bytes'] <= MAX_BYTES
                    or not all(isinstance(entry[key], str) and 0 < len(entry[key]) <= 120 for key in ('first', 'last'))
                    or entry['first'] > entry['last'] or entry['first'] <= previous):
                fail()
            if shared_level is None:
                shared_level = entry['level']
            if entry['level'] != shared_level:
                fail()
            previous = entry['last']
            seen.add(entry['sha256'])
            target = directory / (entry['sha256'] + '.json')
            if target.is_symlink():
                fail()
            with target.open('rb') as handle:
                raw = handle.read(MAX_BYTES + 1)
            if len(raw) != entry['bytes'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
                fail()
            document = analysis.decode(raw)
            if not isinstance(document, dict) or set(document) != {'schemaVersion', 'payload', 'sha256'} or document['schemaVersion'] != 1 or analysis.digest(document['payload']) != document['sha256']:
                fail()
            value = document['payload']
            if (not isinstance(value, dict) or set(value) != {'schemaVersion', 'bindingSha256', 'sourceSha256', 'level', 'items'}
                    or value['schemaVersion'] != 1 or value['bindingSha256'] != binding or value['sourceSha256'] != source
                    or value['level'] != entry['level'] or not isinstance(value['items'], list) or not value['items']):
                fail()
            items = value['items']
            if entry['level']:
                actual = visit(items, entry['level'] - 1)
                first, last = items[0]['first'], items[-1]['last']
            else:
                if len(items) > MAX_ITEMS:
                    fail()
                first, last, previous_name = '', '', ''
                for item in items:
                    if (not isinstance(item, list) or len(item) != 2 or not isinstance(item[0], str) or not 0 < len(item[0]) <= 120
                            or item[0] <= previous_name or item[0] in nodes or not isinstance(item[1], dict)):
                        fail()
                    nodes[item[0]] = item[1]
                    first = first or item[0]
                    last = previous_name = item[0]
                actual = len(items)
            if actual != entry['count'] or first != entry['first'] or last != entry['last']:
                fail()
            count += actual
        return count

    try:
        total = visit(root['nodePages'])
        if type(root['totalNodes']) is not int or total != root['totalNodes']:
            fail()
    except (KeyError, ValueError, OSError, TypeError):
        fail()
    return {key: root[key] for key in ('binding', 'source', 'state')} | {'nodes': nodes}
