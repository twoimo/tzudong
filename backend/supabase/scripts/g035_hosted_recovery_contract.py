"""Immutable source-contract checks for the local-only G035 rehearsal."""
from __future__ import annotations
import hashlib, json, re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MANIFEST_RELATIVE_PATH = ".github/g034-hosted-migration-closure.v1.json"
MANIFEST_SHA256 = "f80e82633c46f5ba7128fe4f30ed084dadfd826f436b0d35e1c6d62f841175f2"
SELF_COMMIT_VERSIONS = ("20260712000400", "20260713002400")
FORBIDDEN_VERSIONS = frozenset({"20260531105250", "20260612075100", "20260627150000", "20260702000200", "20260707000700", "20260713000400", "20260713002200", "20260713002500", "20260713002600", "20260713002700"})
APPLICATION_SCHEMAS = ("public", "shortener_private", "account_deletion_private", "privacy_retention")
MANAGED_METADATA_SCHEMAS = ("auth", "storage")
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
    if sha256_file(path) != MANIFEST_SHA256: raise ContractError("manifest hash mismatch")
    try: data = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicate_object)
    except (OSError, json.JSONDecodeError) as exc: raise ContractError("manifest is unreadable") from exc
    raw, excluded = data.get("migrations"), data.get("excludedVersions")
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(raw, list) or len(raw) != 27 or not isinstance(excluded, list): raise ContractError("manifest inventory mismatch")
    entries=[]; seen=set(); prior=""
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"version","name","path","sha256"}: raise ContractError("manifest migration fields mismatch")
        entry=Migration(**item); expected=f"backend/supabase/migrations/{entry.version}_{entry.name}.sql"
        if not (_VERSION.fullmatch(entry.version) and entry.name and _SHA256.fullmatch(entry.sha256) and entry.path == expected and "\\" not in entry.path and "/../" not in entry.path and entry.version not in seen and entry.version > prior and entry.version not in FORBIDDEN_VERSIONS): raise ContractError("invalid migration identity")
        entries.append(entry); seen.add(entry.version); prior=entry.version
    excluded_set=frozenset(excluded)
    if excluded_set != FORBIDDEN_VERSIONS or len(excluded)!=len(excluded_set) or any(v in seen for v in excluded_set): raise ContractError("excluded version set mismatch")
    if data.get("ledgerTerminalVersion") != "20260531084516" or data.get("closureTerminalVersion") != SELF_COMMIT_VERSIONS[-1]: raise ContractError("manifest terminal mismatch")
    return Manifest(tuple(entries), excluded_set, data["ledgerTerminalVersion"], data["closureTerminalVersion"])
def validate_sources(root: Path) -> Manifest:
    manifest=load_manifest(root); migration_dir=(root / "backend/supabase/migrations").resolve()
    for entry in manifest.migrations:
        path=root / entry.path
        if path.is_symlink() or not path.is_file() or path.resolve().parent != migration_dir or sha256_file(path)!=entry.sha256: raise ContractError("migration source hash mismatch")
    return manifest
def ledger_prefix(manifest: Manifest, applied: list[tuple[str,str]]) -> bool:
    expected=list(BASELINE_PAIRS)+[(m.version,m.name) for m in manifest.migrations]
    return applied == expected[:len(applied)] and len(applied) >= len(BASELINE_PAIRS)
