#!/usr/bin/env bun
import { existsSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, writeFileSync } from "fs"
import { execSync, spawnSync } from "child_process"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

// -- Bootstrap: ensure npm deps are available -----------------------------------

const DEPS = ["@inquirer/prompts", "chalk", "ora"]

async function ensureDeps() {
  let missing = false
  for (const dep of DEPS) {
    try {
      await import(dep)
    } catch {
      missing = true
      break
    }
  }
  if (!missing) return

  console.log("Installing dependencies (one-time)…")
  const proc = Bun.spawn(["bun", "add", "--global", ...DEPS], {
    stdout: "inherit",
    stderr: "inherit",
  })
  await proc.exited
}

await ensureDeps()

const { checkbox, select } = await import("@inquirer/prompts")
const chalk = (await import("chalk")).default
const ora = (await import("ora")).default

// -- Paths ----------------------------------------------------------------------

const REPO_ROOT = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.HOME!

const PATHS = {
  opencode:  { plugins:  `${HOME}/.config/opencode/plugins`, config: `${HOME}/.config/opencode` },
  claude:    { hooks:    `${HOME}/.claude/hooks`,            settings: `${HOME}/.claude/settings.json` },
  codex:     { hooks:    `${HOME}/.codex/hooks`,             config: `${HOME}/.codex/config.toml`, hooks_json: `${HOME}/.codex/hooks.json` },
  wezterm:   { config:   `${HOME}/.config/wezterm`,          lua: `${HOME}/.config/wezterm/wezterm.lua` },
}

// -- Detection ------------------------------------------------------------------

function detect(tool: "opencode" | "claude" | "codex" | "wezterm"): boolean {
  const bin = tool === "claude" ? "claude" : tool
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" })
    return true
  } catch {
    const dirs: Record<string, string> = {
      opencode: PATHS.opencode.config,
      claude:   `${HOME}/.claude`,
      codex:    `${HOME}/.codex`,
      wezterm:  PATHS.wezterm.config,
    }
    return existsSync(dirs[tool])
  }
}

// -- Helpers --------------------------------------------------------------------

function symlink(src: string, dst: string) {
  if (existsSync(dst)) unlinkSync(dst)
  symlinkSync(src, dst)
}

function realpath(p: string): string | null {
  try { return execSync(`readlink -f "${p}"`, { encoding: "utf8" }).trim() }
  catch { return null }
}

// -- Installers -----------------------------------------------------------------

function installOpencode() {
  mkdirSync(PATHS.opencode.plugins, { recursive: true })
  symlink(join(REPO_ROOT, "integrations/opencode/index.ts"),
          join(PATHS.opencode.plugins, "notificagent.ts"))
  return "plugin linked (auto-loaded from plugins dir)"
}

function installClaudeCode() {
  mkdirSync(PATHS.claude.hooks, { recursive: true })
  const hookScript = join(PATHS.claude.hooks, "notificagent.sh")
  symlink(join(REPO_ROOT, "integrations/claude-code/hooks/notify.sh"), hookScript)

  const settings = PATHS.claude.settings
  const cfg: any = existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")) : {}
  cfg.hooks ??= {}
  for (const event of ["Stop", "StopFailure", "PermissionRequest"]) {
    cfg.hooks[event] ??= []
    const already = cfg.hooks[event].some((g: any) =>
      g.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh")))
    if (!already)
      cfg.hooks[event].push({ hooks: [{ type: "command", command: hookScript, async: true }] })
  }
  writeFileSync(settings, JSON.stringify(cfg, null, 2) + "\n")
  return `hook linked, merged settings.json`
}

function installCodex() {
  mkdirSync(PATHS.codex.hooks, { recursive: true })
  const hookScript = join(PATHS.codex.hooks, "notificagent.sh")
  symlink(join(REPO_ROOT, "integrations/codex/hooks/notify.sh"), hookScript)

  const tomlPath = PATHS.codex.config
  if (!existsSync(tomlPath)) {
    writeFileSync(tomlPath, "[features]\ncodex_hooks = true\n")
  } else {
    const toml = readFileSync(tomlPath, "utf8")
    if (!toml.includes("codex_hooks"))
      writeFileSync(tomlPath, toml + "\n[features]\ncodex_hooks = true\n")
  }

  const hooksJson = PATHS.codex.hooks_json
  const cfg: any = existsSync(hooksJson) ? JSON.parse(readFileSync(hooksJson, "utf8")) : {}
  cfg.hooks ??= {}
  for (const event of ["Stop", "PermissionRequest"]) {
    cfg.hooks[event] ??= []
    const already = cfg.hooks[event].some((g: any) =>
      g.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh")))
    if (!already)
      cfg.hooks[event].push({ hooks: [{ type: "command", command: hookScript }] })
  }
  writeFileSync(hooksJson, JSON.stringify(cfg, null, 2) + "\n")
  return `hook linked, merged hooks.json`
}

function installWezterm(): { message: string; needsManual?: string } {
  mkdirSync(PATHS.wezterm.config, { recursive: true })
  symlink(join(REPO_ROOT, "wezterm/notificagent.lua"),
          join(PATHS.wezterm.config, "notificagent.lua"))

  const luaLink = PATHS.wezterm.lua
  const realLua = existsSync(luaLink) ? (realpath(luaLink) ?? luaLink) : null

  const manual =
    chalk.dim("\n  Add to wezterm.lua (must load first — it registers format-tab-title):\n") +
    chalk.cyan("\n    local notificagent = require(\"notificagent\")\n") +
    chalk.cyan("    notificagent.apply_to_config(config)\n")

  if (!realLua) return { message: "plugin linked", needsManual: manual }

  const src = readFileSync(realLua, "utf8")
  if (src.includes("notificagent")) return { message: "plugin linked, wezterm.lua already patched" }

  if (spawnSync("test", ["-w", realLua], { shell: true }).status !== 0)
    return { message: "plugin linked, wezterm.lua is read-only", needsManual: manual }

  let patched = src
  const requireMatch = patched.match(/^(local\s+\w+\s*=\s*wezterm\.plugin\.require\b)/m)
  if (requireMatch?.index != null) {
    patched = patched.slice(0, requireMatch.index) +
      `local notificagent = require("notificagent")\n\n` +
      patched.slice(requireMatch.index)
  } else {
    const configMatch = patched.match(/^(local\s+config\s*=\s*\{)/m)
    if (configMatch?.index != null)
      patched = patched.slice(0, configMatch.index) +
        `local notificagent = require("notificagent")\n\n` +
        patched.slice(configMatch.index)
  }

  const applyMatch = patched.match(/^(\w+\.apply_to_config\(config\))/m)
  if (applyMatch?.index != null)
    patched = patched.slice(0, applyMatch.index) +
      `notificagent.apply_to_config(config)\n` +
      patched.slice(applyMatch.index)
  else
    patched = patched.replace("\nreturn config", "\nnotificagent.apply_to_config(config)\n\nreturn config")

  writeFileSync(realLua, patched)
  return { message: `plugin linked, patched ${realLua}` }
}

// -- Uninstallers ---------------------------------------------------------------

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
    cfg.hooks[event] = cfg.hooks[event].filter((g: any) =>
      !g.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh")))
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
    cfg.hooks[event] = cfg.hooks[event].filter((g: any) =>
      !g.hooks?.some((h: any) => (h.command ?? "").endsWith("notificagent.sh")))
  }
  writeFileSync(hooksJson, JSON.stringify(cfg, null, 2) + "\n")
}

function uninstallWezterm() {
  const pluginDst = join(PATHS.wezterm.config, "notificagent.lua")
  if (existsSync(pluginDst)) unlinkSync(pluginDst)
}

// -- UI -------------------------------------------------------------------------

const TOOLS = [
  { key: "opencode",    label: "OpenCode",                    events: "session.idle · session.error · permission.updated" },
  { key: "claude-code", label: "Claude Code",                 events: "Stop · StopFailure · PermissionRequest" },
  { key: "codex",       label: "Codex",                       events: "Stop · PermissionRequest" },
  { key: "wezterm",     label: "WezTerm  (tab bell indicator)", events: "bell → format-tab-title indicator" },
]

type ToolKey = "opencode" | "claude" | "codex" | "wezterm"

function detectedBadge(key: string): string {
  const detectKey = key === "claude-code" ? "claude" : key
  return detect(detectKey as ToolKey)
    ? chalk.green("✓ detected")
    : chalk.dim("· not found")
}

async function main() {
  console.log()
  console.log(chalk.bold("  notificagent") + chalk.dim("  —  chime + WezTerm tab indicator for AI agents"))
  console.log(chalk.dim("  " + "─".repeat(56)))
  console.log()

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Install",   value: "install" },
      { name: "Uninstall", value: "uninstall" },
    ],
  })

  const selected = await checkbox({
    message: action === "install" ? "Select integrations to install:" : "Select integrations to uninstall:",
    choices: TOOLS.map(t => ({
      name:        `${t.label.padEnd(36)}${detectedBadge(t.key)}`,
      value:       t.key,
      checked:     detect((t.key === "claude-code" ? "claude" : t.key) as ToolKey),
      description: chalk.dim(t.events),
    })),
    validate: v => v.length > 0 || "Select at least one integration",
  })

  console.log()

  for (const key of selected) {
    const label = TOOLS.find(t => t.key === key)!.label
    const spinner = ora({ text: `${action === "install" ? "Installing" : "Uninstalling"} ${label}…`, color: "cyan" }).start()

    try {
      if (action === "install") {
        let result: string | { message: string; needsManual?: string }
        if      (key === "opencode")    result = installOpencode()
        else if (key === "claude-code") result = installClaudeCode()
        else if (key === "codex")       result = installCodex()
        else                            result = installWezterm()

        const msg    = typeof result === "string" ? result : result.message
        const manual = typeof result === "object"  ? result.needsManual : undefined

        spinner.succeed(chalk.green(label) + chalk.dim(`  ${msg}`))
        if (manual) console.log(manual)
      } else {
        if      (key === "opencode")    uninstallOpencode()
        else if (key === "claude-code") uninstallClaudeCode()
        else if (key === "codex")       uninstallCodex()
        else                            uninstallWezterm()

        spinner.succeed(chalk.yellow(label) + chalk.dim("  removed"))
      }
    } catch (err: any) {
      spinner.fail(chalk.red(label) + chalk.dim(`  ${err?.message ?? err}`))
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
