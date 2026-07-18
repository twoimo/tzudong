"""G037 fail-closed controller contracts; no hosted connection is created here."""
from __future__ import annotations
import hashlib, json, re, subprocess, sys, tempfile, time, unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/"scripts"))
import g037_hosted_closure_contract as c
import g037_hosted_closure_executor as e
import g037_write_freeze as f
import g035_hosted_recovery as g035
import preflight_g034_hosted_migration_closure as g034

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
 def test_terminal_readback_uses_g034_pinned_prosrc_contract(self):
  sql_path=Path(__file__).with_name("g037_hosted_terminal_readback.sql")
  sql=sql_path.read_text(encoding="utf-8")
  values=re.findall(r"\(\s*'(public\.approve_(?:edit_)?submission_item\(uuid,uuid,jsonb\))'\s*,\s*'([0-9a-f]{64})'\s*,\s*ARRAY\[([^\]]+)\]::text\[\]\s*\)",sql,re.S)
  parsed={signature:{"body_hash":body_hash,"argnames":tuple(re.findall(r"'([^']+)'",argnames))} for signature,body_hash,argnames in values}
  expected=g034.approval_body_contract()
  self.assertEqual(parsed,{"public.approve_submission_item(uuid,uuid,jsonb)":{"body_hash":expected["public.approve_submission_item(uuid,uuid,jsonb)"]["body_hash"],"argnames":expected["public.approve_submission_item(uuid,uuid,jsonb)"]["argnames"]},"public.approve_edit_submission_item(uuid,uuid,jsonb)":{"body_hash":expected["public.approve_edit_submission_item(uuid,uuid,jsonb)"]["body_hash"],"argnames":expected["public.approve_edit_submission_item(uuid,uuid,jsonb)"]["argnames"]}})
  catalog_match=re.search(r"\) = \(\s*'([^']+)'::\"char\",\s*'([^']+)'::name,\s*(true|false),\s*ARRAY\[([^\]]*)\]::text\[\],\s*(true|false),\s*(\d+)::oid,\s*ARRAY\[([^\]]*)\]::oid\[\],\s*ARRAY\[([^\]]*)\]::\"char\"\[\],\s*argnames\s*\)",sql,re.S)
  self.assertIsNotNone(catalog_match)
  prokind,language,prosecdef,proconfig,proretset,prorettype,allargtypes,argmodes=catalog_match.groups()
  parsed_attributes=(prokind,language,prosecdef=="true",tuple(re.findall(r"'([^']+)'",proconfig)),proretset=="true",int(prorettype),tuple(int(value) for value in allargtypes.split(",") if value.strip()),tuple(re.findall(r"'([^']+)'",argmodes)))
  self.assertEqual(parsed_attributes,g034.APPROVAL_CATALOG_ATTRIBUTES)
  self.assertIn("procedure.prosrc",sql)
  self.assertIn("pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(prosrc), '\\s+', ' ', 'g'))",sql)
  self.assertNotIn("pg_get_functiondef(procedure.oid)",sql)
  self.assertNotIn("regexp_match(",sql)
 def test_terminal_readback_source_and_sql_literal_drift_are_rejected(self):
  sql_path=Path(__file__).with_name("g037_hosted_terminal_readback.sql")
  sql=sql_path.read_text(encoding="utf-8")
  expected=g034.approval_body_contract()
  signature="public.approve_submission_item(uuid,uuid,jsonb)"
  self.assertIn(expected[signature]["body_hash"],sql)
  self.assertNotIn(expected[signature]["body_hash"],sql.replace(expected[signature]["body_hash"],"0"*64,1))
  mutated_sql=sql.replace("'p_item_id'","'p_forged_item_id'",1)
  value_pattern=r"\(\s*'(public\.approve_(?:edit_)?submission_item\(uuid,uuid,jsonb\))'\s*,\s*'([0-9a-f]{64})'\s*,\s*ARRAY\[([^\]]+)\]::text\[\]\s*\)"
  self.assertNotEqual(re.findall(value_pattern,sql,re.S),re.findall(value_pattern,mutated_sql,re.S))
  with tempfile.TemporaryDirectory() as raw:
   source_path=Path(raw)/"approval.sql"
   source=g034.TRACKED_APPROVAL_SOURCE.read_text(encoding="utf-8")
   source_path.write_text(source.replace("p_item_id uuid","p_forged_item_id uuid",1),encoding="utf-8")
   with patch.object(g034,"TRACKED_APPROVAL_SOURCE_SHA256",hashlib.sha256(source_path.read_bytes()).hexdigest()):
    with self.assertRaisesRegex(ValueError,"tracked-approval-source-fragment"):
     g034.approval_body_contract(source_path)
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
  with patch.object(e,"approval_body_contract",return_value={}),patch.object(e,"approval_catalog_contract",return_value={}):
   e.retirement_gate(Cursor())
   with self.assertRaisesRegex(e.ClosureError,"retirement gate failed"): e.retirement_gate(Cursor(table_absent=False))
   with self.assertRaisesRegex(e.ClosureError,"retirement gate failed"): e.retirement_gate(Cursor(referenced=True))
 def test_retirement_gate_scans_only_executable_functions_and_procedures(self):
  class Cursor:
   description=object()
   def __init__(self,referenced=False): self.referenced=referenced; self.sql=""
   def execute(self,sql,params=()):
    self.sql=sql
    if "pg_get_functiondef" in sql and "CASE WHEN p.prokind IN ('f','p') THEN pg_catalog.pg_get_functiondef(p.oid)" not in sql: raise RuntimeError("WrongObjectType")
   def fetchall(self):
    if "to_regclass" in self.sql: return [(True,)]
    return [(self.referenced and "pg_get_functiondef" in self.sql,)]
  for kind in ("function","procedure"):
   with patch.object(e,"approval_body_contract",return_value={}),patch.object(e,"approval_catalog_contract",return_value={}):
    with self.assertRaisesRegex(e.ClosureError,"retirement gate failed"): e.retirement_gate(Cursor(referenced=True))
  with patch.object(e,"approval_body_contract",return_value={}),patch.object(e,"approval_catalog_contract",return_value={}):
   e.retirement_gate(Cursor())
 def test_source_authenticated_approval_drift_rejects_baseline_and_terminal(self):
  class Cursor:
   description=object()
   def __init__(self,rows,issue):
    self.rows=rows; self.issue=issue; self.sql=""
   def execute(self,sql,params=()): self.sql=sql
   def fetchall(self):
    if "schema_migrations" in self.sql: return self.rows
    if "to_regclass" in self.sql: return [(True,)]
    if "procedure.proallargtypes" not in self.sql: return [(False,)]
    expected=next(iter(contract.values()))
    body=g034.extract_dollar_quoted_body(g034.TRACKED_APPROVAL_SOURCE.read_text(encoding="utf-8").split("create or replace function public.approve_submission_item",1)[1].split("$$;",1)[0]+"$$")
    definition=f"CREATE OR REPLACE FUNCTION public.approve_submission_item(uuid, uuid, jsonb) AS $function${body}$function$;"
    attributes=list(g034.APPROVAL_CATALOG_ATTRIBUTES+(expected["argnames"],))
    if self.issue=="body": definition=definition.replace("v_is_admin boolean","v_is_admin integer",1)
    else: attributes[{"prokind":0,"language":1,"prosecdef":2,"proconfig":3,"proretset":4,"prorettype":5,"proallargtypes":6,"proargmodes":7,"proargnames":8}[self.issue]]={"prokind":"p","language":"sql","prosecdef":False,"proconfig":("search_path=private",),"proretset":False,"prorettype":25,"proallargtypes":(2950,),"proargmodes":("i",),"proargnames":("wrong",)}[self.issue]
    return [(definition,*attributes)]
  manifest=c.load_manifest(Path(__file__).parents[3])
  vectors={item.version:(f"vector-{item.version}",) for item in manifest.migrations}
  baseline=tuple((version,name,("baseline",)) for version,name in c.BASELINE_PAIRS)
  terminal=baseline+tuple((item.version,item.name,vectors[item.version]) for item in manifest.migrations)
  contract={"public.approve_submission_item(uuid,uuid,jsonb)":g034.approval_body_contract()["public.approve_submission_item(uuid,uuid,jsonb)"]}
  drifts=("body","prokind","language","prosecdef","proconfig","proretset","prorettype","proallargtypes","proargmodes","proargnames")
  for drift in drifts:
   for phase,rows in (("baseline",baseline),("terminal",terminal)):
    cursor=Cursor(rows,drift)
    with self.subTest(drift=drift,phase=phase),patch.object(e,"approval_body_contract",return_value=contract):
     with self.assertRaisesRegex(e.ClosureError,"approval contract drift"):
      if phase=="baseline": e.catalog(cursor,manifest,terminal=False)
      else: e._terminal_assert(cursor,manifest,vectors)
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
 def test_documents_policy_compatibility_is_exact_and_deterministic(self):
  target=SimpleNamespace(version="20260627080000")
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=rows; self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return self.rows
  empty=Cursor(())
  e._prepare_documents_policy_compatibility(empty,target)
  self.assertEqual(empty.calls[0][1],([row[0] for row in e._DOCUMENTS_POLICY_CONTRACT],))
  self.assertEqual(len(empty.calls),1)
  exact=Cursor(e._DOCUMENTS_POLICY_CONTRACT)
  e._prepare_documents_policy_compatibility(exact,target)
  self.assertEqual(
   [sql for sql,_ in exact.calls[1:]],
   ['DROP POLICY "documents_delete_own" ON public.documents',
    'DROP POLICY "documents_insert_own" ON public.documents',
    'DROP POLICY "documents_select_own" ON public.documents',
    'DROP POLICY "documents_update_own" ON public.documents'],
  )
  self.assertIn("p.polpermissive",exact.calls[0][0])
  self.assertIn("pg_catalog.pg_roles",exact.calls[0][0])
  for rows in (
   e._DOCUMENTS_POLICY_CONTRACT[:-1],
   e._DOCUMENTS_POLICY_CONTRACT+(e._DOCUMENTS_POLICY_CONTRACT[0],),
   e._DOCUMENTS_POLICY_CONTRACT[:1]+(("documents_insert_own","INSERT",("PUBLIC",),True,None,"(auth.uid() = other_id)"),)+e._DOCUMENTS_POLICY_CONTRACT[2:],
   e._DOCUMENTS_POLICY_CONTRACT[:1]+(("documents_insert_own","INSERT",("authenticated",),True,None,"(auth.uid() = user_id)"),)+e._DOCUMENTS_POLICY_CONTRACT[2:],
   e._DOCUMENTS_POLICY_CONTRACT[:1]+(("documents_insert_own","INSERT",("PUBLIC",),False,None,"(auth.uid() = user_id)"),)+e._DOCUMENTS_POLICY_CONTRACT[2:],
  ):
   cursor=Cursor(rows)
   with self.subTest(rows=rows),self.assertRaisesRegex(e.ClosureError,"compatibility contract drift"):
    e._prepare_documents_policy_compatibility(cursor,target)
   self.assertEqual(len(cursor.calls),1)
  unrelated=Cursor(e._DOCUMENTS_POLICY_CONTRACT)
  e._prepare_documents_policy_compatibility(unrelated,SimpleNamespace(version="20260627080001"))
  self.assertEqual(unrelated.calls,[])
 def test_documents_policy_compatibility_precedes_immutable_vector_and_preserves_ledger(self):
  class Cursor:
   description=object()
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return e._DOCUMENTS_POLICY_CONTRACT
  root=Path(__file__).parents[3]
  item=next(migration for migration in c.load_manifest(root).migrations if migration.version=="20260627080000")
  recreated=tuple(f"CREATE POLICY {name}" for name,*_ in e._DOCUMENTS_POLICY_CONTRACT)
  cursor=Cursor()
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"source_sql"),patch.object(e,"vectors",return_value=(recreated,recreated)),patch.object(e,"_terminal_assert") as terminal:
   e._execute_closure(cursor,root,SimpleNamespace(migrations=(item,)),{})
  sql=[statement for statement,_ in cursor.calls]
  last_drop=sql.index('DROP POLICY "documents_update_own" ON public.documents')
  self.assertTrue(all(sql.index(statement)>last_drop for statement in recreated))
  insert=next(params for statement,params in cursor.calls if statement.startswith("INSERT INTO supabase_migrations.schema_migrations"))
  self.assertEqual(insert,(item.version,item.name,list(recreated)))
  terminal.assert_called_once_with(cursor,unittest.mock.ANY,{item.version:recreated})
 def test_execute_closure_records_real_vectors_with_fake_cursor(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
  root=Path(__file__).parents[3]; loaded=c.load_manifest(root)
  ordinary=next(item for item in loaded.migrations if item.version not in c.SELF_WRAPPING and item.version!=e._DOCUMENTS_POLICY_COMPATIBILITY_VERSION)
  wrapped=next(item for item in loaded.migrations if item.version in c.SELF_WRAPPING)
  manifest=SimpleNamespace(migrations=(ordinary,wrapped)); cursor=Cursor()
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"_terminal_assert") as terminal:
   e._execute_closure(cursor,root,manifest,{})
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
 def test_run_uses_one_cursor_for_read_only_catalog_and_readback(self):
  class Cursor:
   description=object()
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self):
    sql=self.calls[-1][0]
    return [(12345,)] if "to_regprocedure" in sql else [(True,)]
  class Connection:
   def __init__(self): self.cursor_value=Cursor(); self.events=[]
   def cursor(self): self.events.append("cursor"); return self.cursor_value
   def rollback(self): self.events.append("rollback")
   def close(self): self.events.append("close")
  def catalog(cur,manifest,*,terminal):
   self.assertIs(cur,connections[len(catalog_calls)].cursor_value); catalog_calls.append(terminal)
   return (("baseline","migration",()),),"c"*64
  def terminal(cur,root,manifest):
   self.assertIs(cur,connections[1].cursor_value)
   return {"catalog_root":"d"*64,"acl_root":"a"*64,"ledger_root":"l"*64}
  connections=[Connection(),Connection()]
  catalog_calls=[]
  with patch.object(e,"connection",side_effect=connections),patch.object(e,"catalog",side_effect=catalog),patch.object(e,"terminal_readback_assert",side_effect=terminal):
   preflight=e.run(SimpleNamespace(mode="preflight",db_env="TEST_DB"))
   readback=e.run(SimpleNamespace(mode="readback",db_env="TEST_DB"))
  self.assertEqual(preflight["status"],"ready")
  self.assertEqual(readback["status"],"readback")
  self.assertEqual(catalog_calls,[False,True])
  for conn in connections: self.assertEqual(conn.events,["cursor","rollback","close"])
  runtime=Connection()
  with patch.object(e,"connection",return_value=runtime):
   probe=e.run(SimpleNamespace(mode="runtime-probe",db_env="TEST_DB"))
  self.assertEqual(probe["status"],"authorization-denied")
  self.assertEqual(runtime.events,["cursor","rollback","close"])
  self.assertEqual([sql for sql,_ in runtime.cursor_value.calls],["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","SELECT pg_catalog.to_regprocedure(%s)","SELECT NOT has_function_privilege(current_user, pg_catalog.to_regprocedure(%s), 'EXECUTE')"])
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
   e.rehearse_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
   e.apply_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
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
    e.apply_cursor(Cursor(),{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
  execute.assert_not_called()
 def test_capability_binds_exact_immutable_source_and_inventory(self):
  now=int(time.time()); manifest=SimpleNamespace(migrations=())
  plain={"schema":"g037-write-freeze-v3","state":"active-provisional","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":c.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"scope":{"schemas":list(f.REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":"r"*64,"acl_root":"l"*64,"held_lock_root":"a"*64,"not_before_unix":now,"not_after_unix":now+60,"controller_public_key_sha256":f.CONTROLLER_PUBLIC_KEY_SHA256,"signature":"signed"}
  with patch.object(e,"_source_binding",return_value=("a"*40,"s"*64,"t"*64)):
   with self.assertRaisesRegex(e.ClosureError,"binding mismatch"): e.validate_controller_capability(plain,root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60)
   cap=f._verified_controller_capability(plain)
   self.assertEqual(e.validate_controller_capability(cap,root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60),"t"*64)
   for field,value in (("scope",{}),("origin",""),("held_lock_root","z"*64),("relation_root","x"*64),("acl_root","y"*64)):
    forged={**plain,field:value}
    with self.assertRaisesRegex(e.ClosureError,"binding mismatch"): e.validate_controller_capability(f._verified_controller_capability(forged),root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60)
  class HostileCapability(f.VerifiedControllerCapability): pass
  hostile=object.__new__(HostileCapability); object.__setattr__(hostile,"_values",dict(plain))
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,*args): self.calls.append(args)
  cursor=Cursor()
  with patch.object(e,"_source_binding",return_value=("a"*40,"s"*64,"t"*64)),self.assertRaisesRegex(e.ClosureError,"binding mismatch"):
   e.apply_cursor(cursor,hostile,root=Path("."),manifest=manifest,freeze_id="freeze-0001",relation_root="r"*64,acl_root="l"*64,deadline=now+60,remediation={})
  self.assertEqual(cursor.calls,[])
 def test_cross_module_short_url_canonicalization_is_byte_identical(self):
  rows=[{"id":"11111111-1111-1111-1111-111111111111","code":"keep","target_url":"https://example.test/a","created_at":None},{"id":"22222222-2222-2222-2222-222222222222","code":"duplicate","target_url":"https://example.test/a","created_at":"2026-07-18T00:00:00+00:00"}]
  descriptors=[{"source_id":rows[1]["id"],"keeper_id":rows[0]["id"],"target_url_sha256":g035.canonical_sha256(rows[0]["target_url"]),"rank":2,"source_row_sha256":g035.canonical_sha256(rows[1])}]
  values=(rows,list(g035.SHORT_URLS_CATALOG),descriptors,[])
  for value in values:
   self.assertEqual(g035.canonical_sha256(value),f.digest(value))
   self.assertEqual(f.digest(value),e.canonical_sha256(value))
  capture={"selection_spec_sha256":e.canonical_sha256(g035.SHORT_URL_SELECTION_SPEC),"short_urls_catalog_sha256":e.canonical_sha256(list(g035.SHORT_URLS_CATALOG)),"short_urls_rowset_sha256":e.canonical_sha256(rows),"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"victim_descriptor_count":1,"duplicate_victims_sha256":e.canonical_sha256(descriptors),"victim_descriptors_sha256":e.canonical_sha256(descriptors)}
  self.assertEqual(dict(f.verified_recovery_capture(capture)),capture)
 def test_plain_capture_is_rejected_before_remediation(self):
  capture={"selection_spec_sha256":"1"*64,"short_urls_catalog_sha256":"2"*64,"short_urls_rowset_sha256":"3"*64,"short_urls_row_count":0,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":"4"*64,"victim_descriptors_sha256":"4"*64}
  binding={"authorization":{},"execution_authorization_sha256":"a"*64,"execution_authorization_signature_sha256":"b"*64,"legacy_authorization_sha256":"c"*64,"legacy_authorization_signature_sha256":"d"*64,"legacy_capture_receipt_sha256":"e"*64,"legacy_restore_receipt_sha256":"f"*64,"legacy_inspection_receipt_sha256":"1"*64,"recovery_receipt_sha256":"2"*64,"capture_evidence":capture}
  with self.assertRaisesRegex(e.ClosureError,"short_urls remediation binding invalid"): e._short_url_binding(binding,baseline_is_exact=lambda: True)
 def test_hostile_capture_subclass_is_rejected_before_authorized_remediation(self):
  capture={"selection_spec_sha256":"1"*64,"short_urls_catalog_sha256":"2"*64,"short_urls_rowset_sha256":"3"*64,"short_urls_row_count":0,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":"4"*64,"victim_descriptors_sha256":"4"*64}
  class HostileCapture(f.VerifiedRecoveryCapture): pass
  hostile=object.__new__(HostileCapture); object.__setattr__(hostile,"_values",capture)
  binding={key:"a"*64 for key in e._SHORT_URL_BINDING_FIELDS-{"envelope","expected_bindings","capture_evidence"}}
  binding.update(envelope={},expected_bindings={},capture_evidence=hostile)
  authorization={"policy":e.POLICY,"legacy_repository_commit":binding["legacy_repository_commit"],**{key:binding[key] for key in ("legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256")}}
  with patch.object(e,"ExecutionAuthorizationEnvelope",dict),patch.object(e,"authorize_exact_baseline",return_value=authorization) as authorize:
   with self.assertRaisesRegex(e.ClosureError,"capture binding invalid"):
    e._short_url_binding(binding,baseline_is_exact=lambda: (_ for _ in ()).throw(AssertionError("callback invoked")))
  authorize.assert_called_once()
 def test_stable_terminal_projection_accepts_canonical_catalog_rows_and_rejects_drift(self):
  catalog=(("public","restaurants","r","owner"),); raw_acl=(("auth","users","supabase_auth_admin","supabase_auth_admin","MAINTAIN",False),("public","restaurants","owner","owner","SELECT",False)); acl=tuple(tuple(map(str,row)) for row in raw_acl)
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=iter(rows)
   def execute(self,sql,params=()): pass
   def fetchall(self): return next(self.rows)
  accepted=e._stable_projection_roots(Cursor((catalog,raw_acl)))
  self.assertEqual(accepted,(e.digest(catalog),e.digest(acl)))
  for unsafe in (
   ("public","restaurants","owner","PUBLIC","SELECT",False),
   ("public","restaurants","owner","PUBLIC","ALL",False),
   ("public","restaurants","owner","owner","SELECT",True),
   ("shortener_private","limits","owner","authenticated","SELECT",False),
   ("public","restaurants","owner","owner","UNKNOWN",False),
   ("public","restaurants","owner","PUBLIC","MAINTAIN",False),
   ("public","restaurants","owner","owner","MAINTAIN",True),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(e.ClosureError,"ACL safety policy"):
    e._stable_projection_roots(Cursor((catalog,(unsafe,))))
  with self.assertRaisesRegex(e.ClosureError,"catalog projection noncanonical"):
   e._stable_projection_roots(Cursor(((catalog[0],catalog[0]),raw_acl)))
 def test_observed_terminal_roots_are_not_source_placeholders(self):
  rows=(("2025","x",("observed vector",)),)
  with patch.object(e,"_terminal_assert",return_value=rows),patch.object(e,"_stable_projection_roots",return_value=("c"*64,"a"*64)),patch.object(e,"_source_binding",return_value=("h"*40,"s"*64,"t"*64)):
   value=e.observed_terminal_roots(object(),Path("."),SimpleNamespace(migrations=()))
  self.assertEqual(value,{"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":e.digest(rows),"terminal_spec":"t"*64})
 def test_postcommit_root_drift_is_observable(self):
  before={"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64}
  after={**before,"acl_root":"b"*64}
  self.assertNotEqual(before,after)
 def test_short_url_remediation_deletes_only_derived_victims_and_proves_survivors(self):
  keeper="11111111-1111-1111-1111-111111111111"; victim="22222222-2222-2222-2222-222222222222"
  rows=[{"id":keeper,"code":"keep"},{"id":victim,"code":"victim"}]
  descriptor={"source_id":victim,"keeper_id":keeper,"target_url_sha256":"a"*64,"rank":2,"source_row_sha256":"b"*64}
  pre={"selection_spec_sha256":"s"*64,"short_urls_catalog_sha256":"c"*64,"short_urls_rowset_sha256":"r"*64,"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"victim_descriptor_count":1,"duplicate_victims_sha256":"d"*64,"victim_descriptors_sha256":"d"*64,"_rows":rows,"_victims":[descriptor]}
  post={**pre,"short_urls_rowset_sha256":"p"*64,"short_urls_row_count":1,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":e.canonical_sha256([]),"victim_descriptors_sha256":e.canonical_sha256([]),"_rows":[rows[0]],"_victims":[]}
  queries=[]
  def query(_,sql,params=()):
   queries.append((sql,params)); return [(victim,)]
  auth={**pre,"authorization_id":"11111111-1111-4111-8111-111111111111","policy":"exact-baseline-to-terminal-ledger-single-commit-v1","legacy_vector":{key:pre["short_urls_rowset_sha256"] if key=="pre_short_urls_rowset_sha256" else pre[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}}
  with patch.object(e,"_short_url_binding",return_value=(auth,pre)),patch.object(e,"_short_url_snapshot",side_effect=(pre,post)),patch.object(e,"q",side_effect=query):
   result=e.remediate_short_url_duplicates(object(),{"execution_authorization_sha256":"f"*64,"execution_authorization_signature_sha256":"e"*64,"legacy_repository_commit":"0"*40,"legacy_authorization_sha256":"d"*64,"legacy_authorization_signature_sha256":"c"*64,"legacy_capture_receipt_sha256":"b"*64,"legacy_restore_receipt_sha256":"a"*64,"legacy_inspection_receipt_sha256":"1"*64,"recovery_receipt_sha256":"2"*64})
  self.assertEqual(result["deleted_count"],1)
  self.assertEqual(queries[0][1],([victim],))
  self.assertIn("WHERE id = ANY(%s::uuid[])",queries[0][0])
  self.assertIn("RETURNING id::text",queries[0][0])
  self.assertNotIn("target_url",queries[0][0])
 def test_short_url_remediation_rejects_capture_drift_before_delete_and_wrong_returning(self):
  base={"selection_spec_sha256":"s"*64,"short_urls_catalog_sha256":"c"*64,"short_urls_rowset_sha256":"r"*64,"short_urls_row_count":0,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":e.canonical_sha256([]),"victim_descriptors_sha256":e.canonical_sha256([]),"_rows":[],"_victims":[]}
  drift={**base,"short_urls_row_count":1}
  auth={**base,"pre_short_urls_rowset_sha256":base["short_urls_rowset_sha256"],"legacy_vector":{key:base["short_urls_rowset_sha256"] if key=="pre_short_urls_rowset_sha256" else base[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}}
  with patch.object(e,"_short_url_binding",return_value=(auth,base)),patch.object(e,"_short_url_snapshot",return_value=drift),patch.object(e,"q") as query:
   with self.assertRaisesRegex(e.ClosureError,"capture drift"): e.remediate_short_url_duplicates(object(),{})
  query.assert_not_called()
  victim="22222222-2222-2222-2222-222222222222"; descriptor={"source_id":victim}
  before={**base,"short_urls_row_count":1,"duplicate_group_count":1,"duplicate_victim_count":1,"victim_descriptor_count":1,"duplicate_victims_sha256":"d"*64,"victim_descriptors_sha256":"d"*64,"_rows":[{"id":victim}],"_victims":[descriptor]}
  auth={**before,"pre_short_urls_rowset_sha256":before["short_urls_rowset_sha256"],"legacy_vector":{key:before["short_urls_rowset_sha256"] if key=="pre_short_urls_rowset_sha256" else before[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}}
  with patch.object(e,"_short_url_binding",return_value=(auth,before)),patch.object(e,"_short_url_snapshot",return_value=before),patch.object(e,"q",return_value=[]):
   with self.assertRaisesRegex(e.ClosureError,"returning mismatch"): e.remediate_short_url_duplicates(object(),{})
if __name__=="__main__": unittest.main()
