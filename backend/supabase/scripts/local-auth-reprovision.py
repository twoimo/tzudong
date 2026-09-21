#!/usr/bin/env python3
"""Re-provision one cloned account in the loopback Supabase Auth service.

This command is deliberately separate from the hosted-to-local clone. It never
reads a hosted Auth table, password hash, session, token, or identity payload.
The operator supplies a new local password interactively; GoTrue stores the
resulting verifier and creates the local email identity for the restored UUID.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import stat
import sys
import uuid
from pathlib import Path
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


LOOPBACK_HOSTS = frozenset(("127.0.0.1", "localhost", "::1"))
RESPONSE_LIMIT = 131_072
UUID_V4 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
ENV_KEYS = frozenset(("API_EXTERNAL_URL", "ANON_KEY", "SERVICE_ROLE_KEY"))


class LocalAuthError(RuntimeError):
    """A fixed, non-diagnostic local Auth failure."""

    def __init__(self, code: str, *, uncertain: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.uncertain = uncertain


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request: Request, *args: Any, **kwargs: Any) -> None:
        raise LocalAuthError("auth_redirect_rejected")


def _validate_local_url(value: str) -> str:
    if not isinstance(value, str) or not value or any(char in value for char in "\x00\r\n"):
        raise LocalAuthError("local_auth_url_invalid")
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise LocalAuthError("local_auth_url_invalid") from error
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOOPBACK_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.params
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise LocalAuthError("local_auth_url_invalid")
    return value.rstrip("/")


def _validate_key(value: str, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or any(char in value for char in "\x00\r\n")
        or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", value)
    ):
        raise LocalAuthError(f"{label}_missing")
    return value


def _read_local_env(path: Path) -> dict[str, str]:
    try:
        info = path.lstat()
    except OSError as error:
        raise LocalAuthError("local_env_missing") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise LocalAuthError("local_env_custody")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise LocalAuthError("local_env_invalid") from error

    values: dict[str, str] = {}
    for line in lines:
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise LocalAuthError("local_env_invalid")
        key, value = line.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise LocalAuthError("local_env_invalid")
        values[key] = value
    if not ENV_KEYS.issubset(values):
        raise LocalAuthError("local_env_invalid")
    _validate_local_url(values["API_EXTERNAL_URL"])
    _validate_key(values["ANON_KEY"], "anon_key")
    _validate_key(values["SERVICE_ROLE_KEY"], "service_role_key")
    return values


def _validate_user_id(value: str) -> str:
    if not isinstance(value, str) or not UUID_V4.fullmatch(value):
        raise LocalAuthError("user_id_invalid")
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise LocalAuthError("user_id_invalid") from error
    if parsed.version != 4 or parsed.int == 0:
        raise LocalAuthError("user_id_invalid")
    return str(parsed)


def _validate_email(value: str) -> str:
    if (
        not isinstance(value, str)
        or not 3 <= len(value) <= 320
        or any(char in value for char in "\x00\r\n\t")
        or any(char.isspace() for char in value)
        or value.count("@") != 1
        or value.startswith("@")
        or value.endswith("@")
    ):
        raise LocalAuthError("email_invalid")
    return value


def _validate_password(value: str) -> str:
    if (
        not isinstance(value, str)
        or not 8 <= len(value) <= 72
        or len(value.encode("utf-8")) > 72
        or any(char in value for char in "\x00\r\n")
    ):
        raise LocalAuthError("password_invalid")
    return value


def _normalize_email(value: str) -> str:
    """Mirror GoTrue, which stores and returns the address lowercased."""
    return value.lower()


def _emails_match(left: Any, right: str) -> bool:
    return isinstance(left, str) and _normalize_email(left) == _normalize_email(right)


def _json_body(payload: Mapping[str, Any]) -> bytes:
    try:
        return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    except (TypeError, ValueError, UnicodeError) as error:
        raise LocalAuthError("auth_request_shape") from error


def _request(
    base_url: str,
    path: str,
    api_key: str,
    *,
    method: str,
    payload: Mapping[str, Any] | None,
    operation: str,
    mutation: bool = False,
) -> dict[str, Any]:
    if not path.startswith("/"):
        raise LocalAuthError("auth_request_shape")
    body = None if payload is None else _json_body(payload)
    request = Request(
        base_url + path,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "apikey": api_key,
            "Authorization": "Bearer " + api_key,
        },
        method=method,
    )
    opener = build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=30) as response:
            status = int(response.status)
            raw = response.read(RESPONSE_LIMIT + 1)
    except LocalAuthError:
        raise
    except HTTPError as error:
        status = int(error.code)
        if mutation and status >= 500:
            raise LocalAuthError("auth_reprovision_delivery_unknown", uncertain=True) from None
        raise LocalAuthError(f"auth_{operation}_rejected") from None
    except (URLError, TimeoutError, OSError) as error:
        if mutation:
            raise LocalAuthError("auth_reprovision_delivery_unknown", uncertain=True) from error
        raise LocalAuthError(f"auth_{operation}_transport") from error
    if len(raw) > RESPONSE_LIMIT or status < 200 or status >= 300 or status != 200:
        if mutation and (status >= 500 or 200 <= status < 300):
            raise LocalAuthError("auth_reprovision_delivery_unknown", uncertain=True)
        raise LocalAuthError(f"auth_{operation}_rejected")
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        if mutation:
            raise LocalAuthError("auth_reprovision_delivery_unknown", uncertain=True) from error
        raise LocalAuthError(f"auth_{operation}_response_shape") from error
    if not isinstance(decoded, dict):
        if mutation:
            raise LocalAuthError("auth_reprovision_delivery_unknown", uncertain=True)
        raise LocalAuthError(f"auth_{operation}_response_shape")
    return decoded


def _readback_user(base_url: str, service_key: str, user_id: str) -> dict[str, Any]:
    payload = _request(
        base_url,
        f"/auth/v1/admin/users/{user_id}",
        service_key,
        method="GET",
        payload=None,
        operation="readback",
    )
    if payload.get("id") != user_id:
        raise LocalAuthError("auth_readback_shape")
    return payload


def _assert_reprovisioned_user(payload: Mapping[str, Any], user_id: str, email: str) -> None:
    if payload.get("id") != user_id or not _emails_match(payload.get("email"), email):
        raise LocalAuthError("auth_readback_mismatch")
    if not payload.get("email_confirmed_at"):
        raise LocalAuthError("auth_readback_mismatch")
    identities = payload.get("identities")
    if not isinstance(identities, list):
        raise LocalAuthError("auth_identity_missing")
    for identity in identities:
        if not isinstance(identity, dict):
            continue
        if (
            identity.get("user_id") == user_id
            and identity.get("provider") == "email"
            and isinstance(identity.get("identity_data"), dict)
            and _emails_match(identity["identity_data"].get("email"), email)
        ):
            return
    raise LocalAuthError("auth_identity_missing")


def _assert_password_login(
    base_url: str,
    anon_key: str,
    user_id: str,
    email: str,
    password: str,
) -> None:
    payload = _request(
        base_url,
        "/auth/v1/token?grant_type=password",
        anon_key,
        method="POST",
        payload={"email": email, "password": password},
        operation="login",
    )
    user = payload.get("user")
    if (
        not isinstance(user, dict)
        or user.get("id") != user_id
        or not _emails_match(user.get("email"), email)
        or not isinstance(payload.get("access_token"), str)
        or not payload.get("access_token")
        or not isinstance(payload.get("refresh_token"), str)
        or not payload.get("refresh_token")
    ):
        raise LocalAuthError("auth_login_readback_mismatch")


def reprovision(
    env: Mapping[str, str],
    *,
    user_id: str,
    email: str,
    password: str,
) -> dict[str, str]:
    """Set a new local password and email identity for one restored UUID."""
    base_url = _validate_local_url(env["API_EXTERNAL_URL"])
    service_key = _validate_key(env["SERVICE_ROLE_KEY"], "service_role_key")
    anon_key = _validate_key(env["ANON_KEY"], "anon_key")
    user_id = _validate_user_id(user_id)
    email = _validate_email(email)
    password = _validate_password(password)

    before = _readback_user(base_url, service_key, user_id)
    existing_email = before.get("email")
    if existing_email is not None and not _emails_match(existing_email, email):
        raise LocalAuthError("auth_email_conflict")

    try:
        _request(
            base_url,
            f"/auth/v1/admin/users/{user_id}",
            service_key,
            method="PUT",
            payload={"email": email, "password": password, "email_confirm": True},
            operation="update",
            mutation=True,
        )
    except LocalAuthError as error:
        if not error.uncertain:
            raise
        try:
            readback = _readback_user(base_url, service_key, user_id)
            _assert_reprovisioned_user(readback, user_id, email)
            _assert_password_login(base_url, anon_key, user_id, email, password)
        except LocalAuthError as readback_error:
            raise LocalAuthError("auth_reprovision_delivery_unknown") from readback_error
        return {"schema": "local-auth-reprovision-v1", "status": "applied"}

    readback = _readback_user(base_url, service_key, user_id)
    _assert_reprovisioned_user(readback, user_id, email)
    _assert_password_login(base_url, anon_key, user_id, email, password)
    return {"schema": "local-auth-reprovision-v1", "status": "applied"}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-local", action="store_true", help="required explicit loopback-only admission")
    parser.add_argument("--env-file", required=True, type=Path, help="generated local stack.env")
    parser.add_argument("--user-id", required=True, help="UUID of the restored local auth.users placeholder")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.allow_local:
        raise LocalAuthError("allow_local_required")
    env = _read_local_env(args.env_file)
    email = _validate_email(input("Local email identity: ").strip())
    password = _validate_password(getpass.getpass("New local password: "))
    confirmation = getpass.getpass("Confirm new local password: ")
    if password != confirmation:
        raise LocalAuthError("password_confirmation_mismatch")
    result = reprovision(env, user_id=args.user_id, email=email, password=password)
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LocalAuthError as error:
        print(f"local auth reprovision failed: {error.code}", file=sys.stderr)
        raise SystemExit(2) from None
    except (EOFError, KeyboardInterrupt):
        print("local auth reprovision failed: input_cancelled", file=sys.stderr)
        raise SystemExit(2) from None
