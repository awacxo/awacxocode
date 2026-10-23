#!/usr/bin/env bash
# Cut an awacxocode release from an upgrade checkout.
#
# Usage (from the cli repo root, i.e. the dir that contains fork/ and packages/):
#   ./fork/release.sh             # build all 12 targets, upload to a DRAFT GitHub release
#   ./fork/release.sh --publish   # same, then flip the release to published + latest
#
# The version comes from fork/VERSION (our product version, not opencode's).
# Assets keep the v1 names that `install` downloads:
#   linux:          awacxocode-<target>.tar.gz   (binary `awacxocode` at archive root)
#   darwin/windows: awacxocode-<target>.zip      (`awacxocode` / `awacxocode.exe` at root)
#
# Requires: bun >= 1.4.4, gh (authenticated with push access to the repo), tar, zip.

set -euo pipefail

REPO="awacxo/awacxocode"
CHANNEL="awacxocode"    # distinct channel => distinct background-service port from real opencode
EXPECTED_ASSETS=12
MIN_BUN="1.4.4"

# ---- args --------------------------------------------------------------------
publish=false
for arg in "$@"; do
  case "$arg" in
    --publish) publish=true ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "error: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

# ---- preflight ---------------------------------------------------------------
[ -f fork/VERSION ] && [ -d packages/cli ] \
  || die "run this from the cli repo root of an upgrade checkout (need fork/VERSION and packages/cli)"

root="$(pwd)"
version="$(tr -d '[:space:]' < fork/VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] \
  || die "fork/VERSION does not look like a semver version: '$version'"
tag="v$version"
upstream="$(tr -d '[:space:]' < fork/UPSTREAM 2>/dev/null || echo unknown)"

for cmd in bun gh tar zip; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is not installed"
done

# bun >= MIN_BUN (sort -V puts the smaller version first)
bun_version="$(bun --version)"
if [ "$(printf '%s\n%s\n' "$MIN_BUN" "$bun_version" | sort -V | head -n1)" != "$MIN_BUN" ]; then
  die "bun $bun_version is too old; need >= $MIN_BUN"
fi

gh auth status >/dev/null 2>&1 || die "gh is not authenticated (run: gh auth login)"

# Refuse to reuse a version. `gh release view` also sees drafts, so a half-finished
# earlier run is caught too (delete that draft first if you really want to redo it).
if gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then
  die "release $tag already exists on $REPO (bump fork/VERSION, or delete the draft: gh release delete $tag --repo $REPO)"
fi

if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  echo "warning: working tree has uncommitted changes; the release will include them"
fi

echo "awacxocode $tag  (upstream opencode $upstream, channel $CHANNEL)"

# ---- build -------------------------------------------------------------------
step "Building all targets"
(
  cd packages/cli
  OPENCODE_VERSION="$version" OPENCODE_CHANNEL="$CHANNEL" \
    bun run build --skip-web-ui
)

# ---- archive -----------------------------------------------------------------
step "Archiving binaries into fork-dist/"
dist="$root/packages/cli/dist"
out="$root/fork-dist"
rm -rf "$out"
mkdir -p "$out"

shopt -s nullglob
for dir in "$dist"/cli-*/; do
  dir="${dir%/}"
  target="${dir##*/cli-}"          # e.g. linux-x64-baseline-musl
  bin_dir="$dir/bin"

  case "$target" in
    windows-*) binary="awacxocode.exe" ;;
    *)         binary="awacxocode" ;;
  esac
  [ -f "$bin_dir/$binary" ] || die "missing $bin_dir/$binary (did the binary-name patch apply?)"

  case "$target" in
    linux-*)
      archive="$out/awacxocode-$target.tar.gz"
      # -C so the binary sits at the archive root, not under bin/
      tar -czf "$archive" -C "$bin_dir" "$binary"
      ;;
    darwin-*|windows-*)
      archive="$out/awacxocode-$target.zip"
      # -j junks the path so the binary sits at the archive root
      zip -qj "$archive" "$bin_dir/$binary"
      ;;
    *) die "unexpected target directory: $dir" ;;
  esac
  echo "  $(basename "$archive")"
done
shopt -u nullglob

archives=("$out"/awacxocode-*)
if [ "${#archives[@]}" -ne "$EXPECTED_ASSETS" ]; then
  die "expected $EXPECTED_ASSETS archives, got ${#archives[@]} (see $out)"
fi

# ---- smoke test ----------------------------------------------------------------
step "Smoke test: host binary --version"
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  host_os="linux" ;;
  Darwin) host_os="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) host_os="windows" ;;
  *) die "unknown host OS: $os" ;;
esac
case "$arch" in
  x86_64|amd64)  host_arch="x64" ;;
  aarch64|arm64) host_arch="arm64" ;;
  *) die "unknown host arch: $arch" ;;
esac
host_target="$host_os-$host_arch"
if [ "$host_os" = "linux" ] && ldd --version 2>&1 | grep -qi musl; then
  host_target="$host_target-musl"
fi
host_bin="$dist/cli-$host_target/bin/awacxocode"
[ "$host_os" = "windows" ] && host_bin="$host_bin.exe"

# Older x64 CPUs without AVX2 can't run the default build; fall back to baseline.
if ! got="$("$host_bin" --version 2>&1)" && [ "$host_arch" = "x64" ]; then
  baseline="${host_bin/cli-$host_os-x64/cli-$host_os-x64-baseline}"
  echo "  default build failed to run, trying baseline: $baseline"
  got="$("$baseline" --version 2>&1)" || die "host binary failed to run: $got"
fi
echo "  $got"
[[ "$got" == *"$version"* ]] || die "host binary reports '$got', expected version $version"

# ---- GitHub release ------------------------------------------------------------
step "Creating draft release $tag on $REPO"

# Pin the tag to this exact commit if it is already on the remote; otherwise GitHub
# would create the tag (on publish) from the default branch, which may not be this code.
target_args=()
head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
if [ -n "$head_sha" ] && git fetch --quiet origin 2>/dev/null \
   && [ -n "$(git branch -r --contains "$head_sha" 2>/dev/null)" ]; then
  target_args=(--target "$head_sha")
else
  echo "warning: HEAD is not pushed to origin; the tag will be created from the default branch on publish."
  echo "         Push/merge this branch before publishing if that matters."
fi

gh release create "$tag" "${archives[@]}" \
  --repo "$REPO" \
  --draft \
  --title "$tag" \
  --notes "awacxocode $tag (based on opencode $upstream)" \
  ${target_args[@]+"${target_args[@]}"}   # (this form is safe for an empty array under set -u on bash 3.2)

if [ "$publish" = true ]; then
  step "Publishing $tag as latest"
  gh release edit "$tag" --repo "$REPO" --draft=false --latest
fi

# ---- next steps ----------------------------------------------------------------
echo
echo "Done: $tag (${#archives[@]} assets) on https://github.com/$REPO/releases"
if [ "$publish" = true ]; then
  cat <<EOF

Next steps:
  1. Verify the installer picks it up:
       curl -fsSL https://code.awacxo.com/install | bash
       awacxocode --version      # should print $version
  2. Existing users can update with: awacxocode upgrade
EOF
else
  cat <<EOF

The release is a DRAFT (not visible to the install script yet).
Next steps:
  1. Review assets / edit notes:  gh release view $tag --repo $REPO --web
  2. Optionally test an asset by hand from fork-dist/.
  3. Publish it as latest:
       gh release edit $tag --repo $REPO --draft=false --latest
  4. Verify:  curl -fsSL https://code.awacxo.com/install | bash && awacxocode --version
EOF
fi
