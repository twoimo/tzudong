from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'backend/supabase/migrations/20261113090000_storyboard_openai_execution.sql'

class StoryboardOpenAIMigrationContract(unittest.TestCase):
    def test_additive_policy_preserves_old_migrations_and_allows_only_exact_pairs(self):
        sql = MIGRATION.read_text()
        self.assertIn("'openai-api' AND request#>>'{providers,text,model}' = 'gpt-5.6-luna'", sql)
        self.assertIn("'openai-api' AND request#>>'{providers,image,model}' = 'gpt-image-2.6-flare'", sql)
        self.assertIn("model->>'owned_by' = 'openai-api'", sql)
        self.assertIn('BEGIN;', sql); self.assertTrue(sql.rstrip().endswith('COMMIT;'))
        for old in ('20261003000812_storyboard_gemini_only.sql', '20261013093518_storyboard_gemini_execution_v1.sql'):
            self.assertTrue((ROOT / 'backend/supabase/migrations' / old).exists())

    def test_null_and_missing_provider_fields_fail_closed(self):
        sql = MIGRATION.read_text()
        self.assertIn("(request#>>'{providers,externalAI}' = 'true') IS TRUE", sql)
        self.assertGreaterEqual(sql.count('IS NOT TRUE'), 4)
        self.assertIn("p.request#>>'{providers,text,id}' IS DISTINCT FROM 'gemini-api' AND p.request#>>'{providers,text,id}' IS DISTINCT FROM 'openai-api'", sql)
        self.assertIn("p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'response'", sql)
        self.assertIn("p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'installed-catalog-and-request'", sql)
        self.assertIn("p_payload#>>'{provenance,responseModel}' IS NOT NULL", sql)

    def test_sql_worker_paths_keep_provider_identity_and_server_owned_model_admission(self):
        sql = MIGRATION.read_text()
        self.assertIn("p.request#>>'{providers,text,id}' = 'openai-api'", sql)
        self.assertIn("p.request#>>'{providers,image,id}' = 'openai-api'", sql)
        self.assertIn("p_payload#>>'{provenance,providerId}' IS DISTINCT FROM p.request#>>ARRAY", sql)
        self.assertIn('public.storyboard_production_model_available(w.models', sql)
        self.assertIn("'installed-catalog-and-request'", sql)
        self.assertIn('STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT', sql)

if __name__ == '__main__':
    unittest.main()
