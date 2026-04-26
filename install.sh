#!/bin/sh
# notificagent install script
#
# Detects which coding agents are installed and creates symlinks into their
# config directories. Also merges the required hook configuration into each
# tool's settings file.
#
# Run from anywhere — the script resolves its own location to find the repo root.

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Helpers ──────────────────────────────────────────────────────────────────

green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
info()   { printf '  %s\n' "$1"; }

symlink() {
  local src="$1" dst="$2"
  ln -sf "$src" "$dst"
  info "linked $dst -> $src"
}

# ── OpenCode ─────────────────────────────────────────────────────────────────

install_opencode() {
  local plugins_dir="$HOME/.config/opencode/plugins"
  local config_file="$HOME/.config/opencode/opencode.json"
  local config_file_c="$HOME/.config/opencode/opencode.jsonc"

  if ! command -v opencode > /dev/null 2>&1 && [ ! -d "$HOME/.config/opencode" ]; then
    yellow "opencode: not found, skipping"
    return
  fi

  green "opencode: installing"

  # Create plugins directory if it doesn't exist
  mkdir -p "$plugins_dir"

  # Symlink the plugin file
  symlink "$REPO_ROOT/integrations/opencode/index.ts" \
          "$plugins_dir/notificagent.ts"

  # Plugins loaded from the plugins directory are auto-discovered —
  # no changes to opencode.json needed.
  info "plugin auto-loaded from plugins directory"
}

# ── Claude Code ───────────────────────────────────────────────────────────────

install_claude_code() {
  local hooks_dir="$HOME/.claude/hooks"
  local settings="$HOME/.claude/settings.json"

  if ! command -v claude > /dev/null 2>&1 && [ ! -d "$HOME/.claude" ]; then
    yellow "claude-code: not found, skipping"
    return
  fi

  green "claude-code: installing"

  # Create hooks directory if it doesn't exist
  mkdir -p "$hooks_dir"

  # Symlink the hook script
  symlink "$REPO_ROOT/integrations/claude-code/hooks/notify.sh" \
          "$hooks_dir/notificagent.sh"

  # Merge hook config into settings.json using python3
  local hook_script="$hooks_dir/notificagent.sh"
  python3 - "$settings" "$hook_script" << 'PYEOF'
import sys, json, os

settings_path = sys.argv[1]
hook_script   = sys.argv[2]

# Load existing settings or start fresh
if os.path.exists(settings_path):
    with open(settings_path) as f:
        cfg = json.load(f)
else:
    cfg = {}

cfg.setdefault("hooks", {})

# The three events we care about
entries = {
    "Stop":              "complete",
    "StopFailure":       "error",
    "PermissionRequest": "permission",
}

for event, _label in entries.items():
    cfg["hooks"].setdefault(event, [])
    # Check if our hook is already registered (idempotent)
    already = any(
        any(h.get("command", "").endswith("notificagent.sh")
            for h in group.get("hooks", []))
        for group in cfg["hooks"][event]
    )
    if not already:
        cfg["hooks"][event].append({
            "hooks": [{
                "type":    "command",
                "command": hook_script,
                "async":   True,
            }]
        })

with open(settings_path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")

print("  merged hooks into", settings_path)
PYEOF
}

# ── Codex ─────────────────────────────────────────────────────────────────────

install_codex() {
  local hooks_dir="$HOME/.codex/hooks"
  local config_toml="$HOME/.codex/config.toml"
  local hooks_json="$HOME/.codex/hooks.json"

  if ! command -v codex > /dev/null 2>&1 && [ ! -d "$HOME/.codex" ]; then
    yellow "codex: not found, skipping"
    return
  fi

  green "codex: installing"

  # Create hooks directory if it doesn't exist
  mkdir -p "$hooks_dir"

  # Symlink the hook script
  symlink "$REPO_ROOT/integrations/codex/hooks/notify.sh" \
          "$hooks_dir/notificagent.sh"

  # Ensure the codex_hooks feature flag is enabled in config.toml
  if [ -f "$config_toml" ]; then
    if ! grep -q "codex_hooks" "$config_toml"; then
      printf '\n[features]\ncodex_hooks = true\n' >> "$config_toml"
      info "enabled codex_hooks feature in $config_toml"
    else
      info "codex_hooks already enabled in $config_toml"
    fi
  else
    printf '[features]\ncodex_hooks = true\n' > "$config_toml"
    info "created $config_toml with codex_hooks = true"
  fi

  # Merge hook config into hooks.json using python3
  local hook_script="$hooks_dir/notificagent.sh"
  python3 - "$hooks_json" "$hook_script" << 'PYEOF'
import sys, json, os

hooks_path  = sys.argv[1]
hook_script = sys.argv[2]

# Load existing hooks.json or start fresh
if os.path.exists(hooks_path):
    with open(hooks_path) as f:
        cfg = json.load(f)
else:
    cfg = {}

cfg.setdefault("hooks", {})

# The two events Codex supports that we care about
entries = ["Stop", "PermissionRequest"]

for event in entries:
    cfg["hooks"].setdefault(event, [])
    already = any(
        any(h.get("command", "").endswith("notificagent.sh")
            for h in group.get("hooks", []))
        for group in cfg["hooks"][event]
    )
    if not already:
        cfg["hooks"][event].append({
            "hooks": [{
                "type":    "command",
                "command": hook_script,
            }]
        })

with open(hooks_path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")

print("  merged hooks into", hooks_path)
PYEOF
}

# ── WezTerm ───────────────────────────────────────────────────────────────────

install_wezterm() {
  local wezterm_config_dir="$HOME/.config/wezterm"

  if ! command -v wezterm > /dev/null 2>&1 && [ ! -d "$wezterm_config_dir" ]; then
    yellow "wezterm: not found, skipping"
    return
  fi

  green "wezterm: installing"

  # Create config dir if it doesn't exist
  mkdir -p "$wezterm_config_dir"

  # Symlink the plugin so it can be require()'d as "notificagent" in wezterm.lua
  symlink "$REPO_ROOT/wezterm/notificagent.lua" \
          "$wezterm_config_dir/notificagent.lua"

  # Find the real wezterm.lua source (resolve symlinks — Nix/home-manager users
  # keep the source in their dotfiles repo, not in ~/.config/wezterm directly).
  local wezterm_lua="$wezterm_config_dir/wezterm.lua"
  local real_lua
  if [ -L "$wezterm_lua" ]; then
    real_lua="$(readlink -f "$wezterm_lua" 2>/dev/null || true)"
  else
    real_lua="$wezterm_lua"
  fi

  if [ -z "$real_lua" ] || [ ! -f "$real_lua" ]; then
    info "wezterm.lua not found or unresolvable"
    print_wezterm_instructions
    return
  fi

  # Check if the snippet is already present (idempotent)
  if grep -q "notificagent" "$real_lua" 2>/dev/null; then
    info "notificagent already present in $real_lua"
    return
  fi

  # Check if the file is writable (Nix store paths are read-only)
  if [ ! -w "$real_lua" ]; then
    info "wezterm.lua is read-only: $real_lua"
    print_wezterm_instructions
    return
  fi

  # Inject require + apply_to_config before the first weztty/tab-bar call.
  # We use python3 to do a safe single-line insertion.
  python3 - "$real_lua" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

snippet = (
    "local notificagent = require(\"notificagent\")\n\n"
)
apply_snippet = "notificagent.apply_to_config(config)\n"

# Insert the require line before the first wezterm.plugin.require or local weztty line
require_pattern = re.compile(r'^(local\s+\w+\s*=\s*wezterm\.plugin\.require\b)', re.MULTILINE)
m = require_pattern.search(content)
if m:
    insert_pos = m.start()
    content = content[:insert_pos] + snippet + content[insert_pos:]
else:
    # Fallback: insert after the last require block, before local config = {}
    config_pattern = re.compile(r'^(local\s+config\s*=\s*\{)', re.MULTILINE)
    m2 = config_pattern.search(content)
    if m2:
        insert_pos = m2.start()
        content = content[:insert_pos] + snippet + content[insert_pos:]

# Insert apply_to_config(config) before the first weztty.apply_to_config or
# tab_bar-related config line, whichever comes first.
apply_pattern = re.compile(r'^(\w+\.apply_to_config\(config\))', re.MULTILINE)
m3 = apply_pattern.search(content)
if m3:
    insert_pos = m3.start()
    content = content[:insert_pos] + apply_snippet + content[insert_pos:]
else:
    # Fallback: append before return config
    content = content.replace("\nreturn config", "\n" + apply_snippet + "\nreturn config", 1)

with open(path, "w") as f:
    f.write(content)

print("  patched", path)
PYEOF
}

print_wezterm_instructions() {
  printf '\n'
  yellow "  Manual step required for WezTerm tab indicator:"
  info "  Add the following to your wezterm.lua BEFORE any other"
  info "  plugin that registers format-tab-title (e.g. weztty):"
  printf '\n'
  printf '    local notificagent = require("notificagent")\n'
  printf '    notificagent.apply_to_config(config)\n'
  printf '\n'
}

# ── Main ──────────────────────────────────────────────────────────────────────

printf '\nnotificagent installer\n'
printf '======================\n\n'

install_opencode
install_claude_code
install_codex
install_wezterm

printf '\n'
green "done."
printf '\n'
