"""Offline aggregate/ACK properties for shared custody; actual SQL tests prove locking.

A 409 is unresolved evidence, never proof of identity presence. Video-level
completion requires every sibling in the original committed set. The previous
trace-only in-memory insert store could not establish those properties.
"""
import copy
import unittest
import uuid
from hypothesis import given, settings, strategies as st
from backend.supabase.scripts.hosted_pending_operation import resolved_reflection,submit_once
from backend.supabase.scripts.test_hosted_pending_operation import FakeRPC,candidate,VIDEO

class ReflectionProperties(unittest.TestCase):
 @settings(max_examples=100,deadline=None)
 @given(actions=st.lists(st.sampled_from(['present','inserted','unresolved']),min_size=1,max_size=30))
 def test_all_siblings_and_three_way_partition(self,actions):
  c=candidate();result={'state':'committed','replayAllowed':False,'sourceStillCurrent':True,
   'sourceRevision':c.revision,'freshness':c.freshness,'currentSetPresent':True,'originalRowsStillPresent':True,
   'rows':[{'video':VIDEO,'action':a,'id':str(uuid.uuid4()),'identitySha':'a'*64} for a in actions]}
  r=resolved_reflection(VIDEO,c,result)
  self.assertEqual(sum(map(len,r.values())),1)
  key='unresolved' if 'unresolved' in actions else 'applied' if 'inserted' in actions else 'skippedAlreadyPresent'
  self.assertEqual(r[key],[VIDEO])
 @settings(max_examples=100,deadline=None)
 @given(phase=st.sampled_from(['prepare','claim','apply']),committed=st.booleans(),restarts=st.integers(1,20))
 def test_unknown_transport_never_authorizes_another_apply(self,phase,committed,restarts):
  rpc=FakeRPC(phase,committed);c=candidate();submit_once(c,transport=rpc)
  sends=rpc.calls.count('apply')
  for _ in range(restarts):submit_once(c,transport=rpc)
  self.assertLessEqual(sends,1);self.assertEqual(rpc.calls.count('apply'),sends)
 @settings(max_examples=100,deadline=None)
 @given(code=st.sampled_from([409,408,429,500,502,503,504]),size=st.integers(1,30))
 def test_http_status_never_substitutes_for_original_committed_readback(self,code,size):
  c=candidate();r=resolved_reflection(VIDEO,c,{'status':code,'rows':[{'action':'present','video':VIDEO}]*size})
  self.assertEqual(r,{'applied':[],'skippedAlreadyPresent':[],'unresolved':[VIDEO]})
 @settings(max_examples=100,deadline=None)
 @given(state=st.sampled_from(['prepared','claimed','held','unconfirmed']),same_rows=st.booleans())
 def test_current_presence_does_not_resolve_an_uncertain_operation(self,state,same_rows):
  c=candidate();r=resolved_reflection(VIDEO,c,{'state':state,'currentSetPresent':True,'originalRowsStillPresent':same_rows})
  self.assertEqual(r['unresolved'],[VIDEO])

if __name__=='__main__':unittest.main()
