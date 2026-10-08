#!/usr/bin/env python3
"""Hash-bound PG15 registration window; never a hosted PG17 admission proof."""
import argparse
import hashlib
from pathlib import Path

SOURCES = {
    '20261004190259_admin_record_guarded_actions.sql': '04d993212374b7be75e39452a189e6a990282f08e1993d622a4b24df681f1294',
    '20261004194715_admin_evaluation_raw_warning_invoker_contract.sql': 'e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020',
}
GUARD_START = b" IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN\n"
GUARD_END = b"\n END IF;"
REVOKE = b"IF temporary_grant THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres'; END IF;"
LEGACY_REVOKE = b"IF temporary_grant THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres'; END IF;"
LEGACY_WINDOW = b""" -- Explicit isolated PG15 replay only. PG17 membership options are not attested.
 IF current_setting('server_version_num')::int/10000<>15 THEN
  RAISE EXCEPTION 'REGISTRATION_REPLAY_PG15_REQUIRED';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole) THEN
  RAISE EXCEPTION 'REGISTRATION_REPLAY_MEMBERSHIP_ALREADY_EXISTS';
 END IF;
 EXECUTE 'GRANT privacy_workflow_owner TO postgres';
 temporary_grant:=true;"""


def transform(source: bytes, name: str) -> bytes:
    if name not in SOURCES or hashlib.sha256(source).hexdigest() != SOURCES[name]:
        raise ValueError('registration_replay_source_drift')
    if source.count(GUARD_START) != 1 or source.count(REVOKE) != 1:
        raise ValueError('registration_replay_anchor_drift')
    start = source.index(GUARD_START)
    end = source.index(GUARD_END, start) + len(GUARD_END)
    guard = source[start:end]
    if b'NOT inherit_option AND NOT set_option' not in guard or b'temporary_grant:=true;' not in guard:
        raise ValueError('registration_replay_guard_drift')
    result = source.replace(guard, LEGACY_WINDOW, 1).replace(REVOKE, LEGACY_REVOKE, 1)
    if result.replace(LEGACY_WINDOW, guard, 1).replace(LEGACY_REVOKE, REVOKE, 1) != source:
        raise ValueError('registration_replay_body_drift')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('xb') as out:
        out.write(transform(args.source.read_bytes(), args.source.name))


if __name__ == '__main__':
    main()
