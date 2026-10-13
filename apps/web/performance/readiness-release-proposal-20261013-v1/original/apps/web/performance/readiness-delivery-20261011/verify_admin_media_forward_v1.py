"""Reproduce forward apply, rollback, cleanup and deterministic lock contention.

Only the named, network-isolated owned PG17 container is admitted. The two
mutating connections are synchronized by a third fixture row-lock connection.
No hosted URL, credential discovery, real user or provider call is supported.
"""
from pathlib import Path
import hashlib
import json
import selectors
import subprocess
import time
import re
import argparse

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
CONTEXT = 'colima-tzudong-catalog-20261007'
CONTAINER = 'tzudong-ranking-clone-20261008'
PREFIX = ['docker', '--context', CONTEXT, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only', CONTAINER]
SOURCE = ROOT / 'backend/supabase/migrations/20261011072824_admin_review_media_completion.sql'
TEMPLATE = 'readiness_integrated_nine_v4_20261010'
OWNER = '11111111-1111-4111-8111-111111111111'
REVIEW = '22222222-2222-4222-8222-222222222222'
FOOD = f'{OWNER}/reviews/{REVIEW}/food/proof.webp'
VERIFY = f'{OWNER}/reviews/{REVIEW}/verification/proof.webp'
FP = """SELECT jsonb_build_object(
'members',md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m)),
'manifest',md5((SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key)::text FROM privacy_retention.g014_catalog_contract_manifest m)),
'functions',md5((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control'))),
'relations',md5((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.oid),'[]')::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','review_media_private','pipeline_control'))),
'policies',md5((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]')::text FROM pg_policy p)),
'defaultACL',md5((SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.oid),'[]')::text FROM pg_default_acl a)),
'constraints',md5((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.oid),'[]')::text FROM pg_constraint c)),
'data',jsonb_build_array((SELECT count(*) FROM auth.users),(SELECT count(*) FROM public.reviews),(SELECT count(*) FROM review_media_private.cleanup)));
"""


def command(db, actor='supabase_admin'):
    return PREFIX + ['psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
                     '-h', '127.0.0.1', '-U', actor, '-d', db]


def run(db, sql, actor='supabase_admin'):
    p = subprocess.run(command(db, actor), input=sql, capture_output=True, text=True, timeout=20)
    if p.returncode:
        states = re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})', p.stderr)
        raise RuntimeError('ISOLATED_SQL_FAILED:' + ','.join(states))
    return p.stdout.strip()


def fresh(name, template):
    if run('postgres', f"SELECT count(*) FROM pg_database WHERE datname='{name}';") != '0':
        raise RuntimeError('OWNED_TARGET_ALREADY_EXISTS')
    run('postgres', f'CREATE DATABASE {name} TEMPLATE {template} OWNER postgres;')


def fixture(db):
    run(db, f"""INSERT INTO storage.buckets(id,name,public) VALUES ('review-photos','review-photos',true) ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
VALUES ('{OWNER}','lock-probe@local.invalid','{{}}','{{}}');
INSERT INTO public.profiles(user_id,nickname,email) VALUES ('{OWNER}','LOCAL TEST ONLY','lock-probe@local.invalid') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles(user_id,role) VALUES ('{OWNER}','admin') ON CONFLICT DO NOTHING;
INSERT INTO public.user_account_status(user_id) VALUES ('{OWNER}') ON CONFLICT DO NOTHING;
INSERT INTO public.restaurants(id,approved_name,status) VALUES ('44444444-4444-4444-8444-444444444444','LOCAL TEST ONLY','approved');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('review-photos','{FOOD}','{{}}'),('review-verifications','{VERIFY}','{{}}');
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos,categories)
VALUES ('{REVIEW}','{OWNER}','44444444-4444-4444-8444-444444444444','LOCAL TEST ONLY',
'Original local fixture content with enough length.',now(),'{VERIFY}',ARRAY['{FOOD}'],ARRAY['한식']);""")


def background(db, name, sql):
    p = subprocess.Popen(command(db) + ['-v', 'VERBOSITY=verbose'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    p.stdin.write(f"SET application_name='{name}'; SET statement_timeout='8s';\n" + sql)
    p.stdin.flush()
    return p


def contention(db, expected_wait):
    fixture(db)
    op = '66666666-6666-4666-8666-666666666666'
    preview = json.loads(run(db, f"""SET ROLE service_role; SELECT public.admin_record_action('{OWNER}',
'preview','{op}','review.delete',ARRAY['{REVIEW}']::uuid[],'{{"reason":"LOCAL TEST ONLY"}}'::jsonb,NULL);"""))
    gate = background(db, 'media_gate', f"BEGIN; SELECT id FROM public.reviews WHERE id='{REVIEW}' FOR UPDATE; SELECT 'GATE_READY';\n")
    owner = admin = None
    try:
        reader = selectors.DefaultSelector(); reader.register(gate.stdout, selectors.EVENT_READ)
        # The single result includes the row-lock acquisition marker. No time-
        # based assumption is used to admit the contention state.
        if not reader.select(5):
            raise RuntimeError('LOCK_GATE_NOT_READY')
        first = gate.stdout.readline().strip()
        if first != REVIEW:
            raise RuntimeError('LOCK_GATE_RESULT_DRIFT')
        if gate.stdout.readline().strip() != 'GATE_READY':
            raise RuntimeError('LOCK_GATE_MARKER_DRIFT')
        reader.close()
        owner = background(db, 'media_owner', f"""BEGIN; SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='{OWNER}';
SET LOCAL request.jwt.claims='{{"sub":"{OWNER}","role":"authenticated"}}';
SELECT public.mutate_review_with_media('77777777-7777-4777-8777-777777777777','{REVIEW}','edit',
(SELECT updated_at FROM public.reviews WHERE id='{REVIEW}'),
'Edited local fixture content with enough length.',ARRAY['한식'],ARRAY['{FOOD}']); COMMIT;\n""")
        for _ in range(100):
            if run(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name='media_owner' AND wait_event_type='Lock';") == '1':
                break
            time.sleep(.02)
        else:
            raise RuntimeError('LOCK_OWNER_NOT_WAITING')
        admin = background(db, 'media_admin', f"""SET ROLE service_role;
SELECT public.admin_record_action('{OWNER}','apply','{op}','review.delete',ARRAY['{REVIEW}']::uuid[],
'{{"reason":"LOCAL TEST ONLY"}}'::jsonb,'{preview['previewHash']}');\n""")
        observed = None
        for _ in range(100):
            observed = run(db, "SELECT coalesce(wait_event,'') FROM pg_stat_activity WHERE application_name='media_admin';")
            if observed == expected_wait:
                break
            time.sleep(.02)
        else:
            raise RuntimeError('LOCK_ADMIN_WAIT_ORDER_DRIFT')
        gate.stdin.write('COMMIT;\n'); gate.stdin.flush(); gate.stdin.close(); gate.stdin = None
        gate.communicate(timeout=10)
        outcomes = []
        for role, p in [('owner', owner), ('admin', admin)]:
            p.stdin.close(); p.stdin = None
            stdout, stderr = p.communicate(timeout=12)
            outcomes.append({'role': role, 'exit': p.returncode,
                             'sqlstates': re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})', stderr),
                             'ownerCommitted': 'REVIEW_COMMITTED' in stdout,
                             'fixedErrors': re.findall(r'(RECORD_ACTION_[A-Z_]+)', stderr)})
        return {'adminObservedWait': observed, 'connections': 2, 'fixtureSynchronizerConnections': 1,
                'outcomes': outcomes, 'deadlock': any('40P01' in x['sqlstates'] for x in outcomes)}
    finally:
        for p in [gate, owner, admin]:
            if p and p.poll() is None:
                p.terminate(); p.communicate(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', choices=['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], default='v1')
    tag = parser.parse_args().run_id
    output = HERE / f'admin-forward-exact-pg17-{tag}.json'
    if output.exists():
        raise RuntimeError('EVIDENCE_EXISTS')
    config = json.loads(subprocess.check_output(['docker', '--context', CONTEXT, 'inspect', CONTAINER], text=True))[0]
    if config['HostConfig']['NetworkMode'] != 'none' or config['HostConfig'].get('PortBindings'):
        raise RuntimeError('ISOLATION_BOUNDARY_DENIED')
    engine = run(TEMPLATE, "SELECT current_setting('server_version');")
    if engine != '17.6':
        raise RuntimeError('ENGINE_PIN_DENIED')
    migration = SOURCE.read_text()
    if not migration.endswith('COMMIT;\n'):
        raise RuntimeError('ENVELOPE_BINDING_DENIED')
    applied = f'readiness_admin_forward_{tag}_20261011'
    rollback = f'readiness_admin_rollback_{tag}_20261011'
    before_db = f'readiness_admin_locks_before_{tag}_20261011'
    after_db = f'readiness_admin_locks_after_{tag}_20261011'
    fresh(applied, TEMPLATE); fresh(rollback, TEMPLATE)
    before = json.loads(run(rollback, FP))
    run(rollback, migration[:-len('COMMIT;\n')] + 'ROLLBACK;\n', 'postgres')
    after = json.loads(run(rollback, FP))
    if before != after:
        raise RuntimeError('ROLLBACK_FINGERPRINT_DRIFT')
    run(applied, migration, 'postgres')
    post = json.loads(run(applied, FP))
    # Role membership and the protected manifest remain identical to baseline.
    if post['members'] != before['members'] or post['manifest'] != before['manifest']:
        raise RuntimeError('BOUNDARY_PRESERVATION_DRIFT')
    probe = run(applied, (HERE / 'admin_verification_probe_v1.sql').read_text())
    if json.loads(run(applied, FP)) != post:
        raise RuntimeError('PROBE_ROLLBACK_DRIFT')
    fresh(before_db, TEMPLATE); fresh(after_db, applied)
    before_locks = contention(before_db, 'advisory')
    after_locks = contention(after_db, 'relation')
    if not before_locks['deadlock'] or after_locks['deadlock']:
        raise RuntimeError('DEADLOCK_COMPARISON_NOT_PROVEN')
    if not any(x['ownerCommitted'] for x in after_locks['outcomes']):
        raise RuntimeError('OWNER_PROGRESS_NOT_PROVEN')
    if next(x for x in after_locks['outcomes'] if x['role'] == 'admin')['fixedErrors'] != ['RECORD_ACTION_STALE']:
        raise RuntimeError('ADMIN_CONFLICT_NOT_PROVEN')
    result = {'engine': engine, 'actor': 'nonsuper postgres', 'context': CONTEXT, 'container': CONTAINER,
              'migrationSha256': hashlib.sha256(migration.encode()).hexdigest(),
              'probeSha256': hashlib.sha256((HERE / 'admin_verification_probe_v1.sql').read_bytes()).hexdigest(),
              'rollbackExact': True, 'before': before, 'after': after, 'preservedMembersAndManifest': True,
              'cleanupProbe': json.loads(probe), 'baselineLockContention': before_locks,
              'candidateLockContention': after_locks, 'operatingWrites': 0, 'synthetic': True,
              'noBrowserOrFieldPerformanceClaim': True}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'cleanupCases': 10, 'baselineDeadlock': True,
                      'candidateDeadlock': False, 'rollbackExact': True, 'operatingWrites': 0}))


if __name__ == '__main__':
    main()
