# Releasing awacxocode

awacxocode is upstream [opencode](https://github.com/anomalyco/opencode) plus a small, scripted
set of changes in `fork/`. Releases ship as platform binaries on GitHub Releases
(`awacxo/awacxocode`); the install script (`code.awacxo.com/install` → `install`) downloads them
from `releases/latest`.

## What lives in `fork/`

| Path              | What it is                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `fork/VERSION`    | Our product version (e.g. `2.0.0`). This is what users see and what tags use. |
| `fork/UPSTREAM`   | The opencode tag we are built on (e.g. `v2.1.3`).                           |
| `fork/overlay/`   | Whole files copied over upstream (our own modules, README, LICENSE, install). |
| `fork/patches.ts` | The only in-place edits to upstream files, each with an id and one anchor.  |
| `fork/upgrade.sh` | Builds a fresh tree: upstream tag + overlay + patches.                      |
| `fork/release.sh` | Builds all targets from that tree and uploads a GitHub release.             |

## Versioning

- `fork/VERSION` is independent of opencode's version. Bump it for every release (patch for
  fixes, minor for an upstream bump or new features, major for breaking changes).
- `fork/UPSTREAM` only changes when you upgrade opencode (below).
- Builds always use `OPENCODE_VERSION=$(cat fork/VERSION)` and `OPENCODE_CHANNEL=awacxocode`.
  The explicit version stops the build from guessing one from npm; the channel gives us a
  background-service port distinct from a real opencode install.
- Tags are `v<VERSION>`. `release.sh` refuses to run if that release (draft or not) exists.

## Cut a release

Requires bun >= 1.4.4, `gh` (authenticated, push access to `awacxo/awacxocode`), `tar`, `zip`.

**Gateway first.** v2 CLIs get their provider, model list and login command from
`https://api.code.awacxo.com/.well-known/opencode`. Deploy the gateway (`gateway/`) and check that
URL returns JSON *before* publishing a v2 release, or `awacxocode login` fails. The model list
now lives only in `gateway/src/models.ts`; changing it needs a gateway deploy, not a CLI release.
For staging, `AWACXOCODE_GATEWAY=<origin>` points the CLI at another gateway.

1. In an upgrade checkout (see below), bump `fork/VERSION` and commit.
2. Push the branch so the tag can point at this exact commit.
3. Build and upload a draft:
   ```bash
   ./fork/release.sh
   ```
   This builds all 12 targets, packs them into `fork-dist/awacxocode-<target>.(tar.gz|zip)` with
   the binary at the archive root, checks there are exactly 12, runs the host binary's
   `--version`, and creates a **draft** release `v<VERSION>` with the archives attached.
4. Review the draft, then publish it:
   ```bash
   gh release edit v<VERSION> --repo awacxo/awacxocode --draft=false --latest
   ```
   (Or pass `--publish` to `release.sh` to do steps 3 and 4 in one go.)
5. Verify: `curl -fsSL https://code.awacxo.com/install | bash && awacxocode --version`.
   Existing users get it via `awacxocode upgrade`.

Asset names must stay exactly as the install script expects: `awacxocode-<target>.tar.gz` for
linux and `awacxocode-<target>.zip` for darwin/windows, with targets `linux-{x64,x64-baseline,
arm64,x64-musl,x64-baseline-musl,arm64-musl}`, `darwin-{arm64,x64,x64-baseline}`,
`windows-{x64,x64-baseline,arm64}`.

## Upgrade upstream opencode

```bash
./fork/upgrade.sh <tag>        # e.g. ./fork/upgrade.sh v2.2.0
```

This creates a git worktree on branch `upgrade/<tag>`, puts upstream `<tag>` in it, copies
`fork/overlay/` over it, applies `fork/patches.ts`, then installs, typechecks, builds and smoke
tests. On success, make sure `fork/UPSTREAM` reads `<tag>`, bump `fork/VERSION`, commit, and
release from that worktree.

**If a patch fails**, the error names the patch id (e.g. `defaults-load`) and the file. Upstream
moved or rewrote that code: open the file in the worktree, find the new equivalent spot, update
that patch's `find` (and `replace` if needed) in `fork/patches.ts`, and re-run `upgrade.sh`.
Keep each patch to one small, exact anchor; anything larger belongs in `fork/overlay/` as a whole
file.

If typecheck or the smoke test fails, the usual cause is an overlay file that depends on an
upstream API that changed — fix the overlay file and re-run.
