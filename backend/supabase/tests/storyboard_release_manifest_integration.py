#!/usr/bin/env python3
"""Rehearse admitted storyboard transactions in the owned networkless PG17 fixture."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("storyboard_fixture", Path(__file__).with_name("storyboard_openai_execution_integration.py"))
_fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixture)


class StoryboardReleaseManifestIntegration(unittest.TestCase):
    def test_atomic_prior_terminal_rollback_and_both_ledger_entries(self):
        script = """
import fs from 'node:fs';
import {validateReleaseMigrationManifest,readOriginalStatementVector} from './apps/web/scripts/apply-supabase-migration.mjs';
import {migrationEnvelope,atomicMigrationSql} from './apps/web/scripts/supabase-migration-transaction.mjs';
const entries=validateReleaseMigrationManifest(JSON.parse(fs.readFileSync('.github/storyboard-migration-release-manifest.v1.json')));
const result={};
for(const entry of entries){
 const bytes=fs.readFileSync(entry.path);
 const plan=migrationEnvelope(bytes,entry,readOriginalStatementVector(entry,bytes));
 result[entry.id]={entry,sql:atomicMigrationSql(plan,entry)};
 if(entry.id==='storyboard_gemini_execution_v1'){
  for(const field of ['expectedPriorState','terminalReadback']){
   const bad=structuredClone(entry);bad[field].expected.activeJobs=1;
   result[field]=atomicMigrationSql(plan,bad);
  }
 }
}
console.log(JSON.stringify(result));
"""
        compiled = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT,
                                  capture_output=True, text=True, check=True, timeout=30)
        plans = json.loads(compiled.stdout)
        gemini = plans["storyboard_gemini_execution_v1"]
        openai = plans["storyboard_openai_execution"]
        C = _fixture.StoryboardOpenAISql
        original = C.sql.__func__
        source = (ROOT / gemini["entry"]["path"]).read_text()
        query = gemini["entry"]["expectedPriorState"]["query"]
        observed = []

        def intercept(cls, sql, role=None):
            if sql != source:
                return original(cls, sql, role)
            original(cls, "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);")
            self.assertEqual(json.loads(original(cls, query)), gemini["entry"]["expectedPriorState"]["expected"])
            for field, code in [("expectedPriorState", "MIGRATION_PRIOR_STATE_MISMATCH"),
                                ("terminalReadback", "MIGRATION_TERMINAL_READBACK_FAILED")]:
                with self.assertRaisesRegex(RuntimeError, code):
                    original(cls, "BEGIN;\n" + plans[field] + "\nCOMMIT;")
                self.assertEqual(original(cls, "SELECT count(*) FROM supabase_migrations.schema_migrations;"), "0")
                self.assertEqual(json.loads(original(cls, query)), gemini["entry"]["expectedPriorState"]["expected"])
                observed.append(code)
            result = original(cls, "BEGIN;\n" + gemini["sql"] + "\nCOMMIT;")
            self.assertEqual(json.loads(original(cls, query)), gemini["entry"]["terminalReadback"]["expected"])
            return result

        C.sql = classmethod(intercept)
        try:
            C.setUpClass()
            self.assertEqual(C.sql("SELECT count(*) FROM supabase_migrations.schema_migrations;"), "1")
            C.sql("BEGIN;\n" + openai["sql"] + "\nCOMMIT;")
            self.assertEqual(json.loads(C.sql(openai["entry"]["terminalReadback"]["query"])), openai["entry"]["terminalReadback"]["expected"])
            self.assertEqual(C.sql("SELECT string_agg(version,',' ORDER BY version) FROM supabase_migrations.schema_migrations;"), "20261013093518,20261113090000")
            self.assertEqual(len(observed), 2)
        finally:
            C.sql = classmethod(original)
            C.doClassCleanups()


if __name__ == "__main__":
    unittest.main()
