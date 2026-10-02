"""Exact engine SQL isolation. Never save raw provider diagnostics or touch production."""
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
app = root.parent.parent
pg = Path(sys.argv[1])
label = sys.argv[2]
assert label.replace('-', '').isalnum()
directory = Path(tempfile.mkdtemp(prefix='tzudong-field-sql-'))
data, socket = directory / 'data', directory / 'socket'
socket.mkdir(mode=0o700)
started = False
base = [str(pg / 'psql'), '-h', str(socket), '-p', '55441', '-U', 'field_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']


def quiet(command, sql=None):
    result = subprocess.run(command, input=sql, capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise RuntimeError('isolated_field_sql_failed')
    return result.stdout.strip()


try:
    quiet([str(pg / 'initdb'), '-D', str(data), '-A', 'trust', '-U', 'field_test', '-E', 'UTF8'])
    quiet([str(pg / 'pg_ctl'), '-D', str(data), '-l', str(directory / 'private-startup.log'), '-o',
           f"-k {socket} -p 55441 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=10", 'start'])
    started = True
    version = quiet([str(pg / 'postgres'), '--version'])
    quiet(base, 'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;')
    migration = app / 'supabase/migrations/20261001123253_app_web_vitals_aggregate.sql'
    quiet(base, migration.read_text())
    quiet(base, (app/'supabase/migrations/20261001152740_app_web_vitals_ingest_budget.sql').read_text())
    permissions = quiet(base, """
      select relrowsecurity from pg_class where oid='public.app_web_vitals_histogram'::regclass;
      select has_table_privilege('anon','public.app_web_vitals_histogram','SELECT') or has_table_privilege('authenticated','public.app_web_vitals_histogram','INSERT');
      select has_function_privilege('anon','public.record_app_web_vitals(text,text,text,text,smallint)','EXECUTE');
      select has_function_privilege('authenticated','public.record_app_web_vitals(text,text,text,text,smallint)','EXECUTE');
      select prosecdef from pg_proc where oid='public.record_app_web_vitals(text,text,text,text,smallint)'::regprocedure;
    """)
    assert permissions.splitlines() == ['t', 'f', 'f', 'f', 'f']
    quiet(base, "set role service_role; select public.record_app_web_vitals(repeat('a',40),'mobile','INP','navigate',12::smallint); select public.record_app_web_vitals(repeat('a',40),'mobile','INP','navigate',12::smallint); reset role;")
    assert quiet(base, 'select sample_count from public.app_web_vitals_histogram;') == '2'
    failures = [
      "set role anon; select public.record_app_web_vitals(repeat('a',40),'mobile','INP','navigate',12::smallint);",
      "set role authenticated; select * from public.app_web_vitals_histogram;",
      "set role service_role; select public.record_app_web_vitals(repeat('a',40),'mobile','CLS','navigate',101::smallint);",
      "set role service_role; select public.record_app_web_vitals('invalid','mobile','INP','navigate',12::smallint);",
    ]
    for sql in failures:
        assert subprocess.run(base, input=sql, capture_output=True, text=True, timeout=10).returncode != 0
    assert quiet(base, 'select sample_count from public.app_web_vitals_histogram;') == '2'
    limited=quiet(base, "set role service_role; select count(*) from generate_series(1,200) where public.record_app_web_vitals_bounded(repeat('a',40),'mobile','INP','navigate',12::smallint); reset role;")
    assert limited.splitlines()[-2] == '180', 'atomic quota failure'
    assert quiet(base,'select sample_count from public.app_web_vitals_histogram;')=='182'
    assert quiet(base,"select count(*)::text||':'||max(accepted_count)::text from public.app_web_vitals_ingest_budget;")=='1:180'
    denied=quiet(base,"set role service_role; select public.record_app_web_vitals_bounded(repeat('a',40),'mobile','INP','navigate',12::smallint); reset role;")
    assert 'f' in denied.splitlines()
    quiet(base,"update public.app_web_vitals_ingest_budget set window_start=window_start-interval '1 minute';")
    reset=quiet(base,"set role service_role; select public.record_app_web_vitals_bounded(repeat('a',40),'mobile','INP','navigate',12::smallint); reset role;")
    assert 't' in reset.splitlines()
    assert quiet(base,'select accepted_count from public.app_web_vitals_ingest_budget;')=='1'
    result = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'version': version,
              'unixSocketOnly': True, 'productionDatabaseTouched': False, 'passed': True,
              'rlsNoPublicGrantsSecurityInvoker': True, 'atomicIncrement': True, 'global180PerMinuteBoundVerified': True, 'globalStateSingleRow': True, 'budgetRotationVerified': True,
              'forbiddenRolesAndInvalidSamplesFailClosed': True, 'failedWritesLeaveCountsUnchanged': True,
              'rawProviderDiagnosticsSaved': False}
finally:
    if started:
        subprocess.run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'fast', 'stop'], capture_output=True, timeout=20)
    shutil.rmtree(directory)
result['temporaryDatabaseRemoved'] = not directory.exists()
with (root / (label + '.json')).open('x') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps(result))
