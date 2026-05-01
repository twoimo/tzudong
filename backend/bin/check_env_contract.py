#!/usr/bin/env python3
"""Validate CI/runtime environment contracts without printing secret values."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from typing import Dict, Iterable, List, Optional


PROFILES = {
    "daily": {
        "required": [
            "YOUTUBE_API_KEY_BYEON",
            "GEMINI_API_KEY",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "NAVER_CLIENT_ID_BYEON",
            "NAVER_CLIENT_SECRET_BYEON",
            "NCP_MAPS_KEY_ID_BYEON",
            "NCP_MAPS_KEY_BYEON",
            "RCLONE_CONFIG_BASE64",
        ],
        "optional": [
            "YOUTUBE_COOKIES_TXT",
            "OPENAI_API_KEY_BYEON",
            "GITHUB_TOKEN",
        ],
        "allowed_aliases": [
            "GEMINI_API_KEY_BYEON",
            "YOUTUBE_API_KEY",
        ],
    },
    "gdrive-backfill": {
        "required": ["RCLONE_CONFIG_BASE64"],
        "optional": [],
        "allowed_aliases": [],
    },
}

FORBIDDEN_ENV_NAMES = [
    "FALLBACK_MODEL",
    "PRIMARY_MODEL",
    "WEB_GEMINI_MODEL",
    "KAKAO_REST_API_KEY",
    "NEXT_PUBLIC_YOUTUBE_API_KEY",
    "GEMINI_CREDENTIALS_BASE64",
    "GEMINI_CREDENTIALS_BASE64_2",
]


RUNTIME_ALIAS_NOTES = {
    "GEMINI_API_KEY_BYEON": (
        "legacy runtime alias; mirror from GEMINI_API_KEY only, "
        "do not register as a separate secret"
    ),
    "YOUTUBE_API_KEY": (
        "canonical GitHub secret name; run_daily currently consumes "
        "YOUTUBE_API_KEY_BYEON"
    ),
}


def _present(env: Dict[str, str], name: str) -> bool:
    return bool((env.get(name) or "").strip())


def _status_map(env: Dict[str, str], names: Iterable[str]) -> Dict[str, bool]:
    return {name: _present(env, name) for name in names}


def validate(profile: str, env: Dict[str, str]) -> Dict[str, object]:
    if profile not in PROFILES:
        raise ValueError(f"unknown profile: {profile}")

    spec = PROFILES[profile]
    required = list(spec["required"])
    optional = list(spec["optional"])
    aliases = list(spec["allowed_aliases"])
    forbidden_present = [name for name in FORBIDDEN_ENV_NAMES if _present(env, name)]
    missing_required = [name for name in required if not _present(env, name)]
    alias_present = [name for name in aliases if _present(env, name)]

    return {
        "schemaVersion": 1,
        "checkedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "profile": profile,
        "ok": not missing_required and not forbidden_present,
        "required": _status_map(env, required),
        "optional": _status_map(env, optional),
        "runtimeAliasesPresent": alias_present,
        "runtimeAliasNotes": {
            name: RUNTIME_ALIAS_NOTES[name]
            for name in alias_present
            if name in RUNTIME_ALIAS_NOTES
        },
        "missingRequired": missing_required,
        "forbiddenPresent": forbidden_present,
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate tzudong CI/runtime env contract without printing secrets"
    )
    parser.add_argument("--profile", choices=sorted(PROFILES), required=True)
    parser.add_argument("--json", action="store_true", help="print only machine-readable JSON")
    args = parser.parse_args(argv)

    payload = validate(args.profile, dict(os.environ))
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    else:
        print(f"env-contract profile={payload['profile']} ok={str(payload['ok']).lower()}")
        if payload["missingRequired"]:
            print("missing required env names: " + ", ".join(payload["missingRequired"]))
        if payload["forbiddenPresent"]:
            print("forbidden legacy env names present: " + ", ".join(payload["forbiddenPresent"]))
        aliases = payload.get("runtimeAliasesPresent") or []
        if aliases:
            print("runtime aliases present: " + ", ".join(aliases))
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))

    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
