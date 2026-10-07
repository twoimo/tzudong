#!/usr/bin/env python3
"""Local component experiment, synthetic cold/small/dense/unique, actual PG and Node.

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
import shutil
import time

ROOT = Path(__file__).resolve().parents[2]
NODE_SOURCE_ROOT = ROOT
sys.path.insert(0, str(ROOT))
from backend.bin.measure_evaluation_warning_codec_http import measure_http
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
 process.stdout.write('ACK\n');
}
const result=reader?reader.result():Object.fromEntries(streams.map((s,i)=>[targets[i].id,s.result()]));
console.log(JSON.stringify({digest:createHash('sha256').update(JSON.stringify(result)).digest('hex'),nodeWorkMs:workMs,nodeCpuMs:workCpu,maxRssKiB:process.resourceUsage().maxRSS,requests:batches,bytes,node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode}));
"""
FILES = [MIGRATION, ROOT/'apps/web/lib/admin/evaluation-warning-raw-groups.ts', ROOT/'apps/web/lib/admin/evaluation-page-server.ts',
         ROOT/'apps/web/lib/admin/evaluation-warning-adaptive-codec.ts', ROOT/'apps/web/lib/admin/evaluation-warning-stream.ts', ROOT/'apps/web/lib/admin/normalize-evaluation-record.ts',
         ROOT/'apps/web/lib/admin-evaluation-name.ts',
         ROOT/'apps/web/lib/admin-same-video-duplicate-warning.ts', ROOT/'apps/web/lib/admin-restaurant-identity-warning.ts',
         ROOT/'apps/web/lib/dashboard/helpers.ts', ROOT/'backend/supabase/tests/test_admin_evaluation_raw_warning_groups.py', Path(__file__),ROOT/'backend/bin/measure_evaluation_warning_codec_http.py',ROOT/'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql']


def hashes(base=ROOT): return {str(path.relative_to(ROOT)): hashlib.sha256((base/path.relative_to(ROOT)).read_bytes()).hexdigest() for path in FILES}


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
    process = subprocess.Popen([NODE,'--experimental-transform-types','--input-type=module','-e',WORKER], cwd=NODE_SOURCE_ROOT/'apps/web', stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    def send(value):
        process.stdin.write(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n'); process.stdin.flush()
        if process.stdout.readline()!='ACK\n': raise RuntimeError('decoder_ack_missing')
    db_ms = 0; max_bytes = 0
    try:
        send({'targets':targets,'mode':mode,'revision':revision})
        after = None; offset = 0
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
                after = value['cursor']
            else:
                if len(value)<200: break
                offset += 200
        process.stdin.close()
        output=process.stdout.read(); errors=process.stderr.read()
        if process.wait(): raise RuntimeError(errors[-4000:])
        result=json.loads(output)
        result.update(mode=mode,codec=value.get('mode') if isinstance(value,dict) else None,dbReadMs=db_ms,endToEndMs=(time.perf_counter()-start)*1000,maxBatchBytes=max_bytes)
        return result
    finally:
        if process.poll() is None: process.kill(); process.wait()


def main():
    global NODE_SOURCE_ROOT
    parser=argparse.ArgumentParser(); parser.add_argument('--output',type=Path,required=True); parser.add_argument('--pairs',type=int,default=7)
    parser.add_argument('--conditions',nargs='+',choices=['cold','small','dense','unique','boundary-admitted','boundary-flat'],default=['cold','small','dense','unique'])
    parser.add_argument('--http-trials',type=int,default=25)
    args=parser.parse_args()
    if os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG')!='1': raise RuntimeError('owned_fixture_opt_in_required')
    output=args.output.resolve()
    if not output.is_relative_to(ROOT/'tmp') and not output.is_relative_to(ROOT/'apps/web/performance'): raise RuntimeError('owned_output_required')
    if output.exists() or not 1<=args.pairs<=7 or not 0<=args.http_trials<=100 or len(set(args.conditions))!=len(args.conditions): raise RuntimeError('fresh_output_and_bounded_pairs_required')
    output.parent.mkdir(parents=True,exist_ok=True)
    # Every Node observation executes the same immutable task-owned snapshot.
    # Do not turn a concurrent working-tree edit into a mixed runtime benchmark.
    snapshot=ROOT/'tmp'/(output.stem+'-source')
    if snapshot.exists():raise RuntimeError('fresh_source_snapshot_required')
    before=hashes()
    for path in FILES:
        target=snapshot/path.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
    if before!=hashes(snapshot) or before!=hashes():raise RuntimeError('source_changed_while_snapshotting')
    NODE_SOURCE_ROOT=snapshot
    evidence={'scope':'synthetic local warning component; sequential RPC/decode ACK; no hosted/provider performance claim','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sourceSnapshot':str(snapshot),'sourceBefore':hashes(snapshot),'cacheState':'fresh Node per observation; PG/OS buffers not flushed and oracle/EXPLAIN warm them; cold condition is application cold only','environment':{'platform':platform.platform(),'python':platform.python_version()},'conditions':[]}
    RawWarningGroupTests.setUpClass()
    fixture=RawWarningGroupTests('test_group_counts_interleaved_ties_self_and_deleted_union_match_full_reference')
    try:
        with fixture.conn.cursor() as cursor:
            cursor.execute('SELECT version(),current_setting(\'work_mem\')'); evidence['postgres']=cursor.fetchone()
        for condition in args.conditions:
            count={'cold':1000,'small':200,'dense':50000,'unique':50000,'boundary-admitted':20000,'boundary-flat':20000}[condition]
            fixture.setUp()
            rows=[fixture.row(i, approved_name='same fixture',origin_name='same fixture',phone=str(i%200) if condition=='boundary-admitted' else str(i%201) if condition=='boundary-flat' else str(i) if condition!='dense' else ('0101234567' if i%2 else None),status='deleted' if condition=='dense' and i%10==0 else 'pending') for i in range(count)]
            ids=[row['id'] for row in rows[:200]]
            fixture.insert(rows); del rows
            payload=fixture.payload(ids)
            oracle=fixture.node(payload,'full')
            data={'name':condition,'rows':count,'targets':200,'groups':payload['batches'][0].get('totalGroups',200 if condition=='boundary-admitted' else 201 if condition=='boundary-flat' else count),'codec':payload['batches'][0]['mode'],'densityStageExecutedByRPC':count>200,'oracleDigest':oracle['digest'],'inputBefore':input_digest(fixture,ids),'observations':[]}
            del payload
            # Separate full-density planning and bounded projection costs.
            # EXPLAIN does warm database pages. "cold" means fresh application
            # process/cache, never a claim of OS/disk/PG-buffer coldness.
            with fixture.conn.cursor() as cursor:
                cursor.execute("""EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(DISTINCT attrs COLLATE "C"),sum(octet_length(attrs)),max(octet_length(attrs)) FROM (SELECT (to_jsonb(r)-ARRAY['id','created_at','video_id'])::text attrs FROM public.admin_evaluation_related_rows r WHERE video_id='ABCDEFGHIJK') p""")
                data['densityStageExplain']=cursor.fetchone()[0]
                cursor.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) WITH keys AS MATERIALIZED (SELECT r.id FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id) WHERE i.video='ABCDEFGHIJK' ORDER BY r.created_at DESC NULLS FIRST,r.id ASC LIMIT 1000) SELECT to_jsonb(r) FROM keys JOIN public.admin_evaluation_related_rows r USING(id)")
                data['flatProjectionStageExplain']=cursor.fetchone()[0]
            for pair in range(args.pairs):
                for mode in (['stream','raw'] if pair%2==0 else ['raw','stream']):
                    observed=measure(fixture,ids,mode); observed['pair']=pair
                    if observed['digest']!=oracle['digest']: raise AssertionError('full_reference_digest_mismatch')
                    data['observations'].append(observed)
                    print(json.dumps({'condition':condition,**observed}),flush=True)
            if args.http_trials:
                data['httpDecoder']=measure_http(fixture,ids,oracle['digest'],args.http_trials,source_root=NODE_SOURCE_ROOT)
                print(json.dumps({'condition':condition,'httpDecoder':data['httpDecoder']['stats']}),flush=True)
            data['inputAfter']=input_digest(fixture,ids)
            if data['inputBefore']!=data['inputAfter']: raise RuntimeError('fixture_input_drift')
            evidence['conditions'].append(data)
            # Recover evidence after each completed condition, without replacing
            # an older experiment. It is not marked admitted until the final hash.
            evidence['status']='in_progress'; output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        evidence['sourceAfter']=hashes(snapshot)
        evidence['workingTreeSourceAfter']=hashes()
        evidence['workingTreeMatchesSnapshot']=evidence['sourceAfter']==evidence['workingTreeSourceAfter']
        if evidence['sourceBefore']!=evidence['sourceAfter']: raise RuntimeError('source_drift_measurement_not_admitted')
        if not evidence['workingTreeMatchesSnapshot']:
            evidence['status']='frozen_complete_working_tree_drift';output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');raise RuntimeError('working_tree_changed_frozen_evidence_preserved')
        evidence['status']='complete'; evidence['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    finally: RawWarningGroupTests.doClassCleanups()


if __name__=='__main__': main()
