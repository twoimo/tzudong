#!/usr/bin/env bash
# Install a Mac LaunchAgent that runs the same hosted new-video pipeline as GHA.
# Does not start the heavy local worker. Does not enable hosted_apply latch.
# launchd cannot read Documents/Desktop/Downloads unless /bin/bash has Full Disk Access.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="dev.tzudong.hosted-new-video"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT="$HOME/Library/Application Support/tzudong"
LOG_DIR="$HOME/Library/Logs/tzudong"
WRAPPER="$SUPPORT/run-hosted-new-video.sh"
if [[ -n "${PYTHON_CMD:-}" ]]; then
  PYTHON="$PYTHON_CMD"
elif [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
  PYTHON="$REPO_ROOT/.venv/bin/python"
else
  PYTHON="/usr/bin/python3"
fi
# Validate before replacing a wrapper or unloading the installed agent.
NODE="${NODE_CMD:-/opt/homebrew/opt/node@24/bin/node}"
if [[ "$NODE" != /*/node || ! -x "$NODE" ]]; then
  echo "node_runtime_unavailable" >&2
  exit 1
fi
# Resolve imports from this checkout before replacing an otherwise working agent.
(cd "$REPO_ROOT/backend" && "$NODE" --input-type=module -e '
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try {
  if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1);
  for (const name of ["js-yaml", "dotenv", "winston", "@google/genai", "puppeteer-extra", "puppeteer-extra-plugin-stealth"]) require.resolve(name);
} catch { process.exit(1); }
') || { echo "node_dependencies_unavailable" >&2; exit 1; }
"$PYTHON" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' || {
  echo "python_runtime_unavailable" >&2
  exit 1
}
FREEZE_STATE="${G037_WRITE_FREEZE:-active}"
case "$FREEZE_STATE" in
  active|cleared) ;;
  *) echo 'invalid_write_freeze_state' >&2; exit 2 ;;
esac
REVIEW_AUTOMATION="${TZUDONG_MAC_REVIEW_AUTOMATION:-0}"
case "$REVIEW_AUTOMATION" in
  0|1) ;;
  *) echo 'invalid_review_automation_opt_in' >&2; exit 2 ;;
esac
mkdir -p "$HOME/Library/LaunchAgents" "$SUPPORT" "$LOG_DIR" "$REPO_ROOT/backend/log/cron"
cat > "$WRAPPER" <<EOF
#!/bin/bash
set -euo pipefail
export PATH=$(printf '%q' "$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
export TZUDONG_REPO_ROOT=$(printf '%q' "$REPO_ROOT")
export TZUDONG_PIPELINE_SOURCE="mac"
export G037_WRITE_FREEZE="${FREEZE_STATE}"
export PYTHON_CMD=$(printf '%q' "$PYTHON")
export TZUDONG_LAAJ_PROVIDER="gemini"
export TZUDONG_HOSTED_DATA_PLANE_APPROVED="1"
REVIEW_AUTOMATION=${REVIEW_AUTOMATION}
runner_args=(--channel tzuyang --limit 3)
if [[ "\$REVIEW_AUTOMATION" == "1" ]]; then runner_args+=(--review-automation); fi
runner_args+=(--receipt-out "\$TZUDONG_REPO_ROOT/backend/log/cron/hosted-run-\$(date -u +%Y%m%dT%H%M%SZ).json")
cd "\$TZUDONG_REPO_ROOT"
echo "\$(date -u +%Y-%m-%dT%H:%M:%SZ) start source=mac freeze=\${G037_WRITE_FREEZE} limit=3"
set +e
$(printf '%q' "$PYTHON") "\$TZUDONG_REPO_ROOT/backend/bin/run_hosted_new_video_pipeline.py" "\${runner_args[@]}"
pipeline_exit=\$?
set -e
echo "\$(date -u +%Y-%m-%dT%H:%M:%SZ) end exit=\${pipeline_exit}"
exit "\${pipeline_exit}"
EOF
chmod 755 "$WRAPPER"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${SUPPORT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WRAPPER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TZUDONG_PIPELINE_SOURCE</key>
    <string>mac</string>
    <key>TZUDONG_REPO_ROOT</key>
    <string>${REPO_ROOT}</string>
    <key>G037_WRITE_FREEZE</key>
    <string>${FREEZE_STATE}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>5</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/mac-hosted-new-video.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/mac-hosted-new-video.err.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${PLIST}"
echo "wrapper=${WRAPPER}"
echo "logs=${LOG_DIR}"
echo "source=mac schedule=05:15 local evaluate+pending-apply limit=3"
echo "write_freeze=${FREEZE_STATE}"
echo "review_automation=${REVIEW_AUTOMATION}"
echo "tcc=grant_full_disk_access_to_/bin/bash if repo is under Documents"
