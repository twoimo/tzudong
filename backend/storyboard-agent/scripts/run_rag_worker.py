#!/usr/bin/env python3
"""Run the Gemini-only storyboard FastAPI RAG worker at the existing host/port."""

from __future__ import annotations

import os
import ipaddress
import sys
from pathlib import Path

import uvicorn


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def listener_options(host: str) -> dict:
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost"
    cert = os.environ.get("STORYBOARD_RAG_WORKER_TLS_CERT")
    key = os.environ.get("STORYBOARD_RAG_WORKER_TLS_KEY")
    if not loopback and (not cert or not key):
        raise SystemExit("worker_remote_tls_required")
    if bool(cert) != bool(key):
        raise SystemExit("worker_tls_configuration_invalid")
    return {"proxy_headers": False, "ssl_certfile": cert, "ssl_keyfile": key}


if __name__ == "__main__":
    host = os.environ.get("STORYBOARD_RAG_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("STORYBOARD_RAG_WORKER_PORT", "8765"))
    uvicorn.run(
        "src.rag_worker:app",
        host=host,
        **listener_options(host),
        port=port,
        access_log=False,  # No request URLs or payload-related query values in access logs.
        reload=os.environ.get("STORYBOARD_RAG_WORKER_RELOAD") == "1",
        log_level=os.environ.get("STORYBOARD_RAG_WORKER_LOG_LEVEL", "info"),
        app_dir=str(ROOT),
    )
