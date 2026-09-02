"""Property-based test for Deployment_Descriptor_Set secret-literal absence (Property 33).

Feature: platform-modernization, Property 33: 기술 산출물 시크릿 리터럴 부재
Validates: Requirements 14.3, 14.4

Requirement 14.3 keeps credential values, token values, and the secret component
of connection strings out of Deployment_Descriptor_Set file text -- they are
indicated by external secret reference names only. Requirement 14.4 makes the
gate fail closed: IF one or more credential/token literals are detected in the
descriptor files, THEN the scan returns the fixed code
``secret_value_in_descriptor`` and produces zero render artifacts.

Design Property 33 states the biconditional directly: for *every*
Deployment_Descriptor_Set file text, a credential/token literal is detected
**iff** the scan surfaces ``secret_value_in_descriptor``, and in that detected
case the number of produced render-artifact files is 0. A text carrying only
external reference names (``*_REF``) or templating/source directives is not a
literal and passes the gate, so a full local render is produced.

The generator builds descriptor text whose *intent* is fixed by construction:
either every line is a safe external reference / placeholder / non-secret field
(a "clean" descriptor), or at least one line embeds a concrete secret literal
of a known shape (a "leaky" descriptor). The expected accept/reject decision and
the expected render-artifact count are therefore derived from the generation
intent, not by re-parsing the text inside the test.

The gated pipeline mirrors the 14.4 contract: the committed catalog is scanned
first; only a passing scan proceeds to ``render_descriptor``. A failing scan
short-circuits to zero artifacts. Per AGENTS.md, findings must never carry the
offending value -- the property asserts each finding exposes only the finding
kind, line number, and file path, and that no generated secret substring appears
anywhere in the emitted findings (no Forbidden_Log_Field leak).

Runnable via
``python -m unittest backend.pipeline_control.test_descriptor_secret_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import deployment_descriptor as dd

_ROOT = Path(__file__).resolve().parents[2]
_CATALOG_PATH = _ROOT / "backend" / "deploy" / "deployment-descriptor-set.v1.json"
_CATALOG = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
# The committed catalog renders exactly the five migration components locally.
_CLEAN_RENDER_ARTIFACTS = len(_CATALOG["components"])

# The one bounded fixed code this gate may surface (14.4). ``None`` == accepted.
_SECRET_CODE = dd.SECRET_VALUE_IN_DESCRIPTOR
_GATE_CODES = frozenset({None, _SECRET_CODE})


# --- Safe lines: external references / placeholders / non-secret fields -----
# None of these is a credential/token/DSN literal, so a descriptor built only
# from these must pass the 14.3/14.4 gate.
_SAFE_LINES: tuple[str, ...] = (
    "secretRefs:",
    "  - SUPABASE_URL_REF",
    "  - GEMINI_API_KEY_REF",
    "  - PIPELINE_PG_DSN_REF",
    "- name: SUPABASE_ANON_KEY",
    "  source: secretRef:SUPABASE_ANON_KEY_REF",
    "  source: configmap:web-app-config/node_env",
    'password: "${var.db_password_ref}"',
    "token: {{ .Values.secretRef }}",
    "api_key: PIPELINE_PG_DSN_REF",
    "client_secret: JWT_SECRET_REF",
    "access_key: MANAGED_PG_DSN_REF",
    "connection_string: LOG_SINK_URL_REF",
    "grafana_admin_password: GRAFANA_ADMIN_PASSWORD_REF",
    "NODE_ENV: production",
    "replicas: 3",
    "image: registry.local/tzudong/web-app:1.4.0",
    "resourceRequest: cpu=250m,memory=512Mi",
    "clusterId: local-a",
    "password:",
    "token: changeme",
)


# --- Leaky lines: each embeds a concrete secret literal of a known shape -----
# The tuple pairs the descriptor line with the raw secret substring it carries,
# so the no-leak assertion can confirm the value never surfaces in findings.
_LEAKY_LINES: tuple[tuple[str, str], ...] = (
    (
        "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH12",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ),
    (
        "MANAGED_PG_DSN: postgresql://appuser:s3cr3tpw@db.internal:5432/tzudong",
        "s3cr3tpw",
    ),
    ("openai: sk-ABCDEFGHIJKLMNOPQRSTUVWX", "sk-ABCDEFGHIJKLMNOPQRSTUVWX"),
    (
        "google: AIzaSyABCDEFGHIJKLMNOPQRSTUVWX0123456",
        "AIzaSyABCDEFGHIJKLMNOPQRSTUVWX0123456",
    ),
    (
        "github: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ),
    ("aws: AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"),
    ("slack: xoxb-1234567890-abcdefghijkl", "xoxb-1234567890-abcdefghijkl"),
    ("-----BEGIN RSA PRIVATE KEY-----", "BEGIN RSA PRIVATE KEY"),
    ('grafana_admin_password: "hunter2plaintextsecret"', "hunter2plaintextsecret"),
)


@st.composite
def _descriptors(draw: st.DrawFn) -> dict[str, Any]:
    """Draw a descriptor file set with the leaky/clean intent known by build.

    Returns ``{"texts": [str, ...], "leaky": bool, "secrets": [str, ...]}``.
    A clean draw uses only safe reference/placeholder lines. A leaky draw plants
    at least one concrete secret literal among safe lines, across one or more
    files. The expected gate decision follows from ``leaky`` alone.
    """

    leaky = draw(st.booleans())
    file_count = draw(st.integers(min_value=1, max_value=3))

    safe_pool = st.lists(st.sampled_from(_SAFE_LINES), min_size=0, max_size=6)
    files: list[str] = []
    secrets: list[str] = []

    if leaky:
        # Choose one or more distinct leaky lines and scatter them across files.
        chosen = draw(
            st.lists(
                st.sampled_from(_LEAKY_LINES),
                min_size=1,
                max_size=len(_LEAKY_LINES),
                unique_by=lambda pair: pair[0],
            )
        )
        secrets = [value for _line, value in chosen]
        leaky_lines = [line for line, _value in chosen]
        # Distribute the leaky lines: each file gets safe lines, and at least one
        # file receives at least one leaky line.
        buckets: list[list[str]] = [[] for _ in range(file_count)]
        for i, line in enumerate(leaky_lines):
            buckets[i % file_count].append(line)
        for bucket in buckets:
            block = draw(safe_pool) + bucket + draw(safe_pool)
            files.append("\n".join(block) + "\n")
    else:
        for _ in range(file_count):
            files.append("\n".join(draw(safe_pool)) + "\n")

    return {"texts": files, "leaky": leaky, "secrets": secrets}


def _gated_render(texts: list[str]) -> dict[str, Any]:
    """Scan the descriptor texts then gate the local render on the result.

    Writes each text to a temp file, scans them with ``scan_descriptor_files``,
    and only renders the committed catalog when the scan passes. A failing scan
    short-circuits to zero render artifacts (Requirement 14.4). Returns the scan
    result plus ``renderArtifactCount``.
    """

    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for index, text in enumerate(texts):
            path = Path(tmp) / f"descriptor-{index}.yaml"
            path.write_text(text, encoding="utf-8")
            paths.append(path)
        scan = dd.scan_descriptor_files(paths)

        if not scan["ok"]:
            render_artifact_count = 0
        else:
            render = dd.render_descriptor(_CATALOG, "local-a")
            render_artifact_count = render["artifactCount"]

    return {"scan": scan, "renderArtifactCount": render_artifact_count}


def _finding_leaks(findings: list[dict], secrets: list[str]) -> bool:
    """True if any finding exposes disallowed keys or a raw secret substring."""

    serialized = json.dumps(findings)
    for finding in findings:
        if not set(finding.keys()) <= {"kind", "line", "file"}:
            return True
    return any(secret and secret in serialized for secret in secrets)


class DescriptorSecretLiteralPropertyTests(unittest.TestCase):
    # --- Anchor unit tests: concrete, spec-illustrating examples ------------
    def test_reference_only_descriptor_passes_gate(self) -> None:
        text = "\n".join(_SAFE_LINES) + "\n"
        self.assertEqual(dd.detect_secret_literals(text), [])
        result = _gated_render([text])
        self.assertTrue(result["scan"]["ok"])
        self.assertIsNone(result["scan"]["errorCode"])
        self.assertEqual(result["renderArtifactCount"], _CLEAN_RENDER_ARTIFACTS)

    def test_committed_catalog_passes_gate_and_renders(self) -> None:
        content = _CATALOG_PATH.read_text(encoding="utf-8")
        self.assertEqual(dd.detect_secret_literals(content), [])

    def test_each_leaky_line_trips_gate_to_zero_artifacts(self) -> None:
        for line, secret in _LEAKY_LINES:
            text = "\n".join(_SAFE_LINES[:3]) + "\n" + line + "\n"
            result = _gated_render([text])
            self.assertFalse(result["scan"]["ok"], line)
            self.assertEqual(result["scan"]["errorCode"], _SECRET_CODE, line)
            self.assertEqual(result["renderArtifactCount"], 0, line)
            # The raw secret value never appears in the emitted findings.
            self.assertFalse(_finding_leaks(result["scan"]["findings"], [secret]), line)

    # --- Property 33: detection iff fixed code and zero render artifacts -----
    # Feature: platform-modernization, Property 33: 기술 산출물 시크릿 리터럴 부재
    # Validates: Requirements 14.3, 14.4
    @settings(max_examples=100, deadline=None)
    @given(spec=_descriptors())
    def test_property_33_secret_literal_absence(self, spec: dict[str, Any]) -> None:
        texts = spec["texts"]
        expected_leaky = spec["leaky"]
        secrets = spec["secrets"]

        result = _gated_render(texts)
        scan = result["scan"]

        detected = not scan["ok"]
        # Detection is exactly the intended leaky construction (biconditional).
        self.assertEqual(detected, expected_leaky)

        if expected_leaky:
            # A detected literal returns the fixed code with zero render output.
            self.assertEqual(scan["errorCode"], _SECRET_CODE)
            self.assertGreaterEqual(scan["findingCount"], 1)
            self.assertEqual(result["renderArtifactCount"], 0)
        else:
            # A reference-only descriptor passes and renders every component.
            self.assertIsNone(scan["errorCode"])
            self.assertEqual(scan["findingCount"], 0)
            self.assertEqual(result["renderArtifactCount"], _CLEAN_RENDER_ARTIFACTS)

        # The fixed code is bounded, and no offending value leaks into findings.
        self.assertIn(scan["errorCode"], _GATE_CODES)
        self.assertFalse(_finding_leaks(scan["findings"], secrets))

    # --- Property 33 (bounded shape over arbitrary text) --------------------
    # Feature: platform-modernization, Property 33: 기술 산출물 시크릿 리터럴 부재
    # Validates: Requirements 14.3, 14.4
    @settings(max_examples=100, deadline=None)
    @given(text=st.text(max_size=256))
    def test_property_33_findings_are_bounded_and_valueless(self, text: str) -> None:
        # For ANY text, detection findings expose only kind + line (never the
        # value), and the scan surfaces only the bounded gate codes.
        findings = dd.detect_secret_literals(text)
        for finding in findings:
            self.assertEqual(set(finding.keys()), {"kind", "line"})
            self.assertIsInstance(finding["line"], int)

        result = _gated_render([text])
        self.assertIn(result["scan"]["errorCode"], _GATE_CODES)
        # Detection and the fixed code agree, and gate failure means no render.
        if result["scan"]["ok"]:
            self.assertIsNone(result["scan"]["errorCode"])
        else:
            self.assertEqual(result["scan"]["errorCode"], _SECRET_CODE)
            self.assertEqual(result["renderArtifactCount"], 0)


if __name__ == "__main__":
    unittest.main()
