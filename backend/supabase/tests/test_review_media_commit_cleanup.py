"""Isolated PostgreSQL tests; no hosted connection or application data.

The minimal fixture extracts real review triggers, constraints and RLS from the
repository baseline. Storage HTTP is tested separately with injected failures;
this fixture verifies metadata, retirement, grants and transaction semantics.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql'
PRIVATE_MIGRATION = ROOT / 'backend/supabase/migrations/20261008200719_review_verification_private.sql'
PG = Path(os.environ.get('REVIEW_TEST_PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
DOCKER_CONTEXT = os.environ.get('REVIEW_TEST_DOCKER_CONTEXT')
DOCKER_CONTAINER = os.environ.get('REVIEW_TEST_DOCKER_CONTAINER')
OWNER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
REVIEW = '33333333-3333-4333-8333-333333333333'
RESTAURANT = '44444444-4444-4444-8444-444444444444'
EDIT = '55555555-5555-4555-8555-555555555555'
DELETE = '66666666-6666-4666-8666-666666666666'
BASE = f'{OWNER}/reviews/{REVIEW}'
OLD = f'{BASE}/food/old.webp'
NEW = f'{BASE}/food/new.webp'
VERIFY = f'{BASE}/verification/proof.webp'


def fixture():
    baseline = (ROOT / 'backend/supabase/baselines/pre-20260214-public-schema.sql').read_text()
    def extract(pattern):
        match = re.search(pattern, baseline, re.S)
        if not match:
            raise AssertionError('REVIEW_FIXTURE_SOURCE_MISSING')
        return match.group(0)
    tables = extract(r'CREATE TABLE public.reviews \(.*?\n\);')
    funcs = '\n'.join(extract(r'CREATE FUNCTION public.' + name + r'\(.*?\n\$\$;') for name in [
        'update_user_stats_on_review', 'set_review_edited_at', 'update_updated_at_column',
        'increment_review_like_count', 'decrement_review_like_count'])
    policies = '\n'.join(re.findall(r'CREATE POLICY [^\n]+ ON public.reviews [^\n]+;', baseline))
    return f"""
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
INSERT INTO storage.buckets VALUES ('review-photos','review-photos',true,NULL,NULL);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY, review_count integer DEFAULT 0);
CREATE TABLE public.user_stats(user_id uuid PRIMARY KEY, review_count integer DEFAULT 0,
 verified_review_count integer DEFAULT 0, trust_score integer DEFAULT 0, last_updated timestamptz);
{tables}
ALTER TABLE public.reviews ADD PRIMARY KEY (id);
CREATE TABLE public.review_likes(id uuid PRIMARY KEY, review_id uuid REFERENCES public.reviews(id) ON DELETE CASCADE, user_id uuid);
{funcs}
CREATE TRIGGER trigger_set_review_edited_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.set_review_edited_at();
CREATE TRIGGER trigger_update_user_stats AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_user_stats_on_review();
CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER review_like_insert_trigger AFTER INSERT ON public.review_likes FOR EACH ROW EXECUTE FUNCTION public.increment_review_like_count();
CREATE TRIGGER review_like_delete_trigger AFTER DELETE ON public.review_likes FOR EACH ROW EXECUTE FUNCTION public.decrement_review_like_count();
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
{policies}
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
CREATE TABLE storage.objects(bucket_id text, name text, PRIMARY KEY(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO authenticated, anon;
GRANT INSERT, DELETE ON storage.objects TO authenticated;
CREATE POLICY storage_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'review-photos');
CREATE POLICY storage_owner_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'review-photos');
CREATE POLICY storage_owner_delete ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id = 'review-photos' AND split_part(name,'/',1) = auth.uid()::text);
CREATE FUNCTION public.check_test(ok boolean, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION USING MESSAGE = code; END IF; END $$;
INSERT INTO public.restaurants(id) VALUES ('{RESTAURANT}');
INSERT INTO public.user_stats(user_id) VALUES ('{OWNER}');
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos,categories,is_verified)
 VALUES ('{REVIEW}','{OWNER}','{RESTAURANT}','fixture','Original fixture review content.',now(),'{VERIFY}',ARRAY['{OLD}'],ARRAY['한식'],true);
INSERT INTO storage.objects VALUES ('review-photos','{OLD}'),('review-photos','{NEW}'),('review-photos','{VERIFY}');
INSERT INTO public.review_likes VALUES ('77777777-7777-4777-8777-777777777777','{REVIEW}','{OTHER}');
CREATE TABLE public.fixture_revision AS SELECT updated_at FROM public.reviews WHERE id = '{REVIEW}';
GRANT SELECT ON public.fixture_revision TO authenticated;
"""


class ReviewMediaSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if DOCKER_CONTAINER or DOCKER_CONTEXT:
            if (DOCKER_CONTEXT, DOCKER_CONTAINER) != ('colima-tzudong-catalog-20261007', 'tzudong-ranking-clone-20261008'):
                raise unittest.SkipTest('REVIEW_TEST_CONTAINER_NOT_OWNED')
            cls.prefix = ['docker', '--context', DOCKER_CONTEXT, 'exec', '-i', '-e',
                          'PGPASSWORD=fixture-only', DOCKER_CONTAINER]
            version = subprocess.check_output(cls.prefix + ['postgres', '--version'], text=True)
            if not re.search(r'\b17\.6(?:\s|$)', version):
                raise unittest.SkipTest('REVIEW_TEST_POSTGRES_VERSION_MISMATCH')
            cls.connection = ['-h', '127.0.0.1', '-U', 'supabase_admin']
            return
        if not (PG / 'initdb').exists():
            raise unittest.SkipTest('REVIEW_TEST_REQUIRES_ISOLATED_POSTGRES_17_11')
        version = subprocess.check_output([str(PG / 'postgres'), '--version'], text=True)
        if ' 17.11 ' not in version:
            raise unittest.SkipTest('REVIEW_TEST_POSTGRES_VERSION_MISMATCH')
        cls.temp = tempfile.TemporaryDirectory(prefix='review-media-pg-')
        cls.base = Path(cls.temp.name)
        cls.data = cls.base / 'data'
        subprocess.run([str(PG / 'initdb'), '-D', str(cls.data), '-A', 'trust', '-U', 'postgres', '--no-locale'],
                       check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.base / 'postgres.log'),
                        '-o', f"-k {cls.base} -h '' -c log_min_error_statement=panic", '-w', 'start'],
                       check=True, capture_output=True)
        cls.psql = [str(PG / 'psql'), '-X', '-qAt', '-h', str(cls.base), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
        cls.prefix = []
        cls.connection = ['-h', str(cls.base), '-U', 'postgres']

    @classmethod
    def command(cls, name):
        return cls.prefix + [name if cls.prefix else str(PG / name)]

    def setUp(self):
        self.database = ('review_media_' + self._testMethodName)[:63]
        subprocess.run(self.command('createdb') + self.connection + [self.database], check=True, capture_output=True)
        self.psql = self.command('psql') + ['-X', '-qAt'] + self.connection + ['-d', self.database, '-v', 'ON_ERROR_STOP=1']
        self.sql(fixture())
        if self._testMethodName == 'test_authoritative_legacy_edit_and_cleanup':
            self.sql(f"""
UPDATE public.reviews SET food_photos = ARRAY['{OWNER}/1720000000000_food_0_old.webp'],
 verification_photo = '{OWNER}/1720000000000_verification_proof.webp' WHERE id = '{REVIEW}';
UPDATE public.fixture_revision SET updated_at = (SELECT updated_at FROM public.reviews WHERE id = '{REVIEW}');
INSERT INTO storage.objects VALUES ('review-photos','{OWNER}/1720000000000_food_0_old.webp'),
 ('review-photos','{OWNER}/1720000000000_verification_proof.webp');
""")
        if self._testMethodName == 'test_global_legacy_reference_protection':
            # Pre-migration imported data may share a canonical URL across rows.
            self.sql(f"""
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos,categories)
 VALUES ('88888888-8888-4888-8888-888888888888','{OTHER}','{RESTAURANT}','fixture','Historical fixture review.',now(),
 'legacy-proof',ARRAY['https://fixture.invalid/storage/v1/object/public/review-photos/{OLD.replace('/', '%2F')}?fixture=1'],ARRAY['한식']);
""")
        self.sql(MIGRATION.read_text())

    def tearDown(self):
        subprocess.run(self.command('dropdb') + self.connection + [self.database], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'data'):
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'], capture_output=True)
            cls.temp.cleanup()

    def sql(self, content):
        run = subprocess.run(self.psql, input=content, text=True, capture_output=True, timeout=30)
        if run.returncode:
            # Never emit query text, database paths or provider diagnostics.
            code = re.search(r'ERROR:\s+(REVIEW_TEST_[A-Z_]+)', run.stderr)
            raise AssertionError(code.group(1) if code else 'REVIEW_TEST_SQL_FAILED')
        return run.stdout.strip()

    def test_commit_cleanup_and_permissions(self):
        mutate = f"public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',(SELECT updated_at FROM public.fixture_revision),'Updated fixture review content.',ARRAY['한식'],ARRAY['{NEW}'])"
        self.sql(f"""
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',now(),repeat('x',262145),ARRAY['한식'],ARRAY['{NEW}']) = 'REVIEW_INVALID','REVIEW_TEST_CONTENT_BOUND');
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',now(),'Updated fixture review content.',array_fill('한식'::text,ARRAY[101]),ARRAY['{NEW}']) = 'REVIEW_INVALID','REVIEW_TEST_CATEGORY_BOUND');
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',now(),'Updated fixture review content.',ARRAY[NULL::text],ARRAY['{NEW}']) = 'REVIEW_INVALID','REVIEW_TEST_CATEGORY_NULL');
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','delete',now(),'ignored payload',NULL,NULL) = 'REVIEW_INVALID','REVIEW_TEST_DELETE_PAYLOAD');
RESET ROLE;
SELECT public.check_test(NOT has_function_privilege('anon','public.mutate_review_with_media(uuid,uuid,text,timestamptz,text,text[],text[])','EXECUTE'),'REVIEW_TEST_ANON_GRANT');
SELECT public.check_test(NOT has_schema_privilege('authenticated','review_media_private','USAGE'),'REVIEW_TEST_PRIVATE_SCHEMA');
SET ROLE authenticated; SET request.jwt.claim.sub = '{OTHER}';
SELECT public.check_test({mutate} = 'REVIEW_NOT_FOUND','REVIEW_TEST_OTHER_OWNER');
RESET ROLE;
SELECT public.check_test((SELECT count(*) FROM storage.objects) = 3,'REVIEW_TEST_UNAUTHORIZED_MEDIA');
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
DELETE FROM storage.objects WHERE name = '{OLD}';
SELECT public.check_test((SELECT count(*) FROM storage.objects) = 3,'REVIEW_TEST_LIVE_DELETE_BLOCKED');
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',(SELECT updated_at FROM public.fixture_revision),'bad',ARRAY['한식'],ARRAY['{NEW}']) = 'REVIEW_INVALID','REVIEW_TEST_REJECT_BEFORE_COMMIT');
SELECT public.check_test(public.read_review_media_commit('{EDIT}','{REVIEW}','edit') = 'REVIEW_NOT_CONFIRMED','REVIEW_TEST_REJECTION_RECEIPT');
SELECT public.check_test((SELECT food_photos FROM public.reviews WHERE id = '{REVIEW}') = ARRAY['{OLD}'],'REVIEW_TEST_REJECTION_ROW');
RESET ROLE;
-- Inject an actual transaction exception after UPDATE; receipt/queue roll back.
CREATE FUNCTION public.inject_review_rejection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$;
CREATE TRIGGER zz_reject AFTER UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.inject_review_rejection();
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM {mutate}; RAISE EXCEPTION 'REVIEW_TEST_INJECTION_MISSED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fixture' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT public.check_test((SELECT count(*) FROM review_media_private.commits) = 0,'REVIEW_TEST_ROLLBACK_RECEIPT');
SELECT public.check_test((SELECT count(*) FROM review_media_private.cleanup) = 0,'REVIEW_TEST_ROLLBACK_QUEUE');
DROP TRIGGER zz_reject ON public.reviews;
SET ROLE authenticated;
SELECT public.check_test({mutate} = 'REVIEW_COMMITTED','REVIEW_TEST_EDIT_COMMIT');
SELECT public.check_test(public.read_review_media_commit('{EDIT}','{REVIEW}','edit') = 'REVIEW_COMMITTED','REVIEW_TEST_EXACT_RECEIPT');
SELECT public.check_test({mutate} = 'REVIEW_COMMITTED','REVIEW_TEST_IDEMPOTENT_EDIT');
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',(SELECT updated_at FROM public.fixture_revision),'Different fixture review text.',ARRAY['한식'],ARRAY['{NEW}']) = 'REVIEW_CONFLICT','REVIEW_TEST_ID_REUSE');
SELECT public.check_test((SELECT NOT is_verified AND admin_note IS NULL AND like_count = 1 FROM public.reviews WHERE id = '{REVIEW}'),'REVIEW_TEST_MODERATION_LIKES');
SELECT public.check_test(public.queue_review_upload_cleanup('{REVIEW}',ARRAY['{NEW}']) = 'REVIEW_CLEANUP_QUEUED','REVIEW_TEST_COMPENSATION_REQUEST');
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 1,'REVIEW_TEST_LIVE_UPLOAD_EXCLUDED');
DELETE FROM storage.objects WHERE name = '{NEW}';
SELECT public.check_test(EXISTS(SELECT 1 FROM storage.objects WHERE name = '{NEW}'),'REVIEW_TEST_LIVE_UPLOAD_PROTECTED');
DELETE FROM storage.objects WHERE name = '{OLD}';
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_CLEANUP_READBACK');
DO $$ BEGIN
  BEGIN UPDATE public.reviews SET food_photos = ARRAY['{OLD}'] WHERE id = '{REVIEW}'; RAISE EXCEPTION 'REVIEW_TEST_REATTACH_ALLOWED';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT public.check_test((SELECT review_count FROM public.user_stats WHERE user_id = '{OWNER}') = 1,'REVIEW_TEST_STATS_EDIT_ONCE');
CREATE TABLE public.fixture_delete_revision AS SELECT updated_at FROM public.reviews WHERE id = '{REVIEW}';
GRANT SELECT ON public.fixture_delete_revision TO authenticated;
SET ROLE authenticated;
SELECT public.check_test(public.mutate_review_with_media('{DELETE}','{REVIEW}','delete',(SELECT updated_at FROM public.fixture_delete_revision)) = 'REVIEW_COMMITTED','REVIEW_TEST_DELETE_COMMIT');
SELECT public.check_test(NOT EXISTS(SELECT 1 FROM public.reviews WHERE id = '{REVIEW}'),'REVIEW_TEST_DELETE_ROW');
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 2,'REVIEW_TEST_BOTH_PURPOSES');
-- Partial Storage failure: remove only food, then reconnect to drain proof.
DELETE FROM storage.objects WHERE name = '{NEW}';
SELECT public.check_test(public.finish_review_media_cleanup() = 1,'REVIEW_TEST_PARTIAL_STORAGE');
RESET ROLE;
SELECT public.check_test((SELECT review_count FROM public.user_stats WHERE user_id = '{OWNER}') = 0,'REVIEW_TEST_STATS_DELETE_ONCE');
SELECT public.check_test((SELECT review_count FROM public.restaurants WHERE id = '{RESTAURANT}') = 0,'REVIEW_TEST_RESTAURANT_COUNT');
SELECT public.check_test((SELECT count(*) FROM public.review_likes) = 0,'REVIEW_TEST_LIKE_CASCADE');
""")
        # A fresh connection is the revisit boundary; no retained client keys.
        self.sql(f"""
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 1,'REVIEW_TEST_REVISIT_QUEUE');
DELETE FROM storage.objects WHERE name = '{VERIFY}';
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_REVISIT_FINISH');
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 0,'REVIEW_TEST_REPEAT_DRAIN');
SELECT public.check_test(public.read_review_media_commit('{DELETE}','{REVIEW}','delete') = 'REVIEW_COMMITTED','REVIEW_TEST_DELETE_READBACK');
SELECT public.check_test(public.mutate_review_with_media('{DELETE}','{REVIEW}','delete',(SELECT updated_at FROM public.fixture_delete_revision)) = 'REVIEW_COMMITTED','REVIEW_TEST_DELETE_IDEMPOTENT');
SELECT public.check_test(public.read_review_media_commit('{DELETE}','{REVIEW}','edit') = 'REVIEW_NOT_CONFIRMED','REVIEW_TEST_WRONG_KIND');
SET request.jwt.claim.sub = '{OTHER}';
SELECT public.check_test(public.read_review_media_commit('{DELETE}','{REVIEW}','delete') = 'REVIEW_NOT_CONFIRMED','REVIEW_TEST_RECEIPT_OWNER');
SELECT public.check_test(public.queue_review_upload_cleanup('{REVIEW}',ARRAY['{NEW}']) = 'REVIEW_INVALID','REVIEW_TEST_COMPENSATION_OWNER');
""")

    def test_global_legacy_reference_protection(self):
        self.sql(f"""
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',
 (SELECT updated_at FROM public.fixture_revision),'Updated fixture review content.',ARRAY['한식'],ARRAY['{NEW}']) = 'REVIEW_COMMITTED','REVIEW_TEST_SHARED_EDIT');
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 0,'REVIEW_TEST_SHARED_REF_BLOCKS_RETIREMENT');
DELETE FROM storage.objects WHERE name = '{OLD}';
SELECT public.check_test(EXISTS(SELECT 1 FROM storage.objects WHERE name = '{OLD}'),'REVIEW_TEST_SHARED_REF_PROTECTS_OBJECT');
SELECT public.check_test(public.finish_review_media_cleanup() = 1,'REVIEW_TEST_SHARED_REF_RETRY');
SET request.jwt.claim.sub = '{OTHER}';
DELETE FROM public.reviews WHERE id = '88888888-8888-4888-8888-888888888888';
SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 1,'REVIEW_TEST_SHARED_REF_RELEASED');
DELETE FROM storage.objects WHERE name = '{OLD}';
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_SHARED_REF_FINISH');
DO $$ BEGIN
 BEGIN UPDATE public.reviews SET food_photos = ARRAY['{VERIFY}'] WHERE id = '{REVIEW}';
   RAISE EXCEPTION 'REVIEW_TEST_PURPOSE_MIX_ALLOWED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
""")

    def test_authoritative_legacy_edit_and_cleanup(self):
        food = f'{OWNER}/1720000000000_food_0_old.webp'
        verification = f'{OWNER}/1720000000000_verification_proof.webp'
        self.sql(f"""
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test(public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',
 (SELECT updated_at FROM public.fixture_revision),'Updated historical review text.',ARRAY['한식'],ARRAY['{food}']) = 'REVIEW_COMMITTED','REVIEW_TEST_LEGACY_TEXT_EDIT');
SELECT public.check_test((SELECT food_photos = ARRAY['{food}'] FROM public.reviews WHERE id = '{REVIEW}'),'REVIEW_TEST_LEGACY_PHOTO_PRESERVED');
SELECT public.check_test(public.mutate_review_with_media('{DELETE}','{REVIEW}','delete',
 (SELECT updated_at FROM public.reviews WHERE id = '{REVIEW}')) = 'REVIEW_COMMITTED','REVIEW_TEST_LEGACY_DELETE');
SELECT public.check_test((SELECT count(*) FROM public.pending_review_media_cleanup()) = 2,'REVIEW_TEST_LEGACY_AUTHORITATIVE_QUEUE');
DELETE FROM storage.objects WHERE name IN ('{food}','{verification}');
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_LEGACY_MEDIA_REMOVED');
""")

    def test_private_verification_access_and_cleanup(self):
        self.sql(PRIVATE_MIGRATION.read_text())
        self.sql(f"""
UPDATE storage.objects SET bucket_id = 'review-verifications' WHERE name = '{VERIFY}';
SET ROLE anon;
SELECT public.check_test((SELECT count(*) FROM storage.objects WHERE bucket_id = 'review-verifications') = 0,'REVIEW_TEST_ANON_PRIVATE_READ');
RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '{OTHER}';
SELECT public.check_test((SELECT count(*) FROM storage.objects WHERE bucket_id = 'review-verifications') = 0,'REVIEW_TEST_OTHER_PRIVATE_READ');
DELETE FROM storage.objects WHERE bucket_id = 'review-verifications';
SET request.jwt.claim.sub = '{OWNER}';
SELECT public.check_test((SELECT count(*) FROM storage.objects WHERE bucket_id = 'review-verifications') = 1,'REVIEW_TEST_OWNER_PRIVATE_READ');
DO $$ BEGIN
 BEGIN INSERT INTO storage.objects VALUES ('review-photos','{OTHER}/reviews/{REVIEW}/food/foreign.webp');
   RAISE EXCEPTION 'REVIEW_TEST_FOREIGN_FOOD_UPLOAD';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects VALUES ('review-photos','{BASE}/verification/unsafe.webp');
   RAISE EXCEPTION 'REVIEW_TEST_PUBLIC_VERIFICATION_UPLOAD';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO storage.objects VALUES ('review-verifications','{BASE}/verification/new-proof.webp');
SELECT public.check_test(public.mutate_review_with_media('{DELETE}','{REVIEW}','delete',
 (SELECT updated_at FROM public.fixture_revision)) = 'REVIEW_COMMITTED','REVIEW_TEST_PRIVATE_DELETE');
DELETE FROM storage.objects WHERE bucket_id = 'review-verifications' AND name = '{VERIFY}';
SELECT public.check_test(public.finish_review_media_cleanup() = 1,'REVIEW_TEST_FOOD_STILL_PENDING');
DELETE FROM storage.objects WHERE name = '{OLD}';
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_PRIVATE_CLEANUP_FINISH');
""")

    def test_existing_composer_compensation_retires_only_canonical_orphans(self):
        orphan = f'{BASE}/food/abandoned.webp'
        legacy = f'{OWNER}/1720000000000_food_0_legacy.webp'
        self.sql(f"""
INSERT INTO storage.objects VALUES ('review-photos','{orphan}'),('review-photos','{legacy}');
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
DELETE FROM storage.objects WHERE name IN ('{orphan}','{legacy}','{OLD}','{VERIFY}');
SELECT public.check_test(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name = '{orphan}'),'REVIEW_TEST_ORPHAN_COMPENSATION');
SELECT public.check_test(EXISTS(SELECT 1 FROM storage.objects WHERE name = '{legacy}'),'REVIEW_TEST_LEGACY_DISPLAY_ONLY');
SELECT public.check_test(EXISTS(SELECT 1 FROM storage.objects WHERE name = '{OLD}'),'REVIEW_TEST_COMPENSATION_LIVE_FOOD');
SELECT public.check_test(EXISTS(SELECT 1 FROM storage.objects WHERE name = '{VERIFY}'),'REVIEW_TEST_COMPENSATION_LIVE_VERIFICATION');
DO $$ BEGIN
 BEGIN UPDATE public.reviews SET food_photos = ARRAY['{orphan}'] WHERE id = '{REVIEW}';
   RAISE EXCEPTION 'REVIEW_TEST_DELAYED_UPLOAD_REFERENCE';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT public.check_test(public.finish_review_media_cleanup() = 0,'REVIEW_TEST_COMPENSATION_READBACK');
""")

    def test_concurrent_reattach_waits_for_retirement(self):
        retire = subprocess.Popen(self.psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        competing = None
        try:
            retire.stdin.write(f"""BEGIN;
SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}';
SELECT public.mutate_review_with_media('{EDIT}','{REVIEW}','edit',(SELECT updated_at FROM public.fixture_revision),
 'Updated fixture review content.',ARRAY['한식'],ARRAY['{NEW}']);
SELECT 'READY';
""")
            retire.stdin.flush()
            self.assertEqual(retire.stdout.readline().strip(), 'REVIEW_COMMITTED')
            self.assertEqual(retire.stdout.readline().strip(), 'READY')
            competing = subprocess.Popen(self.psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, text=True)
            competing.stdin.write(f"SET ROLE authenticated; SET request.jwt.claim.sub = '{OWNER}'; UPDATE public.reviews SET food_photos = ARRAY['{OLD}'] WHERE id = '{REVIEW}';\n")
            competing.stdin.close()
            # The second media writer must block while retirement is uncommitted.
            with self.assertRaises(subprocess.TimeoutExpired):
                competing.wait(timeout=0.15)
            retire.stdin.write('COMMIT;\n'); retire.stdin.close()
            retire.wait(timeout=5)
            self.assertEqual(retire.returncode, 0)
            competing.wait(timeout=5)
            self.assertNotEqual(competing.returncode, 0)
            self.assertIn('REVIEW_MEDIA_RETIRED', competing.stderr.read())
            self.sql(f"SELECT public.check_test((SELECT food_photos FROM public.reviews WHERE id = '{REVIEW}') = ARRAY['{NEW}'],'REVIEW_TEST_CONCURRENT_REFERENCE');")
        finally:
            for process in [retire, competing]:
                if process and process.poll() is None:
                    process.kill(); process.wait(timeout=5)
                if process:
                    for stream in [process.stdin, process.stdout, process.stderr]:
                        if stream and not stream.closed:
                            stream.close()


if __name__ == '__main__':
    unittest.main()
