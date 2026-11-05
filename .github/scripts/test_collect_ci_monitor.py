import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("ci_live_monitor", Path(__file__).with_name("collect-ci-monitor.py"))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
SHA, TREE, REVISION = "a" * 40, "b" * 40, "c" * 40


def run(attempt=1, status="completed", conclusion="success", run_id=1, minute=0):
    created = datetime(2026, 10, 11, tzinfo=timezone.utc) + timedelta(minutes=minute)
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return {"id": run_id, "run_attempt": attempt, "head_sha": SHA, "event": "pull_request", "status": status, "conclusion": conclusion, "created_at": stamp(created), "run_started_at": stamp(created + timedelta(seconds=1)), "updated_at": stamp(created + timedelta(seconds=10 + attempt))}


def jobs(created_at="2026-10-11T00:00:00Z"):
    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    stamp = lambda value: value.isoformat().replace("+00:00", "Z")
    return {"total_count": 1, "jobs": [{"id": 2, "name": "private owner name", "labels": ["ubuntu-latest", "private-host"], "status": "completed", "conclusion": "success", "created_at": stamp(created), "started_at": stamp(created + timedelta(seconds=1)), "completed_at": stamp(created + timedelta(seconds=10)), "steps": [{"number": 1, "name": "Run npm ci PRIVATE_DIAGNOSTIC_SENTINEL", "status": "completed", "conclusion": "success", "started_at": stamp(created + timedelta(seconds=1)), "completed_at": stamp(created + timedelta(seconds=9))}]}]}


class Reader:
    def __init__(self, latest=None, job_payload=None):
        self.latest = latest or run()
        self.job_payload = job_payload if job_payload is not None else jobs(self.latest["created_at"])
        self.requests = 0
        self.endpoints = []
        self.calls = []
        self.empty = False
        self.gone = False

    def get(self, endpoint, fields=None):
        self.requests += 1
        self.endpoints.append(endpoint)
        self.calls.append((endpoint, dict(fields or {})))
        if endpoint.endswith("/web-admin-ci.yml/runs"):
            return {"total_count": 0 if self.empty else 1, "workflow_runs": [] if self.empty else [self.latest]}
        if "/git/commits/" in endpoint: return {"tree": {"sha": TREE}}
        if "/contents/" in endpoint: return {"sha": REVISION}
        if endpoint.endswith("/jobs"): return self.job_payload
        if "/attempts/" in endpoint:
            result = run(int(endpoint.rsplit("/", 1)[1]), conclusion="failure")
            return result
        if endpoint.endswith("/actions/runs/1"):
            if self.gone: raise M.ReadError("NOT_FOUND")
            return self.latest
        raise AssertionError(endpoint)


class PagingReader(Reader):
    def __init__(self, runs):
        super().__init__()
        self.runs = list(runs)

    def get(self, endpoint, fields=None):
        if endpoint.endswith("/web-admin-ci.yml/runs"):
            self.requests += 1
            self.endpoints.append(endpoint)
            self.calls.append((endpoint, dict(fields or {})))
            page = int((fields or {}).get("page", 1))
            per_page = int((fields or {}).get("per_page", 20))
            start = (page - 1) * per_page
            return {
                "total_count": len(self.runs),
                "workflow_runs": self.runs[start : start + per_page],
            }
        if endpoint.endswith("/jobs") and "/actions/runs/" in endpoint:
            run_id = int(endpoint.split("/actions/runs/", 1)[1].split("/", 1)[0])
            source = next(item for item in self.runs if item["id"] == run_id)
            self.job_payload = jobs(source["created_at"])
        elif "/actions/runs/" in endpoint and "/attempts/" not in endpoint:
            run_id = int(endpoint.rsplit("/", 1)[1])
            return next(item for item in self.runs if item["id"] == run_id)
        return super().get(endpoint, fields)


class DiscoveryReader(Reader):
    """Model the documented created-time list independently of per-run reads."""

    def __init__(self, listed_runs, latest_by_id):
        super().__init__()
        self.listed_runs = list(listed_runs)
        self.latest_by_id = dict(latest_by_id)

    def get(self, endpoint, fields=None):
        self.requests += 1
        self.endpoints.append(endpoint)
        self.calls.append((endpoint, dict(fields or {})))
        if endpoint.endswith("/web-admin-ci.yml/runs"):
            page = int((fields or {}).get("page", 1))
            per_page = int((fields or {}).get("per_page", 20))
            start = (page - 1) * per_page
            return {
                "total_count": len(self.listed_runs),
                "workflow_runs": self.listed_runs[start : start + per_page],
            }
        if "/git/commits/" in endpoint:
            return {"tree": {"sha": TREE}}
        if "/contents/" in endpoint:
            return {"sha": REVISION}
        if endpoint.endswith("/jobs"):
            run_id = int(endpoint.split("/actions/runs/", 1)[1].split("/", 1)[0])
            source = self.latest_by_id[run_id]
            return jobs(source["created_at"])
        if "/attempts/" in endpoint:
            run_id = int(endpoint.split("/actions/runs/", 1)[1].split("/", 1)[0])
            attempt = int(endpoint.rsplit("/", 1)[1])
            result = dict(self.latest_by_id[run_id])
            result["run_attempt"] = attempt
            return result
        if "/actions/runs/" in endpoint:
            run_id = int(endpoint.rsplit("/", 1)[1])
            if run_id not in self.latest_by_id:
                raise M.ReadError("NOT_FOUND")
            return self.latest_by_id[run_id]
        raise AssertionError(endpoint)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.cache = Path(self.directory.name) / "cache.sqlite"

    def tearDown(self): self.directory.cleanup()

    def collect(self, reader):
        return M.collect("twoimo/tzudong", "web-admin-ci.yml", self.cache, reader)

    def test_diagnostic_mode_counts_only_the_four_platform_jobs(self):
        def job(name, step):
            item = jobs()["jobs"][0]
            item["name"] = name
            item["steps"][0]["name"] = step
            return item

        payload = {
            "total_count": 5,
            "jobs": [
                job(name, "Run npm run typecheck:parity")
                for name in sorted(M.PLATFORM_JOBS)
            ] + [job("Admin", "Run npx tsc --noEmit --pretty false")],
        }
        result = self.collect(Reader(job_payload=payload))
        self.assertEqual(result["runs"][0]["executionMode"], "diagnostic")

    def test_execution_mode_requires_all_four_distinct_platform_jobs(self):
        def safe(name, step):
            item = jobs()["jobs"][0]
            item["name"] = name
            item["steps"][0]["name"] = step
            return M.safe_job(item)

        three = [
            safe(name, "Run npm run typecheck:parity")
            for name in sorted(M.PLATFORM_JOBS)[:3]
        ]
        self.assertEqual(M.execution_mode(three), "unknown")
        benchmark = [
            safe(name, "Run npm run typecheck:benchmark")
            for name in sorted(M.PLATFORM_JOBS)
        ]
        self.assertEqual(M.execution_mode(benchmark), "full_benchmark")

    def test_terminal_cache_uses_one_list_request_and_redacts(self):
        first = self.collect(Reader())
        second = self.collect(Reader())
        self.assertEqual(first["collection"]["apiRequests"], 4)
        self.assertEqual(second["collection"]["apiRequests"], 1)
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        serialized = json.dumps(second)
        for value in ["private owner", "private-host", "secret-value"]: self.assertNotIn(value, serialized)
        self.assertEqual(second["runs"][0]["sourceTree"], TREE)

    def test_existing_positional_now_argument_remains_compatible(self):
        captured = datetime(2026, 10, 15, 9, 30, tzinfo=timezone.utc)
        result = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            Reader(),
            20,
            5,
            48,
            captured,
        )
        self.assertEqual(result["capturedAtUtc"], "2026-10-15T09:30:00Z")
        self.assertEqual(result["collection"]["maximumKnownTerminalRunRefreshes"], 20)

    def test_attempt_specific_reads_preserve_prior_failure(self):
        reader = Reader(run(2))
        result = self.collect(reader)
        self.assertEqual([r["attempt"] for r in result["runs"]], [1, 2])
        self.assertEqual(result["runs"][0]["conclusion"], "failure")
        self.assertIn("repos/twoimo/tzudong/actions/runs/1/attempts/1/jobs", reader.endpoints)
        self.assertIn("repos/twoimo/tzudong/actions/runs/1/attempts/2/jobs", reader.endpoints)

    def test_incomplete_job_sets_are_rechecked(self):
        payload = jobs(); payload["total_count"] = 2
        first = self.collect(Reader(job_payload=payload))
        second = self.collect(Reader(job_payload=payload))
        self.assertIn("JOB_SET_INCOMPLETE", first["coverage"]["alerts"])
        self.assertEqual(second["collection"]["refreshedJobSets"], 1)

    def test_empty_completed_success_job_set_is_rechecked(self):
        payload = {"total_count": 0, "jobs": []}
        first = self.collect(Reader(job_payload=payload))
        second = self.collect(Reader(job_payload=payload))
        self.assertIn("JOB_SET_INCOMPLETE", first["coverage"]["alerts"])
        self.assertEqual(first["collection"]["refreshedJobSets"], 1)
        self.assertEqual(second["collection"]["refreshedJobSets"], 1)
        self.assertEqual(second["collection"]["reusedJobSets"], 0)

    def test_success_jobs_without_step_evidence_are_rechecked(self):
        variants = (
            ("missing", lambda job: job.pop("steps")),
            ("null", lambda job: job.update(steps=None)),
            ("empty", lambda job: job.update(steps=[])),
        )
        for index, (name, mutate) in enumerate(variants):
            with self.subTest(name=name):
                payload = jobs()
                mutate(payload["jobs"][0])
                cache = Path(self.directory.name) / f"empty-steps-{index}.sqlite"
                first = M.collect(
                    "twoimo/tzudong", "web-admin-ci.yml", cache,
                    Reader(job_payload=payload),
                )
                second = M.collect(
                    "twoimo/tzudong", "web-admin-ci.yml", cache,
                    Reader(job_payload=payload),
                )
                observation = first["runs"][0]
                self.assertFalse(observation["terminalOutcomeComplete"])
                self.assertFalse(observation["timingUsable"])
                self.assertIn("no_steps", observation["timingExclusionReasons"])
                self.assertEqual(second["collection"]["refreshedJobSets"], 1)
                self.assertEqual(second["collection"]["reusedJobSets"], 0)

    def test_skipped_job_without_steps_does_not_keep_success_run_refreshable(self):
        payload = jobs()
        payload["jobs"][0].update(conclusion="skipped", steps=[])

        first = self.collect(Reader(job_payload=payload))
        second = self.collect(Reader(job_payload=payload))

        self.assertTrue(first["runs"][0]["terminalOutcomeComplete"])
        self.assertTrue(first["runs"][0]["timingUsable"])
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        self.assertEqual(second["collection"]["reusedJobSets"], 1)

    def test_old_terminal_cache_with_empty_steps_is_revalidated(self):
        payload = jobs()
        payload["jobs"][0]["steps"] = []
        first = self.collect(Reader(job_payload=payload))
        self.assertFalse(first["runs"][0]["terminalOutcomeComplete"])
        with closing(sqlite3.connect(self.cache)) as db:
            db.execute("UPDATE runs SET terminal=1")
            db.commit()

        second = self.collect(Reader(job_payload=payload))

        self.assertEqual(second["collection"]["refreshedJobSets"], 1)
        self.assertEqual(second["collection"]["reusedJobSets"], 0)

    def test_falsey_scalar_steps_are_rejected(self):
        for invalid in (False, 0, ""):
            with self.subTest(invalid=invalid):
                payload = jobs()
                payload["jobs"][0]["steps"] = invalid
                with self.assertRaisesRegex(M.ReadError, "INVALID_JOB_STEPS"):
                    self.collect(Reader(job_payload=payload))

    def test_missing_terminal_conclusions_are_rechecked(self):
        variants = (
            ("run", lambda latest, payload: latest.update(conclusion=None)),
            ("job", lambda latest, payload: payload["jobs"][0].update(conclusion=None)),
            ("step", lambda latest, payload: payload["jobs"][0]["steps"][0].update(conclusion=None)),
            (
                "active_skipped_step",
                lambda latest, payload: payload["jobs"][0]["steps"][0].update(
                    status="in_progress", conclusion="skipped",
                    started_at=None, completed_at=None,
                ),
            ),
        )
        for index, (name, mutate) in enumerate(variants):
            with self.subTest(name=name):
                latest = run()
                payload = jobs()
                mutate(latest, payload)
                cache = Path(self.directory.name) / f"{index}.sqlite"
                first = M.collect(
                    "twoimo/tzudong", "web-admin-ci.yml", cache,
                    Reader(latest=latest, job_payload=payload),
                )
                second = M.collect(
                    "twoimo/tzudong", "web-admin-ci.yml", cache,
                    Reader(latest=latest, job_payload=payload),
                )
                self.assertEqual(first["collection"]["refreshedJobSets"], 1)
                self.assertEqual(second["collection"]["refreshedJobSets"], 1)
                self.assertEqual(second["collection"]["reusedJobSets"], 0)

    def test_completed_failure_with_complete_evidence_remains_cached(self):
        first = self.collect(Reader(run(conclusion="failure")))
        second = self.collect(Reader(run(conclusion="failure")))
        self.assertEqual(first["runs"][0]["conclusion"], "failure")
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        self.assertEqual(second["collection"]["reusedJobSets"], 1)

    def test_completed_failure_without_timing_remains_cached(self):
        latest = run(conclusion="failure")
        latest.update(run_started_at=None, updated_at=None)
        payload = jobs(latest["created_at"])
        job = payload["jobs"][0]
        job.update(conclusion="failure", started_at=None, completed_at=None)
        job["steps"][0].update(
            conclusion="failure", started_at=None, completed_at=None
        )

        first = self.collect(Reader(latest, payload))
        second = self.collect(Reader(latest, payload))

        self.assertTrue(first["runs"][0]["terminalOutcomeComplete"])
        self.assertFalse(first["runs"][0]["timingUsable"])
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        self.assertEqual(second["collection"]["reusedJobSets"], 1)

    def test_completed_cancelled_without_jobs_remains_cached(self):
        payload = {"total_count": 0, "jobs": []}
        first = self.collect(Reader(run(conclusion="cancelled"), payload))
        second = self.collect(Reader(run(conclusion="cancelled"), payload))
        self.assertEqual(first["runs"][0]["conclusion"], "cancelled")
        self.assertEqual(second["collection"]["refreshedJobSets"], 0)
        self.assertEqual(second["collection"]["reusedJobSets"], 1)

    def test_missing_active_attempt_does_not_tombstone_completed_attempt(self):
        completed = self.collect(Reader(run(1)))
        self.assertEqual(completed["runs"][0]["conclusion"], "success")

        active = self.collect(Reader(run(2, status="in_progress", conclusion=None)))
        self.assertEqual([item["attempt"] for item in active["runs"]], [1, 2])

        reader = Reader(); reader.empty = True; reader.gone = True
        missing = self.collect(reader)
        attempts = {item["attempt"]: item for item in missing["runs"]}
        self.assertEqual(attempts[1]["status"], "completed")
        self.assertEqual(attempts[1]["conclusion"], "success")
        self.assertNotIn("tombstone", attempts[1])
        self.assertEqual(attempts[2]["status"], "missing")
        self.assertEqual(attempts[2]["conclusion"], "stale")
        self.assertTrue(attempts[2]["tombstone"])

    def test_old_active_run_is_queried_and_404_tombstoned(self):
        self.collect(Reader(run(status="in_progress", conclusion=None)))
        reader = Reader(); reader.empty = True; reader.gone = True
        result = self.collect(reader)
        self.assertIn("RUN_TOMBSTONE", result["coverage"]["alerts"])
        self.assertTrue(result["runs"][0]["tombstone"])
        self.assertIn("repos/twoimo/tzudong/actions/runs/1", reader.endpoints)

    def test_scope_mismatch_does_not_replace_cache(self):
        self.collect(Reader())
        with self.assertRaisesRegex(M.ReadError, "CACHE_SCOPE_MISMATCH"):
            M.collect("someone/else", "web-admin-ci.yml", self.cache, Reader())
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(db.execute("SELECT repository FROM scope").fetchone()[0], "twoimo/tzudong")

    def test_malformed_job_dates_are_not_persisted(self):
        payload = jobs(); payload["jobs"][0]["completed_at"] = "private-diagnostic"
        with self.assertRaisesRegex(M.ReadError, "INVALID_JOB_TIME"):
            self.collect(Reader(job_payload=payload))
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM runs").fetchone()[0], 0)

    def test_incremental_overlap_window_uses_bounded_pagination(self):
        all_runs = [run(run_id=100 + index, minute=44 - index) for index in range(45)]
        reader = PagingReader(all_runs)
        first = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache, reader,
            limit=20, max_pages=1,
        )
        self.assertIn("BOUNDED_RECENT_WINDOW", first["coverage"]["alerts"])
        self.assertEqual(first["coverage"]["listPages"], 1)
        self.assertEqual(first["coverage"]["bootstrapInventoryRunCount"], 20)
        self.assertFalse(first["coverage"]["watermarkAdvanced"])

        second_reader = PagingReader(all_runs)
        second = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            second_reader,
            limit=20,
            max_pages=1,
        )
        self.assertEqual(second["coverage"]["listPages"], 1)
        self.assertEqual(second["coverage"]["uniqueListedRunCount"], 20)
        self.assertEqual(second["coverage"]["bootstrapInventoryRunCount"], 40)
        self.assertFalse(second["coverage"]["incrementalWindowComplete"])
        self.assertFalse(second["coverage"]["historyInventoryComplete"])
        self.assertFalse(second["coverage"]["watermarkAdvanced"])
        self.assertIn(
            "HISTORICAL_RUN_INVENTORY_INCOMPLETE",
            second["coverage"]["alerts"],
        )
        pages = [fields["page"] for endpoint, fields in second_reader.calls if endpoint.endswith("/runs") and "workflows" in endpoint]
        self.assertEqual(pages, [2])
        list_fields = [
            fields
            for endpoint, fields in second_reader.calls
            if endpoint.endswith("/runs") and "workflows" in endpoint
        ]
        self.assertTrue(all(fields["created"].startswith("<=") for fields in list_fields))

        third = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            PagingReader(all_runs), limit=20, max_pages=1,
        )
        self.assertEqual(third["coverage"]["bootstrapInventoryRunCount"], 45)
        self.assertTrue(third["coverage"]["historyInventoryComplete"])
        self.assertTrue(third["coverage"]["createdWindowComplete"])
        self.assertTrue(third["coverage"]["watermarkAdvanced"])
        self.assertEqual(third["coverage"]["watermarkAfter"], all_runs[0]["created_at"])

        incremental_reader = PagingReader(all_runs)
        incremental = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            incremental_reader, limit=20, max_pages=3,
        )
        self.assertTrue(incremental["coverage"]["incrementalWindowComplete"])
        incremental_fields = [
            fields for endpoint, fields in incremental_reader.calls
            if endpoint.endswith("/runs") and "workflows" in endpoint
        ]
        self.assertTrue(
            all(fields["created"].startswith(">=2026-10-09T") for fields in incremental_fields)
        )

    def test_old_known_terminal_rerun_is_found_by_bounded_direct_refresh(self):
        original = run(run_id=1, minute=0)
        first = self.collect(Reader(original))
        self.assertTrue(first["coverage"]["historyInventoryComplete"])

        rerun = dict(original)
        rerun.update(
            run_attempt=2,
            run_started_at="2026-10-15T08:00:00Z",
            updated_at="2026-10-15T08:01:00Z",
        )
        recent = run(run_id=2, minute=60)
        reader = DiscoveryReader([recent], {1: rerun, 2: recent})
        result = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            reader,
            terminal_probe_limit=1,
        )

        attempts = {(item["id"], item["attempt"]): item for item in result["runs"]}
        self.assertIn((1, 2), attempts)
        self.assertEqual(attempts[(1, 2)]["createdAt"], original["created_at"])
        self.assertEqual(attempts[(1, 2)]["updatedAt"], rerun["updated_at"])
        self.assertIn("repos/twoimo/tzudong/actions/runs/1", reader.endpoints)
        self.assertTrue(result["coverage"]["createdWindowComplete"])
        self.assertTrue(result["coverage"]["knownTerminalRerunRefreshComplete"])
        self.assertTrue(result["coverage"]["incrementalWindowComplete"])

    def test_terminal_refresh_round_robin_has_exact_tick_and_read_bounds(self):
        originals = [run(run_id=10), run(run_id=20, minute=1)]
        M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader(originals),
            limit=2,
            terminal_probe_limit=1,
        )

        first_reader = DiscoveryReader([], {10: originals[0], 20: originals[1]})
        first = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            first_reader,
            terminal_probe_limit=1,
        )
        second_reader = DiscoveryReader([], {10: originals[0], 20: originals[1]})
        second = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            second_reader,
            terminal_probe_limit=1,
        )
        third_reader = DiscoveryReader([], {10: originals[0], 20: originals[1]})
        third = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            third_reader,
            terminal_probe_limit=1,
        )

        self.assertEqual(first["coverage"]["knownTerminalRunCount"], 2)
        self.assertEqual(first["coverage"]["knownTerminalRunsExamined"], 1)
        self.assertEqual(first["coverage"]["knownTerminalRunApiReads"], 1)
        self.assertEqual(first["coverage"]["knownTerminalRerunMaxDiscoveryTicks"], 2)
        self.assertFalse(first["coverage"]["incrementalWindowComplete"])
        self.assertIn(
            "KNOWN_TERMINAL_RERUN_REFRESH_INCOMPLETE",
            first["coverage"]["alerts"],
        )
        direct_first = [
            endpoint
            for endpoint in first_reader.endpoints
            if endpoint.endswith("/actions/runs/10")
            or endpoint.endswith("/actions/runs/20")
        ]
        direct_second = [
            endpoint
            for endpoint in second_reader.endpoints
            if endpoint.endswith("/actions/runs/10")
            or endpoint.endswith("/actions/runs/20")
        ]
        self.assertEqual(direct_first, ["repos/twoimo/tzudong/actions/runs/10"])
        self.assertEqual(direct_second, ["repos/twoimo/tzudong/actions/runs/20"])
        self.assertEqual(second["coverage"]["knownTerminalRunsExamined"], 2)
        self.assertEqual(second["coverage"]["knownTerminalRunsExaminedThisTick"], 1)
        self.assertTrue(second["coverage"]["knownTerminalRerunRefreshComplete"])
        self.assertTrue(second["coverage"]["incrementalWindowComplete"])
        self.assertNotIn(
            "KNOWN_TERMINAL_RERUN_REFRESH_INCOMPLETE",
            second["coverage"]["alerts"],
        )
        self.assertEqual(third["coverage"]["knownTerminalRunsExamined"], 1)
        self.assertFalse(third["coverage"]["knownTerminalRerunRefreshComplete"])
        self.assertFalse(third["coverage"]["incrementalWindowComplete"])

    def test_created_window_list_can_cover_terminal_ids_beyond_probe_slice(self):
        originals = [run(run_id=21), run(run_id=22, minute=1)]
        M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader(originals),
            limit=2,
            terminal_probe_limit=1,
        )

        reader = DiscoveryReader(originals, {item["id"]: item for item in originals})
        result = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            reader,
            limit=2,
            terminal_probe_limit=1,
        )

        self.assertEqual(result["coverage"]["knownTerminalRunCount"], 2)
        self.assertEqual(result["coverage"]["knownTerminalRunsExamined"], 2)
        self.assertEqual(result["coverage"]["knownTerminalRunApiReads"], 0)
        self.assertTrue(result["coverage"]["knownTerminalRerunRefreshComplete"])
        self.assertTrue(result["coverage"]["incrementalWindowComplete"])

    def test_terminal_refresh_progress_survives_append_only_inventory_growth(self):
        originals = [
            run(run_id=10),
            run(run_id=20, minute=1),
            run(run_id=30, minute=2),
        ]
        M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            PagingReader(originals), terminal_probe_limit=1,
        )
        latest = {item["id"]: item for item in originals}
        first = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            DiscoveryReader([], latest), terminal_probe_limit=1,
        )
        self.assertEqual(first["coverage"]["knownTerminalRunsExamined"], 1)

        added = run(run_id=40, minute=3)
        latest[40] = added
        growth = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            DiscoveryReader([added], latest), terminal_probe_limit=1,
        )
        self.assertEqual(growth["coverage"]["knownTerminalRunsExamined"], 2)

        continued = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            DiscoveryReader([], latest), terminal_probe_limit=1,
        )
        self.assertEqual(continued["coverage"]["knownTerminalRunCount"], 4)
        self.assertEqual(continued["coverage"]["knownTerminalRunsExamined"], 3)
        self.assertFalse(continued["coverage"]["knownTerminalRerunRefreshComplete"])

        completed = M.collect(
            "twoimo/tzudong", "web-admin-ci.yml", self.cache,
            DiscoveryReader([], latest), terminal_probe_limit=1,
        )
        self.assertEqual(completed["coverage"]["knownTerminalRunsExamined"], 4)
        self.assertTrue(completed["coverage"]["knownTerminalRerunRefreshComplete"])
        self.assertTrue(completed["coverage"]["incrementalWindowComplete"])

    def test_never_inventoried_old_rerun_keeps_coverage_incomplete(self):
        visible = run(run_id=30)
        hidden = run(attempt=2, run_id=99, minute=-10_000)
        M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader([visible, run(run_id=31, minute=-1)]),
            limit=1,
            max_pages=1,
        )

        reader = DiscoveryReader([], {30: visible, 99: hidden})
        result = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            reader,
            terminal_probe_limit=1,
        )

        self.assertNotIn(99, {item["id"] for item in result["runs"]})
        self.assertNotIn("repos/twoimo/tzudong/actions/runs/99", reader.endpoints)
        self.assertFalse(result["coverage"]["historyInventoryComplete"])
        self.assertFalse(
            result["coverage"]["unlistedHistoricalRerunDiscoveryComplete"]
        )
        self.assertFalse(result["coverage"]["incrementalWindowComplete"])
        self.assertIn(
            "HISTORICAL_RUN_INVENTORY_INCOMPLETE",
            result["coverage"]["alerts"],
        )

    def test_truncated_incremental_window_does_not_advance_watermark(self):
        initial_runs = [run(run_id=200 + index, minute=19 - index) for index in range(20)]
        first = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            PagingReader(initial_runs),
            limit=20,
            max_pages=2,
        )
        watermark = first["coverage"]["watermarkAfter"]
        expanded_runs = [run(run_id=999, minute=30)] + [
            run(run_id=300 + index, minute=29 - index) for index in range(60)
        ]
        second = M.collect(
            "twoimo/tzudong",
            "web-admin-ci.yml",
            self.cache,
            DiscoveryReader(
                expanded_runs,
                {item["id"]: item for item in initial_runs + expanded_runs},
            ),
            limit=20,
            max_pages=2,
        )
        self.assertIn("RECENT_WINDOW_TRUNCATED", second["coverage"]["alerts"])
        self.assertFalse(second["coverage"]["incrementalWindowComplete"])
        self.assertFalse(second["coverage"]["watermarkAdvanced"])
        self.assertEqual(second["coverage"]["watermarkBefore"], watermark)
        self.assertEqual(second["coverage"]["watermarkAfter"], watermark)
        with closing(sqlite3.connect(self.cache)) as db:
            self.assertEqual(
                db.execute("SELECT value FROM meta WHERE key='watermark'").fetchone()[0],
                watermark,
            )

    def test_pagination_and_overlap_bounds_fail_closed(self):
        with self.assertRaisesRegex(M.ReadError, "INVALID_PAGE_BOUND"):
            M.collect(
                "twoimo/tzudong",
                "web-admin-ci.yml",
                self.cache,
                Reader(),
                max_pages=11,
            )
        with self.assertRaisesRegex(M.ReadError, "INVALID_OVERLAP_BOUND"):
            M.collect(
                "twoimo/tzudong",
                "web-admin-ci.yml",
                self.cache,
                Reader(),
                overlap_hours=0,
            )
        with self.assertRaisesRegex(M.ReadError, "INVALID_TERMINAL_PROBE_BOUND"):
            M.collect(
                "twoimo/tzudong",
                "web-admin-ci.yml",
                self.cache,
                Reader(),
                terminal_probe_limit=101,
            )

    def test_list_total_smaller_than_page_fails_closed(self):
        class InvalidListReader(Reader):
            def get(self, endpoint, fields=None):
                if endpoint.endswith("/web-admin-ci.yml/runs"):
                    return {"total_count": 0, "workflow_runs": [run()]}
                return super().get(endpoint, fields)

        with self.assertRaisesRegex(M.ReadError, "INVALID_RUN_LIST"):
            self.collect(InvalidListReader())


if __name__ == "__main__": unittest.main()
