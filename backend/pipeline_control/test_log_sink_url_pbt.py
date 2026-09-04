"""Property-based test for search-store (Log_Sink) URL admission (Property 31).

Feature: platform-modernization, Property 31: 검색 저장소 URL 승인
Validates: Requirement 13.10

Requirement 13.10 / design Property 31. For *every* pair of a data-environment
value and a candidate search-store URL, the ``admit_es_url``-family admission
function must return an admitted (normalized) URL **iff** all three conditions
hold simultaneously:

  * the data environment is ``local_db``,
  * the URL scheme is ``http`` or ``https`` (case-insensitive), and
  * the URL host is one of the approved local hosts
    ``{127.0.0.1, localhost, ::1, elasticsearch, loki}``.

Any other combination must be rejected with an exact bounded fixed code and no
forwarding must occur. The three fixed codes surfaced by the contract are:

  * ``es_url_host_rejected`` — data environment is not ``local_db``, or the host
    is missing / not in the approved set (includes the userinfo-spoofing trick
    ``http://loki@evil.example/`` whose real host is ``evil.example``),
  * ``es_url_required`` — the URL is missing or blank (only reachable once the
    environment is ``local_db``, because the environment check runs first), and
  * ``es_url_invalid`` — the scheme is present-but-disallowed (``ftp``, empty,
    etc.), again only reachable once the environment is ``local_db``.

The generator builds structured cases whose *intended* environment, scheme and
host are known by construction, so the expected accept/reject decision and fixed
code are derived from the generation intent rather than by re-parsing the URL
inside the test. A second property feeds arbitrary text through the admission
functions to assert the weaker but genuine invariant that only the three
bounded fixed codes are ever surfaced -- never an unbounded or provider error.

Both admission entry points are exercised: ``es_index.admit_es_url`` and the
Loki sink's ``loki_sink.admit_loki_url``. The latter reuses the former (``loki``
is part of the approved host set) and re-raises the identical fixed code under
``LokiSinkError``; the property asserts the Loki path mirrors the Elasticsearch
path exactly -- same admitted value, same fixed code -- so the shared contract
cannot silently diverge.

Runnable via
``python -m unittest backend.pipeline_control.test_log_sink_url_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.es_index import EsIndexError, admit_es_url
from backend.pipeline_control.loki_sink import LokiSinkError, admit_loki_url

# --- Contract restated from requirement 13.10 (not an import echo) ----------
# The approved local search-store host set. ``loki`` joins the Elasticsearch
# hosts because Loki reuses the same admission function (design B / 13.10).
_APPROVED_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "elasticsearch", "loki"})

# The three bounded fixed codes the admission contract may surface.
_CODE_HOST_REJECTED = "es_url_host_rejected"
_CODE_REQUIRED = "es_url_required"
_CODE_INVALID = "es_url_invalid"
_FIXED_CODES = frozenset({_CODE_HOST_REJECTED, _CODE_REQUIRED, _CODE_INVALID})


# --- Data-environment values spanning admit / reject on the env axis --------
# ``admit_es_url`` normalizes as ``(data_env or "local_db").strip() or
# "local_db"``, so None / "" / whitespace collapse to the admitted ``local_db``
# while any other non-empty token (and the case-variant ``LOCAL_DB``) is
# rejected on the environment axis.
_ENV_LOCAL = ["local_db", " local_db ", "\tlocal_db\n", None, "", "   ", "\t"]
_ENV_OTHER = ["hosted_db", "prod", "staging", "LOCAL_DB", "local", "localdb", "db"]
_data_envs = st.sampled_from(_ENV_LOCAL + _ENV_OTHER)


def _env_is_local(data_env: str | None) -> bool:
    """Restated environment normalization from the 13.10 contract."""
    return ((data_env or "local_db").strip() or "local_db") == "local_db"


# Approved hosts as (URL display form, normalized host). Includes case variants
# and the bracketed IPv6 loopback so host normalization is exercised.
_approved_hosts = st.sampled_from(
    [
        ("127.0.0.1", "127.0.0.1"),
        ("localhost", "localhost"),
        ("LOCALHOST", "localhost"),
        ("[::1]", "::1"),
        ("elasticsearch", "elasticsearch"),
        ("Elasticsearch", "elasticsearch"),
        ("loki", "loki"),
        ("LOKI", "loki"),
    ]
)

# Hosts outside the approved set, including SSRF-flavoured lookalikes.
_NON_APPROVED_HOSTS = [
    "evil.example",
    "example.org",
    "10.0.0.1",
    "8.8.8.8",
    "169.254.169.254",
    "metadata.internal",
    "attacker.local",
    "localhost.evil.example",
    "loki.evil.example",
    "elasticsearch.attacker",
]


class _Admit:
    """Sentinel for an expected admission carrying the normalized URL."""

    __slots__ = ("value",)

    def __init__(self, value: str) -> None:
        self.value = value

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Admit) and other.value == self.value

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"_Admit({self.value!r})"


class _Reject:
    """Sentinel for an expected rejection carrying the exact fixed code."""

    __slots__ = ("code",)

    def __init__(self, code: str) -> None:
        self.code = code

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Reject) and other.code == self.code

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"_Reject({self.code!r})"


@st.composite
def _cases(draw: st.DrawFn) -> tuple[str | None, str | None, Any]:
    """Draw (data_env, url, expected) with the expected outcome known by build.

    Because the scheme/host/blank intent is fixed at construction time, the
    expected decision is computed from that intent plus the environment-first
    precedence, independently of the URL parsing inside the module under test.
    """
    data_env = draw(_data_envs)
    env_ok = _env_is_local(data_env)
    category = draw(
        st.sampled_from(["valid", "bad_scheme", "bad_host", "userinfo", "blank"])
    )

    if category == "blank":
        url = draw(st.sampled_from([None, "", "   ", "\t", "\n  ", " \t "]))
        # Environment check runs before the blank check, so a non-local
        # environment is host-rejected even with a blank URL.
        expected = _Reject(_CODE_HOST_REJECTED) if not env_ok else _Reject(_CODE_REQUIRED)
        return data_env, url, expected

    if category == "valid":
        scheme = draw(st.sampled_from(["http", "https", "HTTP", "HTTPS", "HtTps"]))
        host_disp, _host_norm = draw(_approved_hosts)
        port = draw(st.sampled_from(["", ":9200", ":3100"]))
        path = draw(st.sampled_from(["", "/", "/_bulk", "/loki/api/v1/push/"]))
        url = f"{scheme}://{host_disp}{port}{path}"
        if not env_ok:
            return data_env, url, _Reject(_CODE_HOST_REJECTED)
        # Admitted; the module returns the stripped URL with trailing "/" cut.
        return data_env, url, _Admit(url.strip().rstrip("/"))

    if category == "bad_scheme":
        scheme = draw(
            st.sampled_from(["ftp", "gopher", "file", "ws", "wss", "javascript", ""])
        )
        host_disp, _host_norm = draw(_approved_hosts)
        # An empty scheme is rendered as a protocol-relative URL.
        url = f"//{host_disp}/" if scheme == "" else f"{scheme}://{host_disp}/"
        # Environment-first precedence: a non-local env is host-rejected before
        # the scheme is ever inspected.
        expected = _Reject(_CODE_HOST_REJECTED) if not env_ok else _Reject(_CODE_INVALID)
        return data_env, url, expected

    if category == "bad_host":
        scheme = draw(st.sampled_from(["http", "https"]))
        host = draw(st.sampled_from(_NON_APPROVED_HOSTS))
        port = draw(st.sampled_from(["", ":9200"]))
        url = f"{scheme}://{host}{port}/"
        # Both a non-local env and an unapproved host map to the same code.
        return data_env, url, _Reject(_CODE_HOST_REJECTED)

    # userinfo trick: an approved-looking userinfo in front of a real,
    # unapproved host. urlparse resolves the host to the unapproved authority.
    scheme = draw(st.sampled_from(["http", "https"]))
    fake_user = draw(st.sampled_from(["loki", "localhost", "elasticsearch", "127.0.0.1"]))
    evil_host = draw(st.sampled_from(_NON_APPROVED_HOSTS))
    url = f"{scheme}://{fake_user}@{evil_host}/"
    return data_env, url, _Reject(_CODE_HOST_REJECTED)


def _run_es(data_env: str | None, url: str | None) -> Any:
    try:
        return _Admit(admit_es_url(data_env=data_env, url=url))
    except EsIndexError as exc:
        return _Reject(exc.code)


def _run_loki(data_env: str | None, url: str | None) -> Any:
    try:
        return _Admit(admit_loki_url(data_env=data_env, url=url))
    except LokiSinkError as exc:
        return _Reject(exc.code)


class SearchStoreUrlAdmissionPropertyTests(unittest.TestCase):
    # --- Anchor unit tests: concrete, spec-illustrating examples ------------
    def test_approved_hosts_constant_matches_module(self) -> None:
        # The module's approved host set must equal the 13.10 set including loki.
        from backend.pipeline_control.es_index import ALLOWED_ES_HOSTS

        self.assertEqual(ALLOWED_ES_HOSTS, _APPROVED_HOSTS)

    def test_valid_elasticsearch_url_admitted(self) -> None:
        self.assertEqual(
            admit_es_url(data_env="local_db", url="http://elasticsearch:9200/"),
            "http://elasticsearch:9200",
        )

    def test_valid_loki_url_admitted_by_both(self) -> None:
        # loki host is admitted by admit_es_url and mirrored by admit_loki_url.
        self.assertEqual(
            admit_es_url(data_env="local_db", url="http://loki:3100"),
            "http://loki:3100",
        )
        self.assertEqual(
            admit_loki_url(data_env="local_db", url="http://loki:3100"),
            "http://loki:3100",
        )

    def test_non_local_env_host_rejected(self) -> None:
        with self.assertRaises(EsIndexError) as ctx:
            admit_es_url(data_env="hosted_db", url="http://loki:3100")
        self.assertEqual(ctx.exception.code, _CODE_HOST_REJECTED)

    def test_disallowed_scheme_invalid(self) -> None:
        with self.assertRaises(EsIndexError) as ctx:
            admit_es_url(data_env="local_db", url="ftp://loki:3100")
        self.assertEqual(ctx.exception.code, _CODE_INVALID)

    def test_blank_url_required(self) -> None:
        with self.assertRaises(LokiSinkError) as ctx:
            admit_loki_url(data_env="local_db", url="   ")
        self.assertEqual(ctx.exception.code, _CODE_REQUIRED)

    def test_userinfo_spoof_host_rejected(self) -> None:
        with self.assertRaises(EsIndexError) as ctx:
            admit_es_url(data_env="local_db", url="http://loki@evil.example/")
        self.assertEqual(ctx.exception.code, _CODE_HOST_REJECTED)

    # --- Property 31: exact accept/reject and fixed code --------------------
    # Feature: platform-modernization, Property 31: 검색 저장소 URL 승인
    # Validates: Requirement 13.10
    @settings(max_examples=100, deadline=None)
    @given(case=_cases())
    def test_property_31_search_store_url_admission(
        self, case: tuple[str | None, str | None, Any]
    ) -> None:
        data_env, url, expected = case

        # Exact accept/reject decision and fixed code for the Elasticsearch path.
        es_result = _run_es(data_env, url)
        self.assertEqual(es_result, expected)

        # A rejection surfaces one of the three bounded fixed codes only.
        if isinstance(es_result, _Reject):
            self.assertIn(es_result.code, _FIXED_CODES)

        # The Loki sink mirrors the Elasticsearch admission exactly: identical
        # admitted value and identical fixed code (surfaced as LokiSinkError).
        loki_result = _run_loki(data_env, url)
        self.assertEqual(loki_result, es_result)
        self.assertEqual(loki_result, expected)

    # --- Property 31 (bounded-code invariant over arbitrary input) ----------
    # Feature: platform-modernization, Property 31: 검색 저장소 URL 승인
    # Validates: Requirement 13.10
    @settings(max_examples=100, deadline=None)
    @given(
        data_env=st.one_of(st.none(), st.text(max_size=16)),
        url=st.one_of(st.none(), st.text(max_size=48)),
    )
    def test_property_31_only_bounded_codes_surface(
        self, data_env: str | None, url: str | None
    ) -> None:
        # For ANY input, admission either returns a str or rejects with exactly
        # one of the three bounded fixed codes -- never an unbounded/provider
        # error -- and the Loki path mirrors the Elasticsearch path.
        es_result = _run_es(data_env, url)
        loki_result = _run_loki(data_env, url)

        if isinstance(es_result, _Admit):
            self.assertIsInstance(es_result.value, str)
        else:
            self.assertIn(es_result.code, _FIXED_CODES)

        self.assertEqual(loki_result, es_result)


if __name__ == "__main__":
    unittest.main()
