"""Apply all11 reviewed units atomically on a fresh isolated schema-only clone."""
from pathlib import Path
import importlib.util
import json
import hashlib
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'apps/web/performance/readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    output = HERE / 'atomic-11-pg17-v1.json'
    require(not output.exists(), 'OUTPUT_EXISTS')
    inspected = json.loads(subprocess.check_output(['docker', '--context', m.CONTEXT, 'inspect', m.CONTAINER]))[0]
    require(inspected['HostConfig']['NetworkMode'] == 'none' and not inspected['NetworkSettings']['Ports'], 'ISOLATION_DENIED')
    require(m.run('ranking_clone', "SELECT current_setting('server_version');") == '17.6', 'ENGINE_DENIED')
    require(m.run('ranking_clone', 'SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.profiles)+(SELECT count(*) FROM public.reviews);') == '0', 'TEMPLATE_DENIED')
    binding = json.loads((HERE / 'atomic-readiness-binding-v1.json').read_bytes())
    bundle = (HERE / 'atomic-readiness-v1.sql').read_bytes()
    require(hashlib.sha256(bundle).hexdigest() == binding['sha256'] and len(binding['sources']) == 11, 'BUNDLE_DRIFT')
    for row in binding['sources']:
        raw = (ROOT / row['source']).read_bytes()
        require(len(raw) == row['bytes'] and hashlib.sha256(raw).hexdigest() == row['sha256'], 'SOURCE_DRIFT')
    before = json.loads(m.run('ranking_clone', m.FP))
    apply, rollback = 'readiness_all11_apply_v1_20261012', 'readiness_all11_rollback_v1_20261012'
    for db in (apply, rollback):
        m.fresh(db, 'ranking_clone')
    m.run(apply, bundle.decode(), 'postgres')
    probe = (ROOT / 'apps/web/performance/user-readiness-20261009/full-clone-user-role-probe-v2.sql').read_text()
    owner = m.run(apply, probe, 'postgres')
    initial = json.loads(m.run(rollback, m.FP))
    require(bundle.endswith(b'COMMIT;\n'), 'ENVELOPE_DRIFT')
    m.run(rollback, (bundle[:-len(b'COMMIT;\n')] + b'ROLLBACK;\n').decode(), 'postgres')
    require(json.loads(m.run(rollback, m.FP)) == initial, 'ROLLBACK_DRIFT')
    require(json.loads(m.run('ranking_clone', m.FP)) == before, 'ORIGINAL_TEMPLATE_DRIFT')
    signatures = json.loads(m.run(apply, "SELECT jsonb_build_object('finishHash',encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.finish_review_media_cleanup()'::regprocedure),'UTF8')),'hex'),'privateBucket',NOT (SELECT public FROM storage.buckets WHERE id='review-verifications'),'serviceAdminOnly',has_function_privilege('service_role','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE') AND NOT has_function_privilege('authenticated','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE'));"))
    require(signatures == {'finishHash': 'a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9', 'privateBucket': True, 'serviceAdminOnly': True}, 'FINAL_READBACK_DRIFT')
    result = {'status': 'passed', 'engine': '17.6', 'actor': 'postgres', 'units': 11,
              'bundleSha256': binding['sha256'], 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'ownerProbes': [json.loads(x) for x in owner.splitlines() if x.startswith('{')], 'signatures': signatures,
              'rollbackExact': True, 'originalTemplateUnchanged': True, 'operatingWrites': 0}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'units': 11, 'rollbackExact': True, 'operatingWrites': 0}))


if __name__ == '__main__':
    main()
