"""Behavior and source contracts for the fixed-target G037 network probe."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "backend/supabase/scripts/g037_direct_endpoint_network_preflight.py"
SPEC = importlib.util.spec_from_file_location("g037_direct_endpoint_network_preflight", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


def address(value: str) -> tuple[int, int, int, str, tuple[str, int, int, int]]:
    return (PROBE.socket.AF_INET6, PROBE.socket.SOCK_STREAM, 6, "", (value, 5432, 0, 0))


class FakeSocket:
    def __init__(self, reachable: set[str], attempts: list[str]) -> None:
        self.reachable = reachable
        self.attempts = attempts
        self.timeout: int | None = None
        self.closed = False

    def settimeout(self, timeout: int) -> None:
        self.timeout = timeout

    def connect(self, target: tuple[object, ...]) -> None:
        host = str(target[0])
        self.attempts.append(host)
        if host not in self.reachable:
            raise OSError("not retained")

    def close(self) -> None:
        self.closed = True


class G037DirectEndpointNetworkPreflightTests(unittest.TestCase):
    def test_source_pins_target_and_bounds_without_external_input(self) -> None:
        self.assertEqual(PROBE.DIRECT_HOST, "db.aqlcofblfxdrjhhdmarw.supabase.co")
        self.assertEqual(PROBE.DIRECT_PORT, 5432)
        self.assertEqual(PROBE.MAX_ADDRESSES, 4)
        self.assertEqual(PROBE.PER_ADDRESS_TIMEOUT_SECONDS, 3)
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn('choices=("validate", "probe")', source)
        self.assertNotIn("os.environ", source)
        self.assertNotIn("subprocess", source)
        self.assertNotIn("open(", source)
        self.assertNotIn("Path(", source)

    def test_dns_failure_collapses_to_fixed_bounded_result(self) -> None:
        with patch.object(PROBE.socket, "getaddrinfo", side_effect=OSError("secret diagnostic")):
            result = PROBE.probe()
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["fixedCode"], "g037_direct_endpoint_ipv6_dns_unavailable")
        self.assertIs(result["ipv6DnsPresent"], False)
        self.assertIs(result["tcp5432Reachable"], False)
        self.assertNotIn("secret diagnostic", json.dumps(result))

    def test_probe_deduplicates_caps_and_closes_failed_connections(self) -> None:
        attempts: list[str] = []
        sockets: list[FakeSocket] = []

        def factory(*_args: object) -> FakeSocket:
            item = FakeSocket(set(), attempts)
            sockets.append(item)
            return item

        values = [address("::1"), address("::1")] + [address(f"2001:db8::{i}") for i in range(1, 7)]
        with patch.object(PROBE.socket, "getaddrinfo", return_value=values), patch.object(
            PROBE.socket, "socket", side_effect=factory
        ):
            result = PROBE.probe()
        self.assertEqual(attempts, ["::1", "2001:db8::1", "2001:db8::2", "2001:db8::3"])
        self.assertTrue(all(item.timeout == 3 and item.closed for item in sockets))
        self.assertEqual(result["fixedCode"], "g037_direct_endpoint_tcp_unreachable")

    def test_probe_stops_at_first_reachable_address(self) -> None:
        attempts: list[str] = []

        def factory(*_args: object) -> FakeSocket:
            return FakeSocket({"2001:db8::2"}, attempts)

        with patch.object(
            PROBE.socket,
            "getaddrinfo",
            return_value=[address("2001:db8::1"), address("2001:db8::2"), address("2001:db8::3")],
        ), patch.object(PROBE.socket, "socket", side_effect=factory):
            result = PROBE.probe()
        self.assertEqual(attempts, ["2001:db8::1", "2001:db8::2"])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["fixedCode"], "g037_direct_endpoint_ready")
        self.assertIs(result["ipv6DnsPresent"], True)
        self.assertIs(result["tcp5432Reachable"], True)

    def test_validate_is_network_free_and_emits_only_fixed_fields(self) -> None:
        output = io.StringIO()
        with patch.object(PROBE.socket, "getaddrinfo") as resolver, contextlib.redirect_stdout(output):
            code = PROBE.main(["validate"])
        resolver.assert_not_called()
        self.assertEqual(code, 0)
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "schema": "g037-direct-endpoint-network-preflight-v1",
                "status": "valid",
                "fixedCode": "g037_direct_endpoint_preflight_source_valid",
                "credentialUsed": False,
                "persistentStateChanged": False,
            },
        )

    def test_probe_exit_code_tracks_only_fixed_status(self) -> None:
        ready = PROBE._result(dns_present=True, reachable=True)
        blocked = PROBE._result(dns_present=True, reachable=False)
        for result, expected in ((ready, 0), (blocked, 2)):
            output = io.StringIO()
            with patch.object(PROBE, "probe", return_value=result), contextlib.redirect_stdout(output):
                code = PROBE.main(["probe"])
            self.assertEqual(code, expected)
            emitted = json.loads(output.getvalue())
            self.assertEqual(emitted, result)
            self.assertNotIn(PROBE.DIRECT_HOST, output.getvalue())
            self.assertEqual(
                set(emitted),
                {
                    "schema",
                    "status",
                    "fixedCode",
                    "ipv6DnsPresent",
                    "tcp5432Reachable",
                    "credentialUsed",
                    "databaseAuthenticationAttempted",
                    "sqlExecuted",
                    "persistentStateChanged",
                },
            )


if __name__ == "__main__":
    unittest.main()
