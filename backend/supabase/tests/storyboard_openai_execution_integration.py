#!/usr/bin/env python3
"""Execute the storyboard OpenAI migration in one networkless, ephemeral PG 17 DB.

This is a local SQL integration test, not a canonical Supabase replay or hosted proof.
Prerequisites are deliberately minimal test-only auth/storage/registry fixtures.
Run from repo root: python3 backend/supabase/tests/storyboard_openai_execution_integration.py -v
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "backend/supabase/migrations/20261113090000_storyboard_openai_execution.sql"
IMAGE = "supabase/postgres:17.11.0.018"
DOCKER = shutil.which("docker") or "/opt/homebrew/bin/docker"


def uid():
    return str(uuid.uuid4())


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=True).replace("'", "''") + "'::jsonb"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def openai_request(text="openai-api", text_model="gpt-5.6-luna", image="openai-api",
                   image_model="gpt-image-2.6-flare", external=True):
    return {"workflow": "storyboard-gemini-v1", "requestId": uid(), "prompt": "isolated SQL fixture",
            "sceneCount": 5, "providers": {"externalAI": external,
                "text": {"id": text, "model": text_model},
                "image": {"id": image, "model": image_model}},
            "retrieval": "none", "sources": [], "imageWidth": 1024, "imageHeight": 576}


def gemini_request():
    return openai_request("gemini-api", "gemini-3.8-flash", "gemini-api", "gemini-3.1-flash-image")


def catalog(include_image=True):
    rows = [
        {"id": "gpt-5.6-luna", "owned_by": "openai-api", "capabilities": ["chat"], "loaded": False},
        {"id": "gemini-3.8-flash", "owned_by": "gemini-api", "capabilities": ["chat"], "loaded": False},
    ]
    if include_image:
        rows += [
            {"id": "gpt-image-2.6-flare", "owned_by": "openai-api", "capabilities": ["image"], "loaded": False},
            {"id": "gemini-3.1-flash-image", "owned_by": "gemini-api", "capabilities": ["image"], "loaded": False},
        ]
    return rows


def openai_only_catalog():
    return [
        {"id": "gpt-5.6-luna", "owned_by": "openai-api", "capabilities": ["chat"], "loaded": False},
        {"id": "gpt-image-2.6-flare", "owned_by": "openai-api", "capabilities": ["image"], "loaded": False},
    ]


def draft():
    return {"title": "OpenAI SQL fixture", "logline": "local only", "scenes": [
        {"sceneNo": n, "title": f"Scene {n}", "durationSec": 10, "description": "fixture",
         "visualDirection": "fixture", "narration": "", "caption": "", "productionNotes": ["fixture"],
         "imagePrompt": "fixture", "sourceIds": []} for n in range(1, 6)]}


def openai_proof(model="gpt-5.6-luna", response_model="gpt-5.6-luna", evidence="response", provider="openai-api"):
    return {"providerId": provider, "model": model, "verification": "official-api",
            "generatedAt": "2026-11-13T00:00:00.000Z", "requestId": uid(), "responseId": "resp_local_fixture",
            "responseModel": response_model, "modelEvidence": evidence}


class StoryboardOpenAISql(unittest.TestCase):
    container = ""

    @classmethod
    def setUpClass(cls):
        if not Path(DOCKER).exists() and shutil.which(DOCKER) is None:
            raise unittest.SkipTest("docker_cli_unavailable")
        subprocess.run([DOCKER, "image", "inspect", IMAGE], check=True, capture_output=True, timeout=15)
        cls.container = "tzudong-openai-test-" + uuid.uuid4().hex[:10]
        # One owned container; no port publication, shared volumes, network or external env values.
        subprocess.run([DOCKER, "run", "--pull=never", "--rm", "-d", "--name", cls.container,
            "--network", "none", "--user", "postgres", "--tmpfs", "/tmp:rw,mode=1777",
            "--entrypoint", "sh", IMAGE, "-c",
            "initdb -D /tmp/openai-pg -U postgres -A trust --no-locale >/dev/null && "
            "exec postgres -D /tmp/openai-pg -k /tmp -c listen_addresses=''"],
            check=True, capture_output=True, text=True, timeout=20)
        cls.addClassCleanup(cls.cleanup_container)
        ready = False
        for _ in range(100):
            result = subprocess.run([DOCKER, "exec", cls.container, "pg_isready", "-h", "/tmp", "-U", "postgres"],
                                    capture_output=True, timeout=3)
            if result.returncode == 0:
                ready = True
                break
            time.sleep(.1)
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
          GRANT USAGE ON SCHEMA public, storage, privacy_retention TO anon, authenticated, service_role, privacy_workflow_owner;
          GRANT SELECT ON public.user_roles, public.user_account_status TO privacy_workflow_owner, service_role;
        """)
        # Reuse the same applied storyboard foundation/history/service-role migrations used by
        # storyboard_mlx_worker_integration.py, adding the Gemini predecessor sequence required
        # by the reviewed OpenAI migration source patches.
        names = [
            "20260918021531_storyboard_mlx_worker.sql",
            "20260920021531_storyboard_historical_restore.sql",
            "20261003000812_storyboard_gemini_only.sql",
            "20261003182338_storyboard_service_role_bridge.sql",
            "20261003205335_storyboard_uncertain_lease_recovery.sql",
            "20261004023841_storyboard_claim_capability_order.sql",
            "20261013093518_storyboard_gemini_execution_v1.sql",
        ]
        for name in names:
            cls.sql((ROOT / "backend/supabase/migrations" / name).read_text())
        cls.before_meta = cls.sql(cls.metadata_query())
        print(f"isolated image={IMAGE}; digest={cls.image_digest()}; network=none; ports=none; volumes=none", flush=True)

    @classmethod
    def image_digest(cls):
        return subprocess.run([DOCKER, "image", "inspect", IMAGE, "--format", "{{.Id}}"],
                              check=True, capture_output=True, text=True, timeout=10).stdout.strip()

    @classmethod
    def cleanup_container(cls):
        if cls.container:
            subprocess.run([DOCKER, "rm", "-f", cls.container], capture_output=True, timeout=15)
            cls.container = ""

    @classmethod
    def psql_command(cls):
        return [DOCKER, "exec", "-i", cls.container, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1",
                "-h", "/tmp", "-U", "postgres", "-d", "postgres"]

    @classmethod
    def sql(cls, source, role=None):
        prefix = f"SET ROLE {role};\n" if role else ""
        result = subprocess.run(cls.psql_command(), input=prefix + source, text=True,
                                capture_output=True, timeout=30)
        if result.returncode:
            match = re.search(r"ERROR:\s*(.+)", result.stderr)
            raise SqlFailure(result.stderr.strip() or (match.group(1) if match else "isolated_sql_failed"))
        return result.stdout.strip()

    @classmethod
    def metadata_query(cls):
        return """SELECT jsonb_build_object('admin', (SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig,provolatile,proparallel)
          FROM pg_proc WHERE oid=to_regprocedure('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)')),
          'worker', (SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig,provolatile,proparallel)
          FROM pg_proc WHERE oid=to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)')),
          'model', (SELECT jsonb_build_array(proowner,proacl,prosecdef,proconfig,provolatile,proparallel)
          FROM pg_proc WHERE oid=to_regprocedure('public.storyboard_production_model_available(jsonb,text,text)')))::text"""

    @classmethod
    def rpc(cls, name, *args):
        return json.loads(cls.sql("SELECT public." + name + "(" + ",".join(sql_value(a) for a in args) + ");", "service_role"))

    @classmethod
    def admin(cls, owner, action, project=None, revision=None, payload=None):
        return cls.rpc("storyboard_production_admin", owner, action, project, revision, payload or {})

    @classmethod
    def worker(cls, worker, action, job=None, lease=None, payload=None):
        return cls.rpc("storyboard_production_worker", worker, action, job, lease, payload or {})

    @classmethod
    def create_owner_worker(cls, models=None):
        owner, worker = uid(), uid()
        token_hash = hashlib.sha256(uuid.uuid4().bytes + uuid.uuid4().bytes).hexdigest()
        cls.sql(f"INSERT INTO auth.users VALUES ('{owner}'); INSERT INTO user_roles VALUES ('{owner}','admin');"
                f"INSERT INTO user_account_status VALUES ('{owner}','active');"
                f"INSERT INTO admin_storyboard_production_workers(id,owner_id,token_sha256) VALUES ('{worker}','{owner}','{token_hash}');")
        cls.worker(worker, "heartbeat", payload={"models": models if models is not None else catalog()})
        return owner, worker

    @classmethod
    def claim_project(cls, owner, worker, req):
        created = cls.admin(owner, "create", payload=req)
        job = cls.worker(worker, "claim")["job"]
        return created, job

    def test_00_migration_applies_preserving_function_security_metadata_and_grants(self):
        # Induce guarded source drift by changing the required function owner. The migration's
        # transaction must roll back its preceding constraint replacement.
        self.sql("ALTER FUNCTION public.storyboard_production_admin(uuid,text,uuid,integer,jsonb) OWNER TO anon")
        with self.assertRaisesRegex(SqlFailure, "STORYBOARD_OPENAI_ADMIN_SOURCE_DRIFT"):
            self.sql(MIGRATION.read_text())
        self.assertEqual(self.sql("SELECT count(*) FROM pg_constraint WHERE conname='admin_storyboard_production_projects_request_workflow_check'"), "1")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_constraint WHERE conname='admin_storyboard_production_projects_request_check'"), "0")
        self.sql("ALTER FUNCTION public.storyboard_production_admin(uuid,text,uuid,integer,jsonb) OWNER TO postgres")
        self.sql(MIGRATION.read_text())
        self.assertEqual(self.sql(self.metadata_query()), self.before_meta)
        self.assertEqual(self.sql("""SELECT count(*) FROM pg_proc p WHERE p.oid IN (
          'public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)'::regprocedure,
          'public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure,
          'public.storyboard_production_model_available(jsonb,text,text)'::regprocedure)
          AND has_function_privilege('service_role',p.oid,'execute')"""), "3")
        self.assertEqual(self.sql("""SELECT count(*) FROM pg_proc p WHERE p.oid IN (
          'public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)'::regprocedure,
          'public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'::regprocedure,
          'public.storyboard_production_model_available(jsonb,text,text)'::regprocedure)
          AND (has_function_privilege('anon',p.oid,'execute') OR has_function_privilege('authenticated',p.oid,'execute'))"""), "0")

    def test_exact_openai_pairings_and_gemini_preservation(self):
        owner, worker = self.create_owner_worker()
        cases = [
            openai_request(),
            openai_request("gemini-api", "gemini-3.8-flash"),
            openai_request(image="gemini-api", image_model="gemini-3-pro-image"),
            gemini_request(),
        ]
        for req in cases:
            with self.subTest(text=req["providers"]["text"], image=req["providers"]["image"]):
                result = self.admin(owner, "create", payload=req)
                self.assertEqual(result["project"]["request"]["providers"], req["providers"])
                self.assertEqual(result["project"]["status"], "waiting_worker")
                self.assertIsNotNone(result["job"])
        for mutate in [
            lambda r: r["providers"].pop("text"),
            lambda r: r["providers"]["text"].pop("id"),
            lambda r: r["providers"]["text"].update(id=None),
            lambda r: r["providers"]["text"].pop("model"),
            lambda r: r["providers"]["text"].update(model=None),
            lambda r: r["providers"]["image"].pop("id"),
            lambda r: r["providers"]["image"].update(id=None),
            lambda r: r["providers"]["image"].pop("model"),
            lambda r: r["providers"]["image"].update(id="openai-api", model=None),
            lambda r: r["providers"].pop("externalAI"),
            lambda r: r["providers"].update(externalAI=None),
            lambda r: r["providers"].update(externalAI=False),
        ]:
            req = openai_request()
            mutate(req)
            with self.subTest(bad_request=req):
                with self.assertRaises(SqlFailure):
                    self.admin(owner, "create", payload=req)

    def test_worker_capabilities_match_requested_provider_and_model(self):
        owner, worker = self.create_owner_worker(models=catalog(include_image=False))
        request = openai_request()
        created = self.admin(owner, "create", payload=request)
        self.assertIsNotNone(created["job"])
        self.assertIsNone(self.worker(worker, "claim")["job"], "worker missing requested image capability must not claim")
        self.worker(worker, "heartbeat", payload={"models": catalog(include_image=True)})
        claimed = self.worker(worker, "claim")["job"]
        self.assertEqual(claimed["id"], created["job"]["id"])
        self.assertEqual(claimed["request"]["providers"]["text"]["id"], "openai-api")

        # An OpenAI-only worker cannot execute a mixed Gemini/OpenAI request; a worker
        # advertising both exact provider/model capabilities can claim it.
        owner2, openai_worker = self.create_owner_worker(models=openai_only_catalog())
        mixed = openai_request("gemini-api", "gemini-3.8-flash")
        mixed_created = self.admin(owner2, "create", payload=mixed)
        self.assertIsNone(self.worker(openai_worker, "claim")["job"])
        dual_worker = uid()
        token_hash = hashlib.sha256(uuid.uuid4().bytes + uuid.uuid4().bytes).hexdigest()
        self.sql(f"INSERT INTO admin_storyboard_production_workers(id,owner_id,token_sha256) VALUES ('{dual_worker}','{owner2}','{token_hash}')")
        self.worker(dual_worker, "heartbeat", payload={"models": catalog(include_image=True)})
        dual_claim = self.worker(dual_worker, "claim")["job"]
        self.assertEqual(dual_claim["id"], mixed_created["job"]["id"])
        self.assertEqual(dual_claim["request"]["providers"]["text"]["id"], "gemini-api")

    def test_openai_response_provenance_is_checked_and_image_catalog_proof_accepted(self):
        owner, worker = self.create_owner_worker()
        _, job = self.claim_project(owner, worker, openai_request())
        self.assertIsNotNone(job)
        bad_proofs = [
            openai_proof(response_model="gpt-5.6-luna-FAKE"),
            openai_proof(response_model=None),
            openai_proof(evidence="installed-catalog-and-request"),
            openai_proof(provider="gemini-api"),
        ]
        for bad in bad_proofs:
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(SqlFailure, "model_identity_mismatch"):
                    self.worker(worker, "draft", job["id"], job["leaseToken"], {"draft": draft(), "provenance": bad})
        valid = openai_proof(response_model="gpt-5.6-luna-2026-11-13")
        saved = self.worker(worker, "draft", job["id"], job["leaseToken"], {"draft": draft(), "provenance": valid})
        self.assertTrue(saved["ok"])
        project = job["projectId"]
        after = self.admin(owner, "read", project)["project"]["document"]["textProvenance"]
        self.assertEqual(after["responseModel"], valid["responseModel"])
        self.assertEqual(after["providerId"], "openai-api")
        # The same generation lease advances to the OpenAI image action after draft save.
        image_job = job
        bad_image_proof = openai_proof("gpt-image-2.6-flare", "gpt-image-2.6-flare", "response")
        bad_image_proof.update(providerId="openai-api", responseId=None)
        bad_image_asset = {"id": uid(), "trustPolicy": "storyboard-private-asset-v1", "original": {"sha256": "a"*64,
            "width": 128, "height": 72, "bytes": 128, "path": f"{project}/bad/original.png", "mime": "image/png"},
            "web": [{"sha256": "a"*64, "width": 128, "height": 72, "bytes": 128,
                     "path": f"{project}/bad/web-128.webp", "mime": "image/webp"}], "provenance": bad_image_proof}
        with self.assertRaisesRegex(SqlFailure, "model_identity_mismatch"):
            self.worker(worker, "image", image_job["id"], image_job["leaseToken"], {
                "sceneNo": 1, "sceneRevision": 0, "asset": bad_image_asset, "provenance": bad_image_proof})
        image_proof = openai_proof("gpt-image-2.6-flare", None, "installed-catalog-and-request")
        image_proof.update(providerId="openai-api", responseId=None)
        self.worker(worker, "image", image_job["id"], image_job["leaseToken"], {
            "sceneNo": 1, "sceneRevision": 0,
            "asset": {"id": uid(), "trustPolicy": "storyboard-private-asset-v1", "original": {"sha256": "a"*64,
                "width": 128, "height": 72, "bytes": 128, "path": f"{project}/image/original.png", "mime": "image/png"},
                "web": [{"sha256": "a"*64, "width": 128, "height": 72, "bytes": 128,
                         "path": f"{project}/image/web-128.webp", "mime": "image/webp"}], "provenance": image_proof},
            "provenance": image_proof})
        stored = self.admin(owner, "read", project)["project"]["document"]["scenes"][0]["image"]["provenance"]
        self.assertEqual(stored["modelEvidence"], "installed-catalog-and-request")
        self.assertIsNone(stored["responseModel"])


class SqlFailure(RuntimeError):
    pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
