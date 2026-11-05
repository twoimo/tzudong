import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
from contextlib import redirect_stdout
from backend.supabase.scripts import hosted_pending_operation as op
from backend.supabase.scripts import hosted_data_plane as plane
from backend.supabase.scripts.test_hosted_pending_operation import candidate,REV,VIDEO


def row(name):
 return {'youtube_link':'https://youtu.be/'+VIDEO,'origin_name':name,'trace_id':'trace-'+name,'lat':1,'lng':2,'geocoding_success':True}

def committed(c):
 return {'requestId':str(uuid.uuid4()),'state':'committed','replayAllowed':False,'sourceStillCurrent':True,
  'sourceRevision':c.revision,'freshness':c.freshness,'currentSetPresent':True,'originalRowsStillPresent':True,
  'rows':[{'video':VIDEO,'action':action,'id':str(uuid.uuid4()),'identitySha':hex(i+1)[2:]*64} for i,action in enumerate(['present','inserted'])]}

class IntegrationTests(unittest.TestCase):
 def test_fixed_transport_uses_readonly_get_array_and_typed_post(self):
  from urllib.parse import urlsplit,parse_qs
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,n):return b'{"replayAllowed":false}'
  class Opener:
   def __init__(self):self.calls=[]
   def open(self,request,timeout):self.calls.append((request,timeout));return Response()
  client=Opener()
  with patch.object(op,'build_opener',return_value=client):
   op.rpc_transport('read',{'video_ids':[VIDEO],'request_id':None},service_role_key='synthetic')
   op.rpc_transport('prepare',{'request_id':str(uuid.uuid4()),'rows':[]},service_role_key='synthetic')
  req,timeout=client.calls[0];url=urlsplit(req.full_url)
  self.assertEqual(url.scheme+'://'+url.netloc,plane.HOSTED_URL)
  self.assertEqual(url.path,'/rest/v1/rpc/hosted_pending_read');self.assertEqual(req.method,'GET');self.assertIsNone(req.data);self.assertEqual(timeout,15)
  self.assertEqual(parse_qs(url.query),{'video_ids':['{'+VIDEO+'}']})
  req,_=client.calls[1];self.assertEqual(req.method,'POST');self.assertEqual(json.loads(req.data)['rows'],[])
 def test_transport_redirect_and_oversize_discovery_are_distinct_fixed_failures(self):
  with self.assertRaisesRegex(plane.HostedDataPlaneError,'pending_transport_failed'):
   op.NoRedirect().redirect_request(None,None,None,None,None,None)
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,n):return b'x'*n
  class Opener:
   def open(self,*args,**kwargs):return Response()
  with patch.object(op,'build_opener',return_value=Opener()),self.assertRaisesRegex(plane.HostedDataPlaneError,'pending_discovery_unbounded'):
   op.rpc_transport('read',{'video_ids':[VIDEO]},service_role_key='synthetic')
 def test_existing_video_cannot_filter_missing_sibling_from_preview(self):
  p=plane.build_apply_preview(local_restaurant_ids=[],hosted_restaurant_ids=['A'],hosted_youtube_ids=[VIDEO],evaluation_rows=[row('A'),row('B')])
  self.assertEqual(p['applyCandidateVideoIds'],[VIDEO])
  self.assertEqual(p['evaluationClasses'],{'apply_candidate_pending_geocoded':2})
 def test_legacy_sender_is_rejected_before_transport(self):
  calls=[]
  with self.assertRaisesRegex(plane.HostedDataPlaneError,'pending_shared_custody_required'):
   plane.apply_pending_candidates(preview={},evaluation_rows=[row('A'),row('B')],url=plane.HOSTED_URL,service_role_key='synthetic',environment={},presented_preview_sha256='',fetch=lambda *a,**k:calls.append(a))
  self.assertEqual(calls,[])
 def test_A_success_cannot_mask_B_503_or_409_uncertainty(self):
  c=candidate()
  for status in [503,409]:
   r=committed(c);r['rows'][1]={'video':VIDEO,'action':'unresolved','status':status}
   self.assertEqual(op.resolved_reflection(VIDEO,c,r)['unresolved'],[VIDEO])
  self.assertEqual(op.resolved_reflection(VIDEO,c,committed(c))['applied'],[VIDEO])
 def test_committed_requires_original_binding_current_full_set(self):
  c=candidate()
  for key,bad in [('sourceRevision','1'*40),('freshness',{}),('currentSetPresent',False),('originalRowsStillPresent',False),('sourceStillCurrent',False),('rows',[])]:
   r=committed(c);r[key]=bad
   self.assertEqual(op.resolved_reflection(VIDEO,c,r)['unresolved'],[VIDEO])
 def test_discovery_never_promotes_missing_legacy_or_claimed_to_completion(self):
  rid=str(uuid.uuid4());c=candidate();done=committed(c);done['currentRows']=done['rows']
  def observe(ops,holds=[]):return op.observe_deliveries([VIDEO],revision=REV,transport=lambda *a:{'videos':[VIDEO],'legacyHeld':holds,'operations':ops,'replayAllowed':False})[VIDEO]
  self.assertEqual(observe([])['state'],'legacy_unresolved')
  self.assertEqual(observe([{**done,'state':'claimed','requestId':rid}])['state'],'held')
  self.assertEqual(observe([done])['state'],'delivered_snapshot')
  self.assertEqual(observe([done],[VIDEO])['state'],'legacy_held')
  self.assertEqual(observe([{**done,'sourceRevision':'2'*40}])['state'],'source_changed')
 def test_discovery_invalid_payload_or_timeout_is_unconfirmed(self):
  for value in [{},{'videos':[VIDEO],'legacyHeld':[],'operations':None,'replayAllowed':False}]:
   self.assertEqual(op.observe_deliveries([VIDEO],revision=REV,transport=lambda *a:value)[VIDEO]['state'],'unconfirmed')
 def test_cli_reconcile_only_preserves_original_request_and_sends_no_write(self):
  from backend.bin import apply_hosted_pending_candidates as cli
  rid=str(uuid.uuid4());calls=[]
  with patch.dict('os.environ',{'SUPABASE_URL':plane.HOSTED_URL,'SUPABASE_SERVICE_ROLE_KEY':'synthetic'},clear=True),patch.object(cli,'rpc_transport',side_effect=lambda action,body,**kw:(calls.append((action,body)) or {'requestId':rid,'state':'claimed','replayAllowed':False})),redirect_stdout(io.StringIO()):
   self.assertEqual(cli.main(['--reconcile-request',rid]),2)
  self.assertEqual(calls,[('read',{'request_id':rid})])
 def test_cli_dryrun_with_existing_siblings_has_no_write(self):
  from backend.bin import apply_hosted_pending_candidates as cli
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'transforms.jsonl';p.write_text(''.join(json.dumps(row(n))+'\n' for n in ['A','B']))
   with patch.dict('os.environ',{'SUPABASE_URL':plane.HOSTED_URL,'SUPABASE_SERVICE_ROLE_KEY':'synthetic'},clear=True),patch.object(cli,'fetch_hosted_restaurant_snapshot',return_value=(['A'],[VIDEO])),patch.object(cli,'rpc_transport') as transport,redirect_stdout(io.StringIO()) as output:
    self.assertEqual(cli.main(['--evaluation',str(p),'--dry-run']),0)
   transport.assert_not_called();self.assertIn('applyCandidateCount=1',output.getvalue())
 def test_local_input_presence_prevents_remote_snapshot_reuse(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);self.assertFalse(op.local_video_inputs_present(p,p,VIDEO))
   (p/'transcript').mkdir();(p/'transcript'/(VIDEO+'.jsonl')).write_text('changed')
   self.assertTrue(op.local_video_inputs_present(p,p,VIDEO))
 def test_preview_payload_change_is_rejected_without_prepare(self):
  c=candidate();calls=[]
  with patch.object(op,'admit_current_candidate_set',return_value=c):
   r=op.apply_current_sets(evaluation='.',crawling='.',channel='tzuyang',revision=REV,environment={},videos=[VIDEO],transport=lambda *a:calls.append(a),expected_payloads=[])
  self.assertEqual(r['reflection']['unresolved'],[VIDEO]);self.assertEqual(calls,[])
 def test_orphan_transform_cannot_authorize_snapshot_reuse(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'evaluation').mkdir();(p/'evaluation/transforms.jsonl').write_text(json.dumps(row('A'))+'\n')
   self.assertTrue(op.local_video_inputs_present(p,p,VIDEO))
 def test_bounded_batch_skips_exact_committed_sets_before_next_three(self):
  from dataclasses import replace
  videos=['video00000'+str(i) for i in range(4)];sets={};stored={};sent=[]
  for v in videos:
   rows=[{**plane.pending_insert_payload(row(n)),'youtube_link':'https://youtu.be/'+v} for n in ['A','B']]
   c=candidate();c=replace(c,rows=rows,fingerprint=plane.preview_hash({'revision':c.revision,'freshness':c.freshness,'rows':rows}))
   sets[v]=replace(c,reobserve=lambda c=c:c)
  def admit(**kwargs):return sets[kwargs['videos'][0]]
  def read(action,body):
   self.assertEqual(action,'read');v=body['video_ids'][0]
   return {'videos':[v],'operations':[stored[v]] if v in stored else [],'legacyHeld':[],'replayAllowed':False}
  def submit(c,**kwargs):
   v=plane.row_youtube_id(c.rows[0]);sent.append(v);r=committed(c)
   for x in r['rows']:x['video']=v
   stored[v]=r;return r
  def run():return op.apply_current_sets(evaluation='.',crawling='.',channel='tzuyang',revision=REV,environment={},videos=videos,transport=read,expected_payloads=[r for c in sets.values() for r in c.rows])
  with patch.object(op,'admit_current_candidate_set',side_effect=admit),patch.object(op,'submit_once',side_effect=submit):
   first=run();self.assertEqual(sent,videos[:3]);self.assertEqual(first['reflection']['unresolved'],videos[3:])
   second=run();self.assertEqual(sent,videos);self.assertEqual(second['reflection']['skippedAlreadyPresent'],videos[:3]);self.assertEqual(second['reflection']['applied'],videos[3:]);self.assertEqual(second['reflection']['unresolved'],[])
 def test_original_claimed_operation_is_returned_without_prepare(self):
  c=candidate();rid=str(uuid.uuid4());calls=[]
  def read(action,body):
   calls.append(action);return {'videos':[VIDEO],'legacyHeld':[],'replayAllowed':False,'operations':[{'requestId':rid,'state':'claimed','replayAllowed':False}]}
  with patch.object(op,'admit_current_candidate_set',return_value=c):
   r=op.apply_current_sets(evaluation='.',crawling='.',channel='tzuyang',revision=REV,environment={},videos=[VIDEO],transport=read,expected_payloads=c.rows)
  self.assertEqual(calls,['read']);self.assertEqual(r['reflection']['unresolved'],[VIDEO]);self.assertEqual(r['requests'][0]['requestId'],rid)

if __name__=='__main__':unittest.main()
