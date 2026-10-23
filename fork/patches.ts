#!/usr/bin/env bun
// awacxocode fork patches: the ONLY edits we make to upstream opencode files.
//
// Everything else we change is a whole file in fork/overlay/ (copied over upstream).
// Each patch names one exact anchor in upstream code. If upstream moves or rewrites
// that code, the patch fails loudly with its id; fix the anchor here and re-run.
//
// Usage: bun fork/patches.ts <tree-root>      (run by fork/upgrade.sh)

import path from "node:path"

const GATEWAY = "https://api.code.awacxo.com"
// Patched code resolves the gateway at runtime so staging/tests can point elsewhere (same env as preflight.ts).
const GATEWAY_EXPR = `(process.env["AWACXOCODE_GATEWAY"] ?? ${JSON.stringify(GATEWAY)})`

interface Patch {
  id: string
  file: string
  why: string
  find: string | RegExp
  replace: string
  /** Expected number of matches (default 1). The patch fails on any other count. */
  count?: number
}

const patches: Patch[] = [
  // ---- binary / identity -------------------------------------------------------
  {
    id: "binary-name",
    file: "packages/cli/script/build.ts",
    why: "compiled binary is named awacxocode",
    find: `const binary = "opencode"`,
    replace: `const binary = "awacxocode"`,
  },
  {
    id: "cli-name",
    file: "packages/cli/script/build.ts",
    why: "help/usage prints `awacxocode`",
    find: `OPENCODE_CLI_NAME: "'opencode'"`,
    replace: `OPENCODE_CLI_NAME: "'awacxocode'"`,
  },
  {
    id: "cli-description",
    file: "packages/cli/src/commands/commands.ts",
    why: "top-line description in --help",
    find: `description: "OpenCode command line interface"`,
    replace: `description: "awacxocode - AI coding agent for your terminal"`,
  },
  {
    id: "data-dir",
    file: "packages/util/src/global.ts",
    why: "own data/config/state dirs, so we never share a DB or background service with a real opencode install",
    find: `const app = "opencode"`,
    replace: `const app = "awacxocode"`,
  },

  // ---- startup hook ------------------------------------------------------------
  {
    id: "preflight-import",
    file: "packages/cli/src/index.ts",
    why: "fork/overlay/packages/cli/src/awacxo/preflight.ts runs before argv is parsed (login alias, device login, env defaults)",
    find: /^(#!\/usr\/bin\/env bun\n\n)/,
    replace: `$1import "./awacxo/preflight"\n`,
  },

  // ---- provider lock -----------------------------------------------------------
  {
    id: "defaults-import",
    file: "packages/core/src/config.ts",
    why: "built-in base config (fork/overlay/packages/core/src/awacxo-defaults.ts)",
    find: `import { WellKnown } from "./wellknown.js"\n`,
    replace: `import { WellKnown } from "./wellknown.js"\nimport { AwacxoDefaults } from "./awacxo-defaults.js"\n`,
  },
  {
    id: "defaults-load",
    file: "packages/core/src/config.ts",
    why: "load the built-in base config right after managed policies: lowest priority for settings, top authority for its provider lock",
    find: /(\n(\s*)\.\.\.managedPolicies,\n)(\s*\.\.\.\(yield\* loadWellknown\(\))/,
    replace: `$1$2...(yield* parseInfo(JSON.stringify(AwacxoDefaults), "awacxocode-defaults").pipe(\n$2  Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),\n$2  Effect.orDie,\n$2)),\n$3`,
  },

  // ---- gateway as a pre-registered well-known source ---------------------------
  {
    id: "wellknown-default-origin",
    file: "packages/core/src/wellknown.ts",
    why: `${GATEWAY} is a well-known source out of the box, so it shows up in /connect and \`auth login\``,
    find: `const origins = Schema.is(Sources)(value) ? value : []`,
    replace: `const origins = Schema.is(Sources)(value) ? value : [${GATEWAY_EXPR}]`,
    count: 2,
  },
  {
    id: "wellknown-name",
    file: "packages/core/src/wellknown/plugin.ts",
    why: "integration shows as `awacxocode` rather than the gateway hostname",
    find: `integration.name = new URL(entry.origin).hostname`,
    replace: `integration.name = entry.origin === ${GATEWAY_EXPR} ? "awacxocode" : new URL(entry.origin).hostname`,
  },

  // ---- updates come from code.awacxo.com, never opencode.ai --------------------
  {
    id: "updater-check",
    file: "packages/cli/src/services/updater.ts",
    why: "the TUI's update check would otherwise offer to install upstream opencode over our binary",
    find: `const check = Effect.fn("cli.updater.check")(function* () {\n`,
    replace: `const check = Effect.fn("cli.updater.check")(function* () {\n    if (true as boolean)\n      return { type: "unavailable" as const, message: "Run \`awacxocode upgrade\` to update awacxocode." }\n`,
  },
]

function count(text: string, find: string | RegExp) {
  if (typeof find === "string") return text.split(find).length - 1
  return [...text.matchAll(new RegExp(find.source, find.flags.includes("g") ? find.flags : find.flags + "g"))].length
}

const root = process.argv[2]
if (!root) {
  console.error("usage: bun fork/patches.ts <tree-root>")
  process.exit(2)
}

const failures: string[] = []
for (const patch of patches) {
  const file = path.join(root, patch.file)
  const handle = Bun.file(file)
  if (!(await handle.exists())) {
    failures.push(`[${patch.id}] file not found: ${patch.file}\n    why: ${patch.why}`)
    continue
  }
  const text = await handle.text()
  const expected = patch.count ?? 1
  const found = count(text, patch.find)
  if (found !== expected) {
    failures.push(
      `[${patch.id}] expected ${expected} match(es), found ${found} in ${patch.file}\n` +
        `    anchor: ${String(patch.find).slice(0, 160)}\n    why: ${patch.why}`,
    )
    continue
  }
  const next =
    typeof patch.find === "string" ? text.replaceAll(patch.find, patch.replace) : text.replace(patch.find, patch.replace)
  await Bun.write(file, next)
  console.log(`  ok  ${patch.id}`)
}

if (failures.length) {
  console.error(`\n${failures.length} patch(es) no longer match upstream:\n`)
  for (const failure of failures) console.error("  " + failure + "\n")
  console.error("Find where upstream moved that code, update the anchor in fork/patches.ts, and re-run.")
  process.exit(1)
}
console.log(`applied ${patches.length} patches`)
