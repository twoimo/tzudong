#!/usr/bin/env python3
"""백엔드 스크립트용 공통 경로/환경 로더 유틸리티."""

from __future__ import annotations

from pathlib import Path
import os
from typing import Optional


def resolve_backend_root(anchor: Optional[Path] = None) -> Path:
    """anchor 파일/디렉토리를 기준으로 backend 루트를 탐지합니다."""
    base = (anchor or Path(__file__)).resolve()
    if base.is_file():
        base = base.parent

    # 1) 강한 신호: config/channels.yaml + utils 동시 존재
    for candidate in [base, *base.parents]:
        if (candidate / "config" / "channels.yaml").exists() and (candidate / "utils").exists():
            return candidate

    # 2) 약한 신호: 디렉토리명이 backend
    for candidate in [base, *base.parents]:
        if candidate.name == "backend":
            return candidate

    # 3) 마지막 fallback
    return base


def resolve_env_path(backend_root: Path, prefer_local: bool = True) -> Optional[Path]:
    """
    backend/.env(.local) 경로를 우선순위에 따라 선택합니다.

    prefer_local=True  -> .env.local 우선
    prefer_local=False -> .env 우선
    """
    ordered = [".env.local", ".env"] if prefer_local else [".env", ".env.local"]
    for name in ordered:
        candidate = backend_root / name
        if candidate.exists():
            return candidate
    return None


def load_backend_env(
    backend_root: Path, prefer_local: bool = True, override: bool = False
) -> Optional[Path]:
    """dotenv를 사용할 수 있으면 선택된 env 파일을 로드하고 경로를 반환합니다."""
    env_path = resolve_env_path(backend_root, prefer_local=prefer_local)
    if env_path is None:
        return None

    try:
        from dotenv import load_dotenv
    except Exception:
        # python-dotenv 미설치 환경에서도 최소 동작을 보장하기 위한 수동 로더
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if not key:
                    continue
                if override or key not in os.environ:
                    os.environ[key] = value
        except Exception:
            # env 파일 파싱 실패 시에도 호출 측에서 경로 참조는 가능하도록 반환
            return env_path
        return env_path

    load_dotenv(env_path, override=override)
    return env_path


def get_backend_log_dir(backend_root: Path, domain: str) -> Path:
    """backend/log/<domain> 경로 반환"""
    return backend_root / "log" / domain
