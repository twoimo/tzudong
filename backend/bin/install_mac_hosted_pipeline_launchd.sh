#!/usr/bin/env bash
# Install a Mac LaunchAgent that runs the same hosted new-video pipeline as GHA.
# Does not start the heavy local worker. Does not enable hosted_apply latch.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="dev.tzudong.hosted-new-video"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PYTHON="${PYTHON_CMD:-/usr/bin/python3}"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO_ROOT/backend/log/cron"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON}</string>
    <string>${REPO_ROOT}/backend/bin/run_hosted_new_video_pipeline.py</string>
    <string>--channel</string>
    <string>tzuyang</string>
    <string>--limit</string>
    <string>1</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TZUDONG_PIPELINE_SOURCE</key>
    <string>mac</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>5</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${REPO_ROOT}/backend/log/cron/mac-hosted-new-video.log</string>
  <key>StandardErrorPath</key>
  <string>${REPO_ROOT}/backend/log/cron/mac-hosted-new-video.err.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${PLIST}"
echo "source=mac schedule=05:00 local evaluate+pending-apply limit=1"
