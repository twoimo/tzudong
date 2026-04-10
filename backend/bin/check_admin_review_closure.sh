#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
TEAM_LEADER_ROOT="${OMX_TEAM_LEADER_CWD:-}"
INSPECTION_ROOT="$PROJECT_ROOT"
if [ -n "$TEAM_LEADER_ROOT" ] && [ -d "$TEAM_LEADER_ROOT/.git" ]; then
  INSPECTION_ROOT="$TEAM_LEADER_ROOT"
fi

RUNTIME_FILES=(
  ".omg/state/learn-watch.json"
  ".omg/state/quota-watch.json"
  "backend/.sync_trigger"
)

usage() {
  cat <<USAGE
Usage: $(basename "$0")

Checks the current admin-review risk-closure preflight:
- public smoke prerequisites (.env.local / env)
- admin session availability for a live smoke
- tracked runtime dirt in the leader/current checkout
- prelaunch stash classification for runtime-only vs mixed changes
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

ENV_FILES=()
for candidate in \
  "$INSPECTION_ROOT/.env.local" \
  "$PROJECT_ROOT/.env.local"
  do
  if [ -f "$candidate" ]; then
    ENV_FILES+=("$candidate")
  fi
done

find_key_source() {
  local key="$1"
  if [ -n "${!key-}" ]; then
    printf 'env:%s' "$key"
    return 0
  fi

  local file
  for file in "${ENV_FILES[@]}"; do
    if grep -Eq "^[[:space:]]*${key}=" "$file"; then
      printf '%s:%s' "$file" "$key"
      return 0
    fi
  done

  return 1
}

is_runtime_file() {
  local candidate="$1"
  local runtime_file
  for runtime_file in "${RUNTIME_FILES[@]}"; do
    if [ "$candidate" = "$runtime_file" ]; then
      return 0
    fi
  done
  return 1
}

has_supabase_cookie_state() {
  local state_path="$1"
  [ -f "$state_path" ] || return 1
  grep -Eq '"name"[[:space:]]*:[[:space:]]*"sb-' "$state_path"
}

print_section() {
  printf '\n[%s]\n' "$1"
}

print_ok() {
  printf 'PASS: %s\n' "$1"
}

print_warn() {
  printf 'WARN: %s\n' "$1"
}

summary_ok=1

auth_ok=0
public_ok=1
runtime_ok=1
stash_ok=1

print_section "context"
printf 'checkout_root=%s\n' "$PROJECT_ROOT"
printf 'inspection_root=%s\n' "$INSPECTION_ROOT"

print_section "smoke-prereqs"
site_url_source=""
supabase_url_source=""
anon_key_source=""
if ! site_url_source="$(find_key_source NEXT_PUBLIC_SITE_URL)"; then
  public_ok=0
  summary_ok=0
  print_warn 'NEXT_PUBLIC_SITE_URL missing from env and inspected .env.local files.'
else
  print_ok "NEXT_PUBLIC_SITE_URL detected via ${site_url_source}"
fi
if ! supabase_url_source="$(find_key_source NEXT_PUBLIC_SUPABASE_URL)"; then
  public_ok=0
  summary_ok=0
  print_warn 'NEXT_PUBLIC_SUPABASE_URL missing from env and inspected .env.local files.'
else
  print_ok "NEXT_PUBLIC_SUPABASE_URL detected via ${supabase_url_source}"
fi
if ! anon_key_source="$(find_key_source NEXT_PUBLIC_SUPABASE_ANON_KEY)"; then
  public_ok=0
  summary_ok=0
  print_warn 'NEXT_PUBLIC_SUPABASE_ANON_KEY missing from env and inspected .env.local files.'
else
  print_ok "NEXT_PUBLIC_SUPABASE_ANON_KEY detected via ${anon_key_source}"
fi

if [ -n "${INSIGHTS_CHAT_ADMIN_COOKIE:-}" ]; then
  auth_ok=1
  print_ok 'INSIGHTS_CHAT_ADMIN_COOKIE detected in environment.'
elif [ -n "${INSIGHTS_CHAT_ADMIN_COOKIE_FILE:-}" ] && has_supabase_cookie_state "$INSIGHTS_CHAT_ADMIN_COOKIE_FILE"; then
  auth_ok=1
  print_ok "INSIGHTS_CHAT_ADMIN_COOKIE_FILE points to a Supabase storage state: ${INSIGHTS_CHAT_ADMIN_COOKIE_FILE}"
elif [ -n "${E2E_ADMIN_EMAIL:-}" ] && [ -n "${E2E_ADMIN_PASSWORD:-}" ]; then
  auth_ok=1
  print_ok 'E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD detected in environment.'
else
  state_candidates=(
    "$INSPECTION_ROOT/apps/web/tests/.auth/admin.json"
    "$INSPECTION_ROOT/tests/.auth/admin.json"
    "$PROJECT_ROOT/apps/web/tests/.auth/admin.json"
    "$PROJECT_ROOT/tests/.auth/admin.json"
  )
  for state_path in "${state_candidates[@]}"; do
    if has_supabase_cookie_state "$state_path"; then
      auth_ok=1
      print_ok "Supabase admin storage state detected at ${state_path}"
      break
    fi
  done
fi

if [ "$auth_ok" -ne 1 ]; then
  summary_ok=0
  print_warn 'No live admin session detected. Provide INSIGHTS_CHAT_ADMIN_COOKIE, INSIGHTS_CHAT_ADMIN_COOKIE_FILE, E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD, or apps/web/tests/.auth/admin.json before running a real smoke.'
fi

print_section "tracked-runtime-dirt"
runtime_status="$(git -C "$INSPECTION_ROOT" status --short -- "${RUNTIME_FILES[@]}" || true)"
if [ -n "$runtime_status" ]; then
  runtime_ok=0
  summary_ok=0
  print_warn 'Tracked runtime dirt is present in the inspection checkout:'
  printf '%s\n' "$runtime_status"
  printf 'Suggested cleanup: git -C %q restore --source=HEAD -- %q %q %q\n' \
    "$INSPECTION_ROOT" \
    ".omg/state/learn-watch.json" \
    ".omg/state/quota-watch.json" \
    "backend/.sync_trigger"
else
  print_ok 'No tracked runtime dirt found in the inspection checkout.'
fi

print_section "prelaunch-stashes"
prelaunch_stashes="$(git -C "$INSPECTION_ROOT" stash list --format='%gd|%gs' | awk -F'|' 'index($2, "omx-team-prelaunch-") > 0 {print}')"
if [ -z "$prelaunch_stashes" ]; then
  print_ok 'No omx-team-prelaunch stashes detected.'
else
  while IFS='|' read -r stash_ref stash_subject; do
    [ -n "$stash_ref" ] || continue
    mapfile -t stash_files < <(git -C "$INSPECTION_ROOT" diff --name-only "${stash_ref}^1" "$stash_ref")
    if [ "${#stash_files[@]}" -eq 0 ]; then
      print_warn "${stash_ref} (${stash_subject}) has no visible file delta; inspect manually."
      stash_ok=0
      summary_ok=0
      continue
    fi

    runtime_only=1
    for changed_file in "${stash_files[@]}"; do
      if ! is_runtime_file "$changed_file"; then
        runtime_only=0
        break
      fi
    done

    if [ "$runtime_only" -eq 1 ]; then
      print_ok "${stash_ref} (${stash_subject}) is runtime-only and can be dropped after confirming no operator needs those timestamps."
    else
      stash_ok=0
      summary_ok=0
      print_warn "${stash_ref} (${stash_subject}) mixes runtime dirt with non-runtime files; keep it quarantined for the owning lane instead of applying it during admin-review closure."
    fi
    printf '  files: %s\n' "${stash_files[*]}"
  done <<< "$prelaunch_stashes"
fi

print_section "summary"
if [ "$summary_ok" -eq 1 ]; then
  print_ok 'Admin-review smoke + hygiene preflight is clear.'
  exit 0
fi

if [ "$auth_ok" -ne 1 ]; then
  print_warn 'Live smoke is blocked on missing admin session material.'
fi
if [ "$runtime_ok" -ne 1 ]; then
  print_warn 'Future team launches may be surprised by tracked runtime dirt until the suggested restore command is run.'
fi
if [ "$stash_ok" -ne 1 ]; then
  print_warn 'At least one prelaunch stash needs explicit owner follow-up before it should be applied or dropped.'
fi
exit 1
