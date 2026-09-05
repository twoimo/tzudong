"""Offline contract tests; no DB, transport, credentials or real preview fixtures."""
import copy
import json
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import advisor_successor_plan as a


def fixture_snapshot():
    rows=[{'version':str(20260101000000+i),'name':f'fixture_{i}', 'statement_count':0,
           'statements_pg_json_sha256':'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'} for i in range(49)]
    rows.append(dict(rows[0],version='20260804000500',name='fixture_terminal'))
    s={k:'a'*64 for k in a.SNAP_KEYS}
    s.update(ledger=rows,database='postgres',server_major=17,executor_ok=True,vector_schema='public',
             function_count=26,function_configs_ok=True,function_paths_fixed=0,constraint_count=4,
             constraint_name_count=4,constraints_valid=0,manifest_target_count=4,trigger_ok=True,touch_ok=True,touch_structure_ok=True,touch_body_admissible=True,
             touch_body_sha256=a.sha(a.TOUCH_BODY.encode()))
    return s

class SourceTests(unittest.TestCase):
    def test_source_parser_and_vector_are_exact(self):
        self.assertEqual(len(a.vectors()),17)
        self.assertEqual(len(a.SOURCE.read_bytes()),14235)
        self.assertEqual(a.sha(a.SOURCE.read_bytes()),a.SOURCE_SHA)

    def test_empty_historical_vectors_are_preserved_and_drift_is_denied(self):
        s=fixture_snapshot()
        evidence={'schema':'hosted-current50-ledger-metadata-v1','projectId':a.PROJECT,'ledger':s['ledger']}
        self.assertEqual(a.preview(evidence,s)['snapshot']['ledger'],s['ledger'])
        s=copy.deepcopy(s); s['ledger'][0]['statements_pg_json_sha256']='b'*64
        with self.assertRaises(a.Denied): a.preview(evidence,s)
        for bad in (s['ledger'][:-1],s['ledger']+s['ledger'][:1],list(reversed(s['ledger']))):
            with self.assertRaises(a.Denied): a.validate_ledger(bad)

    def test_fixed_target_rehearsal_and_mode_guards(self):
        s=fixture_snapshot()
        v=a.preview({'schema':'hosted-current50-ledger-metadata-v1','projectId':a.PROJECT,'ledger':s['ledger']},s)
        with self.assertRaises(a.Denied): a.plan(v,'apply')
        with self.assertRaises(a.Denied): a.plan(v,'repair')
        for key,val in [('projectId','other'),('source_sha256','b'*64)]:
            bad=dict(v);bad[key]=val
            with self.assertRaises(a.Denied): a.plan(bad,'rehearse')
        sql=a.plan(v,'rehearse')
        self.assertIn("ERRCODE='P5101'",sql)
        self.assertIn('LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE',sql)
        self.assertNotIn('ON CONFLICT',sql)
        for statement in a.vectors(): self.assertIn('EXECUTE '+a.literal(statement)+';',sql)

    def test_apply_embeds_real_rollback_before_final_mutation(self):
        s=fixture_snapshot()
        v=a.preview({'schema':'hosted-current50-ledger-metadata-v1','projectId':a.PROJECT,'ledger':s['ledger']},s)
        # A deterministic file can be synthesized. It is not execution proof.
        receipt={'schema':a.SCHEMA,'projectId':a.PROJECT,'preview_sha256':a.sha(a.canonical(v).encode()),
                 'source_sha256':a.SOURCE_SHA,'vector_sha256':a.VECTOR_SHA,'status':'rehearsed-rolled-back'}
        sql=a.plan(v,'apply',receipt)
        self.assertLess(sql.index("MESSAGE='advisor_rehearsal_rollback'"),sql.index("IF 'apply'='apply' THEN"))
        self.assertLess(sql.index("RAISE EXCEPTION 'advisor_rollback_denied'"),sql.index("IF 'apply'='apply' THEN"))
        old=dict(v,schema='advisor-current-state-successor-v2')
        with self.assertRaises(a.Denied): a.plan(old,'apply',receipt)

    def test_reviewed_touch_body_only_and_v1_cannot_be_reused(self):
        s=fixture_snapshot()
        s.update(touch_ok=False,touch_body_sha256=a.OBSERVED_TOUCH_BODY_SHA)
        a.validate_snapshot(s)
        for key,val in [('touch_body_sha256','b'*64),('touch_structure_ok',False),
                        ('touch_body_admissible',False),('touch_ok',True)]:
            changed=dict(s);changed[key]=val
            with self.assertRaises(a.Denied): a.validate_snapshot(changed)
        evidence={'schema':'hosted-current50-ledger-metadata-v1','projectId':a.PROJECT,'ledger':s['ledger']}
        v=a.preview(evidence,s)
        v['schema']='advisor-current-state-successor-v1'
        with self.assertRaises(a.Denied): a.plan(v,'rehearse')
        self.assertEqual(a.sha(a.OBSERVED_TOUCH_NORMALIZED.encode()),a.OBSERVED_TOUCH_NORMALIZED_SHA)
        self.assertIn('to_jsonb(f)-ARRAY[\'proconfig\',\'prosrc\',\'signature\']',a.snapshot_sql())
        self.assertIn("ELSE to_jsonb(f)-ARRAY['proconfig','signature']",a.snapshot_sql())

    def test_reject_duplicate_json_and_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'duplicate.json';p.write_text('{"a":1,"a":2}')
            with self.assertRaises(a.Denied): a.load(p)
            p.write_text('{}')
            with self.assertRaises(a.Denied): a.load(p,'0'*64)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(a.main(['snapshot','--project-ref',a.PROJECT,'--output',str(p)]),2)
            self.assertEqual(p.read_text(),'{}')

if __name__=='__main__': unittest.main()
