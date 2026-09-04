"""Property-based test for the loopback exposure boundary.

Feature: platform-modernization (Requirement 12). This test targets two
predicates of the Observability_Stack starter ``backend/bin/observability_up.py``
(task 19, design section C8):

  * ``is_loopback_port_declaration`` — a docker compose port publish string
    passes IFF it binds ``127.0.0.1`` only (the explicit 3-part
    ``HOSTIP:HOSTPORT:CONTAINER`` form with host IP ``127.0.0.1``). Any
    all-interface form (``0.0.0.0``, ``::``, ``[::1]``, ``localhost``, a
    private or public address, or a host-less 1-/2-part form) fails.
  * ``is_approved_iframe_origin`` — an iframe embedding origin passes IFF it is
    a loopback admin origin (``http(s)://127.0.0.1[:port]``) present in the
    operator-approved allowlist. Non-loopback hosts, wildcards, and
    loopback-but-unlisted origins all fail.

It encodes design Property 26 ("루프백 노출 경계"), uses Python ``hypothesis``
(min 100 examples), and runs under ``python -m unittest``.

Following the established convention for ``backend/bin`` scripts (which are not
an importable package and carry no ``__init__.py``), and mirroring the sibling
``test_tag_fixity_pbt.py`` / ``test_rollback_plan_pbt.py`` (which load a
``backend/bin`` module by file path), this test loads
``backend/bin/observability_up.py`` by file path and skips cleanly when the
module or the targeted predicate is absent, so ``python -m unittest`` discovery
always collects this file without error.

Feature: platform-modernization, Property 26: 루프백 노출 경계
Validates: Requirements 12.2, 12.3, 12.12
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
# backend/pipeline_control/test_tag_fixity_pbt.py, which loads
# backend/bin/observability_up.py the same way). observability_up.py is a
# task-19 deliverable and is present in the tree.
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

_HAS_PORT_PREDICATE = _MODULE is not None and hasattr(
    _MODULE, "is_loopback_port_declaration"
)
_HAS_ORIGIN_PREDICATE = _MODULE is not None and hasattr(
    _MODULE, "is_approved_iframe_origin"
)
_HAS_PORT_VALIDATOR = _MODULE is not None and hasattr(
    _MODULE, "validate_port_declarations"
)
_HAS_ORIGIN_VALIDATOR = _MODULE is not None and hasattr(
    _MODULE, "validate_iframe_origins"
)


# ===========================================================================
# Port declaration generators. Each generated declaration is constructed with
# a definite expected classification so the strategy itself is the oracle.
# ===========================================================================

# Ports appearing on either side of a publish declaration.
_PORTS = ("80", "443", "3000", "3100", "4318", "8080", "9090", "29092")

# The only host IP that makes a 3-part declaration loopback-only.
_LOOPBACK_HOST = "127.0.0.1"

# Non-loopback host IPs: all-interface, IPv6, private, and public addresses.
_NON_LOOPBACK_HOSTS = (
    "0.0.0.0",
    "::",
    "127.0.0.2",  # loopback /8 but not the exact literal 127.0.0.1
    "10.0.0.1",
    "192.168.1.10",
    "172.16.0.5",
    "203.0.113.7",
    "8.8.8.8",
    "localhost",
)

# Optional protocol suffixes tolerated by the short syntax.
_PROTOS = ("", "/tcp", "/udp")


@st.composite
def _loopback_port_declarations(draw):
    """A 3-part declaration binding 127.0.0.1 only. Returns ``(decl, True)``."""

    host_port = draw(st.sampled_from(_PORTS))
    container_port = draw(st.sampled_from(_PORTS))
    proto = draw(st.sampled_from(_PROTOS))
    return f"{_LOOPBACK_HOST}:{host_port}:{container_port}{proto}", True


@st.composite
def _non_loopback_host_declarations(draw):
    """A 3-part declaration with a non-loopback host IP. Returns ``(decl, False)``."""

    host = draw(st.sampled_from(_NON_LOOPBACK_HOSTS))
    host_port = draw(st.sampled_from(_PORTS))
    container_port = draw(st.sampled_from(_PORTS))
    proto = draw(st.sampled_from(_PROTOS))
    return f"{host}:{host_port}:{container_port}{proto}", False


@st.composite
def _bracketed_ipv6_declarations(draw):
    """A bracketed IPv6 host form (never loopback-v4). Returns ``(decl, False)``."""

    host = draw(st.sampled_from(("[::1]", "[::]", "[fe80::1]")))
    host_port = draw(st.sampled_from(_PORTS))
    container_port = draw(st.sampled_from(_PORTS))
    proto = draw(st.sampled_from(_PROTOS))
    return f"{host}:{host_port}:{container_port}{proto}", False


@st.composite
def _all_interface_declarations(draw):
    """A host-less 1- or 2-part form that publishes on all interfaces.

    ``CONTAINER`` (1 part) or ``HOSTPORT:CONTAINER`` (2 parts) both bind every
    interface because no explicit host IP is declared. Returns ``(decl, False)``.
    """

    proto = draw(st.sampled_from(_PROTOS))
    if draw(st.booleans()):
        # 1-part: container port only.
        container_port = draw(st.sampled_from(_PORTS))
        return f"{container_port}{proto}", False
    # 2-part: host port : container port, no host IP.
    host_port = draw(st.sampled_from(_PORTS))
    container_port = draw(st.sampled_from(_PORTS))
    return f"{host_port}:{container_port}{proto}", False


@st.composite
def _blank_declarations(draw):
    """Empty / whitespace-only declarations. Returns ``(decl, False)``."""

    return draw(st.sampled_from(("", " ", "   ", "\t", "\n"))), False


def _port_declarations():
    """Union strategy yielding ``(declaration, expected_pass)`` pairs."""

    return st.one_of(
        _loopback_port_declarations(),
        _non_loopback_host_declarations(),
        _bracketed_ipv6_declarations(),
        _all_interface_declarations(),
        _blank_declarations(),
    )


# ===========================================================================
# iframe origin generators. The oracle is: pass IFF the origin is a loopback
# admin origin AND present in the operator-approved allowlist.
# ===========================================================================

# The operator-approved allowlist used across the origin properties. All
# entries are loopback admin origins, so membership + loopback == pass.
_APPROVED_ALLOWLIST = (
    "http://127.0.0.1:3000",
    "https://127.0.0.1:3000",
    "http://127.0.0.1:8080",
)

# Loopback origins that are NOT in the allowlist (loopback-but-unlisted).
_UNLISTED_LOOPBACK_ORIGINS = (
    "http://127.0.0.1:9999",
    "https://127.0.0.1:1234",
    "http://127.0.0.1",
    "http://127.0.0.1:4318",
)

# Non-loopback origins (host is not the exact 127.0.0.1 literal).
_NON_LOOPBACK_ORIGINS = (
    "http://localhost:3000",
    "https://example.com:3000",
    "http://10.0.0.1:3000",
    "http://[::1]:3000",
    "https://grafana.local:3001",
    "http://0.0.0.0:3000",
)

# Wildcard origins (never approved even if otherwise loopback-shaped).
_WILDCARD_ORIGINS = (
    "*",
    "http://*",
    "http://*.127.0.0.1:3000",
    "http://127.0.0.1:*",
    "https://*:3000",
)


@st.composite
def _approved_origins(draw):
    """An allowlisted loopback admin origin. Returns ``(origin, True)``."""

    return draw(st.sampled_from(_APPROVED_ALLOWLIST)), True


@st.composite
def _unlisted_loopback_origins(draw):
    """A loopback origin absent from the allowlist. Returns ``(origin, False)``."""

    return draw(st.sampled_from(_UNLISTED_LOOPBACK_ORIGINS)), False


@st.composite
def _non_loopback_origins(draw):
    """A non-loopback origin. Returns ``(origin, False)``."""

    return draw(st.sampled_from(_NON_LOOPBACK_ORIGINS)), False


@st.composite
def _wildcard_origins(draw):
    """A wildcard origin. Returns ``(origin, False)``."""

    return draw(st.sampled_from(_WILDCARD_ORIGINS)), False


@st.composite
def _blank_origins(draw):
    """Empty / whitespace-only origins. Returns ``(origin, False)``."""

    return draw(st.sampled_from(("", " ", "   ", "\t", "\n"))), False


def _iframe_origins():
    """Union strategy yielding ``(origin, expected_pass)`` pairs."""

    return st.one_of(
        _approved_origins(),
        _unlisted_loopback_origins(),
        _non_loopback_origins(),
        _wildcard_origins(),
        _blank_origins(),
    )


class LoopbackBoundaryProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 26: 루프백 노출 경계.
    # A port declaration passes IFF it binds 127.0.0.1 only; an iframe origin
    # passes IFF it is a loopback admin origin present in the operator-approved
    # allowlist.
    # Validates: Requirements 12.2, 12.3, 12.12

    # --- Port declaration boundary (12.2, 12.3) ---------------------------

    @unittest.skipUnless(_HAS_PORT_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(case=_port_declarations())
    def test_port_declaration_loopback_iff(self, case):
        declaration, expected_pass = case
        self.assertEqual(
            _MODULE.is_loopback_port_declaration(declaration),
            expected_pass,
            msg=f"declaration={declaration!r}",
        )

    # Non-string port declarations are never loopback (predicate accepts Any).
    @unittest.skipUnless(_HAS_PORT_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(value=st.one_of(st.none(), st.integers(), st.booleans(), st.lists(st.text())))
    def test_non_string_port_is_never_loopback(self, value):
        self.assertFalse(_MODULE.is_loopback_port_declaration(value))

    # validate_port_declarations admits an all-loopback map and rejects a map
    # with any non-loopback binding via non_loopback_bind_rejected.
    @unittest.skipUnless(_HAS_PORT_VALIDATOR, _LOAD_ERROR or "validator unavailable")
    @settings(max_examples=100, deadline=None)
    @given(
        loopback=st.dictionaries(
            keys=st.sampled_from(("a", "b", "c", "d")),
            values=_loopback_port_declarations().map(lambda pair: pair[0]),
            min_size=1,
            max_size=4,
        ),
        bad=_non_loopback_host_declarations(),
    )
    def test_validate_port_declarations_fails_closed(self, loopback, bad):
        ok = _MODULE.validate_port_declarations(loopback)
        self.assertTrue(ok["ok"], msg=f"loopback={loopback!r}")
        self.assertIsNone(ok["errorCode"])
        self.assertEqual(ok["nonLoopback"], [])

        injected = dict(loopback)
        injected["intruder"] = bad[0]
        rejected = _MODULE.validate_port_declarations(injected)
        self.assertFalse(rejected["ok"])
        self.assertEqual(
            rejected["errorCode"], _MODULE.NON_LOOPBACK_BIND_REJECTED
        )
        self.assertIn("intruder", rejected["nonLoopback"])

    # --- iframe origin boundary (12.12) -----------------------------------

    @unittest.skipUnless(_HAS_ORIGIN_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(case=_iframe_origins())
    def test_iframe_origin_approved_iff(self, case):
        origin, expected_pass = case
        self.assertEqual(
            _MODULE.is_approved_iframe_origin(origin, _APPROVED_ALLOWLIST),
            expected_pass,
            msg=f"origin={origin!r}",
        )

    # A loopback origin that is well-formed but not in the allowlist fails,
    # confirming membership is necessary (not merely loopback shape).
    @unittest.skipUnless(_HAS_ORIGIN_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(origin=st.sampled_from(_UNLISTED_LOOPBACK_ORIGINS))
    def test_loopback_but_unlisted_origin_fails(self, origin):
        self.assertFalse(
            _MODULE.is_approved_iframe_origin(origin, _APPROVED_ALLOWLIST)
        )
        # But it passes once added to the allowlist -> membership is the gate.
        self.assertTrue(
            _MODULE.is_approved_iframe_origin(origin, (*_APPROVED_ALLOWLIST, origin))
        )

    # Non-string origins are never approved (predicate accepts Any).
    @unittest.skipUnless(_HAS_ORIGIN_PREDICATE, _LOAD_ERROR or "predicate unavailable")
    @settings(max_examples=100, deadline=None)
    @given(value=st.one_of(st.none(), st.integers(), st.booleans(), st.lists(st.text())))
    def test_non_string_origin_is_never_approved(self, value):
        self.assertFalse(_MODULE.is_approved_iframe_origin(value, _APPROVED_ALLOWLIST))

    # validate_iframe_origins admits an all-approved allowlist and rejects one
    # containing any non-conforming origin via non_loopback_bind_rejected.
    @unittest.skipUnless(_HAS_ORIGIN_VALIDATOR, _LOAD_ERROR or "validator unavailable")
    @settings(max_examples=100, deadline=None)
    @given(bad=st.sampled_from(_NON_LOOPBACK_ORIGINS + _WILDCARD_ORIGINS))
    def test_validate_iframe_origins_fails_closed(self, bad):
        ok = _MODULE.validate_iframe_origins(
            list(_APPROVED_ALLOWLIST), approved=_APPROVED_ALLOWLIST
        )
        self.assertTrue(ok["ok"])
        self.assertIsNone(ok["errorCode"])
        self.assertEqual(ok["rejectedOrigins"], [])

        rejected = _MODULE.validate_iframe_origins(
            [*_APPROVED_ALLOWLIST, bad], approved=_APPROVED_ALLOWLIST
        )
        self.assertFalse(rejected["ok"])
        self.assertEqual(
            rejected["errorCode"], _MODULE.NON_LOOPBACK_BIND_REJECTED
        )
        self.assertIn(bad, rejected["rejectedOrigins"])


if __name__ == "__main__":
    unittest.main()
