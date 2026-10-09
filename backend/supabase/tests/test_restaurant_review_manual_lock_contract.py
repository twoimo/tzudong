"""Exact applied preimage and fixed private-lock forward contract; no DB access."""
import hashlib
import re
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'
FORWARD = MIGRATIONS / '20261009022915_restaurant_review_manual_preview_eligibility.sql'


class ManualLockContract(unittest.TestCase):
    def test_applied_body_replacement_preserves_every_other_byte(self):
        applied = (MIGRATIONS / '20261003171449_restaurant_review_manual_guards.sql').read_text()
        original = re.search(r'CREATE FUNCTION public\.restaurant_review_automation_manual\(.*? AS \$\$(.*?)\$\$;', applied, re.S).group(1)
        forward = FORWARD.read_text().split('DO $manual_fixed_lock$')[1]
        old_sha, new_sha = re.search(r"old_sha constant text:='([a-f0-9]{64})'; new_sha constant text:='([a-f0-9]{64})'", forward).groups()
        anchor = re.search(r'\$lock_anchor\$(.*?)\$lock_anchor\$', forward, re.S).group(1)
        replacement = re.search(r"replacement constant text:='([^']+)'", forward).group(1)
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(), old_sha)
        self.assertEqual(original.count(anchor), 1)
        rewritten = original.replace(anchor, replacement)
        self.assertEqual(hashlib.sha256(rewritten.encode()).hexdigest(), new_sha)
        self.assertEqual(rewritten.replace(replacement, anchor), original)

    def test_helper_can_only_lock_the_fixed_revision_singleton(self):
        forward = FORWARD.read_text()
        expected = re.search(r'\$expected_body\$(.*?)\$expected_body\$', forward, re.S).group(1)
        actual = re.search(r'CREATE FUNCTION pipeline_control\.lock_restaurant_review_catalog_revision\(\) RETURNS void.*? AS \$body\$(.*?)\$body\$', forward, re.S).group(1)
        self.assertEqual(actual, expected)
        self.assertEqual(actual.count('FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE'), 1)
        self.assertNotRegex(actual, r'\b(?:EXECUTE|INSERT|UPDATE\s+pipeline_control|DELETE|GRANT|ALTER|SET\s+ROLE)\b')
        self.assertIn("IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'", actual)
        self.assertIn("proconfig=ARRAY['search_path=\"\"','lock_timeout=2s']", forward)
        self.assertIn("proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']", forward)
        self.assertNotRegex(forward, r'GRANT\s+(?:UPDATE|ALL|SELECT|INSERT|DELETE|USAGE)\b')
        self.assertNotIn('assert_g014_', forward)


if __name__ == '__main__':
    unittest.main()
