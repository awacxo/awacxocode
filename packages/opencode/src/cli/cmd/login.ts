import { Auth } from "../../auth"
import { CliError, effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import * as Prompt from "../effect/prompt"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import { Effect } from "effect"

// The hosted awacxocode gateway. Override for local/staging via env.
const GATEWAY = process.env["AWACXOCODE_GATEWAY"] ?? "https://api.code.awacxo.com"

// The provider id this CLI is locked to (see config.ts loadGlobal).
const PROVIDER = "awacxocode"

const cliTry = <Value>(message: string, fn: () => PromiseLike<Value>) =>
  Effect.tryPromise({
    try: fn,
    catch: (error) => new CliError({ message: message + errorMessage(error) }),
  })

interface StartResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  interval: number
  expires_in: number
}

// Best-effort open the browser; the URL is also printed for manual opening.
const openBrowser = (url: string) =>
  Effect.sync(() => {
    try {
      const cmd =
        process.platform === "darwin"
          ? ["open", url]
          : process.platform === "win32"
            ? ["cmd", "/c", "start", "", url]
            : ["xdg-open", url]
      Process.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    } catch {
      /* ignore — the URL was printed for manual open */
    }
  })

// Poll the gateway until the user approves in the browser (or it expires).
async function pollForKey(deviceCode: string, interval: number, expiresIn: number): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000
  const wait = Math.max(1, interval) * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    const res = await fetch(`${GATEWAY}/cli/auth/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    })
    const data = (await res.json().catch(() => ({}))) as { status?: string; api_key?: string }
    if (data.status === "approved" && data.api_key) return data.api_key
    if (data.status === "expired") throw new Error("the request expired — run `awacxocode login` again")
    if (data.status === "denied") throw new Error("the request was denied")
    // pending / not_found(race) → keep polling
  }
  throw new Error("timed out waiting for approval")
}

export const LoginCommand = effectCmd({
  command: "login",
  describe: "sign in to awacxocode",
  // No project instance needed — this only touches global credentials.
  instance: false,
  handler: Effect.fn("Cli.login")(function* (_args) {
    const authSvc = yield* Auth.Service

    UI.empty()
    yield* Prompt.intro("Sign in to awacxocode")

    const start = yield* cliTry("Could not reach awacxocode: ", () =>
      fetch(`${GATEWAY}/cli/auth/start`, { method: "POST" }).then(async (r) => {
        if (!r.ok) throw new Error(`gateway returned ${r.status}`)
        return (await r.json()) as StartResponse
      }),
    )

    yield* Prompt.log.info(`Your code: ${UI.Style.TEXT_HIGHLIGHT}${start.user_code}`)
    yield* Prompt.log.info(`Opening ${UI.Style.TEXT_INFO}${start.verification_uri_complete}`)
    yield* openBrowser(start.verification_uri_complete)
    yield* Prompt.log.info("If the browser didn't open, paste that URL into it to approve this device.")

    const spinner = Prompt.spinner()
    yield* spinner.start("Waiting for approval in the browser…")

    const key = yield* cliTry("Login failed: ", () =>
      pollForKey(start.device_code, start.interval ?? 2, start.expires_in ?? 600),
    )

    yield* spinner.stop("Approved")
    yield* Effect.orDie(authSvc.set(PROVIDER, { type: "api", key }))
    yield* Prompt.outro("You're signed in. Run `awacxocode` to start coding.")
  }),
})

export const LogoutCommand = effectCmd({
  command: "logout",
  describe: "sign out of awacxocode",
  instance: false,
  handler: Effect.fn("Cli.logout")(function* (_args) {
    const authSvc = yield* Auth.Service
    yield* Effect.orDie(authSvc.remove(PROVIDER))
    yield* Prompt.log.success("Signed out of awacxocode.")
  }),
})
