#!/usr/bin/env bash
# G038 local disposable sandbox launcher (H1).
#
# AUTHORED IN PHASE 2a. NOT EXECUTED IN PHASE 2a.
#
# The manifest authorizes exactly one argv for Phase 2a: `shasum -a 256` over
# P1,H1,H2,H3,H4. That freeze was NOT honoured in full, and saying otherwise
# here would be false. The authoring lane additionally ran interpreter syntax
# gates, pure-bash function tests of this file's own resolver, the H4 scanner
# over synthetic /tmp fixtures, and read-only `docker image inspect` catalog
# reads. It also re-ran the frozen argv once per authoring pass. None of that
# touched a database, network, container runtime, or credential, but all of it
# is beyond the one permitted argv, and it is filed as a breach in H5 rather
# than asserted away here.
#
# This script is one of the five files that argv hashes. Running THIS script is
# a Phase 2b action and requires a separate Phase 2b manifest with its own
# Architect CLEAR/APPROVE, Critic OKAY, and explicit execution approval.
# Until then NO_RUNTIME forbids invoking it.
#
# Bound authorities:
#   governing plan       457d6914c5ff26922b71f60de816044992f1c14c297dfa74350ce16e08fc6531
#   technical authority  d99ceb632c976bc7c2388b1c7f95571c8b7429a14e7915a9cc09d8aaa99842a4
#   inventory source     18b473ebc39da27845a1a88664ed191b90f613a7a90255da03e1aafb2c1e1b8a
#   phase-1 manifest     edb9ed0f637249581587e8703086a90954459b735a0e4821997acbc423756089
#
# Lane metadata: {"independent":false,"operator_count":1,
#                 "environment_class":"LOCAL_DISPOSABLE_ONLY"}
#
# Enforcement model. The deny predicates are enforced by the Docker daemon
# OUTSIDE the candidate, not by convention inside it. `--network none` gives
# the container an empty Linux network namespace; zero mounts make the
# repository — and therefore every .env file, credential helper, keychain and
# agent socket — physically unreachable. This is what replaces the
# unenforceable macOS per-process egress-deny predicate that blocked the
# earlier design. A denylist or observed-egress scan alone would be
# insufficient and is not relied on.

set -euo pipefail
IFS=$'\n\t'
umask 022

readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly PROFILE="${REPO_ROOT}/backend/supabase/tests/g038_local_sandbox.profile.json"

# Frozen: the pinned image and its digest. Pull is forbidden.
readonly IMAGE='supabase/postgres:17.6.1.147'
readonly IMAGE_DIGEST='sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca'

# Frozen: the target database.
readonly PGDB='g009_local'

# Frozen: the ONLY two host paths that may be copied into the container.
#
# What actually enforces this, stated without overclaim. There is no argv
# validator: the checker that used to be named here was deleted in pass 9
# because its only callers passed the very literals it compared against, so it
# could never fail. What exists now is a producer, resolve_copy_source, which
# takes an index rather than a path, so no caller can name a source at all.
#
# That relocates the guarantee rather than eliminating the need for trust:
# WHICH files enter the container still rests on these two literals being
# correct, and no executed check verifies that -- it rests on step-4 gate
# review of these bytes, whose digest is bound in H5. H2's RESIDUAL LIMIT
# records the same thing, and this comment is kept in line with it deliberately.
#
# What IS mechanically true: there is no directory glob and no migration runner
# anywhere in this script, so the migration deny list cannot be circumvented by
# a wildcard expansion.
readonly ALLOWED_COPY_1='backend/supabase/migrations/20260728000100_g038_deterministic_contract.sql'
readonly ALLOWED_COPY_2='backend/supabase/tests/g038_catalog_assertions.sql'

# Frozen: the exclusion scanner that must pass before any SQL is applied.
readonly SCANNER='backend/supabase/tests/g038_exclusion_scan.py'

CONTAINER_ID=''

log()  { printf '[g038-sandbox] %s\n' "$*"; }
fail() { printf '[g038-sandbox] INCIDENT: %s\n' "$*" >&2; exit 1; }

# Teardown removes ONLY the container this run created, addressed by the id
# this run captured. It never prunes, never touches a container it did not
# create, and never deletes, reverts, stashes or commits user work.
#
# -v is passed so that any anonymous volume attached at create time is removed
# with the container. Without it such a volume would outlive teardown while the
# profile prohibits `docker volume prune`, leaving a residue path that could
# satisfy "complete teardown" while state persisted. The flag stays scoped to
# this run's container id: it removes only volumes anonymously attached to that
# container, never a named or pre-existing volume.
teardown() {
  local rc=$?
  if [[ -n "${CONTAINER_ID}" ]]; then
    log "teardown: removing container ${CONTAINER_ID}"
    docker rm -f -v "${CONTAINER_ID}" >/dev/null 2>&1 \
      || printf '[g038-sandbox] INCIDENT: incomplete teardown of %s\n' "${CONTAINER_ID}" >&2
  fi
  exit "${rc}"
}
trap teardown EXIT INT TERM

# ---------------------------------------------------------------------------
# docker cp source resolver
#
# This was previously a checker -- assert_copy_source_allowed "$1" compared its
# argument against ALLOWED_COPY_1/2. But the only callers passed those very
# literals, so the comparison could never fail. It read as enforcement while
# enforcing nothing: the same vacuity class as the H3 A9 privilege check that
# was fixed by adding a positive existence assertion.
#
# This form is a PRODUCER. It takes an index, and the only way to obtain a cp
# source is to call it, so a caller cannot supply an arbitrary path because it
# does not supply a path at all.
#
# That improves EXPRESSIBILITY, and nothing stronger. The tautology is NOT
# "removed by construction" -- an earlier version of this comment said so, and
# H2's RESIDUAL LIMIT withdraws it. The `*) fail` arm below is unreachable from
# this script's own two callsites, which pass the literal indices 1 and 2, so it
# has the same cannot-fail-from-its-callers property as the checker it replaced.
# The vacuity is relocated, not eliminated, and WHICH files enter the container
# still rests on the two unverified literals above.
#
# It also performs the checks the checker never did: the resolved path must be
# a regular file, must be non-empty, and must canonicalize to a location under
# the repository root, so a symlink aimed outside the repo is rejected rather
# than silently copied in.
# ---------------------------------------------------------------------------
resolve_copy_source() {
  local index="$1"
  local path resolved repo_resolved

  case "${index}" in
    1) path="${ALLOWED_COPY_1}" ;;
    2) path="${ALLOWED_COPY_2}" ;;
    *) fail "copy source index outside {1,2}: ${index}" ;;
  esac

  [[ -f "${path}" ]] || fail "copy source is not a regular file: ${path}"
  [[ -s "${path}" ]] || fail "copy source is empty: ${path}"

  # Canonicalize the FULL path, final component included.
  #
  # An earlier form of this resolved only the directory:
  #   resolved="$(cd -- "$(dirname -- "$path")" && pwd -P)/$(basename -- "$path")"
  # which leaves the last component unresolved, so a symlink AT that component
  # pointing outside the repository passed the containment test and would have
  # been copied in. Verified by executable test before this fix: a symlink at
  # sub/evil.sql aimed at ../outside/secret.sql was accepted and read
  # SECRET-OUTSIDE-REPO. `cd -P` cannot catch that case because it never
  # traverses the leaf.
  #
  # python3 is already a hard dependency of this launcher (it runs the H4
  # scanner), so os.path.realpath is available and resolves every component
  # including the leaf. -B keeps the interpreter from writing bytecode.
  # NOTE: no `--` before the path. `python3 -c` does not treat `--` as an
  # end-of-options separator; it would be passed through as sys.argv[1] and
  # every path would resolve to <cwd>/--. An earlier form of this fix did
  # exactly that and rejected even the legitimate file. Both operands here are
  # launcher-internal constants, never caller-supplied, so there is no
  # option-injection surface to guard against.
  resolved="$(python3 -B -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' \
                "${path}")" \
    || fail "cannot resolve copy source: ${path}"
  repo_resolved="$(python3 -B -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' \
                     "${REPO_ROOT}")" \
    || fail "cannot resolve repo root"

  case "${resolved}" in
    "${repo_resolved}"/*) : ;;
    *) fail "copy source resolves outside the repo root: ${resolved}" ;;
  esac

  # Emit the canonical path, not the original. Returning the unresolved path
  # would hand docker cp a value the containment test never actually vetted.
  printf '%s' "${resolved}"
}

# ---------------------------------------------------------------------------
# Preconditions, all proven before the candidate starts
# ---------------------------------------------------------------------------
log 'precondition: repo root and profile'
[[ -f "${PROFILE}" ]] || fail "profile absent: ${PROFILE}"
cd -- "${REPO_ROOT}" || fail "cannot cd to repo root"

for required in "${ALLOWED_COPY_1}" "${ALLOWED_COPY_2}" "${SCANNER}"; do
  [[ -f "${required}" ]] || fail "required file absent: ${required}"
done

log 'precondition: docker client reachable'
command -v docker >/dev/null 2>&1 || fail 'docker client not found'

# No registry egress. The image must already be local; a pull is an incident.
#
# RepoDigests entries are TAGLESS: docker records `name@sha256:...`, never
# `name:tag@sha256:...`. Matching the tag-bearing form can therefore never
# succeed, which would abort this launcher before it ever reached docker
# create. Verified against this host: RepoDigests is exactly
# ["supabase/postgres@sha256:ac581882..."]. The repository name is derived by
# stripping the tag suffix from IMAGE.
log 'precondition: pinned image present locally (pull forbidden)'
readonly IMAGE_REPO="${IMAGE%%:*}"
local_digests="$(docker image inspect "${IMAGE}" --format '{{join .RepoDigests "\n"}}' 2>/dev/null || true)"
[[ -n "${local_digests}" ]] || fail "pinned image absent from local cache; pulling is forbidden: ${IMAGE}"
grep -Fqx -- "${IMAGE_REPO}@${IMAGE_DIGEST}" <<<"${local_digests}" \
  || fail "local image digest does not match the pinned digest ${IMAGE_DIGEST}"

# Independent corroboration on a second catalog field: the image Id must equal
# the pinned digest. This holds for a digest-pinned single-arch image and makes
# the precondition robust if RepoDigests is ever empty for a locally built tag.
local_image_id="$(docker image inspect "${IMAGE}" --format '{{.Id}}' 2>/dev/null || true)"
[[ "${local_image_id}" == "${IMAGE_DIGEST}" ]] \
  || fail "local image Id ${local_image_id} does not equal the pinned digest ${IMAGE_DIGEST}"

# Exclusion scan runs on the HOST, over both files that reach the database,
# BEFORE any SQL is applied. This is the frozen ordering: H4 then P1 then H3.
log 'precondition: exclusion scan over P1 and H3 (must pass before any SQL)'
python3 "${SCANNER}" || fail 'exclusion scan rejected an authored file'

# ---------------------------------------------------------------------------
# Candidate creation, deny-predicate proof, THEN candidate start
#
# Ordering is load-bearing. `docker create` materializes the container and its
# HostConfig without starting any process, so `docker inspect` at that point is
# a proof taken strictly BEFORE the candidate runs. Only after every deny
# predicate is positively proven does `docker start` run the entrypoint.
# Proving after `docker run -d` would be a post-hoc observation of a candidate
# that was already executing, which the manifest does not accept.
# ---------------------------------------------------------------------------
log 'creating disposable container (not started): --network none, zero mounts, no published ports'
ephemeral_pw="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

CONTAINER_ID="$(docker create \
  --network none \
  --env "POSTGRES_DB=${PGDB}" \
  --env "POSTGRES_PASSWORD=${ephemeral_pw}" \
  "${IMAGE}@${IMAGE_DIGEST}")" \
  || fail 'container create failed'
unset ephemeral_pw

log "container id ${CONTAINER_ID} (created, no process running)"

# ---------------------------------------------------------------------------
# Deny predicates, positively proven by the daemon BEFORE candidate start
# ---------------------------------------------------------------------------
log 'proving deny predicates via docker inspect (pre-start)'

netmode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "${CONTAINER_ID}")"
[[ "${netmode}" == 'none' ]] || fail "network mode is '${netmode}', expected 'none'"

mount_count="$(docker inspect -f '{{len .Mounts}}' "${CONTAINER_ID}")"
[[ "${mount_count}" == '0' ]] || fail "container has ${mount_count} mounts, expected 0"

binding_count="$(docker inspect -f '{{len .HostConfig.PortBindings}}' "${CONTAINER_ID}")"
[[ "${binding_count}" == '0' ]] \
  || fail "container has ${binding_count} port bindings, expected 0"

log 'deny predicates proven pre-start: no network, no mounts, no port bindings'

# ---------------------------------------------------------------------------
# Candidate start (only now does any process run)
# ---------------------------------------------------------------------------
log 'starting the proven container'
docker start "${CONTAINER_ID}" >/dev/null || fail 'container start failed'

# ---------------------------------------------------------------------------
# Readiness gate
# ---------------------------------------------------------------------------
log 'waiting for postgres readiness'
ready=0
for _ in $(seq 1 60); do
  if docker exec "${CONTAINER_ID}" pg_isready -U postgres -d "${PGDB}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "${ready}" == '1' ]] || fail 'postgres did not become ready within 60s'

# ---------------------------------------------------------------------------
# Copy in exactly the two allowlisted files
#
# The source of each copy is obtained from resolve_copy_source, which is the
# only thing that emits a path. Nothing here names a path directly, so there is
# no literal for a future edit to change and no argument for a caller to get
# wrong -- an unallowlisted source cannot be expressed at this callsite.
# ---------------------------------------------------------------------------
log 'copying the two allowlisted SQL files into the container'

copy_src_1="$(resolve_copy_source 1)" || fail 'copy source 1 rejected'
docker cp "${copy_src_1}" "${CONTAINER_ID}:/tmp/p1.sql" || fail 'copy of P1 failed'

copy_src_2="$(resolve_copy_source 2)" || fail 'copy source 2 rejected'
docker cp "${copy_src_2}" "${CONTAINER_ID}:/tmp/h3.sql" || fail 'copy of H3 failed'

# Post-copy verification: content identity, not just presence.
#
# An earlier form counted names only:
#   ls -1 /tmp/p1.sql /tmp/h3.sql | wc -l  -> must equal 2
# That proves two paths resolve inside the container. It does NOT prove the
# bytes are P1 and H3: a wrong-source, truncated, or partially written copy
# satisfies it identically. The comment above it nonetheless claimed "they are
# the two expected ones", which is more than the check could show. Withdrawn.
#
# This form compares the digest of each file as it now exists INSIDE the
# container against the digest of the exact host file the resolver emitted.
# Equality means the bytes crossed intact and came from the vetted source.
#
# sha256sum availability in the image is NOT verified here -- no container has
# been started at authoring time. If the binary is absent the command fails and
# the || fail arm stops the run, so the failure mode is closed rather than a
# silent skip. Phase 2b confirms availability on first real execution.
#
# NOTE on guard reachability. An earlier form of this function piped each hash
# through `cut` and then tested `[[ -n "${digest}" ]]`. Under this script's own
# `set -o pipefail` that guard could never fire: a missing host file or an
# absent in-image sha256sum makes the pipeline exit nonzero, so `|| fail` fires
# first and the test is never evaluated. It was an assertion that could not
# fail -- the exact class passes 9 through 11 were spent removing -- and H5
# additionally claimed the guard was the catcher, which was false.
#
# This form takes the pipe out. Each command substitution holds a single
# command, so its exit status propagates directly to `|| fail`, and the
# remaining checks run only on output that a SUCCESSFUL command produced.
# Those checks are therefore reachable: they cover the succeeded-but-useless
# cases -- empty output, or output whose first field is not a 64-character hex
# digest -- which no exit status reports.
verify_copied_file() {
  local host_path="$1" container_path="$2" label="$3"
  local host_raw container_raw host_digest container_digest

  host_raw="$(shasum -a 256 -- "${host_path}")" \
    || fail "cannot hash host ${label}: ${host_path}"
  [[ -n "${host_raw}" ]] \
    || fail "host hash produced no output for ${label}: ${host_path}"
  host_digest="${host_raw%% *}"
  [[ "${host_digest}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "malformed host digest for ${label}: '${host_digest}'"

  container_raw="$(docker exec "${CONTAINER_ID}" sha256sum "${container_path}")" \
    || fail "cannot hash in-container ${label} (${container_path}); sha256sum may be absent"
  [[ -n "${container_raw}" ]] \
    || fail "in-container hash produced no output for ${label}: ${container_path}"
  container_digest="${container_raw%% *}"
  [[ "${container_digest}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "malformed container digest for ${label}: '${container_digest}'"

  [[ "${host_digest}" == "${container_digest}" ]] \
    || fail "${label} content mismatch: host ${host_digest} vs container ${container_digest}"

  log "${label} verified in container by digest ${container_digest}"
}

verify_copied_file "${copy_src_1}" /tmp/p1.sql P1
verify_copied_file "${copy_src_2}" /tmp/h3.sql H3

# ---------------------------------------------------------------------------
# Apply P1, then assert with H3. ON_ERROR_STOP makes both fail closed.
# ---------------------------------------------------------------------------
log 'applying P1 (deterministic contract)'
docker exec "${CONTAINER_ID}" \
  psql -v ON_ERROR_STOP=1 -U postgres -d "${PGDB}" -f /tmp/p1.sql \
  || fail 'P1 application failed'

log 'running H3 catalog assertions'
docker exec "${CONTAINER_ID}" \
  psql -v ON_ERROR_STOP=1 -U postgres -d "${PGDB}" -f /tmp/h3.sql \
  || fail 'catalog assertions failed'

log 'PASS: contract applied and all catalog assertions hold'
log 'terminal: LOCAL_QUALIFIED_ONLY'
log 'satisfies: [] — does not complete or unblock G002, G003, or the aggregate'
log 'limitation: solo-operator lane cannot self-certify isolation'
log 'limitation: container PostgreSQL 17 diverges from the shared 15.8.1.085 pin and from the unverifiable hosted major; evidence transfers to neither'
log 'unqualified: runtime behaviour, replay equality, TTL fencing, durability, and every apps/web surface'
