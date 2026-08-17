"""Immutable source-contract checks for the local-only G035 rehearsal."""
from __future__ import annotations
import hashlib, json, re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

MANIFEST_RELATIVE_PATH = ".github/g034-hosted-migration-closure.v1.json"
MANIFEST_SHA256 = "bba79f264f26158d2fd93f62a0632f44ff8a0575619b50928e23ecefccf8ab95"
SELF_COMMIT_VERSIONS = ("20260712000400", "20260713002400")
FORBIDDEN_VERSIONS = frozenset({"20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002500", "20260713002600", "20260713002700"})
APPLICATION_SCHEMAS = ("public", "shortener_private", "account_deletion_private", "privacy_retention", "ocr_private", "provider_budget_private", "pipeline_control")
MANAGED_METADATA_SCHEMAS = ("auth", "storage")
REMEDIATION_AUTHORIZATION_SCHEMA = "g035-short-url-remediation-authorization-v1"
REMEDIATION_PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAlwdyr+FhaV/2M2G6DV0cDcvNY96fGC6dwwjKRw8WVqY=\n-----END PUBLIC KEY-----\n"
REMEDIATION_PUBLIC_KEY_SHA256 = "e338e9dbfd309838b16980d62fe72a71c526e329506285f4c5811d725d941213"
APPROVED_AGE_RECIPIENT_SHA256 = "c529b89f584d1d02f2543887e31cf85515b74cbd5a93cffd58efd93e6245ed7f"
# Immutable identities from the authoritative 12-row G034 hosted readback; this
# records observed ledger state, not proof of any historical application event.
BASELINE_PAIRS = (
    ("20251219", "db_performance_optimization"),
    ("20260118", "create_ocr_logs"),
    ("20260425", "allow_ocr_logs_user_insert"),
    ("20260506065538", "optimize_auth_user_state_indexes"),
    ("20260506085634", "optimize_app_query_indexes"),
    ("20260509000100", "drop_server_costs"),
    ("20260509000200", "drop_admin_ai_settings"),
    ("20260523093000", "create_restaurant_popular_rank_snapshots"),
    ("20260525143908", "create_youtube_kpi_snapshots"),
    ("20260526083932", "add_youtube_channel_growth_snapshot_deltas"),
    ("20260531084217", "harden_public_api_grants_and_rpcs"),
    ("20260531084516", "tighten_public_table_data_api_grants"),
)
BASELINE_SHA256 = hashlib.sha256(json.dumps(BASELINE_PAIRS, separators=(",", ":")).encode()).hexdigest()
_VERSION = re.compile(r"^[0-9]{1,14}$"); _SHA256 = re.compile(r"^[0-9a-f]{64}$")
class ContractError(ValueError): pass

def _no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result: raise ContractError("duplicate JSON object key")
        result[key] = value
    return result
@dataclass(frozen=True)
class Migration: version: str; name: str; path: str; sha256: str
@dataclass(frozen=True)
class Manifest: migrations: tuple[Migration, ...]; excluded_versions: frozenset[str]; ledger_terminal_version: str; closure_terminal_version: str

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""): digest.update(block)
    return digest.hexdigest()
def repository_root(start: Path) -> Path:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate / MANIFEST_RELATIVE_PATH).is_file(): return candidate
    raise ContractError("recovery repository root not found")
def load_manifest(root: Path) -> Manifest:
    path = root / MANIFEST_RELATIVE_PATH
    if path.is_symlink() or not path.is_file(): raise ContractError("manifest must be a regular file")
    try:
        raw_bytes = path.read_bytes()
        canonical_bytes = raw_bytes.replace(b"\r\n", b"\n")
        if b"\r" in canonical_bytes or hashlib.sha256(canonical_bytes).hexdigest() != MANIFEST_SHA256: raise ContractError("manifest hash mismatch")
        data = json.loads(canonical_bytes, object_pairs_hook=_no_duplicate_object)
    except (OSError, json.JSONDecodeError) as exc: raise ContractError("manifest is unreadable") from exc
    raw, excluded = data.get("migrations"), data.get("excludedVersions")
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(raw, list) or len(raw) != 29 or not isinstance(excluded, list): raise ContractError("manifest inventory mismatch")
    entries=[]; seen=set(); prior=""
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"version","name","path","sha256"}: raise ContractError("manifest migration fields mismatch")
        entry=Migration(**item); expected=f"backend/supabase/migrations/{entry.version}_{entry.name}.sql"
        if not (_VERSION.fullmatch(entry.version) and entry.name and _SHA256.fullmatch(entry.sha256) and entry.path == expected and "\\" not in entry.path and "/../" not in entry.path and entry.version not in seen and entry.version > prior and entry.version not in FORBIDDEN_VERSIONS): raise ContractError("invalid migration identity")
        entries.append(entry); seen.add(entry.version); prior=entry.version
    excluded_set=frozenset(excluded)
    if excluded_set != FORBIDDEN_VERSIONS or len(excluded)!=len(excluded_set) or any(v in seen for v in excluded_set): raise ContractError("excluded version set mismatch")
    if data.get("ledgerTerminalVersion") != "20260531084516" or data.get("closureTerminalVersion") != "20260801000300": raise ContractError("manifest terminal mismatch")
    return Manifest(tuple(entries), excluded_set, data["ledgerTerminalVersion"], data["closureTerminalVersion"])
def validate_sources(root: Path) -> Manifest:
    manifest=load_manifest(root); migration_dir=(root / "backend/supabase/migrations").resolve()
    for entry in manifest.migrations:
        path=root / entry.path
        if path.is_symlink() or not path.is_file() or path.resolve().parent != migration_dir or sha256_file(path)!=entry.sha256: raise ContractError("migration source hash mismatch")
    return manifest
def ledger_prefix(manifest: Manifest, applied: list[tuple[str,str]]) -> bool:
    if not isinstance(applied, (list, tuple)) or any(
        not isinstance(pair, (list, tuple))
        or len(pair) != 2
        or not all(isinstance(value, str) and value for value in pair)
        for pair in applied
    ):
        return False
    actual = tuple((pair[0], pair[1]) for pair in applied)
    expected = BASELINE_PAIRS + tuple((migration.version, migration.name) for migration in manifest.migrations)
    return actual == expected[:len(actual)] and len(actual) >= len(BASELINE_PAIRS)
SHORT_URL_SELECTION_SPEC = "row_number() over (partition by target_url order by created_at nulls last, id)"
SHORT_URLS_CATALOG = (
    {"name":"id","type":"uuid","nullable":"NO","position":1,"character_maximum_length":None,"column_default":"uuid_generate_v4()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
    {"name":"code","type":"character varying","nullable":"NO","position":2,"character_maximum_length":10,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
    {"name":"target_url","type":"text","nullable":"NO","position":3,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
    {"name":"restaurant_id","type":"uuid","nullable":"YES","position":4,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
    {"name":"restaurant_name","type":"text","nullable":"YES","position":5,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
    {"name":"created_at","type":"timestamp with time zone","nullable":"YES","position":6,"character_maximum_length":None,"column_default":"now()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
)
_HEX = re.compile(r"^[a-f0-9]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40,64}$")
_AUTHORIZATION_FIELDS = frozenset(("schema","inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","repository_commit","selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256","batch_id"))
_AUTHORIZATION_DIGEST_FIELDS = ("inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256")
class _FrozenDict(dict):
    def _immutable(self, *args: Any, **kwargs: Any) -> None:
        raise TypeError("verified authorization is immutable")
    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = _immutable

def canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    except (TypeError, ValueError) as exc:
        raise ContractError("JSON value is not canonicalizable") from exc

def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()

def _reject_constant(_: str) -> None:
    raise ContractError("authorization JSON contains invalid constant")

def _canonical_uuid(value: Any) -> str:
    import uuid
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ContractError("authorization batch invalid") from exc
    if not isinstance(value, str) or str(parsed) != value:
        raise ContractError("authorization batch invalid")
    return value

def verify_short_url_remediation_authorization(authorization_path: Path, signature_path: Path, *, require_custody: Callable[[Path, str], None], verify_detached: Callable[[bytes, Path, str], None], expected_bindings: Mapping[str, Any], inspection_evidence: Mapping[str, Any]) -> Mapping[str, Any]:
    """Validate exact signed authorization bytes without exposing signature material."""
    authorization_path, signature_path = Path(authorization_path), Path(signature_path)
    require_custody(authorization_path, "authorization file")
    require_custody(signature_path, "authorization signature")
    try:
        raw = authorization_path.read_bytes()
        authorization = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_object, parse_constant=_reject_constant)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ContractError) as exc:
        raise ContractError("authorization JSON invalid") from exc
    if not isinstance(authorization, dict) or raw != canonical_json_bytes(authorization):
        raise ContractError("authorization JSON noncanonical")
    if set(authorization) != _AUTHORIZATION_FIELDS or authorization.get("schema") != REMEDIATION_AUTHORIZATION_SCHEMA:
        raise ContractError("authorization schema invalid")
    if any(not isinstance(authorization.get(key), str) or not _HEX.fullmatch(authorization[key]) for key in _AUTHORIZATION_DIGEST_FIELDS):
        raise ContractError("authorization digest invalid")
    if not isinstance(authorization.get("repository_commit"), str) or not _COMMIT.fullmatch(authorization["repository_commit"]):
        raise ContractError("authorization repository invalid")
    for key in ("duplicate_group_count", "duplicate_victim_count"):
        if not isinstance(authorization.get(key), int) or isinstance(authorization[key], bool) or authorization[key] < 0:
            raise ContractError("authorization count invalid")
    _canonical_uuid(authorization.get("batch_id"))
    if any(authorization.get(key) != value for key, value in expected_bindings.items()):
        raise ContractError("authorization binding invalid")
    evidence_fields = ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256")
    if any(authorization[key] != inspection_evidence.get(key) for key in evidence_fields):
        raise ContractError("authorization inspection invalid")
    if hashlib.sha256(REMEDIATION_PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != REMEDIATION_PUBLIC_KEY_SHA256:
        raise ContractError("pinned key mismatch")
    verify_detached(raw, signature_path, REMEDIATION_PUBLIC_KEY_PEM)
    return _FrozenDict(authorization)
def is_verified_short_url_remediation_authorization(value: Any) -> bool:
    """Return whether value is the immutable result of authorization verification."""
    return isinstance(value, _FrozenDict) and value.get("schema") == REMEDIATION_AUTHORIZATION_SCHEMA
