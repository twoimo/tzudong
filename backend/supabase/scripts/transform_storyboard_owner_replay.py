"""Hash-bound PG15 source-only owner lease; never a hosted apply path."""
from pathlib import Path
import argparse
import hashlib

SOURCE_NAME = '20260918021531_storyboard_mlx_worker.sql'
SOURCE_SHA256 = '3584d659ad253971771bc1a1f49e2f19e837e609e375c22c078673095105a5fa'
SOURCE_BYTES = 44490
SOURCE_BINDINGS = {
    SOURCE_NAME: (SOURCE_SHA256, SOURCE_BYTES),
    '20260920021531_storyboard_historical_restore.sql': ('6cd66d48f9fde8b86d89f089da3a5f4cc15dd85475fa0769e5724d40f68d2b95', 39070),
}
PREFIX = b'''BEGIN;
CREATE TEMP TABLE storyboard_owner_lease (needed boolean, members text) ON COMMIT DROP;
DO $lease$ BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 15 THEN
    RAISE EXCEPTION 'STORYBOARD_REPLAY_ACTOR_DENIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'STORYBOARD_REPLAY_OWNER_SHAPE';
  END IF;
  INSERT INTO pg_temp.storyboard_owner_lease SELECT
    NOT pg_has_role('postgres','privacy_workflow_owner','MEMBER'),
    encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m),'UTF8')),'hex');
  IF (SELECT needed FROM pg_temp.storyboard_owner_lease) THEN
    GRANT privacy_workflow_owner TO postgres;
  END IF;
END $lease$;
'''
SUFFIX = b'''
DO $lease$ BEGIN
  IF (SELECT needed FROM pg_temp.storyboard_owner_lease) THEN
    REVOKE privacy_workflow_owner FROM postgres;
  END IF;
  IF (SELECT members FROM pg_temp.storyboard_owner_lease) IS DISTINCT FROM
    encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'STORYBOARD_REPLAY_MEMBERSHIP_DRIFT';
  END IF;
END $lease$;
COMMIT;
'''

def transform(source, name=SOURCE_NAME):
    binding = SOURCE_BINDINGS.get(name)
    if binding is None or (hashlib.sha256(source).hexdigest(), len(source)) != binding:
        raise ValueError('STORYBOARD_REPLAY_SOURCE_DRIFT')
    lines = source.splitlines(keepends=True)
    if sum(line.strip(b'\r\n') == b'BEGIN;' for line in lines) != 1 or sum(line.strip(b'\r\n') == b'COMMIT;' for line in lines) != 1:
        raise ValueError('STORYBOARD_REPLAY_TRANSACTION_DRIFT')
    return PREFIX + b''.join(line for line in lines if line.strip(b'\r\n') not in (b'BEGIN;', b'COMMIT;')) + SUFFIX

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.source.name not in SOURCE_BINDINGS:
        raise ValueError('STORYBOARD_REPLAY_SOURCE_IDENTITY')
    with args.output.open('xb') as file:
        file.write(transform(args.source.read_bytes(), args.source.name))

if __name__ == '__main__':
    main()
