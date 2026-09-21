from __future__ import annotations

import importlib.util
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import URLError


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/local-auth-reprovision.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("local_auth_reprovision_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local-auth-reprovision.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_auth = _load_module()


class _Response:
    def __init__(self, payload: dict[str, object], status: int = 200):
        self.status = status
        self._raw = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int) -> bytes:
        return self._raw


class _Opener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class LocalAuthReprovisionTests(unittest.TestCase):
    USER_ID = "11111111-1111-4111-8111-111111111111"
    EMAIL = "developer@example.test"
    PASSWORD = "local-only-password"
    ENV = {
        "API_EXTERNAL_URL": "http://127.0.0.1:8000",
        "ANON_KEY": "anon-key",
        "SERVICE_ROLE_KEY": "service-role-key",
    }

    def _user(self, *, email=None, identities=None):
        return {
            "id": self.USER_ID,
            "email": email,
            "email_confirmed_at": "2026-09-21T00:00:00Z" if email else None,
            "identities": identities or [],
        }

    def _identity(self):
        return {
            "user_id": self.USER_ID,
            "provider": "email",
            "identity_data": {"email": self.EMAIL},
        }

    def test_loopback_url_and_user_id_are_fail_closed(self):
        for value in (
            "https://127.0.0.1:8000",
            "http://example.test:8000",
            "http://127.0.0.1:8000/path",
            "http://user:pass@127.0.0.1:8000",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(local_auth.LocalAuthError, "local_auth_url_invalid"):
                    local_auth._validate_local_url(value)
        with self.assertRaisesRegex(local_auth.LocalAuthError, "user_id_invalid"):
            local_auth._validate_user_id("11111111-1111-3111-8111-111111111111")

    def test_reprovision_updates_placeholder_and_reads_back_identity_and_login(self):
        updated = self._user(email=self.EMAIL, identities=[self._identity()])
        opener = _Opener(
            [
                _Response(self._user()),
                _Response(updated),
                _Response(updated),
                _Response(
                    {
                        "user": {"id": self.USER_ID, "email": self.EMAIL},
                        "access_token": "access-token-is-never-returned",
                        "refresh_token": "refresh-token-is-never-returned",
                    }
                ),
            ]
        )
        original = local_auth.build_opener
        local_auth.build_opener = lambda _handler: opener
        try:
            result = local_auth.reprovision(
                self.ENV,
                user_id=self.USER_ID,
                email=self.EMAIL,
                password=self.PASSWORD,
            )
        finally:
            local_auth.build_opener = original

        self.assertEqual({"schema": "local-auth-reprovision-v1", "status": "applied"}, result)
        self.assertEqual([request.get_method() for request, _ in opener.requests], ["GET", "PUT", "GET", "POST"])
        update_payload = json.loads(opener.requests[1][0].data.decode("ascii"))
        self.assertEqual(
            {"email": self.EMAIL, "password": self.PASSWORD, "email_confirm": True},
            update_payload,
        )
        serialized_result = json.dumps(result)
        self.assertNotIn(self.EMAIL, serialized_result)
        self.assertNotIn(self.PASSWORD, serialized_result)
        self.assertNotIn("access-token", serialized_result)
        self.assertNotIn("refresh-token", serialized_result)

    def test_transport_error_after_update_is_read_back_without_retry(self):
        updated = self._user(email=self.EMAIL, identities=[self._identity()])
        opener = _Opener(
            [
                _Response(self._user()),
                URLError("connection reset"),
                _Response(updated),
                _Response(
                    {
                        "user": {"id": self.USER_ID, "email": self.EMAIL},
                        "access_token": "access-token",
                        "refresh_token": "refresh-token",
                    }
                ),
            ]
        )
        original = local_auth.build_opener
        local_auth.build_opener = lambda _handler: opener
        try:
            result = local_auth.reprovision(
                self.ENV,
                user_id=self.USER_ID,
                email=self.EMAIL,
                password=self.PASSWORD,
            )
        finally:
            local_auth.build_opener = original
        self.assertEqual("applied", result["status"])
        self.assertEqual(4, len(opener.requests))

    def test_env_file_must_be_owner_only_and_loopback(self):
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "stack.env"
            path.write_text(
                "API_EXTERNAL_URL=http://127.0.0.1:8000\nANON_KEY=anon-key\nSERVICE_ROLE_KEY=service-role-key\n",
                encoding="utf-8",
            )
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
            self.assertEqual(self.ENV, local_auth._read_local_env(path))
            path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
            with self.assertRaisesRegex(local_auth.LocalAuthError, "local_env_custody"):
                local_auth._read_local_env(path)


if __name__ == "__main__":
    unittest.main()
