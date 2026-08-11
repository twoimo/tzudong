import hashlib
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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
        for volume in ("db-data", "db-config", "storage-data"):
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
    def test_kong_routes_strip_supabase_prefixes(self) -> None:
        kong_source = (SUPABASE / "local-inputs" / "kong.yml").read_text(encoding="utf-8")
        self.assertNotIn("strip_path: false", kong_source)
        self.assertEqual(kong_source.count("strip_path: true"), 5)

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
            self.assertIn(f'"${{LOCAL_INPUT_ROOT}}/{output}:/', self.overlay_source)
            self.assertEqual(relative.split("/")[0], "volumes")
            self.assertNotIn("${HOME}", self.overlay_source)
            self.assertNotIn("/var/run/docker.sock", self.overlay_source)

        for destination in local_stack.DESTINATIONS:
            self.assertIsInstance(destination, str)
            self.assertTrue(destination.startswith("/"))
        self.assertIn('"${LOCAL_INPUT_ROOT}/functions:/home/deno/functions:ro,Z"', self.overlay_source)
        self.assertIn('"${LOCAL_INPUT_ROOT}/vector.yml:/etc/vector/vector.yml:ro,z"', self.overlay_source)
        self.assertIn('"${LOCAL_INPUT_ROOT}/pooler.exs:/etc/pooler/pooler.exs:ro,z"', self.overlay_source)

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
        self.assertIn('"create", "--force-recreate", "--pull=policy"', source)
        self.assertIn('command + ["start", service]', source)
        self.assertIn("_COMPOSE_ERROR_MARKERS", source)
        self.assertIn("_compose_error_suffix", source)
        self.assertIn('error_code="compose_config"', source)
        self.assertIn('error_code="compose_core_create"', source)
        self.assertIn('error_code="compose_studio_create"', source)
        self.assertIn('_assert_project_volumes(command, project)', source)
if __name__ == "__main__":
    unittest.main()
