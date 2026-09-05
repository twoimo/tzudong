"""Property-based tests for idempotent hosted reflection accounting.

Feature: crawler-pipeline-orchestration (Requirement 4). These tests target the
real hosted apply path
``backend/supabase/scripts/hosted_data_plane.py::apply_pending_candidates`` and
encode design Properties 12, 13, 14, and 15. They drive that function directly
with a mocked ``fetch=`` requester that simulates an in-memory hosted store with
a unique constraint on the stable candidate identity (insert-if-absent: the
first insert of an identity returns 201, every subsequent insert returns 409).
No live Supabase, no network. They use Python ``hypothesis`` (min 100 examples)
and run under ``python -m unittest``.
"""
from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.supabase.scripts.hosted_data_plane import (
    HOSTED_URL,
    APPROVAL_ENV,
    apply_pending_candidates,
    preview_hash,
)

# --------------------------------------------------------------------------- #
# Fixed, non-sensitive drivers for the real apply path.
# --------------------------------------------------------------------------- #
_SERVICE_ROLE_KEY = "test-service-role-key"  # non-empty; never a real secret
_ENVIRONMENT = {APPROVAL_ENV: "1", "G037_WRITE_FREEZE": "cleared"}

# Stable YouTube video ids are exactly 11 chars from [A-Za-z0-9_-].
_YT_ALPHABET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789_-"
)
_yt_id = st.text(alphabet=_YT_ALPHABET, min_size=11, max_size=11)
# Non-2xx, non-409 status codes model "hosted presence undeterminable".
_UNRESOLVED_STATUS = st.sampled_from([500, 502, 503, 404, 429, 408])


def _video_id_sets(min_size=1, max_size=8):
    """Sets of distinct stable candidate identities (YouTube video ids)."""
    return st.sets(_yt_id, min_size=min_size, max_size=max_size)


def _build_preview(video_ids):
    """Build a valid, authorized apply preview for the given candidate ids.

    Mirrors ``build_apply_preview``'s output shape for the apply-candidate
    subset so ``assert_apply_authorized`` / ``apply_pending_candidates`` admit
    it: pending insert status, overwrite guard set, matching preview hash, and
    ``applyCandidateCount == len(applyCandidateVideoIds)``.
    """
    ids = sorted(set(video_ids))
    payload = {
        "schemaVersion": 1,
        "hostedProjectRef": HOSTED_URL.split("//", 1)[1].split(".", 1)[0],
        "dockerRestaurantClass": "empty",
        "dockerRestaurantApply": [],
        "applyCandidateVideoIds": ids,
        "applyCandidateCount": len(ids),
        "insertStatus": "pending",
        "overwriteApprovedForbidden": True,
    }
    payload["previewSha256"] = preview_hash(
        {key: value for key, value in payload.items() if key != "previewSha256"}
    )
    return payload


def _rows_for(video_ids):
    """One evaluation row per candidate identity.

    ``row_youtube_id`` reads the id from ``youtube_meta``; ``trace_id`` carries
    the stable identity so the in-memory store's unique constraint keys on the
    same candidate identity the reflection accounts by.
    """
    return [
        {
            "trace_id": vid,
            "youtube_meta": {"video_id": vid},
            "youtube_link": f"https://www.youtube.com/watch?v={vid}",
        }
        for vid in video_ids
    ]


class _InsertIfAbsentStore:
    """In-memory hosted store enforcing a unique candidate-identity constraint.

    Mirrors the additive migration's unique constraint at the insert boundary:
    the first insert of an identity succeeds (201); a subsequent insert observes
    the conflict (409). Optionally, a subset of identities is "undeterminable"
    and answers with a non-2xx/non-409 status without ever creating a record.
    """

    def __init__(self, present=None, unresolved=None):
        # ``records`` maps identity -> number of rows actually created.
        self.records: dict[str, int] = {}
        for identity in present or ():
            self.records[identity] = 1
        self._unresolved = set(unresolved or ())
        self._unresolved_status: dict[str, int] = {}

    def set_unresolved_status(self, mapping):
        self._unresolved_status = dict(mapping)

    def __call__(self, url, *, key, method="GET", payload=None, extra_headers=None):
        assert method == "POST"
        assert key == _SERVICE_ROLE_KEY
        identity = payload["trace_id"]
        if identity in self._unresolved:
            # Presence cannot be determined; no record is created.
            return self._unresolved_status.get(identity, 503), None
        if identity in self.records:
            # Unique-constraint conflict: already present, insert-if-absent skip.
            return 409, None
        self.records[identity] = 1
        return 201, None

    def _apply(self, video_ids):
        preview = _build_preview(video_ids)
        return apply_pending_candidates(
            preview=preview,
            evaluation_rows=_rows_for(sorted(set(video_ids))),
            url=HOSTED_URL,
            service_role_key=_SERVICE_ROLE_KEY,
            environment=_ENVIRONMENT,
            presented_preview_sha256=preview["previewSha256"],
            fetch=self,
        )


class ReflectionIdempotencyProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 12: Reflection is idempotent. For all eligible candidate sets and all repetition counts N >= 1, reflecting the set N times yields the same hosted state as reflecting it once (exactly one record per identity), regardless of which runner performs each reflection and regardless of a prior partial completion that already applied a prefix of the set.
    # Validates: Requirements 4.1, 4.2, 4.3, 4.7
    @settings(max_examples=200, deadline=None)
    @given(
        video_ids=_video_id_sets(),
        repetitions=st.integers(min_value=1, max_value=5),
        prefix_fraction=st.floats(min_value=0.0, max_value=1.0),
        runner_choices=st.lists(st.booleans(), min_size=1, max_size=5),
    )
    def test_reflection_is_idempotent(
        self, video_ids, repetitions, prefix_fraction, runner_choices
    ):
        ids = sorted(video_ids)
        # A prior partial completion may already have applied a prefix.
        prefix_len = int(round(prefix_fraction * len(ids)))
        prefix = ids[:prefix_len]

        # Reference state: a single reflection over the full set (fresh store).
        once_store = _InsertIfAbsentStore(present=list(prefix))
        once_store._apply(ids)
        reference_records = dict(once_store.records)

        # N reflections against a shared store. Each reflection is performed by
        # one of two runners (both write to the same hosted store), and the
        # store already holds the applied prefix from the partial completion.
        shared_store = _InsertIfAbsentStore(present=list(prefix))
        for i in range(repetitions):
            # Which runner performs this reflection is irrelevant to the state.
            _runner = runner_choices[i % len(runner_choices)]
            result = shared_store._apply(ids)
            reflection = result["reflection"]
            # Every processed identity lands in exactly one bucket.
            union = (
                set(reflection["applied"])
                | set(reflection["skippedAlreadyPresent"])
                | set(reflection["unresolved"])
            )
            self.assertEqual(union, set(ids))
            # No candidate is ever unresolved when the store is deterministic.
            self.assertEqual(reflection["unresolved"], [])

        # Reflecting N times yields the same hosted state as reflecting once.
        self.assertEqual(shared_store.records, reference_records)
        # Exactly one record per candidate identity, no duplicates.
        self.assertEqual(set(shared_store.records), set(ids))
        for identity, count in shared_store.records.items():
            self.assertEqual(count, 1, f"duplicate record for {identity!r}")


class ReflectionPartitionProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 13: Reflection accounting partitions the processed set. For all processed candidate sets, the applied, skippedAlreadyPresent, and unresolved lists are pairwise disjoint and their union equals the processed set.
    # Validates: Requirements 4.4
    @settings(max_examples=200, deadline=None)
    @given(data=st.data(), video_ids=_video_id_sets())
    def test_reflection_accounting_partitions_processed_set(self, data, video_ids):
        ids = sorted(video_ids)
        # Assign each identity an outcome-producing hosted status:
        #   200/201 -> applied, 409 -> already present, other -> unresolved.
        status_map = {
            vid: data.draw(
                st.sampled_from([200, 201, 409, 500, 503, 404, 429]),
                label=f"status[{vid}]",
            )
            for vid in ids
        }

        def requester(url, *, key, method="GET", payload=None, extra_headers=None):
            return status_map[payload["trace_id"]], None

        preview = _build_preview(ids)
        result = apply_pending_candidates(
            preview=preview,
            evaluation_rows=_rows_for(ids),
            url=HOSTED_URL,
            service_role_key=_SERVICE_ROLE_KEY,
            environment=_ENVIRONMENT,
            presented_preview_sha256=preview["previewSha256"],
            fetch=requester,
        )
        reflection = result["reflection"]
        applied = set(reflection["applied"])
        present = set(reflection["skippedAlreadyPresent"])
        unresolved = set(reflection["unresolved"])

        # Pairwise disjoint.
        self.assertEqual(applied & present, set())
        self.assertEqual(applied & unresolved, set())
        self.assertEqual(present & unresolved, set())
        # Union equals the processed set.
        self.assertEqual(applied | present | unresolved, set(ids))
        # Classification agrees with the hosted status per identity.
        for vid in ids:
            code = status_map[vid]
            if code in (200, 201):
                self.assertIn(vid, applied)
            elif code == 409:
                self.assertIn(vid, present)
            else:
                self.assertIn(vid, unresolved)


class ConcurrentReflectionProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 14: Concurrent reflection creates at most one record. For all interleavings of two runners reflecting the same identity, at most one record is created and the losing attempt reclassifies as already present; result independent of order (confluence).
    # Validates: Requirements 4.5
    @settings(max_examples=200, deadline=None)
    @given(video_ids=_video_id_sets(), first_runner=st.booleans())
    def test_concurrent_reflection_creates_at_most_one_record(
        self, video_ids, first_runner
    ):
        ids = sorted(video_ids)

        def run_in_order(runner_a_first):
            # Two runners share one hosted store guarded by the unique
            # candidate-identity constraint. Any serialization of their
            # attempts is a valid interleaving of the concurrent reflection.
            store = _InsertIfAbsentStore()
            order = [True, False] if runner_a_first else [False, True]
            results = {}
            for is_runner_a in order:
                results[is_runner_a] = store._apply(ids)
            return store, results, order

        store, results, order = run_in_order(first_runner)

        # At most one record per identity: the losing writer never duplicates.
        self.assertEqual(set(store.records), set(ids))
        for identity, count in store.records.items():
            self.assertEqual(count, 1, f"duplicate record for {identity!r}")

        # The first runner to act applies every id; the loser reclassifies them
        # all as already present.
        winner, loser = order[0], order[1]
        self.assertEqual(set(results[winner]["reflection"]["applied"]), set(ids))
        self.assertEqual(results[winner]["reflection"]["skippedAlreadyPresent"], [])
        self.assertEqual(results[loser]["reflection"]["applied"], [])
        self.assertEqual(
            set(results[loser]["reflection"]["skippedAlreadyPresent"]), set(ids)
        )

        # Confluence: the resulting hosted state is independent of order.
        store_reverse, _results_reverse, _order_reverse = run_in_order(
            not first_runner
        )
        self.assertEqual(store.records, store_reverse.records)


class UnresolvedReflectionProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 15: Unresolved candidates are skipped without a record. For all candidates whose hosted presence cannot be determined, the runner skips applying the candidate, creates no record, and records it in the unresolved set.
    # Validates: Requirements 4.6
    @settings(max_examples=200, deadline=None)
    @given(
        data=st.data(),
        video_ids=_video_id_sets(),
        status_for_unresolved=st.dictionaries(_yt_id, _UNRESOLVED_STATUS),
    )
    def test_unresolved_candidates_skipped_without_record(
        self, data, video_ids, status_for_unresolved
    ):
        ids = sorted(video_ids)
        # Partition the processed set into resolvable (insert-if-absent) and
        # undeterminable identities.
        unresolvable = set(
            data.draw(
                st.lists(st.sampled_from(ids), unique=True), label="unresolvable"
            )
        )
        resolvable = [vid for vid in ids if vid not in unresolvable]

        store = _InsertIfAbsentStore(unresolved=unresolvable)
        store.set_unresolved_status(
            {vid: status_for_unresolved.get(vid, 503) for vid in unresolvable}
        )
        result = store._apply(ids)
        reflection = result["reflection"]

        # Every undeterminable candidate is recorded as unresolved, is skipped
        # from applied/present, and left no hosted record.
        self.assertEqual(set(reflection["unresolved"]), unresolvable)
        for vid in unresolvable:
            self.assertNotIn(vid, reflection["applied"])
            self.assertNotIn(vid, reflection["skippedAlreadyPresent"])
            self.assertNotIn(vid, store.records)

        # Resolvable candidates are applied and create exactly one record each.
        self.assertEqual(set(reflection["applied"]), set(resolvable))
        for vid in resolvable:
            self.assertEqual(store.records.get(vid), 1)

        # The three lists still partition the processed set.
        union = (
            set(reflection["applied"])
            | set(reflection["skippedAlreadyPresent"])
            | set(reflection["unresolved"])
        )
        self.assertEqual(union, set(ids))


if __name__ == "__main__":
    unittest.main()
