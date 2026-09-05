#!/usr/bin/env python3
"""Credential-free, fixed-target G037 direct-endpoint network preflight."""

from __future__ import annotations

import argparse
import json
import socket
from collections.abc import Sequence


SCHEMA = "g037-direct-endpoint-network-preflight-v1"
DIRECT_HOST = "db.aqlcofblfxdrjhhdmarw.supabase.co"
DIRECT_PORT = 5432
MAX_ADDRESSES = 4
PER_ADDRESS_TIMEOUT_SECONDS = 3


def _result(*, dns_present: bool, reachable: bool) -> dict[str, object]:
    if reachable:
        status = "ready"
        fixed_code = "g037_direct_endpoint_ready"
    elif dns_present:
        status = "blocked"
        fixed_code = "g037_direct_endpoint_tcp_unreachable"
    else:
        status = "blocked"
        fixed_code = "g037_direct_endpoint_ipv6_dns_unavailable"
    return {
        "schema": SCHEMA,
        "status": status,
        "fixedCode": fixed_code,
        "ipv6DnsPresent": dns_present,
        "tcp5432Reachable": reachable,
        "credentialUsed": False,
        "databaseAuthenticationAttempted": False,
        "sqlExecuted": False,
        "persistentStateChanged": False,
    }


def probe() -> dict[str, object]:
    try:
        resolved = socket.getaddrinfo(
            DIRECT_HOST,
            DIRECT_PORT,
            family=socket.AF_INET6,
            type=socket.SOCK_STREAM,
        )
    except Exception:
        resolved = []

    candidates: list[tuple[int, int, int, tuple[object, ...]]] = []
    seen: set[tuple[object, ...]] = set()
    for family, socktype, protocol, _canonical_name, address in resolved:
        if address in seen:
            continue
        seen.add(address)
        candidates.append((family, socktype, protocol, address))
        if len(candidates) == MAX_ADDRESSES:
            break

    reachable = False
    for family, socktype, protocol, address in candidates:
        connection = socket.socket(family, socktype, protocol)
        connection.settimeout(PER_ADDRESS_TIMEOUT_SECONDS)
        try:
            connection.connect(address)
            reachable = True
            break
        except Exception:
            pass
        finally:
            connection.close()
    return _result(dns_present=bool(candidates), reachable=reachable)


def emit(value: dict[str, object]) -> None:
    print(json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("validate", "probe"))
    args = parser.parse_args(argv)
    if args.mode == "validate":
        emit(
            {
                "schema": SCHEMA,
                "status": "valid",
                "fixedCode": "g037_direct_endpoint_preflight_source_valid",
                "credentialUsed": False,
                "persistentStateChanged": False,
            }
        )
        return 0
    result = probe()
    emit(result)
    return 0 if result["status"] == "ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
