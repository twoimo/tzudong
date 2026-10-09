#!/usr/bin/env python3
"""Local component experiment, synthetic 50k dense/unique, actual PG and Node.

Transport is an owned Unix socket plus NDJSON pipes, not hosted HTTP/PostgREST.
The measured Node worker consumes bounded batches (no whole-catalog input).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.supabase.tests.test_admin_evaluation_raw_warning_groups import RawWarningGroupTests, NODE_PROGRAM, NODE, MIGRATION

WORKER = NODE_PROGRAM.split("const input=JSON.parse")[0] + r"""
const {createInterface}=await import('node:readline');
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
let header,reader,streams,targets,bytes=0,batches=0,workMs=0,workCpu=0;
for await(const line of lines){
 const begin=performance.now(),cpu=process.cpuUsage();
 const value=JSON.parse(line);
 if(!header){header=value;targets=header.targets.map(r=>withAdminEvaluationDisplayName(normalizeEvaluationRecord(r)));
  if(header.mode==='raw')reader=new EvaluationRawWarningGroups(targets,header.revision);
  else streams=targets.map(t=>new EvaluationWarningStream(t));
 }else{bytes+=Buffer.byteLength(line);batches++;
  if(reader)reader.add(value);
  else{const rows=value.map(r=>withAdminEvaluationDisplayName(normalizeEvaluationRecord(r)));for(const s of streams)s.add(rows);}
 }
 const used=process.cpuUsage(cpu);workCpu+=(used.user+used.system)/1000;workMs+=performance.now()-begin;
}
const result=reader?reader.result():Object.fromEntries(streams.map((s,i)=>[targets[i].id,s.result()]));
console.log(JSON.stringify({digest:createHash('sha256').update(JSON.stringify(result)).digest('hex'),nodeWorkMs:workMs,nodeCpuMs:workCpu,maxRssKiB:process.resourceUsage().maxRSS,requests:batches,bytes,node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode}));
"""
FILES = [MIGRATION, ROOT/'apps/web/lib/admin/evaluation-warning-raw-groups.ts', ROOT/'apps/web/lib/admin/evaluation-page-server.ts',
         ROOT/'apps/web/lib/admin/evaluation-warning-stream.ts', ROOT/'apps/web/lib/admin/normalize-evaluation-record.ts',
         ROOT/'apps/web/lib/admin-evaluation-name.ts',
         ROOT/'apps/web/lib/admin-same-video-duplicate-warning.ts', ROOT/'apps/web/lib/admin-restaurant-identity-warning.ts',
         ROOT/'apps/web/lib/dashboard/helpers.ts', ROOT/'backend/supabase/tests/test_admin_evaluation_raw_warning_groups.py', Path(__file__)]


def hashes(): return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in FILES}


def input_digest(fixture, ids):
    with fixture.conn.cursor() as cursor:
        cursor.execute("SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id ASC)::text,'UTF8')),'hex') FROM public.admin_evaluation_related_rows r")
        rows=cursor.fetchone()[0]
        cursor.execute("SELECT encode(sha256(convert_to(jsonb_agg(pipeline_control.admin_eval_row(r) ORDER BY id)::text,'UTF8')),'hex') FROM public.restaurants r WHERE id=ANY(%s::uuid[])",(ids,))
        return {'relatedRows':rows,'targets':cursor.fetchone()[0]}


def measure(fixture, ids, mode):
    start = time.perf_counter()
    with fixture.conn.cursor() as cursor:
        cursor.execute('SELECT public.admin_evaluation_revision()'); revision = cursor.fetchone()[0]
        cursor.execute('SELECT pipeline_control.admin_eval_row(r) FROM public.restaurants r WHERE id=ANY(%s::uuid[]) ORDER BY id',(ids,))
        targets = [row[0] for row in cursor.fetchall()]
    process = subprocess.Popen([NODE,'--experimental-transform-types','--input-type=module','-e',WORKER], cwd=ROOT/'apps/web', stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    def send(value): process.stdin.write(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n'); process.stdin.flush()
    db_ms = 0; max_bytes = 0
    try:
        send({'targets':targets,'mode':mode,'revision':revision})
        after = 0; offset = 0
        while True:
            before = time.perf_counter()
            if mode == 'raw':
                value = fixture.batch(ids, revision, after)
            else:
                with fixture.conn.cursor() as cursor:
                    cursor.execute('SET ROLE service_role')
                    try:
                        cursor.execute('SELECT to_jsonb(r) FROM public.admin_evaluation_related_rows r WHERE video_id IN (SELECT video FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(%s::uuid[])) ORDER BY created_at DESC,id ASC OFFSET %s LIMIT 200',(ids,offset))
                        value = [row[0] for row in cursor.fetchall()]
                    finally: cursor.execute('RESET ROLE')
            db_ms += (time.perf_counter()-before)*1000
            max_bytes = max(max_bytes,len(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()))
            send(value)
            if mode == 'raw':
                if not value['hasMore']: break
                after = value['nextAfterOrder']
            else:
                if len(value)<200: break
                offset += 200
        process.stdin.close()
        output=process.stdout.read(); errors=process.stderr.read()
        if process.wait(): raise RuntimeError(errors[-4000:])
        result=json.loads(output)
        result.update(mode=mode,dbReadMs=db_ms,endToEndMs=(time.perf_counter()-start)*1000,maxBatchBytes=max_bytes)
        return result
    finally:
        if process.poll() is None: process.kill(); process.wait()


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output',type=Path,required=True); parser.add_argument('--pairs',type=int,default=3)
    args=parser.parse_args()
    if os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG')!='1': raise RuntimeError('owned_fixture_opt_in_required')
    output=args.output.resolve()
    if not output.is_relative_to(ROOT/'tmp') and not output.is_relative_to(ROOT/'apps/web/performance'): raise RuntimeError('owned_output_required')
    if output.exists() or not 1<=args.pairs<=7: raise RuntimeError('fresh_output_and_bounded_pairs_required')
    output.parent.mkdir(parents=True,exist_ok=True)
    evidence={'scope':'synthetic local warning component; no hosted/provider/HTTP performance claim','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sourceBefore':hashes(),'environment':{'platform':platform.platform(),'python':platform.python_version()},'conditions':[]}
    RawWarningGroupTests.setUpClass()
    fixture=RawWarningGroupTests('test_group_counts_interleaved_ties_self_and_deleted_union_match_full_reference')
    try:
        with fixture.conn.cursor() as cursor:
            cursor.execute('SELECT version(),current_setting(\'work_mem\')'); evidence['postgres']=cursor.fetchone()
        for condition in ['dense','unique']:
            fixture.setUp()
            rows=[fixture.row(i, approved_name='same fixture',origin_name='same fixture',phone=str(i) if condition=='unique' else ('0101234567' if i%2 else None),status='deleted' if condition=='dense' and i%10==0 else 'pending') for i in range(50000)]
            ids=[row['id'] for row in rows[:200]]
            fixture.insert(rows); del rows
            payload=fixture.payload(ids)
            oracle=fixture.node(payload,'full')
            data={'name':condition,'rows':50000,'targets':200,'groups':payload['batches'][0]['totalGroups'],'oracleDigest':oracle['digest'],'inputBefore':input_digest(fixture,ids),'observations':[]}
            del payload
            # Explain the actual grouping query, not only the opaque RPC node.
            query=MIGRATION.read_text().split(' WITH ordered AS MATERIALIZED (',1)[1].split(' INTO payload;',1)[0]
            query='WITH ordered AS MATERIALIZED ('+query
            query=query.replace('current_revision',"'fixture'").replace('after_order','0').replace('batch_size','1000').replace('page_ids',"ARRAY["+','.join("'"+value+"'::uuid" for value in ids)+']').replace('ANY(videos)',"ANY(ARRAY['ABCDEFGHIJK'])")
            with fixture.conn.cursor() as cursor:
                cursor.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query); data['explain']=cursor.fetchone()[0]
            for pair in range(args.pairs):
                for mode in (['stream','raw'] if pair%2==0 else ['raw','stream']):
                    observed=measure(fixture,ids,mode); observed['pair']=pair
                    if observed['digest']!=oracle['digest']: raise AssertionError('full_reference_digest_mismatch')
                    data['observations'].append(observed)
                    print(json.dumps({'condition':condition,**observed}),flush=True)
            data['inputAfter']=input_digest(fixture,ids)
            if data['inputBefore']!=data['inputAfter']: raise RuntimeError('fixture_input_drift')
            evidence['conditions'].append(data)
            # Recover evidence after each completed condition, without replacing
            # an older experiment. It is not marked admitted until the final hash.
            evidence['status']='in_progress'; output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        evidence['sourceAfter']=hashes()
        if evidence['sourceBefore']!=evidence['sourceAfter']: raise RuntimeError('source_drift_measurement_not_admitted')
        evidence['status']='complete'; evidence['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    finally: RawWarningGroupTests.doClassCleanups()


if __name__=='__main__': main()
