#!/usr/bin/env python3
"""Real local PostgreSQL RPC replay. Never connects to operational services.

Reads the retained restaurant corpus; only hashes/counters/timings leave the
disposable database. Public REST transport and the full production catalog
are not simulated as live evidence.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager, redirect_stdout
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import resource
import subprocess
import sys
import time
import types
from unittest.mock import patch
import uuid

import psycopg2
from psycopg2.extras import Json, execute_values

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from backend.pipeline_control import batch_upsert

BASELINE='e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4'
SOURCE=ROOT/'backend/restaurant-evaluation/scripts/13-supabase-insert.py'
CORPUS=Path('/Users/twoimo/Documents/projects/tzudong/backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl')
MIGRATION=ROOT/'backend/supabase/migrations/20260820040000_pipeline_batch_upsert.sql'
RUNTIME=Path('/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-15.8')
JSON_FIELDS={'youtube_meta','evaluation_results','origin_address','address_elements','recollect_version','db_error_details'}
BOOL_FIELDS={'geocoding_success','is_missing','is_not_selected'}
NUMBER_FIELDS={'lat','lng','geocoding_false_stage','review_count'}


def load(kind):
    if kind=='baseline':
        source=subprocess.check_output(['git','show',f'{BASELINE}:backend/restaurant-evaluation/scripts/13-supabase-insert.py'],cwd=ROOT,text=True)
        module=types.ModuleType('storage_baseline');module.__file__=str(SOURCE)
        exec(compile(source,str(SOURCE),'exec'),module.__dict__);return module
    spec=importlib.util.spec_from_file_location('storage_candidate',SOURCE)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def logical_hash(rows,new_ids=()):
    rows={row['trace_id']:{key:value for key,value in row.items() if key!='updated_at' and not(key=='id' and row['trace_id'] in new_ids)} for row in rows}
    return hashlib.sha256(json.dumps(rows,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


class Query:
    def __init__(self,fixture):self.fixture=fixture;self.field=None;self.values=[]
    def select(self,_columns):return self
    def in_(self,field,values):self.field=field;self.values=values;return self
    def execute(self):
        if self.field not in {'trace_id','youtube_link'}:raise ValueError('FIXTURE_QUERY_INVALID')
        with self.fixture.reader.cursor() as cursor:
            cursor.execute(f'SELECT to_jsonb(r) FROM public.restaurants r WHERE {self.field}=ANY(%s::text[])',(self.values,))
            rows=[row[0] for row in cursor.fetchall()]
        self.fixture.metrics['readQueries']+=1
        self.fixture.metrics['readBytes']+=len(json.dumps(rows,ensure_ascii=False).encode())
        return types.SimpleNamespace(data=rows)


class Fixture:
    def __init__(self,database):
        options=dict(dbname=database,user='postgres',host=str(RUNTIME/'socket'),port=18791)
        self.reader=psycopg2.connect(**options);self.reader.autocommit=True
        self.writer=psycopg2.connect(**options)
        self.metrics=defaultdict(int);self.before_rpc=None;self.lose_response=False
    def close(self):self.writer.close();self.reader.close()
    def table(self,name):
        if name!='restaurants':raise ValueError('FIXTURE_TABLE_INVALID')
        return Query(self)
    def rows(self):
        with self.reader.cursor() as cursor:
            cursor.execute('SELECT to_jsonb(r) FROM public.restaurants r ORDER BY trace_id')
            return [row[0] for row in cursor.fetchall()]
    def reset(self,rows):
        with self.reader.cursor() as cursor:
            cursor.execute('TRUNCATE public.restaurants')
            execute_values(cursor,'INSERT INTO public.restaurants SELECT populated.* FROM (VALUES %s) input(payload) CROSS JOIN LATERAL jsonb_populate_record(NULL::public.restaurants,input.payload::jsonb) populated',[(Json(row),) for row in rows])
        self.metrics.clear()
    def apply(self,operations):
        self.metrics['writeRpcCalls']+=1;self.metrics['writeRows']+=len(operations)
        self.metrics['writeBytes']+=len(json.dumps(operations,ensure_ascii=False).encode())
        if self.before_rpc:
            callback=self.before_rpc;self.before_rpc=None;callback()
        with self.writer.cursor() as cursor:
            try:
                cursor.execute('SELECT pipeline_control.batch_upsert_restaurants(%s::jsonb)',(Json(operations),))
                result=cursor.fetchone()[0];self.writer.commit()
            except Exception:
                self.writer.rollback();raise
        self.metrics['rpcReadbackRows']+=len(result['readback'])
        self.metrics['rpcReadbackBytes']+=len(json.dumps(result,ensure_ascii=False).encode())
        if self.lose_response:
            self.lose_response=False
            raise batch_upsert.BatchUpsertError(batch_upsert.CONDITIONAL_WRITE_FAILED)
        return result


def process(module,fixture,payloads,batch_size):
    stats=defaultdict(int)
    with patch.object(module,'apply_restaurant_batch',fixture.apply),redirect_stdout(io.StringIO()):
        for start in range(0,len(payloads),batch_size):
            module.process_and_upsert(fixture,payloads[start:start+batch_size],False,stats)
    return dict(stats)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--samples',type=int,default=7);parser.add_argument('--batch-sizes',default='1,50,100,200')
    parser.add_argument('--scenarios',default='unchanged,change-five,refresh-all,new-fifty,resume-after-response-loss')
    args=parser.parse_args();sizes=[int(value) for value in args.batch_sizes.split(',')]
    scenarios=args.scenarios.split(',')
    if args.samples<7 or any(not 1<=size<=200 for size in sizes):raise SystemExit('BENCHMARK_CONFIGURATION_INVALID')
    if any(case not in {'unchanged','change-five','refresh-all','new-fifty','resume-after-response-loss'} for case in scenarios):raise SystemExit('BENCHMARK_SCENARIO_INVALID')
    raw=CORPUS.read_bytes();corpus_sha=hashlib.sha256(raw).hexdigest();source_sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    modules={kind:load(kind) for kind in ['baseline','candidate']}
    payloads=[modules['candidate'].build_record(json.loads(line),'tzuyang') for line in raw.splitlines() if line.strip()]
    # Stable row-owned fallback dates are prepared outside the measured work.
    for payload in payloads:
        if not payload.get('created_at'):payload['created_at']='2026-01-01T00:00:00Z'
    seed=[]
    for index,payload in enumerate(payloads):
        row={**deepcopy(payload),'id':str(uuid.UUID(hashlib.md5(payload['trace_id'].encode()).hexdigest())),
             'updated_at':'2026-01-01T00:00:00Z','updated_by_admin_id':None,'review_count':index%7}
        if index%20==0:
            row.update(status='approved',approved_name=f'protected-fixture-{index}',updated_by_admin_id='00000000-0000-0000-0000-000000000001')
            row={**row,**modules['candidate'].merge_restaurant_record(row,payload)}
        seed.append(row)
    fields=sorted(set(modules['candidate'].RESTAURANT_CAS_FIELDS).union(*(row.keys() for row in seed)))
    def sql_type(field):
        if field=='id':return 'uuid PRIMARY KEY DEFAULT gen_random_uuid()'
        if field=='trace_id':return 'text UNIQUE'
        if field in {'created_at','updated_at'}:return 'timestamptz'
        if field in JSON_FIELDS:return 'jsonb'
        if field in BOOL_FIELDS:return 'boolean'
        if field in NUMBER_FIELDS:return 'double precision'
        if field=='categories':return 'text[]'
        return 'text'
    schema='CREATE SCHEMA pipeline_control; CREATE TABLE public.restaurants('+','.join(f'{field} {sql_type(field)}' for field in fields)+'); CREATE INDEX fixture_youtube_link_idx ON public.restaurants(youtube_link);'
    rpc=re.search(r'CREATE OR REPLACE FUNCTION pipeline_control\.batch_upsert_restaurants.*?\$\$;',MIGRATION.read_text(),re.S).group(0)
    database='storage_perf_'+uuid.uuid4().hex[:16]
    common=['-U','postgres','-h',str(RUNTIME/'socket'),'-p','18791']
    subprocess.run([str(RUNTIME/'installed/bin/createdb'),*common,database],capture_output=True,check=True)
    fixture=None;observations=[];reference={}
    try:
        fixture=Fixture(database)
        with fixture.reader.cursor() as cursor:
            cursor.execute("SELECT current_setting('server_version')")
            if cursor.fetchone()[0]!='15.8':raise RuntimeError('POSTGRES_VERSION_MISMATCH')
            cursor.execute(schema+rpc+' REVOKE ALL ON FUNCTION pipeline_control.batch_upsert_restaurants(jsonb) FROM PUBLIC,anon,authenticated,service_role;')
        for scenario in scenarios:
            incoming=deepcopy(payloads)
            new_ids=set()
            if scenario=='new-fifty':
                for index,original in enumerate(payloads[:50]):
                    payload=deepcopy(original)
                    payload['trace_id']=hashlib.sha256(f'controlled-new-{index}'.encode()).hexdigest()
                    payload['youtube_link']='https://www.youtube.com/watch?v=z'+str(index).zfill(10)
                    new_ids.add(payload['trace_id']);incoming.append(payload)
            elif scenario!='unchanged':
                for payload in incoming[:5] if scenario in {'change-five','resume-after-response-loss'} else incoming:
                    payload['reasoning_basis']=(payload.get('reasoning_basis') or '')+' [controlled-refresh]'
            for size in sizes:
                for repeat in range(args.samples):
                    for kind in (['baseline','candidate'] if repeat%2==0 else ['candidate','baseline']):
                        fixture.reset(seed)
                        if scenario=='resume-after-response-loss':
                            fixture.lose_response=True
                            try:process(modules[kind],fixture,incoming,size)
                            except RuntimeError:pass
                            else:raise RuntimeError('LOST_RESPONSE_NOT_ABORTED')
                            fixture.metrics.clear()
                        start=time.perf_counter();cpu=time.process_time()
                        stats=process(modules[kind],fixture,incoming,size)
                        wall=(time.perf_counter()-start)*1000;cpu_ms=(time.process_time()-cpu)*1000
                        rows=fixture.rows();digest=logical_hash(rows,new_ids)
                        reference.setdefault(scenario,digest)
                        if digest!=reference[scenario] or len(rows)!=len(incoming):raise RuntimeError('STORAGE_EQUIVALENCE_FAILED')
                        if len({row['id'] for row in rows})!=len(rows):raise RuntimeError('DUPLICATE_DATABASE_ID')
                        by_trace={row['trace_id']:row for row in rows}
                        for original in seed:
                            if by_trace[original['trace_id']]['id']!=original['id']:raise RuntimeError('STORAGE_ID_CHANGED')
                            if original['updated_by_admin_id']:
                                for field in modules[kind].REVIEW_OWNED_FIELDS:
                                    if by_trace[original['trace_id']].get(field)!=original.get(field):raise RuntimeError('ADMIN_PROTECTION_VIOLATED')
                        observations.append({'scenario':scenario,'batchSize':size,'repeat':repeat,'implementation':kind,
                                             'wallMs':wall,'clientCpuMs':cpu_ms,'clientPeakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1048576,
                                             **dict(fixture.metrics),'stats':stats,'rows':len(rows),'logicalSha256':digest})
                    print(json.dumps({'scenario':scenario,'batchSize':size,'pairs':repeat+1}),flush=True)
        fixture.reset(seed)
        changed=deepcopy(payloads[:200]);changed[0]['reasoning_basis']='controlled lost response'
        fixture.lose_response=True
        try:process(modules['candidate'],fixture,changed,200)
        except RuntimeError:pass
        else:raise RuntimeError('LOST_RESPONSE_NOT_ABORTED')
        calls=fixture.metrics['writeRpcCalls'];committed=logical_hash(fixture.rows())
        process(modules['candidate'],fixture,changed,200)
        if fixture.metrics['writeRpcCalls']!=calls or logical_hash(fixture.rows())!=committed:raise RuntimeError('UNCERTAIN_WRITE_RESENT')
        failure={'lostResponseAfterCommitDetected':True,'restartVerifiedBeforeSkipping':True,'resendCountAfterVerifiedRestart':0}
        fixture.reset(seed)
        changed=deepcopy(payloads[:200])
        for payload in changed:payload['reasoning_basis']='controlled conflict refresh'
        trace=changed[-1]['trace_id'];expected=fixture.rows()
        for row in expected:
            if row['trace_id']==trace:row.update(status='hold',approved_name='concurrent-admin-fixture',updated_by_admin_id='00000000-0000-0000-0000-000000000002')
        def admin_change():
            with fixture.reader.cursor() as cursor:
                cursor.execute("UPDATE public.restaurants SET status='hold',approved_name='concurrent-admin-fixture',updated_by_admin_id='00000000-0000-0000-0000-000000000002',updated_at=now() WHERE trace_id=%s",(trace,))
        fixture.before_rpc=admin_change
        try:process(modules['candidate'],fixture,changed,200)
        except psycopg2.errors.SerializationFailure:pass
        else:raise RuntimeError('ADMIN_CONFLICT_NOT_DETECTED')
        if logical_hash(fixture.rows())!=logical_hash(expected):raise RuntimeError('CONFLICT_PARTIAL_WRITE')
        failure['concurrentAdminEditPreserved']=True;failure['wholeBatchRollbackVerified']=True
        before=logical_hash(fixture.rows())
        try:fixture.apply([{'op':'insert','payload':payload,'expected':None} for payload in payloads[:201]])
        except psycopg2.errors.InvalidParameterValue:pass
        else:raise RuntimeError('RPC_LIMIT_NOT_ENFORCED')
        if logical_hash(fixture.rows())!=before:raise RuntimeError('OVER_LIMIT_WROTE_ROWS')
        failure['rpc201RejectedWithoutWrites']=True
        if hashlib.sha256(CORPUS.read_bytes()).hexdigest()!=corpus_sha or hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=source_sha:raise RuntimeError('BENCHMARK_SOURCE_CHANGED')
        result={'kind':'local_postgresql_original_rpc_and_step13_replay','liveEvidenceEligible':False,'baselineSha':BASELINE,
                'sourceSha256':source_sha,'corpusSha256':corpus_sha,'corpusRows':len(payloads),'sourcePreserved':True,
                'rpcFunctionSha256':hashlib.sha256(rpc.encode()).hexdigest(),'fixtureSchemaSha256':hashlib.sha256(schema.encode()).hexdigest(),
                'environment':{'postgres':'15.8','python':sys.version.split()[0],'transport':'private Unix socket; REST-style reads use a local SQL adapter','fullProductionCatalogLoaded':False},
                'samplesPerPair':args.samples,'batchSizes':sizes,'scenarios':scenarios,'protectedFixtures':sum(bool(row['updated_by_admin_id']) for row in seed),
                'protectedViolations':0,'omissions':0,'duplicates':0,'failures':failure,'observations':observations}
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
    finally:
        if fixture:fixture.close()
        subprocess.run([str(RUNTIME/'installed/bin/dropdb'),*common,database],capture_output=True,check=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        # DB errors can contain complete business rows in DETAIL. Never emit
        # those diagnostics, corpus records or request payloads to the chat.
        code=str(error)
        safe=code if re.fullmatch(r'(?:[A-Z_]{1,64}|compare_and_set_conflict|conditional_write_failed)',code) else type(error).__name__
        raise SystemExit('STORAGE_BENCHMARK_FAILED '+safe) from None
