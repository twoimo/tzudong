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
PYTHON="${PYTHON_CMD:-/usr/bin/python3}"
mkdir -p "$HOME/Library/LaunchAgents" "$SUPPORT" "$LOG_DIR" "$REPO_ROOT/backend/log/cron"
cat > "$WRAPPER" <<EOF
#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export TZUDONG_REPO_ROOT=$(printf '%q' "$REPO_ROOT")
export TZUDONG_PIPELINE_SOURCE="mac"
cd "\$TZUDONG_REPO_ROOT"
exec $(printf '%q' "$PYTHON") "\$TZUDONG_REPO_ROOT/backend/bin/run_hosted_new_video_pipeline.py" --channel tzuyang --limit 1
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
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>5</integer>
    <key>Minute</key>
    <integer>0</integer>
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
echo "source=mac schedule=05:00 local evaluate+pending-apply limit=1"
echo "tcc=grant_full_disk_access_to_/bin/bash if repo is under Documents"
