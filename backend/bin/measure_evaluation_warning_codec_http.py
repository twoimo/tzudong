"""Owned loopback transport harness, not the product's authentication/API server.

Each GET returns one bounded PG RPC JSON batch. The actual JS
codec consumes each response before requesting the next batch without retaining the full catalog. No remote URL,
provider, mutation, or Supabase secret is used.
"""
import json
import base64
from urllib.parse import urlparse, parse_qs
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from backend.supabase.tests.test_admin_evaluation_raw_warning_groups import NODE, NODE_PROGRAM, ROOT

CLIENT = NODE_PROGRAM.split('const input=JSON.parse')[0] + r'''
const header=JSON.parse(readFileSync(0,'utf8'));
const targets=header.targets.map(row=>withAdminEvaluationDisplayName(normalizeEvaluationRecord(row)));
const output=[];
for(let trial=0;trial<header.trials;trial++){
 const reader=new EvaluationRawWarningGroups(targets,header.revision);
 const start=performance.now(),cpu=process.cpuUsage();
 let after=null,bytes=0,requests=0,decoderMs=0,decoderCpuMs=0,maxBatchBytes=0;
 for(;;){
  const url=new URL(header.url);if(after)url.searchParams.set('cursor',Buffer.from(JSON.stringify(after)).toString('base64url'));
  const response=await fetch(url);
  if(response.status!==200)throw new Error('local_codec_api_failure');
  const line=await response.text(),size=Buffer.byteLength(line);if(size>2097152)throw new Error('unbounded_codec_response');
  bytes+=size;maxBatchBytes=Math.max(maxBatchBytes,size);requests++;
  const t=performance.now(),c=process.cpuUsage();
  const progress=reader.add(JSON.parse(line));decoderMs+=performance.now()-t;const u=process.cpuUsage(c);decoderCpuMs+=(u.user+u.system)/1000;
  if(!progress.hasMore)break;after=progress.cursor;
 }
 const digest=createHash('sha256').update(JSON.stringify(reader.result())).digest('hex');
 if(digest!==header.digest)throw new Error('full_reference_digest_mismatch');
 const used=process.cpuUsage(cpu);
 output.push({trial,digest,codec:reader.mode,requests,bytes,maxBatchBytes,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,decoderMs,decoderCpuMs,maxRssKiB:process.resourceUsage().maxRSS});
}
console.log(JSON.stringify(output));
'''


def measure_http(fixture, ids, digest, trials=25, source_root=ROOT):
    with fixture.conn.cursor() as cursor:
        cursor.execute('SELECT public.admin_evaluation_revision()'); revision=cursor.fetchone()[0]
        cursor.execute('SELECT pipeline_control.admin_eval_row(r) FROM public.restaurants r WHERE id=ANY(%s::uuid[]) ORDER BY id',(ids,))
        targets=[r[0] for r in cursor.fetchall()]
    stats={'httpGets':0,'rpcCalls':0,'failures':0}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            parsed=urlparse(self.path)
            if parsed.path!='/codec-batch': self.send_error(404);return
            stats['httpGets']+=1
            try:
                encoded=parse_qs(parsed.query).get('cursor',[None])[0]
                after=json.loads(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4))) if encoded else None
                value=fixture.batch(ids,revision,after);stats['rpcCalls']+=1
                body=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
                if len(body)>2097152:raise RuntimeError('body_bound')
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers()
                self.wfile.write(body);self.wfile.flush()
            except Exception:
                stats['failures']+=1;self.send_error(500,'local_fixture_failed')
    server=HTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        result=subprocess.run([NODE,'--experimental-transform-types','--input-type=module','-e',CLIENT],cwd=source_root/'apps/web',
          input=json.dumps({'targets':targets,'revision':revision,'digest':digest,'trials':trials,'url':f'http://127.0.0.1:{server.server_port}/codec-batch'}),text=True,capture_output=True,timeout=600)
        if result.returncode:raise RuntimeError(result.stderr[-4000:])
        observations=json.loads(result.stdout)
        if stats['httpGets']!=sum(r['requests'] for r in observations) or stats['failures']:raise RuntimeError('local_codec_http_count_mismatch')
        return {'scope':'owned loopback sequential GET/JSON bridge to actual PG RPC and actual Node decoder; not product auth/PostgREST/provider','pageReadTrials':trials,'stats':stats,'observations':observations}
    finally:server.shutdown();server.server_close();thread.join()
