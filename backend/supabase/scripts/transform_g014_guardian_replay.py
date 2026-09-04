#!/usr/bin/env python3
"""Move one source-only replay assertion after temporary role cleanup.

The canonical migration stays byte-identical. This adapter cannot be used as a
hosted migration: the catalog generator records its transformed hash separately.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

SOURCE_SHA256 = "060bb9b6d27c08704ba1fad7a299c0599673dcfc177b227580dc1ceb921c0015"
ASSERTION = "SELECT privacy_retention.assert_g014_catalog_contract();"
END = "RESET ROLE;\nCOMMIT;"
BRIDGE = """CREATE TEMPORARY TABLE g014_guardian_replay_guard (
  asserted boolean NOT NULL CHECK (asserted)
) ON COMMIT DROP;
REVOKE ALL ON TABLE pg_temp.g014_guardian_replay_guard
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;
CREATE FUNCTION pg_temp.g014_guardian_replay_assertion()
RETURNS pg_temp.g014_guardian_replay_guard
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $replay_assertion$
DECLARE result pg_temp.g014_guardian_replay_guard;
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
  result.asserted := true;
  RETURN result;
END
$replay_assertion$;
REVOKE ALL ON FUNCTION pg_temp.g014_guardian_replay_assertion()
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;
DO $replay_executor$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION pg_temp.g014_guardian_replay_assertion() TO %I',
    session_user
  );
END
$replay_executor$;"""
FINAL = "RESET ROLE;\nSELECT (pg_temp.g014_guardian_replay_assertion()).asserted;\nCOMMIT;"


def transform(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("guardian_replay_source_drift")
    text = source.decode("utf-8")
    if text.count(ASSERTION) != 1 or text.count(END) != 1:
        raise ValueError("guardian_replay_anchor_drift")
    return text.replace(ASSERTION, BRIDGE).replace(END, FINAL).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_bytes(transform(args.source.read_bytes()))


if __name__ == "__main__":
    main()
