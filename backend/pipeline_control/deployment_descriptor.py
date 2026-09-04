"""Deployment_Descriptor_Set logic for the platform-modernization spec.

Feature: platform-modernization (Requirements 14.2-14.7, 14.9-14.11; design
section C10 "이전 준비와 Deployment_Descriptor_Set"). This pure-logic module
backs the Deployment_Descriptor_Set that lives as Helm charts under
``backend/deploy/helm/`` and OpenTofu configs under ``backend/deploy/opentofu/``.

It provides four fail-closed capabilities, each returning the
``{"ok", "errorCode", ...}`` dict shape and the bounded fixed-code discipline
used across ``backend/pipeline_control`` (``schedule.py``, ``profiles.py``,
``ledger_validation.py``):

  * **Secret-literal detection** (Requirements 14.3, 14.4). Credential, token,
    and connection-string secret components must be excluded from descriptor
    file text and indicated by external secret reference names only. A single
    detected literal returns ``secret_value_in_descriptor`` and the caller
    produces zero render artifacts. Findings carry only a finding *kind* and a
    line number -- never the offending value (no Forbidden_Log_Field).

  * **Cluster render** (Requirements 14.5, 14.6, 14.7). The cluster identifier
    is a render parameter. The same component definitions render for two or more
    cluster identifiers and the only fields that differ are derived from the
    cluster identifier (``namespace``, ``releaseName``, ``clusterLabel``,
    ``fullname``). Rendering is local only: the summary records a remote apply
    attempt count of 0. A render that requests remote cluster credentials or
    remote apply permission is refused with ``remote_apply_not_admitted`` and
    leaves no partial artifact.

  * **Vercel project verification** (Requirements 14.9, 14.10). Any Vercel
    action first verifies the Git-integrated ``tzudong`` project identifier and
    its linked repository reference and reads the confirmed identifier back. An
    unverified identifier or a ``web`` project directive returns
    ``vercel_project_not_verified``.

  * **DNS scope guard** (Requirement 14.11). A DNS record change request is out
    of scope for this spec's automation and returns ``dns_change_out_of_scope``
    without performing the change.

The module performs no I/O of its own except reading descriptor file text passed
by path; it reads no environment and never contacts a remote target.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Bounded fixed codes (design C10 / error-code table). ``None`` == accepted.
# ---------------------------------------------------------------------------
SECRET_VALUE_IN_DESCRIPTOR = "secret_value_in_descriptor"  # 14.4
REMOTE_APPLY_NOT_ADMITTED = "remote_apply_not_admitted"  # 14.7
VERCEL_PROJECT_NOT_VERIFIED = "vercel_project_not_verified"  # 14.10
DNS_CHANGE_OUT_OF_SCOPE = "dns_change_out_of_scope"  # 14.11

DESCRIPTOR_CODES = frozenset(
    {
        None,
        SECRET_VALUE_IN_DESCRIPTOR,
        REMOTE_APPLY_NOT_ADMITTED,
        VERCEL_PROJECT_NOT_VERIFIED,
        DNS_CHANGE_OUT_OF_SCOPE,
    }
)

# The five migration components (design C10 table). Rendering and the on-disk
# descriptor set must cover exactly these.
COMPONENT_IDS = (
    "Web_App",
    "Backend_Runtime",
    "Local_Stack",
    "Observability_Stack",
    "Log_Pipeline",
)

# Fields that MAY differ between two cluster renders (Requirement 14.5). Any
# render difference outside this set is a defect.
DERIVED_FIELDS = ("namespace", "releaseName", "clusterLabel", "fullname")

# The Git-integrated Vercel project this spec admits. A stale ``web`` project is
# explicitly rejected (Requirement 14.10, AGENTS.md Vercel rule).
ADMITTED_VERCEL_PROJECT = "tzudong"
REJECTED_VERCEL_PROJECT = "web"


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


# ---------------------------------------------------------------------------
# Secret-literal detection (Requirements 14.3, 14.4).
# ---------------------------------------------------------------------------
#
# A "secret literal" is a credential value, a token value, or a connection
# string carrying an embedded secret component -- i.e. an actual secret written
# into the descriptor text rather than an external reference name. A reference
# is any of: an ALL-CAPS ``*_REF`` identifier, a ``secretRef:``/``configmap:``
# source directive, a templating expression (Helm ``{{ }}`` or OpenTofu
# ``${ }`` / ``var.`` / ``local.`` / ``data.``), or an empty/placeholder value.

# Format-specific literal signatures. Each catches a concrete secret shape.
_LITERAL_SIGNATURES: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    # JSON Web Token (three base64url segments).
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}")),
    # Connection string / URL with embedded userinfo password (scheme://user:pass@).
    ("connection_string_userinfo", re.compile(r"[a-z][a-z0-9+.\-]*://[^\s/@:]+:[^\s/@]+@")),
    # OpenAI-style key.
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{16,}")),
    # Google API key.
    ("google_api_key", re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}")),
    # GitHub personal/OAuth token.
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    # AWS access key id.
    ("aws_access_key_id", re.compile(r"\bAKIA[A-Z0-9]{12,}")),
    # Slack token.
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    # PEM private key block.
    ("private_key_block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
)

# A secret-ish key whose value, when a literal, is a credential/token/DSN.
_SECRET_KEY_RE = re.compile(
    r"(?i)(password|passwd|secret|token|api[_\-]?key|apikey|"
    r"private[_\-]?key|access[_\-]?key|client[_\-]?secret|"
    r"dsn|connection[_\-]?string|connectionstring)"
)

# key: value  /  key = value  /  - key: value  (YAML, HCL, env-ish lines).
_KEY_VALUE_RE = re.compile(
    r"""^\s*(?:-\s*)?["']?(?P<key>[A-Za-z0-9_.\-]+)["']?\s*[:=]\s*(?P<value>\S.*?)\s*$"""
)

# An external reference name: ALL-CAPS identifier ending in ``_REF``.
_REFERENCE_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*_REF$")


def _strip_scalar(value: str) -> str:
    """Strip surrounding quotes and trailing inline commas/brackets from a scalar."""

    text = value.strip()
    # Drop a trailing YAML/HCL comment.
    # (Only when the ``#`` is clearly a comment separated by whitespace.)
    text = re.sub(r"\s+#.*$", "", text)
    text = text.strip().strip(",")
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1]
    return text.strip()


def _value_is_reference(value: str) -> bool:
    """True when ``value`` is an external reference rather than a secret literal.

    References include ``*_REF`` names, ``secretRef:``/``configmap:`` source
    directives, templating expressions, and empty/placeholder scalars. These
    never count as secret literals.
    """

    text = _strip_scalar(value)
    if text == "":
        return True
    lowered = text.lower()
    # Placeholders that carry no secret.
    if text in {"~", "null", "{}", "[]"} or lowered in {"none", "changeme", "replace_me"}:
        return True
    # Structure openers (a nested block/list, not a scalar value).
    if text[0] in "{[|>":
        return True
    # Templating expressions resolved out of band.
    if "{{" in text or "${" in text:
        return True
    if re.match(r"^(var|local|data|module)\.", text):
        return True
    # Source directives from our descriptor schema.
    if text.startswith(("secretRef:", "configmap:", "configMapKeyRef", "secretKeyRef")):
        return True
    # A bare or quoted reference name.
    if _REFERENCE_NAME_RE.match(text):
        return True
    return False


def detect_secret_literals(text: Any) -> list[dict]:
    """Return a bounded list of secret-literal findings for ``text``.

    Each finding is ``{"kind": <signature-or-"secret_key_literal">, "line": n}``
    and carries NO offending value -- only the finding kind and 1-based line
    number, so no Forbidden_Log_Field is emitted. An empty list means no literal
    was detected.
    """

    if not isinstance(text, str) or not text:
        return []

    findings: list[dict] = []
    lines = text.splitlines()
    for index, line in enumerate(lines, start=1):
        # 1) Format-specific literal signatures anywhere on the line.
        for kind, pattern in _LITERAL_SIGNATURES:
            if pattern.search(line):
                findings.append({"kind": kind, "line": index})

        # 2) A secret-ish key assigned a literal (non-reference) value.
        match = _KEY_VALUE_RE.match(line)
        if match:
            key = match.group("key")
            value = match.group("value")
            if _SECRET_KEY_RE.search(key) and not _value_is_reference(value):
                findings.append({"kind": "secret_key_literal", "line": index})

    return findings


def scan_descriptor_files(paths: Iterable[str | Path]) -> dict:
    """Scan descriptor files for secret literals (Requirements 14.3, 14.4).

    Returns ``{"ok": bool, "errorCode": str|None, "findingCount": int,
    "findings": [...], "scannedFileCount": int}``. When one or more literals are
    detected across the files, ``errorCode`` is ``secret_value_in_descriptor``
    and the caller must produce zero render artifacts. Findings are bounded and
    carry only file path, kind, and line number.
    """

    findings: list[dict] = []
    scanned = 0
    for raw in paths:
        path = Path(raw)
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        scanned += 1
        for finding in detect_secret_literals(content):
            findings.append({"file": path.as_posix(), **finding})

    if findings:
        return _result(
            False,
            SECRET_VALUE_IN_DESCRIPTOR,
            findingCount=len(findings),
            findings=findings,
            scannedFileCount=scanned,
        )
    return _result(True, None, findingCount=0, findings=[], scannedFileCount=scanned)


# ---------------------------------------------------------------------------
# Cluster render (Requirements 14.5, 14.6, 14.7).
# ---------------------------------------------------------------------------
_CLUSTER_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")


def kubernetes_name(value: str) -> str:
    """Normalize a declared identifier to a bounded RFC 1123 name."""

    normalized = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    return normalized[:63].rstrip("-")


def derived_fields(cluster_id: str, component_id: str) -> dict:
    """Return the cluster-derived fields for a component render (Requirement 14.5)."""

    return {
        "namespace": f"tzudong-{cluster_id}",
        "releaseName": f"tzudong-{cluster_id}",
        "clusterLabel": cluster_id,
        "fullname": kubernetes_name(f"{cluster_id}-{component_id}"),
    }


def _base_component(component: Mapping[str, Any]) -> dict:
    """The cluster-invariant part of a component (identical across renders)."""

    return {
        "componentId": component.get("componentId"),
        "image": component.get("imageRef"),
        "resourceRequest": component.get("resourceRequest"),
        "envVars": [dict(env) for env in component.get("envVars", [])],
        "secretRefs": list(component.get("secretRefs", [])),
    }


def _requests_remote(render_options: Mapping[str, Any] | None) -> bool:
    """True when the render request needs remote credentials or remote apply.

    Any of the following flips a render to remote and is not admitted:
    ``apply=True``, ``remote=True``, a non-empty ``remoteTarget``/``kubeContext``
    naming a remote context, or any supplied ``credentials``.
    """

    if not render_options:
        return False
    if render_options.get("apply") is True:
        return True
    if render_options.get("remote") is True:
        return True
    if render_options.get("credentials"):
        return True
    for key in ("remoteTarget", "kubeContext", "remoteCluster"):
        value = render_options.get(key)
        if isinstance(value, str) and value.strip():
            return True
    return False


def render_component(component: Mapping[str, Any], cluster_id: str) -> dict:
    """Render one component for ``cluster_id`` as ``{base, derived}``.

    ``base`` is cluster-invariant; ``derived`` holds only the four
    cluster-derived fields. Splitting the render this way makes Requirement
    14.5's "difference is derived fields only" checkable by comparison.
    """

    base = _base_component(component)
    return {
        "componentId": base["componentId"],
        "base": base,
        "derived": derived_fields(cluster_id, str(base["componentId"])),
    }


def render_descriptor(
    catalog: Mapping[str, Any],
    cluster_id: str,
    *,
    render_options: Mapping[str, Any] | None = None,
) -> dict:
    """Render the whole descriptor set for one ``cluster_id`` (local only).

    Returns ``{"ok", "errorCode", "clusterId", "artifacts", "artifactCount",
    "remoteApplyAttemptCount"}``. ``remoteApplyAttemptCount`` is always 0 -- the
    render never contacts a remote target (Requirement 14.6). When the request
    needs remote credentials or apply permission the render is refused with
    ``remote_apply_not_admitted`` and returns zero artifacts (Requirement 14.7).
    An invalid cluster identifier also yields zero artifacts.
    """

    if _requests_remote(render_options):
        return _result(
            False,
            REMOTE_APPLY_NOT_ADMITTED,
            clusterId=cluster_id,
            artifacts=[],
            artifactCount=0,
            remoteApplyAttemptCount=0,
        )

    if not isinstance(cluster_id, str) or not _CLUSTER_ID_RE.match(cluster_id):
        # Fail closed with no artifacts; not a remote condition, so surface the
        # remote-not-admitted refusal is inappropriate -- use ok=False with no
        # code beyond an empty artifact set. Callers gate on artifactCount.
        return _result(
            False,
            None,
            clusterId=cluster_id,
            artifacts=[],
            artifactCount=0,
            remoteApplyAttemptCount=0,
            reason="invalid_cluster_id",
        )

    components = catalog.get("components") if isinstance(catalog, Mapping) else None
    if not isinstance(components, list) or not components:
        return _result(
            False,
            None,
            clusterId=cluster_id,
            artifacts=[],
            artifactCount=0,
            remoteApplyAttemptCount=0,
            reason="no_components",
        )

    artifacts = [render_component(component, cluster_id) for component in components]
    return _result(
        True,
        None,
        clusterId=cluster_id,
        artifacts=artifacts,
        artifactCount=len(artifacts),
        remoteApplyAttemptCount=0,
    )


def render_difference_fields(render_a: Sequence[Mapping[str, Any]],
                             render_b: Sequence[Mapping[str, Any]]) -> set[str]:
    """Return the set of field names that differ between two cluster renders.

    Compares component-by-component (matched by ``componentId``). A field that
    differs contributes its name; equal fields contribute nothing. Per
    Requirement 14.5 this set must be a subset of :data:`DERIVED_FIELDS`.
    """

    by_id_a = {a.get("componentId"): a for a in render_a}
    by_id_b = {b.get("componentId"): b for b in render_b}
    differing: set[str] = set()

    all_ids = set(by_id_a) | set(by_id_b)
    for component_id in all_ids:
        a = by_id_a.get(component_id)
        b = by_id_b.get(component_id)
        if a is None or b is None:
            # A component present in only one render differs everywhere.
            differing.add("componentId")
            continue
        if a.get("base") != b.get("base"):
            differing.add("base")
        derived_a = a.get("derived", {})
        derived_b = b.get("derived", {})
        for field in set(derived_a) | set(derived_b):
            if derived_a.get(field) != derived_b.get(field):
                differing.add(field)
    return differing


def render_multi_cluster(
    catalog: Mapping[str, Any],
    cluster_ids: Sequence[str],
    *,
    render_options: Mapping[str, Any] | None = None,
) -> dict:
    """Render the descriptor for two or more clusters and check reuse.

    Returns ``{"ok", "errorCode", "clusterIds", "renders", "differingFields",
    "remoteApplyAttemptCount"}``. ``differingFields`` aggregates the fields that
    vary across the cluster renders; per Requirement 14.5 it must be a subset of
    :data:`DERIVED_FIELDS`. A remote request refuses the whole render with
    ``remote_apply_not_admitted`` and leaves no artifacts.
    """

    if _requests_remote(render_options):
        return _result(
            False,
            REMOTE_APPLY_NOT_ADMITTED,
            clusterIds=list(cluster_ids),
            renders={},
            differingFields=[],
            remoteApplyAttemptCount=0,
        )

    unique_ids = list(dict.fromkeys(cluster_ids))
    if len(unique_ids) < 2:
        return _result(
            False,
            None,
            clusterIds=unique_ids,
            renders={},
            differingFields=[],
            remoteApplyAttemptCount=0,
            reason="need_two_cluster_ids",
        )

    renders: dict[str, list] = {}
    for cluster_id in unique_ids:
        single = render_descriptor(catalog, cluster_id, render_options=render_options)
        if not single["ok"]:
            return _result(
                False,
                single["errorCode"],
                clusterIds=unique_ids,
                renders={},
                differingFields=[],
                remoteApplyAttemptCount=0,
                reason=single.get("reason"),
            )
        renders[cluster_id] = single["artifacts"]

    # Aggregate the differing fields across every pair against the first render.
    base_id = unique_ids[0]
    differing: set[str] = set()
    for other_id in unique_ids[1:]:
        differing |= render_difference_fields(renders[base_id], renders[other_id])

    only_derived = differing.issubset(set(DERIVED_FIELDS))
    return _result(
        only_derived,
        None if only_derived else "descriptor_render_nonderived_difference",
        clusterIds=unique_ids,
        renders=renders,
        differingFields=sorted(differing),
        remoteApplyAttemptCount=0,
    )


# ---------------------------------------------------------------------------
# Vercel project verification (Requirements 14.9, 14.10).
# ---------------------------------------------------------------------------
def verify_vercel_project(
    project_identifier: Any,
    linked_repository: Any = None,
    *,
    action: str = "unspecified",
) -> dict:
    """Verify the Git-integrated ``tzudong`` Vercel project before any action.

    Returns ``{"ok", "errorCode", "action", "readback"}``. Verification succeeds
    only when ``project_identifier`` is exactly ``tzudong`` and a non-empty
    linked-repository reference is present; the confirmed identifier is read back
    in ``readback`` (Requirement 14.9). An unverified identifier or a ``web``
    project directive returns ``vercel_project_not_verified`` with no readback
    (Requirement 14.10). This function never contacts Vercel; it only gates.
    """

    identifier = project_identifier.strip() if isinstance(project_identifier, str) else ""
    has_repo = isinstance(linked_repository, str) and bool(linked_repository.strip())

    if identifier == REJECTED_VERCEL_PROJECT:
        return _result(False, VERCEL_PROJECT_NOT_VERIFIED, action=action, readback=None)
    if identifier != ADMITTED_VERCEL_PROJECT or not has_repo:
        return _result(False, VERCEL_PROJECT_NOT_VERIFIED, action=action, readback=None)

    return _result(
        True,
        None,
        action=action,
        readback={
            "projectIdentifier": identifier,
            "linkedRepository": linked_repository.strip(),
            "gitIntegrated": True,
        },
    )


# ---------------------------------------------------------------------------
# DNS scope guard (Requirement 14.11).
# ---------------------------------------------------------------------------
def request_dns_change(record: Any = None) -> dict:
    """Refuse any DNS record change as out of scope (Requirement 14.11).

    Returns ``{"ok": False, "errorCode": "dns_change_out_of_scope",
    "performed": False}`` unconditionally. DNS record changes are outside this
    spec's automation and are never performed.
    """

    return _result(False, DNS_CHANGE_OUT_OF_SCOPE, performed=False)


# ---------------------------------------------------------------------------
# Catalog loading helper.
# ---------------------------------------------------------------------------
def load_catalog(path: str | Path) -> dict:
    """Load and JSON-parse the Deployment_Descriptor_Set catalog at ``path``."""

    return json.loads(Path(path).read_text(encoding="utf-8"))
