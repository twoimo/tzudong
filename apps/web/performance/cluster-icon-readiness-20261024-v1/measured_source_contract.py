"""Verify retained fixture inputs, independently of later live integration edits."""
import hashlib
import json
import base64


def verify_measured_sources(root, raw):
    contract = json.loads((root / 'measured-source-contract.json').read_text())
    assert contract['schemaVersion'] == 'cluster-icon-readiness.measured-source.v1'
    assert contract['sourceRevision'] == '0b0ef0f8c6a6d0adf9eb92713e4dccf1b8fa60f2'
    assert hashlib.sha256((root / 'raw.json').read_bytes()).hexdigest() == contract['rawSha256']
    files = {item['sourcePath']: item for item in contract['files']}
    assert len(files) == len(contract['files']) and set(files) == set(raw['sourceHashes'])
    snapshot_root = (root / 'measured-source').resolve()
    for name, digest in raw['sourceHashes'].items():
        item = files[name]
        path = (root / item['snapshotPath']).resolve()
        assert path.is_relative_to(snapshot_root), name
        stored = path.read_bytes()
        if item.get('encoding') == 'base64':
            data = base64.b64decode(stored.rstrip(b'\n'), validate=True)
            assert stored == base64.b64encode(data) + b'\n', name
        else:
            assert item.get('encoding', 'utf8') == 'utf8', name
            data = stored
        assert len(data) == item['bytes'], name
        assert hashlib.sha256(data).hexdigest() == digest == item['sha256'], name
    return contract['sourceRevision']
