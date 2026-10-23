#!/usr/bin/env bash
# Rebuild awacxocode on top of an upstream opencode release.
#
#   ./fork/upgrade.sh <upstream-tag> [--dir <path>] [--skip-typecheck] [--skip-build] [--commit]
#
# Creates a git worktree (default ../cli-upgrade-<tag>) on branch upgrade/<tag>, branched from
# the current HEAD, whose tree is: upstream <tag> + fork/overlay/ + fork/patches.ts. Then installs
# deps, typechecks, builds the host binary and smoke-tests it. Your current checkout is untouched.
#
# If a patch no longer matches upstream it stops and names the patch id; fix that anchor in
# fork/patches.ts (in this checkout) and re-run with the same tag.
set -euo pipefail

TAG=""
DIR=""
SKIP_TYPECHECK=0
SKIP_BUILD=0
COMMIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --skip-typecheck) SKIP_TYPECHECK=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --commit) COMMIT=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) TAG="$1"; shift ;;
  esac
done
[ -n "$TAG" ] || { echo "usage: fork/upgrade.sh <upstream-tag> (e.g. v2.1.3)" >&2; exit 2; }

REPO=$(git rev-parse --show-toplevel)
FORK="$REPO/fork"
DIR=${DIR:-"$(dirname "$REPO")/cli-upgrade-$TAG"}
BRANCH="upgrade/$TAG"
VERSION=$(cat "$FORK/VERSION")

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

command -v bun >/dev/null || fail "bun is not installed"
git -C "$REPO" remote get-url upstream >/dev/null 2>&1 \
  || fail "no 'upstream' remote; add it: git remote add upstream https://github.com/sst/opencode.git"

step "Fetching upstream $TAG"
git -C "$REPO" fetch --depth=1 --no-tags upstream "refs/tags/$TAG:refs/tags/$TAG" 2>&1 | tail -2 || true
git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null || fail "upstream tag $TAG not found"

step "Preparing worktree $DIR (branch $BRANCH)"
if [ -e "$DIR" ]; then
  fail "$DIR already exists. Remove it first: git worktree remove --force $DIR && git branch -D $BRANCH"
fi
git -C "$REPO" worktree add -q -b "$BRANCH" "$DIR" HEAD
cd "$DIR"
# Replace the whole tree with upstream's, keeping history linear on top of our branch.
git rm -rq --ignore-unmatch -- .
git clean -fdq
git checkout "$TAG" -- .

step "Applying fork/overlay"
rm -rf fork
mkdir fork
# Copy this checkout's fork/ (including uncommitted edits) but not build output.
(cd "$FORK" && tar --exclude=./fork-dist -cf - .) | (cd fork && tar -xf -)
echo "$TAG" > fork/UPSTREAM
cp -R fork/overlay/. .

step "Applying fork/patches.ts"
bun fork/patches.ts . || fail "patches failed (see above). Fix fork/patches.ts in $REPO, then: git worktree remove --force $DIR && git branch -D $BRANCH && re-run"

step "Installing dependencies"
bun install 2>&1 | tail -3

if [ "$SKIP_TYPECHECK" = 0 ]; then
  step "Typechecking packages/cli (and its project references)"
  (cd packages/cli && bun run typecheck) || fail "typecheck failed - usually an overlay file whose upstream API changed"
fi

if [ "$SKIP_BUILD" = 0 ]; then
  step "Building host binary (awacxocode $VERSION on opencode $TAG)"
  (cd packages/cli && OPENCODE_VERSION="$VERSION" OPENCODE_CHANNEL=awacxocode \
    bun run build --single --skip-install --skip-web-ui 2>&1 | tail -3)
  BIN=$(ls -d packages/cli/dist/cli-*/bin/awacxocode 2>/dev/null | head -1)
  [ -x "$BIN" ] || fail "build produced no awacxocode binary"

  step "Smoke testing $BIN"
  HOME_DIR=$(mktemp -d)
  run() { HOME="$HOME_DIR" XDG_CONFIG_HOME= XDG_DATA_HOME= XDG_STATE_HOME= XDG_CACHE_HOME= timeout 120 "$BIN" "$@"; }
  run --version | tee /dev/stderr | grep -q "$VERSION" || fail "--version does not report $VERSION"
  run --help | grep -q "awacxocode" || fail "--help does not mention awacxocode"
  models=$(run models --standalone 2>&1 || true)
  if echo "$models" | grep -q '^opencode/'; then fail "upstream opencode models are visible (provider lock broken):
$models"; fi
  [ -d "$HOME_DIR/.local/share/awacxocode" ] || fail "data dir is not ~/.local/share/awacxocode"
  [ ! -d "$HOME_DIR/.local/share/opencode" ] || fail "binary still writes ~/.local/share/opencode"
  rm -rf "$HOME_DIR"
  echo "smoke tests passed"
fi

git add -A
if [ "$COMMIT" = 1 ]; then
  git commit -qm "Upgrade to opencode $TAG" && step "Committed on $BRANCH"
fi

step "Done: awacxocode $VERSION on opencode $TAG in $DIR"
cat <<EOF
Next:
  cd $DIR
  ./packages/cli/dist/cli-*/bin/awacxocode        # try it
  git commit -m "Upgrade to opencode $TAG"        # if you didn't pass --commit
  ./fork/release.sh                               # draft GitHub release (bump fork/VERSION first)
Then merge $BRANCH into main.
EOF
