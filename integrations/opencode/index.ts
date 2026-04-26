import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { resolve, dirname } from "path"
import type { Plugin } from "@opencode-ai/plugin"

// Resolve the backend script relative to this plugin file.
// __filename handles both direct .ts execution (via Bun) and symlinked files —
// Bun resolves import.meta.url to the real file path, so we walk up from
// integrations/opencode/ to the repo root.
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const BACKEND = resolve(PLUGIN_DIR, "../../backend/notificagent")

function notify(event: "complete" | "error" | "permission") {
  try {
    execSync(`"${BACKEND}" ${event}`, { stdio: "ignore" })
  } catch {
    // Notifications are best-effort — never let a failure interrupt the agent
  }
}

export const NotificagentPlugin: Plugin = async (_ctx) => {
  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.idle":
          notify("complete")
          break

        case "session.error":
          notify("error")
          break

        case "permission.updated": {
          // Only notify when a new permission request is pending (status: "ask")
          const props = (event as any).properties
          if (props?.status === "ask") {
            notify("permission")
          }
          break
        }
      }
    },
  }
}
