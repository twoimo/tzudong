#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077
ROOT="$(/usr/bin/git rev-parse --show-toplevel)"
cd "$ROOT"
MANIFEST= MAP= EXPECTED= FINAL=
ID= SCRATCH= STARTED= CLEANING=0
FAIL=0
DENY_SHA=
CONTAINER_ABSENT=0
SCRATCH_ABSENT=0
DOCKER=/opt/homebrew/bin/docker
BUN=/Users/twoimo/.bun/bin/bun
GJC=/Users/twoimo/.bun/bin/gjc
[ -x "$DOCKER" ] && [ -x "$BUN" ] && [ -f "$GJC" ] || { printf '%s\n' 'required lifecycle binary is unavailable' >&2; exit 64; }
fail() { [ "$FAIL" -eq 0 ] && FAIL="$1"; }
bounded() { /usr/bin/perl -e 'alarm shift; exec @ARGV' "$@"; }
exact_not_found() { /usr/bin/python3 -B - "$1" "$2" <<'PY'
import sys
text=open(sys.argv[1], encoding="utf-8").read().strip()
identifier=sys.argv[2]
sys.exit(0 if text in {f"Error response from daemon: No such container: {identifier}", f"Error: No such object: {identifier}", f"error: no such object: {identifier}"} else 1)
PY
}
cleanup() {
  [ "$CLEANING" -eq 1 ] && return
  CLEANING=1
  if [ -n "$ID" ]; then
    err="$SCRATCH/docker-rm.err"
    if "$DOCKER" rm -f -v "$ID" >/dev/null 2>"$err"; then
      :
    elif exact_not_found "$err" "$ID"; then
      :
    else
      FAIL=70
    fi
    err="$SCRATCH/docker-inspect.err"
    if "$DOCKER" inspect "$ID" >/dev/null 2>"$err"; then
      FAIL=70
    elif exact_not_found "$err" "$ID"; then
      CONTAINER_ABSENT=1
    else
      FAIL=70
    fi
    ID=
  fi
  if [ -n "$SCRATCH" ]; then
    /bin/rm -rf -- "$SCRATCH" || FAIL=70
    if [ ! -e "$SCRATCH" ]; then SCRATCH_ABSENT=1; else FAIL=70; fi
    SCRATCH=
  fi
}
incident() {
  local status=$1
  [ -n "$DENY_SHA" ] && [ ! -e "$EVIDENCE/run-receipt.json" ] || return
  FINISHED=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
  payload=$( /usr/bin/python3 -B - "$STARTED" "$FINISHED" "$status" "$CONTAINER_ABSENT" "$SCRATCH_ABSENT" <<'PY'
import json,sys
print(json.dumps({"schema_version":"g038.phase2b.incident.v1","outcome":"incident","terminal":None,"reason_code":"post_deny_failure_" + sys.argv[3],"cleanup":{"container_absent":sys.argv[4]=="1","scratch_absent":sys.argv[5]=="1"},"started_at_utc":sys.argv[1],"finished_at_utc":sys.argv[2],"independent":False,"operator_count":1,"environment_class":"LOCAL_DISPOSABLE_ONLY","limitations":["solo_operator_cannot_self_certify_isolation","postgres_17_local_results_do_not_transfer_to_shared_15_or_hosted","docker_host_operator_privilege_and_container_Config_Env_password_lifetime_remain","only_catalog_and_three_negative_paths_qualified"],"unqualified_surface":["inventory-58","inventory-59-scheduler-jobs","inventory-60","inventory-61","inventory-62","inventory-63","inventory-64","inventory-65","all-execution-deferred-to-phase-2b","valid_create_lookup_replay","route_digest_conflict","nonce_and_route_unique_conflicts","fixed_string_validation","concurrency_and_40001","lock_ladder","ttl","durability","hosted","provider","protected","independent"]},sort_keys=True,separators=(",",":")))
PY
)
  /usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py receipt --kind incident --input "$payload" >/dev/null || FAIL=70
}
on_exit() { local status=$?; cleanup; [ "$FAIL" -eq 0 ] || status="$FAIL"; [ "$status" -eq 0 ] || incident "$status"; exit "$status"; }
trap on_exit EXIT
trap 'fail 130; exit 130' INT
trap 'fail 143; exit 143' TERM
usage() { printf '%s\n' 'usage: g038_phase2b_qualify.sh --manifest PATH --content-map PATH --expected-content-map-sha256 HEX --lifecycle-final PATH' >&2; exit 64; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST=${2-}; shift 2;;
    --content-map) MAP=${2-}; shift 2;;
    --expected-content-map-sha256) EXPECTED=${2-}; shift 2;;
    --lifecycle-final) FINAL=${2-}; shift 2;;
    *) usage;;
  esac
done
[ "$MANIFEST" = backend/supabase/tests/g038_phase2b_manifest.json ] || usage
[ "$MAP" = backend/supabase/tests/g038_phase2b_content_map.sha256 ] || usage
case "$EXPECTED" in *[!0123456789abcdef]*|'') usage;; esac
[ "${#EXPECTED}" -eq 64 ] || usage
[ -f "$FINAL" ] || usage
[ "$(/usr/bin/shasum -a 256 -- "$MAP")" = "$EXPECTED  $MAP" ] || { fail 64; exit 64; }
/usr/bin/shasum -a 256 -c -- "$MAP"
/usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py validate-manifest "$MANIFEST"
/usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py source-preflight backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql backend/supabase/tests/g038_catalog_assertions.sql
/usr/bin/python3 -B backend/supabase/tests/g038_exclusion_scan.py
EVIDENCE=backend/supabase/tests/g038_phase2b_evidence_g13
[ ! -e "$EVIDENCE" ] || { fail 64; exit 64; }
STARTED=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
SCRATCH=$(/usr/bin/mktemp -d -t g038-phase2b.XXXXXX)
/usr/bin/python3 -B -c 'import os,secrets,sys;p=sys.argv[1];fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.write(fd,("POSTGRES_DB=g009_local\nPOSTGRES_PASSWORD="+secrets.token_hex(32)+"\n").encode());os.close(fd)' "$SCRATCH/env"
OBS=$("$DOCKER" image inspect --format '{{json .RepoDigests}}|{{json .Config.Volumes}}' supabase/postgres:17.6.1.147)
REPOS=${OBS%%|*}; VOLUMES=${OBS#*|}; [ "$REPOS" != "$OBS" ] || { fail 64; exit 64; }
ID=$(bounded 30 "$DOCKER" create --pull never --network none --env-file "$SCRATCH/env" supabase/postgres:17.6.1.147@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca)
case "$ID" in *[!0123456789abcdef]*|'') fail 64; exit 64;; esac
[ "${#ID}" -eq 64 ] || { fail 64; exit 64; }
ISO=$("$DOCKER" inspect --format '{{.HostConfig.NetworkMode}}|{{len .Mounts}}|{{len .HostConfig.PortBindings}}' "$ID")
[ "$ISO" = 'none|0|0' ] || { fail 64; exit 64; }
/usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py deny --repo-digests "$REPOS" --volumes "$VOLUMES" --network none --mounts 0 --ports 0 --container-id "$ID" --content-map-sha "$EXPECTED" --observed-at "$STARTED" >/dev/null
DENY_SHA=$(/usr/bin/shasum -a 256 "$EVIDENCE/deny-observations.json" | /usr/bin/cut -d' ' -f1)
"$DOCKER" start "$ID" >/dev/null
READY=0
for attempt in $(/usr/bin/jot 60 1); do
  if bounded 2 "$DOCKER" exec "$ID" psql -X -q -A -t -U supabase_admin -d g009_local -c 'SELECT 1' >/dev/null; then READY=$attempt; break; fi
  /bin/sleep 1
done
[ "$READY" -gt 0 ] || { fail 64; exit 64; }
for pair in 'backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql:/tmp/p1.sql' 'backend/supabase/tests/g038_catalog_assertions.sql:/tmp/h3.sql'; do host=${pair%%:*}; destination=${pair#*:}; [ "$(/usr/bin/shasum -a 256 -- "$host")" = "$(/usr/bin/grep "  $host$" "$MAP")" ] || { fail 64; exit 64; }; "$DOCKER" cp "$host" "$ID:$destination"; [ "$("$DOCKER" exec "$ID" sha256sum "$destination" | /usr/bin/cut -d' ' -f1)" = "$(/usr/bin/grep "  $host$" "$MAP" | /usr/bin/cut -d' ' -f1)" ] || { fail 64; exit 64; }; done
APPLY=$("$DOCKER" exec -i "$ID" psql -X -q -A -t -P pager=off -P footer=off -v ON_ERROR_STOP=1 -U supabase_admin -d g009_local -f - < backend/supabase/tests/g038_phase2b_apply.sql)
[ "$APPLY" = $'read committed\nPASS|P1_H3_CATALOG' ] || { fail 64; exit 64; }
NEGATIVE=$("$DOCKER" exec -i "$ID" psql -X -q -A -t -P pager=off -P footer=off -v ON_ERROR_STOP=1 -U supabase_admin -d g009_local -f - < backend/supabase/tests/g038_phase2b_negative.sql)
[ "$NEGATIVE" = $'PASS|INVALID_PHASE|22023|g038_invalid_phase|0|0\nPASS|CANDIDATE_IDENTIFIER|22023|g038_candidate_identifier_invalid|0|0\nPASS|ADAPTER_DIRECT_DML|42501|permission denied for table g038_deletion_commitment|0|0' ] || { fail 64; exit 64; }
GJC_SESSION_ID=d367f506-f4bf-46b1-adf2-0945db47bb73 "$BUN" "$GJC" ultragoal status --json > "$SCRATCH/state.json"
IFS=' ' read -r BOUNDARY_SHA FINAL_SHA < <(/usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py validate-lifecycle --state-file "$SCRATCH/state.json" --final "$FINAL" --content-map-sha "$EXPECTED")
cleanup
[ "$FAIL" -eq 0 ] || exit "$FAIL"
FINISHED=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
PAYLOAD=$(/usr/bin/python3 -B - "$DENY_SHA" "$EXPECTED" "$FINAL" "$FINAL_SHA" "$BOUNDARY_SHA" "$READY" "$STARTED" "$FINISHED" <<'PY'
import json,sys
p={"schema_version":"g038.phase2b.receipt.v1","outcome":"qualified","terminal":"LOCAL_QUALIFIED_ONLY","satisfies":[],"does_not_complete_or_unblock":["G002","G003","aggregate"],"independent":False,"operator_count":1,"environment_class":"LOCAL_DISPOSABLE_ONLY","deny_observations_sha256":sys.argv[1],"content_map_sha256":sys.argv[2],"lifecycle_final_path":sys.argv[3],"lifecycle_final_sha256":sys.argv[4],"boundary_readback_sha256":sys.argv[5],"tests":{"apply":"PASS|P1_H3_CATALOG","negative":"three_zero_write_cases","readiness_attempts":int(sys.argv[6])},"cleanup":{"container_absent":True,"scratch_absent":True},"started_at_utc":sys.argv[7],"finished_at_utc":sys.argv[8],"limitations":["solo_operator_cannot_self_certify_isolation","postgres_17_local_results_do_not_transfer_to_shared_15_or_hosted","docker_host_operator_privilege_and_container_Config_Env_password_lifetime_remain","only_catalog_and_three_negative_paths_qualified"],"unqualified_surface":["inventory-58","inventory-59-scheduler-jobs","inventory-60","inventory-61","inventory-62","inventory-63","inventory-64","inventory-65","all-execution-deferred-to-phase-2b","valid_create_lookup_replay","route_digest_conflict","nonce_and_route_unique_conflicts","fixed_string_validation","concurrency_and_40001","lock_ladder","ttl","durability","hosted","provider","protected","independent"]}
print(json.dumps(p,sort_keys=True,separators=(",",":")))
PY
)
/usr/bin/python3 -B backend/supabase/tests/g038_phase2b_record.py receipt --kind qualified --input "$PAYLOAD" >/dev/null
