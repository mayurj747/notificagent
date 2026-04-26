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

The installer detects which agents are present and:

1. Creates symlinks from each agent's config directory into the repo
2. Merges the required hook configuration into each agent's settings file
3. Enables the `codex_hooks` feature flag in Codex if needed

### What gets linked

```
~/.config/opencode/plugins/notificagent.ts  ->  integrations/opencode/index.ts
~/.claude/hooks/notificagent.sh             ->  integrations/claude-code/hooks/notify.sh
~/.codex/hooks/notificagent.sh              ->  integrations/codex/hooks/notify.sh
```

### What gets merged into settings files

**Claude Code** (`~/.claude/settings.json`): Adds `Stop`, `StopFailure`, and `PermissionRequest` hook entries.

**Codex** (`~/.codex/hooks.json`): Adds `Stop` and `PermissionRequest` hook entries.

**OpenCode**: No config edit needed — plugins in `~/.config/opencode/plugins/` are auto-loaded.

## How it works

### Backend (`backend/notificagent`)

All integrations call a single shell script:

```sh
notificagent <complete|error|permission>
```

It plays a system sound and emits a BEL character (`\x07`) to the terminal, which triggers WezTerm's built-in tab bell indicator.

| Event | Sound |
|---|---|
| `complete` | `Glass.aiff` |
| `error` | `Basso.aiff` |
| `permission` | `Submarine.aiff` |

The BEL delivery prefers `/dev/tty` (direct terminal write). If unavailable, falls back to `wezterm cli send-text` using the `WEZTERM_PANE` environment variable.

### WezTerm tab indicator

WezTerm natively shows a bell icon on any tab that receives a BEL character while unfocused. No Lua configuration required. The indicator disappears as soon as you switch to that tab.

## Uninstall

Remove the symlinks and revert the settings changes manually:

```sh
rm ~/.config/opencode/plugins/notificagent.ts
rm ~/.claude/hooks/notificagent.sh
rm ~/.codex/hooks/notificagent.sh
```

Then remove the `notificagent` hook entries from:
- `~/.claude/settings.json`
- `~/.codex/hooks.json`
