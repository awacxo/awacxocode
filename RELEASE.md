# Releasing awacxocode

The CLI ships as platform binaries on **GitHub Releases**. The install script
(`code.awacxo.com/install` → `cli/install`) downloads them from `releases/latest`.
That's the whole MVP — npm/Homebrew/AUR are optional and covered at the bottom.

## One-time setup

1. **Create a GitHub repo** for the CLI (e.g. `yourname/awacxocode`) and push `cli/` to it.
2. **Point the install script at it.** In `install`, set:
   ```bash
   GITHUB_REPO="${GITHUB_REPO:-yourname/awacxocode}"
   ```
3. **Serve the install script** at `https://code.awacxo.com/install` (a redirect/proxy to the
   raw `install` file, or copy it into the website's `public/`).

No secrets are needed for GitHub Releases — the workflow uses the built-in `GITHUB_TOKEN`.

## Cut a release (CI — recommended)

1. Go to the repo's **Actions → release → Run workflow**.
2. Enter a version, e.g. `1.0.0`.

The workflow (`.github/workflows/release.yml`) builds every platform (Bun cross-compiles
linux/macOS/windows × x64/arm64 from one Linux runner), uploads the archives, and marks the
release `latest`. After it finishes:

```bash
curl -fsSL https://code.awacxo.com/install | bash
```

## Cut a release (local alternative)

Requires `bun`, `gh` (authenticated), and push access to the repo.

```bash
cd cli
bun install
REPO=yourname/awacxocode VERSION=1.0.0
gh release create "v$VERSION" --repo "$REPO" --title "v$VERSION" --notes "awacxocode v$VERSION" --draft

cd packages/opencode
OPENCODE_VERSION=$VERSION OPENCODE_RELEASE=1 GH_REPO=$REPO GH_TOKEN=$(gh auth token) \
  bun run build --skip-embed-web-ui

gh release edit "v$VERSION" --repo "$REPO" --draft=false --latest
```

## How versioning works

`OPENCODE_VERSION` is read verbatim — always pass it. (Without it, the build tries to fetch the
last `opencode-ai` version from npm to auto-bump, which is wrong for this fork.)
`OPENCODE_RELEASE=1` is what triggers the archive + upload step in `build.ts`.

## Notes

- `--skip-embed-web-ui` keeps the binary lean (TUI only). Drop it to bundle the optional
  browser web UI (slower build, builds `packages/app`).
- The other workflows under `.github/workflows/` are opencode's and are guarded with
  `if: github.repository == 'anomalyco/opencode'`, so they stay inert on your fork. You can
  delete them to declutter.

## Optional: npm distribution (later)

`packages/opencode/script/publish.ts` publishes the CLI to npm as `awacxocode-ai` plus one
package per platform (it appends `-ai` to the package name and wires a `postinstall.mjs`).
It also pushes Docker/AUR/Homebrew — all hardcoded to opencode's repos; strip those before
using it. Skip npm entirely until the `curl | bash` flow is live.
