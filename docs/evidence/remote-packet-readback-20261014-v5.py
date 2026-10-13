"""Verify current-date detached pins from an exact remote Git object in isolation."""
import datetime
import importlib.util
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


def main():
    root = Path.cwd()
    branch = 'codex/goal-evidence-20261013-v1'
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    remote = subprocess.check_output(['git', 'ls-remote', 'origin', 'refs/heads/' + branch], text=True).split()[0]
    if head != remote:
        raise ValueError('REMOTE_HEAD_MISMATCH')
    pins = []
    for p in sorted((root / 'docs/evidence').glob('*2026101[34]*.json')):
        record = json.loads(p.read_bytes())
        if isinstance(record, dict) and 'map' in record and 'mappedFiles' in record:
            pins.append((p, record))
    paths = ['docs/evidence/verify-packet-20261013.py']
    paths += [str(p.relative_to(root)) for p, _ in pins]
    paths += [str(Path(record['map']).parent) for _, record in pins]
    spec = importlib.util.spec_from_file_location('packet_verifier', root / paths[0])
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    with tempfile.TemporaryDirectory(prefix='tzudong-packet-readback-v3-') as td:
        temporary = Path(td)
        tar = temporary / 'packet.tar'
        subprocess.run(['git', 'archive', '--format=tar', '--output', str(tar), head, *paths], check=True)
        checkout = temporary / 'readback'
        checkout.mkdir()
        with tarfile.open(tar) as archive:
            # Mac python3 currently lacks extractall(filter=...). Explicitly
            # reject every link, special file, absolute path and traversal first.
            for member in archive.getmembers():
                if member.name.startswith('/') or '..' in Path(member.name).parts or not (member.isfile() or member.isdir()):
                    raise ValueError('ARCHIVE_PATH_REJECTED')
            archive.extractall(checkout)
        results = []
        for p, _ in pins:
            remote_pin = checkout / p.relative_to(root)
            if remote_pin.read_bytes() != p.read_bytes():
                raise ValueError('REMOTE_PIN_MISMATCH')
            results.append({'pin': p.name, **verifier.verify(checkout, remote_pin)})
        receipt = {
            'branch': branch, 'remoteCommit': remote,
            'observedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'pythonVersion': sys.version.split()[0],
            'gitObjectTransportVerified': True, 'isolatedReadback': True,
            'allVerified': True, 'packets': results,
            'verifiedMappedFiles': sum(row['files'] for row in results),
            'priorAttempt': {'completed': False, 'reason': 'python39_extractall_filter_unavailable', 'receiptWritten': False},
        }
        output = root / 'docs/evidence/remote-packet-readback-20261014-v5.json'
        with output.open('x') as f:
            json.dump(receipt, f, indent=2)
            f.write('\n')
        print(json.dumps({'packets': len(results), 'mappedFiles': receipt['verifiedMappedFiles'], 'allVerified': True, 'remoteCommit': remote}))


if __name__ == '__main__':
    main()
