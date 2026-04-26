#!/bin/sh
# notificagent installer
#
# Bootstraps the interactive CLI installer via Bun.
# Installs npm dependencies on first run (or when the lockfile changes),
# then hands off to installer/index.ts.

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Bun check ─────────────────────────────────────────────────────────────────

if ! command -v bun > /dev/null 2>&1; then
  echo "error: bun is required but not found." >&2
  echo "Install it from https://bun.sh or with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

# ── Install dependencies if needed ───────────────────────────────────────────

cd "$REPO_ROOT/installer"
bun install --frozen-lockfile --silent 2>/dev/null \
  || bun install --silent

# ── Run installer ─────────────────────────────────────────────────────────────

exec bun run "$REPO_ROOT/installer/index.ts"
