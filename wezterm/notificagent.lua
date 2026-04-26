-- notificagent WezTerm plugin
--
-- Adds a bell indicator to WezTerm tabs when an agent fires a notification.
-- The indicator appears on any unfocused tab that receives a BEL character
-- (\x07) and clears automatically when you switch to that tab.
--
-- IMPORTANT: call notificagent.apply_to_config(config, opts) BEFORE any other
-- plugin that registers format-tab-title (e.g. weztty). WezTerm only fires
-- the first registered format-tab-title handler, so this must go first.
--
-- Usage in wezterm.lua:
--
--   local notificagent = require("notificagent")
--   local weztty = wezterm.plugin.require("https://github.com/mayurj747/weztty")
--
--   -- Apply notificagent first so its format-tab-title handler is registered first
--   notificagent.apply_to_config(config, {
--     -- Optional: match your tab bar theme colors (defaults shown below)
--     colors = {
--       bar_bg      = "#16161e",
--       active_bg   = "#2f3549",
--       active_fg   = "#c0caf5",
--       inactive_fg = "#737aa2",
--       bell_fg     = "#e0af68",  -- warm yellow bell icon
--     },
--     -- Optional: override the bell glyph (default is  from Nerd Fonts)
--     -- bell_glyph = "🔔",
--   })
--
--   -- Apply weztty after — its format-tab-title registration is a no-op since
--   -- ours is already registered, but it still sets tab bar colors and styles.
--   weztty.apply_to_config(config)

local wezterm = require("wezterm")

local M = {}

M.default_colors = {
  bar_bg      = "#16161e",
  active_bg   = "#2f3549",
  active_fg   = "#c0caf5",
  inactive_fg = "#737aa2",
  bell_fg     = "#e0af68",
}

M.default_bell_glyph = "\u{f0f3}"  -- Nerd Font bell icon (requires Nerd Font)

-- bell_tabs: tab_id -> true when a BEL was received on that tab while unfocused
local bell_tabs = {}

function M.apply_to_config(config, opts)
  local colors = M.default_colors
  local bell_glyph = M.default_bell_glyph

  if opts then
    if opts.colors then
      -- Merge provided colors over defaults
      colors = {}
      for k, v in pairs(M.default_colors) do colors[k] = v end
      for k, v in pairs(opts.colors) do colors[k] = v end
    end
    if opts.bell_glyph then
      bell_glyph = opts.bell_glyph
    end
  end

  -- Track bells. The bell event fires when any pane receives BEL (\x07).
  wezterm.on("bell", function(window, pane)
    local tab = pane:tab()
    if tab then
      bell_tabs[tab:tab_id()] = true
    end
  end)

  -- format-tab-title: registered first so it wins over any later registration.
  -- Replicates the weztty pill style for active/inactive tabs, plus the bell
  -- indicator for unfocused tabs with a pending notification.
  wezterm.on("format-tab-title", function(tab, tabs, panes, cfg, hover, max_width)
    local index    = tostring(tab.tab_index + 1)
    local title    = tab.active_pane.title
    local shortcut = " \u{2318}" .. index  -- ⌘N

    -- Clear bell flag when the tab gains focus
    if tab.is_active then
      bell_tabs[tab.tab_id] = nil
    end

    if tab.is_active then
      -- Active tab: weztty-compatible rounded pill
      local budget = max_width - 6 - #shortcut
      if budget > 0 and #title > budget then
        title = title:sub(1, budget - 1) .. "\u{2026}"
      end
      return {
        { Background = { Color = colors.bar_bg } },
        { Foreground = { Color = colors.bar_bg } },
        { Text = "  " },
        { Foreground = { Color = colors.active_bg } },
        { Text = "\u{e0b6}" },
        { Background = { Color = colors.active_bg } },
        { Foreground = { Color = colors.active_fg } },
        { Text = " " .. title .. shortcut .. " " },
        { Background = { Color = colors.bar_bg } },
        { Foreground = { Color = colors.active_bg } },
        { Text = "\u{e0b4}" },
        { Foreground = { Color = colors.bar_bg } },
        { Text = "  " },
      }
    elseif bell_tabs[tab.tab_id] then
      -- Inactive tab with a pending bell: muted style + bell glyph
      local budget = max_width - 8 - #shortcut
      if budget > 0 and #title > budget then
        title = title:sub(1, budget - 1) .. "\u{2026}"
      end
      return {
        { Background = { Color = colors.bar_bg } },
        { Foreground = { Color = colors.bell_fg } },
        { Text = "   " .. bell_glyph .. " " .. title .. shortcut .. "   " },
      }
    else
      -- Inactive tab, no bell: weztty-compatible borderless muted style
      local budget = max_width - 6 - #shortcut
      if budget > 0 and #title > budget then
        title = title:sub(1, budget - 1) .. "\u{2026}"
      end
      return {
        { Background = { Color = colors.bar_bg } },
        { Foreground = { Color = colors.inactive_fg } },
        { Text = "   " .. title .. shortcut .. "   " },
      }
    end
  end)
end

return M
