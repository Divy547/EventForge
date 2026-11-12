#!/usr/bin/env bash
# Deploys the latest EventForge release on the production host: refreshes the Compose/Caddy files,
# pulls the images CI published to GHCR, restarts what changed and waits until the stack is healthy.
#
# Run it on the host (from any directory):  ~/EventForge/deploy/deploy.sh
# CI runs it over SSH through a restricted key whose authorized_keys entry is pinned to this
# script (see "Automatic deploys" in docs/deploy-azure-student.md), so it takes no arguments and
# ignores whatever command the SSH client asks for.
#
# Environment (all optional):
#   ENV_FILE            Compose env file (default .env.production, relative to the repo root)
#   COMPOSE_FILE        Compose file(s) (default docker-compose.prod.yml)
#   HEALTH_TIMEOUT_S    Seconds to wait for api and worker to become healthy (default 180)
#
# Output goes to a public CI log, so this script prints container status only: never logs or
# environment values.
set -euo pipefail

# Everything lives in a function and is invoked on the last line. bash reads a script as it runs,
# and `git pull` below can replace this very file; parsing it completely first makes that safe.
main() {
  cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."

  export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
  local env_file="${ENV_FILE:-.env.production}"
  local timeout_s="${HEALTH_TIMEOUT_S:-180}"

  if [[ ! -f "$env_file" ]]; then
    echo "deploy: $env_file not found in $(pwd)" >&2
    exit 1
  fi

  dc() { docker compose --env-file "$env_file" "$@"; }

  # One deploy at a time (a manual run and a CI run, or two quick pushes).
  exec 9>"${TMPDIR:-/tmp}/eventforge-deploy.lock"
  if ! flock -w 300 9; then
    echo "deploy: another deploy has been running for over 5 minutes" >&2
    exit 1
  fi

  echo "==> Updating deployment files"
  git pull --ff-only --quiet
  echo "    at $(git rev-parse --short HEAD)"

  echo "==> Pulling images"
  dc pull --quiet

  echo "==> Starting the stack (migrations run first)"
  dc up -d --no-build

  echo "==> Waiting for api and worker to be healthy (up to ${timeout_s}s)"
  local deadline=$((SECONDS + timeout_s))
  local name status all_ok
  while true; do
    all_ok=true
    for name in eventforge-prod-api eventforge-prod-worker; do
      status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
      [[ "$status" == "healthy" ]] || all_ok=false
    done
    if [[ "$(docker inspect -f '{{.State.Status}}' eventforge-prod-caddy 2>/dev/null || echo missing)" != "running" ]]; then
      all_ok=false
    fi
    if $all_ok; then
      break
    fi
    if ((SECONDS >= deadline)); then
      echo "deploy: stack did not become healthy in ${timeout_s}s" >&2
      dc ps -a >&2
      exit 1
    fi
    sleep 3
  done

  echo "==> Removing unused image layers"
  docker image prune -f >/dev/null

  dc ps
  echo "deploy: done"
}

main "$@"
exit
