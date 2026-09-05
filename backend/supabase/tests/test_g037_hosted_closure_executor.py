"""G037 fail-closed controller contracts; no hosted connection is created here."""
from __future__ import annotations
import hashlib, json, re, subprocess, sys, tempfile, time, traceback, unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/"scripts"))
import g037_hosted_closure_contract as c
import g037_hosted_closure_executor as e
import g037_write_freeze as f
import g037_production_controller as controller
import g035_hosted_recovery as g035
import preflight_g034_hosted_migration_closure as g034

class G037ExecutorTests(unittest.TestCase):
 def test_duplicate_keys_and_pinned_manifest(self):
  with self.assertRaises(c.ContractError): json.loads('{"x":1,"x":2}',object_pairs_hook=c.no_duplicate_object)
  self.assertEqual(c.MANIFEST_SHA256,"bba79f264f26158d2fd93f62a0632f44ff8a0575619b50928e23ecefccf8ab95")
  self.assertEqual(len(c.load_manifest(Path(__file__).parents[3]).migrations),29)
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
  self.assertEqual(set(parsed),set(expected))
  for signature,entry in parsed.items():
   source=g034.TRACKED_APPROVAL_SOURCE.read_text(encoding="utf-8")
   name=expected[signature]["name"]
   declaration=source.split(f"create or replace function public.{name}",1)[1].split("$$;",1)[0]+"$$"
   self.assertEqual(entry,{"body_hash":hashlib.sha256(g034.extract_dollar_quoted_body(declaration).encode("utf-8")).hexdigest(),"argnames":expected[signature]["argnames"]})
  catalog_match=re.search(r"\) = \(\s*'([^']+)'::\"char\",\s*'([^']+)'::name,\s*(true|false),\s*ARRAY\[([^\]]*)\]::text\[\],\s*(true|false),\s*(\d+)::oid,\s*ARRAY\[([^\]]*)\]::oid\[\],\s*ARRAY\[([^\]]*)\]::\"char\"\[\],\s*argnames\s*\)",sql,re.S)
  self.assertIsNotNone(catalog_match)
  prokind,language,prosecdef,proconfig,proretset,prorettype,allargtypes,argmodes=catalog_match.groups()
  parsed_attributes=(prokind,language,prosecdef=="true",tuple(re.findall(r"'([^']+)'",proconfig)),proretset=="true",int(prorettype),tuple(int(value) for value in allargtypes.split(",") if value.strip()),tuple(re.findall(r"'([^']+)'",argmodes)))
  self.assertEqual(parsed_attributes,g034.APPROVAL_CATALOG_ATTRIBUTES)
  self.assertIn("procedure.prosrc",sql)
  self.assertIn("pg_catalog.convert_to(prosrc, 'UTF8')",sql)
  self.assertNotIn("pg_get_functiondef(procedure.oid)",sql)
  self.assertNotIn("regexp_match(",sql)
 def test_terminal_readback_source_and_sql_literal_drift_are_rejected(self):
  sql_path=Path(__file__).with_name("g037_hosted_terminal_readback.sql")
  sql=sql_path.read_text(encoding="utf-8")
  expected=g034.approval_body_contract()
  signature="public.approve_submission_item(uuid,uuid,jsonb)"
  source=g034.TRACKED_APPROVAL_SOURCE.read_text(encoding="utf-8")
  exact_hash=hashlib.sha256(g034.extract_dollar_quoted_body(source.split("create or replace function public.approve_submission_item",1)[1].split("$$;",1)[0]+"$$").encode("utf-8")).hexdigest()
  self.assertIn(exact_hash,sql)
  self.assertNotIn(exact_hash,sql.replace(exact_hash,"0"*64,1))
  body=g034.extract_dollar_quoted_body(source.split("create or replace function public.approve_submission_item",1)[1].split("$$;",1)[0]+"$$")
  literal="v_is_admin"
  self.assertIn(literal,body)
  mutated_body=body.replace(literal,"v_is_ADMIN",1)
  self.assertNotEqual(body.encode("utf-8"),mutated_body.encode("utf-8"))
  self.assertNotEqual(hashlib.sha256(body.encode("utf-8")).hexdigest(),hashlib.sha256(mutated_body.encode("utf-8")).hexdigest())
  self.assertNotEqual(hashlib.sha256(body.encode("utf-8")).hexdigest(),hashlib.sha256(body.replace("\n","\n ",1).encode("utf-8")).hexdigest())
  mutated_sql=sql.replace("'p_item_id'","'p_forged_item_id'",1)
  value_pattern=r"\(\s*'(public\.approve_(?:edit_)?submission_item\(uuid,uuid,jsonb\))'\s*,\s*'([0-9a-f]{64})'\s*,\s*ARRAY\[([^\]]+)\]::text\[\]\s*\)"
  self.assertNotEqual(re.findall(value_pattern,sql,re.S),re.findall(value_pattern,mutated_sql,re.S))
  with tempfile.TemporaryDirectory() as raw:
   source_path=Path(raw)/"approval.sql"
   source=g034.TRACKED_APPROVAL_SOURCE.read_bytes()
   source_path.write_bytes(source.replace(b"p_item_id uuid",b"p_forged_item_id uuid",1))
   with patch.object(g034,"TRACKED_APPROVAL_SOURCE_SHA256",hashlib.sha256(source_path.read_bytes()).hexdigest()):
    with self.assertRaisesRegex(ValueError,"tracked-approval-source-fragment"):
     g034.approval_body_contract(source_path)
 def test_pg17_role_protocol_is_explicit_and_terminal_bound(self):
  self.assertEqual(c.MANAGED_ROLES,(
   "privacy_workflow_owner","privacy_retention_operator_approver",
   "privacy_retention_legal_approver","privacy_retention_activation_operator"))
  self.assertEqual(len(c.TRANSIENT_MANAGED_ROWS),5)
  self.assertEqual(len(c.TERMINAL_MANAGED_ROWS),4)
  self.assertEqual(c.TRANSIENT_MANAGED_ROWS[0],
   ("privacy_workflow_owner","postgres","postgres",False,True,True))
  self.assertNotEqual(c.terminal_spec(c.load_manifest(Path(__file__).parents[3])),
   c.digest({"manifest":c.MANIFEST_SHA256}))
  self.assertEqual(hashlib.sha256(c.ROLE_PROTOCOL_EPILOGUE).hexdigest(),
   c.ROLE_PROTOCOL_EPILOGUE_SHA256)

 def test_terminal_readback_is_catalog_only_for_role_and_rpc_contracts(self):
  sql=Path(__file__).with_name("g037_hosted_terminal_readback.sql").read_text(encoding="utf-8")
  self.assertIn("EXCEPT ALL",sql)
  self.assertIn("postgres_member_without_usage_or_set",sql)
  self.assertIn("static_public_rpc_acl_matches",sql)
  self.assertNotIn("g014_public_rpc_allowlist",sql)

 def test_precompute_happens_before_cursor_admission_and_remediation(self):
  source=Path(e.__file__).read_text(encoding="utf-8")
  for name in ("rehearse_cursor","apply_cursor"):
   body=source[source.index(f"def {name}"):source.index("\ndef ",source.index(f"def {name}")+1)]
   self.assertLess(body.index("_precompute_execution_plan"),body.index("_lock_under_controller"))
  body=source[source.index("def _execute_closure"):source.index("def rehearse_cursor")]
  self.assertIn("_assert_memberships(cur, TRANSIENT_MANAGED_ROWS)",body)
  self.assertIn("_assert_memberships(cur, TERMINAL_MANAGED_ROWS)",body)
 def test_receipts_have_no_raw_sensitive_values(self):
  value=e.receipt("validate","denied",{"sql":"select secret","database_url":"postgres://x","subject":"person","commit_sha256":"a"*40})
  text=json.dumps(value); self.assertEqual(value["schema"],"g037-hosted-closure-receipt-v3"); self.assertNotIn("select secret",text); self.assertNotIn("postgres",text); self.assertNotIn("person",text)
 def test_denial_codes_are_closed_and_phase_specific(self):
  expected={
   "database credential environment unavailable":"credential_environment_unavailable",
   "database connection unavailable":"database_connection_unavailable",
   "database role contract failed":"readonly_role_contract_denied",
   "ledger state does not match requested mode":"ledger_state_mismatch",
   "terminal mutator unavailable":"runtime_terminal_mutator_unavailable",
   "runtime probe authorization unexpectedly granted":"runtime_execute_privilege_present",
  }
  for message,code in expected.items():
   with self.subTest(message=message):
    self.assertEqual(e.denial_evidence(e.ClosureError(message)),{"ambiguous_commit":False,"denial_code":code})
  self.assertEqual(e.denial_evidence(e.ClosureError("commit ambiguity: readback only; retry forbidden")),{"ambiguous_commit":True,"denial_code":"commit_ambiguous"})
  self.assertEqual(e.denial_evidence(e.ClosureError("commit result ambiguous")),{"ambiguous_commit":True,"denial_code":"commit_ambiguous"})
  self.assertEqual(e.denial_evidence(c.ContractError("arbitrary source detail")),{"ambiguous_commit":False,"denial_code":"source_contract_denied"})
 def test_arbitrary_denial_text_cannot_cross_receipt_boundary(self):
  secret="postgresql://operator:credential@provider.invalid/database"
  evidence=e.denial_evidence(e.ClosureError(secret))
  self.assertEqual(evidence,{"ambiguous_commit":False,"denial_code":"controller_contract_denied"})
  value=e.receipt("runtime-probe","denied",{"denial_code":secret,"provider_message":secret})
  self.assertNotIn("denial_code",value["evidence"])
  self.assertNotIn(secret,json.dumps(value))
 def test_main_collapses_unhandled_exception_without_serializing_it(self):
  emitted=[]
  with patch.object(e,"run",side_effect=RuntimeError("provider endpoint and credential")),patch.object(e,"emit",side_effect=emitted.append):
   self.assertEqual(e.main(["runtime-probe","--db-env","TEST_DB"]),2)
  self.assertEqual(emitted[0]["evidence"],{"ambiguous_commit":False,"denial_code":"controller_internal_denied"})
  self.assertNotIn("provider endpoint",json.dumps(emitted[0]))
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
 def test_retirement_gate_uses_phase_specific_source_bound_search_path(self):
  cursor=type("Cursor",(),{
   "description":object(),
   "execute":lambda self,sql,params=(): setattr(self,"sql",sql),
   "fetchall":lambda self: [(True,)] if "to_regclass" in self.sql else [(False,)],
  })()
  with patch.object(e,"approval_body_contract",return_value={"signature":{}}),patch.object(e,"approval_catalog_contract",return_value={"signature":True}) as approval:
   e.retirement_gate(cursor)
   self.assertEqual(approval.call_args.kwargs["expected_proconfig"],("search_path=public",))
   e.retirement_gate(cursor,terminal=True)
   self.assertEqual(approval.call_args.kwargs["expected_proconfig"],('search_path=""',))
 def test_connection_is_bounded_and_credential_name_only(self):
  source=Path(e.__file__).read_text(encoding="utf-8")
  self.assertIn("connect_timeout=10",source)
  self.assertIn('options="-c statement_timeout=30000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000"',source)
  self.assertNotIn("psycopg.connect(os.environ[env_name], autocommit=False)",source)
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
 def test_executable_plan_rejects_every_transaction_control_form_after_wrapper_stripping(self):
  root=Path(__file__).parents[3]; ordinary=next(item for item in c.load_manifest(root).migrations if item.version not in c.SELF_WRAPPING)
  wrapped=c.Migration(c.SELF_WRAPPING[0],"fixture","fixture.sql","0"*64)
  def parser_result(item,statements,source_size):
   return SimpleNamespace(returncode=0,stdout=json.dumps({"schema":"g037-supabase-statement-vector-v1","upstream":{"commit":"6d4c19870ed213ba7f682f117d0345c8a40bfa94","version":"v2.109.1","token":{"path":"apps/cli-go/pkg/parser/token.go","blob":"db008434246be335b9f7abaf0cb66a99a2b40378"},"state":{"path":"apps/cli-go/pkg/parser/state.go","blob":"47775390d1731c0ad29e10b20fb2fe16c8cfcadb"}},"version":item.version,"source_sha256":item.sha256,"source_size":source_size,"statements":statements}))
  controls=(
   "ABORT","BEGIN","COMMIT","END","END WORK","END TRANSACTION",
   "PREPARE TRANSACTION rehearsal","ROLLBACK","SAVEPOINT rehearsal",
   "RELEASE SAVEPOINT rehearsal","START TRANSACTION",
  )
  def adversarial_forms(control):
   return (
    f"/* parser comment */ {control};",
    f"/* outer /* nested */ comment */ {control};",
    control.replace(" ", " /* inter-keyword comment */ ") + ";",
    f"-- bare CR comment\r{control};",
    f"-- CRLF comment\r\n{control};",
   )
  for control in controls:
   for statement in adversarial_forms(control):
    with self.subTest(control=statement),patch.object(e.subprocess,"run",return_value=parser_result(ordinary,(statement,"SELECT 1;"),(root/ordinary.path).stat().st_size)):
     with self.assertRaisesRegex(e.ClosureError,"transaction-control drift"): e.vectors(root,ordinary)
  for statement in ("SELECT 'BEGIN';","SELECT $$START TRANSACTION$$;","SELECT (SAVEPOINT rehearsal);"):
   with self.subTest(non_control=statement):
    self.assertFalse(e._has_executable_plan_transaction_control(statement))
  with tempfile.TemporaryDirectory() as raw:
   fixture_root=Path(raw); (fixture_root/wrapped.path).write_text("fixture",encoding="utf-8")
   for control in controls:
    for statement in adversarial_forms(control):
     with self.subTest(wrapper_control=statement),patch.object(e.subprocess,"run",return_value=parser_result(wrapped,("BEGIN;",statement,"COMMIT;"),7)):
      with self.assertRaisesRegex(e.ClosureError,"self-wrapper vector drift"): e.vectors(fixture_root,wrapped)
  for control in controls:
   for statement in adversarial_forms(control):
    with self.subTest(transformed_control=statement),patch.object(e,"_source_bound_rpc_matrix",return_value=c.STATIC_RPC_MATRIX),patch.object(e,"_splice_specs",return_value=()),patch.object(e,"source_sql"),patch.object(e,"vectors",side_effect=[(("epilogue",),("epilogue",)),(("source",),("source",))]),patch.object(e,"transformed_vectors",return_value=(("source",),(statement,))),patch.object(e,"ROLE_PROTOCOL_EPILOGUE_VECTOR_SHA256",e.digest(("epilogue",))):
     with self.assertRaisesRegex(e.ClosureError,"executable plan transaction-control drift"):
      e._precompute_execution_plan(root,SimpleNamespace(migrations=(ordinary,)))
 def test_documents_policy_compatibility_is_exact_and_deterministic(self):
  target=SimpleNamespace(version="20260627080000")
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=rows; self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return self.rows
  empty=Cursor(())
  e._prepare_documents_policy_compatibility(empty,target,deadline=int(time.time())+60)
  self.assertEqual(empty.calls[0][1],([row[0] for row in e._DOCUMENTS_POLICY_CONTRACT],))
  self.assertEqual(len(empty.calls),1)
  exact=Cursor(e._DOCUMENTS_POLICY_CONTRACT)
  e._prepare_documents_policy_compatibility(exact,target,deadline=int(time.time())+60)
  self.assertEqual(
   [sql for sql,_ in exact.calls[1:] if sql.startswith('DROP POLICY')],
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
    e._prepare_documents_policy_compatibility(cursor,target,deadline=int(time.time())+60)
   self.assertEqual(len(cursor.calls),1)
  unrelated=Cursor(e._DOCUMENTS_POLICY_CONTRACT)
  e._prepare_documents_policy_compatibility(unrelated,SimpleNamespace(version="20260627080001"),deadline=int(time.time())+60)
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
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"_admission_assert"),patch.object(e,"validate_managed_role_coverage"),patch.object(e,"_assert_role_flags"),patch.object(e,"_assert_memberships"),patch.object(e,"_terminal_assert") as terminal:
   e._execute_closure(cursor,root,SimpleNamespace(migrations=(item,)),{},plan=((item,recreated,recreated,recreated),),deadline=int(time.time())+60)
  sql=[statement for statement,_ in cursor.calls]
  last_drop=sql.index('DROP POLICY "documents_update_own" ON public.documents')
  self.assertTrue(all(sql.index(statement)>last_drop for statement in recreated))
  insert=next(params for statement,params in cursor.calls if statement.startswith("INSERT INTO supabase_migrations.schema_migrations"))
  self.assertEqual(insert,(item.version,item.name,list(recreated)))
  terminal.assert_called_once_with(cursor,unittest.mock.ANY,{item.version:recreated},deadline=unittest.mock.ANY)
 def test_execute_closure_records_real_vectors_with_fake_cursor(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
  root=Path(__file__).parents[3]; loaded=c.load_manifest(root)
  ordinary=next(item for item in loaded.migrations if item.version not in c.SELF_WRAPPING and item.version!=e._DOCUMENTS_POLICY_COMPATIBILITY_VERSION)
  wrapped=next(item for item in loaded.migrations if item.version in c.SELF_WRAPPING)
  manifest=SimpleNamespace(migrations=(ordinary,wrapped)); cursor=Cursor()
  plan=tuple((item,*e.vectors(root,item),e.vectors(root,item)[1]) for item in manifest.migrations)
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"_admission_assert"),patch.object(e,"validate_managed_role_coverage"),patch.object(e,"_assert_role_flags"),patch.object(e,"_assert_memberships"),patch.object(e,"_terminal_assert") as terminal:
   e._execute_closure(cursor,root,manifest,{},plan=plan,deadline=int(time.time())+60)
  inserts=[params for sql,params in cursor.calls if sql.startswith("INSERT INTO supabase_migrations.schema_migrations")]
  self.assertEqual(len(inserts),2)
  for item,params in zip(manifest.migrations,inserts):
   full,inner=e.vectors(root,item)
   self.assertEqual(params,(item.version,item.name,list(full)))
   self.assertEqual([sql for sql,_ in cursor.calls].count("BEGIN"),0)
   self.assertTrue(inner)
  terminal.assert_called_once()
 def test_unspliced_and_spliced_self_wrappers_execute_inner_vectors_and_ledger_original_full_vectors(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
  root=Path(__file__).parents[3]; loaded=c.load_manifest(root)
  unspliced=next(item for item in loaded.migrations if item.version in c.SELF_WRAPPING and item.version not in e._ROLE_SPLICE_VERSIONS)
  spliced=next(item for item in loaded.migrations if item.version in c.SELF_WRAPPING and item.version in e._ROLE_SPLICE_VERSIONS)
  splices=e._splice_specs(root,loaded); plan=[]
  for item in (unspliced,spliced):
   original_full,original_inner=e.vectors(root,item)
   transformed_full,transformed_inner=e.transformed_vectors(root,item,splices=splices,original_full=original_full,original_inner=original_inner)
   plan.append((item,original_full,transformed_full,transformed_inner))
  cursor=Cursor()
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"_admission_assert"),patch.object(e,"validate_managed_role_coverage"),patch.object(e,"_assert_role_flags"),patch.object(e,"_assert_memberships"),patch.object(e,"_terminal_assert"):
   e._execute_closure(cursor,root,SimpleNamespace(migrations=(unspliced,spliced)),{},plan=tuple(plan),deadline=int(time.time())+60)
  expected_inner=[statement for _,_,_,inner in plan for statement in inner]
  executed=[sql for sql,_ in cursor.calls]
  self.assertEqual([sql for sql in executed if sql in expected_inner],expected_inner)
  for _,full,_,inner in plan:
   self.assertNotIn(full[0],executed)
   self.assertNotIn(full[-1],executed)
  inserts=[params for sql,params in cursor.calls if sql.startswith("INSERT INTO supabase_migrations.schema_migrations")]
  self.assertEqual(inserts,[(item.version,item.name,list(full)) for item,full,_,_ in plan])
  self.assertEqual([params[2] for params in inserts],[list(full) for _,full,_,_ in plan])
  self.assertEqual(plan[0][2:],(plan[0][1],plan[0][1][1:-1]))
  self.assertNotEqual(plan[1][2],plan[1][1])
  self.assertEqual(plan[1][3],e.vectors(root,spliced,raw=next(entry["transformed"] for entry in splices if entry["version"]==spliced.version),source_sha256=next(entry["group"]["transformed_source_sha256"] for entry in splices if entry["version"]==spliced.version))[1])
 def test_transaction_and_vector_ledger_contract_accepts_exact_rows_and_rejects_drift(self):
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=rows; self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return self.rows
  manifest=c.load_manifest(Path(__file__).parents[3])
  vectors={item.version:(f"vector-{item.version}",) for item in manifest.migrations}
  rows=tuple((version,name,("baseline",)) for version,name in c.BASELINE_PAIRS)+tuple((item.version,item.name,vectors[item.version]) for item in manifest.migrations)
  with patch.object(e,"retirement_gate"),patch.object(e,"_assert_role_flags"),patch.object(e,"_assert_memberships"),patch.object(e,"_managed_role_catalog_assert"),patch.object(e,"_g014_public_rpc_acl_assert"):
   e._terminal_assert(Cursor(rows),manifest,vectors)
   with self.assertRaisesRegex(e.ClosureError,"terminal ledger mismatch"): e._terminal_assert(Cursor(rows[:-1]),manifest,vectors)
   drifted=rows[:-1]+((rows[-1][0],rows[-1][1],("drift",)),)
   with self.assertRaisesRegex(e.ClosureError,"terminal vector mismatch"): e._terminal_assert(Cursor(drifted),manifest,vectors)
  lock_cursor=Cursor(())
  deadline=(105,15)
  remaining_ms=4500
  with patch.object(e.time,"time",return_value=100.5),patch.object(e.time,"monotonic",return_value=10.5):
   e._lock_under_controller(lock_cursor,deadline=deadline)
  self.assertEqual(lock_cursor.calls,[
   ("SELECT pg_catalog.set_config('statement_timeout', %s, true)",(f"{remaining_ms}ms",)),
   ("SELECT pg_catalog.set_config('lock_timeout', %s, true)",(f"{remaining_ms}ms",)),
   ("SELECT pg_catalog.set_config('statement_timeout', %s, true)",(f"{remaining_ms}ms",)),
   ("SELECT pg_catalog.set_config('idle_in_transaction_session_timeout', %s, true)",(f"{remaining_ms}ms",)),
   ("SELECT pg_catalog.set_config('statement_timeout', %s, true)",(f"{remaining_ms}ms",)),
   ("SELECT pg_catalog.pg_advisory_xact_lock(37037)",()),
  ])
 def test_raw_migration_percent_is_not_parsed_as_a_driver_placeholder(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,*args): self.calls.append(args)
  cursor=Cursor()
  with patch.object(e.time,"time",return_value=100.0),patch.object(e.time,"monotonic",return_value=10.0):
   e._execute_before_deadline(cursor,"SELECT 'value % required'",deadline=(105.0,15.0))
  self.assertEqual(cursor.calls,[
   ("SELECT pg_catalog.set_config('statement_timeout', %s, true)",("5000ms",)),
   ("SELECT 'value % required'",),
  ])
 def test_statement_timeout_is_capped_without_shortening_a_near_expiry_deadline(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,*args): self.calls.append(args)
  high_remaining=Cursor()
  low_remaining=Cursor()
  with patch.object(e.time,"time",return_value=100.0),patch.object(e.time,"monotonic",return_value=10.0):
   e._execute_before_deadline(high_remaining,"SELECT 1",deadline=(220.0,130.0))
   e._execute_before_deadline(low_remaining,"SELECT 1",deadline=(105.0,15.0))
  self.assertEqual(high_remaining.calls[0],("SELECT pg_catalog.set_config('statement_timeout', %s, true)",("60000ms",)))
  self.assertEqual(low_remaining.calls[0],("SELECT pg_catalog.set_config('statement_timeout', %s, true)",("5000ms",)))
 def test_immutable_statement_failure_diagnostic_is_sanitized_and_bounded(self):
  raw_sql="SELECT 'raw migration SQL must not leak'"
  secret_parameter="untrusted-parameter-must-not-leak"
  class Cursor:
   description=None
   def execute(self,sql,params=()):
    if sql==raw_sql: raise RuntimeError(f"database rejected {raw_sql} params=({secret_parameter!r},)")
  item=SimpleNamespace(version="20260718009999",name="hostile")
  expected_hash=hashlib.sha256(raw_sql.encode("utf-8")).hexdigest()
  with patch.object(e,"remediate_short_url_duplicates",return_value={}),patch.object(e,"_admission_assert"),patch.object(e,"validate_managed_role_coverage"),patch.object(e,"_assert_role_flags"),patch.object(e,"_assert_memberships"),patch.object(e,"_terminal_assert"):
   with self.assertRaises(e.ClosureError) as raised:
    e._execute_closure(Cursor(),Path("."),SimpleNamespace(migrations=(item,)),{},plan=((item,("SELECT 1",raw_sql),("SELECT 1",raw_sql),("SELECT 1",raw_sql)),),deadline=int(time.time())+60)
  diagnostic=str(raised.exception)
  self.assertEqual(diagnostic,f"immutable migration statement failed: version={item.version}, ordinal=2, sha256={expected_hash}")
  self.assertIsNone(raised.exception.__cause__)
  self.assertNotIn(raw_sql,diagnostic)
  self.assertNotIn(secret_parameter,diagnostic)
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
  with patch.object(e,"connection",side_effect=connections),patch.object(e,"readonly_role_admission") as role_admission,patch.object(e,"catalog",side_effect=catalog),patch.object(e,"terminal_readback_assert",side_effect=terminal):
   preflight=e.run(SimpleNamespace(mode="preflight",db_env="TEST_DB"))
   readback=e.run(SimpleNamespace(mode="readback",db_env="TEST_DB"))
  self.assertEqual(preflight["status"],"ready")
  self.assertEqual(readback["status"],"readback")
  self.assertEqual(catalog_calls,[False,True])
  self.assertEqual(role_admission.call_count,2)
  for conn in connections: self.assertEqual(conn.events,["cursor","rollback","close"])
  runtime=Connection()
  with patch.object(e,"connection",return_value=runtime),patch.object(e,"readonly_role_admission") as role_admission:
   probe=e.run(SimpleNamespace(mode="runtime-probe",db_env="TEST_DB"))
  self.assertEqual(probe["status"],"authorization-denied")
  role_admission.assert_called_once_with(runtime.cursor_value)
  self.assertEqual(runtime.events,["cursor","rollback","close"])
  self.assertEqual([sql for sql,_ in runtime.cursor_value.calls],["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","SELECT pg_catalog.to_regprocedure(%s)","SELECT NOT pg_catalog.has_function_privilege(current_user, pg_catalog.to_regprocedure(%s), 'EXECUTE')"])
 def test_admission_sees_explicit_snapshot_and_cleanup_closes_after_rollback_error(self):
  events=[]
  class Cursor:
   def execute(self,sql): events.append(sql)
  class Connection:
   def cursor(self): return Cursor()
   def rollback(self): events.append("rollback"); raise RuntimeError("fixture rollback failure")
   def close(self): events.append("close")
  def admission(cursor):
   self.assertEqual(events,["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"])
   events.append("admission")
   raise e.ClosureError("fixture denied")
  with patch.object(e,"connection",return_value=Connection()),patch.object(e,"readonly_role_admission",side_effect=admission):
   with self.assertRaisesRegex(RuntimeError,"fixture rollback failure"):
    e.run(SimpleNamespace(mode="runtime-probe",db_env="TEST_DB"))
  self.assertEqual(events[-3:],["admission","rollback","close"])
 def test_readonly_role_admission_requires_all_thirty_three_checks(self):
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=rows; self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return self.rows
  admitted=Cursor([(True,)*33])
  e.readonly_role_admission(admitted)
  sql,params=admitted.calls[0]
  self.assertEqual(len(params),2)
  self.assertEqual(params[0],params[1])
  self.assertIn("current_user='tzudong_g037_readonly'",sql)
  self.assertIn("current_setting('transaction_read_only')='on'",sql)
  self.assertIn("unexpected_direct_grants",sql)
  self.assertIn("membership_shape",sql)
  self.assertIn("member_nonsuperuser_createrole_count",sql)
  self.assertIn("superuser_grantor_count",sql)
  self.assertIn("admin_option_count",sql)
  self.assertIn("set_option_count",sql)
  self.assertIn("inherit_option_count",sql)
  self.assertNotIn("COALESCE(attribute_row.attacl",sql)
  self.assertIn("has_function_privilege",sql)
  for index in range(33):
   values=[True]*33; values[index]=False
   with self.subTest(index=index),self.assertRaisesRegex(e.ClosureError,"database role contract failed"):
    e.readonly_role_admission(Cursor([tuple(values)]))
 def test_runtime_probe_resolves_terminal_eight_argument_mutator(self):
  class Cursor:
   description=object()
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
   def fetchall(self): return [(True,)] if len(self.calls)==2 else [(12345,)]
  cursor=Cursor()
  self.assertTrue(e.runtime_probe(cursor))
  self.assertIn("timestamptz,text)",cursor.calls[0][1][0])
  self.assertIn("to_regprocedure",cursor.calls[1][0])
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
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"ledger",return_value=baseline),patch.object(e,"_execute_closure",side_effect=lambda cur,*_,**__:cur.events.append("execute")) as execute:
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
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"ledger",return_value=nonbaseline),patch.object(e,"_execute_closure") as execute:
   with self.assertRaisesRegex(e.ClosureError,"retry forbidden"):
    e.apply_cursor(Cursor(),{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
  execute.assert_not_called()
 def test_expiry_is_rechecked_after_precompute_and_before_mutation(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append((sql,params))
  cursor=Cursor(); baseline=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"ledger",return_value=baseline),patch.object(e,"_execute_closure") as execute,patch.object(e.time,"time",side_effect=(100,100,100,102)):
   with self.assertRaisesRegex(e.ClosureError,"commit ambiguity: readback only; retry forbidden"):
    e.apply_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=101,remediation={})
  execute.assert_not_called()
  with patch.object(e,"_admission_assert"),patch.object(e,"remediate_short_url_duplicates") as remediate,patch.object(e,"validate_managed_role_coverage"),patch.object(e.time,"time",return_value=102):
   with self.assertRaisesRegex(e.ClosureError,"expired"):
    e._execute_closure(Cursor(),Path("."),SimpleNamespace(migrations=()),{},plan=(),deadline=101)
  remediate.assert_not_called()
 def test_apply_rejects_expiry_at_final_commit_handoff(self):
  class Cursor:
   def execute(self,*_): pass
  baseline=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"_lock_under_controller"),patch.object(e,"ledger",return_value=baseline),patch.object(e,"_execute_closure",return_value={}) as execute,patch.object(e,"_assert_capability_not_expired",side_effect=(None,None,e.ClosureError("controller capability expired"))):
   with self.assertRaisesRegex(e.ClosureError,"commit ambiguity: readback only; retry forbidden"):
    e.apply_cursor(Cursor(),{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
  execute.assert_called_once()
 def test_apply_provider_failures_are_bounded_after_admission(self):
  class Cursor:
   def execute(self,*_): pass
  baseline=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)
  for stage in ("lock","baseline","closure","handoff"):
   marker=f"provider secret {stage}: SELECT private_value"
   with self.subTest(stage=stage),patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"_lock_under_controller") as lock,patch.object(e,"ledger",return_value=baseline) as read_ledger,patch.object(e,"_execute_closure",return_value={}) as execute,patch.object(e,"_assert_capability_not_expired") as assert_deadline:
    if stage == "lock":
     lock.side_effect=RuntimeError(marker)
    elif stage == "baseline":
     read_ledger.side_effect=RuntimeError(marker)
    elif stage == "closure":
     execute.side_effect=RuntimeError(marker)
    else:
     assert_deadline.side_effect=(None,None,e.ClosureError(marker))
    with self.assertRaisesRegex(e.ClosureError,"commit ambiguity: readback only; retry forbidden") as raised:
     e.apply_cursor(Cursor(),{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
    self.assertNotIn(marker,str(raised.exception))
    self.assertIsNone(raised.exception.__cause__)
    self.assertIsNone(raised.exception.__context__)
    self.assertNotIn(marker,"".join(traceback.format_exception(raised.exception)))
 def test_runtime_rpc_matrix_shape_is_fail_closed(self):
  with self.assertRaisesRegex(e.ClosureError,"noncanonical"):
   e._g014_public_rpc_acl_assert(object(), ())
 def test_provider_vector_runtime_acl_exception_is_exact_and_opt_in(self):
  with self.assertRaisesRegex(e.ClosureError,"noncanonical"):
   e._g014_public_rpc_acl_assert(
    object(), e.STATIC_RPC_MATRIX,
    allow_provider_vector_extension_members="yes",
   )
  required=(
   "pg_get_userbyid(procedure.proowner) = 'supabase_admin'",
   "dependency.deptype = 'e'",
   "extension.extname = 'vector'",
   "extension_namespace.nspname = 'public'",
   "pg_get_userbyid(extension.extowner) = 'supabase_admin'",
  )
  with patch.object(
   e,"q",
   side_effect=[[],tuple(sorted(e.STATIC_RPC_MATRIX)),[],[],[]],
  ) as query:
   e._g014_public_rpc_acl_assert(
    object(),e.STATIC_RPC_MATRIX,
    allow_provider_vector_extension_members=True,
   )
  for index in (2,3):
   sql=query.call_args_list[index].args[1]
   for token in required:
    self.assertIn(token,sql)
  with patch.object(
   e,"q",
   side_effect=[[],tuple(sorted(e.STATIC_RPC_MATRIX)),[],[],[]],
  ) as query:
   e._g014_public_rpc_acl_assert(object(),e.STATIC_RPC_MATRIX)
  for index in (2,3):
   self.assertNotIn("dependency.deptype = 'e'",query.call_args_list[index].args[1])
 def test_terminal_readback_rechecks_deadline_after_queries(self):
  manifest=SimpleNamespace(migrations=())
  with patch.object(e,"_terminal_assert",return_value=()),patch.object(e,"_stable_projection_roots",return_value=("catalog","acl")),patch.object(e,"_source_binding",return_value=("commit","source","terminal")),patch.object(e,"_assert_capability_not_expired",side_effect=(None,e.ClosureError("controller capability expired"))):
   with self.assertRaisesRegex(e.ClosureError,"expired"):
    e.observed_terminal_roots(object(),Path("."),manifest,deadline=1)
 def test_rehearsal_rolls_back_after_expiry_and_rejects_rollback_failure(self):
  class Cursor:
   def __init__(self,fail_rollback=False): self.events=[]; self.fail_rollback=fail_rollback
   def execute(self,sql,params=()):
    self.events.append(sql)
    if self.fail_rollback and sql.startswith("ROLLBACK TO SAVEPOINT"):
     raise RuntimeError("rollback failed")
  baseline=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)
  execution=RuntimeError("provider error: SELECT secret")
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())),patch.object(e,"_lock_under_controller"),patch.object(e,"ledger",return_value=baseline),patch.object(e,"_execute_closure",side_effect=execution):
   cursor=Cursor()
   with self.assertRaisesRegex(e.ClosureError,"rehearsal execution failed") as raised:
    e.rehearse_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
   self.assertIn("ROLLBACK TO SAVEPOINT g037_rehearsal",cursor.events)
   self.assertIn("RELEASE SAVEPOINT g037_rehearsal",cursor.events)
   self.assertIsNone(raised.exception.__cause__)
   self.assertIsNone(raised.exception.__context__)
   self.assertNotIn("provider error", "".join(traceback.format_exception(raised.exception)))
   self.assertNotIn("SELECT secret", "".join(traceback.format_exception(raised.exception)))
   failed=Cursor(True)
   with self.assertRaisesRegex(e.ClosureError,"rehearsal rollback cleanup failed") as rollback_raised:
    e.rehearse_cursor(failed,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
   self.assertNotIn("provider error",str(rollback_raised.exception))
   self.assertNotIn("SELECT secret",str(rollback_raised.exception))
   self.assertIsNone(rollback_raised.exception.__cause__)
   self.assertIsNone(rollback_raised.exception.__context__)
   self.assertNotIn("provider error", "".join(traceback.format_exception(rollback_raised.exception)))
   self.assertNotIn("SELECT secret", "".join(traceback.format_exception(rollback_raised.exception)))
   self.assertNotIn("RELEASE SAVEPOINT g037_rehearsal",failed.events)
 def test_rehearsal_savepoint_provider_failure_is_bounded(self):
  marker="provider secret: SAVEPOINT g037_rehearsal"
  class Cursor:
   def __init__(self): self.events=[]
   def execute(self,sql,params=()):
    self.events.append(sql)
    if sql == "SAVEPOINT g037_rehearsal":
     raise RuntimeError(marker)
  cursor=Cursor()
  with patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",return_value=((),())):
   with self.assertRaisesRegex(e.ClosureError,"rehearsal execution failed") as raised:
    e.rehearse_cursor(cursor,{},root=Path("."),manifest=SimpleNamespace(),freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
  self.assertNotIn(marker,str(raised.exception))
  self.assertIsNone(raised.exception.__cause__)
  self.assertIsNone(raised.exception.__context__)
  self.assertNotIn(marker,"".join(traceback.format_exception(raised.exception)))
  self.assertNotIn("ROLLBACK TO SAVEPOINT g037_rehearsal",cursor.events)
  self.assertNotIn("RELEASE SAVEPOINT g037_rehearsal",cursor.events)
 def test_catalog_helpers_and_function_identity_are_search_path_stable(self):
  executor=Path(e.__file__).read_text(encoding="utf-8")
  contract=Path(c.__file__).read_text(encoding="utf-8")
  terminal=Path(__file__).with_name("g037_hosted_terminal_readback.sql").read_text(encoding="utf-8")
  for source in (executor,terminal):
   self.assertIn("pg_catalog.pg_get_function_identity_arguments",source)
   self.assertNotIn("::regprocedure::text",source)
  self.assertNotIn("SELECT NOT has_function_privilege(",executor)
  self.assertNotIn("extensions.digest(p.prosrc",executor)
  self.assertNotIn("pg_catalog.lower(prosrc)",terminal)
  for helper in ("pg_catalog.pg_get_userbyid","pg_catalog.aclexplode","pg_catalog.acldefault","pg_catalog.array_to_string"):
   self.assertIn(helper,executor)
  self.assertIn("pg_catalog.aclexplode",terminal)
  sql_sources=executor+contract+terminal
  for helper in ("pg_catalog.count(","pg_catalog.bool_and(","pg_catalog.json_agg(","pg_catalog.json_build_object(","pg_catalog.to_jsonb(","pg_catalog.first_value(","pg_catalog.row_number(","pg_catalog.encode(","pg_catalog.unnest(","extensions.digest("):
   self.assertIn(helper,sql_sources)
  for unqualified in ("SELECT count(","(SELECT count(","COALESCE(bool_and(", ",json_agg(", ",json_build_object(", ",to_jsonb(", ",first_value(", ",row_number(", ",encode(digest("," FROM unnest("):
   self.assertNotIn(unqualified,sql_sources)
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
  binding.update(envelope={},expected_bindings={},capture_evidence=hostile,legacy_repository_commit="a"*40)
  authorization={"policy":e.POLICY,"legacy_repository_commit":binding["legacy_repository_commit"],**{key:binding[key] for key in ("legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256")}}
  with patch.object(e,"ExecutionAuthorizationEnvelope",dict),patch.object(e,"authorize_exact_baseline",return_value=authorization) as authorize:
   with self.assertRaisesRegex(e.ClosureError,"capture binding invalid"):
    e._short_url_binding(binding,baseline_is_exact=lambda: (_ for _ in ()).throw(AssertionError("callback invoked")))
  authorize.assert_called_once()
 def test_short_url_binding_requires_canonical_legacy_commit_and_sha256_provenance(self):
  capture={"selection_spec_sha256":"1"*64,"short_urls_catalog_sha256":"2"*64,"short_urls_rowset_sha256":"3"*64,"short_urls_row_count":0,"duplicate_group_count":0,"duplicate_victim_count":0,"victim_descriptor_count":0,"duplicate_victims_sha256":"4"*64,"victim_descriptors_sha256":"4"*64}
  capture=f.verified_recovery_capture(capture)
  def binding(commit):
   value={key:"a"*64 for key in e._SHORT_URL_BINDING_FIELDS-{"envelope","expected_bindings","capture_evidence","legacy_repository_commit"}}
   value.update(envelope={},expected_bindings={},capture_evidence=capture,legacy_repository_commit=commit)
   return value
  def authorization(value):
   return {"policy":e.POLICY,"legacy_repository_commit":value["legacy_repository_commit"],"legacy_vector":{"selection_spec_sha256":capture["selection_spec_sha256"],"short_urls_catalog_sha256":capture["short_urls_catalog_sha256"],"pre_short_urls_rowset_sha256":capture["short_urls_rowset_sha256"],"duplicate_group_count":capture["duplicate_group_count"],"duplicate_victim_count":capture["duplicate_victim_count"],"duplicate_victims_sha256":capture["duplicate_victims_sha256"],"victim_descriptors_sha256":capture["victim_descriptors_sha256"]},**{key:value[key] for key in ("legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256")}}
  valid=binding("0123456789abcdef0123456789abcdef01234567")
  with patch.object(e,"ExecutionAuthorizationEnvelope",dict),patch.object(e,"authorize_exact_baseline",return_value=authorization(valid)):
   self.assertEqual(e._short_url_binding(valid,baseline_is_exact=lambda: True)[1],capture)
  for commit in ("A"*40,"a"*39,"a"*41,"g"*40):
   with self.subTest(commit=commit):
    invalid=binding(commit)
    with patch.object(e,"ExecutionAuthorizationEnvelope",dict),patch.object(e,"authorize_exact_baseline",return_value=authorization(invalid)):
     with self.assertRaisesRegex(e.ClosureError,"provenance invalid"): e._short_url_binding(invalid,baseline_is_exact=lambda: True)
  invalid_sha=binding("0123456789abcdef0123456789abcdef01234567"); invalid_sha["execution_authorization_sha256"]="a"*63
  with patch.object(e,"ExecutionAuthorizationEnvelope",dict),patch.object(e,"authorize_exact_baseline",return_value=authorization(invalid_sha)):
   with self.assertRaisesRegex(e.ClosureError,"provenance invalid"): e._short_url_binding(invalid_sha,baseline_is_exact=lambda: True)
 def test_stable_terminal_projection_accepts_canonical_catalog_rows_and_rejects_drift(self):
  catalog=(("auth","users","r","supabase_auth_admin"),("public","restaurants","r","owner")); raw_acl=(("auth","users","supabase_auth_admin","supabase_auth_admin","MAINTAIN",False),("public","restaurants","owner","owner","SELECT",True)); acl=tuple(tuple(map(str,row)) for row in raw_acl)
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=iter(rows)
   def execute(self,sql,params=()): pass
   def fetchall(self): return next(self.rows)
  accepted=e._stable_projection_roots(Cursor((catalog,raw_acl)))
  self.assertEqual(accepted,(e.digest(catalog),e.digest(acl)))
  reversed_result=e._stable_projection_roots(Cursor((tuple(reversed(catalog)),tuple(reversed(raw_acl)))))
  self.assertEqual(reversed_result,accepted)
  for unsafe in (
   ("public","restaurants","owner","other","SELECT",True),
   ("public","restaurants","other","owner","SELECT",True),
   ("public","restaurants","owner","PUBLIC","SELECT",False),
   ("public","restaurants","owner","PUBLIC","SELECT",True),
   ("public","restaurants","owner","service_role","SELECT",True),
   ("public","restaurants","owner","owner","UNKNOWN",False),
   ("shortener_private","limits","owner","authenticated","SELECT",False),
   ("public","missing","owner","owner","SELECT",False),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(e.ClosureError,"ACL safety policy"):
    e._stable_projection_roots(Cursor((catalog,(unsafe,))))
  with self.assertRaisesRegex(e.ClosureError,"catalog projection noncanonical"):
   e._stable_projection_roots(Cursor(((catalog[0],catalog[0]),raw_acl)))
  with self.assertRaisesRegex(e.ClosureError,"acl projection noncanonical"):
   e._stable_projection_roots(Cursor((catalog,(raw_acl[0],raw_acl[0]))))
 def test_terminal_acl_projection_uses_the_ordinary_relation_inventory_boundary(self):
  catalog=(("public","restaurants","r","owner"),)
  ordinary_acl=(("public","restaurants","owner","owner","SELECT",True),)
  nonordinary_acl=("public","restaurants_view","owner","PUBLIC","SELECT",True)
  class Cursor:
   description=object()
   def __init__(self): self.calls=[]
   def execute(self,sql,params=()): self.calls.append(sql)
   def fetchall(self):
    if len(self.calls)==1: return catalog
    return ordinary_acl if "c.relkind IN ('r','p')" in self.calls[-1] else ordinary_acl+(nonordinary_acl,)
  self.assertEqual(e._stable_projection_roots(Cursor()),(e.digest(catalog),e.digest(tuple(tuple(map(str,row)) for row in ordinary_acl))))
  source=Path(e.__file__).read_text(encoding="utf-8")
  catalog_sql=re.search(r'raw_catalog_rows=.*?"(SELECT .*?)",\(list\(schemas\),\)\)',source)
  acl_sql=re.search(r'raw_acl_rows=.*?"(SELECT .*?)",\(list\(schemas\),\)\)',source)
  self.assertIsNotNone(catalog_sql)
  self.assertIsNotNone(acl_sql)
  self.assertIn("c.relkind IN ('r','p')",catalog_sql.group(1))
  self.assertIn("c.relkind IN ('r','p')",acl_sql.group(1))
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
  def query(_,sql,params=(),*,deadline):
   queries.append((sql,params)); return [(victim,)]
  auth={**pre,"authorization_id":"11111111-1111-4111-8111-111111111111","policy":"exact-baseline-to-terminal-ledger-single-commit-v1","legacy_vector":{key:pre["short_urls_rowset_sha256"] if key=="pre_short_urls_rowset_sha256" else pre[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}}
  with patch.object(e,"_short_url_binding",return_value=(auth,pre)),patch.object(e,"_short_url_snapshot",side_effect=(pre,post)),patch.object(e,"_q_before_deadline",side_effect=query):
   result=e.remediate_short_url_duplicates(object(),{"execution_authorization_sha256":"f"*64,"execution_authorization_signature_sha256":"e"*64,"attempt_marker_sha256":"4"*64,"legacy_repository_commit":"0"*40,"legacy_authorization_sha256":"d"*64,"legacy_authorization_signature_sha256":"c"*64,"legacy_capture_receipt_sha256":"b"*64,"legacy_restore_receipt_sha256":"a"*64,"legacy_inspection_receipt_sha256":"1"*64,"recovery_receipt_sha256":"2"*64},deadline=int(time.time())+60)
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
   with self.assertRaisesRegex(e.ClosureError,"capture drift"): e.remediate_short_url_duplicates(object(),{},deadline=int(time.time())+60)
  query.assert_not_called()
  victim="22222222-2222-2222-2222-222222222222"; descriptor={"source_id":victim}
  before={**base,"short_urls_row_count":1,"duplicate_group_count":1,"duplicate_victim_count":1,"victim_descriptor_count":1,"duplicate_victims_sha256":"d"*64,"victim_descriptors_sha256":"d"*64,"_rows":[{"id":victim}],"_victims":[descriptor]}
  auth={**before,"pre_short_urls_rowset_sha256":before["short_urls_rowset_sha256"],"legacy_vector":{key:before["short_urls_rowset_sha256"] if key=="pre_short_urls_rowset_sha256" else before[key] for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")}}
  with patch.object(e,"_short_url_binding",return_value=(auth,before)),patch.object(e,"_short_url_snapshot",return_value=before),patch.object(e,"_q_before_deadline",return_value=[]):
   with self.assertRaisesRegex(e.ClosureError,"returning mismatch"): e.remediate_short_url_duplicates(object(),{},deadline=int(time.time())+60)
 def test_managed_role_splices_are_ordered_literal_and_nonoverlapping(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  splices=e._splice_specs(root,manifest)
  self.assertEqual(tuple(item["version"] for item in splices),("20260713000450","20260713002000","20260713002400","20260801000300"))
  self.assertEqual(len(c.ROLE_SPLICES),8)
  self.assertEqual(tuple(record["label"] for record in c.ROLE_SPLICES),e._ROLE_SPLICE_LABELS)
  for item in splices:
   self.assertEqual(hashlib.sha256(item["raw"]).hexdigest(),item["group"]["source_sha256"])
   self.assertEqual(hashlib.sha256(item["transformed"]).hexdigest(),item["group"]["transformed_source_sha256"])
   previous=0
   for record in item["records"]:
    self.assertGreaterEqual(record["start"],previous)
    self.assertEqual(item["raw"][record["start"]:record["end"]],record["old"])
    previous=record["end"]
 def test_managed_role_automatic_membership_mutation_is_rejected(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  records=tuple(dict(record) for record in c.ROLE_SPLICES)
  records[0]["new"]=records[0]["new"].replace(b"'supabase_admin',true,false,false",b"'supabase_admin',false,false,false",1)
  with patch.object(e,"ROLE_SPLICES",records),self.assertRaisesRegex(e.ClosureError,"literal hash drift"):
   e._splice_specs(root,manifest)
 def test_managed_role_creation_accepts_only_exact_pg17_automatic_memberships(self):
  workflow=c._WORKFLOW_OWNER_SQL.decode("ascii")
  retention=c._RETENTION_ROLES_SQL.decode("ascii")
  self.assertIn("automatic workflow-owner membership drift",workflow)
  self.assertIn("('privacy_workflow_owner','postgres','supabase_admin',true,false,false)",workflow)
  self.assertIn("GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres",workflow)
  self.assertIn("GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner",workflow)
  self.assertNotIn("GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin",workflow)
  for role in ("privacy_retention_operator_approver","privacy_retention_legal_approver","privacy_retention_activation_operator"):
   self.assertNotIn(f"GRANT {role}",retention)
   self.assertIn(f"('{role}','postgres','supabase_admin',true,false,false)",retention)
  self.assertIn("automatic retention role membership drift",retention)
  schema=c._WORKFLOW_SCHEMA_SQL.decode("ascii")
  self.assertIn("to_regnamespace('privacy_retention') IS NULL",schema)
  self.assertIn("NOT IN ('postgres','supabase_admin')",schema)
  self.assertIn("ALTER SCHEMA privacy_retention OWNER TO privacy_workflow_owner",schema)
  epilogue=c.ROLE_PROTOCOL_EPILOGUE.decode("ascii")
  self.assertIn("ARRAY['search_path=\"\"']",epilogue)
  self.assertIn("538264bd59607f4b2dcd1c4f4600f63a7961f4d9c761c975319e3a7804b56399",epilogue)
  executor_source=Path(e.__file__).read_text(encoding="utf-8")
  self.assertIn("role_row.rolname AS role_name",executor_source)
  self.assertIn("member_row.rolname AS member_name",executor_source)
  self.assertIn("grantor_row.rolname AS grantor_name",executor_source)
  self.assertIn("pg_catalog.pg_get_userbyid(n.nspowner) AS namespace_owner",executor_source)
  self.assertIn("pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner",executor_source)
  self.assertIn("pg_catalog.pg_get_userbyid(p.proowner) AS function_owner",executor_source)
  self.assertIn("pn.nspname || '.' || p.proname",executor_source)
  self.assertIn("pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ', ', ',')",executor_source)
  self.assertIn("LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace",executor_source)
  self.assertIn("'search_path=\"\"'",executor_source)
 def test_full_precompute_matches_all_pinned_splice_vectors(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  plan,splices=e._precompute_execution_plan(root,manifest)
  self.assertEqual(len(plan),29)
  self.assertEqual(tuple((entry["version"],entry["group"]["original_vector_sha256"],entry["group"]["transformed_vector_sha256"]) for entry in splices),tuple((group["version"],group["original_vector_sha256"],group["transformed_vector_sha256"]) for group in c.ROLE_SPLICE_GROUPS))
  vectors={item.version:(e.digest(original),e.digest(transformed)) for item,original,transformed,_ in plan}
  self.assertEqual(tuple((group["version"],*vectors[group["version"]]) for group in c.ROLE_SPLICE_GROUPS),tuple((group["version"],group["original_vector_sha256"],group["transformed_vector_sha256"]) for group in c.ROLE_SPLICE_GROUPS))
 def test_terminal_spec_is_shared_by_freeze_controller_and_executor(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  _,head,source_root,freeze_spec=f._root_source()
  self.assertEqual(freeze_spec,c.terminal_spec(manifest))
  self.assertEqual(e._source_binding(root,manifest),(head,source_root,freeze_spec))
  args=SimpleNamespace(origin="https://abcdefghijklmnopqrst.supabase.co",freeze_id="freeze-0001")
  with patch.object(controller.freeze,"_root_source",return_value=(root,head,source_root,freeze_spec)):
   self.assertEqual(controller._execution_bindings(args,{"expires_at":0}, "f"*64,"a"*64)["terminal_spec"],freeze_spec)

 def test_plan_prevalidation_precedes_every_cursor_operation(self):
  class Cursor:
   def __init__(self): self.calls=[]
   def execute(self,*args): self.calls.append(args)
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  for invoke in (e.rehearse_cursor,e.apply_cursor):
   cursor=Cursor()
   with self.subTest(invoke=invoke.__name__),patch.object(e,"validate_controller_capability"),patch.object(e,"_precompute_execution_plan",side_effect=e.ClosureError("late malformed splice")),patch.object(e,"_execute_closure") as execute:
    with self.assertRaisesRegex(e.ClosureError,"late malformed splice"):
     invoke(cursor,{},root=root,manifest=manifest,freeze_id="f",relation_root="r",acl_root="a",deadline=int(time.time())+60,remediation={})
   self.assertEqual(cursor.calls,[])
   execute.assert_not_called()
 def test_admission_requires_each_exact_hosted_dimension(self):
  expected=(True,True,True,True,False,True,True,1,10,True,0,True)
  class Cursor:
   description=object()
   def __init__(self,row): self.row=row
   def execute(self,*args): pass
   def fetchall(self): return [self.row]
  for index in range(len(expected)):
   drifted=list(expected); drifted[index]=not drifted[index] if isinstance(drifted[index],bool) else drifted[index]+1
   with self.subTest(index=index),patch.object(e,"ledger",return_value=tuple((version,name,()) for version,name in c.BASELINE_PAIRS)):
    with self.assertRaisesRegex(e.ClosureError,"admission drift"):
     e._admission_assert(Cursor(tuple(drifted)))
 def test_epilogue_is_exact_symmetric_and_pinned(self):
  sql=c.ROLE_PROTOCOL_EPILOGUE.decode("ascii")
  self.assertEqual(sql.count("EXCEPT ALL"),4)
  self.assertNotIn("count(*)",sql)
  self.assertNotIn("pg_has_role",sql)
  self.assertNotIn("PERFORM privacy_retention.assert_g014_workflow_owner_contract()",sql)
  self.assertIn("pg_catalog.pg_proc",sql)
  self.assertIn("REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres RESTRICT",sql)
  self.assertEqual(hashlib.sha256(c.ROLE_PROTOCOL_EPILOGUE).hexdigest(),c.ROLE_PROTOCOL_EPILOGUE_SHA256)
  for altered in (
   c.ROLE_PROTOCOL_EPILOGUE.replace(b"false,true,true",b"true,true,true",1),
   c.ROLE_PROTOCOL_EPILOGUE.replace(b"privacy_workflow_owner','postgres','postgres",b"postgres','privacy_workflow_owner','postgres",1),
   c.ROLE_PROTOCOL_EPILOGUE.replace(b"privacy_workflow_owner','postgres','postgres',false,true,true),\n         ('privacy_workflow_owner",b"privacy_workflow_owner','postgres','supabase_admin',true,false,false),\n         ('privacy_workflow_owner",1),
  ):
   self.assertNotEqual(hashlib.sha256(altered).hexdigest(),c.ROLE_PROTOCOL_EPILOGUE_SHA256)
  with patch.object(e,"_source_bound_rpc_matrix",return_value=c.STATIC_RPC_MATRIX),patch.object(e,"_splice_specs",return_value=()),patch.object(e,"vectors",return_value=(("epilogue",),("epilogue",))),patch.object(e,"ROLE_PROTOCOL_EPILOGUE_VECTOR_SHA256","0"*64):
   with self.assertRaisesRegex(e.ClosureError,"vector drift"):
    e._precompute_execution_plan(Path("."),SimpleNamespace(migrations=()))

 def test_managed_role_and_g014_acl_assertions_reject_drift(self):
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=iter(rows)
   def execute(self,sql,params=()): pass
   def fetchall(self): return next(self.rows)
  role_rows=tuple((name,False,False,False,False,False,False,False) for name in sorted(c.MANAGED_ROLES))
  membership_rows=tuple(sorted(c.TERMINAL_MANAGED_ROWS))
  expected=(
   ("privacy_retention","privacy_workflow_owner","tzuyang_address_evidence_admin_approval_receipts","privacy_workflow_owner",True,True,"public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)","privacy_workflow_owner",True,'search_path=""'),
   ("privacy_retention","privacy_workflow_owner","tzuyang_address_evidence_admin_approval_receipts","privacy_workflow_owner",True,True,"privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()","privacy_workflow_owner",False,'search_path=""'))
  with self.assertRaisesRegex(e.ClosureError,"managed role flag contract drift"):
   e._managed_role_catalog_assert(Cursor((role_rows[:-1],membership_rows,expected)))
  with self.assertRaisesRegex(e.ClosureError,"managed role membership contract drift"):
   e._managed_role_catalog_assert(Cursor((role_rows,(),expected)))
  e._managed_role_catalog_assert(Cursor((role_rows,membership_rows,expected)))
  e._assert_memberships(Cursor((tuple(sorted(c.TRANSIENT_MANAGED_ROWS)),)),c.TRANSIENT_MANAGED_ROWS)
  for rows in (role_rows[:-1],role_rows+(("privacy_retention_extra",False,False,False,False,False,False,False),),role_rows[:-1]+(("privacy_retention_operator_approver",True,False,False,False,False,False,False),)):
   with self.subTest(role_rows=rows),self.assertRaisesRegex(e.ClosureError,"managed role flag contract drift"):
    e._assert_role_flags(Cursor((rows,)))
  for rows in (membership_rows[:-1],tuple(sorted(membership_rows+(("external_role","privacy_retention_operator_approver","postgres",False,True,True),))),membership_rows[:-1]+(("privacy_retention_operator_approver","postgres","supabase_admin",False,False,False),)):
   with self.subTest(membership_rows=rows),self.assertRaisesRegex(e.ClosureError,"managed role membership contract drift"):
    e._assert_memberships(Cursor((rows,)),c.TERMINAL_MANAGED_ROWS)
  for index,value in ((3,"postgres"),(4,False),(7,"postgres")):
   drifted=list(expected); row=list(drifted[0 if index in (3,4) else 1]); row[index]=value; drifted[0 if index in (3,4) else 1]=tuple(row)
   with self.subTest(g013_catalog=index),self.assertRaisesRegex(e.ClosureError,"managed ownership catalog contract drift"):
    e._managed_role_catalog_assert(Cursor((role_rows,membership_rows,tuple(drifted))))

 def test_g014_static_matrix_is_exact_and_fail_closed(self):
  self.assertEqual(len(c.STATIC_RPC_MATRIX),104)
  self.assertEqual(len({signature for signature,_ in c.STATIC_RPC_MATRIX}),97)
  self.assertEqual({role:sum(grantee==role for _,grantee in c.STATIC_RPC_MATRIX) for role in ("anon","authenticated","service_role")},{"anon":1,"authenticated":18,"service_role":85})
  self.assertEqual(c.STATIC_RPC_MATRIX_SHA256,"59b3d7d942241e70e24196251aef0dabfb999d986512a7d138e44cd2f57e490d")
  self.assertEqual(c.STATIC_RPC_MATRIX_SHA256,c.digest(c.STATIC_RPC_MATRIX))
  class Cursor:
   description=object()
   def __init__(self,rows): self.rows=iter(rows)
   def execute(self,sql,params=()): self.sql=sql
   def fetchall(self): return next(self.rows)
  clean=((),tuple(sorted(c.STATIC_RPC_MATRIX)),(),(),())
  e._g014_public_rpc_acl_assert(Cursor(clean))
  e._g014_public_rpc_acl_assert(Cursor(((),tuple(reversed(clean[1])),(),(),())))
  mutations=(
   ((('public.missing()',),),tuple(sorted(c.STATIC_RPC_MATRIX)),(),(),(),"missing source signature"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX))[:-1],(),(),(),"ACL contract drift"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX))+(("public.extra()","service_role"),),(),(),(),"ACL contract drift"),
   ((),(("public.wrong()","service_role"),),(),(),(),"ACL contract drift"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX))[:-1]+(tuple(sorted(c.STATIC_RPC_MATRIX))[0],),(),(),(),"ACL contract drift"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX)),(("public.any()",),),(),(),"PUBLIC ACL drift"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX)),(),(("public.unlisted()","anon"),),(),"unlisted API ACL drift"),
   ((),tuple(sorted(c.STATIC_RPC_MATRIX)),(),(),(("public.approve_submission_item(text)",),),"unexpected overload drift"),
  )
  for missing,actual,public_acl,unlisted,overloads,error in mutations:
   with self.subTest(error=error),self.assertRaisesRegex(e.ClosureError,error):
    e._g014_public_rpc_acl_assert(Cursor((missing,actual,public_acl,unlisted,overloads)))

 def test_g014_source_contract_is_pinned_in_terminal_spec_and_sql(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  spec=c.terminal_spec(manifest)
  self.assertEqual(c.G014_RPC_ALLOWLIST_VERSION,"20260801000300")
  self.assertEqual(len(c.G014_RPC_ALLOWLIST_FRAGMENTS),9)
  self.assertEqual(len(c.STATIC_RPC_MATRIX),104)
  self.assertEqual(len({signature for signature,_ in c.STATIC_RPC_MATRIX}),97)
  self.assertEqual(tuple(sum(grantee==role for _,grantee in c.STATIC_RPC_MATRIX) for role in ("anon","authenticated","service_role")),(1,18,85))
  self.assertNotIn(("public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)","service_role"),c.STATIC_RPC_MATRIX)
  self.assertIn(("public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)","service_role"),c.STATIC_RPC_MATRIX)
  self.assertNotEqual(spec,c.digest({"manifest":c.MANIFEST_SHA256}))
  with patch.object(c,"STATIC_RPC_MATRIX_SHA256","0"*64):
   self.assertNotEqual(spec,c.terminal_spec(manifest))
  with patch.object(c,"G014_RPC_ALLOWLIST_FRAGMENTS",()):
   self.assertNotEqual(spec,c.terminal_spec(manifest))
  sql=Path(__file__).with_name("g037_hosted_terminal_readback.sql").read_text(encoding="utf-8")
  for token in ("02000","02400","20260801000300",c.STATIC_RPC_MATRIX_SHA256,"EXCEPT ALL","to_regprocedure","no_unlisted_public_api_execute","no_unexpected_allowlisted_name_overloads"):
   self.assertIn(token,sql)
  self.assertEqual(tuple(sorted(self._terminal_rpc_matrix(sql))),tuple(sorted(c.STATIC_RPC_MATRIX)))
  first="    ('public.approve_submission_item(uuid,uuid,jsonb)', 'authenticated'::name),"
  extra="    ('public.extra()', 'service_role'::name),"
  reordered=sql.replace(first,"__FIRST__",1).replace("    ('public.approve_submission_item(uuid,uuid,jsonb)', 'service_role'::name),",first,1).replace("__FIRST__","    ('public.approve_submission_item(uuid,uuid,jsonb)', 'service_role'::name),",1)
  for mutated in (sql.replace(first,"",1),sql.replace(first,first+"\n"+extra,1),reordered):
   self.assertNotEqual(self._terminal_rpc_matrix(mutated),c.STATIC_RPC_MATRIX)

 def _terminal_rpc_matrix(self, sql):
  match=re.search(r"WITH expected_rpc\(source_signature,grantee\) AS \(\s*VALUES\s*(.*?)\n\), resolved_rpc",sql,re.S)
  self.assertIsNotNone(match)
  rows=re.findall(r"^\s*\('([^']+)', '(anon|authenticated|service_role)'::name\)(?:,)?$",match.group(1),re.M)
  self.assertEqual(len(rows),len(re.findall(r"^\s*\(",match.group(1),re.M)))
  return tuple(rows)

 def test_source_bound_rpc_matrix_rejects_source_and_constant_drift(self):
  root=Path(__file__).parents[3]; manifest=c.load_manifest(root)
  self.assertEqual(e._source_bound_rpc_matrix(root,manifest),c.STATIC_RPC_MATRIX)
  for version,_,start,end,fragment_sha256 in c.G014_RPC_ALLOWLIST_FRAGMENTS:
   item=next(item for item in manifest.migrations if item.version==version)
   source=(root/item.path).read_bytes()
   self.assertEqual(hashlib.sha256(source[start:end]).hexdigest(),fragment_sha256)
  with patch.object(e,"G014_RPC_ALLOWLIST_FRAGMENTS",()):
   with self.assertRaisesRegex(e.ClosureError,"binding drift"): e._source_bound_rpc_matrix(root,manifest)
  with patch.object(e,"STATIC_RPC_MATRIX",c.STATIC_RPC_MATRIX[:-1]):
   with self.assertRaisesRegex(e.ClosureError,"composition drift"): e._source_bound_rpc_matrix(root,manifest)
  with patch.object(e,"STATIC_RPC_MATRIX_SHA256","0"*64):
   with self.assertRaisesRegex(e.ClosureError,"digest drift"): e._source_bound_rpc_matrix(root,manifest)

 def test_unpinned_managed_role_membership_grammar_rejects_only_membership_statements(self):
  for statement in (
   "GRANT privacy_workflow_owner TO postgres",
   "REVOKE privacy_workflow_owner FROM postgres",
   "GRANT ROLE privacy_retention_operator_approver TO postgres",
   "REVOKE ROLE privacy_retention_legal_approver FROM postgres",
   "GRANT ordinary_role, \"privacy_retention_activation_operator\" TO postgres, ordinary_member GRANTED BY postgres",
   "REVOKE ADMIN OPTION FOR ordinary_role, privacy_retention_operator_approver FROM postgres CASCADE",
   "REVOKE INHERIT OPTION FOR ordinary_role FROM \"privacy_retention_legal_approver\" RESTRICT",
   "REVOKE SET OPTION FOR ordinary_role FROM privacy_workflow_owner",
   'GRANT "on" TO privacy_workflow_owner',
   'REVOKE privacy_workflow_owner FROM "granted"',
   'GRANT privacy_workflow_owner TO "cascade"',
   'REVOKE privacy_workflow_owner FROM "restrict"',
   r'''GRANT ordinary_role TO U&"ordinary\005fmember" UESCAPE '\' GRANTED BY privacy_workflow_owner''',
   r'''REVOKE ordinary_role FROM U&"ordinary\005fmember" UESCAPE '\' GRANTED BY privacy_workflow_owner''',
   r'''GRANT U&"ordinary\005frole" UESCAPE '\' TO ordinary_member GRANTED BY privacy_workflow_owner''',
   r'''GRANT SELECT ON U&"ordinary\005fobject" UESCAPE '\' TO authenticated''',
   "-- bare CR comment\rGRANT privacy_workflow_owner TO postgres",
   "-- CRLF comment\r\nREVOKE privacy_workflow_owner FROM postgres",
  ):
   self.assertTrue(e._is_unpinned_managed_role_membership(statement))
  for statement in (
   "GRANT SELECT ON public.privacy_workflow_owner TO authenticated",
   "REVOKE EXECUTE ON FUNCTION public.privacy_workflow_owner() FROM authenticated",
   "GRANT USAGE ON SCHEMA privacy_retention TO \"privacy_workflow_owner\"",
   "REVOKE SELECT ON TABLE public.privacy_retention_operator_approver FROM authenticated",
   "GRANT SELECT ON public.privacy_workflow_owner_archive TO authenticated",
   "REVOKE EXECUTE ON FUNCTION public.privacy_workflow_owner_archive() FROM authenticated",
   "GRANT ordinary_role TO ordinary_member GRANTED BY privacy_workflow_owner",
   'GRANT SELECT ON "on" TO privacy_workflow_owner',
  ):
   self.assertFalse(e._is_unpinned_managed_role_membership(statement))

 def test_unpinned_managed_role_ddl_does_not_confuse_role_columns(self):
  for statement in (
   "CREATE ROLE privacy_workflow_owner",
   "ALTER ROLE privacy_retention_operator_approver NOLOGIN",
   "SET ROLE privacy_retention_activation_operator",
   "DROP ROLE privacy_retention_legal_approver",
   "ALTER USER privacy_retention_activation_operator NOLOGIN",
   "SET LOCAL ROLE privacy_workflow_owner",
   "SET SESSION ROLE privacy_workflow_owner",
   "CREATE USER ordinary_user",
   "DROP USER IF EXISTS ordinary_user",
   "DROP ROLE IF EXISTS ordinary_role",
   "CREATE GROUP ordinary_group",
   "ALTER GROUP ordinary_group ADD USER ordinary_user",
   "ALTER GROUP ordinary_group DROP USER ordinary_user",
   "DROP GROUP IF EXISTS ordinary_group",
   "ALTER /* nested /* comment */ comment */ GROUP \"privacy_workflow_owner\" ADD /* gap */ USER ordinary_user",
   "ALTER GROUP /* gap */ privacy_retention_operator_approver DROP USER ordinary_user",
   "DROP /* gap */ USER \"privacy_retention_legal_approver\"",
   "ALTER GROUP ordinary_group ADD USER privacy_retention_activation_operator",
   'CREATE USER U&"privacy\\005fworkflow\\005fowner"',
   'ALTER ROLE U&"privacy\\005fworkflow\\005fowner" NOLOGIN',
   "-- bare CR comment\rALTER GROUP privacy_workflow_owner ADD USER ordinary_user",
   "-- CRLF comment\r\nALTER GROUP privacy_workflow_owner DROP USER ordinary_user",
   "-- bare CR comment\rDROP USER privacy_retention_legal_approver",
  ):
   self.assertTrue(e._is_unpinned_managed_role_ddl(statement))
  for statement in (
   "GRANT ordinary_role TO ordinary_member",
   "REVOKE ordinary_role FROM ordinary_member",
   "GRANT ROLE ordinary_role TO ordinary_member",
  ):
   self.assertTrue(e._is_unpinned_managed_role_membership(statement))
  for statement in (
   "UPDATE public.profiles SET role = EXCLUDED.role",
   "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'user'",
   "SET search_path = public",
  ):
   self.assertFalse(e._is_unpinned_managed_role_ddl(statement))

 def test_epilogue_uses_extension_qualified_digest_for_prepare_contract(self):
  sql=c.ROLE_PROTOCOL_EPILOGUE.decode("ascii")
  self.assertIn("extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256')",sql)
  self.assertNotIn("extensions.digest(p.prosrc,'sha256')",sql)
  self.assertEqual(hashlib.sha256(c.ROLE_PROTOCOL_EPILOGUE).hexdigest(),c.ROLE_PROTOCOL_EPILOGUE_SHA256)

if __name__=="__main__": unittest.main()
