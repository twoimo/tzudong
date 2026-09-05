#!/usr/bin/env python3
"""Property-based test for cluster-render metamorphism (Task 52.2).

Feature: platform-modernization (Requirement 14.5, design section C10 "이전
준비와 Deployment_Descriptor_Set"). This test encodes design **Property 34**
("클러스터 렌더링 메타모픽") against the pure-logic render surface of
``backend/pipeline_control/deployment_descriptor.py`` (task 49):
``render_multi_cluster``, ``render_difference_fields``, ``DERIVED_FIELDS``, and
the always-zero ``remoteApplyAttemptCount``.

Property 34 invariant (design "Correctness Properties"):

    For any two or more DISTINCT cluster identifiers rendered from the SAME
    Deployment_Descriptor_Set source, the set of fields that differ between the
    renders is a subset of the cluster-derived field set (DERIVED_FIELDS), and
    the remote-target apply attempt count is 0.

The render is local only (Requirement 14.6): no remote target is contacted and
``remoteApplyAttemptCount`` is 0 on every path. The test mirrors the sibling
``test_tag_fixity_pbt.py`` conventions -- Python ``hypothesis`` with a minimum
of 100 examples, running under ``python -m unittest`` -- and exercises both the
committed catalog and synthetically generated catalogs so the metamorphic
relation is checked across a wide component/cluster input space.

Validates: Requirements 14.5
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import deployment_descriptor as dd

_ROOT = Path(__file__).resolve().parents[2]
_CATALOG_PATH = _ROOT / "backend" / "deploy" / "deployment-descriptor-set.v1.json"
_COMMITTED_CATALOG = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Generators. A cluster identifier matches deployment_descriptor's
# ``_CLUSTER_ID_RE`` = ``^[a-z][a-z0-9-]{1,30}$`` (a lowercase-leading token of
# total length 2-31). We generate only valid identifiers so every render
# succeeds and the metamorphic relation is the property under test, not the
# input-validation branch.
# ---------------------------------------------------------------------------
_ID_HEAD = st.sampled_from("abcdefghijklmnopqrstuvwxyz")
_ID_TAIL_CHARS = st.sampled_from("abcdefghijklmnopqrstuvwxyz0123456789-")


@st.composite
def _cluster_ids(draw):
    """A single valid cluster identifier (matches ``_CLUSTER_ID_RE``)."""

    head = draw(_ID_HEAD)
    tail = draw(st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-",
                        min_size=1, max_size=30))
    return head + tail


@st.composite
def _distinct_cluster_id_sets(draw):
    """Two or more DISTINCT valid cluster identifiers."""

    ids = draw(
        st.lists(_cluster_ids(), min_size=2, max_size=5, unique=True)
    )
    return ids


# Component field building blocks. Values are cluster-invariant references only
# (no secret literals): image refs, resource requests, env names + source
# references, and secret reference names.
_COMPONENT_IDS = st.sampled_from(list(dd.COMPONENT_IDS))
_IMAGE_REFS = st.sampled_from(
    (
        "registry.local/tzudong/web-app:1.4.0",
        "registry.local/tzudong/pipeline-worker:1.4.0",
        "registry.local/tzudong/local-stack:1.4.0",
        "registry.local/tzudong/observability:1.4.0",
    )
)
_RESOURCE_REQUESTS = st.sampled_from(
    ("cpu=250m,memory=512Mi", "cpu=500m,memory=1Gi", "cpu=200m,memory=384Mi")
)
_ENV_NAMES = st.sampled_from(
    ("NODE_ENV", "TZUDONG_PROFILE", "POSTGRES_DB", "OTEL_LOG_LEVEL", "GF_SERVER_ROOT_URL")
)
_SECRET_REF_NAMES = st.sampled_from(
    ("SUPABASE_URL_REF", "PIPELINE_PG_DSN_REF", "GEMINI_API_KEY_REF",
     "LOG_SINK_URL_REF", "JWT_SECRET_REF")
)


@st.composite
def _components(draw):
    """A non-empty list of components with unique component ids (Req 14.2 shape)."""

    ids = draw(st.lists(_COMPONENT_IDS, min_size=1, max_size=5, unique=True))
    components = []
    for component_id in ids:
        env_names = draw(st.lists(_ENV_NAMES, min_size=1, max_size=3, unique=True))
        secret_refs = draw(
            st.lists(_SECRET_REF_NAMES, min_size=1, max_size=3, unique=True)
        )
        components.append(
            {
                "componentId": component_id,
                "imageRef": draw(_IMAGE_REFS),
                "resourceRequest": draw(_RESOURCE_REQUESTS),
                "envVars": [
                    {"name": name, "source": f"secretRef:{name}_SOURCE_REF"}
                    for name in env_names
                ],
                "secretRefs": secret_refs,
            }
        )
    return components


@st.composite
def _catalogs(draw):
    """A Deployment_Descriptor_Set catalog: committed or synthetic."""

    if draw(st.booleans()):
        return _COMMITTED_CATALOG
    return {"schemaVersion": 1, "components": draw(_components())}


class ClusterRenderMetamorphicProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 34: 클러스터 렌더링 메타모픽.
    # For two or more DISTINCT cluster identifiers rendered from the same
    # Deployment_Descriptor_Set source, the diff fields between renders are a
    # subset of DERIVED_FIELDS and the remote apply attempt count is 0.
    # Validates: Requirements 14.5

    @settings(max_examples=100, deadline=None)
    @given(catalog=_catalogs(), cluster_ids=_distinct_cluster_id_sets())
    def test_diff_fields_subset_of_derived_and_zero_remote_attempts(
        self, catalog, cluster_ids
    ):
        result = dd.render_multi_cluster(catalog, cluster_ids)

        # The whole multi-cluster render succeeds: same source, valid ids.
        self.assertTrue(result["ok"], msg=f"result={result}")
        self.assertIsNone(result["errorCode"])

        # Invariant part A: aggregate differing fields are a subset of the
        # cluster-derived field set. Any non-derived difference is a defect.
        differing = set(result["differingFields"])
        self.assertTrue(
            differing.issubset(set(dd.DERIVED_FIELDS)),
            msg=f"differingFields={sorted(differing)} clusters={cluster_ids}",
        )
        # base (image, resource request, env names, secret refs) never differs.
        self.assertNotIn("base", differing)

        # Invariant part B: zero remote-target apply attempts (local only).
        self.assertEqual(result["remoteApplyAttemptCount"], 0)

    @settings(max_examples=100, deadline=None)
    @given(catalog=_catalogs(), cluster_ids=_distinct_cluster_id_sets())
    def test_pairwise_difference_is_derived_only(self, catalog, cluster_ids):
        # The metamorphic relation holds for EVERY pair, not just the aggregate:
        # rendering the same source for any two distinct clusters differs only
        # in derived fields.
        renders = {
            cid: dd.render_descriptor(catalog, cid)["artifacts"] for cid in cluster_ids
        }
        for i in range(len(cluster_ids)):
            for j in range(i + 1, len(cluster_ids)):
                a, b = cluster_ids[i], cluster_ids[j]
                diff = dd.render_difference_fields(renders[a], renders[b])
                self.assertTrue(
                    diff.issubset(set(dd.DERIVED_FIELDS)),
                    msg=f"pair=({a},{b}) diff={sorted(diff)}",
                )
                self.assertNotIn("base", diff)

    @settings(max_examples=100, deadline=None)
    @given(cluster_id=_cluster_ids())
    def test_single_cluster_render_is_local_and_reflexive(self, cluster_id):
        # A single-cluster render is local (zero remote attempts) and identical
        # to itself: the metamorphic base case has an empty difference set.
        result = dd.render_descriptor(_COMMITTED_CATALOG, cluster_id)
        self.assertTrue(result["ok"], msg=f"result={result}")
        self.assertEqual(result["remoteApplyAttemptCount"], 0)
        diff = dd.render_difference_fields(result["artifacts"], result["artifacts"])
        self.assertEqual(diff, set())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
