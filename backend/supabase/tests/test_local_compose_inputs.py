import hashlib
import base64
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch


ROOT = Path(__file__).resolve().parents[3]
SUPABASE = ROOT / "backend/supabase"
SCRIPT = SUPABASE / "scripts/local-stack.py"
OVERLAY = SUPABASE / "docker-compose.local.yml"
MAIL_OVERLAY = SUPABASE / "docker-compose.mail.yml"


def _load_module():
    spec = importlib.util.spec_from_file_location("local_stack_contract_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local-stack.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_stack = _load_module()


def _service_block(source: str, service: str) -> str:
    lines = source.splitlines()
    start = next(index for index, line in enumerate(lines) if line.startswith(f"  {service}:"))
    end = next(
        (index for index in range(start + 1, len(lines)) if re.fullmatch(r"  [A-Za-z0-9_-]+:(?:.*)?", lines[index])),
        len(lines),
    )
    return "\n".join(lines[start:end])


class LocalComposeInputContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.overlay_source = OVERLAY.read_text(encoding="utf-8")
        self.mail_source = MAIL_OVERLAY.read_text(encoding="utf-8")
        self.compose_source = f"{self.overlay_source}\n{self.mail_source}"

    def _write_staged_inputs(self, state: Path) -> None:
        for source, _suffix, _destination in local_stack.STAGED_INPUT_FILES:
            path = state / "inputs" / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"fixture:{source}\n".encode("utf-8"))
            path.chmod(0o600)

    def test_overlay_pins_renderer_and_resets_base_fixed_names(self) -> None:
        self.assertIn("Docker Compose v2.39.4", self.overlay_source)
        self.assertEqual(local_stack.COMPOSE_VERSION, "v2.39.4")
        self.assertIn("name: !reset null", self.overlay_source)
        self.assertNotIn("container_name: supabase-", self.overlay_source)

        for service in local_stack.EXPECTED_SERVICES:
            block = _service_block(self.compose_source, service)
            if service in {"studio", "mail"}:
                self.assertNotIn("container_name:", block, service)
            else:
                self.assertIn("container_name: !reset null", block, service)
        self.assertIn("image: inbucket/inbucket:3.0.3", self.mail_source)
        for volume in (
            "db-data",
            "db-config",
            "db-init-migrations",
            "db-init-scripts",
            "functions",
            "kong-config",
            "pooler-config",
            "storage-data",
            "vector-config",
        ):
            self.assertIn(f'name: "${{PROJECT_NAME}}-{volume}"', self.overlay_source)

    def test_ports_and_urls_are_loopback_only(self) -> None:
        expected_bindings = (
            "127.0.0.1:${STUDIO_PORT}:3000/tcp",
            "127.0.0.1:${KONG_HTTP_PORT}:8000/tcp",
            "127.0.0.1:${KONG_HTTPS_PORT}:8443/tcp",
            "127.0.0.1:${META_PORT}:8080/tcp",
            "127.0.0.1:${ANALYTICS_PORT}:4000/tcp",
            "127.0.0.1:${POSTGRES_HOST_PORT}:5432/tcp",
            "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543/tcp",
        )
        for binding in expected_bindings:
            self.assertIn(f'"{binding}"', self.overlay_source)
        for binding in (
            "127.0.0.1:${MAIL_SMTP_PORT}:2500/tcp",
            "127.0.0.1:${MAIL_WEB_PORT}:9000/tcp",
            "127.0.0.1:${MAIL_POP3_PORT}:1100/tcp",
        ):
            self.assertIn(f'"{binding}"', self.mail_source)
        self.assertNotIn("0.0.0.0:", self.overlay_source + self.mail_source)

    def test_storage_uses_a_distinct_owner_role_key_without_restoring_service_acl(self) -> None:
        storage_block = _service_block(self.overlay_source, "storage")
        self.assertIn("SERVICE_KEY: ${STORAGE_SERVICE_KEY}", storage_block)
        self.assertIn("DB_SERVICE_ROLE: supabase_storage_admin", storage_block)
        self.assertNotIn("SERVICE_KEY: ${SERVICE_ROLE_KEY}", storage_block)
        for service in ("studio", "kong", "auth", "rest", "functions"):
            self.assertNotIn("STORAGE_SERVICE_KEY", _service_block(
                self.overlay_source, service
            ))

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            values = local_stack._env_values(
                ROOT, "tzudong-local-contract", state
            )
            self.assertEqual(
                values[local_stack.STORAGE_SERVICE_KEY_ENV],
                local_stack._jwt(
                    values["JWT_SECRET"], local_stack.STORAGE_INTERNAL_ROLE
                ),
            )
            self.assertNotEqual(
                values[local_stack.STORAGE_SERVICE_KEY_ENV],
                values["SERVICE_ROLE_KEY"],
            )
            encoded_payload = values[local_stack.STORAGE_SERVICE_KEY_ENV].split(".")[1]
            payload = json.loads(base64.urlsafe_b64decode(
                encoded_payload + "=" * (-len(encoded_payload) % 4)
            ))
            self.assertEqual(payload["role"], local_stack.STORAGE_INTERNAL_ROLE)
            local_stack._validate_env(values, "tzudong-local-contract", state)
            for key, replacement in (
                ("STORAGE_SERVICE_KEY", values["SERVICE_ROLE_KEY"]),
                ("SERVICE_ROLE_KEY", values["STORAGE_SERVICE_KEY"]),
            ):
                mutated = dict(values)
                mutated[key] = replacement
                with self.subTest(key=key):
                    with self.assertRaisesRegex(
                        local_stack.LocalStackError, "env_provenance"
                    ):
                        local_stack._validate_env(
                            mutated, "tzudong-local-contract", state
                        )

            state.mkdir(mode=0o700)
            env_path, written = local_stack._write_env(
                ROOT, "tzudong-local-contract", state
            )
            provenance_path = state / "stack.env.provenance.json"
            provenance_raw = provenance_path.read_bytes()
            provenance = json.loads(provenance_raw)
            self.assertEqual(stat.S_IMODE(env_path.stat().st_mode), 0o600)
            self.assertEqual(
                stat.S_IMODE(provenance_path.stat().st_mode), 0o600
            )
            self.assertIn("STORAGE_SERVICE_KEY", provenance["keys"])
            self.assertFalse(provenance["secret_values_included"])
            self.assertNotIn(
                written["STORAGE_SERVICE_KEY"].encode("ascii"), provenance_raw
            )

        web_runtime = (ROOT / "apps/web/scripts/local-supabase-runtime.mjs").read_text(
            encoding="utf-8"
        )
        runner = (ROOT / "apps/web/scripts/run-nightly-regression.mjs").read_text(
            encoding="utf-8"
        )
        storage_helper = (
            ROOT / "apps/web/lib/supabase/storage-server.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("'STORAGE_SERVICE_KEY',", web_runtime)
        self.assertIn(
            "SUPABASE_STORAGE_SERVER_KEY: local.values.STORAGE_SERVICE_KEY",
            web_runtime,
        )
        self.assertNotIn("NEXT_PUBLIC_SUPABASE_STORAGE", web_runtime)
        self.assertNotIn(
            "localRuntimeKeys.add('SUPABASE_STORAGE_SERVER_KEY')", runner
        )
        self.assertNotIn(
            "localRuntimeKeys.add('SUPABASE_SERVICE_ROLE_KEY')", runner
        )
        self.assertNotIn("localRuntimeKeys.add('STORAGE_SERVICE_KEY')", runner)
        self.assertIn(
            "SUPABASE_STORAGE_SERVER_KEY: environment.SUPABASE_STORAGE_SERVER_KEY",
            runner,
        )
        browser_keys = re.search(
            r"const browserEnvironmentKeys = \[([\s\S]*?)\n\];", runner
        )
        self.assertIsNotNone(browser_keys)
        self.assertNotIn("SUPABASE_STORAGE_SERVER_KEY", browser_keys.group(1))
        self.assertNotIn("STORAGE_SERVICE_KEY", browser_keys.group(1))
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", browser_keys.group(1))
        self.assertIn(
            "environment.SUPABASE_STORAGE_SERVER_KEY", storage_helper
        )
        self.assertIn("environment.SUPABASE_SERVICE_ROLE_KEY", storage_helper)
        self.assertNotIn("NEXT_PUBLIC_SUPABASE_STORAGE", storage_helper)

    def test_kong_routes_strip_supabase_prefixes(self) -> None:
        kong_source = (SUPABASE / "local-inputs" / "kong.yml").read_text(encoding="utf-8")
        self.assertNotIn("strip_path: false", kong_source)
        self.assertEqual(kong_source.count("strip_path: true"), 5)

    def test_kong_browser_cors_is_exact_local_only_and_manifest_bound(self) -> None:
        source_path = SUPABASE / "local-inputs" / "kong.yml"
        kong_source = source_path.read_text(encoding="utf-8")
        expected_sha256 = "f91e15a499ce13555ab586723bdeb94525157729179816449abfab31bf486e15"
        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), expected_sha256)
        self.assertEqual(tuple(local_stack.LOCAL_BROWSER_ORIGINS), (
            "http://127.0.0.1:8080",
            "http://localhost:8080",
            "http://127.0.0.1:18080",
            "http://localhost:18080",
        ))
        self.assertEqual(local_stack.LOCAL_CORS_TARGET_HOSTS, ("127.0.0.1", "localhost"))
        self.assertEqual(kong_source.count("      - name: cors"), 4)
        self.assertEqual(kong_source.count("          credentials: false"), 3)
        self.assertEqual(kong_source.count("          credentials: true"), 1)
        self.assertEqual(kong_source.count("          max_age: 600"), 4)
        self.assertEqual(kong_source.count("          preflight_continue: false"), 4)
        self.assertNotRegex(kong_source, r"(?m)^\s*-\s+\*\s*$")
        for origin in local_stack.LOCAL_BROWSER_ORIGINS:
            self.assertEqual(kong_source.count(f"            - {origin}"), 4)
        methods = "          methods: [ GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS ]"
        self.assertEqual(kong_source.count(methods), 2)

        auth_block = kong_source.split("  - name: auth\n", 1)[1].split(
            "  - name: rest\n", 1
        )[0]
        rest_block = kong_source.split("  - name: rest\n", 1)[1].split(
            "  - name: storage\n", 1
        )[0]
        storage_block = kong_source.split("  - name: storage\n", 1)[1].split(
            "  - name: realtime\n", 1
        )[0]
        realtime_block = kong_source.split("  - name: realtime\n", 1)[1].split(
            "  - name: functions\n", 1
        )[0]
        functions_block = kong_source.split("  - name: functions\n", 1)[1]
        self.assertIn("      - name: cors", auth_block)
        self.assertIn("      - name: cors", rest_block)
        self.assertIn("      - name: cors", storage_block)
        self.assertNotIn("      - name: cors", realtime_block)
        self.assertIn("      - name: cors", functions_block)
        self.assertIn(
            "url: http://realtime-dev.supabase-realtime:4000/socket",
            realtime_block,
        )
        realtime_overlay = _service_block(self.overlay_source, "realtime")
        self.assertIn("realtime-dev.supabase-realtime", realtime_overlay)
        self.assertEqual(
            local_stack.LOCAL_REALTIME_TENANT_HOST,
            "realtime-dev.supabase-realtime",
        )
        auth_headers = auth_block.split("          headers:\n", 1)[1].split(
            "          exposed_headers:", 1
        )[0]
        rest_headers = rest_block.split("          headers:\n", 1)[1].split(
            "          exposed_headers:", 1
        )[0]
        self.assertEqual(
            tuple(re.findall(r"(?m)^\s+- ([a-z0-9-]+)$", auth_headers)),
            local_stack.LOCAL_AUTH_CORS_HEADERS,
        )
        self.assertEqual(
            tuple(re.findall(r"(?m)^\s+- ([a-z0-9-]+)$", rest_headers)),
            local_stack.LOCAL_REST_CORS_HEADERS,
        )
        self.assertIn("          credentials: true", auth_block)
        for header in local_stack.LOCAL_AUTH_CORS_EXPOSED_HEADERS:
            self.assertIn(f"            - {header}", auth_block)
        for block in (rest_block, storage_block, functions_block):
            self.assertIn("          credentials: false", block)
        self.assertIn("          exposed_headers: [ content-range ]", rest_block)
        self.assertIn(
            "          methods: [ GET, HEAD, POST, PUT, DELETE, OPTIONS ]",
            storage_block,
        )
        self.assertIn("          methods: [ POST, OPTIONS ]", functions_block)
        for header in local_stack.LOCAL_STORAGE_CORS_HEADERS:
            self.assertIn(f"            - {header}", storage_block)
        for header in local_stack.LOCAL_FUNCTION_CORS_HEADERS:
            self.assertIn(f"            - {header}", functions_block)
        for header in local_stack.LOCAL_STORAGE_CORS_EXPOSED_HEADERS:
            self.assertIn(f"            - {header}", storage_block)
        for header in local_stack.LOCAL_FUNCTION_CORS_EXPOSED_HEADERS:
            self.assertIn(f"            - {header}", functions_block)

        manifest = json.loads(
            (SUPABASE / "local-inputs/manifest.v1.json").read_text(encoding="utf-8")
        )
        entry = next(item for item in manifest["inputs"] if item["output"] == "kong.yml")
        self.assertEqual(entry, {
            "kind": "template",
            "template": "kong.yml",
            "template_sha256": expected_sha256,
            "template_mode": "0644",
            "output": "kong.yml",
            "output_sha256": expected_sha256,
            "service": "kong",
            "destination": "/home/kong/temp.yml",
            "output_mode": "0600",
        })

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            values = local_stack._env_values(ROOT, "tzudong-local-contract", state)
            local_stack._validate_env(values, "tzudong-local-contract", state)
            self.assertEqual(values["NIGHTLY_ADMIN_EMAIL"], "nightly-ci@local.invalid")
            self.assertEqual(values["POSTGRES_PORT"], "5432")
            self.assertNotEqual(values["POSTGRES_HOST_PORT"], values["POSTGRES_PORT"])
            self.assertGreaterEqual(len(values["NIGHTLY_ADMIN_PASSWORD"]), 16)
            for key in local_stack.LOCAL_URL_KEYS:
                mutated = dict(values)
                mutated[key] = "https://example.supabase.co"
                with self.subTest(key=key):
                    with self.assertRaisesRegex(local_stack.LocalStackError, "non_loopback_url"):
                        local_stack._validate_env(mutated, "tzudong-local-contract", state)

    def test_reset_legacy_env_admission_is_exact_and_regenerates_without_secret_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir(mode=0o700)
            values = local_stack._env_values(ROOT, "tzudong-local-contract", state)
            values.update({
                "SITE_URL": "http://127.0.0.1:3000",
                "ADDITIONAL_REDIRECT_URLS": "http://127.0.0.1:3000",
                "NIGHTLY_LOCAL_ENV_ONLY": "1",
                "NIGHTLY_ENV_FILE_ONLY": "1",
                "NODE_ENV": "test",
            })
            raw = ("\n".join(f"{key}={values[key]}" for key in sorted(values)) + "\n").encode()
            (state / "stack.env").write_bytes(raw)
            (state / "stack.env").chmod(0o600)
            provenance = {
                "schema": "local-stack-env-provenance-v1",
                "generator_version": local_stack.GENERATOR_VERSION,
                "project_name": "tzudong-local-contract",
                "env_file": "stack.env",
                "env_file_sha256": local_stack._hash_bytes(raw),
                "env_file_mode": "0600",
                "keys": sorted(values),
                "local_url_keys": list(local_stack.LOCAL_URL_KEYS),
                "secret_values_included": False,
            }
            provenance_path = state / "stack.env.provenance.json"
            provenance_path.write_text(
                json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="ascii",
            )
            provenance_path.chmod(0o600)

            local_stack._admit_legacy_env_for_reset(
                ROOT,
                "tzudong-local-contract",
                state,
            )
            mutated = dict(values)
            mutated["NODE_ENV"] = "production"
            raw = ("\n".join(f"{key}={mutated[key]}" for key in sorted(mutated)) + "\n").encode()
            (state / "stack.env").write_bytes(raw)
            provenance["env_file_sha256"] = local_stack._hash_bytes(raw)
            provenance_path.write_text(
                json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="ascii",
            )
            with self.assertRaisesRegex(local_stack.LocalStackError, "env_provenance"):
                local_stack._admit_legacy_env_for_reset(
                    ROOT,
                    "tzudong-local-contract",
                    state,
                )

    def test_reset_admits_only_the_previous_missing_localhost_18080_redirect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir(mode=0o700)
            values = local_stack._env_values(
                ROOT, "tzudong-local-contract", state
            )
            values["ADDITIONAL_REDIRECT_URLS"] = (
                local_stack.PREVIOUS_LOCAL_ADDITIONAL_REDIRECT_URLS
            )
            raw = (
                "\n".join(f"{key}={values[key]}" for key in sorted(values)) + "\n"
            ).encode("utf-8")
            env_path = state / "stack.env"
            env_path.write_bytes(raw)
            env_path.chmod(0o600)
            provenance_path = state / "stack.env.provenance.json"
            provenance_path.write_text(
                json.dumps({
                    "schema": "local-stack-env-provenance-v1",
                    "generator_version": local_stack.GENERATOR_VERSION,
                    "project_name": "tzudong-local-contract",
                    "env_file": "stack.env",
                    "env_file_sha256": local_stack._hash_bytes(raw),
                    "env_file_mode": "0600",
                    "keys": sorted(values),
                    "local_url_keys": list(local_stack.LOCAL_URL_KEYS),
                    "secret_values_included": False,
                }, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="ascii",
            )
            provenance_path.chmod(0o600)

            self.assertEqual(
                local_stack._admit_reset_env(
                    ROOT, "tzudong-local-contract", state
                ),
                env_path,
            )

            values["ADDITIONAL_REDIRECT_URLS"] += ",http://localhost:18081"
            tampered = (
                "\n".join(f"{key}={values[key]}" for key in sorted(values)) + "\n"
            ).encode("utf-8")
            env_path.write_bytes(tampered)
            env_path.chmod(0o600)
            provenance = json.loads(provenance_path.read_text(encoding="ascii"))
            provenance["env_file_sha256"] = local_stack._hash_bytes(tampered)
            provenance_path.write_text(
                json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="ascii",
            )
            provenance_path.chmod(0o600)
            with self.assertRaisesRegex(
                local_stack.LocalStackError, "env_provenance"
            ):
                local_stack._admit_reset_env(
                    ROOT, "tzudong-local-contract", state
                )

    def test_reset_only_admits_exact_stale_generated_input_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            self._write_staged_inputs(state)
            (state / "inputs").chmod(0o700)
            for path in (state / "inputs").rglob("*"):
                if path.is_dir():
                    path.chmod(0o700)
            records = []
            for source, _suffix, _destination in local_stack.STAGED_INPUT_FILES:
                path = state / "inputs" / source
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                record = {
                    "path": source,
                    "source": source,
                    "source_sha256": digest,
                    "source_mode": "0644",
                    "output_sha256": digest,
                    "sha256": digest,
                    "output_mode": "0600",
                    "bytes": path.stat().st_size,
                    "service": "functions" if source.startswith("functions/") else "db",
                    "destination": (
                        "/home/deno/functions"
                        if source.startswith("functions/")
                        else "/docker-entrypoint-initdb.d/migrations"
                    ),
                }
                if source in local_stack.LOCAL_INPUT_FILES:
                    record.update({"template_sha256": digest, "template_mode": "0644"})
                records.append(record)
            provenance = {
                "schema": "local-stack-input-provenance-v2",
                "generator_version": local_stack.GENERATOR_VERSION,
                "project_name": "tzudong-local-contract",
                "input_root": "inputs",
                "source_manifest": local_stack.TRACKED_INPUT_MANIFEST,
                "source_manifest_sha256": "a" * 64,
                "source_manifest_mode": "0644",
                "socket_mount": "removed",
                "functions_root": local_stack.FUNCTIONS_ROOT,
                "functions_files": list(local_stack.FUNCTIONS_FILES),
                "mount_inventory": [
                    {
                        "service": "functions",
                        "source": "local-functions",
                        "type": "volume",
                        "destination": "/home/deno/functions",
                    },
                ],
                "compose_files": [
                    {"path": path, "sha256": "b" * 64}
                    for path in (
                        "backend/supabase/docker-compose.yml",
                        "backend/supabase/docker-compose.local.yml",
                        "backend/supabase/docker-compose.mail.yml",
                    )
                ],
                "records": records,
            }
            provenance_path = state / "stack.inputs.provenance.json"
            provenance_path.write_text(
                json.dumps(provenance, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            provenance_path.chmod(0o600)

            local_stack._admit_stale_input_provenance(
                "tzudong-local-contract",
                state,
            )
            stale_main = state / "inputs/functions/main/index.ts"
            stale_main.write_bytes(b"tampered\n")
            with self.assertRaisesRegex(
                local_stack.LocalStackError,
                "reset_input_provenance",
            ):
                local_stack._admit_stale_input_provenance(
                    "tzudong-local-contract",
                    state,
                )

    def test_reset_cleanup_readback_requires_all_exact_resources_absent(self) -> None:
        project = "tzudong-local-123456789abc"
        empty = subprocess.CompletedProcess([], 0, "", "")
        with (
            patch.object(local_stack, "_run", side_effect=[empty, empty, empty]),
            patch.object(local_stack, "_docker_json_rows", return_value=[]),
        ):
            local_stack._assert_project_resources_absent(project)

        residue = subprocess.CompletedProcess([], 0, "a" * 64 + "\n", "")
        with patch.object(local_stack, "_run", side_effect=[empty, residue]):
            with self.assertRaisesRegex(
                local_stack.LocalStackError,
                "reset_cleanup_residue",
            ):
                local_stack._assert_project_resources_absent(project)
    def test_project_name_is_fixed_to_repository_identity_not_container_names(self) -> None:
        first = local_stack._project_name(ROOT)
        second = local_stack._project_name(ROOT)
        other = local_stack._project_name(ROOT / "backend")
        expected = "tzudong-local-" + hashlib.sha256(str(ROOT).encode("utf-8")).hexdigest()[:12]
        self.assertEqual(first, expected)
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertRegex(first, r"^tzudong-local-[0-9a-f]{12}$")

    def test_tracked_inputs_are_explicit_local_sources_and_destinations(self) -> None:
        for output, relative in local_stack.TRACKED_SQL.items():
            self.assertNotIn(f'"${{LOCAL_INPUT_ROOT}}/{output}:/', self.overlay_source)
            self.assertEqual(relative.split("/")[0], "volumes")
            self.assertNotIn("${HOME}", self.overlay_source)
            self.assertNotIn("/var/run/docker.sock", self.overlay_source)

        for destination in local_stack.DESTINATIONS:
            self.assertIsInstance(destination, str)
            self.assertTrue(destination.startswith("/"))
        self.assertIn(
            '"local-db-init-migrations:/docker-entrypoint-initdb.d/migrations:ro"',
            self.overlay_source,
        )
        self.assertIn(
            '"local-db-init-scripts:/docker-entrypoint-initdb.d/init-scripts:ro"',
            self.overlay_source,
        )
        self.assertIn('"local-functions:/home/deno/functions:ro"', self.overlay_source)
        self.assertIn('"local-kong-config:/home/kong:ro"', self.overlay_source)
        self.assertIn('"local-vector-config:/etc/vector:ro"', self.overlay_source)
        self.assertIn('"local-pooler-config:/etc/pooler:ro"', self.overlay_source)
        self.assertNotIn(":Z", self.overlay_source)
        self.assertIn('entrypoint: ["/app/limits.sh"]', self.overlay_source)
        kong_block = _service_block(self.overlay_source, "kong")
        self.assertIn('entrypoint: ["/docker-entrypoint.sh"]', kong_block)
        self.assertIn('command: ["kong", "docker-start"]', kong_block)
        self.assertIn("KONG_DECLARATIVE_CONFIG: /home/kong/temp.yml", kong_block)
        self.assertNotIn("eval", kong_block)

        self.assertIn("environment: !override", self.overlay_source)
        self.assertNotIn("CLUSTER_POSTGRES", self.overlay_source)
        self.assertIn('ERL_AFLAGS: ""', self.overlay_source)
        self.assertIn('RLIMIT_NOFILE: ""', self.overlay_source)

    def test_compose_command_uses_project_env_and_all_three_local_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "stack.env"
            command = local_stack._compose(
                "nightly-ci",
                env,
                (SUPABASE / "docker-compose.yml", OVERLAY, MAIL_OVERLAY),
                "config",
            )
        self.assertEqual(command[:5], ["docker", "compose", "--project-name", "nightly-ci", "--env-file"])
        self.assertEqual(command[-1], "config")
        self.assertEqual(command[6:8], ["-f", str(SUPABASE / "docker-compose.yml")])
        self.assertIn(str(OVERLAY), command)
        self.assertIn(str(MAIL_OVERLAY), command)

    def test_published_kong_https_probe_is_exact_loopback_and_no_redirect(self) -> None:
        class Response:
            status = 200

            def geturl(self) -> str:
                return "https://127.0.0.1:18443/auth/v1/health"
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Opener:
            def __init__(self) -> None:
                self.calls: list[tuple[str, int]] = []

            def open(self, request, *, timeout: int):
                self.calls.append((request.full_url, timeout))
                return Response()

        opener = Opener()
        with patch.object(local_stack, "_LOCAL_HTTPS_NO_REDIRECT_OPENER", opener):
            self.assertTrue(local_stack._probe_host_https(18443, "/auth/v1/health", timeout=2))
        self.assertEqual(opener.calls, [("https://127.0.0.1:18443/auth/v1/health", 2)])
        self.assertEqual(
            local_stack._probe_response_evidence(
                Response(),
                "https://127.0.0.1:18443/auth/v1/health",
            ),
            (200, "2xx", True),
        )

        class RedirectResponse(Response):
            status = 302

        class RedirectOpener(Opener):
            def open(self, request, *, timeout: int):
                self.calls.append((request.full_url, timeout))
                return RedirectResponse()

        redirect_opener = RedirectOpener()
        with patch.object(local_stack, "_LOCAL_HTTPS_NO_REDIRECT_OPENER", redirect_opener):
            self.assertFalse(local_stack._probe_host_https(18443, "/auth/v1/health", timeout=2))

    def test_cors_preflight_probe_requires_exact_headers_origin_and_denial(self) -> None:
        class Response:
            status = 200

            def __init__(self, url: str, headers: dict[str, str]):
                self.url = url
                self.headers = headers

            def geturl(self) -> str:
                return self.url

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Opener:
            def __init__(self, response: Response):
                self.response = response
                self.request = None

            def open(self, request, *, timeout: int):
                self.request = request
                self.timeout = timeout
                return self.response

        origin = local_stack.LOCAL_BROWSER_ORIGINS[0]
        expected_url = "http://localhost:18000/auth/v1/token?grant_type=password"
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": ",".join(local_stack.LOCAL_CORS_METHODS),
            "Access-Control-Allow-Headers": ",".join(local_stack.LOCAL_AUTH_CORS_HEADERS),
            "Access-Control-Max-Age": local_stack.LOCAL_CORS_MAX_AGE,
            "Vary": "Origin",
        }
        opener = Opener(Response(expected_url, headers))
        with patch.object(local_stack, "_NO_REDIRECT_OPENER", opener):
            self.assertTrue(local_stack._probe_local_cors_preflight(
                18000,
                "/auth/v1/token?grant_type=password",
                target_host="localhost",
                origin=origin,
                request_method="POST",
                request_headers=local_stack.LOCAL_AUTH_CORS_HEADERS,
                expected_methods=local_stack.LOCAL_CORS_METHODS,
                expected_credentials=False,
                expected_allowed=True,
                timeout=2,
            ))
        self.assertEqual(opener.request.method, "OPTIONS")
        self.assertEqual(opener.request.full_url, expected_url)
        self.assertIsNone(opener.request.data)
        self.assertEqual(opener.timeout, 2)

        denied_headers = dict(headers)
        denied_headers.pop("Access-Control-Allow-Origin")
        denied_url = "http://127.0.0.1:18000/auth/v1/token?grant_type=password"
        with patch.object(
            local_stack,
            "_NO_REDIRECT_OPENER",
            Opener(Response(denied_url, denied_headers)),
        ):
            self.assertTrue(local_stack._probe_local_cors_preflight(
                18000,
                "/auth/v1/token?grant_type=password",
                target_host="127.0.0.1",
                origin=local_stack.LOCAL_CORS_REJECTED_ORIGIN,
                request_method="POST",
                request_headers=local_stack.LOCAL_AUTH_CORS_HEADERS,
                expected_methods=local_stack.LOCAL_CORS_METHODS,
                expected_credentials=False,
                expected_allowed=False,
            ))

        invalid_responses = (
            {**headers, "Access-Control-Allow-Origin": "*"},
            {**headers, "Access-Control-Allow-Credentials": "true"},
            {**headers, "Access-Control-Allow-Headers": headers["Access-Control-Allow-Headers"] + ",x-unbounded"},
            {**headers, "Access-Control-Allow-Methods": headers["Access-Control-Allow-Methods"] + ",TRACE"},
            {**headers, "Access-Control-Max-Age": "86400"},
        )
        for invalid in invalid_responses:
            with self.subTest(invalid=invalid):
                with patch.object(
                    local_stack,
                    "_NO_REDIRECT_OPENER",
                    Opener(Response(expected_url, invalid)),
                ):
                    self.assertFalse(local_stack._probe_local_cors_preflight(
                        18000,
                        "/auth/v1/token?grant_type=password",
                        target_host="localhost",
                        origin=origin,
                        request_method="POST",
                        request_headers=local_stack.LOCAL_AUTH_CORS_HEADERS,
                        expected_methods=local_stack.LOCAL_CORS_METHODS,
                        expected_credentials=False,
                        expected_allowed=True,
                    ))

    def test_cors_actual_response_and_service_contract_cover_auth_and_public_rest(self) -> None:
        class Response:
            status = 200

            def __init__(self, url: str, headers: dict[str, str]):
                self.url = url
                self.headers = headers

            def geturl(self) -> str:
                return self.url

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Opener:
            def __init__(self, response: Response):
                self.response = response

            def open(self, _request, *, timeout: int):
                self.timeout = timeout
                return self.response

        origin = local_stack.LOCAL_BROWSER_ORIGINS[1]
        url = "http://127.0.0.1:18000/rest/v1/"
        response = Response(url, {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Expose-Headers": "content-range",
            "Vary": "Accept-Encoding, Origin",
        })
        with patch.object(local_stack, "_NO_REDIRECT_OPENER", Opener(response)):
            self.assertTrue(local_stack._probe_local_cors_actual_response(
                18000,
                "/rest/v1/",
                target_host="127.0.0.1",
                origin=origin,
                request_method="GET",
                request_headers=None,
                request_body=None,
                expected_exposed_headers=local_stack.LOCAL_REST_CORS_EXPOSED_HEADERS,
                expected_credentials=False,
                timeout=2,
            ))
        response.headers["Access-Control-Allow-Credentials"] = "true"
        with patch.object(local_stack, "_NO_REDIRECT_OPENER", Opener(response)):
            self.assertFalse(local_stack._probe_local_cors_actual_response(
                18000,
                "/rest/v1/",
                target_host="127.0.0.1",
                origin=origin,
                request_method="GET",
                request_headers=None,
                request_body=None,
                expected_exposed_headers=local_stack.LOCAL_REST_CORS_EXPOSED_HEADERS,
                expected_credentials=False,
            ))

        preflights: list[tuple[int, str, dict]] = []
        actuals: list[tuple[int, str, dict]] = []

        def preflight(port, path, **kwargs):
            preflights.append((port, path, kwargs))
            return True

        def actual(port, path, **kwargs):
            actuals.append((port, path, kwargs))
            return True

        with (
            patch.object(local_stack, "_probe_local_cors_preflight", side_effect=preflight),
            patch.object(local_stack, "_probe_local_cors_actual_response", side_effect=actual),
        ):
            self.assertTrue(local_stack._probe_local_cors_contract(18000, "auth", timeout=3))
            self.assertTrue(local_stack._probe_local_cors_contract(18000, "rest", timeout=3))
            self.assertTrue(local_stack._probe_local_cors_contract(18000, "storage", timeout=3))
            self.assertTrue(local_stack._probe_local_cors_contract(18000, "functions", timeout=3))
            self.assertFalse(local_stack._probe_local_cors_contract(18000, "realtime", timeout=3))

        self.assertEqual(len(preflights), 56)
        self.assertEqual(len(actuals), 32)
        rest_paths = {
            path
            for _port, path, kwargs in preflights
            if kwargs["request_headers"] == local_stack.LOCAL_REST_CORS_HEADERS
        }
        self.assertEqual(rest_paths, {
            "/rest/v1/announcements?select=id&limit=1",
            "/rest/v1/ad_banners?select=id&limit=1",
        })
        self.assertEqual(
            sum(not kwargs["expected_allowed"] for _port, _path, kwargs in preflights),
            8,
        )
        function_actuals = [
            kwargs
            for _port, path, kwargs in actuals
            if path == "/functions/v1/naver-geocode"
        ]
        self.assertEqual(len(function_actuals), 8)
        for kwargs in function_actuals:
            self.assertEqual(kwargs["request_method"], "POST")
            self.assertEqual(kwargs["request_headers"], {"Content-Type": "application/json"})
            self.assertEqual(
                json.loads(kwargs["request_body"].decode("ascii")),
                local_stack.LOCAL_NAVER_READINESS_REQUEST,
            )

        with (
            patch.object(local_stack, "_probe_host_http", return_value=True),
            patch.object(local_stack, "_probe_host_https", return_value=True),
            patch.object(local_stack, "_probe_local_function_json", return_value=True),
            patch.object(local_stack, "_probe_local_cors_contract", return_value=True) as cors,
        ):
            values = {
                "KONG_HTTP_PORT": "18000",
                "KONG_HTTPS_PORT": "18443",
                "ANON_KEY": "local-test-key",
            }
            self.assertTrue(local_stack._probe_service(
                ["docker", "compose"],
                values,
                "auth",
                timeout=3,
            ))
            self.assertTrue(local_stack._probe_service(
                ["docker", "compose"],
                values,
                "rest",
                timeout=3,
            ))
            self.assertTrue(local_stack._probe_service(
                ["docker", "compose"], values, "storage", timeout=3,
            ))
            self.assertTrue(local_stack._probe_service(
                ["docker", "compose"], values, "functions", timeout=3,
            ))
        self.assertEqual(cors.call_args_list, [
            call(18000, "auth", timeout=3),
            call(18000, "rest", timeout=3),
            call(18000, "storage", timeout=3),
            call(18000, "functions", timeout=3),
        ])

    def test_cors_actual_vary_duplicate_set_and_singleton_headers(self) -> None:
        class Headers:
            def __init__(self, values: dict[str, list[str]]):
                self.values = {key.lower(): list(items) for key, items in values.items()}

            def get_all(self, name: str):
                return self.values.get(name.lower())

        class Response:
            status = 200

            def __init__(self, url: str, headers: dict[str, list[str]]):
                self.url = url
                self.headers = Headers(headers)

            def geturl(self) -> str:
                return self.url

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Opener:
            def __init__(self, response: Response):
                self.response = response

            def open(self, _request, *, timeout: int):
                self.timeout = timeout
                return self.response

        origin = local_stack.LOCAL_BROWSER_ORIGINS[0]
        url = "http://127.0.0.1:18000/auth/v1/health"
        base_headers = {
            "Access-Control-Allow-Origin": [origin],
            "Access-Control-Allow-Credentials": ["true"],
            "Access-Control-Expose-Headers": [
                ",".join(local_stack.LOCAL_AUTH_CORS_EXPOSED_HEADERS)
            ],
            "Vary": ["Origin", "origin"],
        }

        def actual(headers: dict[str, list[str]]) -> bool:
            with patch.object(
                local_stack,
                "_NO_REDIRECT_OPENER",
                Opener(Response(url, headers)),
            ):
                return local_stack._probe_local_cors_actual_response(
                    18000,
                    "/auth/v1/health",
                    target_host="127.0.0.1",
                    origin=origin,
                    request_method="GET",
                    request_headers=None,
                    request_body=None,
                    expected_exposed_headers=local_stack.LOCAL_AUTH_CORS_EXPOSED_HEADERS,
                    expected_credentials=True,
                )

        self.assertTrue(actual(base_headers))
        for vary in (["Origin", "X-Extra"], ["Origin", "*"], ["Origin", ""]):
            with self.subTest(vary=vary):
                self.assertFalse(actual({**base_headers, "Vary": vary}))
        self.assertFalse(actual({
            **base_headers,
            "Access-Control-Allow-Origin": [origin, origin],
        }))
        self.assertFalse(actual({
            **base_headers,
            "Access-Control-Allow-Credentials": ["true", "true"],
        }))

    def test_realtime_readiness_executes_join_and_self_broadcast_without_secret_argv(self) -> None:
        completed = subprocess.CompletedProcess(
            ["node", "-e", "[bounded-script]"], 0, "", ""
        )
        with patch.object(local_stack.subprocess, "run", return_value=completed) as run:
            self.assertTrue(local_stack._probe_local_realtime_websocket(
                18000,
                "local-test-anon-key",
                timeout=4,
            ))
        command = run.call_args.args[0]
        kwargs = run.call_args.kwargs
        self.assertEqual(command[:2], ["node", "-e"])
        self.assertEqual(command[2], local_stack.LOCAL_REALTIME_READINESS_SCRIPT)
        self.assertNotIn("local-test-anon-key", " ".join(command))
        self.assertNotIn("console.", local_stack.LOCAL_REALTIME_READINESS_SCRIPT)
        self.assertIn("status === 'SUBSCRIBED'", local_stack.LOCAL_REALTIME_READINESS_SCRIPT)
        self.assertIn("self: true", local_stack.LOCAL_REALTIME_READINESS_SCRIPT)
        self.assertIn("message?.payload?.marker === marker", local_stack.LOCAL_REALTIME_READINESS_SCRIPT)
        payload = json.loads(kwargs["input"])
        self.assertEqual(payload["targetHost"], "127.0.0.1")
        self.assertEqual(payload["port"], 18000)
        self.assertEqual(payload["origin"], local_stack.LOCAL_BROWSER_ORIGINS[0])
        self.assertEqual(payload["apikey"], "local-test-anon-key")
        self.assertEqual(kwargs["timeout"], 4)
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["text"])
        self.assertFalse(kwargs["check"])

        with patch.object(
            local_stack.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(command, 1, "", ""),
        ):
            self.assertFalse(local_stack._probe_local_realtime_websocket(
                18000, "local-test-anon-key", timeout=4,
            ))

        with patch.object(local_stack, "_probe_local_realtime_websocket", return_value=True) as websocket:
            self.assertTrue(local_stack._probe_service(
                ["docker", "compose"],
                {"KONG_HTTP_PORT": "18000", "ANON_KEY": "local-test-anon-key"},
                "realtime",
                timeout=3,
            ))
        websocket.assert_called_once_with(
            18000,
            "local-test-anon-key",
            timeout=6,
        )

    def test_readiness_retries_only_failed_probes_and_clears_diagnostics(self) -> None:
        ticks = iter(index / 1000 for index in range(1, 100))
        probe_results = {
            "auth": iter((True, True)),
            "realtime": iter((False, True, True)),
        }

        with (
            patch.object(local_stack.time, "monotonic", side_effect=lambda: next(ticks)),
            patch.object(local_stack.time, "sleep"),
            patch.object(local_stack, "_ps", return_value=[
                {"Service": "auth", "State": "running", "Health": "healthy"},
                {"Service": "realtime", "State": "running", "Health": "healthy"},
            ]),
            patch.object(
                local_stack,
                "_probe_service",
                side_effect=lambda _command, _values, service: next(probe_results[service]),
            ) as probe,
        ):
            services = local_stack._wait_ready(
                ["docker", "compose"],
                {},
                timeout=1,
                required=("auth", "realtime"),
            )

        self.assertEqual(
            [item["service"] for item in services if item["state"] == "running"],
            ["auth", "realtime"],
        )
        self.assertEqual(
            [item.args[2] for item in probe.call_args_list],
            ["auth", "realtime", "realtime", "auth", "realtime"],
        )
        self.assertEqual(local_stack._LAST_READINESS_DIAGNOSTICS, ())

    def test_readiness_probes_thirteen_running_services_while_studio_is_absent(self) -> None:
        rows = [
            {"Service": service, "State": "running", "Health": "healthy"}
            for service in local_stack.CORE_REQUIRED
        ]
        ticks = iter(index / 1000 for index in range(1, 200))
        with (
            patch.object(local_stack.time, "monotonic", side_effect=lambda: next(ticks)),
            patch.object(local_stack.time, "sleep"),
            patch.object(local_stack, "_ps", return_value=rows),
            patch.object(local_stack, "_probe_service", return_value=True) as probe,
        ):
            with self.assertRaises(local_stack.LocalStackError) as raised:
                local_stack._wait_ready(
                    ["docker", "compose"],
                    {},
                    timeout=0.02,
                )

        self.assertEqual(raised.exception.code, "readiness_timeout_studio")
        self.assertEqual(probe.call_count, len(local_stack.CORE_REQUIRED))
        self.assertEqual(
            [item.args[2] for item in probe.call_args_list],
            list(local_stack.CORE_REQUIRED),
        )
        self.assertEqual(
            [item["result"] for item in raised.exception.readiness],
            [
                "not_running" if item["service"] == "studio" else "ready"
                for item in raised.exception.readiness
            ],
        )

    def test_readiness_final_full_revalidation_detects_cached_service_regression(self) -> None:
        ticks = iter(index / 1000 for index in range(1, 200))
        probe_results = {
            "auth": iter((True, False, False)),
            "realtime": iter((False, True, True)),
        }
        with (
            patch.object(local_stack.time, "monotonic", side_effect=lambda: next(ticks)),
            patch.object(local_stack.time, "sleep"),
            patch.object(local_stack, "_ps", return_value=[
                {"Service": "auth", "State": "running", "Health": "healthy"},
                {"Service": "realtime", "State": "running", "Health": "healthy"},
            ]),
            patch.object(
                local_stack,
                "_probe_service",
                side_effect=lambda _command, _values, service: next(probe_results[service]),
            ) as probe,
        ):
            with self.assertRaises(local_stack.LocalStackError) as raised:
                local_stack._wait_ready(
                    ["docker", "compose"],
                    {},
                    timeout=0.014,
                    required=("auth", "realtime"),
                )

        self.assertEqual(raised.exception.code, "readiness_timeout_auth")
        self.assertEqual(
            [item.args[2] for item in probe.call_args_list],
            ["auth", "realtime", "realtime", "auth", "realtime", "auth"],
        )
        self.assertEqual(raised.exception.readiness[0]["result"], "not_ready")
        self.assertEqual(raised.exception.readiness[1]["result"], "ready")

    def test_readiness_timeout_exposes_only_bounded_allowlisted_diagnostics(self) -> None:
        ticks = iter(index / 100 for index in range(1, 100))
        with (
            patch.object(local_stack.time, "monotonic", side_effect=lambda: next(ticks)),
            patch.object(local_stack.time, "sleep"),
            patch.object(local_stack, "_ps", return_value=[
                {"Service": "auth", "State": "running", "Health": "healthy"},
                {"Service": "realtime", "State": "running", "Health": "healthy"},
            ]),
            patch.object(
                local_stack,
                "_probe_service",
                side_effect=lambda _command, _values, service: service == "auth",
            ),
        ):
            with self.assertRaises(local_stack.LocalStackError) as raised:
                local_stack._wait_ready(
                    ["docker", "compose"],
                    {},
                    timeout=0.08,
                    required=("auth", "realtime"),
                )

        self.assertEqual(raised.exception.code, "readiness_timeout_realtime")
        self.assertEqual(
            raised.exception.readiness,
            (
                {"service": "auth", "result": "ready", "duration_ms": 10},
                {"service": "realtime", "result": "not_ready", "duration_ms": 10},
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            payload = local_stack._error_receipt(
                "reset",
                "nightly-ci",
                Path(directory),
                raised.exception.code,
                readiness=raised.exception.readiness,
            )
        self.assertEqual(payload["readiness"], list(raised.exception.readiness))
        self.assertNotIn("url", json.dumps(payload))
        self.assertNotIn("header", json.dumps(payload))
        self.assertNotIn("body", json.dumps(payload))
        self.assertNotIn("diagnostic", json.dumps(payload))

    def test_readiness_error_receipt_drops_unbounded_or_unrecognized_details(self) -> None:
        invalid = ({
            "service": "auth",
            "result": "not_ready",
            "duration_ms": 1,
            "error": "provider body password=secret",
        },)
        with tempfile.TemporaryDirectory() as directory:
            payload = local_stack._error_receipt(
                "reset",
                "nightly-ci",
                Path(directory),
                "readiness_timeout_auth",
                readiness=invalid,
            )
        self.assertNotIn("readiness", payload)
        self.assertNotIn("secret", json.dumps(payload))

    def test_functions_readiness_requires_exact_main_and_local_naver_fixture(self) -> None:
        probes: list[tuple[int, str, dict]] = []

        def probe(port, path, **kwargs):
            probes.append((port, path, kwargs))
            return True

        with (
            patch.object(local_stack, "_probe_local_function_json", side_effect=probe),
            patch.object(local_stack, "_probe_local_cors_contract", return_value=True) as cors,
        ):
            self.assertTrue(
                local_stack._probe_service(
                    ["docker", "compose"],
                    {"KONG_HTTP_PORT": "18000"},
                    "functions",
                    timeout=3,
                )
            )

        self.assertEqual(
            probes,
            [
                (
                    18000,
                    "/functions/v1/main",
                    {
                        "expected_payload": local_stack.LOCAL_FUNCTION_MAIN_RESPONSE,
                        "timeout": 3,
                    },
                ),
                (
                    18000,
                    "/functions/v1/naver-geocode",
                    {
                        "request_payload": local_stack.LOCAL_NAVER_READINESS_REQUEST,
                        "expected_payload": local_stack.LOCAL_NAVER_READINESS_RESPONSE,
                        "fixture_provenance": local_stack.LOCAL_NAVER_FIXTURE_PROVENANCE,
                        "timeout": 3,
                    },
                ),
            ],
        )
        cors.assert_called_once_with(18000, "functions", timeout=3)

    def test_local_function_json_probe_checks_bounded_body_headers_and_exact_payload(self) -> None:
        class Headers(dict):
            def get(self, key, default=None):
                return super().get(key.lower(), default)

        class Response:
            status = 200

            def __init__(self, payload, *, provenance=None):
                self.payload = payload
                self.headers = Headers({
                    "content-type": "application/json; charset=utf-8",
                    "cache-control": "no-store",
                    "x-tzudong-local-fixture": provenance,
                })

            def geturl(self):
                return "http://127.0.0.1:18000/functions/v1/naver-geocode"

            def read(self, amount):
                self.read_bound = amount
                return json.dumps(
                    self.payload,
                    ensure_ascii=True,
                    separators=(",", ":"),
                ).encode("ascii")

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        class Opener:
            def __init__(self, response):
                self.response = response
                self.request = None

            def open(self, request, *, timeout):
                self.request = request
                self.timeout = timeout
                return self.response

        response = Response(
            local_stack.LOCAL_NAVER_READINESS_RESPONSE,
            provenance=local_stack.LOCAL_NAVER_FIXTURE_PROVENANCE,
        )
        opener = Opener(response)
        with patch.object(local_stack, "_NO_REDIRECT_OPENER", opener):
            self.assertTrue(
                local_stack._probe_local_function_json(
                    18000,
                    "/functions/v1/naver-geocode",
                    request_payload=local_stack.LOCAL_NAVER_READINESS_REQUEST,
                    expected_payload=local_stack.LOCAL_NAVER_READINESS_RESPONSE,
                    fixture_provenance=local_stack.LOCAL_NAVER_FIXTURE_PROVENANCE,
                    timeout=2,
                )
            )
        self.assertEqual(opener.request.method, "POST")
        self.assertEqual(opener.timeout, 2)
        self.assertEqual(
            json.loads(opener.request.data.decode("ascii")),
            local_stack.LOCAL_NAVER_READINESS_REQUEST,
        )
        self.assertEqual(response.read_bound, local_stack.LOCAL_FUNCTION_READINESS_MAX_BYTES + 1)

        response.payload = {
            "addresses": [{**local_stack.LOCAL_NAVER_READINESS_RESPONSE["addresses"][0], "x": "0"}]
        }
        with patch.object(local_stack, "_NO_REDIRECT_OPENER", Opener(response)):
            self.assertFalse(
                local_stack._probe_local_function_json(
                    18000,
                    "/functions/v1/naver-geocode",
                    request_payload=local_stack.LOCAL_NAVER_READINESS_REQUEST,
                    expected_payload=local_stack.LOCAL_NAVER_READINESS_RESPONSE,
                    fixture_provenance=local_stack.LOCAL_NAVER_FIXTURE_PROVENANCE,
                )
            )

    def test_local_naver_fixture_is_manifest_bound_and_staged_read_only(self) -> None:
        source = SUPABASE / "local-inputs/functions/naver-geocode/index.ts"
        expected_sha256 = "6f3cef407bc0ad8ad9a85e27a914ef29aaf271ba10717a62272d4075686a8afb"
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), expected_sha256)
        self.assertIn("functions/naver-geocode/index.ts", local_stack.LOCAL_INPUT_FILES)
        self.assertIn("functions/naver-geocode/index.ts", local_stack.FUNCTIONS_FILES)
        self.assertIn(
            ("functions/naver-geocode/index.ts", "functions", "naver-geocode/index.ts"),
            local_stack.STAGED_INPUT_FILES,
        )
        manifest = json.loads(
            (SUPABASE / "local-inputs/manifest.v1.json").read_text(encoding="utf-8")
        )
        entry = next(
            item
            for item in manifest["inputs"]
            if item["output"] == "functions/naver-geocode/index.ts"
        )
        self.assertEqual(
            entry,
            {
                "kind": "template",
                "template": "functions/naver-geocode/index.ts",
                "template_sha256": expected_sha256,
                "template_mode": "0644",
                "output": "functions/naver-geocode/index.ts",
                "output_sha256": expected_sha256,
                "service": "functions",
                "destination": "/home/deno/functions",
                "output_mode": "0600",
            },
        )
        self.assertEqual(manifest["functions"]["files"], list(local_stack.FUNCTIONS_FILES))


    def test_compose_error_classification_is_fixed_and_redacted(self) -> None:
        cases = (
            ("toomanyrequests: rate limit", "image_rate_limited"),
            ("manifest unknown", "image_unavailable"),
            ("no space left on device", "disk_full"),
            ("address already in use", "port_conflict"),
            ("operation not permitted", "permission_denied"),
            ("temporary failure in name resolution", "network_unavailable"),
            ("opaque provider diagnostic password=secret", "unknown"),
        )
        for stderr, expected in cases:
            with self.subTest(stderr=stderr):
                suffix = local_stack._compose_error_suffix(stderr)
                self.assertEqual(suffix, expected)
                self.assertNotIn("password", suffix)
                self.assertNotIn("secret", suffix)

    def test_run_retries_timeouts_and_preserves_the_stage_identity(self) -> None:
        timeout = subprocess.TimeoutExpired(["docker", "compose", "start", "db"], 180)
        with (
            patch.object(local_stack.subprocess, "run", side_effect=[timeout, timeout, timeout]) as run,
            patch.object(local_stack.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(
                local_stack.LocalStackError,
                "compose_core_start_db_timeout",
            ):
                local_stack._run(
                    ["docker", "compose", "start", "db"],
                    timeout=180,
                    error_code="compose_core_start_db",
                    retries=2,
                )
        self.assertEqual(run.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(10), call(10)])

    def test_core_start_uses_dependency_tiers_and_health_readback(self) -> None:
        starts: list[str] = []
        waits: list[tuple[tuple[str, ...] | None, int]] = []

        def run(command, **kwargs):
            starts.append(command[-1])
            self.assertEqual(kwargs["retries"], 2)
            return subprocess.CompletedProcess(command, 0, "", "")

        def wait_ready(_command, _values, *, timeout=600, required=None):
            waits.append((required, timeout))
            return []

        with (
            patch.object(local_stack, "_run", side_effect=run),
            patch.object(local_stack, "_wait_ready", side_effect=wait_ready),
        ):
            local_stack._start_core_services(["docker", "compose"], {})

        self.assertEqual(
            starts,
            [
                "vector", "db", "analytics", "imgproxy", "auth", "functions",
                "kong", "mail", "meta", "realtime", "rest", "storage", "supavisor",
            ],
        )
        self.assertEqual(
            waits,
            [(("vector",), 300), (("db",), 900), (("analytics",), 300)],
        )

    def test_staging_clears_volumes_preserves_image_defaults_and_reads_back_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            self._write_staged_inputs(state)
            commands: list[list[str]] = []
            helper_discoveries = 0

            def run(command, **_kwargs):
                nonlocal helper_discoveries
                commands.append(command)
                if command[:2] == ["docker", "create"]:
                    return subprocess.CompletedProcess(command, 0, "a" * 64 + "\n", "")
                if command[:2] == ["docker", "wait"]:
                    return subprocess.CompletedProcess(command, 0, "0\n", "")
                if command[:3] == ["docker", "ps", "-aq"]:
                    helper_discoveries += 1
                    return subprocess.CompletedProcess(
                        command,
                        0,
                        "a" * 64 + "\n" if helper_discoveries == 1 else "",
                        "",
                    )
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch.object(local_stack, "_run", side_effect=run):
                local_stack._stage_input_files("tzudong-local-123456789abc", state)

        create = next(command for command in commands if command[:2] == ["docker", "create"])
        script = create[-1]
        self.assertIn("find /scripts -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +", script)
        self.assertIn("cp -a /docker-entrypoint-initdb.d/init-scripts/. /scripts/", script)
        self.assertIn("cp -a /docker-entrypoint-initdb.d/migrations/. /migrations/", script)
        self.assertIn("mkdir -p /functions/main /functions/naver-geocode", script)
        self.assertIn("/inputs/functions/naver-geocode/index.ts", script)
        self.assertIn("00000000000001-auth-schema.sql", script)
        self.assertIn("65a4a55ba3248716eb4946a8677be41c94bc90eafaa22c0eb95b09908f96fa4f", script)
        self.assertIn("20211124212715_update-auth-owner.sql", script)
        self.assertIn("9698f481ad9cb159df6cefd5cc4b94f4b9db0eda475317aaa057b1e9a54409e0", script)
        self.assertEqual(len(local_stack.IMAGE_MIGRATION_SHA256), 41)
        self.assertIn("stat -c %a", script)
        self.assertIn("sha256sum", script)
        self.assertFalse(any(value.endswith(":Z") or value.endswith(",z") for value in create))
        self.assertTrue(any(value.endswith("-db-init-scripts:/scripts") for value in create))
        self.assertTrue(any(command[:3] == ["docker", "rm", "-f"] for command in commands))
        self.assertEqual(
            sum(command[:3] == ["docker", "ps", "-aq"] for command in commands),
            2,
        )

    def test_staging_helper_cleanup_residue_fails_closed(self) -> None:
        helper = "tzudong-local-123456789abc-compose-input-stage-deadbeef0000"
        results = [
            subprocess.CompletedProcess(["docker", "ps"], 0, "a" * 64 + "\n", ""),
            subprocess.CompletedProcess(["docker", "rm"], 0, "", ""),
            subprocess.CompletedProcess(["docker", "ps"], 0, "a" * 64 + "\n", ""),
        ]
        with patch.object(local_stack, "_run", side_effect=results):
            with self.assertRaisesRegex(
                local_stack.LocalStackError,
                "compose_input_stage_cleanup_residue",
            ):
                local_stack._remove_volume_helper(helper, "compose_input_stage")

    def test_staging_attempts_exact_helper_cleanup_after_create_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            self._write_staged_inputs(state)
            error = local_stack.LocalStackError("compose_input_stage_timeout")
            with (
                patch.object(local_stack, "_run", side_effect=error),
                patch.object(local_stack, "_remove_volume_helper") as cleanup,
            ):
                with self.assertRaisesRegex(
                    local_stack.LocalStackError,
                    "compose_input_stage_timeout",
                ):
                    local_stack._stage_input_files("tzudong-local-123456789abc", state)
        cleanup.assert_called_once()
        self.assertTrue(cleanup.call_args.args[0].startswith("tzudong-local-123456789abc-compose-input-stage-"))

    def test_staged_verification_script_executes_hash_mode_and_tree_readback(self) -> None:
        expected = (
            ("functions", "main/index.ts", hashlib.sha256(b"fixture\n").hexdigest()),
        )
        commands = local_stack._staged_verification_commands(
            expected,
            {"functions": "/functions"},
        )
        with tempfile.TemporaryDirectory() as directory:
            tool_root = Path(directory) / "bin"
            tool_root.mkdir()
            stat_tool = tool_root / "stat"
            stat_tool.write_text(
                "#!/bin/sh\n"
                "test \"$1\" = -c && test \"$2\" = %a || exit 2\n"
                "exec /usr/bin/stat -f %Lp \"$3\"\n",
                encoding="utf-8",
            )
            stat_tool.chmod(0o700)
            checksum_tool = tool_root / "sha256sum"
            checksum_tool.write_text(
                "#!/bin/sh\n"
                "test \"$1\" = --check && test \"$2\" = --status || exit 2\n"
                "IFS= read -r line || exit 2\n"
                "digest=${line%% *}\n"
                "path=${line#*  }\n"
                "actual=$(/usr/bin/shasum -a 256 \"$path\" | /usr/bin/cut -d ' ' -f 1)\n"
                "test \"$digest\" = \"$actual\"\n",
                encoding="utf-8",
            )
            checksum_tool.chmod(0o700)
            root = Path(directory) / "functions"
            file = root / "main" / "index.ts"
            file.parent.mkdir(parents=True)
            file.write_bytes(b"fixture\n")
            file.chmod(0o644)
            rendered = "; ".join(("set -eu", *commands)).replace("/functions", str(root))
            environment = dict(os.environ)
            environment["PATH"] = f"{tool_root}:{environment.get('PATH', '/usr/bin:/bin')}"
            subprocess.run(
                ["sh", "-c", rendered],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            file.chmod(0o600)
            failed = subprocess.run(
                ["sh", "-c", rendered],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
        self.assertNotEqual(failed.returncode, 0)

    def test_post_start_readback_runs_as_postgres_against_exact_staged_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            self._write_staged_inputs(state)
            executions: list[list[str]] = []

            def run(command, **_kwargs):
                executions.append(command)
                if command[-3:] == ["ps", "-q", "db"]:
                    return subprocess.CompletedProcess(command, 0, "b" * 64 + "\n", "")
                return subprocess.CompletedProcess(command, 0, "", "")

            with (
                patch.object(local_stack, "_execute_volume_helper") as helper,
                patch.object(local_stack, "_run", side_effect=run),
            ):
                local_stack._verify_staged_input_files(
                    "tzudong-local-123456789abc",
                    state,
                    ["docker", "compose"],
                )

        helper.assert_called_once()
        db_exec = next(command for command in executions if command[:2] == ["docker", "exec"])
        self.assertEqual(db_exec[2:4], ["--user", "postgres"])
        self.assertIn("/docker-entrypoint-initdb.d/init-scripts/00000000000001-auth-schema.sql", db_exec[-1])
        self.assertIn("stat -c %a", db_exec[-1])
        self.assertIn("sha256sum", db_exec[-1])

    def test_root_socket_requires_exact_root_owned_run_admission(self) -> None:
        run_id = "12345"
        run_attempt = "2"
        admission = f"/run/tzudong-nightly-local-admission-{run_id}-{run_attempt}"
        environment = {
            "GITHUB_ACTIONS": "true",
            "CI": "true",
            "GITHUB_REPOSITORY": "twoimo/tzudong",
            "GITHUB_RUN_ID": run_id,
            "GITHUB_RUN_ATTEMPT": run_attempt,
            local_stack.DOCKER_SOCKET_ADMISSION_ENV: admission,
        }
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0)
        expected = local_stack._docker_socket_admission_bytes(run_id, run_attempt)
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(Path, "lstat", return_value=info),
            patch.object(Path, "read_bytes", side_effect=PermissionError("0400 root-owned")) as direct_read,
            patch.object(
                local_stack.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(
                    ["/usr/bin/sudo", "-n", "--", "/bin/cat", admission],
                    0,
                    expected,
                    b"",
                ),
            ) as readback,
        ):
            self.assertTrue(
                local_stack._github_actions_root_owned_socket(
                    local_stack.DOCKER_SOCKET_DEFAULT,
                    0,
                )
            )
        direct_read.assert_not_called()
        self.assertEqual(
            readback.call_args.args[0],
            ["/usr/bin/sudo", "-n", "--", "/bin/cat", admission],
        )
        self.assertEqual(readback.call_args.kwargs["timeout"], 5)
        self.assertEqual(
            readback.call_args.kwargs["env"],
            {"PATH": "/usr/bin:/bin", "LANG": "C"},
        )
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(Path, "lstat", return_value=info),
            patch.object(
                local_stack.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(
                    ["/usr/bin/sudo", "-n", "--", "/bin/cat", admission],
                    0,
                    b"repo=attacker/repo\n",
                    b"",
                ),
            ),
        ):
            self.assertFalse(
                local_stack._github_actions_root_owned_socket(
                    local_stack.DOCKER_SOCKET_DEFAULT,
                    0,
                )
            )

    def test_local_stack_rejects_remote_contexts_and_unowned_volume_resources(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for guard in (
            "_local_docker_socket",
            "_docker_socket_candidates",
            "_assert_project_volumes",
            '"volume", "inspect"',
            ".colima/default/docker.sock",
            "/var/run/docker.sock",
            "com.docker.compose.project",
            "com.docker.compose.volume",
            "com.docker.compose.service",
        ):
            with self.subTest(guard=guard):
                self.assertIn(guard, source)
        self.assertIn('parsed.scheme != "unix"', source)
        self.assertIn("stat.S_ISLNK", source)
        self.assertIn("stat.S_ISSOCK", source)
        self.assertIn("_github_actions_root_owned_socket", source)
        self.assertIn("GITHUB_ACTIONS", source)
        self.assertIn("CI", source)
        self.assertIn("owned_by_current_user", source)
        self.assertIn('["docker", "ps", "-a"', source)
        self.assertIn("COMPOSE_START_TIMEOUT_SECONDS", source)
        self.assertIn("timeout=COMPOSE_START_TIMEOUT_SECONDS", source)
        self.assertIn("COMPOSE_START_RETRIES", source)
        self.assertIn("retries=COMPOSE_START_RETRIES", source)
        self.assertIn("COMPOSE_SERVICE_START_TIMEOUT_SECONDS", source)
        self.assertIn("COMPOSE_SERVICE_START_RETRIES", source)
        self.assertEqual(local_stack.COMPOSE_SERVICE_START_RETRIES, 2)
        self.assertIn("COMPOSE_DATABASE_BOOTSTRAP_TIMEOUT_SECONDS", source)
        self.assertIn("CORE_START_PHASES", source)
        self.assertIn('(("vector",), ("vector",))', source)
        self.assertIn('(("db",), ("db",))', source)
        self.assertIn('(("analytics",), ("analytics",))', source)
        self.assertIn("LOCAL_STACK_PRESERVE_FAILURE_STATE", source)
        self.assertIn("_probe_database_bootstrap", source)
        self.assertIn("_analytics", source)
        self.assertIn("pg_namespace", source)
        self.assertIn("STAGED_INPUT_FILES", source)
        self.assertIn("_stage_input_files", source)
        self.assertIn("compose_input_stage", source)
        self.assertIn("_verify_staged_input_files", source)
        self.assertIn("IMAGE_INIT_SCRIPT_SHA256", source)
        self.assertIn("compose_input_readback_db_runtime", source)
        self.assertIn('"create",', source)
        self.assertIn('"wait",', source)
        self.assertIn("chmod 0644", source)
        self.assertIn('"create", "--force-recreate", "--pull=missing"', source)
        self.assertIn('"up", "--no-deps", "--no-start", "--force-recreate"', source)
        self.assertIn('command + ["start", service]', source)
        self.assertIn("_COMPOSE_ERROR_MARKERS", source)
        self.assertIn("_compose_error_suffix", source)
        self.assertIn('error_code="compose_config"', source)
        self.assertIn('error_code="compose_core_create"', source)
        self.assertIn('error_code="compose_studio_create"', source)
        self.assertIn('_assert_project_volumes(command, project)', source)
        self.assertIn("TZUDONG_DOCKER_SOCKET_ADMISSION_FILE", source)
if __name__ == "__main__":
    unittest.main()
