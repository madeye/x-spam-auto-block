#!/bin/bash
# Launches Chrome with remote debugging on port 9222 using a dedicated,
# persistent profile. Chrome 136+ refuses remote debugging on the default
# profile, so this profile is separate — log into x.com in this window once
# and the session persists across runs.
set -euo pipefail

PORT="${1:-9222}"
PROFILE_DIR="$HOME/.chrome-debug-profile"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  "https://x.com" >/dev/null 2>&1 &
disown

echo "Chrome started with debugging on http://127.0.0.1:$PORT (profile: $PROFILE_DIR)"
echo "If this is the first run, log into x.com in that window once."
