from pathlib import Path
import os
import subprocess
import unittest


ROOT = Path(__file__).parents[3]
GENERATOR = ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"


class G014CatalogBaselineGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = GENERATOR.read_text(encoding="utf8")

    def test_g016_catalog_assertion_replay_is_transactional_and_self_reverting(self):
        self.assertIn("g016_apply_catalog_assertion_membership_window()", self.source)
        self.assertIn('"BEGIN;\\n"', self.source)
        self.assertIn('"GRANT privacy_workflow_owner TO postgres;\\n"', self.source)
        self.assertIn("REVOKE privacy_workflow_owner FROM postgres;", self.source)
        self.assertIn("CREATE OR REPLACE FUNCTION pg_temp.g016_catalog_assertion_bridge()", self.source)
        self.assertIn("SECURITY DEFINER", self.source)
        self.assertIn("SELECT pg_temp.g016_catalog_assertion_bridge();", self.source)
        self.assertIn('+"\\nCOMMIT;\\n"', self.source.replace(" ", ""))

    def test_g016_catalog_assertion_uses_only_the_scoped_replay_wrapper(self):
        case = self.source.split(
            "20260801000300_g016_onboarding_allowlist_freshness.sql)", 1
        )[1].split(";;", 1)[0]
        self.assertIn("g016_apply_catalog_assertion_membership_window", case)
        self.assertIn("g016-catalog-assertion-membership-window", case)
        self.assertNotIn('psql -X', case.split("transformed_migration=", 1)[0])

    def test_image_inspection_uses_existing_cli_capability_without_relaxing_platform(self):
        snippet = self.source.split('# IMAGE_INSPECT_COMPAT_BEGIN', 1)[1].split('# IMAGE_INSPECT_COMPAT_END', 1)[0]
        stub = r'''
docker_local() {
  if [[ "$1 $2 $3" == 'image inspect --help' ]]; then printf '%s' "$TEST_INSPECT_HELP"; return; fi
  if [[ "$1" == 'version' ]]; then printf '%s' "$TEST_SERVER_API"; return; fi
  if [[ "$TEST_INSPECT_FAIL" == '1' ]]; then return 1; fi
  printf '%s' "$TEST_IMAGE_PLATFORM"
}
'''
        for help_text, api, platform, use_flag, admitted in [
            ('--format', '1.47', 'linux/amd64', False, True),
            ('--format --platform', '1.48', 'linux/amd64', False, True),
            ('--format --platform', '1.49', 'linux/amd64', True, True),
            ('--format --platform', '1.55', 'linux/amd64', True, True),
            ('--format', '1.47', 'linux/arm64', False, False),
            ('--format', '1.47', 'windows/amd64', False, False),
        ]:
            with self.subTest(help=help_text, api=api, platform=platform):
                run = subprocess.run(['bash', '-c', stub + snippet + r'''
configure_image_inspection || exit 11
[[ ${#image_inspect_platform_args[@]} == 0 ]] && printf 'plain\n' || printf 'explicit\n'
available_amd64_image fixture-image && printf 'admitted\n' || printf 'denied\n'
'''], env={**os.environ, 'TEST_INSPECT_HELP': help_text, 'TEST_SERVER_API': api,
          'TEST_IMAGE_PLATFORM': platform, 'TEST_INSPECT_FAIL': '0'}, text=True, capture_output=True, timeout=5)
                self.assertEqual(run.returncode, 0)
                self.assertEqual(run.stdout.splitlines(), ['explicit' if use_flag else 'plain', 'admitted' if admitted else 'denied'])
        run = subprocess.run(['bash', '-c', stub + snippet + 'configure_image_inspection; available_amd64_image fixture-image'],
            env={**os.environ, 'TEST_INSPECT_HELP': '--format', 'TEST_SERVER_API': '1.47',
                 'TEST_IMAGE_PLATFORM': 'linux/amd64', 'TEST_INSPECT_FAIL': '1'}, capture_output=True, timeout=5)
        self.assertNotEqual(run.returncode, 0)

    def test_all_generator_image_operations_keep_digest_and_execution_platform_guards(self):
        self.assertIn('configure_image_inspection\n', self.source)
        for image in ['db_image', 'storage_image', 'gotrue_image']:
            self.assertIn(f'if ! available_amd64_image "${image}"; then', self.source)
            self.assertIn(f'docker_local pull --platform linux/amd64 "${image}"', self.source)
        self.assertIn('docker_local run --rm --platform linux/amd64 --network none', self.source)
        self.assertIn('Postgres resolved RepoDigest does not match pinned index or amd64 manifest evidence', self.source)
        self.assertNotIn('docker_local image inspect --platform linux/amd64', self.source)


if __name__ == "__main__":
    unittest.main()
