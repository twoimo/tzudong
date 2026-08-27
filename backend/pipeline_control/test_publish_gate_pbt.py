"""Property-based tests for R8 publish-gate / data-and-secret containment logic.

Feature: crawler-pipeline-orchestration (design Properties 33-36, Requirement 8).

These exercise pure logic only:

* Property 33 mirrors the workflow publish gate `vars.TZUDONG_DATA_BRANCH_PUBLISH == '1'`.
  That exactness check lives only in `.github/workflows/daily-crawler.yml` (YAML), so this
  test asserts the semantics against a small pure mirror function (test-only).
* Property 34 exercises the real evidence/log-artifact builder
  `backend.pipeline_control.es_index.allowlisted_document`, which both *excludes* every
  non-allowlisted (secret / crawl-payload) field and *redacts* the retained fields through
  `backend.utils.privacy_log.sanitize_log_value`.
* Property 35 checks the real repository ignore configuration (`.gitignore`) using git's own
  ignore engine (`git check-ignore`) so the coverage claim is authoritative.
* Property 36 exercises the publication commit guard. The guard is a set-difference against the
  manifest allowlist (inlined in the workflow); manifest membership is constrained by the real
  `backend.bin.validate_daily_publication_bundle._is_allowed_data_path`.

Runnable via `python -m unittest backend.pipeline_control.test_publish_gate_pbt`.
Requires `hypothesis` (use a throwaway venv if it is not installed).
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.bin.validate_daily_publication_bundle import (
    ALLOWED_ROOTS,
    _is_allowed_data_path,
)
from backend.pipeline_control.es_index import LOG_ALLOWLIST, allowlisted_document
from backend.utils.privacy_log import REDACTED, sanitize_log_value

REPO_ROOT = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------------------
# Property 33 support: exact-flag publish gate (mirror of the YAML `== '1'` condition).
# --------------------------------------------------------------------------------------

ENABLED_FLAG_VALUE = "1"


def data_branch_publish_enabled(flag_value: str | None) -> bool:
    """Mirror of the workflow gate `vars.TZUDONG_DATA_BRANCH_PUBLISH == '1'`.

    GitHub Actions exposes an unset repository variable as the empty string; ``None`` models the
    unset state here. The path is enabled only for the exact enabled token; every other state
    (unset, empty, or any other value) keeps it disabled.
    """
    if flag_value is None:
        return False
    return flag_value == ENABLED_FLAG_VALUE


# --------------------------------------------------------------------------------------
# Property 36 support: publication commit guard (mirror of the inlined YAML guard).
# --------------------------------------------------------------------------------------


def publication_commit_guard(
    staged_paths: frozenset[str], manifest_allowlist: frozenset[str]
) -> dict[str, object]:
    """Reject the publication when any staged path is not in the manifest allowlist.

    Mirrors the workflow step that computes ``sorted(set(changed) - allowed)`` and fails if the
    result is non-empty. Pure: performs a set difference and returns a bounded verdict.
    """
    allowed = set(manifest_allowlist)
    unexpected = sorted(set(staged_paths) - allowed)
    return {"accepted": not unexpected, "rejectedPaths": unexpected}


def attempt_publication(
    history: tuple[str, ...],
    staged_paths: frozenset[str],
    manifest_allowlist: frozenset[str],
) -> tuple[tuple[str, ...], dict[str, object]]:
    """Model the guarded commit: only append a commit when the guard accepts."""
    verdict = publication_commit_guard(staged_paths, manifest_allowlist)
    if not verdict["accepted"]:
        return history, verdict
    return history + ("data-commit",), verdict


# --------------------------------------------------------------------------------------
# Shared hypothesis strategies.
# --------------------------------------------------------------------------------------

_LETTERS = "abcdefghijklmnopqrstuvwxyz"
_segment = st.text(alphabet=_LETTERS, min_size=1, max_size=8)
# Letters-only values never trip any redaction pattern (no digit runs, "@", separators, etc.).
_benign_value = st.text(alphabet=_LETTERS, min_size=1, max_size=16)
_dir_path = st.lists(_segment, min_size=1, max_size=3).map(lambda parts: "/".join(parts))
_DATA_SUFFIX = st.sampled_from((".json", ".jsonl", ".txt"))


@st.composite
def allowed_data_paths(draw: st.DrawFn) -> str:
    """A path the publication validator would admit into a manifest allowlist."""
    root = draw(st.sampled_from(ALLOWED_ROOTS))  # already ends with "/"
    inner = draw(st.lists(_segment, min_size=0, max_size=2))
    name = "f" + draw(st.text(alphabet=_LETTERS, min_size=1, max_size=8))
    suffix = draw(_DATA_SUFFIX)
    parts = [root.rstrip("/"), *inner, name + suffix]
    path = "/".join(parts)
    return path


@st.composite
def excluded_or_secret_paths(draw: st.DrawFn) -> str:
    """A crawl/eval-or-secret path that must never be admitted into a manifest allowlist."""
    kind = draw(
        st.sampled_from(
            (
                "excluded_basename",
                "forbidden_name",
                "outside_root_secret",
            )
        )
    )
    if kind == "excluded_basename":
        root = draw(st.sampled_from(ALLOWED_ROOTS)).rstrip("/")
        basename = draw(st.sampled_from(("credentials.json", "cookies.txt")))
        return f"{root}/{basename}"
    if kind == "forbidden_name":
        root = draw(st.sampled_from(ALLOWED_ROOTS)).rstrip("/")
        stem = draw(
            st.sampled_from(
                (
                    "api_token",
                    "user_password",
                    "app_secret",
                    "auth_credential",
                    "session_cookie",
                    "run_log",
                )
            )
        )
        suffix = draw(_DATA_SUFFIX)
        return f"{root}/{stem}{suffix}"
    # secret-bearing files outside the admitted data roots
    return draw(
        st.sampled_from(
            (
                "backend/.env",
                "apps/web/.env.local",
                "oauth_creds.json",
                "operator_session.json",
                "cookies.json",
                ".gemini/access.json",
            )
        )
    )


@st.composite
def gitignored_paths(draw: st.DrawFn) -> str:
    """A path in one of the R8.7 forbidden categories that .gitignore must exclude."""
    category = draw(
        st.sampled_from(
            (
                "crawl_data_dir",
                "eval_data_dir",
                "jsonl",
                "env",
                "oauth",
                "session",
                "cookie",
                "provider_creds",
            )
        )
    )
    directory = draw(_dir_path)
    name = draw(st.text(alphabet=_LETTERS, min_size=1, max_size=8))
    if category == "crawl_data_dir":
        return "backend/restaurant-crawling/data/tzuyang/" + directory + "/" + name + ".json"
    if category == "eval_data_dir":
        return "backend/restaurant-evaluation/data/" + directory + "/" + name + ".json"
    if category == "jsonl":
        return directory + "/" + name + ".jsonl"
    if category == "env":
        # ".env.example" is intentionally re-included by .gitignore, so it is excluded here.
        env_suffix = draw(st.sampled_from(("", ".local", ".old", ".test")))
        return directory + "/.env" + env_suffix
    if category == "oauth":
        return directory + "/oauth_creds.json"
    if category == "session":
        return directory + "/" + name + "session.json"
    if category == "cookie":
        cookie_name = draw(st.sampled_from(("cookies.txt", "cookies.json")))
        return directory + "/" + cookie_name
    # provider credential directory
    return directory + "/.gemini/" + name + ".json"


def _git_is_ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", "--", path],
        cwd=str(REPO_ROOT),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    # 0 => path is ignored, 1 => not ignored, 128 => error.
    return result.returncode == 0


class PublishGatePropertyTests(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 33: Data-branch publish is enabled only by the exact flag value.
    # Validates: Requirements 8.3, 8.4
    @settings(max_examples=200)
    @given(
        flag_value=st.one_of(
            st.none(),
            st.just(""),
            st.just("1"),
            st.text(max_size=12),
            st.sampled_from(("0", "01", "1 ", " 1", "true", "TRUE", "yes", "enabled", "one")),
        )
    )
    def test_property_33_publish_enabled_iff_exact_flag(self, flag_value: str | None) -> None:
        enabled = data_branch_publish_enabled(flag_value)
        # Enabled if and only if the flag equals the exact enabled value.
        self.assertEqual(enabled, flag_value == ENABLED_FLAG_VALUE)
        # Every non-exact state (unset, empty, any other value) stays disabled.
        if flag_value != ENABLED_FLAG_VALUE:
            self.assertFalse(enabled)
        # The default (unset) and empty states require no operator action to stay disabled.
        self.assertFalse(data_branch_publish_enabled(None))
        self.assertFalse(data_branch_publish_enabled(""))
        self.assertTrue(data_branch_publish_enabled("1"))

    # Feature: crawler-pipeline-orchestration, Property 34: Evidence artifacts exclude and redact sensitive content.
    # Validates: Requirements 8.5, 8.6
    @settings(max_examples=100)
    @given(
        retained=st.dictionaries(
            keys=st.sampled_from(
                sorted(LOG_ALLOWLIST - {"type"})
            ),
            values=_benign_value,
            min_size=1,
            max_size=6,
        ),
        secret_token=st.sampled_from(
            (
                "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                "eyJhbGciOi.JzdWIiOi.J0ZXN0In0",
                "Bearer aa.bb.cc-secret-token-value",
                "AKIAIOSFODNN7EXAMPLE",
            )
        ),
    )
    def test_property_34_evidence_excludes_and_redacts(
        self, retained: dict[str, str], secret_token: str
    ) -> None:
        # Non-allowlisted sensitive / crawl-data fields the raw event would carry.
        sensitive_fields = {
            "cookie": f"session=abc; auth={secret_token}",
            "credentials": secret_token,
            "session_token": secret_token,
            "password": secret_token,
            "api_key": secret_token,
            "crawl_payload": {"restaurant": "raw crawl blob", "token": secret_token},
            "raw_ocr": "raw ocr text blob",
        }
        document = {"type": "run.lifecycle", **retained, **sensitive_fields}

        artifact = allowlisted_document(document)

        # R8.5: only allowlisted keys survive; every sensitive / crawl field is excluded.
        self.assertTrue(set(artifact).issubset(LOG_ALLOWLIST))
        for excluded_key in sensitive_fields:
            self.assertNotIn(excluded_key, artifact)

        # R8.6: no secret material leaks into the serialized artifact.
        serialized = json.dumps(artifact, ensure_ascii=True, sort_keys=True)
        self.assertNotIn(secret_token, serialized)
        self.assertNotIn("raw crawl blob", serialized)
        self.assertNotIn("raw ocr text blob", serialized)

        # R8.6: the remaining non-sensitive content is retained (benign values unchanged).
        for key, value in retained.items():
            self.assertIn(key, artifact)
            self.assertEqual(artifact[key], value)

    # Feature: crawler-pipeline-orchestration, Property 35: Ignore configuration covers every forbidden path category.
    # Validates: Requirements 8.7
    @settings(max_examples=150)
    @given(path=gitignored_paths())
    def test_property_35_ignore_covers_forbidden_categories(self, path: str) -> None:
        self.assertTrue(
            _git_is_ignored(path),
            msg=f"forbidden path not covered by .gitignore: {path!r}",
        )

    # Feature: crawler-pipeline-orchestration, Property 36: Commit guard blocks non-manifest data or secret paths.
    # Validates: Requirements 8.1, 8.2, 8.8
    @settings(max_examples=100)
    @given(
        allowlist=st.frozensets(allowed_data_paths(), min_size=0, max_size=6),
        legitimate=st.frozensets(allowed_data_paths(), min_size=0, max_size=4),
        excluded=st.frozensets(excluded_or_secret_paths(), min_size=1, max_size=4),
    )
    def test_property_36_commit_guard_blocks_excluded_paths(
        self,
        allowlist: frozenset[str],
        legitimate: frozenset[str],
        excluded: frozenset[str],
    ) -> None:
        # Excluded / secret paths can never be legitimately admitted into a manifest allowlist.
        for secret_path in excluded:
            self.assertFalse(
                _is_allowed_data_path(secret_path),
                msg=f"secret path unexpectedly admissible: {secret_path!r}",
            )

        # Only manifest-listed data paths may be staged legitimately.
        legitimate_in_manifest = legitimate & allowlist
        staged = frozenset(legitimate_in_manifest | excluded)

        history = ("base-commit",)
        new_history, verdict = attempt_publication(history, staged, allowlist)

        # The attempt is rejected because it introduces excluded content.
        self.assertFalse(verdict["accepted"])
        rejected = set(verdict["rejectedPaths"])
        self.assertTrue(excluded.issubset(rejected))
        # Repository history is left unchanged on rejection.
        self.assertEqual(new_history, history)

        # A staged set fully inside the allowlist is accepted (no excluded content).
        clean_history, clean_verdict = attempt_publication(
            history, allowlist, allowlist
        )
        self.assertTrue(clean_verdict["accepted"])
        self.assertEqual(clean_verdict["rejectedPaths"], [])
        self.assertEqual(clean_history, history + ("data-commit",))


if __name__ == "__main__":
    unittest.main()
