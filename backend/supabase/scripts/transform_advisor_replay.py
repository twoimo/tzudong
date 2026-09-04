#!/usr/bin/env python3
"""Adapt the immutable advisor source to its owner-only catalog assertion.

Only disposable replay uses this adapter. Both assertions still execute in the
same transaction, through a private temporary function after role cleanup.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

SOURCE_SHA256 = "ae834917e3f6c6653d570dacd27d3894d15fcac2a4f09db86f0f9d0f51815148"
ASSERTION = "PERFORM privacy_retention.assert_g014_catalog_manifest();"
BRIDGE = """DO $replay_membership_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = 'privacy_workflow_owner'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'advisor_replay_owner_membership_not_empty';
  END IF;
END
$replay_membership_preflight$;
GRANT privacy_workflow_owner TO postgres;
SET LOCAL ROLE privacy_workflow_owner;
CREATE TEMPORARY TABLE advisor_replay_guard (
  asserted boolean NOT NULL CHECK (asserted)
) ON COMMIT DROP;
REVOKE ALL ON TABLE pg_temp.advisor_replay_guard
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;
CREATE FUNCTION pg_temp.advisor_replay_assertion()
RETURNS pg_temp.advisor_replay_guard
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $replay_assertion$
DECLARE result pg_temp.advisor_replay_guard;
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  result.asserted := true;
  RETURN result;
END
$replay_assertion$;
REVOKE ALL ON FUNCTION pg_temp.advisor_replay_assertion()
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;
GRANT EXECUTE ON FUNCTION pg_temp.advisor_replay_assertion() TO postgres;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres;
DO $replay_membership_readback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = 'privacy_workflow_owner'::pg_catalog.regrole
  ) THEN
    RAISE EXCEPTION 'advisor_replay_owner_membership_not_restored';
  END IF;
END
$replay_membership_readback$;
"""


def transform(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("advisor_replay_source_drift")
    text = source.decode("utf-8")
    if text.count(ASSERTION) != 2:
        raise ValueError("advisor_replay_assertion_drift")
    return (BRIDGE + text.replace(ASSERTION, "PERFORM pg_temp.advisor_replay_assertion();")).encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_bytes(transform(args.source.read_bytes()))


if __name__ == "__main__":
    main()
