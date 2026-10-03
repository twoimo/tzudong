#!/usr/bin/env python3
"""Balanced owner membership only in the isolated, hash-bound catalog replay."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCES = {
    '3584d659ad253971771bc1a1f49e2f19e837e609e375c22c078673095105a5fa',
    '6cd66d48f9fde8b86d89f089da3a5f4cc15dd85475fa0769e5724d40f68d2b95',
    'd45da517fb2efd94da50c0dc1b78312965f7177a6829b9fb197a0b9d5f144436',
}
BUNDLE_SHA256 = '15c849887cf3cd9641181545146bbf1226b3c0a2dc45f84d892022dd9041f5a5'


def transform(source: bytes, bundle: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() not in SOURCES:
        raise ValueError('storyboard_history_source_drift')
    if hashlib.sha256(bundle).hexdigest() != BUNDLE_SHA256:
        raise ValueError('storyboard_history_bundle_drift')
    if source.count(b'BEGIN;\n') != 1 or source.count(b'COMMIT;\n') != 1:
        raise ValueError('storyboard_history_transaction_drift')
    window = json.loads(bundle)['replayMembershipWindows']
    admission = ('\n'.join([window['precondition'], window['grantStatement']])+'\n').encode()
    cleanup = ('\n'.join([window['revokeStatement'], window['postcondition']])+'\n').encode()
    result = source.replace(b'BEGIN;\n', b'BEGIN;\n'+admission, 1).replace(b'COMMIT;\n', cleanup+b'COMMIT;\n', 1)
    if result.replace(admission,b'',1).replace(cleanup,b'',1) != source:
        raise ValueError('storyboard_history_body_drift')
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    with args.output.open('xb') as output:
        output.write(transform(args.source.read_bytes(),args.bundle.read_bytes()))
