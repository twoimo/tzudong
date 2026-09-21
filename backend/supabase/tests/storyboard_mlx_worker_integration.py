#!/usr/bin/env python3
"""Real SQL/locking tests in a disposable, networkless container using the pinned PG image.

No DATABASE_URL, local stack, exposed port, host volume, or hosted database is used.
Auth/role/bucket tables below are minimal prerequisite fixtures, not a canonical
Supabase replay. This verifies the new migration; the operator still runs canonical replay.
Run: python3 backend/supabase/tests/storyboard_mlx_worker_integration.py -v
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import re
import subprocess
import time
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "backend/supabase/migrations/20260918021531_storyboard_mlx_worker.sql"
RESTORE_MIGRATION = ROOT / "backend/supabase/migrations/20260920021531_storyboard_historical_restore.sql"


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=True).replace("'", "''") + "'::jsonb"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def new_id():
    return str(uuid.uuid4())


def request(text="local-mlx", image="local-mlx"):
    return {"workflow": "storyboard-mlx-v1", "requestId": new_id(), "prompt": "integration fixture",
            "sceneCount": 5, "providers": {"externalAI": False,
                "text": {"id": text, "model": "installed-text" if text == "local-mlx" else ""},
                "image": {"id": image, "model": "installed-image" if image == "local-mlx" else ""}},
            "retrieval": "none", "sources": [], "imageWidth": 1024, "imageHeight": 576}


def draft():
    return {"title": "SQL fixture", "logline": "integration only", "scenes": [
        {"sceneNo": n, "title": f"Scene {n}", "durationSec": 10, "description": "fixture",
         "visualDirection": "fixture", "narration": "", "caption": "", "productionNotes": ["fixture"],
         "imagePrompt": "fixture", "sourceIds": []} for n in range(1, 6)]}


def proof(modality="text"):
    return {"providerId": "local-mlx", "model": f"installed-{modality}", "verification": "local-worker",
            "generatedAt": "2026-09-18T00:00:00.000Z", "requestId": new_id(), "responseId": None,
            "responseModel": None, "modelEvidence": "installed-catalog-and-request"}


def asset(project_id):
    asset_id = new_id()
    # Metadata fixture: image decoding and actual bytes are tested through sharp in the TS suite.
    common = {"sha256": "a" * 64, "width": 128, "height": 72, "bytes": 128}
    return {"id": asset_id, "trustPolicy": "storyboard-private-asset-v1",
            "original": {**common, "path": f"{project_id}/{asset_id}/original.png", "mime": "image/png"},
            "web": [{**common, "path": f"{project_id}/{asset_id}/web-128.webp", "mime": "image/webp"}],
            "provenance": proof("image")}


class SqlFailure(RuntimeError):
    pass


class StoryboardSqlIntegration(unittest.TestCase):
    container = ""

    @classmethod
    def setUpClass(cls):
        compose = (ROOT / "backend/supabase/docker-compose.yml").read_text()
        image = re.search(r"^\s+image: (supabase/postgres:[^\s]+)\s*$", compose, re.MULTILINE).group(1)
        subprocess.run(["docker", "image", "inspect", image], check=True, capture_output=True, timeout=10)
        cls.container = "tzudong-storyboard-sql-test-" + uuid.uuid4().hex[:12]
        cls.addClassCleanup(cls.cleanup_container)
        subprocess.run([
            "docker", "run", "--pull=never", "--rm", "-d", "--name", cls.container,
            "--network", "none", "--user", "postgres", "--tmpfs", "/tmp:rw,mode=1777",
            "--entrypoint", "sh", image, "-c",
            "initdb -D /tmp/storyboard-pg -U postgres -A trust --no-locale >/dev/null && "
            "exec postgres -D /tmp/storyboard-pg -k /tmp -c listen_addresses=''",
        ], check=True, capture_output=True, text=True, timeout=15)
        ready = False
        for _ in range(60):
            result = subprocess.run(["docker", "exec", cls.container, "pg_isready", "-h", "/tmp", "-U", "postgres"],
                                    capture_output=True, timeout=3)
            if result.returncode == 0:
                ready = True
                break
            time.sleep(0.1)
        if not ready:
            raise RuntimeError("isolated_postgres_not_ready")
        cls.sql("""
          CREATE ROLE anon NOLOGIN;
          CREATE ROLE authenticated NOLOGIN;
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
          CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
          CREATE SCHEMA auth;
          CREATE SCHEMA storage;
          CREATE SCHEMA privacy_retention;
          CREATE TABLE privacy_retention.g014_public_rpc_allowlist(
            function_schema text NOT NULL, function_name text NOT NULL, identity_arguments text NOT NULL,
            grantee name NOT NULL, source_signature text NOT NULL, UNIQUE (source_signature, grantee));
          CREATE TABLE auth.users(id uuid PRIMARY KEY);
          CREATE TABLE public.user_roles(user_id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL);
          CREATE TABLE public.user_account_status(user_id uuid PRIMARY KEY REFERENCES auth.users(id), account_status text NOT NULL);
          CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
          CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
          CREATE TABLE public.admin_storyboard_jobs(id integer PRIMARY KEY, marker text);
          INSERT INTO public.admin_storyboard_jobs VALUES (1, 'legacy-unchanged');
          INSERT INTO storage.objects(bucket_id, name) VALUES ('storyboard-private', 'probe.png');
          GRANT USAGE ON SCHEMA public, storage, privacy_retention TO anon, authenticated, service_role, privacy_workflow_owner;
          GRANT SELECT ON public.user_roles, public.user_account_status TO privacy_workflow_owner, service_role;
        """)
        cls.sql(MIGRATION.read_text())
        cls.sql(RESTORE_MIGRATION.read_text())
        print(f"Isolated database: {image}; network=none; no shared volumes", flush=True)

    @classmethod
    def cleanup_container(cls):
        if cls.container:
            subprocess.run(["docker", "rm", "-f", cls.container], capture_output=True, timeout=15)

    @classmethod
    def psql_command(cls):
        return ["docker", "exec", "-i", cls.container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
                "-h", "/tmp", "-U", "postgres", "-d", "postgres"]

    @classmethod
    def sql(cls, source, role=None):
        prefix = f"SET ROLE {role};\n" if role else ""
        result = subprocess.run(cls.psql_command(), input=prefix + source, text=True, capture_output=True, timeout=20)
        if result.returncode:
            match = re.search(r"ERROR:\s*(.+)", result.stderr)
            message = match.group(1) if match else "isolated_sql_failed"
            if "syntax error" in message:
                # Migration source only; expose the location needed to repair a parser failure.
                location = re.search(r"LINE \d+:[^\n]+", result.stderr)
                if location:
                    message += " " + location.group(0)
            raise SqlFailure(message)
        return result.stdout.strip()

    def rpc(self, name, *args):
        return json.loads(self.sql("SELECT public." + name + "(" + ",".join(sql_value(arg) for arg in args) + ");", "service_role"))

    def admin(self, owner, action, project=None, revision=None, payload=None):
        return self.rpc("storyboard_production_admin", owner, action, project, revision, payload or {})

    def worker(self, worker, action, job=None, lease=None, payload=None):
        return self.rpc("storyboard_production_worker", worker, action, job, lease, payload or {})

    def owner(self):
        owner = new_id()
        self.sql(f"INSERT INTO auth.users VALUES ('{owner}'); INSERT INTO public.user_roles VALUES ('{owner}','admin');"
                 f"INSERT INTO public.user_account_status VALUES ('{owner}','active');")
        return owner

    def provision(self, owner):
        worker = new_id()
        token_hash = hashlib.sha256(uuid.uuid4().bytes + uuid.uuid4().bytes).hexdigest()
        self.sql(f"INSERT INTO public.admin_storyboard_production_workers(id,owner_id,token_sha256) "
                 f"VALUES ('{worker}','{owner}','{token_hash}');")
        models = [{"id": f"installed-{kind}", "capabilities": [cap], "loaded": False,
                   "bytes_on_disk": 1000, "bytes_resident": 0} for kind, cap in [("text", "chat"), ("image", "image")]]
        self.worker(worker, "heartbeat", payload={"models": models})
        return worker, token_hash

    def claimed(self, req=None):
        owner = self.owner()
        worker, _ = self.provision(owner)
        created = self.admin(owner, "create", payload=req or request())
        job = self.worker(worker, "claim")["job"]
        self.assertIsNotNone(job)
        return owner, worker, created["project"]["id"], job

    def save_draft(self, worker, job):
        return self.worker(worker, "draft", job["id"], job["leaseToken"], {"draft": draft(), "provenance": proof()})

    def save_image(self, worker, project, job, scene, revision=0):
        image = asset(project)
        self.worker(worker, "image", job["id"], job["leaseToken"], {"sceneNo": scene, "sceneRevision": revision,
                    "asset": image, "provenance": image["provenance"]})
        return image

    def test_permissions_bucket_and_legacy(self):
        self.assertEqual(self.sql("SELECT marker FROM public.admin_storyboard_jobs WHERE id=1"), "legacy-unchanged")
        self.assertEqual(self.sql("SELECT public::text || ':' || file_size_limit::text FROM storage.buckets WHERE id='storyboard-private'"), "false:12582912")
        for role in ("anon", "authenticated"):
            with self.assertRaisesRegex(SqlFailure, "permission denied"):
                self.sql("SELECT * FROM public.admin_storyboard_production_workers", role)
            with self.assertRaisesRegex(SqlFailure, "permission denied"):
                self.sql("SELECT public.storyboard_production_auth_worker('" + "a" * 64 + "')", role)
            self.assertEqual(self.sql("SELECT count(*) FROM pg_proc WHERE proname LIKE 'storyboard_production_%' "
                                     f"AND has_function_privilege('{role}',oid,'execute')"), "0")

    def test_fresh_install_declares_the_storyboard_catalog_exactly_once(self):
        self.assertEqual(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public' "
                                  "AND tablename LIKE 'admin_storyboard_production_%'"), "7")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                                  "WHERE n.nspname='public' AND p.proname LIKE 'storyboard_production_%'"), "10")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_policies WHERE schemaname='public' "
                                  "AND policyname='storyboard_production_owner_access'"), "7")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                                  "WHERE n.nspname='public' AND c.relname LIKE 'admin_storyboard_production_%' "
                                  "AND c.relkind='r' AND c.relrowsecurity"), "7")
        self.assertEqual(self.sql("SELECT count(*) FROM storage.buckets WHERE id='storyboard-private'"), "1")

    def test_storyboard_bucket_is_private_and_grants_no_browser_object_policy(self):
        """The bucket is reached only through the service-role/worker path."""
        self.assertEqual(self.sql("SELECT public::text FROM storage.buckets WHERE id='storyboard-private'"), "false")
        self.assertEqual(self.sql("SELECT array_to_string(allowed_mime_types,',') FROM storage.buckets "
                                  "WHERE id='storyboard-private'"), "image/png,image/jpeg,image/webp")
        # The fixture models a real Supabase storage.objects table: RLS enabled,
        # table grants to anon/authenticated, one row for this private bucket.
        self.assertEqual(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                                  "WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity"), "1")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'"), "0")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_policies WHERE coalesce(qual,'') LIKE '%storyboard-private%' "
                                  "OR coalesce(with_check,'') LIKE '%storyboard-private%'"), "0")
        for role in ("anon", "authenticated"):
            self.assertEqual(self.sql("SELECT count(*) FROM storage.objects", role), "0")
        self.assertEqual(self.sql("SELECT count(*) FROM storage.objects", "service_role"), "1")

    def catalog_snapshot(self):
        return self.sql("""
          SELECT string_agg(line, chr(10) ORDER BY line) FROM (
            SELECT 'table '||schemaname||'.'||tablename AS line FROM pg_tables WHERE schemaname IN ('public','storage')
            UNION ALL
            SELECT 'function '||p.oid::regprocedure::text FROM pg_proc p
              JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
            UNION ALL
            SELECT 'policy '||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
              WHERE schemaname IN ('public','storage')
            UNION ALL
            SELECT 'bucket '||id||':'||public::text||':'||coalesce(file_size_limit::text,'-')
              ||':'||coalesce(array_to_string(allowed_mime_types,','),'-') FROM storage.buckets
            UNION ALL
            SELECT 'grant '||table_schema||'.'||table_name||':'||grantee||':'||privilege_type
              FROM information_schema.role_table_grants WHERE table_schema IN ('public','storage')
          ) lines
        """)

    def test_reapplying_the_unit_fails_closed_without_schema_drift(self):
        """The ledger, not the SQL, provides idempotency: a blind re-apply must abort with zero drift."""
        before = self.catalog_snapshot()
        self.assertNotEqual(before, "")
        with self.assertRaisesRegex(SqlFailure, "already exists"):
            self.sql(MIGRATION.read_text())
        self.assertEqual(self.catalog_snapshot(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM storage.buckets WHERE id='storyboard-private'"), "1")

    def test_owner_scope_credentials_revocation_and_inactive_owner(self):
        owner = self.owner()
        worker, token_hash = self.provision(owner)
        auth = self.rpc("storyboard_production_auth_worker", token_hash)
        self.assertEqual(auth["ownerId"], owner)
        self.assertNotIn("token_sha256", auth)
        other = self.owner()
        created = self.admin(other, "create", payload=request())
        self.assertIsNone(self.worker(worker, "claim")["job"])
        with self.assertRaisesRegex(SqlFailure, "project_not_found"):
            self.admin(owner, "read", created["project"]["id"])
        self.sql(f"UPDATE public.admin_storyboard_production_workers SET disabled=true WHERE id='{worker}'")
        with self.assertRaisesRegex(SqlFailure, "worker_unauthorized"):
            self.rpc("storyboard_production_auth_worker", token_hash)
        self.sql(f"UPDATE public.admin_storyboard_production_workers SET disabled=false,revoked_at=now() WHERE id='{worker}'")
        with self.assertRaisesRegex(SqlFailure, "worker_unauthorized"):
            self.worker(worker, "claim")
        self.sql(f"UPDATE public.admin_storyboard_production_workers SET revoked_at=NULL WHERE id='{worker}';"
                 f"UPDATE public.user_account_status SET account_status='suspended' WHERE user_id='{owner}'")
        with self.assertRaisesRegex(SqlFailure, "owner_forbidden"):
            self.worker(worker, "heartbeat", payload={"models": []})

    def test_claim_sequential_and_heartbeat_fencing(self):
        owner, worker, project, job = self.claimed()
        self.admin(owner, "create", payload=request())
        self.assertIsNone(self.worker(worker, "claim")["job"])
        models = self.rpc("storyboard_production_auth_worker", self.sql(
            f"SELECT token_sha256 FROM public.admin_storyboard_production_workers WHERE id='{worker}'"))["models"]
        self.assertTrue(self.worker(worker, "heartbeat", job["id"], job["leaseToken"], {"models": models})["leaseValid"])
        self.assertFalse(self.worker(worker, "heartbeat", job["id"], new_id(), {"models": models})["leaseValid"])
        other_worker, _ = self.provision(self.owner())
        self.assertFalse(self.worker(other_worker, "heartbeat", job["id"], job["leaseToken"], {"models": models})["leaseValid"])
        with self.assertRaisesRegex(SqlFailure, "worker_lease_lost"):
            self.worker(other_worker, "finish", job["id"], job["leaseToken"])
        with self.assertRaisesRegex(SqlFailure, "project_busy"):
            self.admin(owner, "edit", project, 0, {"sceneNo": 1, "scene": draft()["scenes"][0]})

    def test_expiry_backoff_attempt_cap_and_old_token(self):
        owner, worker, project, job = self.claimed()
        first_lease = job["leaseToken"]
        for attempt in (1, 2, 3):
            self.sql(f"UPDATE public.admin_storyboard_production_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id='{job['id']}'")
            with self.assertRaisesRegex(SqlFailure, "worker_lease_lost"):
                self.worker(worker, "finish", job["id"], job["leaseToken"])
            self.assertIsNone(self.worker(worker, "claim")["job"])
            if attempt < 3:
                self.assertEqual(self.sql(f"SELECT (available_at>clock_timestamp())::text FROM public.admin_storyboard_production_jobs WHERE id='{job['id']}'"), "true")
                self.sql(f"UPDATE public.admin_storyboard_production_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id='{job['id']}'")
                job = self.worker(worker, "claim")["job"]
                self.assertNotEqual(first_lease, job["leaseToken"])
                with self.assertRaisesRegex(SqlFailure, "worker_lease_lost"):
                    self.worker(worker, "finish", job["id"], first_lease)
        after = self.admin(owner, "read", project)
        self.assertEqual((after["job"]["status"], after["job"]["attempts"], after["project"]["status"]), ("failed", 3, "failed"))

    def test_cancellation_rejects_late_draft_finish_and_image(self):
        owner, worker, project, job = self.claimed()
        self.save_draft(worker, job)
        before = self.admin(owner, "read", project)
        cancelled = self.admin(owner, "cancel", project, before["project"]["revision"], {"jobId": job["id"]})
        self.assertEqual(cancelled["project"]["status"], "cancelled")
        for action, payload in [("draft", {"draft": draft(), "provenance": proof()}), ("finish", {}),
                                ("image", {"sceneNo": 1, "sceneRevision": 0, "asset": asset(project), "provenance": proof("image")})]:
            with self.assertRaisesRegex(SqlFailure, "worker_lease_lost"):
                self.worker(worker, action, job["id"], job["leaseToken"], payload)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.admin_storyboard_production_assets WHERE project_id='{project}'"), "0")

    def test_checkpoints_scene_conflicts_partial_and_regeneration_preservation(self):
        owner, worker, project, job = self.claimed()
        self.save_draft(worker, job)
        image = self.save_image(worker, project, job, 1)
        with self.assertRaisesRegex(SqlFailure, "revision_conflict"):
            self.save_image(worker, project, job, 1)
        self.worker(worker, "scene-error", job["id"], job["leaseToken"], {"sceneNo": 2, "errorCode": "model_timeout"})
        self.worker(worker, "finish", job["id"], job["leaseToken"])
        before = self.admin(owner, "read", project)
        self.assertEqual(before["project"]["status"], "partial")
        original_scenes = before["project"]["document"]["scenes"]
        operation = {"sceneNo": 1, "requestId": new_id()}
        queued = self.admin(owner, "regenerate", project, before["project"]["revision"], operation)
        replay = self.admin(owner, "regenerate", project, before["project"]["revision"], operation)
        self.assertEqual(queued, replay)
        regenerated = self.worker(worker, "claim")["job"]
        self.assertEqual(regenerated["kind"], "scene")
        with self.assertRaisesRegex(SqlFailure, "invalid_scene"):
            self.save_image(worker, project, regenerated, 3)
        self.worker(worker, "scene-error", regenerated["id"], regenerated["leaseToken"], {"sceneNo": 1, "errorCode": "model_timeout"})
        self.worker(worker, "finish", regenerated["id"], regenerated["leaseToken"], {"errorCode": "model_timeout"})
        after = self.admin(owner, "read", project)
        self.assertEqual(after["project"]["document"]["scenes"][0]["image"], image)
        self.assertEqual(after["project"]["document"]["scenes"][1:], original_scenes[1:])
        self.assertEqual(after["project"]["document"]["scenes"][0]["imageError"], "model_timeout")
        self.assertTrue(all("prompt" not in event and "payload" not in event for event in after["events"]))

    def test_restore_migration_reapply_fails_without_drift(self):
        before = self.catalog_snapshot()
        with self.assertRaisesRegex(SqlFailure, "already exists"):
            self.sql(RESTORE_MIGRATION.read_text())
        self.assertEqual(self.catalog_snapshot(), before)

    def test_parallel_duplicate_restore_commits_one_immutable_revision(self):
        owner = self.owner()
        project = self.admin(owner, "create", payload=request(text="manual", image="manual"))["project"]["id"]
        original = self.admin(owner, "import-text", project, 0,
                              {"projectId": project, "schema": "storyboard-mlx-v1", "draft": draft()})["project"]
        edited = self.admin(owner, "edit", project, original["revision"],
                            {"sceneNo": 1, "scene": {**draft()["scenes"][0], "title": "Changed"}})["project"]
        operation = {"targetRevision": original["revision"], "requestId": new_id()}
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.admin(owner, "restore", project, edited["revision"], operation), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0]["project"]["revision"], edited["revision"] + 1)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.admin_storyboard_production_restores WHERE project_id='{project}'"), "1")
        for role in ("service_role", "privacy_workflow_owner"):
            with self.assertRaisesRegex(SqlFailure, "permission denied"):
                self.sql(f"UPDATE public.admin_storyboard_production_revisions SET document=document WHERE project_id='{project}'", role)

    def test_historical_restore_idempotency_busy_and_asset_guard(self):
        owner, worker, project, job = self.claimed()
        self.save_draft(worker, job)
        for scene in range(1, 6):
            self.save_image(worker, project, job, scene)
        self.worker(worker, "finish", job["id"], job["leaseToken"])
        initial = self.admin(owner, "read", project)["project"]
        target = initial["revision"]
        versions = self.admin(owner, "versions", project, payload={"targetRevision": target})
        self.assertEqual(versions["preview"], initial["document"])
        edited_scene = {**draft()["scenes"][0], "title": "Edited title"}
        edited = self.admin(owner, "edit", project, target, {"sceneNo": 1, "scene": edited_scene})["project"]
        jobs_before = self.sql(f"SELECT count(*) FROM public.admin_storyboard_production_jobs WHERE project_id='{project}'")
        operation = {"targetRevision": target, "sceneNo": 1, "requestId": new_id()}
        restored = self.admin(owner, "restore", project, edited["revision"], operation)
        current = restored["project"]
        self.assertEqual(current["document"]["scenes"][0]["title"], initial["document"]["scenes"][0]["title"])
        self.assertEqual(current["document"]["scenes"][0]["image"], initial["document"]["scenes"][0]["image"])
        self.assertGreater(current["document"]["scenes"][0]["revision"], edited["document"]["scenes"][0]["revision"])
        self.assertEqual(current["document"]["scenes"][1:], edited["document"]["scenes"][1:])
        self.assertEqual(current["request"]["providers"], initial["request"]["providers"])
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.admin_storyboard_production_jobs WHERE project_id='{project}'"), jobs_before)
        self.assertEqual(self.admin(owner, "restore", project, edited["revision"], operation), restored)
        with self.assertRaisesRegex(SqlFailure, "request_conflict"):
            self.admin(owner, "restore", project, edited["revision"], {**operation, "sceneNo": 2})
        with self.assertRaisesRegex(SqlFailure, "revision_conflict"):
            self.admin(owner, "restore", project, edited["revision"], {**operation, "requestId": new_id()})
        self.assertEqual(self.admin(owner, "read", project)["events"][-1]["operation"], "restored")
        undo = self.admin(owner, "restore", project, current["revision"], {"targetRevision": edited["revision"], "requestId": new_id()})["project"]
        self.assertEqual(undo["document"]["scenes"][0]["title"], "Edited title")
        self.assertEqual([s["image"] for s in undo["document"]["scenes"]], [s["image"] for s in edited["document"]["scenes"]])
        with self.assertRaisesRegex(SqlFailure, "version_not_found"):
            self.admin(owner, "restore", project, undo["revision"], {"targetRevision": 0, "requestId": new_id()})
        with self.assertRaisesRegex(SqlFailure, "project_not_found"):
            self.admin(self.owner(), "restore", project, undo["revision"], {"targetRevision": target, "requestId": new_id()})
        queued = self.admin(owner, "regenerate", project, undo["revision"], {"sceneNo": 1, "requestId": new_id()})
        claimed = self.worker(worker, "claim")["job"]
        with self.assertRaisesRegex(SqlFailure, "project_busy"):
            self.admin(owner, "restore", project, queued["project"]["revision"], {"targetRevision": target, "requestId": new_id()})
        cancelled = self.admin(owner, "cancel", project, queued["project"]["revision"], {"jobId": claimed["id"]})
        image_id = initial["document"]["scenes"][0]["image"]["id"]
        self.sql(f"UPDATE public.admin_storyboard_production_assets SET metadata=jsonb_set(metadata,'{{original,sha256}}','\"{'b' * 64}\"') WHERE id='{image_id}'")
        with self.assertRaisesRegex(SqlFailure, "restore_asset_missing"):
            self.admin(owner, "restore", project, cancelled["project"]["revision"], {"targetRevision": target, "requestId": new_id()})
        self.assertEqual(self.admin(owner, "read", project)["project"]["revision"], cancelled["project"]["revision"])

    def test_all_required_images_for_ready_and_manual_mixed_modes(self):
        owner, worker, project, job = self.claimed()
        self.save_draft(worker, job)
        self.worker(worker, "finish", job["id"], job["leaseToken"])
        incomplete = self.admin(owner, "read", project)
        self.assertEqual(incomplete["project"]["status"], "failed")
        retry = self.admin(owner, "retry", project, incomplete["project"]["revision"], {"requestId": new_id()})
        job = self.worker(worker, "claim")["job"]
        self.assertEqual(job["id"], retry["job"]["id"])
        for scene in range(1, 6):
            self.save_image(worker, project, job, scene)
        self.worker(worker, "finish", job["id"], job["leaseToken"])
        self.assertEqual(self.admin(owner, "read", project)["project"]["status"], "ready")

        manual = self.admin(owner, "create", payload=request(text="manual"))
        self.assertEqual(manual["project"]["status"], "awaiting_import")
        self.assertIsNone(manual["job"])
        manual_id = manual["project"]["id"]
        imported = self.admin(owner, "import-text", manual_id, 0,
                              {"projectId": manual_id, "schema": "storyboard-mlx-v1", "draft": draft()})
        provenance = imported["project"]["document"]["textProvenance"]
        self.assertEqual((provenance["verification"], provenance["modelEvidence"]), ("user-import", "unverified"))
        self.assertEqual(imported["project"]["status"], "waiting_worker")
        self.assertIsNotNone(imported["job"])

        owner2, worker2, project2, job2 = self.claimed(request(image="manual"))
        self.save_draft(worker2, job2)
        self.assertEqual(self.admin(owner2, "read", project2)["project"]["status"], "awaiting_import")
        self.worker(worker2, "finish", job2["id"], job2["leaseToken"])
        self.assertEqual(self.admin(owner2, "read", project2)["job"]["status"], "succeeded")

    def test_uuid_owner_cas_idempotency_and_model_mismatch(self):
        owner = self.owner()
        req = request(text="manual", image="manual")
        first = self.admin(owner, "create", payload=req)
        self.assertEqual(first, self.admin(owner, "create", payload=req))
        req["prompt"] = "changed fixture"
        with self.assertRaisesRegex(SqlFailure, "request_conflict"):
            self.admin(owner, "create", payload=req)
        with self.assertRaisesRegex(SqlFailure, "revision_conflict"):
            self.admin(owner, "retry", first["project"]["id"], 99, {"requestId": new_id()})
        req = request()
        req["providers"]["externalAI"] = True
        req["providers"]["text"]["id"] = "openai-api"
        with self.assertRaisesRegex(SqlFailure, "provider_not_configured"):
            self.admin(owner, "create", payload=req)
        owner, worker, project, job = self.claimed()
        wrong_proof = proof()
        wrong_proof["model"] = "wrong-model"
        with self.assertRaisesRegex(SqlFailure, "model_identity_mismatch"):
            self.worker(worker, "draft", job["id"], job["leaseToken"], {"draft": draft(), "provenance": wrong_proof})
        self.assertIsNone(self.admin(owner, "read", project)["project"]["document"])

    def test_parallel_claims_one_project_and_skip_locked(self):
        owner = self.owner()
        worker1, _ = self.provision(owner)
        worker2, _ = self.provision(owner)
        project = self.admin(owner, "create", payload=request())["project"]["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(lambda worker: self.worker(worker, "claim"), (worker1, worker2)))
        self.assertEqual(sum(result["job"] is not None for result in claims), 1)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.admin_storyboard_production_jobs WHERE project_id='{project}' AND status='claimed'"), "1")

        owner = self.owner()
        worker, _ = self.provision(owner)
        locked = self.admin(owner, "create", payload=request())["project"]["id"]
        available = self.admin(owner, "create", payload=request())["project"]["id"]
        process = subprocess.Popen(self.psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            process.stdin.write(f"BEGIN; SELECT id FROM public.admin_storyboard_production_projects WHERE id='{locked}' FOR UPDATE; SELECT pg_sleep(2); COMMIT;\n")
            process.stdin.close()
            self.assertEqual(process.stdout.readline().strip(), locked)
            claim = self.worker(worker, "claim")["job"]
            self.assertEqual(claim["projectId"], available)
            self.assertIsNone(process.poll(), "claim should skip the locked project before its transaction ends")
            process.wait(timeout=5)
            self.assertEqual(process.returncode, 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
