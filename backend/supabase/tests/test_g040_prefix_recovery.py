"""Offline contract tests; intentionally no database connection."""
from __future__ import annotations
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g040_prefix_recovery as g
H="a"*64
FINAL="b"*40
ROOT="c"*64
class Cursor:
 def __init__(self,*rows): self.rows=list(rows); self.sql=[]
 def execute(self,sql): self.sql.append(sql)
 def fetchone(self): return self.rows.pop(0)
def receipt(**x):
 r={"schema":g.RECEIPT_SCHEMA,"base_commit":g.SOURCE_COMMIT,"final_commit":FINAL,"runtime_source_root":ROOT,"manifest_sha256":g.MANIFEST_SHA256,"migration_source_sha256":g.MIGRATION_SOURCE_SHA256,"pg_identity":g.PG_IDENTITY,"probe_text_sha256":g.PROBE_TEXT_SHA256,"absent_catalog_sha256":H,"full_catalog_sha256":H,"full_data_sha256":H,"ledger_prefix_sha256":H,"target_fingerprint":"opaque","observation_nonce":"n"*16,"signature":{}}
 r.update(x); return r
def verify(b,s): return s=={} and b==g.canonical_bytes({k:v for k,v in receipt().items() if k!="signature"})
def catalog(**x):
 r={"ledger_count":28,"v00400_count":0,"ledger_prefix_shape_ok":True,"ledger_sha256":H,"schema_exists":False,"expected_table_count":0,"schema_table_count":0,"schema_index_count":0,"column_count":0,"schema_other_relation_count":0,"touched_function_count":1,"schema_trigger_count":0,"rls_table_count":0,"policy_count":0,"acl_contract_ok":True,"exact_pg":True,"server_version_num":170006,"catalog_sha256":H};r.update(x);return r
def data(**x):
 r={"classes_count":10,"exact_seed_count":10,"seed_rows_exact":True,"class_source_count":0,"legal_hold_count":0,"work_item_count":0,"retained_record_count":0,"run_count":0,"run_item_count":0,"runtime_tables_empty":True,"seed_projection_sha256":H,"data_shape_sha256":H};r.update(x);return r
def call(cur,r=None): return g.classify_locked_cursor(cur,r or receipt(),verify,observation_nonce="n"*16,target_fingerprint="opaque",final_commit=FINAL,runtime_source_root=ROOT,consume_nonce=lambda _:True)
class Tests(unittest.TestCase):
 def test_unapplied_locked_sql_only(self):
  c=Cursor({"transaction_read_only":"on"},catalog());self.assertEqual(call(c).status,"UNAPPLIED")
  self.assertEqual([q.lstrip().split(None,1)[0].upper() for q in c.sql],["SELECT","WITH"])
 def test_full_and_each_count_denial(self):
  full=catalog(schema_exists=True,expected_table_count=7,schema_table_count=7,schema_index_count=14,column_count=78,touched_function_count=14,schema_trigger_count=7,rls_table_count=7)
  self.assertEqual(call(Cursor({"transaction_read_only":"on"},full,data())).status,"FULL_ESCAPED")
  for k in ("ledger_count","v00400_count","expected_table_count","schema_table_count","schema_index_count","column_count","touched_function_count","schema_trigger_count","rls_table_count","policy_count","server_version_num"):
   bad=full if k!="ledger_count" else catalog(); bad=dict(bad);bad[k]=bad[k]+1
   with self.subTest(k=k):
    with self.assertRaises(g.Denial): call(Cursor({"transaction_read_only":"on"},bad))
  for k in ("acl_contract_ok","exact_pg"):
   bad=dict(full);bad[k]=False
   with self.subTest(k=k):
    with self.assertRaises(g.Denial): call(Cursor({"transaction_read_only":"on"},bad))
 def test_receipt_loader_bindings_and_sanitization(self):
  with self.assertRaises(g.Denial): g.load_receipt(b'{"a":1,"a":2}')
  for k,v in (("base_commit","0"*40),("final_commit",H),("runtime_source_root",H),("pg_identity","bad"),("probe_text_sha256",H),("target_fingerprint","other"),("observation_nonce","short")):
   with self.subTest(k=k):
    with self.assertRaises(g.Denial): call(Cursor(),receipt(**{k:v}))
  with self.assertRaises(g.Denial) as e: call(Cursor(),receipt(),)
  # empty cursor proves read-only transaction state is required before catalog SQL.
  self.assertEqual(e.exception.code,"probe_error")
 def test_stale_and_provider_exception(self):
  with self.assertRaises(g.Denial) as e:g.classify_locked_cursor(Cursor(),receipt(),lambda *_:(_ for _ in ()).throw(RuntimeError("secret")),observation_nonce="n"*16,target_fingerprint="opaque",final_commit=FINAL,runtime_source_root=ROOT,consume_nonce=lambda _:True)
  self.assertIsNone(e.exception.__cause__)
  with self.assertRaises(g.Denial):g.classify_locked_cursor(Cursor(),receipt(),verify,observation_nonce="n"*16,target_fingerprint="opaque",final_commit=FINAL,runtime_source_root=ROOT,consume_nonce=lambda _:False)
 def test_diagnostic_setup_sequence(self):
  c=Cursor();g.begin_read_only_snapshot(c);self.assertIn("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",c.sql)
  self.assertIn("extensions.digest",g.CATALOG_PROBE);self.assertIn("extensions.digest",g.DATA_PROBE)
  self.assertNotIn("sha256(",g.CATALOG_PROBE);self.assertNotIn("sha256(",g.DATA_PROBE)
if __name__=="__main__":unittest.main()
