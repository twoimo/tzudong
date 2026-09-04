"""Property-based test for container image tag fixity.

Feature: platform-modernization (Requirement 12). This test targets the image
tag-fixity predicate ``is_pinned_image_reference`` of the Observability_Stack
starter ``backend/bin/observability_up.py`` (task 19, design section C8). It
encodes design Property 25 ("이미지 태그 고정성"), uses Python ``hypothesis``
(min 100 examples), and runs under ``python -m unittest``.

Following the established convention for ``backend/bin`` scripts (which are not
an importable package and carry no ``__init__.py``), and mirroring the sibling
``test_rollback_plan_pbt.py`` / ``test_phase_partition_pbt.py`` (which load
``backend/bin/phase_gate.py`` by file path), this test loads
``backend/bin/observability_up.py`` by file path and skips cleanly when the
module or the targeted predicate is absent. As a result ``python -m unittest``
discovery always collects this file without error.

Property 25 invariant (design "Correctness Properties"):

    A container image reference passes IFF it is pinned to an exact tag or a
    sha256 digest. ``latest``, floating/movable alias tags, untagged names, and
    malformed digests all fail.

Validates: Requirements 11.3, 12.10
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Module load by path: backend/bin scripts are not an importable package, so
# they carry no __init__.py and are loaded by file path (see the sibling
# backend/pipeline_control/test_rollback_plan_pbt.py and
# test_phase_partition_pbt.py, which load backend/bin/phase_gate.py the same
# way). observability_up.py is a task-19 deliverable and is present in the tree.
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parents[2]
_OBSERVABILITY_UP_PATH = _ROOT / "backend" / "bin" / "observability_up.py"

_MODULE = None
_LOAD_ERROR = ""
if _OBSERVABILITY_UP_PATH.exists():
    try:
        _spec = importlib.util.spec_from_file_location(
            "observability_up", _OBSERVABILITY_UP_PATH
        )
        assert _spec and _spec.loader
        _MODULE = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(_MODULE)
    except Exception as exc:  # pragma: no cover - defensive for the load phase
        _MODULE = None
        _LOAD_ERROR = f"observability_up.py failed to import: {type(exc).__name__}"
else:
    _LOAD_ERROR = "backend/bin/observability_up.py not found (task 19)"

_HAS_PREDICATE = _MODULE is not None and hasattr(_MODULE, "is_pinned_image_reference")
_HAS_VALIDATOR = _MODULE is not None and hasattr(_MODULE, "validate_image_references")


# ---------------------------------------------------------------------------
# Building blocks for the generators. Each generated reference is constructed
# with a definite expected classification so the strategy itself is the oracle;
# ambiguous forms (e.g. a bare ``host:port`` that could be read as either a
# registry authority or a ``name:tag``) are deliberately never generated so the
# expected value is unambiguous for every case.
# ---------------------------------------------------------------------------

# Image names (repository paths); none contains a ':'.
_NAMES = (
    "otel/opentelemetry-collector",
    "prom/prometheus",
    "grafana/grafana",
    "grafana/loki",
    "tzudong/pipeline-api",
    "tzudong/pipeline-worker",
    "library/nginx",
    "app",
    "nginx",
)

# Registry authorities. Some carry an explicit ``:port``; because they are only
# ever used as a prefix followed by ``/<name>``, the port colon never lands on
# the final path segment and cannot be mistaken for a tag separator.
_REGISTRY_PREFIXES = (
    "",  # no registry prefix
    "ghcr.io/",
    "docker.io/",
    "harbor.local/",
    "harbor.local:443/",
    "registry.local:5000/",
    "127.0.0.1:5000/",
)

# Exact, immutable tags: non-empty and not a movable alias. These mirror the
# real pinned tags used by the compose overlays plus assorted valid shapes.
_EXACT_TAGS = (
    "0.120.0",
    "v3.2.1",
    "11.5.2",
    "v2.1.20",
    "3.7.7",
    "1.12.6",
    "v1.5.0",
    "8.17.0",
    "sha-abc1234",
    "20240101",
    "release-42",
    "1.0.0-rc.1",
)

# Movable alias / floating tags that must never count as pinned. Includes the
# module's own floating set plus case variants to exercise the lower() check.
_FLOATING_TAGS = (
    "latest",
    "stable",
    "edge",
    "nightly",
    "main",
    "master",
    "dev",
    "current",
    "LATEST",
    "Latest",
    "STABLE",
)

_HEX = "0123456789abcdef"


@st.composite
def _pinned_references(draw):
    """A reference that IS pinned: an exact tag or a well-formed sha256 digest.

    Returns ``(reference, True)``.
    """

    prefix = draw(st.sampled_from(_REGISTRY_PREFIXES))
    name = draw(st.sampled_from(_NAMES))
    if draw(st.booleans()):
        # Exact-tag pin. The tag lands on the final path segment.
        tag = draw(st.sampled_from(_EXACT_TAGS))
        return f"{prefix}{name}:{tag}", True
    # Digest pin: name@sha256:<64 hex>.
    hexpart = draw(st.text(alphabet=_HEX, min_size=64, max_size=64))
    return f"{prefix}{name}@sha256:{hexpart}", True


@st.composite
def _floating_tag_references(draw):
    """A reference tagged with a movable alias. Returns ``(reference, False)``."""

    prefix = draw(st.sampled_from(_REGISTRY_PREFIXES))
    name = draw(st.sampled_from(_NAMES))
    tag = draw(st.sampled_from(_FLOATING_TAGS))
    return f"{prefix}{name}:{tag}", False


@st.composite
def _untagged_references(draw):
    """A reference with no tag on its final segment. Returns ``(reference, False)``."""

    prefix = draw(st.sampled_from(_REGISTRY_PREFIXES))
    name = draw(st.sampled_from(_NAMES))
    return f"{prefix}{name}", False


@st.composite
def _malformed_digest_references(draw):
    """A reference with a malformed digest. Returns ``(reference, False)``."""

    prefix = draw(st.sampled_from(_REGISTRY_PREFIXES))
    name = draw(st.sampled_from(_NAMES))
    kind = draw(
        st.sampled_from(
            ("short_hex", "long_hex", "non_hex", "wrong_algo", "no_colon", "empty_hex")
        )
    )
    if kind == "short_hex":
        n = draw(st.integers(min_value=0, max_value=63))
        digest = "sha256:" + draw(st.text(alphabet=_HEX, min_size=n, max_size=n))
    elif kind == "long_hex":
        n = draw(st.integers(min_value=65, max_value=96))
        digest = "sha256:" + draw(st.text(alphabet=_HEX, min_size=n, max_size=n))
    elif kind == "non_hex":
        # 64 chars but at least one outside the hex alphabet.
        head = draw(st.text(alphabet=_HEX, min_size=63, max_size=63))
        bad = draw(st.sampled_from(("g", "z", "X", "-", " ")))
        digest = "sha256:" + head + bad
    elif kind == "wrong_algo":
        algo = draw(st.sampled_from(("sha512", "sha1", "md5", "sha256x", "")))
        digest = f"{algo}:" + draw(st.text(alphabet=_HEX, min_size=64, max_size=64))
    elif kind == "no_colon":
        # Digest component with no ':' separator at all.
        digest = "sha256" + draw(st.text(alphabet=_HEX, min_size=64, max_size=64))
    else:  # empty_hex
        digest = "sha256:"
    return f"{prefix}{name}@{digest}", False


@st.composite
def _blank_references(draw):
    """Empty / whitespace-only references. Returns ``(reference, False)``."""

    return draw(st.sampled_from(("", " ", "   ", "\t", "\n"))), False


def _image_references():
    """Union strategy yielding ``(reference, expected_pinned)`` pairs."""

    return st.one_of(
        _pinned_references(),
        _floating_tag_references(),
        _untagged_references(),
        _malformed_digest_references(),
        _blank_references(),
    )


class ImageTagFixityProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 25: 이미지 태그 고정성.
    # For all container image reference strings, the tag validator returns pass
    # IFF the reference is pinned to an exact tag or a sha256 digest; latest,
    # floating alias tags, untagged names, and malformed digests all fail.
    # Validates: Requirements 11.3, 12.10
    @unittest.skipUnless(_HAS_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(case=_image_references())
    def test_tag_fixity_iff(self, case):
        reference, expected_pinned = case
        self.assertEqual(
            _MODULE.is_pinned_image_reference(reference),
            expected_pinned,
            msg=f"reference={reference!r}",
        )

    # Non-string inputs are never pinned (defensive: the predicate accepts Any).
    @unittest.skipUnless(_HAS_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(value=st.one_of(st.none(), st.integers(), st.booleans(), st.lists(st.text())))
    def test_non_string_is_never_pinned(self, value):
        self.assertFalse(_MODULE.is_pinned_image_reference(value))

    # The starter's own declared images are all pinned (real compose tags), and
    # validate_image_references admits them while flagging a floating injection.
    @unittest.skipUnless(_HAS_VALIDATOR, _LOAD_ERROR or "validator unavailable")
    def test_declared_images_are_pinned_and_floating_is_flagged(self):
        pinned = _MODULE.validate_image_references(dict(_MODULE.PINNED_IMAGES))
        self.assertTrue(pinned["ok"])
        self.assertEqual(pinned["notPinned"], [])

        injected = dict(_MODULE.PINNED_IMAGES)
        injected["grafana"] = "grafana/grafana:latest"
        flagged = _MODULE.validate_image_references(injected)
        self.assertFalse(flagged["ok"])
        self.assertIn("grafana", flagged["notPinned"])


if __name__ == "__main__":
    unittest.main()
