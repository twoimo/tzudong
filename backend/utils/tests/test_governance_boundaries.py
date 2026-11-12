"""Governance-boundary source contracts and executable workflow tests.

Feature: crawler-pipeline-orchestration

These tests cover Requirement 9 (governance-consistent change and reflection
boundaries). Compute-binding cases execute the workflow shell against isolated
local Git repositories; no repository source file is modified by these tests.

  * GovernanceBackendOnlyLongRunningWorkTest  -> Task 11.1 (R9.1)
  * GovernanceComputeBindingTest             -> Task 11.3 (R9.5)
  * GovernanceWorkflowRefGuardTest            -> Task 11.3 (R9.5, R5.3)
  * GovernanceAppliedMigrationImmutabilityTest -> Task 11.4 (R9.7)

Run with:  python3 -m unittest backend.utils.tests.test_governance_boundaries
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


# tests -> utils -> backend -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[3]

WEB_API_ROOT = REPO_ROOT / "apps" / "web" / "app" / "api"
WORKFLOWS_ROOT = REPO_ROOT / ".github" / "workflows"
MIGRATIONS_ROOT = REPO_ROOT / "backend" / "supabase" / "migrations"


# ---------------------------------------------------------------------------
# Task 11.1 (R9.1): backend-only long-running work.
#
# R9.1 requires that all long-running crawler, media/ffmpeg, model-bulk (Gemini),
# backup/GDrive, and batch-insert work runs exclusively in the backend runners and
# is never invoked from web route handlers. This test enforces that boundary at the
# source level by scanning every Next.js route handler (`route.ts`) for import /
# require / dynamic-import module specifiers and asserting none of them reference a
# forbidden long-running backend module category.
# ---------------------------------------------------------------------------

# Regexes matched (case-insensitively) against the *module specifier* string only
# (the value inside the quotes of `from "..."`, `require("...")`, `import("...")`),
# grouped by the R9.1 forbidden category. Patterns are intentionally specific so that
# legitimate lite imports (e.g. `@/lib/ocr/gemini`, `@/lib/admin/pipeline-control`)
# are never mistaken for a forbidden long-running module.
_FORBIDDEN_IMPORT_PATTERNS: dict[str, list[str]] = {
    "crawler": [
        r"restaurant-crawling",
        r"(^|[/\\])crawler([/\\]|$)",
        r"daily-crawl",
    ],
    "ffmpeg": [
        r"ffmpeg",
    ],
    "gemini-bulk": [
        r"gemini-bulk",
        r"gemini_bulk",
        r"chunk-multimodal",
        r"chunk_multimodal",
    ],
    "gdrive": [
        r"gdrive",
        r"google-drive",
        r"googleapis",
        r"rclone",
        r"frame-backfill",
    ],
    "batch-insert": [
        r"batch-insert",
        r"batch_insert",
        r"batch-upsert",
    ],
}

# Matches the module specifier of ES imports/exports, CommonJS require, and dynamic
# import(): captures the string literal between matching quotes.
_SPECIFIER_RE = re.compile(
    r"""(?:\bfrom|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]"""
)


def _iter_route_files() -> list[Path]:
    """Return every Next.js route handler under apps/web/app/api."""
    return sorted(WEB_API_ROOT.rglob("route.ts"))


def _import_specifiers(source: str) -> list[str]:
    """Return every import/require/dynamic-import module specifier in `source`."""
    return _SPECIFIER_RE.findall(source)


class GovernanceBackendOnlyLongRunningWorkTest(unittest.TestCase):
    """Task 11.1 / R9.1: route handlers must not import long-running backend modules."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.route_files = _iter_route_files()
        cls.compiled = {
            category: [re.compile(p, re.IGNORECASE) for p in patterns]
            for category, patterns in _FORBIDDEN_IMPORT_PATTERNS.items()
        }

    def test_route_handlers_are_discoverable(self) -> None:
        # Guard against a silently-empty scan (e.g. a moved app dir) turning the
        # forbidden-import assertion into a vacuous pass.
        self.assertTrue(
            WEB_API_ROOT.is_dir(),
            msg=f"web route handler root not found at {WEB_API_ROOT}",
        )
        self.assertTrue(
            self.route_files,
            msg=f"no route.ts handlers discovered under {WEB_API_ROOT}",
        )
        # A representative orchestration-adjacent handler must be part of the scan.
        pipeline_route = WEB_API_ROOT / "admin" / "pipeline" / "route.ts"
        self.assertIn(
            pipeline_route,
            self.route_files,
            msg="expected admin/pipeline/route.ts to be scanned",
        )

    def test_no_route_handler_imports_forbidden_backend_module(self) -> None:
        violations: list[str] = []
        for route in self.route_files:
            specifiers = _import_specifiers(route.read_text(encoding="utf-8"))
            for specifier in specifiers:
                for category, patterns in self.compiled.items():
                    if any(p.search(specifier) for p in patterns):
                        rel = route.relative_to(REPO_ROOT)
                        violations.append(f"{rel}: [{category}] import '{specifier}'")
        self.assertEqual(
            violations,
            [],
            msg=(
                "web route handlers must not import long-running crawler / ffmpeg / "
                "Gemini-bulk / GDrive / batch-insert modules (R9.1); found:\n"
                + "\n".join(violations)
            ),
        )


# ---------------------------------------------------------------------------
# Task 11.3 (R9.5, R5.3): default-branch-only scheduled execution + manifest evidence.
#
# R9.5 requires that scheduled orchestration workflows execute only the default-branch,
# branch-protected definition. R5.3 requires that the scheduled crawler publishes the
# Run_Manifest (`current-summary.json`) as evidence. This test parses the scheduled
# workflow definitions and asserts:
#   (1) every scheduled *entry* job (a job with no `needs`, reachable directly from the
#       schedule/dispatch trigger) guards on
#       `github.ref_name == github.event.repository.default_branch && github.ref_protected`;
#   (2) the crawler workflow references `backend/log/cron/current-summary.json` among the
#       cron evidence paths it publishes.
# ---------------------------------------------------------------------------

DAILY_CRAWLER_WORKFLOW = WORKFLOWS_ROOT / "daily-crawler.yml"
GDRIVE_BACKFILL_WORKFLOW = WORKFLOWS_ROOT / "gdrive-frame-backfill.yml"

_REF_NAME_GUARD_RE = re.compile(
    r"github\.ref_name\s*==\s*github\.event\.repository\.default_branch"
)
_REF_PROTECTED_GUARD_RE = re.compile(r"github\.ref_protected")
_EVIDENCE_PATH_RE = re.compile(r"backend/log/cron/[^\s'\"]+")
# The Run_Manifest summary path, as bound in the crawler workflow's upload step
# (`SUMMARY_MANIFEST="$UPLOAD_LOG_DIR/current-summary.json"`, UPLOAD_LOG_DIR=backend/log/cron).
_SUMMARY_MANIFEST_BINDING_RE = re.compile(
    r"UPLOAD_LOG_DIR\}?/current-summary\.json"
)
_SUMMARY_MANIFEST_CONSUMED_RE = re.compile(r"--summary-manifest")
# The status manifest derived from the Run_Manifest that is uploaded as an artifact.
_UPLOADED_STATUS_MANIFEST = "backend/log/cron/current-upload-status.json"
# The Run_Manifest itself, published directly in an upload-artifact path list
# (finalized in Task 12.1), and its derived run-health outcome.
_UPLOADED_RUN_MANIFEST = "backend/log/cron/current-summary.json"
_UPLOADED_HEALTH_OUTCOME = "backend/log/cron/current-health.json"


def _load_workflow(path: Path) -> dict:
    import yaml

    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _workflow_triggers(doc: dict) -> object:
    # PyYAML parses the bare `on:` key as the boolean True (YAML 1.1 semantics), so
    # look it up under both the string and boolean keys.
    if "on" in doc:
        return doc["on"]
    return doc.get(True)


def _entry_jobs(doc: dict) -> dict[str, dict]:
    """Jobs reachable directly from a trigger: those with no (or empty) `needs`."""
    jobs = doc.get("jobs") or {}
    entry: dict[str, dict] = {}
    for name, spec in jobs.items():
        if not isinstance(spec, dict):
            continue
        needs = spec.get("needs")
        if not needs:  # None, missing, or empty list -> entry job
            entry[name] = spec
    return entry


class GovernanceComputeBindingTest(unittest.TestCase):
    """Execute the workflow's source/data binding against local Git repositories."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.git_bin = shutil.which("git")
        cls.bash_bin = shutil.which("bash")
        if not cls.git_bin or not cls.bash_bin:
            raise unittest.SkipTest("compute binding requires Git and Bash")
        compute = _load_workflow(DAILY_CRAWLER_WORKFLOW)["jobs"]["daily-compute"]
        matches = [step for step in compute["steps"] if step.get("id") == "bind"]
        if len(matches) != 1:
            raise AssertionError("expected exactly one daily compute binding step")
        cls.bind_step = matches[0]

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.origin = self.root / "origin.git"
        self.origin.mkdir()
        self.checkout = self.root / "checkout"
        self.output_path = self.root / "github-output"
        # Only local file transport is allowed. Ignore operator Git configuration
        # and use fixture identities/token without inheriting credentials.
        self.command_env = {
            "PATH": os.environ.get("PATH", os.defpath),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ALLOW_PROTOCOL": "file",
            "GIT_AUTHOR_NAME": "Compute Binding Test",
            "GIT_AUTHOR_EMAIL": "compute-binding@example.invalid",
            "GIT_COMMITTER_NAME": "Compute Binding Test",
            "GIT_COMMITTER_EMAIL": "compute-binding@example.invalid",
        }
        for name in ("SYSTEMROOT", "WINDIR", "TMP", "TEMP"):
            if name in os.environ:
                self.command_env[name] = os.environ[name]
        self._git("init", "--bare", "--initial-branch=main", repository=self.origin)
        self.trigger_sha, _ = self._origin_commit("trusted compute source\n")
        self._git("update-ref", "refs/heads/main", self.trigger_sha, repository=self.origin)
        self._git(
            "clone", "--single-branch", "--branch", "main",
            str(self.origin), str(self.checkout), repository=self.root,
        )
        self._git("checkout", "--detach", self.trigger_sha)

    def _git(
        self,
        *arguments: str,
        repository: Path | None = None,
        input_text: str | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [self.git_bin, "-C", str(repository or self.checkout), *arguments],
            input=input_text,
            capture_output=True,
            text=True,
            env=self.command_env,
            timeout=10,
            check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def _origin_commit(self, contents: str, *, parent: str | None = None) -> tuple[str, str]:
        blob = self._git(
            "hash-object", "-w", "--stdin", repository=self.origin, input_text=contents,
        ).stdout.strip()
        tree = self._git(
            "mktree", repository=self.origin,
            input_text=f"100644 blob {blob}\tfixture.txt\n",
        ).stdout.strip()
        arguments = ["commit-tree", tree, "-m", "local workflow fixture"]
        if parent is not None:
            arguments.extend(("-p", parent))
        commit = self._git(*arguments, repository=self.origin).stdout.strip()
        return commit, tree

    def _run_bind(
        self,
        *,
        flag: str | None = None,
        overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        self.output_path.write_text("", encoding="utf-8")
        env = {
            **self.command_env,
            "READ_TOKEN": "local-binding-test-token",
            "GITHUB_REPOSITORY": "twoimo/tzudong",
            "CANONICAL_REPOSITORY": "twoimo/tzudong",
            "DEFAULT_BRANCH": "main",
            "TRIGGER_SHA": self.trigger_sha,
            "REF_NAME": "main",
            "REF_PROTECTED": "true",
            "TARGET_BRANCH": "data",
            "GITHUB_OUTPUT": str(self.output_path),
        }
        if flag is not None:
            env["TZUDONG_DATA_BRANCH_PUBLISH"] = flag
        env.update(overrides or {})
        return subprocess.run(
            [self.bash_bin, "-c", self.bind_step["run"]],
            cwd=self.checkout,
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
            check=False,
        )

    def _assert_no_binding_outputs(self) -> None:
        self.assertEqual(self.output_path.read_text(encoding="utf-8"), "")

    def _assert_head(self, expected: str) -> None:
        self.assertEqual(self._git("rev-parse", "HEAD").stdout.strip(), expected)

    def test_binding_uses_repository_opt_in_without_skipping_source_verification(self) -> None:
        self.assertNotIn("if", self.bind_step)
        self.assertEqual(self.bind_step["name"], "Bind trusted compute source and data base")
        self.assertEqual(self.bind_step["env"], {
            "READ_TOKEN": "${{ github.token }}",
            "CANONICAL_REPOSITORY": "${{ github.event.repository.full_name }}",
            "DEFAULT_BRANCH": "${{ github.event.repository.default_branch }}",
            "TRIGGER_SHA": "${{ github.sha }}",
            "REF_NAME": "${{ github.ref_name }}",
            "REF_PROTECTED": "${{ github.ref_protected }}",
            "TARGET_BRANCH": "data",
            "TZUDONG_DATA_BRANCH_PUBLISH": "${{ vars.TZUDONG_DATA_BRANCH_PUBLISH }}",
        })

    def test_disabled_publication_needs_no_data_branch_or_binding_outputs(self) -> None:
        for flag in (None, "", "0", "01", "1 ", " 1", "true", "TRUE", "yes", "enabled"):
            with self.subTest(flag=flag):
                # Require a fresh default-branch fetch on every invocation; no
                # remote or cached data ref exists to satisfy an accidental read.
                self._git("update-ref", "-d", "refs/remotes/origin/main")
                result = self._run_bind(flag=flag)
                self.assertEqual(result.returncode, 0, result.stderr)
                self._assert_no_binding_outputs()
                self._assert_head(self.trigger_sha)
                self.assertEqual(
                    self._git("rev-parse", "origin/main").stdout.strip(), self.trigger_sha,
                )
                self.assertNotEqual(
                    self._git("show-ref", "--verify", "refs/remotes/origin/data", check=False).returncode,
                    0,
                )

    def test_enabled_publication_requires_remote_data_even_when_a_stale_ref_is_cached(self) -> None:
        for cached in (False, True):
            with self.subTest(cached=cached):
                if cached:
                    stale_sha, _ = self._origin_commit("stale data snapshot\n")
                    self._git("update-ref", "refs/heads/data", stale_sha, repository=self.origin)
                    self._git("fetch", "origin", "refs/heads/data:refs/remotes/origin/data")
                    self._git("update-ref", "-d", "refs/heads/data", repository=self.origin)
                result = self._run_bind(flag="1")
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self._assert_no_binding_outputs()
                self._assert_head(self.trigger_sha)

    def test_enabled_publication_binds_fresh_data_sha_tree_without_changing_source(self) -> None:
        stale_sha, _ = self._origin_commit("previous independent data snapshot\n")
        self._git("update-ref", "refs/heads/data", stale_sha, repository=self.origin)
        self._git("fetch", "origin", "refs/heads/data:refs/remotes/origin/data")
        data_sha, data_tree = self._origin_commit("current data snapshot\n", parent=stale_sha)
        self._git("update-ref", "refs/heads/data", data_sha, repository=self.origin)

        result = self._run_bind(flag="1")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.output_path.read_text(encoding="utf-8"),
            f"base_sha={data_sha}\nbase_tree={data_tree}\n",
        )
        self.assertEqual(self._git("rev-parse", "origin/data").stdout.strip(), data_sha)
        self._assert_head(self.trigger_sha)

    def test_disabled_publication_still_rejects_source_identity_mismatches(self) -> None:
        mismatches = {
            "GITHUB_REPOSITORY": "untrusted/repository",
            "CANONICAL_REPOSITORY": "untrusted/repository",
            "REF_NAME": "data",
            "REF_PROTECTED": "false",
            "TRIGGER_SHA": "0" * 40,
        }
        for name, value in mismatches.items():
            with self.subTest(environment=name):
                result = self._run_bind(overrides={name: value})
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self._assert_no_binding_outputs()
                self._assert_head(self.trigger_sha)

    def test_disabled_publication_rejects_trigger_outside_default_branch_history(self) -> None:
        untrusted_sha, _ = self._origin_commit("untrusted source outside main\n")
        self._git("update-ref", "refs/heads/untrusted", untrusted_sha, repository=self.origin)
        self._git("fetch", "origin", "refs/heads/untrusted")
        self._git("checkout", "--detach", untrusted_sha)

        result = self._run_bind(overrides={"TRIGGER_SHA": untrusted_sha})

        self.assertNotEqual(result.returncode, 0, result.stderr)
        self._assert_no_binding_outputs()
        self._assert_head(untrusted_sha)

    def test_disabled_publication_requires_remote_default_branch_despite_cached_ref(self) -> None:
        self._git("update-ref", "-d", "refs/heads/main", repository=self.origin)

        result = self._run_bind()

        self.assertNotEqual(result.returncode, 0, result.stderr)
        self._assert_no_binding_outputs()
        self._assert_head(self.trigger_sha)

    def test_disabled_publication_accepts_trigger_ancestor_of_fresh_default_tip(self) -> None:
        default_sha, _ = self._origin_commit("advanced trusted source\n", parent=self.trigger_sha)
        self._git("update-ref", "refs/heads/main", default_sha, repository=self.origin)

        result = self._run_bind()

        self.assertEqual(result.returncode, 0, result.stderr)
        self._assert_no_binding_outputs()
        self.assertEqual(self._git("rev-parse", "origin/main").stdout.strip(), default_sha)
        self._assert_head(self.trigger_sha)


class GovernanceWorkflowRefGuardTest(unittest.TestCase):
    """Task 11.3 / R9.5 + R5.3: scheduled jobs are default-branch guarded and publish the manifest."""

    def _assert_scheduled_entry_jobs_are_ref_guarded(self, path: Path) -> None:
        self.assertTrue(path.is_file(), msg=f"workflow not found: {path}")
        doc = _load_workflow(path)

        triggers = _workflow_triggers(doc)
        self.assertIsInstance(
            triggers, dict, msg=f"{path.name}: could not parse workflow triggers"
        )
        self.assertIn(
            "schedule",
            triggers,
            msg=f"{path.name}: expected a scheduled (cron) trigger",
        )

        entry_jobs = _entry_jobs(doc)
        self.assertTrue(
            entry_jobs, msg=f"{path.name}: no entry jobs (jobs without `needs`) found"
        )

        for name, spec in entry_jobs.items():
            condition = spec.get("if")
            self.assertIsInstance(
                condition,
                str,
                msg=f"{path.name}:{name} scheduled entry job has no `if` guard",
            )
            normalized = " ".join(condition.split())
            self.assertRegex(
                normalized,
                _REF_NAME_GUARD_RE,
                msg=(
                    f"{path.name}:{name} entry job must guard on "
                    "github.ref_name == github.event.repository.default_branch (R9.5)"
                ),
            )
            self.assertRegex(
                normalized,
                _REF_PROTECTED_GUARD_RE,
                msg=(
                    f"{path.name}:{name} entry job must guard on github.ref_protected "
                    "(R9.5)"
                ),
            )

    def test_daily_crawler_scheduled_jobs_are_ref_guarded(self) -> None:
        self._assert_scheduled_entry_jobs_are_ref_guarded(DAILY_CRAWLER_WORKFLOW)

    def test_gdrive_backfill_scheduled_jobs_are_ref_guarded(self) -> None:
        self._assert_scheduled_entry_jobs_are_ref_guarded(GDRIVE_BACKFILL_WORKFLOW)

    def test_active_write_freeze_blocks_every_crawler_and_backfill_job(self) -> None:
        import ast

        replacements = {
            "github.repository": "twoimo/tzudong",
            "github.event.repository.full_name": "twoimo/tzudong",
            "github.ref_name": "main",
            "github.event.repository.default_branch": "main",
            "github.ref_protected": True,
            "github.event.workflow_run.conclusion": "success",
            "github.event.workflow_run.event": "schedule",
            "github.event.workflow_run.head_branch": "main",
            "github.event.workflow_run.head_repository.full_name": "twoimo/tzudong",
            "vars.TZUDONG_HOSTED_DATA_PLANE_APPROVED": "1",
            "vars.TZUDONG_DATA_BRANCH_PUBLISH": "1",
            "needs.daily-compute.outputs.publication_ready": "true",
            "needs.daily-compute.outputs.publication_manifest_sha256": "a" * 64,
        }
        for path in (DAILY_CRAWLER_WORKFLOW, GDRIVE_BACKFILL_WORKFLOW):
            for name, job in _load_workflow(path)["jobs"].items():
                if name == "hosted-pending-apply":
                    continue
                for event in ("schedule", "workflow_dispatch", "workflow_run"):
                    for freeze in ("active", "cleared"):
                        with self.subTest(workflow=path.name, job=name, event=event, freeze=freeze):
                            expression = " ".join(job["if"].split()).removeprefix("${{").removesuffix("}}").strip()
                            values = {**replacements, "github.event_name": event, "vars.G037_WRITE_FREEZE": freeze}
                            for key in sorted(values, key=len, reverse=True):
                                expression = expression.replace(key, repr(values[key]))
                            expression = expression.replace("always()", "True").replace("&&", "and").replace("||", "or")
                            tree = ast.parse(expression, mode="eval")
                            allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.NotEq, ast.Constant)
                            self.assertTrue(all(isinstance(node, allowed) for node in ast.walk(tree)))
                            self.assertIs(eval(compile(tree, "<workflow-condition>", "eval"), {"__builtins__": {}}, {}), freeze != "active")
        pending = _load_workflow(DAILY_CRAWLER_WORKFLOW)["jobs"]["hosted-pending-apply"]["if"]
        expression = " ".join(pending.split()).removeprefix("${{").removesuffix("}}").strip()
        values = {**replacements, "vars.G037_WRITE_FREEZE": "active"}
        for key in sorted(values, key=len, reverse=True):
            expression = expression.replace(key, repr(values[key]))
        expression = expression.replace("&&", "and")
        tree = ast.parse(expression, mode="eval")
        self.assertIs(eval(compile(tree, "<workflow-condition>", "eval"), {"__builtins__": {}}, {}), True)

    def test_public_repository_data_publication_requires_explicit_opt_in(self) -> None:
        condition = _load_workflow(DAILY_CRAWLER_WORKFLOW)["jobs"]["daily-publish"]["if"]
        self.assertIn("vars.TZUDONG_DATA_BRANCH_PUBLISH == '1'", condition)

    def test_data_artifact_upload_also_requires_explicit_opt_in(self) -> None:
        import ast
        steps = _load_workflow(DAILY_CRAWLER_WORKFLOW)['jobs']['daily-compute']['steps']
        upload = next(step for step in steps if step.get('id') == 'upload-publication')
        for ready in ('true', 'false'):
            for enabled in ('1', '0', ''):
                with self.subTest(ready=ready, enabled=enabled):
                    expression = upload['if'].removeprefix('${{').removesuffix('}}').strip()
                    expression = expression.replace('steps.publication.outputs.ready',repr(ready))
                    expression = expression.replace('vars.TZUDONG_DATA_BRANCH_PUBLISH',repr(enabled)).replace('&&','and')
                    tree = ast.parse(expression,mode='eval')
                    allowed = (ast.Expression,ast.BoolOp,ast.And,ast.Compare,ast.Eq,ast.Constant)
                    self.assertTrue(all(isinstance(node,allowed) for node in ast.walk(tree)))
                    self.assertIs(eval(compile(tree,'<artifact-condition>','eval'),{'__builtins__':{}},{}),
                                  ready == 'true' and enabled == '1')

    def test_daily_crawler_wires_run_manifest_into_published_evidence(self) -> None:
        # R5.3: the scheduled crawler must publish the Run_Manifest
        # (current-summary.json) as evidence. In the current source the crawler binds
        # the Run_Manifest under the cron evidence directory
        # (SUMMARY_MANIFEST="$UPLOAD_LOG_DIR/current-summary.json"), feeds it to the
        # evidence writer via `--summary-manifest`, and uploads the resulting status
        # manifest (current-upload-status.json) as an actions/upload-artifact. This
        # asserts that end-to-end wiring.
        #
        # Task 12.1 finalizes this: backend/log/cron/current-summary.json is now
        # published directly in an upload-artifact `path:` list, alongside the
        # derived run-health outcome; the status manifest remains published too.
        text = DAILY_CRAWLER_WORKFLOW.read_text(encoding="utf-8")

        self.assertRegex(
            text,
            _SUMMARY_MANIFEST_BINDING_RE,
            msg=(
                "daily-crawler.yml must bind the Run_Manifest current-summary.json "
                "under the cron evidence directory (R5.3)"
            ),
        )
        self.assertRegex(
            text,
            _SUMMARY_MANIFEST_CONSUMED_RE,
            msg=(
                "daily-crawler.yml must feed the Run_Manifest into the evidence "
                "writer via --summary-manifest (R5.3)"
            ),
        )

        evidence_paths = set(_EVIDENCE_PATH_RE.findall(text))
        self.assertIn(
            _UPLOADED_STATUS_MANIFEST,
            evidence_paths,
            msg=(
                "daily-crawler.yml must publish the Run_Manifest-derived status "
                f"manifest {_UPLOADED_STATUS_MANIFEST} as an uploaded artifact (R5.3)"
            ),
        )
        # Tightened under Task 12.1: the Run_Manifest and its derived run-health
        # outcome are now published directly in an upload-artifact path list.
        self.assertIn(
            _UPLOADED_RUN_MANIFEST,
            evidence_paths,
            msg=(
                "daily-crawler.yml must publish the Run_Manifest "
                f"{_UPLOADED_RUN_MANIFEST} directly as an uploaded artifact (R5.3)"
            ),
        )
        self.assertIn(
            _UPLOADED_HEALTH_OUTCOME,
            evidence_paths,
            msg=(
                "daily-crawler.yml must publish the run-health outcome "
                f"{_UPLOADED_HEALTH_OUTCOME} as an uploaded artifact (R5.3, R5.7)"
            ),
        )


# ---------------------------------------------------------------------------
# Task 11.4 (R9.7): applied-migration immutability + additive R4 constraint.
#
# R9.7 requires that an already-applied Supabase migration is never modified, deleted,
# or overwritten; a correction or new constraint is a NEW additive migration file. The
# R4 concurrency constraint (Task 5.1) is the migration
# `20260828000100_hosted_candidate_identity_unique.sql`. This test asserts that file
# exists, is purely additive (creates a new object; performs no drop/alter/destructive
# operation on prior migration objects), introduces an object name not created by any
# prior migration, and remains ordered after the prior applied migration it extends.
# Later additive migrations are allowed to sort after the R4 migration; otherwise this
# historical immutability check would break every time a legitimate migration is added.
# ---------------------------------------------------------------------------

NEW_R4_MIGRATION = "20260828000100_hosted_candidate_identity_unique.sql"
NEW_R4_INDEX_NAME = "idx_restaurants_active_candidate_identity"

# The already-applied migration that first introduced the narrower composite candidate
# identity index; the additive R4 migration references it and must not remove it.
REFERENCED_PRIOR_MIGRATION = (
    "20260417_prevent_active_restaurant_identity_duplicates.sql"
)

_DESTRUCTIVE_STATEMENT_RES = [
    re.compile(r"\bdrop\b", re.IGNORECASE),
    re.compile(r"\balter\b", re.IGNORECASE),
    re.compile(r"\btruncate\b", re.IGNORECASE),
    re.compile(r"\bdelete\s+from\b", re.IGNORECASE),
]
_CREATE_INDEX_RE = re.compile(r"\bcreate\b[^;]*\bindex\b", re.IGNORECASE)
_CREATE_R4_INDEX_RE = re.compile(
    rf"\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?"
    rf"(?:if\s+not\s+exists\s+)?(?:public\.)?{re.escape(NEW_R4_INDEX_NAME)}\b",
    re.IGNORECASE,
)


def _strip_sql_comments(sql: str) -> str:
    """Return the SQL text with `--` line comments removed.

    The comment prose in the migration intentionally describes what it does NOT do
    (e.g. "does NOT alter or drop"); stripping comments prevents those words from
    being mistaken for destructive statements.
    """
    lines: list[str] = []
    for raw in sql.splitlines():
        stripped = raw.strip()
        if stripped.startswith("--"):
            continue
        # Drop a trailing inline comment while leaving statement text intact.
        idx = raw.find("--")
        lines.append(raw if idx == -1 else raw[:idx])
    return "\n".join(lines)


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_ROOT.glob("*.sql"))


class GovernanceAppliedMigrationImmutabilityTest(unittest.TestCase):
    """Task 11.4 / R9.7: the R4 constraint is a new additive file; applied migrations stay put."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.migration_files = _migration_files()
        cls.migration_names = [p.name for p in cls.migration_files]
        cls.new_migration_path = MIGRATIONS_ROOT / NEW_R4_MIGRATION

    def test_new_r4_constraint_migration_exists(self) -> None:
        self.assertTrue(
            self.new_migration_path.is_file(),
            msg=(
                f"expected the new additive R4 migration {NEW_R4_MIGRATION} to exist "
                f"under {MIGRATIONS_ROOT}"
            ),
        )

    def test_new_r4_migration_is_additive(self) -> None:
        sql = _strip_sql_comments(
            self.new_migration_path.read_text(encoding="utf-8")
        )
        # Additive: it must create a new object.
        self.assertRegex(
            sql,
            _CREATE_INDEX_RE,
            msg=f"{NEW_R4_MIGRATION} must create the additive unique index",
        )
        self.assertIn(
            NEW_R4_INDEX_NAME,
            sql,
            msg=(
                f"{NEW_R4_MIGRATION} must create the new object {NEW_R4_INDEX_NAME}"
            ),
        )
        # Non-destructive: no drop / alter / truncate / delete on prior objects.
        for pattern in _DESTRUCTIVE_STATEMENT_RES:
            match = pattern.search(sql)
            self.assertIsNone(
                match,
                msg=(
                    f"{NEW_R4_MIGRATION} must be purely additive but contains a "
                    f"destructive statement matching /{pattern.pattern}/: "
                    f"{match.group(0) if match else ''!r}"
                ),
            )

    def test_new_r4_index_name_is_not_created_by_a_prior_migration(self) -> None:
        # An additive migration must not clobber an object an applied migration created.
        clobbered: list[str] = []
        for path in self.migration_files:
            if path.name >= NEW_R4_MIGRATION:
                continue
            body = _strip_sql_comments(path.read_text(encoding="utf-8"))
            # An exception-handler allowlist may name the constraint without
            # defining it. Only an earlier CREATE INDEX statement clobbers the
            # additive migration's object.
            if _CREATE_R4_INDEX_RE.search(body):
                clobbered.append(path.name)
        self.assertEqual(
            clobbered,
            [],
            msg=(
                f"{NEW_R4_INDEX_NAME} is already defined by prior migration(s) "
                f"{clobbered}; the R4 constraint must be a genuinely new object (R9.7)"
            ),
        )

    def test_r4_name_scan_preserves_prior_collision_detection_with_newer_references(self) -> None:
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            prior = Path(directory) / "20260827000000_fixture.sql"
            newer = Path(directory) / "20261001000000_fixture.sql"
            prior.write_text(f"CREATE UNIQUE INDEX {NEW_R4_INDEX_NAME} ON fixture(id);", encoding="utf-8")
            newer.write_text(f"SELECT '{NEW_R4_INDEX_NAME}' FROM pg_indexes;", encoding="utf-8")
            with patch.object(self, "migration_files", [newer]):
                self.test_new_r4_index_name_is_not_created_by_a_prior_migration()
            with patch.object(self, "migration_files", [prior, newer]):
                with self.assertRaises(AssertionError):
                    self.test_new_r4_index_name_is_not_created_by_a_prior_migration()

    def test_new_r4_migration_remains_after_its_referenced_history(self) -> None:
        # The R4 migration must remain ordered after the applied migration it extends.
        # Newer additive migrations may follow it without weakening this boundary.
        self.assertTrue(self.migration_names, msg="no migration files discovered")
        self.assertIn(NEW_R4_MIGRATION, self.migration_names)
        self.assertLess(
            self.migration_names.index(REFERENCED_PRIOR_MIGRATION),
            self.migration_names.index(NEW_R4_MIGRATION),
            msg=(
                f"{NEW_R4_MIGRATION} must remain after the prior applied migration "
                f"{REFERENCED_PRIOR_MIGRATION} instead of renaming, replacing, or "
                "overwriting that history (R9.7)"
            ),
        )

    def test_referenced_prior_applied_migration_still_present(self) -> None:
        # The applied migration the R4 constraint builds on must remain intact.
        self.assertIn(
            REFERENCED_PRIOR_MIGRATION,
            self.migration_names,
            msg=(
                f"the already-applied migration {REFERENCED_PRIOR_MIGRATION} "
                "referenced by the R4 constraint must not be removed or renamed (R9.7)"
            ),
        )


if __name__ == "__main__":
    unittest.main()
