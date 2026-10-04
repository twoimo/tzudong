#!/usr/bin/env python3
"""Hash-bound owner execution for the isolated source catalog replay only."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCE_SHA256 = '527286d204fc8a5b07891763535fcb27ce6e28a0e2489c27796a63bc306b6f9c'
MANUAL_SOURCE_SHA256 = '8ce3a87564b8b5bb2c4caffd1b62bc2f50c3055f11fc7dc3e2fa9700cffa1af3'
PAGE_SOURCE_SHA256 = '4471f02096c0c7ee73d074ea7a3c4c0c36674edbaacbf998f4059d7b48d1f095'
BUNDLE_SHA256 = '15c849887cf3cd9641181545146bbf1226b3c0a2dc45f84d892022dd9041f5a5'


def transform(source, bundle):
    if hashlib.sha256(source).hexdigest() not in (SOURCE_SHA256, MANUAL_SOURCE_SHA256, PAGE_SOURCE_SHA256):
        raise ValueError('service_invoker_replay_source_drift')
    if hashlib.sha256(bundle).hexdigest() != BUNDLE_SHA256:
        raise ValueError('service_invoker_replay_bundle_drift')
    window = json.loads(bundle)['replayMembershipWindows']
    begin = b'BEGIN;\n'
    commit = b'COMMIT;\n'
    if source.count(begin) != 1 or source.count(commit) != 1:
        raise ValueError('service_invoker_replay_transaction_drift')
    admission = ('\n'.join([window['precondition'], window['grantStatement'], 'SET LOCAL ROLE privacy_workflow_owner;']) + '\n').encode('ascii')
    cleanup = ('\n'.join(['RESET ROLE;', window['revokeStatement'], window['postcondition']]) + '\n').encode('ascii')
    transformed = source.replace(begin, begin + admission, 1).replace(commit, cleanup + commit, 1)
    if transformed.replace(admission, b'', 1).replace(cleanup, b'', 1) != source:
        raise ValueError('service_invoker_replay_body_drift')
    return transformed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('xb') as output:
        output.write(transform(args.source.read_bytes(), args.bundle.read_bytes()))


if __name__ == '__main__':
    main()
