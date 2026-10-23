// awacxocode: replaces upstream's upgrade handler, which installs opencode from opencode.ai.
// We reinstall from code.awacxo.com/install (the same script users installed with).
import { intro, log, outro } from "@clack/prompts"
import { Effect, Option } from "effect"
import { spawnSync } from "node:child_process"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { handlePromptErrors } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"

const INSTALL_URL = "https://code.awacxo.com/install"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(
    function* (input) {
      intro("Upgrade awacxocode")
      const target = Option.getOrUndefined(input.target)?.trim().replace(/^v/, "")
      const command = `curl -fsSL ${INSTALL_URL} | bash${target ? ` -s -- --version ${target}` : ""}`
      if (process.platform === "win32") {
        log.info(`Download the latest release from https://code.awacxo.com/download`)
        outro("Done")
        return
      }
      log.info(`Current version: ${OPENCODE_VERSION}`)
      log.step(command)
      const result = spawnSync("bash", ["-c", command], { stdio: "inherit" })
      if (result.status !== 0) return yield* Effect.fail(new Error(`Upgrade failed. Retry with: ${command}`))
      outro("Done")
    },
    (effect) => handlePromptErrors(effect),
  ),
)
