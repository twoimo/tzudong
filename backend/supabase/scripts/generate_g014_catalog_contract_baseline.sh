#!/usr/bin/env bash
# Generates review evidence from this checkout only. It never contacts a hosted service.
set -euo pipefail
IFS=$'\n\t'
umask 077

usage() {
  printf 'usage: %s --output-dir PATH\n' "${0##*/}" >&2
  exit 64
}

output_dir=''
while (($#)); do
  case "$1" in
    --output-dir) (($# >= 2)) || usage; output_dir=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$output_dir" ]] || usage

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
supabase_dir=$(cd -- "$script_dir/.." && pwd -P)
repo_root=$(cd -- "$supabase_dir/../.." && pwd -P)
backend_migrations_dir="$supabase_dir/migrations"
app_migrations_dir="$repo_root/apps/web/supabase/migrations"
baselines_dir="$supabase_dir/baselines"
reconstruction_sources_dir="$baselines_dir/historical/pre-20260214-application"
reconstruction_archive="$reconstruction_sources_dir/RECONSTRUCTION_SOURCES.v1.zip"
reconstruction_manifest="$reconstruction_sources_dir/RECONSTRUCTION_SOURCES.v1.json"
reconstruction_validator="$script_dir/verify_reconstruction_source_archive.py"
reconstruction_purpose='source-only reconstruction candidate; not historical application proof or hosted-state evidence'
g026_bundle="$reconstruction_sources_dir/G026_RECONSTRUCTION_BUNDLE.v4.json"
g026_transition="$reconstruction_sources_dir/G026_RECONSTRUCTION_TRANSITION.v4.sql"
g026_repairs="$reconstruction_sources_dir/G026_RECONSTRUCTION_REPAIRS.v4.sql"
g026_validator="$script_dir/verify_g026_reconstruction_bundle.py"
g028_reauth_test="$supabase_dir/tests/g028_account_deletion_reauth_proof.sql"
partition_version='g014-source-baseline-partition-v1'
relevant_sources=(
  'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh'
  'backend/supabase/scripts/transform_g014_guardian_replay.py'
  'backend/supabase/scripts/recover_advisor_replay_prerequisites.py'
  'backend/supabase/volumes/db'
  'backend/supabase/baselines'
  'backend/supabase/migrations'
  'apps/web/supabase/migrations'
  'backend/supabase/tests/g028_account_deletion_reauth_proof.sql'
  'backend/supabase/docker-compose.yml'
)
[[ -z $(git -C "$repo_root" status --porcelain=v1 --untracked-files=all -- "${relevant_sources[@]}") ]] || {
  printf 'relevant source inputs must be clean\n' >&2
  exit 1
}
[[ -d "$backend_migrations_dir" && -d "$app_migrations_dir" && ! -e "$output_dir" ]] || {
  printf 'missing application migrations directory or output already exists\n' >&2
  exit 1
}

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/g014-catalog-contract.XXXXXX")
project="g014catalog${RANDOM}${RANDOM}"
docker_config="$work_dir/docker-config"
env_file="$work_dir/compose.env"
compose_file="$work_dir/compose.yml"
staging_dir="$work_dir/evidence"
mkdir -m 700 "$docker_config" "$staging_dir"
g026_validation_ledger="$staging_dir/g026-validation-ledger.json"
g026_bundle_evidence="$staging_dir/G026_RECONSTRUCTION_BUNDLE.v4.json"
g026_transition_evidence="$staging_dir/G026_RECONSTRUCTION_TRANSITION.v4.sql"
g026_repairs_evidence="$staging_dir/G026_RECONSTRUCTION_REPAIRS.v4.sql"
g026_semantic_receipt="$staging_dir/g026-semantic-receipt.json"
g026_readback_receipt="$staging_dir/g026-readback-receipt.json"
g026_behavior_receipt="$staging_dir/g026-behavior-receipt.json"
docker_endpoint=''

compose() {
  env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$docker_config" \
    DOCKER_HOST="$docker_endpoint" \
    docker compose --project-name "$project" --env-file "$env_file" -f "$compose_file" "$@"
}

docker_local() {
  env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$docker_config" \
    DOCKER_HOST="$docker_endpoint" docker "$@"
}

compose_host_path() {
  case "$(uname -s)" in
    MSYS*|MINGW*|CYGWIN*) cygpath -m "$1" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

cleanup() {
  local status=$?
  [[ -z "$docker_endpoint" ]] || compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

db_image='supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b'
db_index_digest='sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b'
db_amd64_manifest_digest='sha256:caae3d066f437332d593011e3e7ecf78ab005ce9b89378efd53f97f0410563ad'
bootstrap_manifest="$supabase_dir/volumes/db/BOOTSTRAP_SOURCES.v1.json"
expected_upstream_commit='205cbe7d26d330dc8972b30d0dc855f0086baad2'
platform_auth_bootstrap="$supabase_dir/baselines/postgres-v15.8.1.085/00000000000001-auth-schema.sql"
platform_auth_inventory_sha256=''
platform_auth_source_sha256=''
platform_auth_image_evidence=''
platform_auth_image_sha256=''
platform_auth_expected_ledger_evidence=''
auth_expected_ledger_evidence=''
auth_ledger_evidence=''
storage_inventory="$supabase_dir/baselines/storage-v1.33.0/STORAGE_TENANT_MIGRATIONS.v1.json"
gotrue_manifest="$supabase_dir/baselines/gotrue-v2.184.0/GOTRUE_PLATFORM.v1.json"
gotrue_inventory="$supabase_dir/baselines/gotrue-v2.184.0/GOTRUE_MIGRATIONS.v1.json"
storage_image='supabase/storage-api@sha256:3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177'
gotrue_image='supabase/gotrue@sha256:c485010238ab429edf4ac8eb70b37b41aae0a0905277a935d4a0b64bb848e393'
storage_index_digest='sha256:3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177'
gotrue_index_digest='sha256:c485010238ab429edf4ac8eb70b37b41aae0a0905277a935d4a0b64bb848e393'
storage_amd64_manifest_digest='sha256:4d9064756e9fb18784c8f7158873bf53fed5058463a3a62a4da3907d73eebe89'
gotrue_amd64_manifest_digest='sha256:b9c5b998bd6a79f77a391db7d6607f23af2ca4cb9df00505ccb9350aebbdbfae'
storage_inventory_sha256=''
gotrue_manifest_sha256=''
gotrue_inventory_sha256=''
storage_resolved_image_id=''
gotrue_resolved_image_id=''
storage_resolved_repo_digests=''
gotrue_resolved_repo_digests=''
storage_ledger_evidence=''
gotrue_ledger_evidence=''
gotrue_expected_ledger_evidence=''
storage_file_evidence=''
gotrue_file_evidence=''
gotrue_inventory_file_evidence=''
[[ -r "$platform_auth_bootstrap" ]] || { printf 'unreadable Postgres platform auth bootstrap source\n' >&2; exit 1; }
[[ -r "$storage_inventory" ]] || { printf 'unreadable Storage migration inventory\n' >&2; exit 1; }
jq -e --arg image 'docker.io/supabase/storage-api:v1.33.0' --arg index "$storage_index_digest" --arg amd64 "$storage_amd64_manifest_digest" '
  (keys | sort) == ["count", "dbInstallRoles", "kind", "ociAmd64ManifestDigest", "ociImage", "ociIndexDigest", "purpose", "records", "repository", "schemaVersion", "sourceCommit", "sourcePath", "sourceRef"] and
  .schemaVersion == 1 and
  .kind == "supabase-storage-tenant-migration-source-inventory" and
  .purpose == "Generator-only source-reconstruction inventory for validating native container tenant migration contents against immutable upstream metadata; it contains no SQL content and is not database input." and
  .repository == "https://github.com/supabase/storage" and
  .sourceCommit == "cce047b6dca69c987a16976af739175365b1edd5" and
  .sourceRef == "v1.33.0" and .sourcePath == "migrations/tenant" and
  .ociImage == $image and .ociIndexDigest == $index and .ociAmd64ManifestDigest == $amd64 and
  .dbInstallRoles == false and
  .count == 49 and
  (.records | type == "array" and length == 49 and
    all(.[]; (keys | sort) == ["byteLength", "filename", "gitBlobSha1", "sha256"] and
      (.filename | type == "string" and test("^[0-9]+-[a-z0-9][a-z0-9._-]*\\.sql$")) and
      (.gitBlobSha1 | type == "string" and test("^[0-9a-f]{40}$")) and
      (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
      (.byteLength | type == "number" and floor == . and . > 0)) and
    ([.[] | (.filename | capture("^(?<id>[0-9]+)-").id | tonumber)] as $ids |
      $ids == ($ids | sort) and ($ids | unique | length == 49)) and
    (map(select(.filename == "0008-add-public-to-buckets.sql" and .gitBlobSha1 == "13b1f49f4ae8f5f35ef0ddd6576dd2557844bb33" and .sha256 == "1d881092aea62e83493f1a9c4cb4f101f3035a08d62be84a7e7970ee0c6f0f48" and .byteLength == 84)) | length == 1) and
    (map(select(.filename == "0013-add-bucket-custom-limits.sql" and .gitBlobSha1 == "9ade83678f8d5f31dfbccfa07a8866997c1c1bb1" and .sha256 == "07d0b1e8299b70eeeda0841969772aecdbd0788eda9dbada7806afdc8ed9d06e" and .byteLength == 180)) | length == 1) and
    (map(select(.filename == "0014-use-bytes-for-max-size.sql" and .gitBlobSha1 == "a975d964cba5c1487e7bfd823549def6a7e3d02c" and .sha256 == "9e34ab4fc380e1cdd4748bcac368cd628c247962bdd58f8311a44f1b29e918ec" and .byteLength == 567)) | length == 1)
  )
' "$storage_inventory" >/dev/null || { printf 'invalid Storage migration inventory\n' >&2; exit 1; }
storage_inventory_sha256=$(sha256sum -- "$storage_inventory" | cut -d' ' -f1)
git -C "$repo_root" diff --quiet -- "$storage_inventory" && git -C "$repo_root" diff --cached --quiet -- "$storage_inventory" || {
  printf 'Storage migration inventory must be a clean source input\n' >&2; exit 1;
}
[[ -r "$gotrue_manifest" ]] || { printf 'unreadable GoTrue platform source manifest\n' >&2; exit 1; }
jq -e --arg image 'docker.io/supabase/gotrue:v2.184.0' --arg index "$gotrue_index_digest" --arg amd64 "$gotrue_amd64_manifest_digest" '
  (keys | sort) == ["composeSource", "kind", "nativeCommand", "ociAmd64ManifestDigest", "ociImage", "ociIndexDigest", "purpose", "repository", "requiredRelations", "schemaVersion", "sourceCommit", "sourceRef"] and
  .schemaVersion == 1 and
  .kind == "supabase-gotrue-platform-source" and
  .purpose == "Generator-only native GoTrue platform initialization for source-only catalog reconstruction; it is not production evidence or database input." and
  .repository == "https://github.com/supabase/auth" and
  .sourceCommit == "6a8fc26f6042ba92cda51bc62b70f1b61c2cd12e" and
  .sourceRef == "v2.184.0" and
  .composeSource == {"path":"backend/supabase/docker-compose.yml","image":"supabase/gotrue:v2.184.0"} and
  .ociImage == $image and .ociIndexDigest == $index and .ociAmd64ManifestDigest == $amd64 and
  .nativeCommand == ["gotrue", "migrate"] and
  .requiredRelations == ["auth.users", "auth.identities", "auth.sessions", "auth.refresh_tokens", "auth.schema_migrations"]
' "$gotrue_manifest" >/dev/null || { printf 'invalid GoTrue platform source manifest\n' >&2; exit 1; }
python3 - "$supabase_dir/docker-compose.yml" <<'PY'
import re
import sys

lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
services_start = next(
    (index for index, line in enumerate(lines) if re.fullmatch(r"services:\s*(?:#.*)?", line)),
    None,
)
if services_start is None:
    raise SystemExit("GoTrue compose source has no top-level services mapping")

service_headers = []
for index in range(services_start + 1, len(lines)):
    line = lines[index]
    if line and not line[0].isspace() and not line.lstrip().startswith("#"):
        break
    match = re.fullmatch(r"  ([A-Za-z0-9][A-Za-z0-9_.-]*):\s*(?:#.*)?", line)
    if match:
        service_headers.append((index, match.group(1)))

auth_headers = [index for index, name in service_headers if name == "auth"]
if len(auth_headers) != 1:
    raise SystemExit("GoTrue compose source must contain exactly one auth service")

auth_start = auth_headers[0]
auth_end = next(
    (index for index, name in service_headers if index > auth_start),
    len(lines),
)
image_values = []
for line in lines[auth_start + 1:auth_end]:
    match = re.fullmatch(
        r"""    image:\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))\s*(?:#.*)?""",
        line,
    )
    if match:
        image_values.append(next(value for value in match.groups() if value is not None))

if image_values != ["supabase/gotrue:v2.184.0"]:
    raise SystemExit("original compose auth service does not use the exact pinned GoTrue image")
PY
gotrue_manifest_sha256=$(sha256sum -- "$gotrue_manifest" | cut -d' ' -f1)
git -C "$repo_root" diff --quiet -- "$gotrue_manifest" "$supabase_dir/docker-compose.yml" &&
  git -C "$repo_root" diff --cached --quiet -- "$gotrue_manifest" "$supabase_dir/docker-compose.yml" || {
  printf 'GoTrue platform source inputs must be clean\n' >&2; exit 1;
}
[[ -r "$gotrue_inventory" ]] || { printf 'unreadable GoTrue migration inventory\n' >&2; exit 1; }
jq -e --arg image 'docker.io/supabase/gotrue:v2.184.0' --arg index "$gotrue_index_digest" --arg amd64 "$gotrue_amd64_manifest_digest" '
  (keys | sort) == ["kind", "ociAmd64ManifestDigest", "ociImage", "ociIndexDigest", "purpose", "records", "repository", "schemaVersion", "sourceCommit", "sourcePath", "sourceRef", "sourceTree"] and
  .schemaVersion == 1 and
  .kind == "supabase-gotrue-migration-source-inventory" and
  .purpose == "Generator-only source-reconstruction inventory for validating native GoTrue migration contents against immutable upstream metadata; it contains no SQL content and is not database input." and
  .repository == "https://github.com/supabase/auth" and
  .sourceCommit == "6a8fc26f6042ba92cda51bc62b70f1b61c2cd12e" and
  .sourceRef == "v2.184.0" and .sourceTree == "c44f9545914e7d939457004838549dae158a3c40" and
  .sourcePath == "migrations" and .ociImage == $image and .ociIndexDigest == $index and .ociAmd64ManifestDigest == $amd64 and
  (.records | type == "array" and length == 65 and
    all(.[]; (keys | sort) == ["byteLength", "filename", "gitBlobSha1", "sha256"] and
      (.filename | type == "string" and test("^[0-9][0-9_]+[a-z0-9_]*(?:\\.[a-z0-9_]+)*\\.up\\.sql$")) and
      (.gitBlobSha1 | type == "string" and test("^[0-9a-f]{40}$")) and
      (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
      (.byteLength | type == "number" and floor == . and . > 0)) and
    (map(select(.filename == "00_init_auth_schema.up.sql" and .gitBlobSha1 == "a040095ae1e55f43bc35535e892a3cfc4c5981f9" and .sha256 == "4c3ab2565f2836d8fa0a54fd9d153facaee0c4c6258fa0a794c93446ddc10f71" and .byteLength == 3771)) | length == 1) and
    (map(select(.filename == "20251201000000_add_oauth_client_states_table.up.sql")) | length == 1)
  )
' "$gotrue_inventory" >/dev/null || { printf 'invalid GoTrue migration inventory\n' >&2; exit 1; }
gotrue_inventory_sha256=$(sha256sum -- "$gotrue_inventory" | cut -d' ' -f1)
git -C "$repo_root" diff --quiet -- "$gotrue_inventory" && git -C "$repo_root" diff --cached --quiet -- "$gotrue_inventory" || {
  printf 'GoTrue migration inventory must be a clean source input\n' >&2; exit 1;
}

[[ -f "$bootstrap_manifest" && -r "$bootstrap_manifest" ]] || {
  printf 'unreadable bootstrap source manifest\n' >&2
  exit 1
}
jq -e --arg commit "$expected_upstream_commit" --arg image "$db_image" '
  (keys | sort) == ["files", "platformAuthBootstrap", "schemaVersion", "upstream"] and
  .schemaVersion == 1 and
  (.upstream | type == "object" and (keys | sort) == ["commit", "postgresImage", "repository", "sourcePath"] and .commit == $commit and .postgresImage == $image) and
  (.files | type == "object" and
    (keys | sort == [
      "_supabase.sql",
      "jwt.sql",
      "logs.sql",
      "pooler.sql",
      "realtime.sql",
      "roles.sql",
      "webhooks.sql"
    ]) and
    all(.[]; type == "string" and test("^[0-9a-f]{64}$"))
  ) and
  (.platformAuthBootstrap |
    (keys | sort) == ["execution", "kind", "ociAmd64ManifestDigest", "ociImage", "ociIndexDigest", "purpose", "records", "repository", "schemaVersion", "source", "sourceCommit", "sourceTree"] and
    .schemaVersion == 1 and
    .kind == "supabase-postgres-platform-auth-bootstrap-source-inventory" and
    .purpose == "Generator-only immutable upstream source inventory for the native Postgres auth bootstrap; it is not database input and contains no runtime-derived rows." and
    .repository == "https://github.com/supabase/postgres" and
    .sourceCommit == "b2c91b0a29332cec79473ee8a6dfa0e205cd0aaa" and
    .sourceTree == "178647188a66c1549f97f55fa1052eb583d0912c" and
    .ociImage == "docker.io/supabase/postgres:15.8.1.085" and
    .ociIndexDigest == "sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b" and
    .ociAmd64ManifestDigest == "sha256:caae3d066f437332d593011e3e7ecf78ab005ce9b89378efd53f97f0410563ad" and
    .execution == {"dockerfile15GitBlobSha1":"42ffc858cd51209fe0f986ceda265fecc34d9955","migrateScriptGitBlobSha1":"0a84d1e6c462231fd3f2844ec37e49a92d9f5e9d"} and
    .source == {"path":"migrations/db/init-scripts/00000000000001-auth-schema.sql","gitBlobSha1":"ad47aadd9c2acf3cdb78ec569860ca695bea4152","byteLength":4547,"sha256":"65a4a55ba3248716eb4946a8677be41c94bc90eafaa22c0eb95b09908f96fa4f"} and
    .records == [
      {"version":"20171026211738"},
      {"version":"20171026211808"},
      {"version":"20171026211834"},
      {"version":"20180103212743"},
      {"version":"20180108183307"},
      {"version":"20180119214651"},
      {"version":"20180125194653"}
    ]
  )
' "$bootstrap_manifest" >/dev/null || {
  printf 'invalid bootstrap source manifest\n' >&2
  exit 1
}
platform_auth_inventory_sha256=$(sha256sum -- "$bootstrap_manifest" | cut -d' ' -f1)
platform_auth_source_sha256=$(sha256sum -- "$platform_auth_bootstrap" | cut -d' ' -f1)
[[ "$platform_auth_source_sha256" == '65a4a55ba3248716eb4946a8677be41c94bc90eafaa22c0eb95b09908f96fa4f' &&
  $(wc -c <"$platform_auth_bootstrap" | tr -d '[:space:]') == '4547' ]] || {
  printf 'Postgres platform auth bootstrap source hash or byte length mismatch\n' >&2; exit 1;
}
python3 - "$platform_auth_bootstrap" "$staging_dir/platform-auth-schema-migrations.expected.tsv" <<'PY'
import hashlib
import re
import sys

source = open(sys.argv[1], "rb").read()
if hashlib.sha1(b"blob %d\0" % len(source) + source).hexdigest() != "ad47aadd9c2acf3cdb78ec569860ca695bea4152":
    raise SystemExit("Postgres platform auth bootstrap Git blob mismatch")
blocks = re.findall(rb"INSERT\s+INTO\s+auth\.schema_migrations\s*\(\s*version\s*\)\s*VALUES\s+(.*?);", source, re.IGNORECASE | re.DOTALL)
if len(blocks) != 1:
    raise SystemExit("Postgres platform auth bootstrap must contain exactly one schema_migrations INSERT block")
records = re.findall(rb"\(\s*'([0-9]+)'\s*\)", blocks[0])
if re.sub(rb"\s|\(\s*'[0-9]+'\s*\)|,", b"", blocks[0]):
    raise SystemExit("Postgres platform auth bootstrap schema_migrations INSERT block is not a quoted-version list")
expected = [b"20171026211738", b"20171026211808", b"20171026211834", b"20180103212743", b"20180108183307", b"20180119214651", b"20180125194653"]
if records != expected:
    raise SystemExit("Postgres platform auth bootstrap versions do not match immutable source")
open(sys.argv[2], "wb").write(b"\n".join(records) + b"\n")
PY
jq -r '.platformAuthBootstrap.records[].version' "$bootstrap_manifest" >"$staging_dir/platform-auth-schema-migrations.manifest.tsv"
cmp -s "$staging_dir/platform-auth-schema-migrations.expected.tsv" "$staging_dir/platform-auth-schema-migrations.manifest.tsv" || {
  printf 'Postgres platform auth bootstrap manifest records do not match source\n' >&2; exit 1;
}
platform_auth_expected_ledger_evidence="$staging_dir/platform-auth-schema-migrations.expected.tsv"

# These are all the checked-in DB initialization sources used by the isolated DB.
init_sources=(
  "$supabase_dir/volumes/db/realtime.sql"
  "$supabase_dir/volumes/db/webhooks.sql"
  "$supabase_dir/volumes/db/roles.sql"
  "$supabase_dir/volumes/db/jwt.sql"
  "$supabase_dir/volumes/db/_supabase.sql"
  "$supabase_dir/volumes/db/logs.sql"
  "$supabase_dir/volumes/db/pooler.sql"
)
for source in "${init_sources[@]}"; do
  [[ -f "$source" && -r "$source" ]] || {
    printf 'unreadable DB initialization source: %s\n' "$source" >&2
    exit 1
  }
  source_name=${source##*/}
  expected_hash=$(jq -er --arg name "$source_name" '.files[$name]' "$bootstrap_manifest") || {
    printf 'missing bootstrap source hash: %s\n' "$source_name" >&2
    exit 1
  }
  actual_hash=$(sha256sum -- "$source" | cut -d' ' -f1)
  [[ "$actual_hash" == "$expected_hash" ]] || {
    printf 'bootstrap source hash mismatch: %s\n' "$source_name" >&2
    exit 1
  }
done
[[ -r "$reconstruction_archive" && -r "$reconstruction_manifest" && -f "$reconstruction_validator" && -r "$reconstruction_validator" ]] || {
  printf 'unreadable reconstruction source archive, manifest, or validator\n' >&2
  exit 1
}
python3 "$reconstruction_validator" --archive "$reconstruction_archive" --manifest "$reconstruction_manifest"
[[ -r "$g026_bundle" && -r "$g026_transition" && -r "$g026_repairs" && -f "$g026_validator" && -r "$g026_validator" ]] || {
  printf 'unreadable G026 reconstruction bundle inputs or verifier\n' >&2
  exit 1
}
python3 "$g026_validator"
jq -e --arg archive "$(sha256sum -- "$reconstruction_archive" | cut -d' ' -f1)" '
  .schemaVersion == 5 and .reconstructionAuthorized == false and
  .reconstructionArchiveSha256 == $archive and
  .validationLedger == [
    {"ordinal":0,"mode":"off","kind":"preexisting_ordinal0_body_deferral"},
    {"ordinal":6,"mode":"off","kind":"g026_ordinal6_quarantine"}
  ] and
  .slots == {
    "phaseAAfterOrdinal":2,
    "phaseBBeforeMigration":"20260713002000_g014_public_api_private_boundary.sql"
  }
' "$g026_bundle" >/dev/null || {
  printf 'invalid G026 reconstruction bundle integration contract\n' >&2
  exit 1
}
cp -- "$g026_bundle" "$g026_bundle_evidence"
cp -- "$g026_transition" "$g026_transition_evidence"
cp -- "$g026_repairs" "$g026_repairs_evidence"
jq -c '{validationLedger:.validationLedger,slots:.slots}' "$g026_bundle" >"$g026_validation_ledger"
reconstruction_extract_dir="$work_dir/reconstruction-sources"
reconstruction_members="$staging_dir/reconstruction-source-members.tsv"
reconstruction_exclusions="$work_dir/reconstruction-compatibility-exclusions.jsonl"
reconstruction_exclusions_evidence="$staging_dir/reconstruction-compatibility-exclusions.jsonl"
reconstruction_relocations="$work_dir/reconstruction-compatibility-relocations.jsonl"
reconstruction_relocations_evidence="$staging_dir/reconstruction-compatibility-relocations.jsonl"
reconstruction_relocation_source="$work_dir/reconstruction-relocation-00.sql"
mkdir -m 700 "$reconstruction_extract_dir"
python3 - "$reconstruction_archive" "$reconstruction_manifest" "$reconstruction_extract_dir" "$reconstruction_members" "$reconstruction_exclusions" "$reconstruction_relocations" "$reconstruction_relocation_source" <<'PY'
import hashlib
import json
import sys
import zipfile
from pathlib import Path

archive, manifest_path, destination, member_map, exclusions_path, relocations_path, relocation_source = map(Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
entries = manifest["entries"]
exclusions = manifest["compatibilityExclusions"]
relocations = manifest["compatibilityRelocations"]
if not exclusions or not relocations:
    raise SystemExit("reconstruction compatibility blocks are invalid")
with zipfile.ZipFile(archive) as source, member_map.open("w", encoding="utf-8", newline="\n") as output, exclusions_path.open("w", encoding="utf-8", newline="\n") as exclusions_output, relocations_path.open("w", encoding="utf-8", newline="\n") as relocations_output:
    for exclusion in exclusions:
        exclusions_output.write(json.dumps(exclusion, sort_keys=True, separators=(",", ":")) + "\n")
    for relocation in relocations:
        relocations_output.write(json.dumps(relocation, sort_keys=True, separators=(",", ":")) + "\n")
    for entry in entries:
        data = source.read(entry["path"])
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise SystemExit("verified reconstruction member hash drifted during extraction")
        entry_exclusions = [item for item in exclusions if item["ordinal"] == entry["ordinal"]]
        entry_relocations = [item for item in relocations if item["ordinal"] == entry["ordinal"]]
        replay = data
        if entry_exclusions or entry_relocations:
            blocks = [*entry_exclusions, *entry_relocations]
            if any(entry["path"] != item["sourcePath"]
                   or entry["blobSha1"] != item["sourceGitBlobSha1"]
                   or entry["sha256"] != item["sourceSha256"] for item in blocks):
                raise SystemExit("reconstruction compatibility block source drifted")
            lines = data.splitlines(keepends=True)
            previous_end = 0
            retained = []
            relocation_bytes = []
            for block in blocks:
                start_line, end_line = block["startLine"], block["endLine"]
                if start_line < 1 or end_line < start_line or end_line > len(lines) or start_line <= previous_end:
                    raise SystemExit("reconstruction compatibility block range is invalid or overlaps")
                content = b"".join(lines[start_line - 1:end_line])
                if len(content) != block["byteLength"] or hashlib.sha256(content).hexdigest() != block["sha256"]:
                    raise SystemExit("reconstruction compatibility block bytes mismatch")
                retained.extend(lines[previous_end:start_line - 1])
                if block in entry_relocations:
                    relocation_bytes.append(content)
                previous_end = end_line
            retained.extend(lines[previous_end:])
            replay = b"".join(retained)
            if entry["ordinal"] == 0:
                relocation_source.write_bytes(b"".join(relocation_bytes))
        extracted = destination / f'{entry["ordinal"]:02d}.sql'
        extracted.write_bytes(replay)
        output.write(f'{entry["ordinal"]}\t{entry["path"]}\t{entry["sha256"]}\treconstruction-sources/{entry["ordinal"]:02d}.sql\n')
PY
cp -- "$reconstruction_exclusions" "$reconstruction_exclusions_evidence"
cp -- "$reconstruction_relocations" "$reconstruction_relocations_evidence"
[[ $(wc -l <"$reconstruction_members" | tr -d '[:space:]') == 10 ]] || {
  printf 'reconstruction source archive must contain exactly ten members\n' >&2
  exit 1
}
reconstruction_archive_sha256=$(sha256sum -- "$reconstruction_archive" | cut -d' ' -f1)
reconstruction_manifest_sha256=$(sha256sum -- "$reconstruction_manifest" | cut -d' ' -f1)
[[ "$reconstruction_archive_sha256" == "$(jq -r '.archiveSha256' "$reconstruction_manifest")" ]] || {
  printf 'reconstruction archive hash does not match its manifest\n' >&2
  exit 1
}
jq -e --arg purpose "$reconstruction_purpose" '
  .reconstructionAuthorized == false and .purpose == $purpose and
  (.entries | type == "array" and length == 10 and
   [.[].ordinal] == [0,1,2,3,4,5,6,7,8,9] and
   .[1] == {"ordinal":1,"path":"supabase/migrations/temp/20251210_redesign_submissions_v2.sql","blobSha1":"254765d14e47bc2754fcbbcecc1365153f944505","byteLength":16452,"sha256":"3e5bf820c508f24f02b3a81843707758642a53c1d90084f201bb60f7836bb674","role":"historical_prerequisite_candidate"}) and
  (.compatibilityExclusions | type == "array" and length == 1 and
   .[0].disposition == "excluded_without_replacement" and .[0].evidenceScope == "candidate_only") and
  (.compatibilityRelocations | type == "array" and length == 1 and
   .[0].disposition == "relocated_before_source_without_modification" and .[0].evidenceScope == "candidate_only")
' "$reconstruction_manifest" >/dev/null || {
  printf 'invalid unauthorized reconstruction source manifest\n' >&2
  exit 1
}
evidence_scope_file="$staging_dir/evidence-scope.txt"
printf '%s\n' "$reconstruction_purpose" >"$evidence_scope_file"
migration_order_predecessor='20260417_prevent_active_restaurant_identity_duplicates.sql'
migration_order_successor='20260417_harden_submission_identity_duplicate_checks.sql'
declare -A migration_order_override_counts=(
  ["$migration_order_predecessor"]=0
  ["$migration_order_successor"]=0
)
declare -A backend_migrations_by_name=()
declare -A app_migrations_by_name=()
declare -A all_migration_names=()
declare -A excluded_backend_migrations=(
  [20260124_create_document_embeddings_bge.sql]=1
  [20260124_create_restaurants.sql]=1
  [20260124_fix_approved_name_sync.sql]=1
  [20260124_update_embeddings_constraint.sql]=1
  [20260131_fix_search_rpc.sql]=1
  [20260213_create_announcements_table_and_seed.sql]=1
)
declare -A excluded_app_migrations=(
  [20251219_db_performance_optimization.sql]=1
  [20260118_create_ocr_logs.sql]=1
)
for source_kind in backend app; do
  case "$source_kind" in
    backend) source_dir=$backend_migrations_dir ;;
    app) source_dir=$app_migrations_dir ;;
  esac
  while IFS= read -r -d '' migration; do
    name=${migration##*/}
    [[ "$name" =~ ^([0-9]{8})([0-9]{0,6})(_[A-Za-z0-9][A-Za-z0-9._-]*)?\.sql$ && -s "$migration" ]] || {
      printf 'empty or nonconforming %s migration: %s\n' "$source_kind" "$name" >&2; exit 1;
    }
    relative_migration=${migration#"$repo_root"/}
    git -C "$repo_root" ls-files --error-unmatch -- "$relative_migration" >/dev/null || {
      printf 'untracked %s migration source: %s\n' "$source_kind" "$name" >&2; exit 1;
    }
    migration_date=${BASH_REMATCH[1]}
    if ((10#$migration_date < 20260214)); then
      case "$source_kind" in
        backend) [[ -n ${excluded_backend_migrations[$name]+x} ]] ;;
        app) [[ -n ${excluded_app_migrations[$name]+x} ]] ;;
      esac || { printf 'unclassified pre-cutoff %s migration: %s\n' "$source_kind" "$name" >&2; exit 1; }
    fi
    case "$source_kind" in
      backend) backend_migrations_by_name[$name]=$migration ;;
      app) app_migrations_by_name[$name]=$migration ;;
    esac
    all_migration_names[$name]=1
  done < <(find "$source_dir" -maxdepth 1 -type f -name '*.sql' -print0 | LC_ALL=C sort -z)
done
for name in "${!excluded_backend_migrations[@]}"; do
  [[ -n ${backend_migrations_by_name[$name]+x} ]] || { printf 'missing excluded pre-cutoff backend migration: %s\n' "$name" >&2; exit 1; }
done
for name in "${!excluded_app_migrations[@]}"; do
  [[ -n ${app_migrations_by_name[$name]+x} ]] || { printf 'missing excluded pre-cutoff app migration: %s\n' "$name" >&2; exit 1; }
done

applied_migrations=()
declare -A applied_migrations_by_name=()
duplicate_source_pairs="$staging_dir/duplicate-migration-source-pairs.sha256"
: >"$duplicate_source_pairs"
while IFS= read -r -d '' name; do
  backend_migration=${backend_migrations_by_name[$name]-}
  app_migration=${app_migrations_by_name[$name]-}
  if [[ -n "$backend_migration" && -n "$app_migration" ]]; then
    backend_hash=$(sha256sum -- "$backend_migration" | cut -d' ' -f1)
    app_hash=$(sha256sum -- "$app_migration" | cut -d' ' -f1)
    [[ "$backend_hash" == "$app_hash" ]] || {
      printf 'duplicate migration sources differ: %s\n' "$name" >&2; exit 1;
    }
    printf '%s  %s  %s\n' "$app_hash" "${app_migration#"$repo_root"/}" "${backend_migration#"$repo_root"/}" >>"$duplicate_source_pairs"
    canonical_migration=$app_migration
  elif [[ -n "$app_migration" ]]; then
    canonical_migration=$app_migration
  else
    canonical_migration=$backend_migration
  fi
  [[ -n "$canonical_migration" ]] || { printf 'missing migration source: %s\n' "$name" >&2; exit 1; }
  if [[ "$name" =~ ^([0-9]{8}) ]]; then
    migration_date=${BASH_REMATCH[1]}
  else
    printf 'nonconforming migration name: %s\n' "$name" >&2; exit 1
  fi
  if ((10#$migration_date >= 20260214)); then
    applied_migrations+=("$canonical_migration")
    applied_migrations_by_name[$name]=$canonical_migration
    if [[ -n ${migration_order_override_counts[$name]+x} ]]; then
      ((migration_order_override_counts[$name] += 1))
    fi
  fi
done < <(printf '%s\0' "${!all_migration_names[@]}" | LC_ALL=C sort -z)
for name in "$migration_order_predecessor" "$migration_order_successor"; do
  ((migration_order_override_counts[$name] == 1)) || {
    printf 'migration-order override source must be present exactly once: %s\n' "$name" >&2; exit 1;
  }
  [[ -n ${applied_migrations_by_name[$name]+x} ]] || {
    printf 'migration-order override source is unclassified: %s\n' "$name" >&2; exit 1;
  }
done
((${#applied_migrations[@]} > 0)) || { printf 'no post-cutoff migrations found\n' >&2; exit 1; }
effective_migrations=()
for migration in "${applied_migrations[@]}"; do
  name=${migration##*/}
  case "$name" in
    "$migration_order_predecessor")
      ;;
    "$migration_order_successor")
      effective_migrations+=("${applied_migrations_by_name[$migration_order_predecessor]}")
      effective_migrations+=("$migration")
      ;;
    *)
      effective_migrations+=("$migration")
      ;;
  esac
done
((${#effective_migrations[@]} == ${#applied_migrations[@]})) || {
  printf 'migration-order override produced an invalid effective migration set\n' >&2; exit 1;
}
initialization_inputs="$staging_dir/initialization-inputs.sha256"
{
  for source in "$script_dir/${BASH_SOURCE[0]##*/}" "$reconstruction_validator" "$g026_validator" \
    "$reconstruction_archive" "$reconstruction_manifest" "$g026_bundle" "$g026_transition" "$g026_repairs" \
    "$bootstrap_manifest" "$platform_auth_bootstrap" "${init_sources[@]}" "$storage_inventory" \
    "$gotrue_manifest" "$gotrue_inventory" "$supabase_dir/docker-compose.yml" "${effective_migrations[@]}"; do
    printf '%s  %s\n' "$(sha256sum -- "$source" | cut -d' ' -f1)" "${source#"$repo_root"/}"
  done
  printf '%s  %s\n' "$(sha256sum -- "$reconstruction_members" | cut -d' ' -f1)" 'generated/reconstruction-source-members.tsv'
  while IFS=$'\t' read -r ordinal member_path member_hash extracted; do
    printf '%s  reconstruction-member-%s:%s\n' "$member_hash" "$ordinal" "$member_path"
  done <"$reconstruction_members"
  printf '%s  %s\n' "$(sha256sum -- "$reconstruction_exclusions_evidence" | cut -d' ' -f1)" 'generated/reconstruction-compatibility-exclusions.jsonl'
  printf '%s  %s\n' "$(sha256sum -- "$evidence_scope_file" | cut -d' ' -f1)" 'generated/evidence-scope.txt'
  printf '%s  %s\n' "$(sha256sum -- "$g026_validation_ledger" | cut -d' ' -f1)" 'generated/g026-validation-ledger.json'
} >"$initialization_inputs"
initialization_inputs_hash=$(sha256sum -- "$initialization_inputs" | cut -d' ' -f1)

# Resolve the active context before isolating Docker config, then allow only local
# Docker Desktop/Linux-container endpoints.
docker_context_name=$(docker context show) || {
  printf 'unable to resolve the current Docker context\n' >&2
  exit 1
}
[[ "$docker_context_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  printf 'current Docker context name is invalid\n' >&2
  exit 1
}
docker_context_endpoint=$(docker context inspect "$docker_context_name" --format '{{ .Endpoints.docker.Host }}') || {
  printf 'unable to inspect the current Docker context endpoint\n' >&2
  exit 1
}
case "$docker_context_endpoint" in
  'unix:///var/run/docker.sock'|'npipe:////./pipe/docker_engine'|'npipe:////./pipe/dockerDesktopLinuxEngine')
    docker_endpoint=$docker_context_endpoint
    ;;
  *)
    printf 'current Docker context is not a validated local Docker Desktop/Linux-container endpoint: %s\n' "$docker_context_endpoint" >&2
    exit 1
    ;;
esac
# The public, digest-pinned image is a reproducible build dependency, never
# a source of catalog data. Compose itself remains pull-free.
if ! docker_local image inspect "$db_image" >/dev/null; then
  docker_local pull "$db_image" >/dev/null
fi
docker_local image inspect "$db_image" >/dev/null || {
  printf 'required pinned DB image is unavailable after pull\n' >&2
  exit 1
}
[[ $(docker_local image inspect "$db_image" --format '{{.Architecture}}') == 'amd64' ]] || {
  printf 'required Postgres image architecture is not amd64\n' >&2; exit 1;
}
db_resolved_repo_digests=$(docker_local image inspect "$db_image" --format '{{range .RepoDigests}}{{println .}}{{end}}')
[[ "$db_resolved_repo_digests" == *"@${db_index_digest}"* || "$db_resolved_repo_digests" == *"@${db_amd64_manifest_digest}"* ]] || {
  printf 'Postgres resolved RepoDigest does not match pinned index or amd64 manifest evidence\n' >&2; exit 1;
}
platform_auth_image_evidence="$staging_dir/postgres-image-00000000000001-auth-schema.sql"
docker_local run --rm --network none --entrypoint /bin/sh "$db_image" -ec '
  test -f "$1" && test -r "$1"
  cat -- "$1"
' sh '/docker-entrypoint-initdb.d/init-scripts/00000000000001-auth-schema.sql' >"$platform_auth_image_evidence" || {
  printf 'unable to extract Postgres platform auth bootstrap from pinned image\n' >&2
  exit 1
}
cmp -s "$platform_auth_bootstrap" "$platform_auth_image_evidence" || {
  printf 'Postgres platform auth bootstrap source does not match pinned image bytes\n' >&2
  exit 1
}
platform_auth_image_sha256=$(sha256sum -- "$platform_auth_image_evidence" | cut -d' ' -f1)
if ! docker_local image inspect "$storage_image" >/dev/null; then
  docker_local pull "$storage_image" >/dev/null
fi
docker_local image inspect "$storage_image" >/dev/null || {
  printf 'required pinned Storage image is unavailable after pull\n' >&2; exit 1;
}
[[ $(docker_local image inspect "$storage_image" --format '{{.Architecture}}') == 'amd64' ]] || {
  printf 'required Storage image architecture is not amd64\n' >&2; exit 1;
}
storage_resolved_image_id=$(docker_local image inspect "$storage_image" --format '{{.Id}}')
storage_resolved_repo_digests=$(docker_local image inspect "$storage_image" --format '{{range .RepoDigests}}{{println .}}{{end}}')
[[ "$storage_resolved_repo_digests" == *"@${storage_index_digest}"* || "$storage_resolved_repo_digests" == *"@${storage_amd64_manifest_digest}"* ]] || {
  printf 'Storage resolved RepoDigest does not match pinned index or amd64 manifest evidence\n' >&2; exit 1;
}
if ! docker_local image inspect "$gotrue_image" >/dev/null; then
  docker_local pull "$gotrue_image" >/dev/null
fi
docker_local image inspect "$gotrue_image" >/dev/null || {
  printf 'required pinned GoTrue image is unavailable after pull\n' >&2; exit 1;
}
[[ $(docker_local image inspect "$gotrue_image" --format '{{.Architecture}}') == 'amd64' ]] || {
  printf 'required GoTrue image architecture is not amd64\n' >&2; exit 1;
}
gotrue_resolved_image_id=$(docker_local image inspect "$gotrue_image" --format '{{.Id}}')
gotrue_resolved_repo_digests=$(docker_local image inspect "$gotrue_image" --format '{{range .RepoDigests}}{{println .}}{{end}}')
[[ "$gotrue_resolved_repo_digests" == *"@${gotrue_index_digest}"* || "$gotrue_resolved_repo_digests" == *"@${gotrue_amd64_manifest_digest}"* ]] || {
  printf 'GoTrue resolved RepoDigest does not match pinned index or amd64 manifest evidence\n' >&2; exit 1;
}
realtime_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/realtime.sql")
webhooks_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/webhooks.sql")
roles_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/roles.sql")
jwt_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/jwt.sql")
supabase_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/_supabase.sql")
logs_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/logs.sql")
pooler_sql_host_path=$(compose_host_path "$supabase_dir/volumes/db/pooler.sql")

password=$(openssl rand -hex 32)
jwt_secret=$(openssl rand -hex 32)
read -r anon_key service_key < <(JWT_SECRET="$jwt_secret" python3 - <<'PY'
import base64, hashlib, hmac, json, os
def token(role):
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b'=')
    body = base64.urlsafe_b64encode(json.dumps({"role": role, "iss": "supabase"}, separators=(",", ":")).encode()).rstrip(b'=')
    signature = base64.urlsafe_b64encode(hmac.new(os.environ["JWT_SECRET"].encode(), header + b"." + body, hashlib.sha256).digest()).rstrip(b'=')
    return (header + b"." + body + b"." + signature).decode()
print(token("anon"), token("service_role"))
PY
)
cat >"$env_file" <<EOF
POSTGRES_PASSWORD=$password
JWT_SECRET=$jwt_secret
G014_DB_CONTAINER_NAME=${project}-db
ANON_KEY=$anon_key
SERVICE_KEY=$service_key
G014_STORAGE_CONTAINER_NAME=${project}-storage
EOF
chmod 600 "$env_file"

cat >"$compose_file" <<EOF
services:
  db:
    image: $db_image
    pull_policy: never
    container_name: \${G014_DB_CONTAINER_NAME}
    networks: [isolated]
    environment:
      POSTGRES_HOST: /var/run/postgresql
      PGPORT: '5432'
      POSTGRES_PORT: '5432'
      PGPASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      PGDATABASE: postgres
      POSTGRES_DB: postgres
      JWT_SECRET: \${JWT_SECRET}
      JWT_EXP: '3600'
    volumes:
      - '$realtime_sql_host_path:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:ro'
      - '$webhooks_sql_host_path:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro'
      - '$roles_sql_host_path:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro'
      - '$jwt_sql_host_path:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro'
      - '$supabase_sql_host_path:/docker-entrypoint-initdb.d/migrations/97-_supabase.sql:ro'
      - '$logs_sql_host_path:/docker-entrypoint-initdb.d/migrations/99-logs.sql:ro'
      - '$pooler_sql_host_path:/docker-entrypoint-initdb.d/migrations/99-pooler.sql:ro'
      - 'db-data:/var/lib/postgresql/data'
  auth:
    image: $gotrue_image
    pull_policy: never
    depends_on: [db]
    networks: [isolated]
    command: ["gotrue", "migrate"]
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: '9999'
      API_EXTERNAL_URL: http://localhost
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:\${POSTGRES_PASSWORD}@db:5432/postgres
      GOTRUE_DB_NAMESPACE: auth
      GOTRUE_SITE_URL: http://localhost
      GOTRUE_URI_ALLOW_LIST: http://localhost
      GOTRUE_DISABLE_SIGNUP: 'true'
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: '3600'
      GOTRUE_JWT_SECRET: \${JWT_SECRET}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'false'
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false'
      GOTRUE_MAILER_AUTOCONFIRM: 'true'
  storage:
    image: $storage_image
    pull_policy: never
    container_name: \${G014_STORAGE_CONTAINER_NAME}
    depends_on: [db]
    networks: [isolated]
    environment:
      ANON_KEY: \${ANON_KEY}
      SERVICE_KEY: \${SERVICE_KEY}
      POSTGREST_URL: http://storage:5000
      PGRST_JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:\${POSTGRES_PASSWORD}@db:5432/postgres
      DB_INSTALL_ROLES: 'false'
      REQUEST_ALLOW_X_FORWARDED_PATH: 'true'
      FILE_SIZE_LIMIT: '52428800'
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      GLOBAL_S3_BUCKET: stub
      ENABLE_IMAGE_TRANSFORMATION: 'false'
    volumes:
      - 'storage-data:/var/lib/storage'
networks:
  isolated:
    internal: true
volumes:
  db-data:
  storage-data:
EOF
chmod 600 "$compose_file"

compose up --detach --no-deps db
for _ in $(seq 1 60); do
  if compose exec -T db pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null; then break; fi
  sleep 1
done
compose exec -T db pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null
psql_client_version=$(compose exec -T db psql --version)
[[ "$psql_client_version" == 'psql (PostgreSQL) 15.'* ]] || {
  printf 'local DB psql client must be PostgreSQL 15.x, got: %s\n' "$psql_client_version" >&2
  exit 1
}
compose config --format json | jq -e '.networks.isolated.internal == true and ([.services.db.networks, .services.auth.networks, .services.storage.networks] | all(type == "object" and (keys | sort) == ["isolated"])) and ([.services.db.ports, .services.auth.ports, .services.storage.ports] | all(. == null or . == []))' >/dev/null || {
  printf 'db/GoTrue/Storage compose isolation contract mismatch\n' >&2; exit 1;
}
gotrue_file_evidence="$staging_dir/gotrue-container-migration-files.tsv"
gotrue_inventory_file_evidence="$staging_dir/gotrue-inventory-files.tsv"
gotrue_expected_ledger_evidence="$staging_dir/gotrue-schema-migrations.expected.tsv"
gotrue_ledger_evidence="$staging_dir/gotrue-schema-migrations.tsv"
compose run --rm --no-deps --entrypoint sh auth -ec 'cd /usr/local/etc/auth/migrations && for file in *.up.sql; do printf "%s\t%s\t%s\n" "$(sha256sum "$file" | cut -d " " -f1)" "$(wc -c <"$file")" "$file"; done | LC_ALL=C sort' >"$gotrue_file_evidence"
jq -r '.records[] | [.sha256, .byteLength, .filename] | @tsv' "$gotrue_inventory" | LC_ALL=C sort >"$gotrue_inventory_file_evidence"
cmp -s "$gotrue_file_evidence" "$gotrue_inventory_file_evidence" || {
  printf 'container GoTrue migration files do not match inventory\n' >&2; exit 1;
}
jq -er '
  [.records[] | (.filename | capture("^(?<version>[0-9]+)_").version)] as $versions |
  if $versions | length != 65 then error("GoTrue migration inventory version count mismatch")
  elif $versions | unique | length != 65 then error("GoTrue migration inventory versions are not unique")
  else $versions[]
  end
' "$gotrue_inventory" | LC_ALL=C sort >"$gotrue_expected_ledger_evidence"
[[ $(wc -l <"$gotrue_expected_ledger_evidence" | tr -d '[:space:]') == '65' ]] || {
  printf 'GoTrue expected migration ledger is incomplete\n' >&2; exit 1;
}
compose run --rm --no-deps auth >/dev/null
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <<'SQL' >/dev/null
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('auth.identities') IS NULL
     OR to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.refresh_tokens') IS NULL
     OR to_regclass('auth.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'native GoTrue platform migration contract is unavailable';
  END IF;
END $$;
SQL
auth_expected_ledger_evidence="$staging_dir/auth-schema-migrations.expected.tsv"
auth_ledger_evidence="$staging_dir/auth-schema-migrations.tsv"
gotrue_ledger_evidence="$staging_dir/gotrue-schema-migrations.tsv"
overlapping_auth_versions=$(LC_ALL=C comm -12 "$gotrue_expected_ledger_evidence" "$platform_auth_expected_ledger_evidence")
[[ -z "$overlapping_auth_versions" ]] || {
  printf 'GoTrue and Postgres platform auth migration inventories overlap\n' >&2; exit 1;
}
LC_ALL=C sort -u "$gotrue_expected_ledger_evidence" "$platform_auth_expected_ledger_evidence" >"$auth_expected_ledger_evidence"
[[ $(wc -l <"$auth_expected_ledger_evidence" | tr -d '[:space:]') == '72' ]] || {
  printf 'combined immutable auth migration ledger is incomplete\n' >&2; exit 1;
}
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c 'SELECT version FROM auth.schema_migrations ORDER BY version;' >"$auth_ledger_evidence"
LC_ALL=C comm -23 "$auth_ledger_evidence" "$platform_auth_expected_ledger_evidence" >"$gotrue_ledger_evidence"
cmp -s "$gotrue_ledger_evidence" "$gotrue_expected_ledger_evidence" || {
  printf 'native GoTrue migration ledger does not match immutable GoTrue inventory\n' >&2
  diff -u "$gotrue_expected_ledger_evidence" "$gotrue_ledger_evidence" >&2 || true
  exit 1
}
if ! cmp -s "$auth_ledger_evidence" "$auth_expected_ledger_evidence"; then
  printf 'native auth migration ledger does not match immutable combined inventory\n' >&2
  diff -u "$auth_expected_ledger_evidence" "$auth_ledger_evidence" >&2 || true
  exit 1
fi
compose up --detach storage
storage_file_evidence="$staging_dir/storage-container-migration-files.tsv"
compose exec -T storage sh -ec 'test -d /app/migrations/tenant'
compose exec -T storage sh -ec 'cd /app/migrations/tenant && for file in *.sql; do printf "%s\t%s\t%s\n" "$(sha256sum "$file" | cut -d " " -f1)" "$(wc -c <"$file")" "$file"; done | LC_ALL=C sort' >"$storage_file_evidence"
jq -r '.records[] | [.sha256, .byteLength, .filename] | @tsv' "$storage_inventory" | LC_ALL=C sort >"$staging_dir/storage-inventory-files.tsv"
cmp -s "$storage_file_evidence" "$staging_dir/storage-inventory-files.tsv" || {
  printf 'container Storage migration files do not match inventory\n' >&2; exit 1;
}
compose exec -T storage node - <<'NODE'
const { getConfig } = require('./dist/config')
const { runMigrationsOnTenant } = require('./dist/internal/database/migrations')

const { databaseURL, tenantId } = getConfig()
if (!databaseURL) {
  console.error('native Storage migration database URL is unavailable')
  process.exit(1)
}
runMigrationsOnTenant({ databaseUrl: databaseURL, tenantId })
  .then(() => process.stdout.write('native Storage tenant migrations completed\n'))
  .catch(() => {
    console.error('native Storage tenant migration failed')
    process.exit(1)
  })
NODE
for _ in $(seq 1 90); do
  storage_state=$(compose ps --format json storage | jq -r '.State // empty')
  [[ "$storage_state" == 'running' ]] || { sleep 1; continue; }
  storage_ledger_count=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c "SELECT count(*) FROM storage.migrations;" || true)
  [[ "$storage_ledger_count" == '50' ]] && break
  sleep 1
done
[[ "${storage_state:-}" == 'running' && "${storage_ledger_count:-}" == '50' ]] || {
  compose logs --no-color storage >&2 || true
  printf 'native Storage migration ledger did not settle\n' >&2; exit 1;
}
isolated_network="${project}_isolated"
[[ $(docker_local network inspect "$isolated_network" --format '{{.Internal}}') == 'true' ]] || {
  printf 'Storage network is not internal\n' >&2; exit 1;
}
for container in "${project}-db" "${project}-storage"; do
  [[ $(docker_local container inspect "$container" --format '{{.HostConfig.NetworkMode}}') == "$isolated_network" ]] &&
    [[ $(docker_local container inspect "$container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}') == "$isolated_network " ]] || {
      printf 'container has external network connectivity configured: %s\n' "$container" >&2; exit 1;
    }
done
storage_ledger_evidence="$staging_dir/storage-migration-ledger.tsv"
storage_native_file_expected_ledger="$staging_dir/storage-migration-native-file-ledger.expected.tsv"
storage_native_source_map="$staging_dir/storage-migration-native-source-map.tsv"
storage_inventory_source_map="$staging_dir/storage-migration-inventory-source-map.tsv"
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -F $'\t' -c 'SELECT id, name, hash FROM storage.migrations ORDER BY id;' >"$storage_ledger_evidence"
compose exec -T storage node - <<'NODE' >"$storage_native_file_expected_ledger"
const { loadMigrationFiles } = require('postgres-migrations')

loadMigrationFiles('/app/migrations/tenant')
  .then((rows) => {
    if (rows.length !== 50 || rows[0].id !== 0 || rows[0].name !== 'create-migrations-table') {
      throw new Error('native Storage migration loader contract mismatch')
    }
    process.stdout.write(`${rows.map(({ id, name, hash }) => `${id}\t${name}\t${hash}`).join('\n')}\n`)
  })
  .catch(() => {
    console.error('native Storage migration loader failed')
    process.exit(1)
  })
NODE
compose exec -T storage node - <<'NODE' >"$storage_native_source_map"
const { loadMigrationFiles } = require('postgres-migrations')

loadMigrationFiles('/app/migrations/tenant')
  .then((rows) => {
    const tenantRows = rows.filter(({ id }) => id > 0)
    if (tenantRows.length !== 49) throw new Error('native Storage tenant migration count mismatch')
    process.stdout.write(`${tenantRows.map(({ id, fileName }) => `${id}\t${fileName}`).join('\n')}\n`)
  })
  .catch(() => {
    console.error('native Storage migration source map failed')
    process.exit(1)
  })
NODE
jq -r '.records[] | [(.filename | capture("^(?<id>[0-9]+)-").id | tonumber), .filename] | @tsv' "$storage_inventory" >"$storage_inventory_source_map"
cmp -s "$storage_ledger_evidence" "$storage_native_file_expected_ledger" || {
  printf 'native Storage migration ledger does not match pinned loader output\n' >&2; exit 1;
}
cmp -s "$storage_native_source_map" "$storage_inventory_source_map" || {
  printf 'native Storage migration source map does not match inventory\n' >&2; exit 1;
}
[[ -s "$storage_file_evidence" ]] || {
  printf 'Storage migration file evidence is missing\n' >&2; exit 1;
}
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <<'SQL' >/dev/null
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'public' AND data_type = 'boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'file_size_limit' AND data_type = 'bigint'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types' AND data_type = 'ARRAY' AND udt_name = '_text'
  ) THEN
    RAISE EXCEPTION 'Storage buckets app migration prerequisites are missing';
  END IF;
END $$;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('g014-contract-probe', 'g014-contract-probe', true, 52428800, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
ROLLBACK;
SQL
# Establish immutable platform prerequisites missing from the source migration history; do not reorder migrations.
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -c 'BEGIN; CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; COMMIT;' >/dev/null
extension_namespaces=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c "SELECT string_agg(extname || ':' || n.nspname, ',' ORDER BY extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE extname IN ('fuzzystrmatch', 'pgcrypto', 'vector');")
[[ "$extension_namespaces" == 'fuzzystrmatch:extensions,pgcrypto:extensions,vector:extensions' ]] || { printf 'required platform extensions are unavailable or use the wrong schema\n' >&2; exit 1; }

chain_file="$staging_dir/migration-chain.txt"
: >"$chain_file"
previous_hash=$(printf '%s\n' "$partition_version" | sha256sum | cut -d' ' -f1)
for artifact in "$bootstrap_manifest" "$platform_auth_bootstrap" "$gotrue_manifest" "$gotrue_inventory" \
  "$supabase_dir/docker-compose.yml" "$storage_inventory" "$reconstruction_validator" "$g026_validator" \
  "$reconstruction_archive" "$reconstruction_manifest" "$g026_bundle" \
  "$script_dir/transform_g014_guardian_replay.py" \
  "$script_dir/recover_advisor_replay_prerequisites.py" \
  "$baselines_dir/local/application-prerequisites.sql"; do
  canonical_path=${artifact#"$repo_root"/}
  file_hash=$(sha256sum -- "$artifact" | cut -d' ' -f1)
  previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" "$canonical_path" "$file_hash" | sha256sum | cut -d' ' -f1)
  printf '%s  %s  %s\n' "$previous_hash" "$file_hash" "$canonical_path" >>"$chain_file"
done
reconstruction_members_hash=$(sha256sum -- "$reconstruction_members" | cut -d' ' -f1)
previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" 'generated/reconstruction-source-members.tsv' "$reconstruction_members_hash" | sha256sum | cut -d' ' -f1)
printf '%s  %s  %s\n' "$previous_hash" "$reconstruction_members_hash" 'generated/reconstruction-source-members.tsv' >>"$chain_file"
reconstruction_exclusions_hash=$(sha256sum -- "$reconstruction_exclusions_evidence" | cut -d' ' -f1)
previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" 'generated/reconstruction-compatibility-exclusions.jsonl' "$reconstruction_exclusions_hash" | sha256sum | cut -d' ' -f1)
printf '%s  %s  %s\n' "$previous_hash" "$reconstruction_exclusions_hash" 'generated/reconstruction-compatibility-exclusions.jsonl' >>"$chain_file"
reconstruction_relocations_hash=$(sha256sum -- "$reconstruction_relocations_evidence" | cut -d' ' -f1)
previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" 'generated/reconstruction-compatibility-relocations.jsonl' "$reconstruction_relocations_hash" | sha256sum | cut -d' ' -f1)
printf '%s  %s  %s\n' "$previous_hash" "$reconstruction_relocations_hash" 'generated/reconstruction-compatibility-relocations.jsonl' >>"$chain_file"
evidence_scope_hash=$(sha256sum -- "$evidence_scope_file" | cut -d' ' -f1)
previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" 'generated/evidence-scope.txt' "$evidence_scope_hash" | sha256sum | cut -d' ' -f1)
printf '%s  %s  %s\n' "$previous_hash" "$evidence_scope_hash" 'generated/evidence-scope.txt' >>"$chain_file"
g026_validation_ledger_hash=$(sha256sum -- "$g026_validation_ledger" | cut -d' ' -f1)
previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" 'generated/g026-validation-ledger.json' "$g026_validation_ledger_hash" | sha256sum | cut -d' ' -f1)
printf '%s  %s  %s\n' "$previous_hash" "$g026_validation_ledger_hash" 'generated/g026-validation-ledger.json' >>"$chain_file"
g026_apply_role_management_transform() {
  local source=$1 filename source_hash transformed_hash expected_hash expected_transformed_hash transformed
  filename=${source##*/}
  case "$filename" in
    20260713000450_g013_address_admin_approval.sql|20260713002000_g014_public_api_private_boundary.sql) ;;
    *) printf 'G026 role-management transform filename is not allowlisted: %s\n' "$filename" >&2; exit 1 ;;
  esac
  expected_hash=$(jq -er --arg filename "$filename" '.roleManagementReplayTransform.files[] | select(.filename == $filename) | .sourceSha256' "$g026_bundle")
  expected_transformed_hash=$(jq -er --arg filename "$filename" '.roleManagementReplayTransform.files[] | select(.filename == $filename) | .transformedSha256' "$g026_bundle")
  source_hash=$(sha256sum -- "$source" | cut -d' ' -f1)
  [[ "$source_hash" == "$expected_hash" ]] || { printf 'G026 role-management source hash mismatch: %s\n' "$filename" >&2; exit 1; }
  transformed="$work_dir/g026-role-management-$filename"
  python3 -c '
import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_bytes()
target = pathlib.Path(sys.argv[2])
binding = json.loads(sys.argv[3])
postcondition = sys.argv[4].encode("ascii") + b"\n"
begin = binding["beginStatement"].encode("ascii") + b"\n"
grant = binding["grantStatement"].encode("ascii") + b"\n"
revoke = binding["revokeStatement"].encode("ascii") + b"\n"
commit = binding["commitStatement"].encode("ascii") + b"\n"
role_anchor = binding["roleValidationTerminator"].encode("ascii") + b"\n"
revoke_anchor = binding["revokeAnchor"].encode("ascii")
notify_anchor = binding["notifyAnchor"].encode("ascii")
removed = binding["removedStatement"].encode("ascii")
is_g013 = binding["filename"] == "20260713000450_g013_address_admin_approval.sql"
is_g014 = binding["filename"] == "20260713002000_g014_public_api_private_boundary.sql"
if is_g013:
    if (not all(isinstance(binding[name], str) and binding[name] for name in (
            "publicSchemaGrantStatement", "publicSchemaRevokeStatement",
            "publicSchemaPrecondition", "publicSchemaPostcondition", "publicSchemaGrantAnchor",
            "publicSchemaTargetOwnerAnchor"))
            or any(binding[name] is not None for name in (
                "finalContractTerminator", "removedFinalContractInvocation",
                "relocatedFinalContractInvocation"))
            or binding["removedFinalContractInvocationCount"] != 0):
        raise SystemExit("G026 G013 public-schema compatibility binding drifted")
    public_schema_grant = (binding["publicSchemaGrantStatement"] + "\n").encode("ascii")
    public_schema_revoke = (binding["publicSchemaRevokeStatement"] + "\n").encode("ascii")
    public_schema_precondition = (binding["publicSchemaPrecondition"] + "\n").encode("ascii")
    public_schema_postcondition = (binding["publicSchemaPostcondition"] + "\n").encode("ascii")
    public_schema_grant_anchor = binding["publicSchemaGrantAnchor"].encode("ascii")
    public_schema_target_owner_anchor = binding["publicSchemaTargetOwnerAnchor"].encode("ascii")
    relocated_final_contract = b""
    private_schema_usage_grant = b""
    private_function_execute_grant = b""
    private_function_execute_revoke = b""
    private_schema_usage_revoke = b""
    private_privilege_postcondition = b""
    bridge_membership_grant = b""
    bridge_membership_revoke = b""
    cleanup_membership_grant = b""
    cleanup_membership_revoke = b""
elif is_g014:
    if (any(binding[name] is not None for name in (
                "publicSchemaGrantStatement", "publicSchemaRevokeStatement",
                "publicSchemaPrecondition", "publicSchemaPostcondition", "publicSchemaGrantAnchor",
                "publicSchemaTargetOwnerAnchor"))
            or not all(isinstance(binding[name], str) and binding[name] for name in (
                "finalContractTerminator", "removedFinalContractInvocation",
                "relocatedFinalContractInvocation", "privateSchemaUsageGrantStatement",
                "privateFunctionExecuteGrantStatement", "privateFunctionExecuteRevokeStatement",
                "privateSchemaUsageRevokeStatement", "privatePrivilegePostcondition",
                "bridgeMembershipGrantStatement", "bridgeMembershipRevokeStatement",
                "cleanupMembershipGrantStatement", "cleanupMembershipRevokeStatement"))
            or binding["removedFinalContractInvocationCount"] != 1):
        raise SystemExit("G026 G014 final-contract compatibility binding drifted")
    public_schema_grant = b""
    public_schema_revoke = b""
    public_schema_precondition = b""
    public_schema_postcondition = b""
    public_schema_grant_anchor = b""
    public_schema_target_owner_anchor = b""
    relocated_final_contract = binding["relocatedFinalContractInvocation"].encode("ascii")
    private_schema_usage_grant = (binding["privateSchemaUsageGrantStatement"] + "\n").encode("ascii")
    private_function_execute_grant = (binding["privateFunctionExecuteGrantStatement"] + "\n").encode("ascii")
    private_function_execute_revoke = (binding["privateFunctionExecuteRevokeStatement"] + "\n").encode("ascii")
    private_schema_usage_revoke = (binding["privateSchemaUsageRevokeStatement"] + "\n").encode("ascii")
    private_privilege_postcondition = (binding["privatePrivilegePostcondition"] + "\n").encode("ascii")
    bridge_membership_grant = (binding["bridgeMembershipGrantStatement"] + "\n").encode("ascii")
    bridge_membership_revoke = (binding["bridgeMembershipRevokeStatement"] + "\n").encode("ascii")
    cleanup_membership_grant = (binding["cleanupMembershipGrantStatement"] + "\n").encode("ascii")
    cleanup_membership_revoke = (binding["cleanupMembershipRevokeStatement"] + "\n").encode("ascii")
    if (bridge_membership_grant != grant or bridge_membership_revoke != revoke
            or cleanup_membership_grant != grant or cleanup_membership_revoke != revoke):
        raise SystemExit("G026 G014 membership compatibility binding drifted")
else:
    raise SystemExit("G026 role-management transform filename is not allowlisted")
if hashlib.sha256(source).hexdigest() != binding["sourceSha256"]:
    raise SystemExit("G026 role-management source hash mismatch")
if source.count(removed) != binding["removedStatementCount"]:
    raise SystemExit("G026 role-management redundant statement count drifted")
if source.count(role_anchor) != 1 or source.count(revoke_anchor) != 1 or source.count(notify_anchor) != 1:
    raise SystemExit("G026 role-management anchor count drifted")
if source.startswith(begin) or source.count(grant) or source.count(revoke) or source.count(postcondition) or source.endswith(commit):
    raise SystemExit("G026 role-management source transform bytes drifted")
if public_schema_grant:
    if (not public_schema_revoke or not public_schema_precondition or not public_schema_postcondition
            or source.count(public_schema_grant_anchor) != 1
            or source.count(public_schema_target_owner_anchor) != 1
            or source.count(public_schema_grant) or source.count(public_schema_revoke)
            or source.count(public_schema_precondition) or source.count(public_schema_postcondition)):
        raise SystemExit("G026 public-schema compatibility binding drifted")
transformed = begin + source.replace(removed, b"", 1)
transformed = transformed.replace(role_anchor, role_anchor + grant, 1)
if public_schema_grant:
    transformed = transformed.replace(public_schema_grant_anchor, public_schema_precondition + public_schema_grant + public_schema_grant_anchor, 1)
if binding["filename"] == "20260713002000_g014_public_api_private_boundary.sql":
    final_anchor = binding["finalContractTerminator"].encode("ascii") + b"\n"
    invocation = binding["removedFinalContractInvocation"].encode("ascii")
    if (transformed.count(final_anchor) != 1
            or transformed.count(invocation) != binding["removedFinalContractInvocationCount"]
            or not relocated_final_contract):
        raise SystemExit("G026 role-management final-contract anchor drifted")
    transformed = transformed.replace(invocation, b"", 1)
    transformed = transformed.replace(final_anchor, final_anchor + private_schema_usage_grant + private_function_execute_grant + bridge_membership_revoke + postcondition + relocated_final_contract + cleanup_membership_grant + private_function_execute_revoke + private_schema_usage_revoke + cleanup_membership_revoke + postcondition + private_privilege_postcondition, 1)
else:
    transformed = transformed.replace(revoke_anchor, public_schema_revoke + public_schema_postcondition + revoke + postcondition + revoke_anchor, 1)
transformed = transformed.replace(notify_anchor, notify_anchor + commit, 1)
if (transformed.count(begin) != 1 or transformed.count(grant) != (2 if bridge_membership_grant else 1)
        or transformed.count(revoke) != (2 if bridge_membership_revoke else 1)
        or transformed.count(postcondition) != (2 if bridge_membership_revoke else 1)
        or transformed.count(commit) != 1
        or (public_schema_grant and (transformed.count(public_schema_grant) != 1
            or transformed.count(public_schema_revoke) != 1
            or transformed.count(public_schema_precondition) != 1
            or transformed.count(public_schema_postcondition) != 1))
        or (private_schema_usage_grant and (transformed.count(private_schema_usage_grant) != 1
            or transformed.count(private_function_execute_grant) != 1
            or transformed.count(private_function_execute_revoke) != 1
            or transformed.count(private_schema_usage_revoke) != 1
            or transformed.count(private_privilege_postcondition) != 1))):
    raise SystemExit("G026 role-management transform statement count drifted")
if (transformed.find(begin) != 0
        or transformed.find(grant) != transformed.find(role_anchor) + len(role_anchor)
        or transformed.find(commit) != transformed.find(notify_anchor) + len(notify_anchor)
        or (bridge_membership_revoke and (
            transformed.find(private_schema_usage_grant) <= transformed.find(grant)
            or transformed.find(private_function_execute_grant) != transformed.find(private_schema_usage_grant) + len(private_schema_usage_grant)
            or transformed.find(bridge_membership_revoke) != transformed.find(private_function_execute_grant) + len(private_function_execute_grant)
            or transformed.find(postcondition) != transformed.find(bridge_membership_revoke) + len(bridge_membership_revoke)
            or transformed.find(relocated_final_contract) != transformed.find(postcondition) + len(postcondition)
            or transformed.rfind(cleanup_membership_grant) != transformed.find(relocated_final_contract) + len(relocated_final_contract)
            or transformed.find(private_function_execute_revoke) != transformed.rfind(cleanup_membership_grant) + len(cleanup_membership_grant)
            or transformed.find(private_schema_usage_revoke) != transformed.find(private_function_execute_revoke) + len(private_function_execute_revoke)
            or transformed.rfind(cleanup_membership_revoke) != transformed.find(private_schema_usage_revoke) + len(private_schema_usage_revoke)
            or transformed.rfind(postcondition) != transformed.rfind(cleanup_membership_revoke) + len(cleanup_membership_revoke)
            or transformed.find(private_privilege_postcondition) != transformed.rfind(postcondition) + len(postcondition)
            or transformed.find(private_privilege_postcondition) >= transformed.find(notify_anchor)))
        or (not bridge_membership_revoke and (
            transformed.find(revoke) >= transformed.find(notify_anchor)
            or transformed.find(postcondition) != transformed.find(revoke) + len(revoke)))
        or (public_schema_grant and (transformed.find(public_schema_precondition) != transformed.find(public_schema_grant) - len(public_schema_precondition)
            or transformed.find(public_schema_grant) != transformed.find(public_schema_grant_anchor) - len(public_schema_grant)
            or transformed.find(public_schema_target_owner_anchor) <= transformed.find(public_schema_grant_anchor)
            or transformed.find(public_schema_revoke) <= transformed.find(public_schema_target_owner_anchor)
            or transformed.find(public_schema_revoke) >= transformed.find(revoke)
            or transformed.find(public_schema_postcondition) != transformed.find(public_schema_revoke) + len(public_schema_revoke)
            or transformed.find(public_schema_postcondition) >= transformed.find(revoke)))):
    raise SystemExit("G026 role-management transform ordering drifted")
if (b"ADMIN OPTION" in transformed or b"GRANT privacy_workflow_owner TO supabase_admin" in transformed
        or b"SET ROLE" in transformed or b"GRANT CREATE ON SCHEMA public TO PUBLIC" in transformed):
    raise SystemExit("G026 role-management privilege drifted")
if hashlib.sha256(transformed).hexdigest() != binding["transformedSha256"]:
    raise SystemExit("G026 role-management transformed hash mismatch")
target.write_bytes(transformed)
' "$source" "$transformed" "$(jq -c --arg filename "$filename" '.roleManagementReplayTransform as $transform | $transform.files[] | select(.filename == $filename) + {beginStatement: $transform.beginStatement, grantStatement: $transform.grantStatement, revokeStatement: $transform.revokeStatement, commitStatement: $transform.commitStatement, removedStatement: $transform.removedStatement}' "$g026_bundle")" "$(jq -er '.roleManagementReplayTransform.postcondition' "$g026_bundle")" || exit 1
  transformed_hash=$(sha256sum -- "$transformed" | cut -d' ' -f1)
  [[ "$transformed_hash" == "$expected_transformed_hash" ]] || { printf 'G026 role-management transformed hash mismatch: %s\n' "$filename" >&2; exit 1; }
  printf '%s\n' "$transformed"
}
g026_apply_replay_membership_window() {
  local source=$1 filename transformed
  filename=${source##*/}
  transformed="$work_dir/g026-replay-membership-$filename"
  python3 "$repo_root/backend/supabase/scripts/transform_g026_replay_membership.py" \
    --bundle "$g026_bundle" \
    --source "$source" \
    --output "$transformed" || exit 1
  printf '%s\n' "$transformed"
}
g026_chain_apply() {
  local phase=$1 source=$2 source_hash
  source_hash=$(sha256sum -- "$source" | cut -d' ' -f1)
  previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" "$phase" "$source_hash" | sha256sum | cut -d' ' -f1)
  printf '%s  %s  %s\n' "$previous_hash" "$source_hash" "$phase" >>"$chain_file"
}
g016_apply_catalog_assertion_membership_window() {
  local source=$1 filename transformed
  filename=${source##*/}
  transformed="$work_dir/g016-catalog-assertion-membership-$filename"
  python3 - "$source" "$transformed" <<'PY'
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
sql = source.read_text(encoding="utf-8")
needle = """SET LOCAL ROLE privacy_workflow_owner;
SELECT privacy_retention.assert_g014_catalog_contract();
RESET ROLE;"""
replacement = """SET LOCAL ROLE privacy_workflow_owner;
CREATE OR REPLACE FUNCTION pg_temp.g016_catalog_assertion_bridge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
END
$bridge$;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres;
SELECT pg_temp.g016_catalog_assertion_bridge();"""
if sql.count(needle) != 1:
    raise SystemExit(f"expected one G016 catalog assertion block in {source}")
output.write_text(
    "BEGIN;\n"
    "GRANT privacy_workflow_owner TO postgres;\n"
    + sql.replace(needle, replacement)
    + "\nCOMMIT;\n",
    encoding="utf-8",
)
PY
  printf '%s\n' "$transformed"
}
g026_apply_transition() {
  g026_chain_apply 'g026-phase-a-after-ordinal-2' "$g026_transition"
  compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$g026_transition"
}
g026_apply_repairs() {
  local phase=$1 validation
  validation=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c 'SHOW check_function_bodies;')
  [[ "$validation" == on ]] || { printf 'G026 repairs require function-body validation on\n' >&2; exit 1; }
  g026_chain_apply "$phase" "$g026_repairs"
  compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$g026_repairs"
}
catalog_projection_hash() {
  local projection_hash
  projection_hash=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c "
    SELECT encode(digest(COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
      'definition', pg_get_viewdef(c.oid, true)
    ) ORDER BY n.nspname, c.relname, c.relkind)::text, '[]'), 'sha256'), 'hex')
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');")
  [[ "$projection_hash" =~ ^[0-9a-f]{64}$ ]] || {
    printf 'canonical public-catalog projection is unavailable\n' >&2
    exit 1
  }
  printf '%s\n' "$projection_hash"
}
overlap_report="$staging_dir/pre-20260214-overlap-classification.jsonl"
: >"$overlap_report"
reconstruction_replay_count=0
expected_ordinal=0
mapfile -t reconstruction_member_rows <"$reconstruction_members"
for reconstruction_member_row in "${reconstruction_member_rows[@]}"; do
  IFS=$'\t' read -r ordinal member_path member_hash extracted <<<"$reconstruction_member_row"
  [[ "$extracted" == "reconstruction-sources/$(printf '%02d' "$ordinal").sql" ]] || {
    printf 'reconstruction member evidence path is noncanonical\n' >&2
    exit 1
  }
  extracted="$reconstruction_extract_dir/$(printf '%02d' "$ordinal").sql"
  [[ "$ordinal" == "$expected_ordinal" && -s "$extracted" ]] || {
    printf 'reconstruction member order or extraction is invalid\n' >&2
    exit 1
  }
  before_projection_hash=$(catalog_projection_hash)
  previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" "reconstruction-member-$ordinal:$member_path" "$member_hash" | sha256sum | cut -d' ' -f1)
  printf '%s  %s  reconstruction-member-%s:%s\n' "$previous_hash" "$member_hash" "$ordinal" "$member_path" >>"$chain_file"
  if [[ "$ordinal" == 0 ]]; then
    function_body_validation=$(compose exec -T -e PGOPTIONS='-c check_function_bodies=off' db \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c 'SHOW check_function_bodies;')
    [[ "$function_body_validation" == off ]] || {
      printf 'historical baseline function-body validation could not be deferred\n' >&2
      exit 1
    }
    compose exec -T -e PGOPTIONS='-c check_function_bodies=off' db \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$reconstruction_relocation_source"
    compose exec -T -e PGOPTIONS='-c check_function_bodies=off' db \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$extracted"
  elif [[ "$ordinal" == 6 ]]; then
    function_body_validation=$(compose exec -T -e PGOPTIONS='-c check_function_bodies=off' db \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c 'SHOW check_function_bodies;')
    [[ "$function_body_validation" == off ]] || {
      printf 'G026 ordinal-6 function-body validation quarantine could not be established\n' >&2
      exit 1
    }
    compose exec -T -e PGOPTIONS='-c check_function_bodies=off' db \
      psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$extracted"
  else
    compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$extracted"
  fi
  after_projection_hash=$(catalog_projection_hash)
  classification=unchanged
  [[ "$before_projection_hash" == "$after_projection_hash" ]] || classification=changed
  jq -cn --argjson ordinal "$ordinal" --arg path "$member_path" --arg source_hash "$member_hash" \
    --arg before_projection_hash "$before_projection_hash" --arg after_projection_hash "$after_projection_hash" \
    --arg classification "$classification" \
    '{ordinal:$ordinal,path:$path,source_hash:$source_hash,before_canonical_public_catalog_projection_hash:$before_projection_hash,after_canonical_public_catalog_projection_hash:$after_projection_hash,classification:$classification}' >>"$overlap_report"
  if [[ "$ordinal" == 2 ]]; then
    g026_apply_transition
  fi
  ((reconstruction_replay_count += 1))
  ((expected_ordinal += 1))
done
[[ "$reconstruction_replay_count" == 10 && "$expected_ordinal" == 10 && $(wc -l <"$overlap_report" | tr -d '[:space:]') == 10 ]] || {
  printf 'reconstruction members were not replayed exactly once\n' >&2
  exit 1
}
jq -e -s 'length == 10 and
  [.[].ordinal] == [0,1,2,3,4,5,6,7,8,9] and
  all(.[]; (keys | sort) == ["after_canonical_public_catalog_projection_hash","before_canonical_public_catalog_projection_hash","classification","ordinal","path","source_hash"] and
    (.classification == "changed" or .classification == "unchanged") and
    (.source_hash | test("^[0-9a-f]{64}$")) and
    (.before_canonical_public_catalog_projection_hash | test("^[0-9a-f]{64}$")) and
    (.after_canonical_public_catalog_projection_hash | test("^[0-9a-f]{64}$")))' "$overlap_report" >/dev/null
g026_phase_b_applied=0
previous_effective_filename=''
for migration in "${effective_migrations[@]}"; do
  canonical_path=${migration#"$repo_root"/}
  if [[ ${migration##*/} == '20260713002000_g014_public_api_private_boundary.sql' ]]; then
    g026_apply_repairs 'g026-phase-b-before-20260713002000_g014_public_api_private_boundary.sql'
    ((g026_phase_b_applied += 1))
  fi
  file_hash=$(sha256sum -- "$migration" | cut -d' ' -f1)
  previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" "$canonical_path" "$file_hash" | sha256sum | cut -d' ' -f1)
  printf '%s  %s  %s\n' "$previous_hash" "$file_hash" "$canonical_path" >>"$chain_file"
  case "${migration##*/}" in
    20260903174413_advisor_followup_hardening.sql)
      advisor_prerequisites="$staging_dir/advisor-prerequisites.sql"
      python3 "$script_dir/recover_advisor_replay_prerequisites.py" \
        --source "$baselines_dir/local/application-prerequisites.sql" \
        --output "$advisor_prerequisites" \
        --receipt "$staging_dir/advisor-prerequisite-recovery.json"
      g026_chain_apply "advisor-current-prerequisites" "$advisor_prerequisites"
      cat -- "$advisor_prerequisites" "$migration" |
        compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres --single-transaction -f -
      ;;
    20260713000450_g013_address_admin_approval.sql|20260713002000_g014_public_api_private_boundary.sql)
      transformed_migration=$(g026_apply_role_management_transform "$migration")
      g026_chain_apply "role-management-transform:${migration##*/}" "$transformed_migration"
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$transformed_migration"
      ;;
    20260713002100_g014_privacy_workflows.sql|20260713002200_g014_marketing_state_machine.sql|20260713002300_g014_account_deletion_state_machine.sql|20260713002400_g014_retention_adapters_receipts.sql|20260713002500_g014_catalog_contract.sql|20260713002600_g014_account_deletion_receipt_parity.sql|20260812000200_local_public_read_policy_convergence.sql|20260812000300_local_admin_data_boundary_convergence.sql|20260812000400_local_admin_map_overlay_boundary_convergence.sql)
      transformed_migration=$(g026_apply_replay_membership_window "$migration")
      g026_chain_apply "replay-membership-window:${migration##*/}" "$transformed_migration"
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$transformed_migration"
      ;;
    20260801000300_g016_onboarding_allowlist_freshness.sql)
      transformed_migration=$(g016_apply_catalog_assertion_membership_window "$migration")
      g026_chain_apply "g016-catalog-assertion-membership-window:${migration##*/}" "$transformed_migration"
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$transformed_migration"
      ;;
    20260827084200_g014_8_guardian_provider_verification.sql)
      transformed_migration="$work_dir/g014-guardian-replay.sql"
      python3 "$script_dir/transform_g014_guardian_replay.py" \
        --source "$migration" --output "$transformed_migration"
      g026_chain_apply "guardian-replay-assertion-window:${migration##*/}" "$transformed_migration"
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$transformed_migration"
      ;;
    20260813085342_current_profile_mutation_boundary.sql)
      self_contained_path=$(jq -er '.selfContainedReplay.canonicalPath' "$g026_bundle")
      self_contained_filename=$(jq -er '.selfContainedReplay.filename' "$g026_bundle")
      self_contained_predecessor=$(jq -er '.selfContainedReplay.predecessorFilename' "$g026_bundle")
      self_contained_hash=$(jq -er '.selfContainedReplay.sourceSha256' "$g026_bundle")
      self_contained_bytes=$(jq -er '.selfContainedReplay.sourceByteLength' "$g026_bundle")
      self_contained_transaction=$(jq -er '.selfContainedReplay.transactionClass' "$g026_bundle")
      [[ "$canonical_path" == "$self_contained_path"
         && ${migration##*/} == "$self_contained_filename"
         && "$self_contained_predecessor" == '20260812000700_local_profile_leaderboard_page_convergence.sql'
         && "$file_hash" == "$self_contained_hash"
         && $(wc -c <"$migration" | tr -d '[:space:]') == "$self_contained_bytes"
         && "$self_contained_transaction" == 'self_committing' ]] || {
        printf 'G026 self-contained terminal replay binding drifted\n' >&2
        exit 1
      }
      [[ "$previous_effective_filename" == "$self_contained_predecessor" ]] || {
        printf 'G026 self-contained terminal replay predecessor drifted\n' >&2
        exit 1
      }
      g026_chain_apply "self-contained-replay:${migration##*/}" "$migration"
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$migration"
      ;;
    *)
      compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$migration"
      ;;
  esac
  previous_effective_filename=${migration##*/}
  if [[ ${migration##*/} == '20260531084516_tighten_public_table_data_api_grants.sql' ]]; then
    compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <<'SQL' >/dev/null
DO $$
DECLARE
  workflow_tables text[] := ARRAY['admin_workflow_runs', 'admin_workflow_steps', 'admin_workflow_signals'];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(workflow_tables)
      AND (
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      )
  ) THEN
    RAISE EXCEPTION 'admin workflow table grants do not match immutable grant migration';
  END IF;
END $$;
SQL
  fi
done
[[ "$g026_phase_b_applied" == 1 ]] || {
  printf 'G026 phase-B slot was not applied exactly once\n' >&2
  exit 1
}
jq -c '{schemaVersion,purpose,reconstructionAuthorized,transition,repairs,validationLedger,slots,roleManagementReplayTransform,replayMembershipWindows,selfContainedReplay,canonicalBodyHashes,apiMatrix,extensionFingerprint}' "$g026_bundle" >"$g026_semantic_receipt"
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c "
  SELECT jsonb_build_object(
    'extensions', (SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension WHERE extname IN ('vector','fuzzystrmatch','pgcrypto')),
    'functions', (SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('approve_submission_item','approve_restaurant','approve_edit_submission_item','approve_new_restaurant_submission','insert_restaurant_from_jsonl','batch_insert_restaurants_from_jsonl')),
    'probeAbsent', to_regclass('public.g026_hnsw_probe_vectors') IS NULL AND to_regclass('public.g026_hnsw_probe_vectors_embedding_hnsw_idx') IS NULL,
    'privacyWorkflowOwnerPostRevoke', jsonb_build_object('exists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'privacy_workflow_owner'), 'hardened', COALESCE((SELECT bool_and(NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolcanlogin)) FROM pg_roles WHERE rolname = 'privacy_workflow_owner'), false), 'membershipCount', (SELECT count(*) FROM pg_auth_members AS membership WHERE membership.roleid = 'privacy_workflow_owner'::regrole OR membership.member = 'privacy_workflow_owner'::regrole), 'bridgeMembershipOnly', (SELECT count(*) = 1 AND bool_and(membership.roleid = 'privacy_workflow_owner'::regrole AND membership.member = 'privacy_auth_bridge'::regrole) FROM pg_auth_members AS membership WHERE membership.roleid = 'privacy_workflow_owner'::regrole OR membership.member = 'privacy_workflow_owner'::regrole))
  );" >"$g026_readback_receipt"
compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At <<'SQL' >"$g026_behavior_receipt"
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SELECT jsonb_build_object('emptyBatch', to_jsonb(public.batch_insert_restaurants_from_jsonl(ARRAY[]::jsonb[])));
ROLLBACK;
SQL
jq -e '.extensions == ["fuzzystrmatch","pgcrypto","vector"] and (.functions | length == 6) and .probeAbsent == true and .privacyWorkflowOwnerPostRevoke == {"exists":true,"hardened":true,"membershipCount":1,"bridgeMembershipOnly":true}' "$g026_readback_receipt" >/dev/null
jq -e '.emptyBatch == {"inserted_count":0,"updated_count":0,"failed_count":0,"failed_records":[]}' "$g026_behavior_receipt" >/dev/null
for receipt in "$g026_semantic_receipt" "$g026_readback_receipt" "$g026_behavior_receipt"; do
  receipt_hash=$(sha256sum -- "$receipt" | cut -d' ' -f1)
  receipt_name="generated/${receipt##*/}"
  previous_hash=$(printf '%s  %s  %s\n' "$previous_hash" "$receipt_name" "$receipt_hash" | sha256sum | cut -d' ' -f1)
  printf '%s  %s  %s\n' "$previous_hash" "$receipt_hash" "$receipt_name" >>"$chain_file"
done
for receipt in "$g026_semantic_receipt" "$g026_readback_receipt" "$g026_behavior_receipt"; do
  printf '%s  generated/%s\n' "$(sha256sum -- "$receipt" | cut -d' ' -f1)" "${receipt##*/}" >>"$initialization_inputs"
done
initialization_inputs_hash=$(sha256sum -- "$initialization_inputs" | cut -d' ' -f1)

final_catalog_assertion_window="$work_dir/g026-final-catalog-assertion-window.sql"
{
  printf 'BEGIN;\n'
  jq -er '.replayMembershipWindows.precondition' "$g026_bundle"
  jq -er '.replayMembershipWindows.grantStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.catalogSchemaUsageGrantStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.catalogFunctionExecuteGrantStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.revokeStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.postcondition' "$g026_bundle"
  printf 'SELECT privacy_retention.assert_g014_catalog_contract();\n'
  jq -er '.replayMembershipWindows.cleanupMembershipGrantStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.catalogFunctionExecuteRevokeStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.catalogSchemaUsageRevokeStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.cleanupMembershipRevokeStatement' "$g026_bundle"
  jq -er '.replayMembershipWindows.postcondition' "$g026_bundle"
  jq -er '.replayMembershipWindows.catalogPrivilegePostcondition' "$g026_bundle"
  printf 'COMMIT;\n'
} >"$final_catalog_assertion_window"
g026_chain_apply 'g026-final-catalog-assertion-window' "$final_catalog_assertion_window"
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$final_catalog_assertion_window" >/dev/null
g028_reauth_bridge_window="$work_dir/g028-account-deletion-reauth-bridge-window.sql"
{
  printf 'GRANT privacy_auth_bridge TO postgres;\n'
  cat -- "$g028_reauth_test"
  printf '\nREVOKE privacy_auth_bridge FROM postgres;\n'
  cat <<'SQL'
DO $$ BEGIN
  IF pg_catalog.pg_has_role('postgres', 'privacy_auth_bridge', 'MEMBER') THEN
    RAISE EXCEPTION 'G028 bridge membership cleanup failed';
  END IF;
END $$;
SQL
} >"$g028_reauth_bridge_window"
compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres <"$g028_reauth_bridge_window" >/dev/null
jsonl="$staging_dir/catalog-manifest.jsonl"
tuple_evidence="$staging_dir/catalog-manifest-tuples.sql"
order_sql='ORDER BY manifest_kind COLLATE "C", manifest_key::text COLLATE "C", manifest_value::text COLLATE "C"'
g026_capture_owner_catalog_query() {
  local phase=$1 query=$2 output=$3 query_window
  query_window="$work_dir/$phase.sql"
  {
    printf 'BEGIN;\n'
    jq -er '.replayMembershipWindows.precondition' "$g026_bundle"
    jq -er '.replayMembershipWindows.grantStatement' "$g026_bundle"
    printf 'SET LOCAL ROLE privacy_workflow_owner;\n%s\nRESET ROLE;\n' "$query"
    jq -er '.replayMembershipWindows.revokeStatement' "$g026_bundle"
    jq -er '.replayMembershipWindows.postcondition' "$g026_bundle"
    printf 'COMMIT;\n'
  } >"$query_window"
  g026_chain_apply "$phase" "$query_window"
  compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At <"$query_window" >"$output"
}
g026_capture_owner_catalog_query \
  'g026-catalog-jsonl-readback-window' \
  "SELECT jsonb_build_object('manifest_kind', manifest_kind, 'manifest_key', manifest_key, 'manifest_value', manifest_value)::text FROM privacy_retention.g014_catalog_manifest_rows() $order_sql;" \
  "$jsonl"
g026_capture_owner_catalog_query \
  'g026-catalog-tuple-readback-window' \
  "SELECT format('(%L, %L::jsonb, %L::jsonb)', manifest_kind, manifest_key::text, manifest_value::text) FROM privacy_retention.g014_catalog_manifest_rows() $order_sql;" \
  "$tuple_evidence"
jq -er '.replayMembershipWindows.finalZeroMembershipProof' "$g026_bundle" |
  compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null
jq -e -s 'length > 0 and all(.[]; type == "object" and (keys == ["manifest_key", "manifest_kind", "manifest_value"]))' "$jsonl" >/dev/null
cp -- "$reconstruction_archive" "$staging_dir/RECONSTRUCTION_SOURCES.v1.zip"
cp -- "$reconstruction_manifest" "$staging_dir/RECONSTRUCTION_SOURCES.v1.json"
cp -- "$storage_inventory" "$staging_dir/STORAGE_TENANT_MIGRATIONS.v1.json"
cp -- "$gotrue_manifest" "$staging_dir/GOTRUE_PLATFORM.v1.json"
cp -- "$gotrue_inventory" "$staging_dir/GOTRUE_MIGRATIONS.v1.json"
cp -- "$bootstrap_manifest" "$staging_dir/BOOTSTRAP_SOURCES.v1.json"
cp -- "$platform_auth_bootstrap" "$staging_dir/00000000000001-auth-schema.sql"
overlap_report_hash=$(sha256sum -- "$overlap_report" | cut -d' ' -f1)
gotrue_ledger_hash=$(sha256sum -- "$gotrue_ledger_evidence" | cut -d' ' -f1)
gotrue_expected_ledger_hash=$(sha256sum -- "$gotrue_expected_ledger_evidence" | cut -d' ' -f1)
gotrue_file_hash=$(sha256sum -- "$gotrue_file_evidence" | cut -d' ' -f1)
gotrue_inventory_file_hash=$(sha256sum -- "$gotrue_inventory_file_evidence" | cut -d' ' -f1)
storage_ledger_hash=$(sha256sum -- "$storage_ledger_evidence" | cut -d' ' -f1)
storage_native_source_map_hash=$(sha256sum -- "$storage_native_source_map" | cut -d' ' -f1)
storage_native_file_expected_ledger_hash=$(sha256sum -- "$storage_native_file_expected_ledger" | cut -d' ' -f1)
storage_inventory_source_map_hash=$(sha256sum -- "$storage_inventory_source_map" | cut -d' ' -f1)
storage_file_hash=$(sha256sum -- "$storage_file_evidence" | cut -d' ' -f1)
platform_auth_expected_ledger_hash=$(sha256sum -- "$platform_auth_expected_ledger_evidence" | cut -d' ' -f1)
auth_expected_ledger_hash=$(sha256sum -- "$auth_expected_ledger_evidence" | cut -d' ' -f1)
auth_ledger_hash=$(sha256sum -- "$auth_ledger_evidence" | cut -d' ' -f1)
g026_bundle_hash=$(sha256sum -- "$g026_bundle_evidence" | cut -d' ' -f1)
g026_transition_hash=$(sha256sum -- "$g026_transition_evidence" | cut -d' ' -f1)
g026_repairs_hash=$(sha256sum -- "$g026_repairs_evidence" | cut -d' ' -f1)
g026_semantic_receipt_hash=$(sha256sum -- "$g026_semantic_receipt" | cut -d' ' -f1)
g026_readback_receipt_hash=$(sha256sum -- "$g026_readback_receipt" | cut -d' ' -f1)
g026_behavior_receipt_hash=$(sha256sum -- "$g026_behavior_receipt" | cut -d' ' -f1)
g026_slots=$(jq -c '.slots' "$g026_bundle")
g026_validation_ledger=$(jq -c '.validationLedger' "$g026_bundle")

jsonl_hash=$(sha256sum -- "$jsonl" | cut -d' ' -f1)
tuple_hash=$(sha256sum -- "$tuple_evidence" | cut -d' ' -f1)
chain_hash=$(sha256sum -- "$chain_file" | cut -d' ' -f1)
source_sha=$(git -C "$repo_root" rev-parse HEAD)
resolved_image_id=$(docker_local image inspect "$db_image" --format '{{.Id}}')
resolved_image_digest=$(docker_local image inspect "$db_image" --format '{{index .RepoDigests 0}}')
server_version=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c 'SHOW server_version;')
row_count=$(wc -l <"$jsonl" | tr -d '[:space:]')
reconstruction_entries=$(jq -c '.entries' "$reconstruction_manifest")
reconstruction_compatibility_exclusions=$(jq -c '.compatibilityExclusions' "$reconstruction_manifest")
reconstruction_compatibility_relocations=$(jq -c '.compatibilityRelocations' "$reconstruction_manifest")
jq -n --arg source_sha "$source_sha" --arg migration_chain_sha256 "$chain_hash" \
  --arg jsonl_sha256 "$jsonl_hash" --arg tuple_evidence_sha256 "$tuple_hash" \
  --arg declared_image "$db_image" --arg resolved_image_id "$resolved_image_id" \
  --arg resolved_image_digest "$resolved_image_digest" --arg server_version "$server_version" \
  --arg storage_declared_image "$storage_image" --arg storage_index_digest "$storage_index_digest" \
  --arg storage_amd64_manifest_digest "$storage_amd64_manifest_digest" --arg storage_resolved_image_id "$storage_resolved_image_id" \
  --arg storage_resolved_repo_digests "$storage_resolved_repo_digests" --arg storage_inventory_sha256 "$storage_inventory_sha256" \
  --arg storage_ledger_sha256 "$storage_ledger_hash" --arg storage_native_source_map_sha256 "$storage_native_source_map_hash" --arg storage_inventory_source_map_sha256 "$storage_inventory_source_map_hash" --arg storage_native_file_expected_ledger_sha256 "$storage_native_file_expected_ledger_hash" --arg storage_container_files_sha256 "$storage_file_hash" \
  --arg gotrue_declared_image "$gotrue_image" --arg gotrue_index_digest "$gotrue_index_digest" --arg gotrue_amd64_manifest_digest "$gotrue_amd64_manifest_digest" --arg gotrue_resolved_image_id "$gotrue_resolved_image_id" --arg gotrue_resolved_repo_digests "$gotrue_resolved_repo_digests" --arg gotrue_manifest_sha256 "$gotrue_manifest_sha256" --arg gotrue_inventory_sha256 "$gotrue_inventory_sha256" --arg gotrue_ledger_sha256 "$gotrue_ledger_hash" --arg gotrue_expected_ledger_sha256 "$gotrue_expected_ledger_hash" --arg gotrue_container_files_sha256 "$gotrue_file_hash" --arg gotrue_inventory_files_sha256 "$gotrue_inventory_file_hash" \
  --arg psql_client_version "$psql_client_version" --arg partition_version "$partition_version" \
  --arg reconstruction_archive_sha256 "$reconstruction_archive_sha256" --arg reconstruction_manifest_sha256 "$reconstruction_manifest_sha256" \
  --arg reconstruction_members_sha256 "$reconstruction_members_hash" --arg reconstruction_compatibility_exclusions_sha256 "$reconstruction_exclusions_hash" --arg reconstruction_compatibility_relocations_sha256 "$reconstruction_relocations_hash" --arg overlap_report_sha256 "$overlap_report_hash" \
  --arg evidence_scope "$reconstruction_purpose" --argjson reconstruction_authorized false --argjson reconstruction_entries "$reconstruction_entries" --argjson reconstruction_compatibility_exclusions "$reconstruction_compatibility_exclusions" --argjson reconstruction_compatibility_relocations "$reconstruction_compatibility_relocations" \
  --arg platform_auth_inventory_sha256 "$platform_auth_inventory_sha256" --arg platform_auth_source_sha256 "$platform_auth_source_sha256" --arg platform_auth_image_sha256 "$platform_auth_image_sha256" --arg platform_auth_expected_ledger_sha256 "$platform_auth_expected_ledger_hash" --arg auth_expected_ledger_sha256 "$auth_expected_ledger_hash" --arg auth_ledger_sha256 "$auth_ledger_hash" \
  --arg initialization_inputs_sha256 "$initialization_inputs_hash" --arg g026_bundle_sha256 "$g026_bundle_hash" --arg g026_transition_sha256 "$g026_transition_hash" --arg g026_repairs_sha256 "$g026_repairs_hash" --arg g026_validation_ledger_sha256 "$g026_validation_ledger_hash" --arg g026_semantic_receipt_sha256 "$g026_semantic_receipt_hash" --arg g026_readback_receipt_sha256 "$g026_readback_receipt_hash" --arg g026_behavior_receipt_sha256 "$g026_behavior_receipt_hash" --argjson g026_slots "$g026_slots" --argjson g026_validation_ledger "$g026_validation_ledger" --argjson row_count "$row_count" \
  '{source_sha:$source_sha,migration_chain_sha256:$migration_chain_sha256,jsonl_sha256:$jsonl_sha256,tuple_evidence_sha256:$tuple_evidence_sha256,declared_image:$declared_image,resolved_image_id:$resolved_image_id,resolved_image_digest:$resolved_image_digest,storage_declared_image:$storage_declared_image,storage_index_digest:$storage_index_digest,storage_amd64_manifest_digest:$storage_amd64_manifest_digest,storage_resolved_image_id:$storage_resolved_image_id,storage_resolved_repo_digests:$storage_resolved_repo_digests,storage_inventory_sha256:$storage_inventory_sha256,storage_ledger_sha256:$storage_ledger_sha256,storage_native_source_map_sha256:$storage_native_source_map_sha256,storage_inventory_source_map_sha256:$storage_inventory_source_map_sha256,storage_native_file_expected_ledger_sha256:$storage_native_file_expected_ledger_sha256,storage_container_files_sha256:$storage_container_files_sha256,gotrue_declared_image:$gotrue_declared_image,gotrue_index_digest:$gotrue_index_digest,gotrue_amd64_manifest_digest:$gotrue_amd64_manifest_digest,gotrue_resolved_image_id:$gotrue_resolved_image_id,gotrue_resolved_repo_digests:$gotrue_resolved_repo_digests,gotrue_manifest_sha256:$gotrue_manifest_sha256,gotrue_inventory_sha256:$gotrue_inventory_sha256,gotrue_ledger_sha256:$gotrue_ledger_sha256,gotrue_expected_ledger_sha256:$gotrue_expected_ledger_sha256,gotrue_container_files_sha256:$gotrue_container_files_sha256,gotrue_inventory_files_sha256:$gotrue_inventory_files_sha256,server_version:$server_version,psql_client_version:$psql_client_version,partition_version:$partition_version,reconstruction_archive_sha256:$reconstruction_archive_sha256,reconstruction_manifest_sha256:$reconstruction_manifest_sha256,reconstruction_members_sha256:$reconstruction_members_sha256,reconstruction_compatibility_exclusions_sha256:$reconstruction_compatibility_exclusions_sha256,reconstruction_compatibility_relocations_sha256:$reconstruction_compatibility_relocations_sha256,reconstruction_entries:$reconstruction_entries,reconstruction_compatibility_exclusions:$reconstruction_compatibility_exclusions,reconstruction_compatibility_relocations:$reconstruction_compatibility_relocations,overlap_report_sha256:$overlap_report_sha256,evidence_scope:$evidence_scope,reconstruction_authorized:$reconstruction_authorized,platform_auth_inventory_sha256:$platform_auth_inventory_sha256,platform_auth_source_sha256:$platform_auth_source_sha256,platform_auth_image_sha256:$platform_auth_image_sha256,platform_auth_expected_ledger_sha256:$platform_auth_expected_ledger_sha256,auth_expected_ledger_sha256:$auth_expected_ledger_sha256,auth_ledger_sha256:$auth_ledger_sha256,initialization_inputs_sha256:$initialization_inputs_sha256,g026_bundle_sha256:$g026_bundle_sha256,g026_transition_sha256:$g026_transition_sha256,g026_repairs_sha256:$g026_repairs_sha256,g026_validation_ledger_sha256:$g026_validation_ledger_sha256,g026_semantic_receipt_sha256:$g026_semantic_receipt_sha256,g026_readback_receipt_sha256:$g026_readback_receipt_sha256,g026_behavior_receipt_sha256:$g026_behavior_receipt_sha256,g026_slots:$g026_slots,g026_validation_ledger:$g026_validation_ledger,row_count:$row_count}' >"$staging_dir/metadata.json"

(
  cd -- "$staging_dir"
  printf '%s\n' \
    00000000000001-auth-schema.sql BOOTSTRAP_SOURCES.v1.json \
    G026_RECONSTRUCTION_BUNDLE.v4.json G026_RECONSTRUCTION_REPAIRS.v4.sql G026_RECONSTRUCTION_TRANSITION.v4.sql \
    GOTRUE_MIGRATIONS.v1.json GOTRUE_PLATFORM.v1.json RECONSTRUCTION_SOURCES.v1.json RECONSTRUCTION_SOURCES.v1.zip \
    STORAGE_TENANT_MIGRATIONS.v1.json artifact-manifest.txt auth-schema-migrations.expected.tsv auth-schema-migrations.tsv \
    catalog-manifest-tuples.sql catalog-manifest.jsonl duplicate-migration-source-pairs.sha256 evidence-scope.txt g026-behavior-receipt.json \
    g026-readback-receipt.json g026-semantic-receipt.json g026-validation-ledger.json gotrue-container-migration-files.tsv \
    gotrue-inventory-files.tsv gotrue-schema-migrations.expected.tsv gotrue-schema-migrations.tsv initialization-inputs.sha256 \
    metadata.json migration-chain.txt platform-auth-schema-migrations.expected.tsv platform-auth-schema-migrations.manifest.tsv \
    advisor-prerequisite-recovery.json advisor-prerequisites.sql \
    postgres-image-00000000000001-auth-schema.sql pre-20260214-overlap-classification.jsonl \
    reconstruction-compatibility-exclusions.jsonl reconstruction-compatibility-relocations.jsonl reconstruction-source-members.tsv \
    storage-container-migration-files.tsv storage-inventory-files.tsv storage-migration-inventory-source-map.tsv storage-migration-ledger.tsv \
    storage-migration-native-file-ledger.expected.tsv storage-migration-native-source-map.tsv |
    LC_ALL=C sort >artifact-manifest.txt
  while IFS= read -r artifact; do
    sha256sum -- "$artifact"
  done <artifact-manifest.txt >SHA256SUMS
)

mv -- "$staging_dir" "$output_dir"
printf 'generated source-only evidence in %s\n' "$output_dir"
