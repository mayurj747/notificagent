#!/usr/bin/env bun
import { checkbox, confirm, select } from "@inquirer/prompts"
import chalk from "chalk"
import ora from "ora"
import { existsSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, writeFileSync } from "fs"
import { execSync, spawnSync } from "child_process"
import { resolve, dirname, join } from "path"
import { fileURLToPath } from "url"

// ── Paths ─────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const HOME = process.env.HOME!

const PATHS = {
  opencode:   { plugins: `${HOME}/.config/opencode/plugins`,  config: `${HOME}/.config/opencode` },
  claude:     { hooks:   `${HOME}/.claude/hooks`,             settings: `${HOME}/.claude/settings.json` },
  codex:      { hooks:   `${HOME}/.codex/hooks`,              config: `${HOME}/.codex/config.toml`,     hooks_json: `${HOME}/.codex/hooks.json` },
  wezterm:    { config:  `${HOME}/.config/wezterm`,           lua: `${HOME}/.config/wezterm/wezterm.lua` },
}

// ── Detection ─────────────────────────────────────────────────────────────────

function detect(tool: "opencode" | "claude" | "codex" | "wezterm"): boolean {
  try {
    execSync(`command -v ${tool === "claude" ? "claude" : tool === "opencode" ? "opencode" : tool === "wezterm" ? "wezterm" : "codex"}`, { stdio: "ignore" })
    return true
  } catch {
    // Fall back to checking config dir existence
    const dirs: Record<string, string> = {
      opencode: PATHS.opencode.config,
      claude:   `${HOME}/.claude`,
      codex:    `${HOME}/.codex`,
      wezterm:  PATHS.wezterm.config,
    }
    return existsSync(dirs[tool])
  }
}

// ── Symlink helper ────────────────────────────────────────────────────────────

function symlink(src: string, dst: string) {
  if (existsSync(dst)) unlinkSync(dst)
  symlinkSync(src, dst)
}

// ── Real path (follows symlinks) ──────────────────────────────────────────────

function realpath(p: string): string | null {
  try {
    return execSync(`readlink -f "${p}"`, { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

// ── Tool installers ───────────────────────────────────────────────────────────

function installOpencode() {
  const dst = join(PATHS.opencode.plugins, "notificagent.ts")
  mkdirSync(PATHS.opencode.plugins, { recursive: true })
  symlink(join(REPO_ROOT, "integrations/opencode/index.ts"), dst)
  return `linked ${dst}`
}

function installClaudeCode() {
  const hooksDir = PATHS.claude.hooks
  const settings = PATHS.claude.settings
  mkdirSync(hooksDir, { recursive: true })

  const hookScript = join(hooksDir, "notificagent.sh")
  symlink(join(REPO_ROOT, "integrations/claude-code/hooks/notify.sh"), hookScript)

  // Merge hooks into settings.json
  let cfg: any = {}
  if (existsSync(settings)) {
    cfg = JSON.parse(readFileSync(settings, "utf8"))
  }
  cfg.hooks ??= {}

  const events = ["Stop", "StopFailure", "PermissionRequest"]
  for (const event of events) {
    cfg.hooks[event] ??= []
    const already = (cfg.hooks[event] as any[]).some((group: any) =>
      group.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh"))
    )
    if (!already) {
      cfg.hooks[event].push({ hooks: [{ type: "command", command: hookScript, async: true }] })
    }
  }
  writeFileSync(settings, JSON.stringify(cfg, null, 2) + "\n")
  return `linked hook, merged ${settings}`
}

function installCodex() {
  const hooksDir = PATHS.codex.hooks
  const configToml = PATHS.codex.config
  const hooksJson = PATHS.codex.hooks_json
  mkdirSync(hooksDir, { recursive: true })

  const hookScript = join(hooksDir, "notificagent.sh")
  symlink(join(REPO_ROOT, "integrations/codex/hooks/notify.sh"), hookScript)

  // Enable codex_hooks feature flag
  if (!existsSync(configToml)) {
    writeFileSync(configToml, "[features]\ncodex_hooks = true\n")
  } else {
    const toml = readFileSync(configToml, "utf8")
    if (!toml.includes("codex_hooks")) {
      writeFileSync(configToml, toml + "\n[features]\ncodex_hooks = true\n")
    }
  }

  // Merge hooks.json
  let cfg: any = {}
  if (existsSync(hooksJson)) {
    cfg = JSON.parse(readFileSync(hooksJson, "utf8"))
  }
  cfg.hooks ??= {}

  for (const event of ["Stop", "PermissionRequest"]) {
    cfg.hooks[event] ??= []
    const already = (cfg.hooks[event] as any[]).some((group: any) =>
      group.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh"))
    )
    if (!already) {
      cfg.hooks[event].push({ hooks: [{ type: "command", command: hookScript }] })
    }
  }
  writeFileSync(hooksJson, JSON.stringify(cfg, null, 2) + "\n")
  return `linked hook, merged ${hooksJson}`
}

function installWezterm(): { ok: boolean; message: string; needsManual?: string } {
  const cfgDir = PATHS.wezterm.config
  mkdirSync(cfgDir, { recursive: true })

  // Symlink the Lua plugin
  const pluginDst = join(cfgDir, "notificagent.lua")
  symlink(join(REPO_ROOT, "wezterm/notificagent.lua"), pluginDst)

  // Locate the real wezterm.lua (may be a symlink into a dotfiles/Nix repo)
  const luaLink = PATHS.wezterm.lua
  const realLua = existsSync(luaLink) ? (realpath(luaLink) ?? luaLink) : null

  const snippet =
    `local notificagent = require("notificagent")\n`
  const applySnippet =
    `notificagent.apply_to_config(config)\n`
  const manual =
    chalk.yellow("\n  Add to your wezterm.lua BEFORE weztty.apply_to_config:\n") +
    chalk.cyan(`\n    local notificagent = require("notificagent")\n`) +
    chalk.cyan(`    notificagent.apply_to_config(config)\n`)

  if (!realLua) {
    return { ok: true, message: "plugin linked", needsManual: manual }
  }

  // Already patched?
  const src = readFileSync(realLua, "utf8")
  if (src.includes("notificagent")) {
    return { ok: true, message: `plugin linked, wezterm.lua already patched` }
  }

  // Read-only? (Nix store)
  const result = spawnSync("test", ["-w", realLua], { shell: true })
  if (result.status !== 0) {
    return { ok: true, message: `plugin linked, wezterm.lua is read-only`, needsManual: manual }
  }

  // Patch: insert require before first wezterm.plugin.require line
  let patched = src
  const requireMatch = patched.match(/^(local\s+\w+\s*=\s*wezterm\.plugin\.require\b)/m)
  if (requireMatch?.index != null) {
    patched = patched.slice(0, requireMatch.index) + snippet + "\n" + patched.slice(requireMatch.index)
  } else {
    const configMatch = patched.match(/^(local\s+config\s*=\s*\{)/m)
    if (configMatch?.index != null) {
      patched = patched.slice(0, configMatch.index) + snippet + "\n" + patched.slice(configMatch.index)
    }
  }

  // Insert apply_to_config before first *.apply_to_config(config)
  const applyMatch = patched.match(/^(\w+\.apply_to_config\(config\))/m)
  if (applyMatch?.index != null) {
    patched = patched.slice(0, applyMatch.index) + applySnippet + patched.slice(applyMatch.index)
  } else {
    patched = patched.replace("\nreturn config", `\n${applySnippet}\nreturn config`)
  }

  writeFileSync(realLua, patched)
  return { ok: true, message: `plugin linked, patched ${realLua}` }
}

// ── Uninstallers ──────────────────────────────────────────────────────────────

function uninstallOpencode() {
  const dst = join(PATHS.opencode.plugins, "notificagent.ts")
  if (existsSync(dst)) unlinkSync(dst)
}

function uninstallClaudeCode() {
  const hookScript = join(PATHS.claude.hooks, "notificagent.sh")
  if (existsSync(hookScript)) unlinkSync(hookScript)

  const settings = PATHS.claude.settings
  if (!existsSync(settings)) return
  const cfg = JSON.parse(readFileSync(settings, "utf8"))
  for (const event of ["Stop", "StopFailure", "PermissionRequest"]) {
    if (!cfg.hooks?.[event]) continue
    cfg.hooks[event] = cfg.hooks[event].filter((group: any) =>
      !group.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh"))
    )
  }
  writeFileSync(settings, JSON.stringify(cfg, null, 2) + "\n")
}

function uninstallCodex() {
  const hookScript = join(PATHS.codex.hooks, "notificagent.sh")
  if (existsSync(hookScript)) unlinkSync(hookScript)

  const hooksJson = PATHS.codex.hooks_json
  if (!existsSync(hooksJson)) return
  const cfg = JSON.parse(readFileSync(hooksJson, "utf8"))
  for (const event of ["Stop", "PermissionRequest"]) {
    if (!cfg.hooks?.[event]) continue
    cfg.hooks[event] = cfg.hooks[event].filter((group: any) =>
      !group.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh"))
    )
  }
  writeFileSync(hooksJson, JSON.stringify(cfg, null, 2) + "\n")
}

function uninstallWezterm() {
  const pluginDst = join(PATHS.wezterm.config, "notificagent.lua")
  if (existsSync(pluginDst)) unlinkSync(pluginDst)
  // Note: wezterm.lua patching is not auto-reverted — user removes the two lines manually
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  opencode:    "OpenCode",
  "claude-code": "Claude Code",
  codex:       "Codex",
  wezterm:     "WezTerm  (tab bell indicator)",
}

const TOOL_EVENTS: Record<string, string> = {
  opencode:    "session.idle · session.error · permission.updated",
  "claude-code": "Stop · StopFailure · PermissionRequest",
  codex:       "Stop · PermissionRequest",
  wezterm:     "bell event → format-tab-title indicator",
}

function detected(tool: string): string {
  return detect(tool as any) ? chalk.green("✓ detected") : chalk.dim("not found")
}

function header() {
  console.log()
  console.log(chalk.bold.white("  notificagent") + chalk.dim("  —  chime + WezTerm tab indicator for AI agents"))
  console.log(chalk.dim("  " + "─".repeat(56)))
  console.log()
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  header()

  // Top-level action
  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Install",   value: "install" },
      { name: "Uninstall", value: "uninstall" },
    ],
  })

  // Tool selection — pre-tick detected tools
  const allTools = ["opencode", "claude-code", "codex", "wezterm"]
  const toolChoices = allTools.map(t => ({
    name: `${TOOL_LABELS[t].padEnd(36)} ${detected(t)}`,
    value: t,
    checked: detect(t as any),
    description: chalk.dim(TOOL_EVENTS[t]),
  }))

  const selected = await checkbox({
    message: action === "install" ? "Select integrations to install:" : "Select integrations to uninstall:",
    choices: toolChoices,
    validate: v => v.length > 0 || "Select at least one integration",
  })

  console.log()

  if (action === "install") {
    for (const tool of selected) {
      const spinner = ora({ text: `Installing ${TOOL_LABELS[tool]}…`, color: "cyan" }).start()
      try {
        let result: string | { ok: boolean; message: string; needsManual?: string }

        if (tool === "opencode")    result = installOpencode()
        else if (tool === "claude-code") result = installClaudeCode()
        else if (tool === "codex")  result = installCodex()
        else                        result = installWezterm()

        const msg  = typeof result === "string" ? result : result.message
        const manual = typeof result === "object" ? result.needsManual : undefined

        spinner.succeed(chalk.green(`${TOOL_LABELS[tool]}`) + chalk.dim(`  ${msg}`))
        if (manual) console.log(manual)
      } catch (err: any) {
        spinner.fail(chalk.red(`${TOOL_LABELS[tool]}`) + chalk.dim(`  ${err?.message ?? err}`))
      }
    }
  } else {
    for (const tool of selected) {
      const spinner = ora({ text: `Uninstalling ${TOOL_LABELS[tool]}…`, color: "yellow" }).start()
      try {
        if (tool === "opencode")    uninstallOpencode()
        else if (tool === "claude-code") uninstallClaudeCode()
        else if (tool === "codex")  uninstallCodex()
        else                        uninstallWezterm()

        spinner.succeed(chalk.yellow(`${TOOL_LABELS[tool]}`) + chalk.dim("  removed"))
      } catch (err: any) {
        spinner.fail(chalk.red(`${TOOL_LABELS[tool]}`) + chalk.dim(`  ${err?.message ?? err}`))
      }
    }
  }

  console.log()
  console.log(chalk.bold("  done."))
  console.log()
}

main().catch(err => {
  console.error(chalk.red("fatal:"), err?.message ?? err)
  process.exit(1)
})
