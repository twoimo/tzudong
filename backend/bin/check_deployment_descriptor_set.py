#!/usr/bin/env python3
"""Deployment_Descriptor_Set checker (platform-modernization Requirement 14).

This is the ``C10`` local-render checker for the Deployment_Descriptor_Set that
lives as Helm charts under ``backend/deploy/helm/`` and OpenTofu configs under
``backend/deploy/opentofu/`` plus the machine-readable catalog
``backend/deploy/deployment-descriptor-set.v1.json`` (task 49).

It runs four fail-closed dimensions, each with a bounded fixed code and no
Forbidden_Log_Field (only paths, counts, finding kinds, line numbers, fixed
codes):

1. **Structural completeness** (Requirement 14.2) -> ``ledger_*`` via the shared
   ``ledger_validation`` validator. Every one of the five components carries all
   four required items (image ref, resource request, env var names + source,
   secret reference names) and none is empty.

2. **Secret-literal detection** (Requirements 14.3, 14.4) ->
   ``secret_value_in_descriptor``. Descriptor files (Helm chart, OpenTofu
   configs, JSON catalog) are scanned for credential / token / connection-string
   literals. One or more findings fails the check and NO render artifact is
   produced.

3. **Cluster render** (Requirements 14.5, 14.6, 14.7). The catalog is rendered
   for two or more cluster identifiers. The render is local only: the summary
   records ``remoteApplyAttemptCount == 0``. The only fields that differ between
   cluster renders must be derived from the cluster identifier. A render that
   would need remote credentials / apply permission is refused with
   ``remote_apply_not_admitted`` and leaves no artifact.

Rendering is gated behind the secret scan: if a literal is detected, the render
step is skipped and the artifact count stays 0 (Requirement 14.4).

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests. The repo root is put on ``sys.path`` so the shared
``backend.pipeline_control`` logic modules resolve regardless of launch cwd.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Sequence

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.pipeline_control import deployment_descriptor as dd  # noqa: E402
from backend.pipeline_control import ledger_validation  # noqa: E402

# ---------------------------------------------------------------------------
# Default descriptor locations (design C10).
# ---------------------------------------------------------------------------
_DEPLOY_DIR = _ROOT / "backend" / "deploy"
_DEFAULT_CATALOG_PATH = _DEPLOY_DIR / "deployment-descriptor-set.v1.json"
_HELM_DIR = _DEPLOY_DIR / "helm"
_OPENTOFU_DIR = _DEPLOY_DIR / "opentofu"

# Two local cluster identifiers used to prove definition reuse (Requirement
# 14.5). Both are local; neither implies a remote target.
_DEFAULT_CLUSTER_IDS = ("local-a", "local-b")

# Extensions treated as descriptor text for the secret scan.
_DESCRIPTOR_SUFFIXES = (".yaml", ".yml", ".tpl", ".tf", ".json")


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


def _descriptor_files(
    *,
    catalog_path: Path,
    helm_dir: Path,
    opentofu_dir: Path,
) -> list[Path]:
    """Collect the descriptor files that must be free of secret literals."""

    files: list[Path] = []
    if catalog_path.is_file():
        files.append(catalog_path)
    for directory in (helm_dir, opentofu_dir):
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.suffix.lower() in _DESCRIPTOR_SUFFIXES:
                files.append(path)
    return files


def run_check(
    *,
    catalog_path: str | Path = _DEFAULT_CATALOG_PATH,
    helm_dir: str | Path = _HELM_DIR,
    opentofu_dir: str | Path = _OPENTOFU_DIR,
    cluster_ids: Sequence[str] = _DEFAULT_CLUSTER_IDS,
    render_options: dict | None = None,
) -> dict:
    """Run every Deployment_Descriptor_Set check and return one bounded artifact.

    The aggregate ``ok`` is true only when the catalog is structurally complete,
    no secret literal is detected, and the multi-cluster render differs only in
    derived fields with zero remote apply attempts. ``errorCode`` is the first
    failing code by precedence: structural, then secret-literal, then render.
    """

    catalog_path = Path(catalog_path)
    helm_dir = Path(helm_dir)
    opentofu_dir = Path(opentofu_dir)

    # 1) Structural completeness (Requirement 14.2).
    try:
        catalog = dd.load_catalog(catalog_path)
    except (OSError, json.JSONDecodeError) as exc:  # bounded, no free-form detail
        return _result(
            False,
            "ledger_shape_invalid",
            structural={"ok": False, "errorCode": "ledger_shape_invalid"},
            reason=type(exc).__name__,
        )

    structural = ledger_validation.validate_ledger("deployment_descriptor_set", catalog)

    # 2) Secret-literal detection (Requirements 14.3, 14.4).
    files = _descriptor_files(
        catalog_path=catalog_path, helm_dir=helm_dir, opentofu_dir=opentofu_dir
    )
    secret_scan = dd.scan_descriptor_files(files)

    # 3) Cluster render -- gated behind the secret scan so a detected literal
    #    yields zero render artifacts (Requirement 14.4).
    if not secret_scan["ok"]:
        render = _result(
            False,
            None,
            clusterIds=list(cluster_ids),
            renders={},
            differingFields=[],
            remoteApplyAttemptCount=0,
            skipped="secret_literal_detected",
        )
    else:
        render = dd.render_multi_cluster(
            catalog, cluster_ids, render_options=render_options
        )

    # Aggregate: first failing code by precedence.
    error_code = None
    if not structural["ok"]:
        error_code = structural["errorCode"]
    elif not secret_scan["ok"]:
        error_code = secret_scan["errorCode"]
    elif not render["ok"]:
        error_code = render["errorCode"]

    return _result(
        error_code is None,
        error_code,
        structural=structural,
        secretScan=secret_scan,
        render=render,
        componentCount=len(catalog.get("components", []))
        if isinstance(catalog, dict)
        else 0,
        remoteApplyAttemptCount=render.get("remoteApplyAttemptCount", 0),
    )


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Deployment_Descriptor_Set checker (platform-modernization Req 14).",
    )
    parser.add_argument("--catalog", default=str(_DEFAULT_CATALOG_PATH))
    parser.add_argument("--helm-dir", default=str(_HELM_DIR))
    parser.add_argument("--opentofu-dir", default=str(_OPENTOFU_DIR))
    parser.add_argument(
        "--cluster-id",
        action="append",
        dest="cluster_ids",
        help="Cluster identifier (repeat for two or more; default local-a local-b).",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    cluster_ids = tuple(args.cluster_ids) if args.cluster_ids else _DEFAULT_CLUSTER_IDS
    result = run_check(
        catalog_path=args.catalog,
        helm_dir=args.helm_dir,
        opentofu_dir=args.opentofu_dir,
        cluster_ids=cluster_ids,
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        print(
            "deployment-descriptor-set ok={ok} code={code} components={n} "
            "remoteApplyAttempts={r}".format(
                ok=str(result["ok"]).lower(),
                code=result["errorCode"],
                n=result["componentCount"],
                r=result["remoteApplyAttemptCount"],
            )
        )
        if not result["ok"]:
            print(json.dumps(
                {
                    "structural": result["structural"],
                    "secretScan": {
                        "ok": result["secretScan"]["ok"],
                        "errorCode": result["secretScan"]["errorCode"],
                        "findingCount": result["secretScan"]["findingCount"],
                    },
                    "render": {
                        "ok": result["render"]["ok"],
                        "errorCode": result["render"]["errorCode"],
                        "differingFields": result["render"].get("differingFields", []),
                    },
                },
                ensure_ascii=True,
                sort_keys=True,
            ))

    return 0 if result["ok"] else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
