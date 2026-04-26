#!/bin/sh
# notificagent hook for Claude Code
#
# Installed as a symlink at ~/.claude/hooks/notificagent.sh
# Registered in ~/.claude/settings.json for Stop, StopFailure, and PermissionRequest events.
#
# Receives event JSON on stdin; reads hook_event_name to determine notification type.

set -e

# Resolve the real path of this script (follows symlink) to find the repo root.
SELF="$(readlink -f "$0")"
REPO_ROOT="$(cd "$(dirname "$SELF")/../../.." && pwd)"
BACKEND="$REPO_ROOT/backend/notificagent"

# Read hook_event_name from stdin JSON.
# Use python3 as a portable JSON parser — it's always available on macOS.
EVENT_NAME="$(python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null || true)"

case "$EVENT_NAME" in
  Stop)
    "$BACKEND" complete
    ;;
  StopFailure)
    "$BACKEND" error
    ;;
  PermissionRequest)
    "$BACKEND" permission
    ;;
esac
