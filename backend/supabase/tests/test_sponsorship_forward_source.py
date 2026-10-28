"""Offline mutation-boundary checks; real SQL assertions are parent-owned PG15 work."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
M = ROOT / 'backend/supabase/migrations'
FORWARD = M / '20261028195647_sponsorship_base_metadata_manual_confirmation.sql'


class SponsorshipForwardSourceTests(unittest.TestCase):
    def test_manual_assertion_if_reaches_all_comparisons_before_top_level_then(self):
        # PL/pgSQL reads an IF expression up to the first THEN outside parentheses.
        # This is a lexical boundary check, not a substitute for parent PG15 execution.
        sql = (ROOT / 'backend/supabase/tests/sponsorship_contract_assertions.sql').read_text()
        start = sql.index('IF after_row IS DISTINCT FROM first_result') + len('IF')
        body = sql[start:]

        def condition(text):
            depth = 0
            tokens = re.finditer(r"--[^\n]*|'(?:''|[^'])*'|[A-Za-z_][A-Za-z_0-9]*|[()]", text)
            for token in tokens:
                value = token.group()
                if value.startswith(("'", '--')):
                    continue
                if value == '(':
                    depth += 1
                elif value == ')':
                    depth -= 1
                    self.assertGreaterEqual(depth, 0)
                elif value.upper() == 'THEN' and depth == 0:
                    return text[:token.start()]
            self.fail('missing top-level IF THEN')

        complete = condition(body)
        self.assertIn("'{youtube_meta,ads_info,sponsor_analysis}'", complete)
        self.assertIn("'source_sha256',NULL)", complete)
        # The exact v454 syntax must fail this boundary check: CASE's THEN was read early.
        broken = body.replace('IS DISTINCT FROM (CASE', 'IS DISTINCT FROM CASE', 1).replace(
            "'null'::jsonb END)", "'null'::jsonb END", 1)
        truncated = condition(broken)
        self.assertNotIn("'{youtube_meta,ads_info,sponsor_analysis}'", truncated)
        self.assertTrue(truncated.rstrip().endswith("CASE WHEN decision='detected'"))

    def test_forward_file_preserves_transaction_and_private_mutation_boundary(self):
        sql = FORWARD.read_text()
        self.assertNotRegex(sql, r'(?im)^\s*(?:BEGIN\s*;|COMMIT\b|ROLLBACK\b)|\bCONCURRENTLY\b')
        self.assertNotRegex(sql, r'(?i)\b(?:GRANT|REVOKE|ALTER|DROP)\b')
        self.assertNotRegex(sql, r'(?i)\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.')
        self.assertEqual(re.findall(r'CREATE OR REPLACE FUNCTION ([^(]+)', sql), [
            'pipeline_control.admin_eval_valid_meta', 'pipeline_control.admin_record_compose'])
        self.assertEqual(re.findall(r'INSERT INTO ([\w.]+)', sql), ['pipeline_control.admin_evaluation_read_index'])
        self.assertIn('LOCK TABLE public.restaurants IN SHARE MODE;', sql)
        self.assertIn('WHERE saved.descriptor IS DISTINCT FROM EXCLUDED.descriptor', sql)

    def test_all_preexisting_compose_guards_and_field_handling_are_retained(self):
        original = re.search(r'CREATE FUNCTION pipeline_control.admin_record_compose\(.*?\nEND \$\$;',
                             (M / '20261004190259_admin_record_guarded_actions.sql').read_text(), re.S).group()
        current = re.search(r'CREATE OR REPLACE FUNCTION pipeline_control.admin_record_compose\(.*?\nEND \$\$;',
                            FORWARD.read_text(), re.S).group()
        current = re.sub(r'  -- An explicit manual decision.*?(?=  meta:=CASE)', '', current, flags=re.S)
        current = re.sub(r"  IF incoming_meta \? 'sponsorship_confirmation' THEN.*?  END IF;\n(?=  IF incoming_meta \? 'is_ads' OR)", '', current, flags=re.S)
        current = current.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 1)
        current = current.replace("'what_ads','sponsorship_confirmation']", "'what_ads']")
        self.assertEqual(current, original)

    def test_manual_compose_is_deterministic_and_does_not_take_client_provenance(self):
        sql = FORWARD.read_text().split('-- Serialize against restaurant writers')[0]
        self.assertNotRegex(sql, r'(?i)\b(?:now|clock_timestamp|random|gen_random_uuid|set_config)\s*\(')
        allowed = re.search(r"meta_key<>ALL\(ARRAY\[(.*?)\]\)", sql).group(1)
        self.assertIn("'sponsorship_confirmation'", allowed)
        for name in ['sponsor_analysis', 'actor', 'source', 'source_sha256', 'version', 'retained_previous']:
            self.assertNotIn("'" + name + "'", allowed)
        # This addition must never mutate or replace the guarded action/custody implementation.
        self.assertNotIn('CREATE OR REPLACE FUNCTION public.admin_record_action', sql)


if __name__ == '__main__':
    unittest.main()
