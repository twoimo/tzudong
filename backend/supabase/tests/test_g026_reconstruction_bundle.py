import hashlib
import importlib.util
import json
import subprocess
import re
import sys
import unittest
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'backend/supabase/baselines/historical/pre-20260214-application'
VERIFY = ROOT / 'backend/supabase/scripts/verify_g026_reconstruction_bundle.py'
TRANSFORM_MEMBERSHIP = ROOT / 'backend/supabase/scripts/transform_g026_replay_membership.py'

spec = importlib.util.spec_from_file_location('verify_g026', VERIFY)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
membership_spec = importlib.util.spec_from_file_location('transform_g026_replay_membership', TRANSFORM_MEMBERSHIP)
membership_transform = importlib.util.module_from_spec(membership_spec)
membership_spec.loader.exec_module(membership_transform)

class G026BundleTests(unittest.TestCase):
    def test_bundle_verifies(self):
        result = subprocess.run([sys.executable, str(VERIFY)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
    def test_phase_b_is_the_only_repair_slot_and_precedes_g014_hardening(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        self.assertEqual(
            bundle['slots'],
            {
                'phaseAAfterOrdinal': 2,
                'phaseBBeforeMigration': '20260713002000_g014_public_api_private_boundary.sql',
            },
        )
        generator = (ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text(encoding='utf8')
        phase_b = "g026_apply_repairs 'g026-phase-b-before-20260713002000_g014_public_api_private_boundary.sql'"
        g014 = "20260713002000_g014_public_api_private_boundary.sql)"
        self.assertEqual(generator.count(phase_b), 1)
        self.assertNotIn('g026-phase-c-after-', generator)
        self.assertNotIn('g026_phase_c_applied', generator)
        g014_position = generator.index(g014, generator.index(phase_b))
        self.assertLess(generator.index(phase_b), g014_position)
        self.assertLess(g014_position, generator.index('20260713002600_g014_account_deletion_receipt_parity.sql', g014_position))
    def test_manifest_paths_are_exact_normalized_posix_repository_paths(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        base = 'backend/supabase/baselines/historical/pre-20260214-application'
        for key, filename in (('transition', 'G026_RECONSTRUCTION_TRANSITION.v4.sql'), ('repairs', 'G026_RECONSTRUCTION_REPAIRS.v4.sql')):
            path = bundle[key]['path']
            self.assertEqual(path, f'{base}/{filename}')
            self.assertEqual(verify.resolve_repo_path(path, filename), BASE / filename)
            for invalid in (
                f'C:/{path}', f'/{path}', path.replace('/', '\\'),
                path.replace(base, f'{base}/.'), path.replace(base, f'{base}//'),
                path.replace('pre-20260214-application', '../pre-20260214-application'),
                path.rsplit('/', 1)[0] + '/wrong.sql',
            ):
                with self.subTest(path=invalid):
                    with self.assertRaises(ValueError):
                        verify.resolve_repo_path(invalid, filename)

    def test_manifest_binds_exact_bytes_and_distinct_canonical_bodies(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        self.assertEqual(bundle['transition']['byteLength'], 27693)
        self.assertEqual(bundle['transition']['sha256'], '203168d618018f9ed2fd5b73b44fbfab29a5be9040b1671d06e5008da45d0ca0')
        self.assertEqual(verify.TRANSITION_BYTES, 27693)
        self.assertEqual(verify.TRANSITION_SHA256, '203168d618018f9ed2fd5b73b44fbfab29a5be9040b1671d06e5008da45d0ca0')
        self.assertEqual(bundle['repairs']['byteLength'], 46700)
        self.assertEqual(bundle['repairs']['sha256'], 'efc0c0ea9a8632801c5dbae81da74fe125fa57f1eafba8d4ad0708d03ce698cb')
        for key, filename in (('transition', 'G026_RECONSTRUCTION_TRANSITION.v4.sql'), ('repairs', 'G026_RECONSTRUCTION_REPAIRS.v4.sql')):
            raw = (BASE / filename).read_bytes()
            self.assertEqual(bundle[key]['byteLength'], len(raw))
            self.assertEqual(bundle[key]['sha256'], hashlib.sha256(raw).hexdigest())
        source = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        for name, body_hash in bundle['canonicalBodyHashes'].items():
            self.assertEqual(body_hash, verify.digest(verify.function_body(source, name)))
        self.assertEqual(set(bundle['canonicalBodyHashes']), set(verify.FUNCTIONS))

    def test_source_only_policy_identity_shells_are_exact_and_fail_closed(self):
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        verify.require_reconstruction_policy_shells(repairs)
        self.assertEqual(len(verify.RECONSTRUCTION_POLICY_SHELLS), 7)
        self.assertTrue(all('(false);' in statement for statement in verify.RECONSTRUCTION_POLICY_SHELLS))
        self.assertEqual(len(verify.RECONSTRUCTION_OBSOLETE_POLICY_DROPS), 4)
        for mutation in (
            repairs.replace(verify.RECONSTRUCTION_POLICY_SHELLS[0] + '\n', '', 1),
            repairs.replace(verify.RECONSTRUCTION_POLICY_SHELLS[1], verify.RECONSTRUCTION_POLICY_SHELLS[1].replace('(false)', '(true)'), 1),
            repairs.replace("IF v_existing_count <> 0 THEN", "IF v_existing_count < 0 THEN", 1),
            repairs.replace("      ('short_urls', 'Admins can delete short URLs')\n", '', 1),
            repairs.replace("WHERE namespace_row.nspname = 'public'", "WHERE namespace_row.nspname = 'not_public'", 1),
            repairs.replace(verify.RECONSTRUCTION_OBSOLETE_POLICY_DROPS[0] + '\n', '', 1),
            repairs.replace("= '(is_active = true)'", "= '(is_active = false)'", 1),
            repairs.replace(verify.RECONSTRUCTION_OBSOLETE_POLICY_DROPS[3] + '\n', '', 1),
            repairs + '\nCREATE POLICY unexpected_policy\n  ON public.restaurant_requests FOR SELECT USING (false);\n',
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_reconstruction_policy_shells(mutation)
    def test_approve_restaurant_preserves_immutable_predecessor_parameter_names(self):
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        predecessor = verify.APPROVE_RESTAURANT_PREDECESSOR.read_text(encoding='utf8')
        verify.require_approve_restaurant_signature(repairs, predecessor)
        self.assertIn(
            'CREATE OR REPLACE FUNCTION public.approve_restaurant(restaurant_id uuid,admin_user_id uuid)',
            repairs,
        )
        self.assertNotIn('p_restaurant_id', verify.function_body(repairs, 'approve_restaurant'))
        with self.assertRaisesRegex(ValueError, 'parameter-name drifted'):
            verify.require_approve_restaurant_signature(
                repairs.replace('restaurant_id uuid,admin_user_id uuid', 'p_restaurant_id uuid,p_admin_user_id uuid', 1),
                predecessor,
            )
    def test_obsolete_overload_drops_are_exact_ordered_and_non_cascading(self):
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        binding = bundle['synthesizedCompatibilityBindings']
        verify.require_obsolete_overload_drops(
            repairs, bundle['obsoleteOverloadDrops'], binding
        )
        expected = [
            'DROP FUNCTION IF EXISTS public.approve_restaurant(uuid);',
            'DROP FUNCTION IF EXISTS public.create_user_notification(uuid, public.notification_type, text, text, jsonb);',
        ]
        self.assertEqual(
            [line for line in repairs.splitlines() if line.startswith('DROP FUNCTION')],
            expected,
        )
        self.assertLess(
            repairs.index(expected[1]),
            repairs.index('CREATE OR REPLACE FUNCTION public.approve_restaurant('),
        )
        for mutation, error in (
            (repairs.replace(expected[0] + '\n', '', 1), 'declarations drifted'),
            (repairs.replace(expected[1] + '\n', '', 1), 'declarations drifted'),
            (repairs.replace(expected[0], expected[0].replace(';', ' CASCADE;'), 1), 'CASCADE'),
            (repairs.replace(expected[0] + '\n' + expected[1], expected[1] + '\n' + expected[0], 1), 'declarations drifted'),
            (repairs + '\nDROP FUNCTION IF EXISTS public.unrelated_function();\n', 'declarations drifted'),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaisesRegex(ValueError, error):
                    verify.require_obsolete_overload_drops(
                        mutation, bundle['obsoleteOverloadDrops'], binding
                    )
        malicious_binding = json.loads(json.dumps(binding))
        malicious_binding['obsolete'] = 'public.approve_restaurant(uuid)'
        with self.assertRaisesRegex(ValueError, 'was allowlisted'):
            verify.require_obsolete_overload_drops(
                repairs, bundle['obsoleteOverloadDrops'], malicious_binding
            )
    def test_jsonl_imports_preserve_historical_parameter_names(self):
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        verify.require_jsonl_import_signatures(repairs)
        self.assertIn(
            'CREATE OR REPLACE FUNCTION public.insert_restaurant_from_jsonl(jsonl_data jsonb)',
            repairs,
        )
        self.assertIn(
            'CREATE OR REPLACE FUNCTION public.batch_insert_restaurants_from_jsonl(jsonl_array jsonb[])',
            repairs,
        )
        with self.assertRaisesRegex(ValueError, 'parameter-name drifted'):
            verify.require_jsonl_import_signatures(
                repairs.replace('jsonl_data jsonb', 'p_record jsonb', 1),
            )
        with self.assertRaisesRegex(ValueError, 'parameter-name drifted'):
            verify.require_jsonl_import_signatures(
                repairs.replace('jsonl_array jsonb[]', 'p_records jsonb[]', 1),
            )
    def test_synthesized_compatibility_bindings_are_fail_closed_and_acl_closed(self):
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        binding = bundle['synthesizedCompatibilityBindings']
        verify.require_synthesized_compatibility_bindings(repairs, binding)
        self.assertEqual(
            binding['synthesis'],
            'reviewed_g026_non_historical_compatibility_bodies',
        )
        entries = {entry['name']: entry for entry in binding['functions']}
        self.assertEqual(set(entries), set(verify.SYNTHESIZED_COMPATIBILITY_NAMES))
        for entry in entries.values():
            self.assertEqual(
                entry['reviewStatus'],
                'reviewed_g026_synthesized_compatibility_body',
            )
            self.assertNotIn('sourceBodySha256', entry)
        for name in (
            'approve_restaurant_submission',
            'approve_edit_restaurant_submission',
        ):
            self.assertEqual(
                entries[name]['substitutions'],
                [
                    {'from': source_text, 'to': replacement_text, 'count': count}
                    for source_text, replacement_text, count
                    in verify.APPROVAL_SUBSTITUTION_ALLOWLIST[name]
                ],
            )
        for mutation, error in (
            (
                {**binding, 'synthesis': 'historical_source'},
                'synthesized compatibility marker drifted',
            ),
            (
                {
                    **binding,
                    'functions': [
                        {
                            **entry,
                            'reviewStatus': 'unreviewed',
                        } if entry['name'] == 'approve_restaurant_submission' else entry
                        for entry in binding['functions']
                    ],
                },
                'synthesized body marker drifted',
            ),
            (
                {
                    **binding,
                    'functions': [
                        {
                            **entry,
                            'repairBodySha256': '0' * 64,
                        } if entry['name'] == 'approve_restaurant_submission' else entry
                        for entry in binding['functions']
                    ],
                },
                'synthesized body binding drifted',
            ),
        ):
            with self.assertRaisesRegex(ValueError, error):
                verify.require_synthesized_compatibility_bindings(repairs, mutation)
        dump_path = 'pre-20260214-' + 'public-schema.sql'
        self.assertNotIn(dump_path, repairs)
        self.assertNotIn(dump_path, VERIFY.read_text(encoding='utf8'))
        self.assertNotIn(
            dump_path,
            (BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'),
        )
        for name, entry in entries.items():
            with self.subTest(name=name):
                self.assertEqual(
                    hashlib.sha256(verify.function_body(repairs, name).encode()).hexdigest(),
                    entry['repairBodySha256'],
                )
                mutation = repairs + f'\nGRANT EXECUTE ON FUNCTION public.{name}() TO PUBLIC;\n'
                with self.assertRaisesRegex(ValueError, 'additive EXECUTE grant'):
                    verify.require_synthesized_compatibility_bindings(mutation, binding)
    def test_atomic_extension_and_complete_backup_projection(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        for token in ('BEGIN;', 'SAVEPOINT g026_hnsw_probe;', 'ROLLBACK TO SAVEPOINT g026_hnsw_probe;', 'RELEASE SAVEPOINT g026_hnsw_probe;', verify.TRANSITION_OPERATOR, "to_regclass('public.g026_hnsw_probe_vectors') IS NOT NULL", 'ALTER TABLE public.restaurants_backup OWNER TO postgres;', 'FORCE ROW LEVEL SECURITY', 'restaurant_submission_items_target_restaurant_id_fkey', 'items_approved_target_restaurant_check'):
            self.assertIn(token, source)
        checkpoint_start = source.index('DO $$ BEGIN')
        checkpoint = source[checkpoint_start:source.index('END $$;', checkpoint_start)]
        self.assertNotIn(verify.GENERIC_EXTENSION_ASSERTION, checkpoint)
        self.assertEqual(checkpoint.count('IF '), len(verify.EXTENSION_ASSERTION_MESSAGES))
        positions = []
        for message in verify.EXTENSION_ASSERTION_MESSAGES:
            assertion = f"THEN RAISE EXCEPTION '{message}'"
            self.assertIn(assertion, checkpoint)
            positions.append(checkpoint.index(assertion))
        self.assertEqual(positions, sorted(positions))
        self.assertNotIn(verify.PRIOR_SPACED_TRANSITION_OPERATOR, source)
    def test_required_restaurant_columns_are_exact_and_mutation_rejected(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        verify.require_restaurant_columns(source)
        rename = 'ALTER TABLE public.restaurants RENAME COLUMN unique_id TO trace_id;'
        constraints = 'ALTER TABLE public.restaurants DROP CONSTRAINT restaurants_name_check;'
        start = source.index(rename) + len(rename)
        end = source.index(constraints, start)
        self.assertEqual(source[start:end].strip(), '\n'.join(verify.REQUIRED_RESTAURANT_COLUMNS))
        for statement in verify.REQUIRED_RESTAURANT_COLUMNS:
            with self.subTest(statement=statement):
                with self.assertRaisesRegex(ValueError, 'required restaurant column transition drifted'):
                    verify.require_restaurant_columns(source.replace(statement, '', 1))
    def test_ad_banners_historical_member_is_verbatim_and_fail_closed(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_ad_banners_source(source, bundle['adBanners'])
        begin = verify.AD_BANNERS_SOURCE['provenanceDelimiters'][0]
        self.assertIn("to_regclass('public.ad_banners') IS NOT NULL", source[:source.index(begin)])
        for mutation in (
            source.replace('CREATE TABLE IF NOT EXISTS ad_banners', 'CREATE TABLE ad_banners', 1),
            source.replace("('동반 성장'", "('동반 성장x'", 1),
            source.replace("to_regclass('public.ad_banners') IS NOT NULL", "false", 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_ad_banners_source(mutation, bundle['adBanners'])
    def test_short_urls_synthesized_base_relation_and_matrix_are_fail_closed(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_short_urls_source(source, bundle['shortUrls'])
        self.assertIn("to_regclass('public.short_urls') IS NOT NULL", source)
        self.assertLess(
            source.index("to_regclass('public.short_urls') IS NOT NULL"),
            source.index('-- G026 non-historical synthesized Phase A base relation:'),
        )
        matrix = bundle['shortUrls']['beforeAfterMatrix']
        self.assertEqual(matrix[0]['evidence'], 'Actions run 29363573853 failed: relation public.short_urls does not exist')
        self.assertIn('lines 7-35 validate NULL and duplicate code/target_url rows', matrix[2]['evidence'])
        self.assertIn('lines 38-43 add NOT NULL, unique code/target_url, and code format constraints', matrix[2]['evidence'])
        self.assertIn('lines 283-294 insert code, target_url, restaurant_id, and restaurant_name', matrix[2]['evidence'])
        for mutation in (
            source.replace('code text NOT NULL,', 'code text NOT NULL UNIQUE,', 1),
            source.replace("to_regclass('public.short_urls') IS NOT NULL", 'false', 1),
            source.replace('restaurant_name text,', 'restaurant_name text, CHECK (code <> \'\'),', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_short_urls_source(mutation, bundle['shortUrls'])
        tampered_matrix = dict(bundle['shortUrls'])
        tampered_matrix['kind'] = 'historical'
        with self.assertRaises(ValueError):
            verify.require_short_urls_source(source, tampered_matrix)
    def test_user_bookmarks_archive_bytes_are_fail_closed(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_user_bookmarks_source(source, bundle['userBookmarks'])
        self.assertEqual(bundle['userBookmarks']['blobSha1'], '1dd4894d0367a2ab1b5791bba28dc982be801c0e')
        self.assertEqual(bundle['userBookmarks']['byteLength'], 1708)
        self.assertEqual(bundle['userBookmarks']['sha256'], 'accd6b079af87270a4768211a93a224e285b778c661b8d2b3e30b2c40806598d')
        self.assertIn("to_regclass('public.user_bookmarks') IS NOT NULL", source)
        for mutation in (
            source.replace('CREATE TABLE IF NOT EXISTS public.user_bookmarks', 'CREATE TABLE public.user_bookmarks', 1),
            source.replace('COMMENT ON TABLE public.user_bookmarks', 'COMMENT ON TABLE public.bookmarks', 1),
            source.replace("to_regclass('public.user_bookmarks') IS NOT NULL", 'false', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_user_bookmarks_source(mutation, bundle['userBookmarks'])
    def test_storyboard_base_tables_are_source_only_complete_and_fail_closed(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_storyboard_base_tables_source(source, bundle['storyboardBaseTables'])
        matrix = bundle['storyboardBaseTables']['beforeAfterMatrix']
        self.assertEqual(matrix[0]['evidence'], 'Actions run 29364092725 failed: relation public.transcript_embeddings_bge does not exist')
        self.assertIn('transcript_embeddings_bge, video_frame_captions, and videos consecutively', matrix[2]['evidence'])
        self.assertIn('provider and provenance fields, which Phase A does not synthesize', matrix[3]['evidence'])
        self.assertLess(source.index('-- G026 non-historical synthesized Phase A base relation: source-derived solely from backend/supabase/migrations'), source.index('-- G026 non-historical synthesized Phase A base relations:'))
        self.assertLess(source.index('-- G026 non-historical synthesized Phase A base relations:'), source.index('-- G026 provenance begin:'))
        for mutation in (
            source.replace('embedding extensions.vector(1024),', 'embedding extensions.vector(1536),', 1),
            source.replace('channel_name text NOT NULL,', 'channel_name text,', 1),
            source.replace('UNIQUE(video_id,recollect_id,start_sec)', 'UNIQUE(video_id,recollect_id,start_sec,end_sec)', 1),
            source.replace("to_regclass('public.transcript_embeddings_bge') IS NOT NULL OR ", '', 1),
            source.replace(' duration integer,\n UNIQUE(video_id,recollect_id,start_sec)', ' duration integer,\n caption_provider text,\n UNIQUE(video_id,recollect_id,start_sec)', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_storyboard_base_tables_source(mutation, bundle['storyboardBaseTables'])
        tampered_matrix = dict(bundle['storyboardBaseTables'])
        tampered_matrix['kind'] = 'historical'
        with self.assertRaises(ValueError):
            verify.require_storyboard_base_tables_source(source, tampered_matrix)
    def test_search_logs_compatibility_shell_is_fail_closed_and_ordered(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_search_logs_source(source, bundle['searchLogs'])
        matrix = bundle['searchLogs']['beforeAfterMatrix']
        self.assertEqual(matrix[0]['evidence'], 'Actions run 29366186258 failed: relation public.search_logs does not exist')
        self.assertIn('object level only', matrix[3]['evidence'])
        self.assertIn('no policies keeps reads and inserts denied', matrix[3]['evidence'])
        guard = source.index("to_regclass('public.search_logs') IS NOT NULL")
        shell = source.index(verify.SEARCH_LOGS_TRANSITION.splitlines()[0])
        bookmarks = source.index('-- G026 provenance begin:')
        self.assertLess(guard, shell)
        self.assertLess(shell, bookmarks)
        for mutation in (
            source.replace('CREATE TABLE public.search_logs (\n id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n created_at timestamptz NOT NULL DEFAULT now()\n);', 'CREATE TABLE public.search_logs (\n id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n created_at timestamptz DEFAULT now()\n);', 1),
            source.replace('ALTER TABLE public.search_logs FORCE ROW LEVEL SECURITY;', '', 1),
            source.replace("to_regclass('public.search_logs') IS NOT NULL", 'false', 1),
            source.replace('CREATE TABLE public.search_logs (\n id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n created_at timestamptz NOT NULL DEFAULT now()\n);', 'CREATE TABLE public.search_logs (\n id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n query text,\n created_at timestamptz NOT NULL DEFAULT now()\n);', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_search_logs_source(mutation, bundle['searchLogs'])
        tampered_matrix = dict(bundle['searchLogs'])
        tampered_matrix['kind'] = 'historical'
        with self.assertRaises(ValueError):
            verify.require_search_logs_source(source, tampered_matrix)
    def test_restaurants_duplicate_shell_is_private_fail_closed_and_source_bound(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_restaurants_duplicate_source(source, bundle['restaurantsDuplicate'])
        matrix = bundle['restaurantsDuplicate']['beforeAfterMatrix']
        self.assertEqual(matrix[0]['evidence'], 'GitHub run 29367966495 failed: relation public.restaurants_duplicate does not exist')
        self.assertIn('no policies, grants, or data', matrix[1]['evidence'])
        self.assertIn('REVOKE ALL from anon and authenticated', matrix[2]['evidence'])
        guard = source.index("to_regclass('public.restaurants_duplicate') IS NOT NULL")
        shell = source.index(verify.RESTAURANTS_DUPLICATE_TRANSITION.splitlines()[0])
        bookmarks = source.index('-- G026 provenance begin:')
        self.assertLess(guard, shell)
        self.assertLess(shell, bookmarks)
        for mutation in (
            source.replace(verify.RESTAURANTS_DUPLICATE_TRANSITION, verify.RESTAURANTS_DUPLICATE_TRANSITION.replace('id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid()', 'id uuid PRIMARY KEY'), 1),
            source.replace('ALTER TABLE public.restaurants_duplicate FORCE ROW LEVEL SECURITY;', '', 1),
            source.replace("to_regclass('public.restaurants_duplicate') IS NOT NULL", 'false', 1),
            source.replace('ALTER TABLE public.restaurants_duplicate FORCE ROW LEVEL SECURITY;', 'ALTER TABLE public.restaurants_duplicate FORCE ROW LEVEL SECURITY;\nGRANT SELECT ON public.restaurants_duplicate TO anon;', 1),
            source.replace('CREATE TABLE public.restaurants_duplicate (', 'CREATE TABLE IF NOT EXISTS public.restaurants_duplicate (', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_restaurants_duplicate_source(mutation, bundle['restaurantsDuplicate'])
        tampered_matrix = dict(bundle['restaurantsDuplicate'])
        tampered_matrix['beforeAfterMatrix'] = []
        with self.assertRaises(ValueError):
            verify.require_restaurants_duplicate_source(source, tampered_matrix)
    def test_admin_workflow_pipeline_is_exact_source_bound_complete_and_fail_closed(self):
        source = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf8')
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        verify.require_admin_workflow_pipeline_source(source, bundle['adminWorkflowPipeline'])
        source_file = ROOT / bundle['adminWorkflowPipeline']['path']
        raw = source_file.read_bytes()
        self.assertEqual(len(raw), 5998)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '83acbf7f9ad5abf66de2aae7350db1a23a1f53d940336629252cdcb9d4f47a6e')
        self.assertLess(source.index('-- G026 non-historical synthesized Phase A base relations:'), source.index('-- G026 source-only Phase A prerequisite:'))
        self.assertLess(source.index('-- G026 source-only Phase A prerequisite:'), source.index('-- G026 non-historical compatibility shell:'))
        for token in (
            "CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');",
            'CREATE TYPE public.admin_workflow_correlation_state AS ENUM (',
            'CREATE TYPE public.admin_workflow_step_status AS ENUM (',
            'CREATE TABLE public.admin_workflow_runs (',
            'CREATE TABLE public.admin_workflow_steps (',
            'CREATE TABLE public.admin_workflow_signals (',
            'CREATE POLICY admin_workflow_runs_select_admin',
            'CREATE POLICY admin_workflow_steps_select_admin',
            'CREATE POLICY admin_workflow_signals_select_admin',
        ):
            with self.subTest(token=token):
                self.assertIn(token, source)
                with self.assertRaises(ValueError):
                    verify.require_admin_workflow_pipeline_source(source.replace(token, f'{token}_tampered', 1), bundle['adminWorkflowPipeline'])
        for token in (
            "to_regtype('public.admin_workflow_trigger_source') IS NOT NULL",
            "to_regclass('public.admin_workflow_runs') IS NOT NULL",
            "to_regclass('public.idx_admin_workflow_signals_run') IS NOT NULL",
            "to_regprocedure('public.touch_admin_workflow_updated_at()') IS NOT NULL",
            'ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_runs;',
        ):
            with self.subTest(token=token):
                with self.assertRaises(ValueError):
                    verify.require_admin_workflow_pipeline_source(source.replace(token, 'false', 1), bundle['adminWorkflowPipeline'])
        for mutation in (
            source.replace("WHERE publication.pubname = 'supabase_realtime'", 'WHERE false', 1),
            source.replace(
                "G026 realtime publication postcondition failed: required memberships are absent",
                'missing postcondition',
                1,
            ),
            source.replace('WHEN duplicate_object THEN', 'WHEN OTHERS THEN', 1),
            source.replace(
                "publication_relation.prrelid = 'public.admin_workflow_runs'::regclass",
                'false',
                1,
            ),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(ValueError):
                    verify.require_admin_workflow_pipeline_source(mutation, bundle['adminWorkflowPipeline'])
        self.assertEqual(source.count('WHEN duplicate_object THEN'), 2)
        self.assertNotIn('WHEN undefined_object THEN', source)
        self.assertNotIn('WHEN OTHERS THEN', source)
        self.assertEqual(source.count("publication_relation.prrelid = 'public.admin_workflow_runs'::regclass"), 2)
        self.assertEqual(source.count("publication_relation.prrelid = 'public.admin_workflow_steps'::regclass"), 2)
        tampered = dict(bundle['adminWorkflowPipeline'])
        tampered['publicationExcluded'] = []
        with self.assertRaises(ValueError):
            verify.require_admin_workflow_pipeline_source(source, tampered)

    def test_negative_contract_tokens_cover_locks_rollback_and_whitelists(self):
        source = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        for token in ("current_setting('check_function_bodies') <> 'on'", 'G026 pre-body checkpoint failed: submission backup target contract is missing', 'FOR UPDATE', "MESSAGE='음식점 생성/재사용에 실패했습니다.'", "RETURN QUERY SELECT false,SQLERRM,NULL::uuid; RETURN;", 'invalid approval field:', 'unsupported jsonl key:', 'invalid jsonl field:', 'CASE WHEN r.geocoding_success THEN NULL ELSE r.geocoding_false_stage END'):
            self.assertIn(token, source)
        self.assertLess(source.index("MESSAGE='음식점 생성/재사용에 실패했습니다.'"), source.index('PERFORM public.g026_upsert_restaurant_backup(v_new_restaurant_id);'))

    def test_approve_new_restaurant_submission_matrix_guards_are_executable_before_writes(self):
        source = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf8')
        matrix = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))['apiMatrix']
        verify.require_approve_new_restaurant_submission_guards(source, matrix)
        body = verify.function_body(source, 'approve_new_restaurant_submission')
        call_position = body.index('public.approve_submission_item')
        guard_tokens = (
            "jsonb_typeof(p_geocoded_data)<>'object'",
            "NOT p_geocoded_data ? 'items'",
            "jsonb_array_length(p_geocoded_data->'items')=0",
            "jsonb_typeof(v_payload_item)<>'object'",
            "v_item_id_text !~",
            'count(DISTINCT supplied.id)',
            'v_supplied_ids<>v_pending_ids',
        )
        for token in guard_tokens:
            with self.subTest(token=token):
                self.assertLess(body.index(token), call_position)
                with self.assertRaisesRegex(ValueError, 'approve_new_restaurant_submission'):
                    verify.require_approve_new_restaurant_submission_guards(source.replace(token, 'BROKEN_GUARD', 1), matrix)
        for condition in ('invalid_request', 'invalid_keys', 'empty_items', 'invalid_item', 'invalid_item_id', 'duplicate_item_id', 'omitted_pending_item'):
            altered_matrix = [dict(row) for row in matrix]
            next(row for row in altered_matrix if row.get('rpc') == 'approve_new_restaurant_submission' and row.get('condition') == condition)['message'] = 'tampered'
            with self.assertRaisesRegex(ValueError, 'matrix guard drifted'):
                verify.require_approve_new_restaurant_submission_guards(source, altered_matrix)
        self.assertLess(body.index('FOR UPDATE'), call_position)
        self.assertLess(body.index('ORDER BY data.item_id'), call_position)
        self.assertIn("jsonb_typeof(p_geocoded_data->'items')<>'array'", body)
        self.assertIn("(SELECT count(*) FROM jsonb_object_keys(v_payload_item))<>2", body)
        self.assertIn("v_item_id_text::uuid", body)
        self.assertIn('array_agg(supplied.id ORDER BY supplied.id)', body)

    def test_matrix_is_complete_and_contains_required_failure_rows(self):
        matrix = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))['apiMatrix']
        self.assertGreaterEqual(len(matrix), 30)
        rows = {(r['rpc'], r['condition'], r['message'], r['writes']) for r in matrix}
        self.assertIn(('approve_submission_item', 'new_restaurant_id_is_null', '음식점 생성/재사용에 실패했습니다.', 'none'), rows)
        self.assertIn(('approve_new_restaurant_submission', 'duplicate_item_id', '신규 제보 항목 ID가 중복되었습니다. (new submission item ids must be unique)', 'none'), rows)
        self.assertIn(('batch_insert_restaurants_from_jsonl', 'ordered_failures', None, 'per-record'), rows)

    def test_role_management_transform_is_atomic_hash_bound_and_fail_closed(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        transform = bundle['roleManagementReplayTransform']
        verify.require_role_management_replay_transform(transform)
        self.assertEqual(bundle['schemaVersion'], 5)
        self.assertEqual(transform['authority'], transform['executor'])
        self.assertEqual(transform['grantStatement'], 'GRANT privacy_workflow_owner TO postgres;')
        self.assertEqual(transform['revokeStatement'], 'REVOKE privacy_workflow_owner FROM postgres;')
        self.assertIn('pg_auth_members', transform['postcondition'])
        self.assertIn('rolbypassrls', transform['postcondition'])
        g013 = transform['files'][0]
        self.assertIn('DO $g026_public_schema_grant$', g013['publicSchemaGrantStatement'])
        self.assertIn("pg_catalog.current_setting('g026.public_schema_postgres_usage', true)", g013['publicSchemaGrantStatement'])
        self.assertIn("pg_catalog.current_setting('g026.public_schema_owner_create', true)", g013['publicSchemaGrantStatement'])
        self.assertIn("IF v_postgres_usage = 'false' THEN GRANT USAGE ON SCHEMA public TO postgres; END IF;", g013['publicSchemaGrantStatement'])
        self.assertIn("IF v_owner_create = 'false' THEN GRANT CREATE ON SCHEMA public TO privacy_workflow_owner; END IF;", g013['publicSchemaGrantStatement'])
        self.assertIn('DO $g026_public_schema_revoke$', g013['publicSchemaRevokeStatement'])
        self.assertIn("IF v_postgres_usage = 'false' THEN REVOKE USAGE ON SCHEMA public FROM postgres; END IF;", g013['publicSchemaRevokeStatement'])
        self.assertIn("IF v_owner_create = 'false' THEN REVOKE CREATE ON SCHEMA public FROM privacy_workflow_owner; END IF;", g013['publicSchemaRevokeStatement'])
        self.assertIn('pg_catalog.pg_namespace', g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.set_config('g026.public_schema_nspacl'", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.set_config('g026.public_schema_postgres_usage'", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.set_config('g026.public_schema_postgres_create'", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.set_config('g026.public_schema_owner_usage'", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.set_config('g026.public_schema_owner_create'", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.has_schema_privilege('postgres', 'public', 'USAGE')", g013['publicSchemaPrecondition'])
        self.assertIn("pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'CREATE')", g013['publicSchemaPrecondition'])
        self.assertIn("nspacl:null", g013['publicSchemaPrecondition'])
        self.assertIn("nspacl:json:", g013['publicSchemaPrecondition'])
        self.assertIn('pg_catalog.aclexplode(namespace_row.nspacl)', g013['publicSchemaPrecondition'])
        self.assertIn('pg_catalog.jsonb_agg', g013['publicSchemaPrecondition'])
        self.assertIn('ORDER BY acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable', g013['publicSchemaPrecondition'])
        self.assertIn("COALESCE(", g013['publicSchemaPrecondition'])
        self.assertNotIn('array_send', g013['publicSchemaPrecondition'])
        self.assertIn('pg_catalog.pg_namespace', g013['publicSchemaPostcondition'])
        self.assertIn("pg_catalog.current_setting('g026.public_schema_nspacl', true)", g013['publicSchemaPostcondition'])
        self.assertIn("pg_catalog.current_setting('g026.public_schema_postgres_usage', true)", g013['publicSchemaPostcondition'])
        self.assertIn("pg_catalog.current_setting('g026.public_schema_owner_create', true)", g013['publicSchemaPostcondition'])
        self.assertIn('saved state is absent or malformed', g013['publicSchemaPostcondition'])
        self.assertIn('IS DISTINCT FROM v_saved_snapshot', g013['publicSchemaPostcondition'])
        self.assertIn("pg_catalog.has_schema_privilege('postgres', 'public', 'CREATE') <> (v_postgres_create = 'true')", g013['publicSchemaPostcondition'])
        self.assertIn("pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'USAGE') <> (v_owner_usage = 'true')", g013['publicSchemaPostcondition'])
        self.assertIn("nspacl:json:", g013['publicSchemaPostcondition'])
        self.assertIn('pg_catalog.aclexplode(namespace_row.nspacl)', g013['publicSchemaPostcondition'])
        self.assertIn('pg_catalog.jsonb_agg', g013['publicSchemaPostcondition'])
        self.assertIn('ORDER BY acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable', g013['publicSchemaPostcondition'])
        self.assertIn("COALESCE(", g013['publicSchemaPostcondition'])
        self.assertNotIn('array_send', g013['publicSchemaPostcondition'])
        self.assertEqual(g013['publicSchemaTargetOwnerAnchor'], 'ALTER FUNCTION public.consume_tzuyang_address_evidence_admin_approval(\n')
        self.assertIn('assert_g014_workflow_owner_contract', transform['files'][1]['relocatedFinalContractInvocation'])
        g014 = transform['files'][1]
        self.assertEqual(g014['sourceSha256'], 'b3bea6e4f4b1649d3f7eebd719386473a22534551cbff5f69cafc3a05844c6f9')
        self.assertEqual(g014['transformedSha256'], '0c935031e8098a896f0c49268fd2f48c99af4d3c63df8d94f6e32e861c885a7a')
        self.assertEqual(g014['privateSchemaUsageGrantStatement'], 'GRANT USAGE ON SCHEMA privacy_retention TO postgres;')
        self.assertEqual(g014['privateFunctionExecuteGrantStatement'], 'GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO postgres;')
        self.assertEqual(g014['privateFunctionExecuteRevokeStatement'], 'REVOKE EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM postgres;')
        self.assertEqual(g014['privateSchemaUsageRevokeStatement'], 'REVOKE USAGE ON SCHEMA privacy_retention FROM postgres;')
        self.assertIn('pg_catalog.aclexplode', g014['privatePrivilegePostcondition'])
        self.assertIn('postgres explicit private privilege post-revoke contract failed', g014['privatePrivilegePostcondition'])
        self.assertEqual(g014['bridgeMembershipGrantStatement'], transform['grantStatement'])
        self.assertEqual(g014['bridgeMembershipRevokeStatement'], transform['revokeStatement'])
        self.assertEqual(g014['cleanupMembershipGrantStatement'], transform['grantStatement'])
        self.assertEqual(g014['cleanupMembershipRevokeStatement'], transform['revokeStatement'])
        for mutation in (
            {**transform, 'beginStatement': 'START TRANSACTION;'},
            {**transform, 'grantStatement': 'GRANT privacy_workflow_owner TO postgres WITH ADMIN OPTION;'},
            {**transform, 'revokeStatement': 'REVOKE privacy_workflow_owner FROM postgres CASCADE;'},
            {**transform, 'postcondition': transform['postcondition'].replace('rolcanlogin', 'rolcanlogon', 1)},
            {**transform, 'commitStatement': 'ROLLBACK;'},
            {**transform, 'files': [{**transform['files'][0], 'revokeAnchor': '$role$;\n'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaGrantStatement': 'GRANT USAGE, CREATE ON SCHEMA public TO PUBLIC;'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaGrantStatement': 'GRANT USAGE, CREATE ON SCHEMA public TO postgres;'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaGrantStatement': 'GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner;'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaRevokeStatement': 'REVOKE USAGE, CREATE ON SCHEMA public FROM postgres;'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaRevokeStatement': 'REVOKE USAGE, CREATE ON SCHEMA public FROM privacy_workflow_owner;'}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPrecondition': g013['publicSchemaPrecondition'].replace('pg_catalog.set_config', 'pg_catalog.set_missing_config', 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPostcondition': g013['publicSchemaPostcondition'].replace('pg_catalog.current_setting', 'pg_catalog.current_missing_setting', 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPrecondition': g013['publicSchemaPostcondition']}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaGrantStatement': g013['publicSchemaGrantStatement'].replace("IF v_owner_create = 'false' THEN GRANT CREATE ON SCHEMA public TO privacy_workflow_owner; END IF;", "GRANT CREATE ON SCHEMA public TO privacy_workflow_owner;", 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaRevokeStatement': g013['publicSchemaRevokeStatement'].replace("IF v_postgres_usage = 'false' THEN REVOKE USAGE ON SCHEMA public FROM postgres; END IF;", "REVOKE USAGE ON SCHEMA public FROM postgres;", 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPrecondition': g013['publicSchemaPrecondition'].replace("'g026.public_schema_owner_create'", "'g026.public_schema_owner_creat'", 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPostcondition': g013['publicSchemaPostcondition'].replace("pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'CREATE')", "pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'USAGE')", 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPostcondition': g013['publicSchemaPostcondition'].replace('IS DISTINCT FROM v_saved_snapshot', '= v_saved_snapshot', 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPrecondition': g013['publicSchemaPrecondition'].replace('ORDER BY acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable', 'ORDER BY acl_row.grantee, acl_row.grantor, acl_row.privilege_type, acl_row.is_grantable', 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaPostcondition': g013['publicSchemaPostcondition'].replace("COALESCE(", "NULLIF(", 1)}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaGrantAnchor': "NOTIFY pgrst, 'reload schema';\n"}, transform['files'][1]]},
            {**transform, 'files': [{**transform['files'][0], 'publicSchemaTargetOwnerAnchor': "NOTIFY pgrst, 'reload schema';\n"}, transform['files'][1]]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'relocatedFinalContractInvocation': None}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'privateSchemaUsageGrantStatement': 'GRANT USAGE ON SCHEMA privacy_retention TO PUBLIC;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'privateFunctionExecuteGrantStatement': 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA privacy_retention TO postgres;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'privateFunctionExecuteRevokeStatement': 'REVOKE EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM service_role;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'privateSchemaUsageRevokeStatement': 'REVOKE USAGE ON SCHEMA privacy_retention FROM service_role;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'privatePrivilegePostcondition': g014['privatePrivilegePostcondition'].replace('USAGE', 'CREATE', 1)}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'bridgeMembershipGrantStatement': 'GRANT privacy_workflow_owner TO service_role;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'bridgeMembershipRevokeStatement': 'REVOKE privacy_workflow_owner FROM service_role;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'cleanupMembershipGrantStatement': 'GRANT privacy_workflow_owner TO service_role;'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'cleanupMembershipRevokeStatement': 'REVOKE privacy_workflow_owner FROM service_role;'}]},
            {**transform, 'files': [{**transform['files'][0], 'transformedSha256': '0' * 64}, transform['files'][1]]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'transformedSha256': '0' * 64}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'sourceSha256': '81b31076860e0f6e33cd824486981d96626cca03a3d87bcb8013dd965d03c163'}]},
            {**transform, 'files': [transform['files'][0], {**transform['files'][1], 'transformedSha256': '071f30adb1d1148c30d49cd725287e457844f3eb5ea2e372eee4a062aab80738'}]},
        ):
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    verify.require_role_management_replay_transform(mutation)
        for item in transform['files']:
            source = ROOT / 'backend/supabase/migrations' / item['filename']
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), item['sourceSha256'])
    def test_generator_g013_public_schema_usage_create_window_is_hash_bound(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        transform = bundle['roleManagementReplayTransform']
        binding = transform['files'][0] | {
            name: transform[name] for name in (
                'beginStatement', 'grantStatement', 'revokeStatement',
                'commitStatement', 'removedStatement',
            )
        }
        generator = (ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text(encoding='utf8')
        program = generator.split("  python3 -c '\n", 1)[1].split("' \"$source\" \"$transformed\"", 1)[0]
        source = ROOT / 'backend/supabase/migrations' / binding['filename']
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / binding['filename']
            result = subprocess.run(
                [sys.executable, '-c', program, str(source), str(target),
                 json.dumps(binding), transform['postcondition'].rstrip('\n')],
                cwd=ROOT, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            transformed = target.read_text(encoding='utf8')
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), binding['transformedSha256'])
            statements = (
                binding['publicSchemaPrecondition'],
                binding['publicSchemaGrantStatement'],
                binding['publicSchemaGrantAnchor'].rstrip('\n'),
                binding['publicSchemaTargetOwnerAnchor'].rstrip('\n'),
                binding['publicSchemaRevokeStatement'],
                binding['publicSchemaPostcondition'],
                binding['revokeStatement'],
                transform['postcondition'].rstrip('\n'),
                binding['notifyAnchor'].rstrip('\n'),
                binding['commitStatement'],
            )
            positions = [transformed.index(statement) for statement in statements]
            self.assertEqual(positions, sorted(positions))
    def test_generator_g014_branch_accepts_only_null_public_schema_fields(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        transform = bundle['roleManagementReplayTransform']
        binding = transform['files'][1] | {
            name: transform[name] for name in (
                'beginStatement', 'grantStatement', 'revokeStatement',
                'commitStatement', 'removedStatement',
            )
        }
        generator = (ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text(encoding='utf8')
        program = generator.split("  python3 -c '\n", 1)[1].split("' \"$source\" \"$transformed\"", 1)[0]
        source = ROOT / 'backend/supabase/migrations' / binding['filename']
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / binding['filename']
            result = subprocess.run(
                [sys.executable, '-c', program, str(source), str(target),
                 json.dumps(binding), transform['postcondition'].rstrip('\n')],
                cwd=ROOT, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                hashlib.sha256(target.read_bytes()).hexdigest(),
                binding['transformedSha256'],
            )
            transformed = target.read_text(encoding='utf8')
            statements = (
                binding['privateSchemaUsageGrantStatement'],
                binding['privateFunctionExecuteGrantStatement'],
                binding['bridgeMembershipRevokeStatement'],
                transform['postcondition'].rstrip('\n'),
                binding['relocatedFinalContractInvocation'].rstrip('\n') + '\n' + binding['cleanupMembershipGrantStatement'],
                binding['privateFunctionExecuteRevokeStatement'],
                binding['privateSchemaUsageRevokeStatement'],
                binding['privateSchemaUsageRevokeStatement'] + '\n' + binding['cleanupMembershipRevokeStatement'],
                binding['privatePrivilegePostcondition'],
                binding['notifyAnchor'].rstrip('\n'),
                binding['commitStatement'],
            )
            positions = [transformed.index(statement) for statement in statements]
            self.assertEqual(positions, sorted(positions))
            self.assertEqual(transformed.count(binding['relocatedFinalContractInvocation'].rstrip('\n')), 1)
            self.assertEqual(transformed.count(binding['bridgeMembershipGrantStatement']), 2)
            self.assertEqual(transformed.count(binding['bridgeMembershipRevokeStatement']), 2)
            self.assertEqual(transformed.count(transform['postcondition'].rstrip('\n')), 2)
    def test_replay_membership_windows_transform_all_bound_sources(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        window = bundle['replayMembershipWindows']
        self.assertEqual(
            [row['filename'] for row in window['files']],
            [
                '20260713002100_g014_privacy_workflows.sql',
                '20260713002200_g014_marketing_state_machine.sql',
                '20260713002300_g014_account_deletion_state_machine.sql',
                '20260713002400_g014_retention_adapters_receipts.sql',
                '20260713002500_g014_catalog_contract.sql',
                '20260713002600_g014_account_deletion_receipt_parity.sql',
                '20260812000200_local_public_read_policy_convergence.sql',
                '20260812000300_local_admin_data_boundary_convergence.sql',
                '20260812000400_local_admin_map_overlay_boundary_convergence.sql',
            ],
        )
        for row in window['files']:
            source = (ROOT / 'backend/supabase/migrations' / row['filename']).read_bytes()
            transformed = membership_transform.build_transformed(source, row, window)
            self.assertEqual(len(transformed), row['transformedByteLength'])
            self.assertEqual(hashlib.sha256(transformed).hexdigest(), row['transformedSha256'])
            grant = (window['grantStatement'] + '\n').encode('ascii')
            revoke = (window['revokeStatement'] + '\n').encode('ascii')
            self.assertNotIn(b'SET LOCAL ROLE privacy_workflow_owner;', transformed)
            self.assertNotIn(b'RESET ROLE;', transformed)
            self.assertLess(transformed.index(grant), transformed.index(revoke))
            if row['mode'] == 'revoke_before_catalog_assertion':
                statements = (
                    (window['catalogSchemaUsageGrantStatement'] + '\n').encode('ascii'),
                    (window['catalogFunctionExecuteGrantStatement'] + '\n').encode('ascii'),
                    revoke,
                    (window['postcondition'] + '\n').encode('ascii'),
                    row['anchor'].encode('ascii'),
                    (window['cleanupMembershipGrantStatement'] + '\n').encode('ascii'),
                    (window['catalogFunctionExecuteRevokeStatement'] + '\n').encode('ascii'),
                    (window['catalogSchemaUsageRevokeStatement'] + '\n').encode('ascii'),
                    (window['cleanupMembershipRevokeStatement'] + '\n').encode('ascii'),
                    (window['postcondition'] + '\n').encode('ascii'),
                    (window['catalogPrivilegePostcondition'] + '\n').encode('ascii'),
                )
                self.assertEqual(
                    [transformed.count(statement) for statement in statements],
                    [1, 1, 2, 2, 1, 2, 1, 1, 2, 2, 1],
                )
                positions = [
                    transformed.find(statements[0]),
                    transformed.find(statements[1]),
                    transformed.find(statements[2]),
                    transformed.find(statements[3]),
                    transformed.find(statements[4]),
                    transformed.rfind(statements[5]),
                    transformed.find(statements[6]),
                    transformed.find(statements[7]),
                    transformed.rfind(statements[8]),
                    transformed.rfind(statements[9]),
                    transformed.find(statements[10]),
                ]
                self.assertEqual(positions, sorted(positions))
                self.assertEqual(
                    transformed.index(statements[-1]) + len(statements[-1]),
                    transformed.index(b"NOTIFY pgrst, 'reload schema';\n"),
                )
    def test_retention_source_avoids_unsupported_large_regex_repetitions(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql'
        ).read_text(encoding='utf8')
        oversized = [
            match.group(0)
            for match in re.finditer(r'\{\d+,(\d+)\}', source)
            if int(match.group(1)) > 255
        ]
        self.assertEqual(oversized, [])
    def test_retention_role_hardening_does_not_require_superuser_alteration(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql'
        ).read_text(encoding='utf8')
        self.assertNotIn("'ALTER ROLE %I NOSUPERUSER", source)
        self.assertIn(
            'role_row.rolsuper OR role_row.rolreplication OR role_row.rolbypassrls',
            source,
        )
    def test_retention_normalizes_only_declared_definers_and_preserves_exact_invokers(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql'
        ).read_text(encoding='utf8')
        normalize = source.index('DO $g014_normalize_allowlisted_definers$')
        assertion = source.index(
            'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_definer_contract()'
        )
        self.assertLess(normalize, assertion)
        self.assertIn(
            'ALTER FUNCTION %s OWNER TO privacy_workflow_owner',
            source[normalize:assertion],
        )
        declared_invokers = (
            'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.ocr_log_metadata_is_safe(jsonb)',
        )
        invoker_block = (
            "IF v_signature IN (\n"
            f"      '{declared_invokers[0]}',\n"
            f"      '{declared_invokers[1]}',\n"
            f"      '{declared_invokers[2]}'\n"
            "    ) THEN"
        )

        def require_contract(candidate):
            for signature in declared_invokers:
                self.assertEqual(candidate.count(signature), 2)
            self.assertEqual(candidate.count(invoker_block), 2)
            self.assertIn(
                'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER',
                candidate,
            )
            self.assertIn(
                'G014 undeclared SECURITY INVOKER allowlisted RPC',
                candidate,
            )
            self.assertIn(
                'G014 SECURITY DEFINER owner mismatch',
                candidate,
            )

        require_contract(source)
        for mutation in (
            source.replace(declared_invokers[2], 'public.unexpected_invoker()', 2),
            source.replace(
                invoker_block,
                invoker_block.replace(
                    f"      '{declared_invokers[2]}'\n",
                    f"      '{declared_invokers[2]}',\n"
                    "      'public.unexpected_invoker()'\n",
                ),
            ),
            source.replace(
                'G014 undeclared SECURITY INVOKER allowlisted RPC',
                'G014 allowlisted RPC',
                1,
            ),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(AssertionError):
                    require_contract(mutation)
    def test_catalog_contract_resolves_auth_users_by_exact_catalog_oid(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql'
        ).read_text(encoding='utf8')
        self.assertNotIn("'auth.users'::regclass", source)
        self.assertIn('FROM pg_catalog.pg_class AS relation_row', source)
        self.assertIn('JOIN pg_catalog.pg_namespace AS namespace', source)
        self.assertIn("namespace.nspname = 'auth'", source)
        self.assertIn("relation_row.relname = 'users'", source)
        self.assertIn("relation_row.relkind = 'r'", source)
        self.assertIn("constraint_row.confrelid = v_auth_users_oid", source)
        self.assertIn(
            "RAISE EXCEPTION 'G014 auth.users catalog identity is missing or ambiguous'",
            source,
        )
        self.assertNotIn('GRANT USAGE ON SCHEMA auth', source)
        self.assertNotIn('REVOKE USAGE ON SCHEMA auth', source)
    def test_catalog_contract_auth_dependency_diagnostic_is_exact_and_deterministic(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql'
        ).read_text(encoding='utf8')
        expected_identities = (
            'privacy_onboarding_challenges.consumed_by_user_id',
            'privacy_guardian_verifications.child_user_id',
            'privacy_age_profiles.user_id',
            'privacy_consent_events.user_id',
        )
        detached_audit_identity = "'privacy_audit_events'::name, 'actor_user_id'::name"

        def require_diagnostic(candidate):
            diagnostic_start = candidate.index(
                '-- The moved G010 identities retain exactly four live Auth FKs.'
            )
            diagnostic_end = candidate.index('END;\n$function$;', diagnostic_start)
            diagnostic = candidate[diagnostic_start:diagnostic_end]
            self.assertIn(
                'G014 private auth.users dependency contract drifted; missing=[%]; unexpected=[%]',
                diagnostic,
            )
            self.assertIn(
                'INTO v_auth_dependency_missing, v_auth_dependency_unexpected;',
                diagnostic,
            )
            self.assertEqual(diagnostic.count("namespace.nspname = 'privacy_retention'"), 1)
            self.assertEqual(diagnostic.count('constraint_row.confrelid = v_auth_users_oid'), 1)
            self.assertEqual(diagnostic.count("WHEN 'r' THEN 'RESTRICT'"), 1)
            self.assertEqual(diagnostic.count('ORDER BY schema_name, relation_name, column_name, constraint_name, delete_action'), 2)
            for identity in expected_identities:
                relation_name, column_name = identity.split('.')
                self.assertIn(f"'{relation_name}'::name, '{column_name}'::name", diagnostic)
            self.assertNotIn(detached_audit_identity, diagnostic)
            self.assertNotIn('GRANT USAGE ON SCHEMA auth', candidate)
            self.assertNotIn('REVOKE USAGE ON SCHEMA auth', candidate)

        require_diagnostic(source)
        for mutation in (
            source.replace('v_auth_dependency_unexpected;', 'v_auth_dependency_missing;', 1),
            source.replace("WHEN 'r' THEN 'RESTRICT'", "WHEN 'r' THEN 'CASCADE'", 1),
            source.replace(
                'ORDER BY schema_name, relation_name, column_name, constraint_name, delete_action',
                'ORDER BY relation_name',
                1,
            ),
            source.replace(
                "('privacy_retention'::name, 'privacy_consent_events'::name, 'user_id'::name, 'privacy_consent_events_user_id_fkey'::name, 'RESTRICT'::text)",
                "('privacy_retention'::name, 'privacy_consent_events'::name, 'user_id'::name, 'privacy_consent_events_user_id_fkey'::name, 'RESTRICT'::text),\n"
                "      ('privacy_retention'::name, 'privacy_audit_events'::name, 'actor_user_id'::name, 'privacy_audit_events_actor_user_id_fkey'::name, 'RESTRICT'::text)",
                1,
            ),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(AssertionError):
                    require_diagnostic(mutation)

    def test_catalog_contract_preserves_exact_invokers_and_rejects_undeclared_invokers(self):
        source = (
            ROOT
            / 'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql'
        ).read_text(encoding='utf8')
        declared_invokers = (
            'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
            'public.ocr_log_metadata_is_safe(jsonb)',
        )
        invoker_block = (
            "IF v_expected.source_signature IN (\n"
            + "".join(
                f"      '{signature}',\n"
                for signature in declared_invokers[:-1]
            )
            + f"      '{declared_invokers[-1]}'\n"
            + "    ) THEN"
        )

        def require_contract(candidate):
            for signature in declared_invokers:
                self.assertEqual(candidate.count(signature), 1)
            self.assertEqual(candidate.count(invoker_block), 1)
            self.assertIn(
                'G014 declared SECURITY INVOKER public RPC became SECURITY DEFINER',
                candidate,
            )
            self.assertIn(
                'G014 undeclared SECURITY INVOKER allowlisted public RPC',
                candidate,
            )
            self.assertIn(
                'G014 allowlisted public RPC owner/definer/path mismatch',
                candidate,
            )
            self.assertIn('ELSIF NOT v_is_definer THEN', candidate)

        require_contract(source)
        for mutation in (
            source.replace(declared_invokers[-1], 'public.unexpected_invoker()', 1),
            source.replace(
                invoker_block,
                invoker_block.replace(
                    f"      '{declared_invokers[-1]}'\n",
                    f"      '{declared_invokers[-1]}',\n"
                    "      'public.unexpected_invoker()'\n",
                ),
            ),
            source.replace('ELSIF NOT v_is_definer THEN', 'ELSIF false THEN', 1),
        ):
            with self.subTest(mutation=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(AssertionError):
                    require_contract(mutation)
    def test_replay_membership_transform_rejects_binding_and_anchor_drift(self):
        bundle = json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))
        window = bundle['replayMembershipWindows']
        source = (ROOT / 'backend/supabase/migrations' / window['files'][4]['filename']).read_bytes()
        for mutation in (
            {**window['files'][4], 'sourceSha256': '0' * 64},
            {**window['files'][4], 'anchor': 'SELECT privacy_retention.missing_assertion();\n'},
            {**window['files'][4], 'cleanupAnchor': 'unexpected'},
        ):
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    membership_transform.build_transformed(source, mutation, window)
        for field in (
            'catalogSchemaUsageGrantStatement',
            'catalogFunctionExecuteGrantStatement',
            'cleanupMembershipGrantStatement',
            'catalogFunctionExecuteRevokeStatement',
            'catalogSchemaUsageRevokeStatement',
            'cleanupMembershipRevokeStatement',
            'catalogPrivilegePostcondition',
        ):
            with self.subTest(field=field):
                mutated_window = json.loads(json.dumps(window))
                mutated_window[field] += ' -- mutated'
                with self.assertRaisesRegex(ValueError, 'authority drifted'):
                    verify.require_replay_membership_windows(mutated_window)
        for mutation in (
            lambda value: value.pop('catalogSchemaUsageGrantStatement'),
            lambda value: value.pop('cleanupMembershipGrantStatement'),
            lambda value: value.pop('cleanupMembershipRevokeStatement'),
            lambda value: value.__setitem__('unexpectedPrivilegeStatement', 'GRANT ALL'),
        ):
            with self.subTest(contract_shape=mutation):
                mutated_window = json.loads(json.dumps(window))
                mutation(mutated_window)
                with self.assertRaisesRegex(ValueError, 'window binding drifted'):
                    verify.require_replay_membership_windows(mutated_window)
    def test_generator_executes_each_replay_membership_window_and_final_proof(self):
        generator = (ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text(encoding='utf8')
        self.assertIn('transform_g026_replay_membership.py', generator)
        for row in json.loads((BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json').read_text(encoding='utf8'))['replayMembershipWindows']['files']:
            self.assertIn(row['filename'], generator)
        self.assertIn(".replayMembershipWindows.finalZeroMembershipProof", generator)
        self.assertIn('replay-membership-window:${migration##*/}', generator)
if __name__ == '__main__':
    unittest.main()
