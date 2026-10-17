import copy
import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "ci_performance_collector", Path(__file__).with_name("collect-ci-performance.py")
)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def complete_run(run_id: int, minute: int) -> dict:
    created = datetime(2026, 10, 11, tzinfo=timezone.utc) + timedelta(minutes=minute)
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return {
        "id": run_id,
        "attempt": 1,
        "event": "pull_request",
        "status": "completed",
        "conclusion": "success",
        "headSha": "a" * 40,
        "createdAt": stamp(created),
        "startedAt": stamp(created + timedelta(seconds=1)),
        "updatedAt": stamp(created + timedelta(seconds=10)),
        "jobs": [
            {
                "id": run_id * 10,
                "name": "Ubuntu npm",
                "status": "completed",
                "conclusion": "success",
                "createdAt": stamp(created),
                "startedAt": stamp(created + timedelta(seconds=1)),
                "completedAt": stamp(created + timedelta(seconds=9)),
                "runnerLabels": ["ubuntu-latest"],
                "steps": [
                    {
                        "number": 1,
                        "name": "Run npm ci",
                        "status": "completed",
                        "conclusion": "success",
                        "startedAt": stamp(created + timedelta(seconds=2)),
                        "completedAt": stamp(created + timedelta(seconds=8)),
                    }
                ],
            }
        ],
    }


def replay_payloads():
    successful = [complete_run(run_id, 20 - run_id) for run_id in range(1, 8)]
    excluded_run = complete_run(8, 12)
    excluded_run["conclusion"] = "failure"
    observations = [
        {
            "run": excluded_run,
            "reasonCodes": ["run_conclusion_failure"],
            "censored": True,
        }
    ]
    ordered = sorted(
        successful + [excluded_run],
        key=lambda run: (run["createdAt"], run["id"]),
        reverse=True,
    )
    collection = {
        "schema": f"{M.SCHEMA_VERSION}/collection",
        "fetchedRunCount": 8,
        "successfulRunCount": 7,
        "excludedRunCount": 1,
        "orderedRunIds": [run["id"] for run in ordered],
    }
    successful_payload = {
        "schema": f"{M.SCHEMA_VERSION}/successful-runs",
        "runs": successful,
    }
    excluded_payload = {
        "schema": f"{M.SCHEMA_VERSION}/excluded-observations",
        "observations": observations,
    }
    return collection, successful_payload, excluded_payload


class CollectorAdmissionTests(unittest.TestCase):
    def test_online_collection_rejects_incomplete_or_malformed_job_counts(self):
        source_runs = [complete_run(run_id, run_id) for run_id in range(1, 8)]
        api_runs = []
        jobs_by_run = {}
        for source in source_runs:
            run = copy.deepcopy(source)
            jobs = run.pop("jobs")
            api_runs.append(run)
            jobs_by_run[run["id"]] = jobs

        original = M.gh_api
        try:
            for advertised_count in (2, True, None):
                with self.subTest(advertised_count=advertised_count):
                    def fake_api(endpoint, fields=None):
                        if endpoint.endswith("/runs"):
                            return {"workflow_runs": api_runs}
                        run_id = int(endpoint.split("/")[-2])
                        return {
                            "total_count": advertised_count,
                            "jobs": jobs_by_run[run_id],
                        }

                    M.gh_api = fake_api
                    with self.assertRaisesRegex(
                        M.CollectionError, "advertised count does not match"
                    ):
                        M.collect_online(
                            "twoimo/tzudong",
                            "web-admin-ci.yml",
                            7,
                            "2026-10-15T00:00:00Z",
                        )
        finally:
            M.gh_api = original

    def test_success_requires_every_non_skipped_step_to_be_terminal_and_timed(self):
        incomplete = complete_run(1, 0)
        step = incomplete["jobs"][0]["steps"][0]
        step.update(status="in_progress", conclusion=None, completedAt=None)
        self.assertEqual(
            M.exclusion_reasons(incomplete),
            ["incomplete_step", "missing_step_timing"],
        )

        missing_conclusion = complete_run(3, 0)
        missing_conclusion["jobs"][0]["steps"][0]["conclusion"] = None
        self.assertEqual(M.exclusion_reasons(missing_conclusion), ["incomplete_step"])

        skipped = complete_run(2, 0)
        skipped["jobs"][0]["steps"][0].update(
            status="completed", conclusion="skipped", startedAt=None, completedAt=None
        )
        self.assertEqual(M.exclusion_reasons(skipped), [])

        active_skipped = complete_run(4, 0)
        active_skipped["jobs"][0]["steps"][0].update(
            status="in_progress", conclusion="skipped", startedAt=None, completedAt=None
        )
        self.assertEqual(M.exclusion_reasons(active_skipped), ["incomplete_step"])

    def test_success_rejects_malformed_and_out_of_boundary_timing(self):
        cases = {
            "malformed_run": lambda run: run.update(createdAt="malformed-time"),
            "run_order": lambda run: run.update(startedAt="2026-10-10T23:59:59Z"),
            "job_before_run": lambda run: run["jobs"][0].update(
                createdAt="2026-10-10T23:59:59Z"
            ),
            "job_after_run": lambda run: run["jobs"][0].update(
                completedAt="2026-10-11T00:00:10.500000Z"
            ),
            "step_before_job": lambda run: run["jobs"][0]["steps"][0].update(
                startedAt="2026-10-11T00:00:00.500000Z"
            ),
            "step_after_job": lambda run: run["jobs"][0]["steps"][0].update(
                completedAt="2026-10-11T00:00:09.500000Z"
            ),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                candidate = complete_run(10, 0)
                mutate(candidate)
                reasons = M.exclusion_reasons(candidate)
                self.assertTrue(
                    {"malformed_timing", "invalid_timing_order"} & set(reasons),
                    reasons,
                )

        partial_skipped = complete_run(11, 0)
        partial_skipped["jobs"][0]["steps"][0].update(
            conclusion="skipped", completedAt=None
        )
        self.assertIn("missing_step_timing", M.exclusion_reasons(partial_skipped))

        missing_run = complete_run(12, 0)
        missing_run["createdAt"] = None
        self.assertIn("missing_run_timing", M.exclusion_reasons(missing_run))

        missing_job = complete_run(13, 0)
        missing_job["jobs"][0]["createdAt"] = None
        self.assertIn("missing_job_timing", M.exclusion_reasons(missing_job))

    def test_replay_collection_summary_is_bound_to_both_observation_payloads(self):
        collection, successful, excluded = replay_payloads()
        M.validate_replay_inputs(collection, successful, excluded)

        mutations = (
            ("fetchedRunCount", 9),
            ("successfulRunCount", 6),
            ("excludedRunCount", 0),
            ("orderedRunIds", list(reversed(collection["orderedRunIds"]))),
        )
        for key, value in mutations:
            with self.subTest(key=key):
                changed = copy.deepcopy(collection)
                changed[key] = value
                with self.assertRaises(M.CollectionError):
                    M.validate_replay_inputs(changed, successful, excluded)

        different_capture = copy.deepcopy(successful)
        different_capture["runs"][0]["id"] = 999
        with self.assertRaises(M.CollectionError):
            M.validate_replay_inputs(collection, different_capture, excluded)

    def test_replay_rejects_excluded_observation_semantic_tampering(self):
        collection, successful, excluded = replay_payloads()
        cases = []

        successful_as_excluded = copy.deepcopy(excluded)
        successful_as_excluded["observations"][0].update(
            run=complete_run(8, 12), reasonCodes=[], censored=False
        )
        cases.append(("successful_run", successful_as_excluded))

        missing_reasons = copy.deepcopy(excluded)
        missing_reasons["observations"][0].pop("reasonCodes")
        cases.append(("missing_reason_codes", missing_reasons))

        empty_reasons = copy.deepcopy(excluded)
        empty_reasons["observations"][0]["reasonCodes"] = []
        cases.append(("empty_reason_codes", empty_reasons))

        wrong_reason_type = copy.deepcopy(excluded)
        wrong_reason_type["observations"][0]["reasonCodes"] = "run_conclusion_failure"
        cases.append(("reason_codes_wrong_type", wrong_reason_type))

        fabricated_reason = copy.deepcopy(excluded)
        fabricated_reason["observations"][0]["reasonCodes"] = [
            "run_conclusion_cancelled"
        ]
        cases.append(("fabricated_reason", fabricated_reason))

        stale_reason = copy.deepcopy(excluded)
        stale_reason["observations"][0]["run"]["conclusion"] = "cancelled"
        cases.append(("stale_cross_copied_reason", stale_reason))

        wrong_censored_type = copy.deepcopy(excluded)
        wrong_censored_type["observations"][0]["censored"] = 1
        cases.append(("censored_wrong_type", wrong_censored_type))

        fabricated_censored = copy.deepcopy(excluded)
        fabricated_censored["observations"][0]["censored"] = False
        cases.append(("fabricated_censored", fabricated_censored))

        for name, changed in cases:
            with self.subTest(name=name):
                with self.assertRaises(M.CollectionError):
                    M.validate_replay_inputs(collection, successful, changed)


if __name__ == "__main__":
    unittest.main()
