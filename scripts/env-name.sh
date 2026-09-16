#!/usr/bin/env bash
# Print the environment name for a GitHub event. Deploy and cleanup both need the same answer —
# a PR's env must be destroyable by name after the branch is gone — so it lives in one place.
#
# Usage: env-name.sh <event-name> <ref-or-branch> [pr-number]
set -euo pipefail

EVENT="${1:?event name required}"
SOURCE_NAME="${2:?ref or branch required}"
PR_NUMBER="${3:-}"

# Stack names must start with a letter and hold only letters, digits and hyphens.
SANITIZED=$(printf '%s' "$SOURCE_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-20 | sed 's/-$//')
# Branch names collide once sanitized and truncated; the hash keeps each env distinct.
HASH=$(printf '%s' "$SOURCE_NAME" | shasum -a 256 | cut -c1-8)

if [ "$EVENT" = "pull_request" ]; then
  echo "pr-${PR_NUMBER:?pr number required for pull_request}-${HASH}"
else
  echo "branch-${SANITIZED}-${HASH}"
fi
