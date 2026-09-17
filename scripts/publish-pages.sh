#!/usr/bin/env bash
#
# Publish web/dist to the gh-pages branch.
#
# gh-pages is disposable generated output. It holds the built site and nothing else:
# no Solidity, no Foundry project, no scripts, no .env. This script never checks that
# branch out. It builds a commit directly from the build directory using a scratch
# index, so your working tree and your current branch are untouched throughout.
#
# Usage:
#   scripts/publish-pages.sh              # build and push gh-pages
#   scripts/publish-pages.sh --no-push    # build and commit locally, do not push
#   BRANCH=docs scripts/publish-pages.sh  # publish to a different branch
#
set -euo pipefail

BRANCH="${BRANCH:-gh-pages}"
REMOTE="${REMOTE:-origin}"
PUSH=1
[ "${1:-}" = "--no-push" ] && PUSH=0

cd "$(git rev-parse --show-toplevel)"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Verify repository state -------------------------------------------------
say "Checking repository state"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
[ -d web ] || die "no web/ directory - run this from the project root"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "    note: working tree has uncommitted changes."
  echo "    The published site is built from the files on disk, not from HEAD."
fi

SOURCE_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
SOURCE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# 2. Install frontend dependencies -------------------------------------------
say "Installing frontend dependencies"
if [ -f web/package-lock.json ]; then
  npm --prefix web ci --silent
else
  npm --prefix web install --silent
fi

# 3. Refresh proofs, then build ----------------------------------------------
# Regenerating first means the published allowlist always matches allowlist/addresses.json.
if [ -f allowlist/generate-merkle.ts ] && [ -d node_modules ]; then
  say "Regenerating Merkle proofs"
  npm run --silent merkle
fi

# The claim page draws each student's card from layers the generator exports. They
# are derived, so they are rebuilt here, from the checkout being published.
say "Exporting card layers"
if [ -f generator/package-lock.json ]; then
  npm --prefix generator ci --silent
else
  npm --prefix generator install --silent
fi
npm --prefix generator run --silent prepare-assets
npm --prefix generator run --silent export-web

say "Building web/"
npm --prefix web run build

# 4. Validate the build ------------------------------------------------------
say "Validating build output"
[ -f web/dist/index.html ] || die "web/dist/index.html is missing - the build produced nothing"
[ -d web/dist/assets ] || die "web/dist/assets/ is missing - the build looks incomplete"
grep -q 'assets/' web/dist/index.html || die "web/dist/index.html references no assets"
[ -f web/dist/nft/index.json ] || die "web/dist/nft/ is missing - the page could not draw cards"

# 5. Stage exactly the build output ------------------------------------------
say "Staging build output"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE" "${SCRATCH_INDEX:-}"' EXIT

cp -R web/dist/. "$STAGE/"

# GitHub Pages runs Jekyll unless told not to, and Jekyll hides files and folders
# whose names begin with an underscore - which Vite is free to emit.
touch "$STAGE/.nojekyll"

# Belt and braces: refuse to publish anything that looks like a secret.
if find "$STAGE" -name '.env*' -o -name '*.key' -o -name 'id_rsa*' | grep -q .; then
  die "build output contains something that looks like a secret - refusing to publish"
fi

echo "    Publishing:"
(cd "$STAGE" && find . -type f -not -path './nft/*' | sed 's|^\./|      |' | sort)
echo "      nft/: $(find "$STAGE/nft" -type f | wc -l | tr -d ' ') card layer files"

# 6. Commit the tree without checking the branch out -------------------------
say "Building $BRANCH commit"
SCRATCH_INDEX="$(mktemp -u)"
export GIT_INDEX_FILE="$SCRATCH_INDEX"

git --work-tree="$STAGE" add --all --force
TREE="$(git --work-tree="$STAGE" write-tree)"

MESSAGE="Publish site from ${SOURCE_BRANCH}@${SOURCE_REF}"
if PARENT="$(git rev-parse --verify --quiet "refs/heads/$BRANCH")"; then
  if [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
    say "No change since the last publish - nothing to do"
    exit 0
  fi
  COMMIT="$(git commit-tree "$TREE" -p "$PARENT" -m "$MESSAGE")"
else
  # First publish: an orphan commit, so gh-pages shares no history with main.
  COMMIT="$(git commit-tree "$TREE" -m "$MESSAGE")"
fi

unset GIT_INDEX_FILE
git update-ref "refs/heads/$BRANCH" "$COMMIT"
say "Updated refs/heads/$BRANCH -> $(git rev-parse --short "$COMMIT")"

# 7. Push --------------------------------------------------------------------
if [ "$PUSH" -eq 0 ]; then
  say "Skipping push (--no-push). Push later with: git push $REMOTE $BRANCH"
  exit 0
fi

git remote get-url "$REMOTE" >/dev/null 2>&1 || die "no remote named '$REMOTE'"
say "Pushing to $REMOTE/$BRANCH"
git push "$REMOTE" "$BRANCH"

cat <<DONE

Published. If this is the first time, enable it once in GitHub:
  Settings -> Pages -> Deploy from a branch -> $BRANCH -> /(root)
DONE
