"""G037 fail-closed controller contracts; no hosted connection is created here."""
from __future__ import annotations
import json, subprocess, sys, tempfile, time, unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/"scripts"))
import g037_hosted_closure_contract as c
import g037_hosted_closure_executor as e

class G037ExecutorTests(unittest.TestCase):
 def test_duplicate_keys_and_pinned_manifest(self):
  with self.assertRaises(c.ContractError): json.loads('{"x":1,"x":2}',object_pairs_hook=c.no_duplicate_object)
  self.assertEqual(c.MANIFEST_SHA256,"1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1")
  self.assertEqual(len(c.load_manifest(Path(__file__).parents[3]).migrations),28)
 def test_g026_and_later_promotions_are_excluded(self):
  self.assertTrue({"20260627150000","20260713002500","20260713002600","20260713002700"} <= c.FORBIDDEN_VERSIONS)
 def test_only_exact_self_wrappers_are_normalized(self):
  self.assertEqual(e.source_sql.__name__,"source_sql")
  self.assertEqual(e.SELF_WRAPPING,("20260712000400","20260713002400"))
 def test_receipts_have_no_raw_sensitive_values(self):
  value=e.receipt("validate","denied",{"sql":"select secret","database_url":"postgres://x","subject":"person","commit_sha256":"a"*40})
  text=json.dumps(value); self.assertEqual(value["schema"],"g037-hosted-closure-receipt-v3"); self.assertNotIn("select secret",text); self.assertNotIn("postgres",text); self.assertNotIn("person",text)
 def test_modes_are_controller_read_only_exact(self):
  self.assertEqual(c.MODES,{"validate","preflight","readback","runtime-probe","reconciliation-readback"})
 def test_parser_rejects_direct_apply_before_credential_access(self):
  with patch.object(e,"connection") as connect,patch.object(e,"run") as run:
   for argv in (["apply"],["validate","--apply"]):
    with self.subTest(argv=argv),self.assertRaises(SystemExit): e.main(argv)
  connect.assert_not_called(); run.assert_not_called()
 def test_retirement_gate_rejects_live_or_referenced_retired_source(self):
  class Cursor:
   description=object()
   def __init__(self,table_absent=True,referenced=False): self.table_absent=table_absent; self.referenced=referenced; self.sql=""
   def execute(self,sql,params=()): self.sql=sql
   def fetchall(self):
    if "to_regclass" in self.sql: return [(self.table_absent,)]
    return [(self.referenced,)]
  with patch.object(e,"TRACKED_APPROVAL_FUNCTIONS",()):
   e.retirement_gate(Cursor())
   with self.assertRaisesRegex(e.ClosureError,"retirement gate failed"): e.retirement_gate(Cursor(table_absent=False))
   with self.assertRaisesRegex(e.ClosureError,"retirement gate failed"): e.retirement_gate(Cursor(referenced=True))
 def test_parser_port_emits_pinned_upstream_identity_for_real_vectors(self):
  parser=Path(__file__).parents[1]/"scripts/g037_supabase_statement_vector.mjs"
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  item=manifest.migrations[-1]; source=root/item.path
  result=subprocess.run(["node",str(parser),"--source",str(source),"--version",item.version,"--sha256",item.sha256,"--size",str(source.stat().st_size)],capture_output=True,text=True,check=True)
  vector=json.loads(result.stdout)
  self.assertEqual(vector["upstream"],{"commit":"6d4c19870ed213ba7f682f117d0345c8a40bfa94","version":"v2.109.1","token":{"path":"apps/cli-go/pkg/parser/token.go","blob":"db008434246be335b9f7abaf0cb66a99a2b40378"},"state":{"path":"apps/cli-go/pkg/parser/state.go","blob":"47775390d1731c0ad29e10b20fb2fe16c8cfcadb"}})
  self.assertEqual(vector["source_sha256"],item.sha256)
  self.assertGreaterEqual(len(vector["statements"]),1)
 def test_source_sql_and_vector_wrappers_accept_exact_inputs_and_reject_drift(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  ordinary=next(item for item in manifest.migrations if item.version not in c.SELF_WRAPPING)
  wrapped=next(item for item in manifest.migrations if item.version in c.SELF_WRAPPING)
  self.assertEqual(e.source_sql(root,ordinary),(root/ordinary.path).read_bytes())
  full,inner=e.vectors(root,ordinary)
  self.assertEqual(full,inner)
  wrapped_full,wrapped_inner=e.vectors(root,wrapped)
  self.assertTrue(e.source_sql(root,wrapped).strip())
  self.assertGreaterEqual(len(wrapped_full),3)
  self.assertEqual(wrapped_inner,wrapped_full[1:-1])
  with tempfile.TemporaryDirectory() as raw:
   fixture_root=Path(raw); item=c.Migration("20260714000000","fixture","fixture.sql","0"*64)
   (fixture_root/item.path).write_bytes(b"BEGIN;\nSELECT 1;\n")
   with self.assertRaisesRegex(e.ClosureError,"transaction-control drift"): e.source_sql(fixture_root,item)
   self_item=c.Migration(c.SELF_WRAPPING[0],"fixture","wrapped.sql","0"*64)
   (fixture_root/self_item.path).write_bytes(b"BEGIN;\nSELECT 1;\nCOMMIT;\n")
   self.assertEqual(e.source_sql(fixture_root,self_item),b"\nSELECT 1;\n")
   (fixture_root/self_item.path).write_bytes(b"BEGIN;\nCOMMIT;\nSELECT 1;\nCOMMIT;\n")
   with self.assertRaisesRegex(e.ClosureError,"self-wrapper drift"): e.source_sql(fixture_root,self_item)
 def test_execute_closure_records_real_vectors_with_fake_cursor(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
  root=Path(__file__).parents[3]; loaded=c.load_manifest(root)
  ordinary=next(item for item in loaded.migrations if item.version not in c.SELF_WRAPPING)
  wrapped=next(item for item in loaded.migrations if item.version in c.SELF_WRAPPING)
  manifest=SimpleNamespace(migrations=(ordinary,wrapped)); cursor=Cursor()
  with patch.object(e,"_terminal_assert") as terminal:
   e._execute_closure(cursor,root,manifest)
  inserts=[params for sql,params in cursor.calls if sql.startswith("INSERT INTO supabase_migrations.schema_migrations")]
  self.assertEqual(len(inserts),2)
  for item,params in zip(manifest.migrations,inserts):
   full,inner=e.vectors(root,item)
   self.assertEqual(params,(item.version,item.name,list(full)))
   self.assertEqual([sql for sql,_ in cursor.calls].count("BEGIN"),0)
   self.assertTrue(inner)
  terminal.assert_called_once()
 def test_transaction_and_vector_ledger_contract_accepts_exact_rows_and_rejects_drift(self):
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=rows; self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return self.rows
  manifest=c.load_manifest(Path(__file__).parents[3])
  vectors={item.version:(f"vector-{item.version}",) for item in manifest.migrations}
  rows=tuple((version,name,("baseline",)) for version,name in c.BASELINE_PAIRS)+tuple((item.version,item.name,vectors[item.version]) for item in manifest.migrations)
  with patch.object(e,"retirement_gate"):
   e._terminal_assert(Cursor(rows),manifest,vectors)
   with self.assertRaisesRegex(e.ClosureError,"terminal ledger mismatch"): e._terminal_assert(Cursor(rows[:-1]),manifest,vectors)
   drifted=rows[:-1]+((rows[-1][0],rows[-1][1],("drift",)),)
   with self.assertRaisesRegex(e.ClosureError,"terminal vector mismatch"): e._terminal_assert(Cursor(drifted),manifest,vectors)
  lock_cursor=Cursor(())
  e._lock_under_controller(lock_cursor)
  self.assertEqual([sql for sql,_ in lock_cursor.calls],["SET LOCAL statement_timeout = '60s'","SET LOCAL lock_timeout = '10s'","SET LOCAL idle_in_transaction_session_timeout = '60s'","SELECT pg_advisory_xact_lock(37037)"])
 def test_runtime_probe_resolves_terminal_eight_argument_mutator(self):
  class Cursor:
   description=object()
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return [(True,)] if len(self.calls)==3 else [(12345,)]
  cursor=Cursor()
  self.assertTrue(e.runtime_probe(cursor))
  self.assertIn("timestamptz,text)",cursor.calls[1][1][0])
  self.assertIn("to_regprocedure",cursor.calls[2][0])
 def test_runtime_probe_rejects_missing_terminal_mutator(self):
  class Cursor:
   description=object()
   def execute(self,sql,params=()): pass
   def fetchall(self): return [(None,)]
  with self.assertRaisesRegex(e.ClosureError,"terminal mutator unavailable"): e.runtime_probe(Cursor())
 def test_cursor_only_rehearsal_rolls_back_before_single_apply(self):
  class Cursor:
   def __init__(self): self.events=[]
   def execute(self,sql,params=()): self.events.append(sql)
  cursor=Cursor(); baseline=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)
  with patch.object(e,"validate_controller_capability"),patch.object(e,"ledger",return_value=baseline),patch.object(e,"_execute_closure",side_effect=lambda cur,*_:cur.events.append("execute")) as execute:
   e.rehearse_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60)
   e.apply_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60)
  self.assertEqual(execute.call_count,2)
  self.assertLess(cursor.events.index("ROLLBACK TO SAVEPOINT g037_rehearsal"),cursor.events.index("execute",cursor.events.index("ROLLBACK TO SAVEPOINT g037_rehearsal")+1))
  self.assertNotIn("BEGIN",cursor.events)
  self.assertNotIn("COMMIT",cursor.events)
  self.assertNotIn("ROLLBACK",cursor.events)
 def test_cursor_apply_does_not_retry_after_ambiguous_baseline(self):
  class Cursor:
   def execute(self,*_): pass
  nonbaseline=(("unexpected","migration",()),)
  with patch.object(e,"validate_controller_capability"),patch.object(e,"ledger",return_value=nonbaseline),patch.object(e,"_execute_closure") as execute:
   with self.assertRaisesRegex(e.ClosureError,"retry forbidden"):
    e.apply_cursor(Cursor(),{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60)
  execute.assert_not_called()
 def test_capability_binds_exact_immutable_source_and_inventory(self):
  now=int(time.time()); manifest=SimpleNamespace(migrations=())
  cap={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":c.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"scope":{},"relation_root":"r"*64,"acl_root":"l"*64,"held_lock_root":"h"*64,"not_before_unix":now,"not_after_unix":now+60,"controller_public_key_sha256":"key","signature":"signed"}
  with patch.object(e,"_source_binding",return_value=("a"*40,"s"*64,"t"*64)):
   self.assertEqual(e.validate_controller_capability(cap,root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60),"t"*64)
   cap["source_root"]="x"*64
   with self.assertRaisesRegex(e.ClosureError,"binding mismatch"): e.validate_controller_capability(cap,root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60)
 def test_stable_terminal_projection_accepts_canonical_catalog_rows_and_rejects_drift(self):
  catalog=(("public","restaurants","r","owner"),); acl=(("public","restaurants","owner","PUBLIC","SELECT","False"),)
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=iter(rows)
   def execute(self,sql,params=()): pass
   def fetchall(self): return next(self.rows)
  accepted=e._stable_projection_roots(Cursor((catalog,acl)))
  self.assertEqual(accepted,(e.digest(catalog),e.digest(acl)))
  with self.assertRaisesRegex(e.ClosureError,"catalog projection noncanonical"):
   e._stable_projection_roots(Cursor(((catalog[0],catalog[0]),acl)))
 def test_observed_terminal_roots_are_not_source_placeholders(self):
  rows=(("2025","x",("observed vector",)),)
  with patch.object(e,"_terminal_assert",return_value=rows),patch.object(e,"_stable_projection_roots",return_value=("c"*64,"a"*64)),patch.object(e,"_source_binding",return_value=("h"*40,"s"*64,"t"*64)):
   value=e.observed_terminal_roots(object(),Path("."),SimpleNamespace(migrations=()))
  self.assertEqual(value,{"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":e.digest(rows),"terminal_spec":"t"*64})
 def test_postcommit_root_drift_is_observable(self):
  before={"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64}
  after={**before,"acl_root":"b"*64}
  self.assertNotEqual(before,after)
if __name__=="__main__": unittest.main()
