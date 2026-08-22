"""FileStore run-ID continuity and local_db snapshot hashing."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.pipeline_control.live_evidence import (
    canonicalize_restaurant_rows,
    canonical_sha256,
    same_run_id_verified,
    snapshot_restaurants_relation,
)
from backend.pipeline_control.store import MemoryStore


class LiveEvidenceTests(unittest.TestCase):
    def test_same_run_id_requires_enqueue_claim_and_success(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _created = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="key-1",
            payload={"index": 1},
            actor="live_run",
            request_id="live-1",
            dry_run=False,
        )
        self.assertFalse(same_run_id_verified(store, run))
        claimed = store.claim(run.id)
        self.assertIsNotNone(claimed)
        self.assertFalse(same_run_id_verified(store, run))
        store.finish_succeeded(run.id)
        self.assertTrue(same_run_id_verified(store, run))

    def test_snapshot_hashes_injected_fetch_and_strips_timestamps(self) -> None:
        rows = [
            {"id": "b", "trace_id": "t2", "updated_at": "2026-01-02"},
            {"id": "a", "trace_id": "t1", "updated_at": "2026-01-01"},
        ]
        first = snapshot_restaurants_relation(fetch=lambda: rows)
        second = snapshot_restaurants_relation(
            fetch=lambda: [
                {"id": "a", "trace_id": "t1", "updated_at": "2099-01-01"},
                {"id": "b", "trace_id": "t2", "updated_at": "2099-01-02"},
            ]
        )
        self.assertEqual(first, second)
        self.assertEqual(first[1], 2)
        canonical = canonicalize_restaurant_rows(rows)
        self.assertEqual(first[0], canonical_sha256(canonical))

    def test_snapshot_fails_closed_on_hosted_reject(self) -> None:
        with patch(
            "backend.pipeline_control.live_evidence.resolve_privileged_supabase_rest_credentials",
            side_effect=OSError("hosted"),
        ):
            self.assertIsNone(snapshot_restaurants_relation())


if __name__ == "__main__":
    unittest.main()
