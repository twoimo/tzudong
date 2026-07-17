"""Immutable, fail-closed contract for the G037 hosted closure executor."""
from __future__ import annotations
import base64, hashlib, json, re, time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MANIFEST_RELATIVE_PATH = ".github/g034-hosted-migration-closure.v1.json"
MANIFEST_SHA256 = "1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1"
MODES = frozenset(("validate", "preflight", "readback", "runtime-probe", "reconciliation-readback"))
SELF_WRAPPING = ("20260712000400", "20260713002400")
FORBIDDEN_VERSIONS = frozenset(("20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002500", "20260713002600", "20260713002700"))
# A public key is intentionally embedded; no private material is accepted by this contract.
AUTHORIZATION_SCHEMA = "g037-hosted-closure-authorization-v1"
AUTHORIZATION_PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA8C/0GMsjOhEbog3Ihw/9RpeXifiyhfK+JVq4zNFgtyw=\n-----END PUBLIC KEY-----\n"
AUTHORIZATION_PUBLIC_KEY_SHA256 = hashlib.sha256(AUTHORIZATION_PUBLIC_KEY_PEM.encode()).hexdigest()
BASELINE_PAIRS = (
    ("20251219","db_performance_optimization"),("20260118","create_ocr_logs"),
    ("20260425","allow_ocr_logs_user_insert"),("20260506065538","optimize_auth_user_state_indexes"),
    ("20260506085634","optimize_app_query_indexes"),("20260509000100","drop_server_costs"),
    ("20260509000200","drop_admin_ai_settings"),("20260523093000","create_restaurant_popular_rank_snapshots"),
    ("20260525143908","create_youtube_kpi_snapshots"),("20260526083932","add_youtube_channel_growth_snapshot_deltas"),
    ("20260531084217","harden_public_api_grants_and_rpcs"),("20260531084516","tighten_public_table_data_api_grants"),
)
_VERSION = re.compile(r"^[0-9]{14}$"); _SHA = re.compile(r"^[a-f0-9]{64}$")
class ContractError(ValueError): pass

def no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result: raise ContractError("duplicate JSON object key")
        result[key] = value
    return result

def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
def digest(value: Any) -> str: return hashlib.sha256(canonical_bytes(value)).hexdigest()
def sha256_file(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024), b""): h.update(block)
    return h.hexdigest()
@dataclass(frozen=True)
class Migration: version:str; name:str; path:str; sha256:str
@dataclass(frozen=True)
class Manifest: migrations:tuple[Migration,...]; excluded_versions:frozenset[str]; ledger_terminal_version:str; closure_terminal_version:str

def repository_root(start: Path) -> Path:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate/MANIFEST_RELATIVE_PATH).is_file(): return candidate
    raise ContractError("repository root not found")
def load_manifest(root: Path) -> Manifest:
    path=root/MANIFEST_RELATIVE_PATH
    if path.is_symlink() or not path.is_file(): raise ContractError("manifest must be regular")
    try:
        raw=path.read_bytes().replace(b"\r\n",b"\n")
        if b"\r" in raw or hashlib.sha256(raw).hexdigest()!=MANIFEST_SHA256: raise ContractError("manifest hash mismatch")
        data=json.loads(raw, object_pairs_hook=no_duplicate_object)
    except (OSError,json.JSONDecodeError) as exc: raise ContractError("manifest unreadable") from exc
    rows=data.get("migrations"); excluded=data.get("excludedVersions")
    if not isinstance(data,dict) or data.get("schemaVersion")!=1 or not isinstance(rows,list) or len(rows)!=28 or not isinstance(excluded,list): raise ContractError("manifest inventory mismatch")
    entries=[]; seen=set(); previous=""
    for row in rows:
        if not isinstance(row,dict) or set(row)!={"version","name","path","sha256"}: raise ContractError("manifest fields mismatch")
        item=Migration(**row); expected=f"backend/supabase/migrations/{item.version}_{item.name}.sql"
        if not (_VERSION.fullmatch(item.version) and isinstance(item.name,str) and item.name and _SHA.fullmatch(item.sha256) and item.path==expected and item.version not in seen and item.version>previous and item.version not in FORBIDDEN_VERSIONS): raise ContractError("migration identity mismatch")
        entries.append(item); seen.add(item.version); previous=item.version
    forbidden=frozenset(excluded)
    if forbidden!=FORBIDDEN_VERSIONS or len(excluded)!=len(forbidden) or forbidden & seen: raise ContractError("excluded set mismatch")
    if data.get("ledgerTerminalVersion")!="20260531084516" or data.get("closureTerminalVersion")!="20260713002400": raise ContractError("terminal mismatch")
    return Manifest(tuple(entries),forbidden,data["ledgerTerminalVersion"],data["closureTerminalVersion"])
def validate_sources(root: Path) -> Manifest:
    manifest=load_manifest(root); directory=(root/"backend/supabase/migrations").resolve()
    for item in manifest.migrations:
        path=root/item.path
        if path.is_symlink() or not path.is_file() or path.resolve().parent!=directory or sha256_file(path)!=item.sha256: raise ContractError("migration source hash mismatch")
    return manifest
def expected_ledger(manifest: Manifest) -> tuple[tuple[str,str],...]:
    return tuple((item.version,item.name) for item in manifest.migrations)
def validate_ledger(manifest: Manifest, observed: Any) -> None:
    if not isinstance(observed,(list,tuple)) or tuple(tuple(x) for x in observed)!=expected_ledger(manifest): raise ContractError("ledger mismatch")
_FREEZE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{7,127}$")
_COMMIT = re.compile(r"^[a-f0-9]{40}$")
_FREEZE_ASSERTION_SCHEMA = "g037-write-freeze-assertion-v1"
_FREEZE_REQUIRED = frozenset((
    "schema", "freeze_id", "origin", "commit", "manifest_sha256",
    "relation_root", "acl_root", "source_root", "terminal_spec", "issued_at", "expires_at", "attestations",
    "signature",
))
def validate_operator_assertion(
    value: Any, *, freeze_id: str, origin: str, relation_root: str, acl_root: str,
    commit: str | None = None, source_root: str | None = None, terminal_spec: str | None = None, now: int | None = None,
) -> None:
    """Verify the source-pinned finite operator attestation for residual channels."""
    if not isinstance(value,dict) or set(value)!=_FREEZE_REQUIRED:
        raise ContractError("freeze assertion fields mismatch")
    if (not _FREEZE_ID.fullmatch(freeze_id) or value["schema"]!=_FREEZE_ASSERTION_SCHEMA
        or value["freeze_id"]!=freeze_id or value["origin"]!=origin
        or not _COMMIT.fullmatch(value["commit"]) or value["manifest_sha256"]!=MANIFEST_SHA256
        or value["relation_root"]!=relation_root or value["acl_root"]!=acl_root
        or (commit is not None and value["commit"]!=commit)
        or (source_root is not None and value.get("source_root")!=source_root)
        or (terminal_spec is not None and value.get("terminal_spec")!=terminal_spec)):
        raise ContractError("freeze assertion binding mismatch")
    issued, expires=value["issued_at"],value["expires_at"]; point=int(time.time()) if now is None else now
    if (not isinstance(issued,int) or isinstance(issued,bool) or not isinstance(expires,int)
        or isinstance(expires,bool) or issued>point+30 or issued<point-900
        or expires<=point or expires<=issued or expires-issued>1800):
        raise ContractError("freeze assertion stale")
    attest=value["attestations"]
    required={"no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write","producer_stop"}
    if not isinstance(attest,dict) or set(attest)!=required:
        raise ContractError("residual attestation absent")
    for channel in required:
        evidence=attest[channel]
        if (not isinstance(evidence,dict) or set(evidence)!={"status","evidence_sha256","observed_at"}
            or evidence["status"] is not True or not isinstance(evidence["observed_at"],int)
            or isinstance(evidence["observed_at"],bool) or not _SHA.fullmatch(evidence["evidence_sha256"])
            or evidence["observed_at"]>point+30 or evidence["observed_at"]<point-900
            or evidence["observed_at"]<issued or evidence["observed_at"]>expires):
            raise ContractError("residual attestation invalid")
    signature=value["signature"]
    if not isinstance(signature,str): raise ContractError("freeze assertion signature absent")
    payload={k:v for k,v in value.items() if k!="signature"}
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(AUTHORIZATION_PUBLIC_KEY_PEM.encode()).verify(
            base64.b64decode(signature,validate=True), canonical_bytes(payload)
        )
    except Exception as exc:
        raise ContractError("freeze assertion signature invalid") from exc
