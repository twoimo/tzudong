#!/usr/bin/env python3
"""Metric-contract exposure checker for the platform-modernization spec.

Task 20 (Requirement 12.5, 12.6, 12.14, 12.15). This is the companion of the
Observability_Stack starter ``backend/bin/observability_up.py`` (Task 19): once
the stack is up, this module verifies that the dashboard exposes every metric
enumerated in the frozen catalog ``backend/pipeline-control/metrics.v1.json`` as
a dashboard-query target, and it models the broker- / log-search-dependent
panels so a not-started optional component degrades to a no-data panel instead
of failing the whole contract.

Design references: design section "지표 계약" (Requirement 12.5, 12.14), the
broker metric note (Requirement 12.6), and the optional-component no-data rule
(Requirement 12.15).

The catalog metric names are NOT redefined here. They are read from the frozen
constants in ``backend/pipeline_control/metrics.py`` (``FROZEN`` +
``EXTRA_COUNTERS`` + ``GAUGES`` = 4 + 1 + 8 = 13). This module only classifies
which of those names depend on an optional component.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests and loads ``metrics.py`` by path in turn, so no
package install, live Docker, network, or operator secret is required. It fails
closed with the single bounded fixed code ``metrics_contract_incomplete`` and
records only bounded status fields — never a provider or database diagnostic,
free-form error string, or any other Forbidden_Log_Field (Requirement 12.9).
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any, Iterable, Sequence

# Repo layout: backend/bin/metrics_contract_report.py -> bin -> backend -> <root>.
_ROOT = Path(__file__).resolve().parents[2]
_METRICS_MODULE_PATH = _ROOT / "backend" / "pipeline_control" / "metrics.py"


def _load_metrics_module():
    """Load ``backend/pipeline_control/metrics.py`` by path for its constants.

    The module import is side-effect free (only stdlib imports plus module-level
    constant/lock definitions), so loading it by path yields the frozen catalog
    tuples without redefining any metric name here.
    """

    spec = importlib.util.spec_from_file_location(
        "_metrics_contract_catalog", _METRICS_MODULE_PATH
    )
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise RuntimeError("metrics_module_unloadable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_METRICS = _load_metrics_module()

# ---------------------------------------------------------------------------
# Frozen catalog (reused from metrics.py; never redefined here).
# ---------------------------------------------------------------------------

# 4 counters + 1 extra counter + 8 gauges = 13, in catalog order.
CATALOG_METRICS: tuple[str, ...] = (
    *_METRICS.FROZEN,
    *_METRICS.EXTRA_COUNTERS,
    *_METRICS.GAUGES,
)

# ---------------------------------------------------------------------------
# Optional-component dependency map (design "지표 계약"; Requirement 12.6, 12.15).
# ---------------------------------------------------------------------------

# Component identifiers for the two optional sources the panels can depend on.
BROKER_COMPONENT = "broker"
LOG_SEARCH_COMPONENT = "log_search"

# Broker-dependent metrics: broker lag + queue backlog. The gauge names match
# metrics.py exactly (tzudong_pipeline_queue_depth / _queue_age_seconds).
# ``publisher.py:observe_queue`` emits the queue values and
# ``es_index.py:consume_once`` emits the kafka lag (design Requirement 12.6).
BROKER_DEPENDENT_METRICS: tuple[str, ...] = (
    "tzudong_pipeline_kafka_lag",
    "tzudong_pipeline_queue_depth",
    "tzudong_pipeline_queue_age_seconds",
)

# Log-search-dependent metric: Elasticsearch index throughput.
LOG_SEARCH_DEPENDENT_METRICS: tuple[str, ...] = (
    "tzudong_pipeline_es_rows_per_sec",
)

# ---------------------------------------------------------------------------
# Bounded fixed codes (design error-code table). ``None`` means accepted.
# ---------------------------------------------------------------------------

METRICS_CONTRACT_INCOMPLETE = "metrics_contract_incomplete"  # 12.14

# The full closed set this checker may return. Any other value is a defect.
CONTRACT_RESULT_CODES = frozenset({None, METRICS_CONTRACT_INCOMPLETE})

# Reason code recorded (not returned) when an optional broker / log-search
# component is not started; mirrors the convention in observability_up.py so a
# not-started optional component degrades a panel to no-data rather than failing
# the contract (Requirement 12.15).
OPTIONAL_COMPONENT_NOT_STARTED = "optional_component_not_started"


# ---------------------------------------------------------------------------
# Pure helpers.
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


def catalog_metrics() -> tuple[str, ...]:
    """Return the 13 frozen catalog metric names (counters + extra + gauges)."""

    return CATALOG_METRICS


def dependency_component(metric: str) -> str | None:
    """Return the optional component a metric depends on, or ``None``.

    Broker-dependent metrics require the message broker; the log-search metric
    requires the log-search component. Every other catalog metric is always
    available once the core stack is up.
    """

    if metric in BROKER_DEPENDENT_METRICS:
        return BROKER_COMPONENT
    if metric in LOG_SEARCH_DEPENDENT_METRICS:
        return LOG_SEARCH_COMPONENT
    return None


def _started_components(broker_started: bool, log_search_started: bool) -> dict[str, bool]:
    return {
        BROKER_COMPONENT: bool(broker_started),
        LOG_SEARCH_COMPONENT: bool(log_search_started),
    }


def check_metrics_contract(
    exposed_metrics: Iterable[Any],
    *,
    broker_started: bool = False,
    log_search_started: bool = False,
) -> dict:
    """Verify the dashboard exposes the full metric contract (12.5, 12.14).

    ``exposed_metrics`` is the set of metric names the dashboard declares as
    query targets (panels). Every one of the 13 catalog metrics must be present
    as a target regardless of whether its optional source is running — a
    not-started broker or log-search component degrades a target to a no-data
    panel, it does not remove the target.

    Fail-closed precedence:

      1. any catalog metric absent from the exposed targets ->
         :data:`METRICS_CONTRACT_INCOMPLETE` with the sorted missing list
         (12.14). ``ok`` is ``False`` and no per-panel state is asserted.

    Otherwise ``ok`` is ``True`` and the report records, per catalog metric, a
    panel state of ``data`` (live) or ``no_data`` (its optional component is not
    started), the sorted list of no-data panel metric names, and a
    ``notStartedComponents`` list of ``{component, reasonCode}`` entries for each
    optional component that is not started (12.6, 12.15).

    The returned dict carries only bounded status fields — metric names, panel
    states, component identifiers, and the single fixed reason/error code — and
    never a provider/database diagnostic or other Forbidden_Log_Field (12.9).
    """

    exposed = {name for name in exposed_metrics if isinstance(name, str)}

    missing = sorted(name for name in CATALOG_METRICS if name not in exposed)
    if missing:
        return _result(
            False,
            METRICS_CONTRACT_INCOMPLETE,
            missing=missing,
            panels=[],
            noDataPanels=[],
            notStartedComponents=[],
        )

    started = _started_components(broker_started, log_search_started)

    panels: list[dict] = []
    no_data_panels: list[str] = []
    not_started: set[str] = set()

    for metric in CATALOG_METRICS:
        component = dependency_component(metric)
        if component is not None and not started[component]:
            panels.append(
                {"name": metric, "state": "no_data", "dependsOn": component}
            )
            no_data_panels.append(metric)
            not_started.add(component)
        else:
            panels.append(
                {"name": metric, "state": "data", "dependsOn": component}
            )

    not_started_components = [
        {"component": component, "reasonCode": OPTIONAL_COMPONENT_NOT_STARTED}
        for component in sorted(not_started)
    ]

    return _result(
        True,
        None,
        missing=[],
        panels=panels,
        noDataPanels=sorted(no_data_panels),
        notStartedComponents=not_started_components,
    )


def build_report(
    exposed_metrics: Iterable[Any],
    *,
    broker_started: bool = False,
    log_search_started: bool = False,
) -> dict:
    """Build the full metric-contract report artifact (Requirement 12.5-12.15).

    Adds the fixed catalog counts to :func:`check_metrics_contract` so the
    artifact is self-describing without exposing anything beyond bounded status
    fields.
    """

    report = check_metrics_contract(
        exposed_metrics,
        broker_started=broker_started,
        log_search_started=log_search_started,
    )
    report["catalogMetricCount"] = len(CATALOG_METRICS)
    report["counterCount"] = len(_METRICS.FROZEN) + len(_METRICS.EXTRA_COUNTERS)
    report["gaugeCount"] = len(_METRICS.GAUGES)
    return report


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def _read_exposed_metrics(path: Path) -> list[str]:
    """Read the dashboard-query target list from a JSON file.

    Accepts either a bare JSON array of metric names or an object with an
    ``exposedMetrics`` array. Any provider payload is never surfaced.
    """

    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [name for name in payload if isinstance(name, str)]
    if isinstance(payload, dict):
        values = payload.get("exposedMetrics", [])
        if isinstance(values, list):
            return [name for name in values if isinstance(name, str)]
    return []


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Check the dashboard metric contract (Requirement 12.5-12.15).",
    )
    parser.add_argument(
        "--exposed",
        help=(
            "Path to a JSON file listing the dashboard-query target metric "
            "names (array or {\"exposedMetrics\": [...]}). Defaults to the full "
            "catalog when omitted."
        ),
    )
    parser.add_argument("--broker-started", action="store_true")
    parser.add_argument("--log-search-started", action="store_true")
    parser.add_argument(
        "--artifact",
        default=str(
            _ROOT / "backend" / "log" / "observability" / "metrics_contract-report.json"
        ),
        help="Path to write the contract report JSON.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.exposed:
        exposed = _read_exposed_metrics(Path(args.exposed))
    else:
        exposed = list(CATALOG_METRICS)

    report = build_report(
        exposed,
        broker_started=args.broker_started,
        log_search_started=args.log_search_started,
    )

    out_path = Path(args.artifact)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")

    return 0 if report.get("ok") else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
