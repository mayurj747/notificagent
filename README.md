# notificagent

Chime + WezTerm tab bell for AI agents on macOS.

- **Sound** — macOS system alert via `afplay`
- **Visual** — bell icon on the WezTerm tab, clears on focus

## Agents

| Agent | Events |
|---|---|
| OpenCode | idle, error, permission |
| Claude Code | complete, error, permission |
| Codex | complete, permission |

## Requirements

- macOS
- WezTerm
- [Bun](https://bun.sh)

## Install

```sh
git clone https://github.com/mayurj747/notificagent
cd notificagent
./install.ts
```

The interactive installer detects your tools and symlinks the hooks. It patches `wezterm.lua` automatically when possible, or prints the two lines to add manually.

## WezTerm config

If patching failed (e.g. Nix-managed dotfiles), add this to `wezterm.lua` **before any other `format-tab-title` plugin**:

```lua
local notificagent = require("notificagent")
notificagent.apply_to_config(config)
```

Optional colors override:

```lua
notificagent.apply_to_config(config, {
  colors = {
    bar_bg      = "#16161e",
    active_bg   = "#2f3549",
    active_fg   = "#c0caf5",
    inactive_fg = "#737aa2",
    bell_fg     = "#e0af68",
  },
  bell_glyph = "\u{f0f3}",
})
```

## Uninstall

Run `./install.ts` again and choose "Uninstall", or remove the symlinks and delete the `notificagent` entries from `~/.claude/settings.json`, `~/.codex/hooks.json`, and `wezterm.lua`.
