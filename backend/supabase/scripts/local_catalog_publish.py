#!/usr/bin/env python3
"""Prepare, explicitly apply, or recover one selected hosted catalog operation.

Requires separately deployed, approved publish RPCs. Release evidence and freeze
clearance are operator responsibilities; this command never changes those gates.
"""
import argparse
import json
import os
from pathlib import Path
import sys

import local_catalog_workspace as catalog
from catalog_publish_operator import PublishOperator
from catalog_publish_transport import HostedCatalogRpc, PublishRpcError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare', help='Read-only DB preview for one selected candidate')
    prepare.add_argument('--review-sha256', required=True)
    prepare.add_argument('--restaurant-id', required=True)
    prepare.add_argument('--actor-id', required=True)
    apply = commands.add_parser('apply', help='Apply one explicitly approved prepared operation once')
    apply.add_argument('--prepared-sha256', required=True)
    apply.add_argument('--confirmation', required=True)
    apply.add_argument('--approval-file', type=Path, required=True)
    readback = commands.add_parser('readback', help='Read the same operation after an uncertain result; never reapply')
    readback.add_argument('--prepared-sha256', required=True)
    for command in (prepare, apply, readback):
        command.add_argument('--source-env', type=Path, required=True)
    args = parser.parse_args()
    ex, _ = catalog.executor()
    _, state, _ = ex._binding()
    rpc = HostedCatalogRpc(catalog.credentials(args.source_env), allow_apply=args.command == 'apply')
    operator = PublishOperator(state / 'working-catalog', ex._expected_project(), rpc,
                               local_digest=lambda: catalog.local_state(ex)['digest'])
    if args.command == 'prepare':
        result = operator.prepare(args.review_sha256, args.restaurant_id, args.actor_id)
        result['preview_file'] = str(state / 'working-catalog' / (result['prepared_sha256'] + '.publish-prepared.json'))
    elif args.command == 'apply':
        result = operator.apply(args.prepared_sha256, confirmation=args.confirmation,
                                approval_file=args.approval_file, environment=os.environ)
    else:
        result = operator.readback(args.prepared_sha256)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, (catalog.CatalogError, PublishRpcError)) else 'publish_operation_failed'
        print(json.dumps({'error': code, 'next': 'Use readback for an existing prepared operation before any new apply.'}), file=sys.stderr)
        raise SystemExit(1)
