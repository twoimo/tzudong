"""Fake-connection boundary tests for the G037 single-transaction fence."""
from __future__ import annotations
import importlib.util, sys, time, unittest
from pathlib import Path
from unittest.mock import patch
MODULE=Path(__file__).parents[1]/"scripts"/"g037_write_freeze.py"; sys.path.insert(0,str(MODULE.parent))
spec=importlib.util.spec_from_file_location("freeze",MODULE); freeze=importlib.util.module_from_spec(spec); assert spec.loader; sys.modules[spec.name]=freeze; spec.loader.exec_module(freeze)
class Cursor:
 def __init__(self,fail_lock=None): self.sql=[]; self.fail_lock=fail_lock
 def execute(self,s,p=()):
  self.sql.append((s,p))
  if self.fail_lock and self.fail_lock in s: raise RuntimeError("lock denied")
 def fetchall(self): return []
 def close(self): pass
class Conn:
 def __init__(self,commit_error=False,rollback_error=False,fail_lock=None): self.c=Cursor(fail_lock); self.commits=0; self.rollbacks=0; self.commit_error=commit_error; self.rollback_error=rollback_error
 def cursor(self): return self.c
 def commit(self):
  self.commits+=1
  if self.commit_error: raise RuntimeError("network after commit")
 def rollback(self):
  self.rollbacks+=1
  if self.rollback_error: raise RuntimeError("rollback transport failure")
def inv(acl="a"):
 rs=tuple(freeze.Relation(s,n,o,"r",owner) for s,n,o,owner in (
  ("auth","schema_migrations",1,"supabase_auth_admin"),
  ("auth","users",2,"owner"),
  ("public","x",3,"owner"),
  ("storage","buckets_vectors",4,"supabase_storage_admin"),
  ("storage","migrations",5,"supabase_storage_admin"),
  ("storage","objects",6,"owner"),
  ("storage","vector_indexes",7,"supabase_storage_admin"),
  ("shortener_private","limits",8,"owner"),
 ))
 return freeze.Inventory(("auth","public","storage","shortener_private"),rs,freeze.digest([r.key for r in rs]),acl*64)
def terminal(_,spec): return {"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":spec}
def capture():
 return {
  "auth_storage_catalog_root":"1"*64,
  "auth_storage_metadata_root":"2"*64,
  "storage_blob_root":"3"*64,
  "recipient_fingerprint":"4"*64,
  "logical_ciphertext_sha256":"5"*64,
  "blob_ciphertext_sha256":"6"*64,
  "recovery_receipt_sha256":"7"*64,
  "object_count":2,
  "total_bytes":1024,
 }
def patches(inventory):
 return (patch.object(freeze,"_root_source",return_value=(Path("."),"a"*40,"s"*64,"t"*64)),patch.object(freeze,"validate_operator_assertion"),patch.object(freeze,"_inv",return_value=inventory),patch.object(freeze,"_locks",return_value="l"*64),patch.object(freeze,"_verify_active",side_effect=lambda v,e:{**v,"signature":"ok"}))
def precommit(receipt): return receipt["receipt_sha256"]
class FenceTests(unittest.TestCase):
 def test_exact_provider_managed_exclusions_are_inventory_only(self):
  c=Conn(); i=inv()
  with patch.object(freeze,"_inv",return_value=i): self.assertEqual(freeze.preflight(c),i)
  locks=[sql for sql,_ in c.c.sql if sql.startswith("LOCK TABLE")]
  self.assertTrue(any('"public"."x"' in sql for sql in locks))
  self.assertFalse(any(name in sql for name in ('"schema_migrations"','"buckets_vectors"','"migrations"','"vector_indexes"') for sql in locks))
  self.assertEqual(i.relation_root,freeze.digest([r.key for r in i.relations]))
  self.assertEqual({(r.schema,r.name,r.owner) for r in i.relations if (r.schema,r.name,r.owner) in freeze.PROVIDER_MANAGED_LOCK_EXCLUSIONS},freeze.PROVIDER_MANAGED_LOCK_EXCLUSIONS)
  class HeldCursor(Cursor):
   def fetchall(self):
    if "FROM pg_locks l" in self.sql[-1][0]: return [(r.schema,r.name,r.oid) for r in freeze._lockable_relations(i.relations)]
    if "count(*) FROM pg_locks" in self.sql[-1][0]: return [(0,)]
    return []
  held=HeldCursor()
  self.assertEqual(freeze._locks(held,i.relations,60),freeze.digest([(r.schema,r.name,r.oid) for r in freeze._lockable_relations(i.relations)]))
  self.assertFalse(any(name in sql for name in ('"schema_migrations"','"buckets_vectors"','"migrations"','"vector_indexes"') for sql,_ in held.sql if sql.startswith("LOCK TABLE")))
 def test_owner_drift_in_provider_managed_exclusion_rejects(self):
  i=inv(); relations=tuple(freeze.Relation(r.schema,r.name,r.oid,r.kind,"wrong-owner") if r.name=="migrations" else r for r in i.relations)
  drifted=freeze.Inventory(i.schemas,relations,freeze.digest([r.key for r in relations]),i.acl_root)
  with patch.object(freeze,"_inv",return_value=drifted),self.assertRaisesRegex(freeze.FreezeError,"provider-managed lock exclusion inventory drift"):
   freeze.preflight(Conn())
 def test_extra_un_lockable_relation_rejects(self):
  i=inv(); extra=freeze.Relation("public","un_lockable",99,"r","owner")
  expanded=freeze.Inventory(i.schemas,i.relations+(extra,),freeze.digest([r.key for r in i.relations+(extra,)]),i.acl_root)
  with patch.object(freeze,"_inv",return_value=expanded),self.assertRaisesRegex(freeze.FreezeError,"all non-provider-managed reachable relations must be lockable"):
   freeze.preflight(Conn(fail_lock='"un_lockable"'))
 def test_preflight_uses_ordinary_rolled_back_transaction(self):
  c=Conn(); i=inv()
  with patch.object(freeze,"_inv",return_value=i): self.assertEqual(freeze.preflight(c),i)
  self.assertEqual(c.c.sql[0][0],"BEGIN"); self.assertEqual(c.rollbacks,1)
 def test_missing_precommit_persistence_rolls_back_without_commit(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"failed-rolled-back"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=lambda _:(_ for _ in ()).throw(RuntimeError()),final_receipt_writer=lambda _:None,terminal_assert=terminal)
  self.assertEqual(c.commits,0); self.assertGreater(c.rollbacks,0)
 def test_prepared_receipt_is_durable_before_single_commit(self):
  c=Conn(); i=inv(); ps=patches(i); events=[]
  def writer(receipt): events.append((receipt["status"],c.commits)); return receipt["receipt_sha256"]
  with ps[0],ps[1],ps[2],ps[3],ps[4]:
   self.assertEqual(freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=writer,final_receipt_writer=lambda r:events.append((r["status"],r["precommit_receipt_sha256"])),terminal_assert=terminal),capture())
  self.assertEqual(events[0],("prepared-not-committed",0)); self.assertEqual(c.commits,1); self.assertEqual(events[1][0],"committed")
 def test_old_prepared_writer_hashes_payload_with_claim_and_is_rejected(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"failed-rolled-back"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=lambda receipt:freeze.digest(receipt),final_receipt_writer=lambda _:None,terminal_assert=terminal)
  self.assertEqual(c.commits,0)
 def test_commit_ambiguity_retains_precommit_hash(self):
  c=Conn(commit_error=True); i=inv(); ps=patches(i); final=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"commit-ambiguous"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=precommit,final_receipt_writer=final.append,terminal_assert=terminal)
  self.assertEqual(final[-1]["status"],"commit-ambiguous"); self.assertTrue(final[-1]["precommit_receipt_sha256"])
 def test_acl_drift_after_locks_denies_capability(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],patch.object(freeze,"_inv",side_effect=(i,inv("b"))),ps[3],ps[4],self.assertRaises(freeze.FreezeError):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=precommit,final_receipt_writer=lambda _:None,terminal_assert=terminal)
 def test_residual_evidence_requires_exact_fresh_hashed_objects(self):
  now=int(time.time()); channels=("producer_stop","no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write")
  value={"schema":"g037-write-freeze-assertion-v1","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":freeze.MANIFEST_SHA256,"relation_root":"r"*64,"acl_root":"l"*64,"source_root":"s"*64,"terminal_spec":"t"*64,"issued_at":now-1,"expires_at":now+60,"attestations":{x:{"status":True,"evidence_sha256":"e"*64,"observed_at":now} for x in channels},"signature":"AA=="}
  value["attestations"]["producer_stop"]["status"]=False
  with self.assertRaisesRegex(Exception,"residual"): freeze.validate_operator_assertion(value,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
  value["attestations"]["producer_stop"]={"status":True,"evidence_sha256":"e"*64,"observed_at":now-901}
  with self.assertRaisesRegex(Exception,"residual"): freeze.validate_operator_assertion(value,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,now=now)
 def test_rehearse_runs_terminal_then_rolls_back_and_never_commits(self):
  c=Conn(); i=inv(); ps=patches(i); events=[]
  def callback(*_): events.append("apply"); return capture()
  def observed(*_): events.append("terminal"); return terminal(*_)
  with ps[0],ps[1],ps[2],ps[3],ps[4]:
   outcome=freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=callback,provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=lambda r:r["receipt_sha256"],terminal_assert=observed,baseline_assert=lambda:events.append("baseline") or {"relation_root":i.relation_root,"acl_root":i.acl_root})
  self.assertEqual(outcome["status"],"rehearsed-rolled-back"); self.assertEqual(c.commits,0)
  self.assertLess(events.index("apply"),events.index("terminal")); self.assertLess(events.index("terminal"),events.index("baseline")); self.assertGreater(c.rollbacks,0)
 def test_rehearse_rejects_malformed_capture_before_rollback_receipt(self):
  c=Conn(); i=inv(); ps=patches(i); receipts=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.FreezeError):
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:{},provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:receipts.append(r),outcome_receipt_writer=lambda r:receipts.append(r),terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertEqual(receipts,[]); self.assertEqual(c.commits,0)
 def test_rehearse_callback_failure_rolls_back_without_success_outcome(self):
  c=Conn(); i=inv(); ps=patches(i); outcomes=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(RuntimeError,"callback failure"):
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:(_ for _ in ()).throw(RuntimeError("callback failure")),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=outcomes.append,terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertEqual(c.commits,0); self.assertEqual(c.rollbacks,1); self.assertEqual(outcomes,[])
 def test_rehearse_rollback_failure_is_ambiguous_and_preserves_original_failure(self):
  c=Conn(rollback_error=True); i=inv(); ps=patches(i); outcomes=[]
  original=RuntimeError("callback failure includes secret")
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.RehearsalRollbackError) as raised:
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:(_ for _ in ()).throw(original),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=lambda r:outcomes.append(r) or r["receipt_sha256"],terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertIs(raised.exception.original_error,original); self.assertIsInstance(raised.exception.rollback_error,RuntimeError); self.assertIsNone(raised.exception.__cause__)
  self.assertEqual(c.commits,0); self.assertGreaterEqual(c.rollbacks,1); self.assertEqual(len(outcomes),1)
  self.assertEqual(outcomes[0]["status"],"rollback-failed"); self.assertEqual(outcomes[0]["rollback_state"],"ambiguous")
  self.assertEqual(outcomes[0]["failure_stage"],"begin"); self.assertNotIn("secret",str(outcomes[0]))
if __name__=="__main__": unittest.main()
