// awacxocode preflight: imported first from src/index.ts (see fork/patches.ts "preflight-import"),
// so it runs before the CLI parses argv. Keep this file dependency-free.
import path from "node:path"
import { spawn } from "node:child_process"

const GATEWAY = process.env["AWACXOCODE_GATEWAY"] ?? "https://api.code.awacxo.com"

// Upstream's background update check would install opencode over us; updates come from
// `awacxocode upgrade` (code.awacxo.com/install) instead.
process.env["OPENCODE_DISABLE_AUTOUPDATE"] ??= "1"

// The gateway's well-known manifest logs in by running `awacxocode __device-login`. That command
// is spawned by the background service, so make sure this binary resolves by name even when it
// isn't on the user's PATH (e.g. run from a download folder).
if (path.basename(process.execPath).startsWith("awacxocode"))
  process.env["PATH"] = [path.dirname(process.execPath), process.env["PATH"]].filter(Boolean).join(path.delimiter)

const [command, ...rest] = process.argv.slice(2)

// Friendly aliases for the well-known integration.
if (command === "login") process.argv.splice(2, process.argv.length, "auth", "login", GATEWAY, ...rest)
if (command === "logout") process.argv.splice(2, process.argv.length, "auth", "logout", GATEWAY, ...rest)

// Device authorization against the gateway. Status goes to stderr (shown by `auth login`),
// the issued API key to stdout (stored by opencode as the integration credential).
if (command === "__device-login") {
  try {
    process.stdout.write((await deviceLogin()) + "\n")
    process.exit(0)
  } catch (error) {
    process.stderr.write(`awacxocode login failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

interface StartResponse {
  device_code: string
  user_code: string
  verification_uri_complete: string
  interval?: number
  expires_in?: number
}

async function deviceLogin() {
  const res = await fetch(`${GATEWAY}/cli/auth/start`, { method: "POST" })
  if (!res.ok) throw new Error(`could not reach awacxocode (gateway returned ${res.status})`)
  const start = (await res.json()) as StartResponse

  process.stderr.write(`Your code: ${start.user_code}\n`)
  process.stderr.write(`Approve this device at: ${start.verification_uri_complete}\n`)
  openBrowser(start.verification_uri_complete)

  const deadline = Date.now() + (start.expires_in ?? 600) * 1000
  const wait = Math.max(1, start.interval ?? 2) * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, wait))
    const poll = await fetch(`${GATEWAY}/cli/auth/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: start.device_code }),
    })
    const data = (await poll.json().catch(() => ({}))) as { status?: string; api_key?: string }
    if (data.status === "approved" && data.api_key) return data.api_key
    if (data.status === "expired") throw new Error("the request expired - run `awacxocode login` again")
    if (data.status === "denied") throw new Error("the request was denied")
    // pending / not_found (race) -> keep polling
  }
  throw new Error("timed out waiting for approval")
}

// Best-effort; the URL is also printed for manual opening.
function openBrowser(url: string) {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref()
  } catch {
    /* ignore - the URL was printed */
  }
}
