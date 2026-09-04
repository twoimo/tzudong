"""Shared deterministic fixtures for the seven current phase-runner tests."""

from __future__ import annotations

import copy
from typing import Any, Callable

from backend.bin import phase_gate


TREE_ID = "a" * 64
OBSERVED_AT = "2026-09-03T00:00:00Z"


def phase(catalog: dict[str, Any], phase_id: str) -> dict[str, Any]:
    return next(item for item in catalog["phases"] if item["phaseId"] == phase_id)


def valid_inputs(catalog: dict[str, Any], phase_id: str) -> dict[str, Any]:
    selected = phase(catalog, phase_id)
    evidence: dict[str, Any] = {}
    for condition in (*selected["entryConditions"], *selected["exitConditions"]):
        record = {
            "satisfied": True,
            "treeId": TREE_ID,
            "observedAt": OBSERVED_AT,
        }
        if condition["evidenceClass"] == "external":
            record["evidenceRef"] = f"receipt:{condition['conditionId']}"
        evidence[condition["conditionId"]] = record
    commands = {
        command["id"]: {
            "passed": True,
            "treeId": TREE_ID,
            "ranAt": OBSERVED_AT,
        }
        for command in catalog["verificationCommands"]
    }
    routes = {
        route: {
            "passed": True,
            "responseMs": 25,
            "treeId": TREE_ID,
            "observedAt": OBSERVED_AT,
        }
        for route in selected["publicRoutes"]
    }
    rollback = {
        "schemaVersion": 1,
        "kind": "rollback_plan",
        "phaseId": phase_id,
        "planRef": selected["rollbackPlanRef"],
        "recoveryCandidateTreeId": TREE_ID,
        "affectedPaths": ["backend/bin/phase_gate.py"],
        "commands": [
            {
                "worktreeId": TREE_ID,
                "argv": ["git", "revert", "--no-edit", "c" * 40],
            }
        ],
        "postRollbackVerification": [
            {"cwd": command["cwd"], "argv": command["argv"]}
            for command in catalog["verificationCommands"]
        ],
    }
    return {
        "catalog": catalog,
        "evidence": evidence,
        "rollback_plan": rollback,
        "command_results": commands,
        "route_results": routes,
        "candidate_tree_id": TREE_ID,
        "write_report": False,
        "now": lambda: OBSERVED_AT,
    }


def _exercise_runner_bound(testcase: Any, runner: Callable[..., dict[str, Any]], phase_id: str) -> None:
    catalog = copy.deepcopy(phase_gate.load_phase_catalog())
    testcase.assertTrue(phase_gate.validate_phase_assignment(catalog)["ok"])

    blocked = runner(
        catalog=catalog,
        candidate_tree_id=TREE_ID,
        write_report=False,
        now=lambda: OBSERVED_AT,
    )
    testcase.assertFalse(blocked["ok"])
    testcase.assertEqual(blocked["resultCode"], phase_gate.ENTRY_NOT_SATISFIED)
    testcase.assertIsNone(blocked["reportPath"])

    inputs = valid_inputs(catalog, phase_id)
    passed = runner(**inputs)
    testcase.assertTrue(passed["ok"])
    testcase.assertIsNone(passed["resultCode"])
    testcase.assertEqual(
        set(passed),
        {
            "ok",
            "phaseId",
            "resultCode",
            "candidateTreeId",
            "unsatisfiedIds",
            "reportPath",
            "evaluatedAt",
        },
    )

    failed_command = copy.deepcopy(inputs)
    first_command = catalog["verificationCommands"][0]["id"]
    failed_command["command_results"][first_command]["passed"] = False
    result = runner(**failed_command)
    testcase.assertEqual(result["resultCode"], phase_gate.VERIFICATION_FAILED)
    testcase.assertEqual(result["unsatisfiedIds"], [first_command])

    slow_route = copy.deepcopy(inputs)
    first_route = phase(catalog, phase_id)["publicRoutes"][0]
    slow_route["route_results"][first_route]["responseMs"] = 5_001
    result = runner(**slow_route)
    testcase.assertEqual(result["resultCode"], phase_gate.ROUTE_VERIFICATION_FAILED)
    testcase.assertEqual(result["unsatisfiedIds"], [first_route])

    missing_exit = copy.deepcopy(inputs)
    first_exit = phase(catalog, phase_id)["exitConditions"][0]["conditionId"]
    del missing_exit["evidence"][first_exit]
    result = runner(**missing_exit)
    testcase.assertEqual(result["resultCode"], phase_gate.EXIT_NOT_SATISFIED)
    testcase.assertEqual(result["unsatisfiedIds"], [first_exit])

    bad_plan = copy.deepcopy(inputs)
    bad_plan["rollback_plan"]["commands"][0]["argv"] = ["git", "reset", "--hard"]
    result = runner(**bad_plan)
    testcase.assertEqual(result["resultCode"], phase_gate.ROLLBACK_PLAN_INVALID)


def exercise_runner(testcase, runner, phase_id):
    # These tests exercise phase wiring against one explicit synthetic snapshot;
    # stale real-source binding is covered at the CLI/runtime boundary.
    from unittest.mock import patch
    with patch.object(phase_gate, "candidate_tree_fingerprint", return_value=TREE_ID):
        _exercise_runner_bound(testcase, runner, phase_id)
