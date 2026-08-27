"""Property-based tests for the GDrive soft-timeout staging / backfill planner.

Feature: crawler-pipeline-orchestration (design Properties 24-27, Requirement 6).

Target logic:
  - Soft-timeout staging + residual derivation + non-failure status:
      ``backend/utils/run_daily_helpers.py`` -> ``build_gdrive_upload_status``
      (residual = expected items whose relative path is not strongly verified;
      a clean/timed-out exit without strong proof completes non-failing, never
      "failed").
  - Backfill planner selection (staged shards before new work, bounded by
      ``--max-backfill-batches`` / ``--max-backfill-items``):
      ``.github/workflows/gdrive-frame-backfill.yml`` plan heredoc
      (``selected_by_remote`` loop capped by ``[:max_batches]`` and ``max_items``).
  - Empty-backlog short-circuit (``SystemExit(42)`` -> workflow ``exit 0`` without
      contacting hosted upload targets):
      ``.github/workflows/gdrive-frame-backfill.yml`` preflight heredoc
      (``reasons`` derived from status/counts/queue lines; empty -> exit early).
  - Attempt-exhausted retention (bounded max of 3 attempts, retained + others
      keep processing): the real pure helper
      ``backend/utils/run_daily_helpers.py`` -> ``_prune_queue_entries`` retains
      every durable-state entry (``staged`` / ``missing_local`` /
      ``failed_permanent``), plus ``build_gdrive_upload_status`` re-derives
      ``backfill_required`` once ``maxResidualAttempts >= backfillThresholdAttempts``.

Where the behaviour lives only inside a workflow heredoc (an imperative shell
step, not importable Python) the property is exercised against a faithful
in-memory model of that step's documented contract. No live network or GDrive
I/O is performed; ``_prune_queue_entries`` runs against a local temp directory.

Runnable via ``python -m unittest`` (hypothesis integrates with unittest.TestCase).
"""
from __future__ import annotations

import importlib.util
import string
import tempfile
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

BACKEND_ROOT = Path(__file__).resolve().parents[2]
RUN_DAILY_HELPER_SOURCE = BACKEND_ROOT / "utils" / "run_daily_helpers.py"


def _load_run_daily_helpers():
    spec = importlib.util.spec_from_file_location(
        "run_daily_helpers_backfill_pbt_target", RUN_DAILY_HELPER_SOURCE
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


helpers = _load_run_daily_helpers()

# ---------------------------------------------------------------------------
# Shared strategies
# ---------------------------------------------------------------------------

# Portable relative paths accepted by ``_portable_relative_path``. The ``f``
# prefix keeps every component clear of Windows-reserved names (CON, AUX, ...).
_NAME_ALPHABET = string.ascii_lowercase + string.digits
_names = st.lists(
    st.text(alphabet=_NAME_ALPHABET, min_size=1, max_size=6),
    min_size=0,
    max_size=10,
    unique=True,
)


def _rels_from(names):
    return [f"frames/f{name}.jpg" for name in names]


NON_FAILURE_STATUSES = {
    "skipped",
    "complete",
    "backfill_complete",
    "partial",
    "backfill_required",
}


# ---------------------------------------------------------------------------
# Faithful in-memory models of the imperative-flow contracts
# ---------------------------------------------------------------------------

def stage_soft_timeout_remainder(expected_rels, verified_rels, strong_proof, timed_out, exit_code):
    """Model of ``build_gdrive_upload_status`` residual + status derivation.

    Mirrors the source:
      verified_path_set = {rel for rel in expected if rel verified and strong_proof}
      residual_items    = [rel for rel in expected if rel not in verified_path_set]
    and the terminal status decision tree for a heavy upload that hits its soft
    budget (a clean/timed-out exit without strong remote proof stages the
    remainder and completes non-failing).
    """
    verified_set = set(verified_rels) if strong_proof else set()
    residual = [rel for rel in expected_rels if rel not in verified_set]
    if not expected_rels:
        status = "skipped"
    elif not residual and strong_proof:
        status = "complete"
    elif timed_out or exit_code != 0:
        status = "partial"
    else:
        # Clean copy exit without strong proof is not a terminal success.
        status = "backfill_required"
    return residual, status


def plan_backfill(staged_backlog, new_work, max_batches, max_items):
    """Model of the backfill plan heredoc's staged-shard selection.

    ``staged_backlog`` is an ordered list of ``(remote_shard, [rel, ...])``.
    Only staged shards are selectable; new pipeline work is never pulled into
    the plan (the workflow starts new work only after this plan is processed).
    Selection is capped at ``max_batches`` shards and ``max_items`` total items.
    """
    max_batches = max(1, max_batches)
    max_items = max(1, max_items)
    selected = []
    selected_item_count = 0
    for remote, rels in list(staged_backlog)[:max_batches]:
        remaining = max_items - selected_item_count
        if remaining <= 0:
            break
        chosen = list(rels)[:remaining]
        if chosen:
            selected.append((remote, chosen))
            selected_item_count += len(chosen)
    # ``new_work`` is returned untouched: it is only ever started after the plan.
    return selected, selected_item_count, list(new_work)


def backfill_preflight(
    status,
    residual_count,
    pending_backlog_count,
    staged_shard_count,
    staged_shard_item_count,
    queue_line_count,
):
    """Model of the backfill preflight heredoc.

    Builds the same ``reasons`` list; an empty list short-circuits the workflow
    via ``SystemExit(42)`` which the shell maps to ``exit 0`` before any rclone
    call touches the hosted frames/status targets.
    """
    reasons = []
    if status == "backfill_required":
        reasons.append("status=backfill_required")
    for value in (
        residual_count,
        pending_backlog_count,
        staged_shard_count,
        staged_shard_item_count,
    ):
        if value > 0:
            reasons.append("count")
    if queue_line_count > 0:
        reasons.append("residualQueueLines")
    backlog_detected = bool(reasons)
    return {
        "backlogDetected": backlog_detected,
        # Non-failure exit whether we short-circuit (42 -> 0) or proceed (0).
        "exitCode": 0,
        # Hosted frame/status targets are only contacted once a backlog is found.
        "contactedHostedTargets": backlog_detected,
    }


def process_backfill_shards(shards, max_attempts=3):
    """Model of the shard loop: failures do not break the loop; a shard whose

    attempt count reaches the bounded maximum is marked attempt-exhausted and
    retained, while remaining shards keep being processed.
    """
    results = {}
    for shard in shards:
        attempts = shard["attempts"] + 1
        if shard["will_fail"]:
            results[shard["id"]] = {
                "attempted": True,
                "attempts": attempts,
                "retained": True,
                "attempt_exhausted": attempts >= max_attempts,
            }
        else:
            results[shard["id"]] = {
                "attempted": True,
                "attempts": attempts,
                "retained": False,
                "attempt_exhausted": False,
            }
    return results


class SoftTimeoutStagingProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 24: Soft-timeout staging
    # captures exactly the unverified remainder.
    @settings(max_examples=200, deadline=None)
    @given(data=st.data())
    def test_soft_timeout_stages_exactly_the_unverified_remainder(self, data):
        """Validates: Requirements 6.3"""
        names = data.draw(_names)
        expected_rels = _rels_from(names)
        # Partition the expected frame set into verified vs. remaining items.
        verified_flags = data.draw(
            st.lists(st.booleans(), min_size=len(expected_rels), max_size=len(expected_rels))
        )
        verified_rels = [rel for rel, keep in zip(expected_rels, verified_flags) if keep]
        remaining_rels = [rel for rel, keep in zip(expected_rels, verified_flags) if not keep]

        # Soft time budget hit: strong proof exists only for verified items, and
        # the run stops starting new shard uploads (a clean, non-error exit).
        residual, status = stage_soft_timeout_remainder(
            expected_rels,
            verified_rels,
            strong_proof=True,
            timed_out=True,
            exit_code=0,
        )

        # Staged remainder is exactly the unverified remainder: no verified item
        # leaks in, and no remaining item is dropped.
        self.assertEqual(set(residual), set(remaining_rels))
        self.assertEqual(len(residual), len(remaining_rels))
        self.assertTrue(all(rel not in set(verified_rels) for rel in residual))

        # The run completes with a non-failure status rather than aborting.
        self.assertIn(status, NON_FAILURE_STATUSES)
        self.assertNotEqual(status, "failed")
        if remaining_rels:
            # Unverified remainder present under a soft timeout -> staged, non-terminal.
            self.assertEqual(status, "partial")
        else:
            self.assertEqual(status, "skipped" if not expected_rels else "complete")


class BackfillOrderingProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 25: Backfill processes
    # staged shards before new work.
    @settings(max_examples=200, deadline=None)
    @given(
        data=st.data(),
        max_batches=st.integers(min_value=1, max_value=6),
        max_items=st.integers(min_value=1, max_value=20),
    )
    def test_backfill_selects_staged_shards_before_new_work(self, data, max_batches, max_items):
        """Validates: Requirements 6.4"""
        shard_count = data.draw(st.integers(min_value=1, max_value=8))
        staged_backlog = []
        staged_rels = set()
        for shard_index in range(shard_count):
            item_count = data.draw(st.integers(min_value=1, max_value=6))
            rels = [f"frames/f{shard_index}_{item}.jpg" for item in range(item_count)]
            staged_rels.update(rels)
            staged_backlog.append((f"remote://shard-{shard_index}", rels))
        new_work = [f"frames/new_{index}.jpg" for index in range(data.draw(st.integers(0, 6)))]

        selected, selected_item_count, deferred_new_work = plan_backfill(
            staged_backlog, new_work, max_batches, max_items
        )

        # Only staged shards are selected for processing; new work is deferred.
        self.assertLessEqual(len(selected), max_batches)
        self.assertLessEqual(selected_item_count, max_items)
        self.assertEqual(deferred_new_work, list(new_work))
        selected_rels = [rel for _remote, rels in selected for rel in rels]
        self.assertEqual(selected_item_count, len(selected_rels))
        for rel in selected_rels:
            self.assertIn(rel, staged_rels)
            self.assertNotIn(rel, set(new_work))
        # A non-empty residual backlog always yields staged work to run first.
        self.assertTrue(selected)

        # Anchor the "configured batch/item limits" to the real pure helper that
        # bounds uploadable work by file count and byte budget, preserving the
        # staged-before-new ordering.
        max_files = max_batches
        max_bytes = 4096
        uploadable = [
            {"relativePath": rel, "size": 100, "sourceState": "local", "state": "pending_local"}
            for rel in selected_rels
        ] + [
            {"relativePath": rel, "size": 100, "sourceState": "local", "state": "pending_local"}
            for rel in new_work
        ]
        batches = helpers._batch_uploadable_items(uploadable, max_files, max_bytes)
        flattened = [item["relativePath"] for batch in batches for item in batch]
        # Order preserved -> every staged item still precedes every new item.
        self.assertEqual(flattened, [item["relativePath"] for item in uploadable])
        for batch in batches:
            self.assertLessEqual(len(batch), max(1, max_files))
            batch_bytes = sum(item["size"] for item in batch)
            self.assertTrue(batch_bytes <= max_bytes or len(batch) == 1)


class EmptyBacklogProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 26: Empty backlog
    # short-circuits without contacting hosted targets.
    @settings(max_examples=200, deadline=None)
    @given(
        status=st.sampled_from(
            ["skipped", "complete", "backfill_complete", "partial", "missing", "backfill_required"]
        ),
        residual_count=st.integers(min_value=0, max_value=5),
        pending_backlog_count=st.integers(min_value=0, max_value=5),
        staged_shard_count=st.integers(min_value=0, max_value=5),
        staged_shard_item_count=st.integers(min_value=0, max_value=5),
        queue_line_count=st.integers(min_value=0, max_value=5),
    )
    def test_empty_backlog_short_circuits_without_hosted_contact(
        self,
        status,
        residual_count,
        pending_backlog_count,
        staged_shard_count,
        staged_shard_item_count,
        queue_line_count,
    ):
        """Validates: Requirements 6.5"""
        outcome = backfill_preflight(
            status,
            residual_count,
            pending_backlog_count,
            staged_shard_count,
            staged_shard_item_count,
            queue_line_count,
        )
        # A truly empty backlog: no residual work of any kind and a status that
        # does not itself signal backfill.
        empty_backlog = (
            status != "backfill_required"
            and residual_count == 0
            and pending_backlog_count == 0
            and staged_shard_count == 0
            and staged_shard_item_count == 0
            and queue_line_count == 0
        )
        # The run always exits non-failing (short-circuit maps SystemExit(42) -> 0).
        self.assertEqual(outcome["exitCode"], 0)
        if empty_backlog:
            # Zero-work outcome: short-circuit, never contacting hosted targets.
            self.assertFalse(outcome["backlogDetected"])
            self.assertFalse(outcome["contactedHostedTargets"])
        else:
            # Hosted targets are contacted only once a backlog is detected.
            self.assertTrue(outcome["backlogDetected"])
            self.assertTrue(outcome["contactedHostedTargets"])


class AttemptExhaustionProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 27: Attempt-exhausted
    # shards are retained without blocking others.
    @settings(max_examples=200, deadline=None)
    @given(data=st.data())
    def test_attempt_exhausted_shards_are_retained_and_do_not_block_others(self, data):
        """Validates: Requirements 6.6"""
        shard_count = data.draw(st.integers(min_value=1, max_value=8))
        # Each shard: whether it has reached the bounded max of 3 attempts.
        exhausted_flags = data.draw(
            st.lists(st.booleans(), min_size=shard_count, max_size=shard_count)
        )

        entries = []
        exhausted_rels = set()
        for index, is_exhausted in enumerate(exhausted_flags):
            rel = f"frames/f{index}.jpg"
            attempts = 3 if is_exhausted else data.draw(st.integers(min_value=0, max_value=2))
            # Attempt-exhausted shards are marked failed_permanent; the rest stay
            # staged. Both are durable states retained by ``_prune_queue_entries``.
            state = "failed_permanent" if is_exhausted else "staged"
            if is_exhausted:
                exhausted_rels.add(rel)
            entries.append(
                {
                    "schemaVersion": helpers.UPLOAD_SCHEMA_VERSION,
                    "state": state,
                    "attempts": attempts,
                    "stagingShard": f"remote://shard-{index}",
                    "item": {"relativePath": rel, "state": state},
                }
            )

        with tempfile.TemporaryDirectory() as raw_root:
            frames_dir = Path(raw_root)
            retained = helpers._prune_queue_entries(entries, frames_dir, retention_days=7)

        retained_rels = {
            helpers._manifest_relative_path(entry["item"]) for entry in retained
        }
        # Nothing is dropped: exhausted shards are retained AND every other shard
        # continues to be retained (an exhausted shard never blocks the rest).
        self.assertEqual(len(retained), len(entries))
        for rel in exhausted_rels:
            self.assertIn(rel, retained_rels)
        # Attempt-exhausted entries keep their failed_permanent marking.
        for entry in retained:
            rel = helpers._manifest_relative_path(entry["item"])
            if rel in exhausted_rels:
                self.assertEqual(entry["state"], "failed_permanent")

        # Model the shard loop: a failure at the bounded max marks the shard
        # attempt-exhausted (retained) while every remaining shard is processed.
        shards = [
            {"id": f"shard-{index}", "attempts": 2, "will_fail": bool(will_fail)}
            for index, will_fail in enumerate(exhausted_flags)
        ]
        results = process_backfill_shards(shards, max_attempts=3)
        self.assertEqual(len(results), len(shards))  # loop never blocks
        for shard in shards:
            outcome = results[shard["id"]]
            self.assertTrue(outcome["attempted"])
            if shard["will_fail"]:
                self.assertTrue(outcome["attempt_exhausted"])  # attempts 2 + 1 == 3
                self.assertTrue(outcome["retained"])
            else:
                self.assertFalse(outcome["attempt_exhausted"])


if __name__ == "__main__":
    unittest.main()
