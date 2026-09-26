#!/bin/sh
# Kills local redlib when idle: no `asocial r` use for REDLIB_IDLE_SECONDS
# (default 600) AND no established TCP connections on its port.
# Safe by default: any doubt → do nothing.
set -u

STATE_DIR="$HOME/.local/share/agent-social"
LASTUSE="$STATE_DIR/redlib.lastuse"
PORT_FILE="$STATE_DIR/redlib.port"
IDLE="${REDLIB_IDLE_SECONDS:-600}"

pgrep -x redlib >/dev/null 2>&1 || exit 0

PORT=8182
[ -f "$PORT_FILE" ] && PORT="$(tr -cd '0-9' <"$PORT_FILE" 2>/dev/null || echo 8182)"
[ -n "$PORT" ] || PORT=8182

if [ -f "$LASTUSE" ]; then
  NOW=$(date +%s)
  MTIME=$(stat -f %m "$LASTUSE" 2>/dev/null || echo "$NOW")
  if [ $((NOW - MTIME)) -lt "$IDLE" ]; then exit 0; fi
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -n -iTCP:"$PORT" 2>/dev/null | grep -q ESTABLISHED; then exit 0; fi
fi

pkill -x redlib 2>/dev/null || true
exit 0
