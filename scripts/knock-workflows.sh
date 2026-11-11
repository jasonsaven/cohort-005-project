#!/usr/bin/env bash
# Sync the Knock workflows in knock/workflows/ with Knock's Development
# environment. The repo is the source of truth; the Knock dashboard is not.
#
#   npm run knock:validate   check every workflow without changing Knock
#   npm run knock:push       push and commit every workflow to Development
#   npm run knock:pull       overwrite knock/workflows/ with what Development has
#
# Needs KNOCK_SERVICE_TOKEN in .env (tooling only; the app never reads it).
set -euo pipefail

cd "$(dirname "$0")/.."

WORKFLOWS_DIR="knock/workflows"
ENVIRONMENT="development"

if [ ! -f .env ]; then
  echo "No .env file. Add KNOCK_SERVICE_TOKEN to .env first." >&2
  exit 1
fi

mkdir -p "$WORKFLOWS_DIR"

knock() {
  node --env-file=.env node_modules/.bin/knock "$@"
}

# A workflow can only name a category that is in the account's preference
# category catalog. The upsert is idempotent. Keep in step with knock/README.md.
CATEGORIES=(refunds team discussions)

ensure_categories() {
  local token
  token="$(node --env-file=.env -p 'process.env.KNOCK_SERVICE_TOKEN ?? ""')"
  if [ -z "$token" ]; then
    echo "KNOCK_SERVICE_TOKEN is not set in .env." >&2
    exit 1
  fi
  for category in "${CATEGORIES[@]}"; do
    curl -fsS -X PUT -o /dev/null \
      -H "Authorization: Bearer $token" \
      "https://control.knock.app/v1/preference_categories/$category"
  done
}

has_workflows() {
  find "$WORKFLOWS_DIR" -mindepth 2 -maxdepth 2 -name workflow.json | grep -q .
}

case "${1:-}" in
  validate)
    if ! has_workflows; then
      echo "No workflows in $WORKFLOWS_DIR, nothing to validate."
      exit 0
    fi
    knock workflow validate --all --workflows-dir="$WORKFLOWS_DIR" \
      --environment="$ENVIRONMENT"
    ;;
  push)
    if ! has_workflows; then
      echo "No workflows in $WORKFLOWS_DIR, nothing to push."
      exit 0
    fi
    ensure_categories
    knock workflow push --all --workflows-dir="$WORKFLOWS_DIR" \
      --environment="$ENVIRONMENT" --commit \
      --commit-message="${2:-Push workflows from the repo}"
    ;;
  pull)
    knock workflow pull --all --workflows-dir="$WORKFLOWS_DIR" \
      --environment="$ENVIRONMENT" --force
    ;;
  *)
    echo "Usage: $0 validate|push [commit message]|pull" >&2
    exit 1
    ;;
esac
