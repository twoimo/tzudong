"""Property-based test for rename-scope / canonical-privacy classification.

Feature: platform-modernization, Property 14: 명명 변경 범위 판정
Validates: Requirements 7.4, 7.5, 7.8

This exercises ``classify_rename_scope`` in
``backend/bin/check_rename_ledger.py`` as a pure function -- no live git state,
no I/O. ``backend/bin`` scripts are standalone (no ``__init__.py``), so the
module is loaded by path, the same loading pattern the sibling
``test_check_rename_ledger_unittest.py`` and ``test_layout_move_pbt.py`` use.

The invariant is a biconditional over the target's scope (design C3,
Requirements 7.4/7.5/7.8):

  * an out-of-scope target ⟺ a corresponding non-``None`` fixed code, and
  * a canonical-privacy name / alias (7.5, 7.8) → ``privacy_contract_violation``
    and this **takes precedence** over the general scope check, while
  * a public route / public API response field / applied migration object /
    Supabase RPC name / persistent data path (7.4) → ``rename_scope_violation``,
    while
  * an in-scope internal-path target → accepted (``ok=True``, code ``None``).

The generator is the oracle: it draws each target from a mixed pool and carries
that target's expected classification by construction. Category-specific tokens
are prefixed (``z...`` for safe in-scope names, ``field_``/``migobj_``/``rpc_``
for injected out-of-scope pools) so a generated in-scope name can never collide
with one of the twelve fixed canonical privacy names, a public route prefix, or
a persistent data prefix. Injected public-API-field / migration-object /
RPC-name pools are threaded through a per-example ``RenameScopeRefs`` so the
reference sets a caller supplies are exercised too.

Every returned code -- accepted or rejected -- is asserted to lie inside the
checker's closed ``RENAME_CHECK_RESULT_CODES`` set.

Runnable via ``python -m unittest`` from the repo root. Requires ``hypothesis``.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Load the standalone backend/bin module by path (no package import available).
# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "backend" / "bin" / "check_rename_ledger.py"

_spec = importlib.util.spec_from_file_location("check_rename_ledger", MODULE_PATH)
assert _spec is not None and _spec.loader is not None
crl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crl)


# ---------------------------------------------------------------------------
# Token / path strategies.
#
# ``_SAFE_TOKEN`` is an in-scope internal identifier: prefixed with ``z`` so it
# can never equal one of the twelve canonical privacy names (all ``privacy_*``
# or specific ``*_privacy_*`` RPC names) nor the default RPC name
# ``batch_upsert_restaurants``. ``_SAFE_PATH`` is an in-scope internal file path
# under a package dir that is neither a public-route root (``apps/web/app/``)
# nor a persistent-data prefix.
# ---------------------------------------------------------------------------

_WORD = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz0123456789_",
    min_size=1,
    max_size=12,
)
_SAFE_TOKEN = _WORD.map(lambda s: "z" + s)

_SAFE_DIRS = st.sampled_from(
    (
        "backend/pipeline_control",
        "backend/utils",
        "backend/pipeline",
        "apps/web/lib",
    )
)


@st.composite
def _safe_path(draw):
    return f"{draw(_SAFE_DIRS)}/{draw(_SAFE_TOKEN)}.py"


# A route path under apps/web/app whose basename is a Next.js route file, with
# no leading-underscore (private) segment before the basename.
_PUBLIC_ROUTE_BASENAMES = st.sampled_from(("page.tsx", "route.ts", "layout.tsx"))


@st.composite
def _public_route_path(draw):
    depth = draw(st.integers(min_value=0, max_value=3))
    segs = [draw(_WORD) for _ in range(depth)]
    tail = "/".join(segs + [draw(_PUBLIC_ROUTE_BASENAMES)])
    return f"apps/web/app/{tail}"


@st.composite
def _persistent_data_path(draw):
    prefix = draw(st.sampled_from(crl.DEFAULT_PERSISTENT_DATA_PREFIXES))
    return f"{prefix}{draw(_WORD)}.sql"


# All twelve canonical privacy names (seven objects + five RPCs).
_PRIVACY_NAME = st.sampled_from(sorted(crl.CANONICAL_PRIVACY_NAMES))

_CATEGORIES = (
    "accepted",
    "privacy_old",
    "privacy_new",
    "privacy_alias",
    "privacy_precedence",  # privacy name AND an out-of-scope path -> privacy wins
    "public_route",
    "public_api_field",
    "migration_object",
    "rpc_name",
    "persistent_data_path",
)


@st.composite
def rename_targets(draw):
    """Draw a ``(target, refs, expected_code)`` triple; the draw is the oracle."""

    category = draw(st.sampled_from(_CATEGORIES))
    refs = crl.DEFAULT_SCOPE_REFS
    safe_a = draw(_SAFE_TOKEN)
    safe_b = draw(_SAFE_TOKEN)

    if category == "accepted":
        # Purely internal identifiers / path -> nothing triggers.
        target = {
            "oldName": safe_a,
            "newName": safe_b,
            "path": draw(st.one_of(st.none(), _safe_path())),
        }
        return target, refs, None

    if category in ("privacy_old", "privacy_new", "privacy_alias"):
        name = draw(_PRIVACY_NAME)
        if category == "privacy_old":
            target = {"oldName": name, "newName": safe_b}
        elif category == "privacy_new":
            target = {"oldName": safe_a, "newName": name}
        else:  # privacy_alias
            target = {"oldName": safe_a, "newName": safe_b, "aliasFor": name}
        return target, refs, crl.PRIVACY_CONTRACT_VIOLATION

    if category == "privacy_precedence":
        # A canonical privacy name paired with an out-of-scope route path: the
        # privacy contract (7.5/7.8) must win over the general scope check (7.4).
        name = draw(_PRIVACY_NAME)
        target = {
            "oldName": name,
            "newName": safe_b,
            "path": draw(_public_route_path()),
        }
        return target, refs, crl.PRIVACY_CONTRACT_VIOLATION

    if category == "public_route":
        target = {"oldName": safe_a, "newName": safe_b, "path": draw(_public_route_path())}
        return target, refs, crl.RENAME_SCOPE_VIOLATION

    if category == "public_api_field":
        field = "field_" + draw(_WORD)
        refs = crl.RenameScopeRefs(public_api_fields=frozenset({field}))
        # Place the offending field in oldName or newName.
        target = draw(
            st.sampled_from(
                [
                    {"oldName": field, "newName": safe_b},
                    {"oldName": safe_a, "newName": field},
                ]
            )
        )
        return target, refs, crl.RENAME_SCOPE_VIOLATION

    if category == "migration_object":
        obj = "migobj_" + draw(_WORD)
        refs = crl.RenameScopeRefs(migration_objects=frozenset({obj}))
        target = draw(
            st.sampled_from(
                [
                    {"oldName": obj, "newName": safe_b},
                    {"oldName": safe_a, "newName": obj},
                ]
            )
        )
        return target, refs, crl.RENAME_SCOPE_VIOLATION

    if category == "rpc_name":
        rpc = "rpc_" + draw(_WORD)
        refs = crl.RenameScopeRefs(rpc_names=frozenset({rpc}))
        target = draw(
            st.sampled_from(
                [
                    {"oldName": rpc, "newName": safe_b},
                    {"oldName": safe_a, "newName": rpc},
                ]
            )
        )
        return target, refs, crl.RENAME_SCOPE_VIOLATION

    # persistent_data_path
    target = {"oldName": safe_a, "newName": safe_b, "path": draw(_persistent_data_path())}
    return target, refs, crl.RENAME_SCOPE_VIOLATION


class RenameScopeClassificationProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 14: 명명 변경 범위 판정
    # Validates: Requirements 7.4, 7.5, 7.8
    @settings(max_examples=100, deadline=None)
    @given(case=rename_targets())
    def test_property_14_scope_biconditional(self, case) -> None:
        target, refs, expected_code = case

        result = crl.classify_rename_scope(target, refs=refs)

        # The generator is the oracle: the returned code equals the expected
        # classification exactly (including privacy precedence over scope).
        self.assertEqual(result["errorCode"], expected_code, msg=target)

        # Biconditional: out-of-scope (a non-None fixed code) ⟺ not ok.
        out_of_scope = expected_code is not None
        self.assertEqual(result["ok"], not out_of_scope, msg=target)
        self.assertEqual(result["errorCode"] is not None, out_of_scope, msg=target)

        # Every emitted code stays inside the checker's closed result set.
        self.assertIn(result["errorCode"], crl.RENAME_CHECK_RESULT_CODES, msg=target)

    @settings(max_examples=100, deadline=None)
    @given(name=_PRIVACY_NAME, route_seg=_WORD)
    def test_property_14_privacy_precedence_over_scope(self, name, route_seg) -> None:
        # A target that is simultaneously a canonical privacy name and an
        # out-of-scope migration object / RPC name resolves to the privacy code,
        # never the general scope code (7.5/7.8 precede 7.4).
        refs = crl.RenameScopeRefs(
            migration_objects=frozenset({name}),
            rpc_names=frozenset({name}),
            public_api_fields=frozenset({name}),
        )
        result = crl.classify_rename_scope(
            {"oldName": name, "newName": "z" + route_seg}, refs=refs
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], crl.PRIVACY_CONTRACT_VIOLATION)
        self.assertIn(result["errorCode"], crl.RENAME_CHECK_RESULT_CODES)


if __name__ == "__main__":
    unittest.main()
