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
