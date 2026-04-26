# notificagent

Agent-invariant notification backend for AI coding agents running in WezTerm on macOS.

When the agent finishes a task, needs your attention, or hits an error, you get:

- A **chime** via `afplay` (macOS system sounds)
- A **bell icon** on the WezTerm tab — clears automatically when you focus the tab

## Supported agents

| Agent | Events |
|---|---|
| **OpenCode** | Session complete, session error, permission needed |
| **Claude Code** | Response complete, API error, permission needed |
| **Codex** | Response complete, permission needed |

## Requirements

- macOS
- WezTerm
- Python 3 (ships with macOS, used by the install script for JSON merging)

## Install

```sh
git clone https://github.com/yourname/notificagent ~/repos/notificagent
cd ~/repos/notificagent
./install.sh
```

The installer detects which tools are present and:

1. Creates symlinks from each tool's config directory into the repo
2. Merges the required hook configuration into each agent's settings file
3. Enables the `codex_hooks` feature flag in Codex if needed
4. Symlinks `wezterm/notificagent.lua` into `~/.config/wezterm/` and patches `wezterm.lua`

### What gets linked

```
~/.config/opencode/plugins/notificagent.ts  ->  integrations/opencode/index.ts
~/.claude/hooks/notificagent.sh             ->  integrations/claude-code/hooks/notify.sh
~/.codex/hooks/notificagent.sh              ->  integrations/codex/hooks/notify.sh
~/.config/wezterm/notificagent.lua          ->  wezterm/notificagent.lua
```

### What gets merged into settings files

**Claude Code** (`~/.claude/settings.json`): Adds `Stop`, `StopFailure`, and `PermissionRequest` hook entries.

**Codex** (`~/.codex/hooks.json`): Adds `Stop` and `PermissionRequest` hook entries. Enables `codex_hooks = true` in `config.toml`.

**OpenCode**: No config edit needed — plugins in `~/.config/opencode/plugins/` are auto-loaded.

### WezTerm config patch

The installer patches `wezterm.lua` to add:

```lua
local notificagent = require("notificagent")
notificagent.apply_to_config(config)
```

**This line must appear before any other plugin that registers `format-tab-title`** (e.g. `weztty.apply_to_config(config)`). WezTerm only fires the first registered `format-tab-title` handler, so notificagent must go first to render the bell indicator — it replicates any displaced plugin's styling internally.

If the installer can't patch your `wezterm.lua` automatically (e.g. it's a read-only Nix store path), it prints the two lines to add manually.

#### Customising the WezTerm plugin

`apply_to_config` accepts an optional table to match your tab bar colors:

```lua
notificagent.apply_to_config(config, {
  colors = {
    bar_bg      = "#16161e",  -- tab bar background
    active_bg   = "#2f3549",  -- active tab fill
    active_fg   = "#c0caf5",  -- active tab text
    inactive_fg = "#737aa2",  -- inactive tab text
    bell_fg     = "#e0af68",  -- bell indicator color (warm yellow)
  },
  bell_glyph = "\u{f0f3}",    -- Nerd Font bell; use "🔔" if no Nerd Font
})
```

## How it works

### Backend (`backend/notificagent`)

All integrations call a single shell script:

```sh
notificagent <complete|error|permission>
```

It plays a system sound and emits a BEL character (`\x07`) to the terminal.

| Event | Sound |
|---|---|
| `complete` | `Glass.aiff` |
| `error` | `Basso.aiff` |
| `permission` | `Submarine.aiff` |

The BEL delivery prefers `/dev/tty` (direct terminal write). If unavailable, falls back to `wezterm cli send-text` using the `WEZTERM_PANE` environment variable.

### WezTerm tab indicator (`wezterm/notificagent.lua`)

A WezTerm Lua plugin that:
- Listens for the `bell` event (fires when a pane receives `\x07`)
- Tracks which tabs have a pending notification in a local table
- Renders a bell icon (` title`) on inactive tabs with a pending bell via `format-tab-title`
- Clears the indicator when the tab is activated

The plugin fully replaces `format-tab-title` rendering (including active tab pill styling) to ensure it is always the first — and only — registered handler.

## Uninstall

Remove the symlinks:

```sh
rm ~/.config/opencode/plugins/notificagent.ts
rm ~/.claude/hooks/notificagent.sh
rm ~/.codex/hooks/notificagent.sh
rm ~/.config/wezterm/notificagent.lua
```

Then remove the `notificagent` entries from:
- `~/.claude/settings.json` (the `Stop`, `StopFailure`, `PermissionRequest` hook groups)
- `~/.codex/hooks.json` (the `Stop`, `PermissionRequest` hook groups)
- `wezterm.lua` (the two `notificagent` lines)
