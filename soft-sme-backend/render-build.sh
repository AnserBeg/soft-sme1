#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

function log() {
  printf '\n[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

log "Starting Render build for soft-sme-backend"

APT_FILE="${SCRIPT_DIR}/apt.txt"
SKIP_APT_INSTALL="${SKIP_APT_INSTALL:-0}"

if [[ -f "${APT_FILE}" ]]; then
  if [[ "${SKIP_APT_INSTALL}" == "1" ]]; then
    log "apt.txt detected but SKIP_APT_INSTALL=1, skipping package installation"
  else
    log "apt.txt detected. Installing required apt packages"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    xargs -a "${APT_FILE}" -r apt-get install -y --no-install-recommends
    rm -rf /var/lib/apt/lists/*
  fi
else
  log "No apt.txt file detected. Skipping apt package installation"
fi

if [[ -f package-lock.json ]]; then
  log "Installing npm dependencies with npm ci"
  npm ci
else
  log "No package-lock.json found. Falling back to npm install"
  npm install
fi

log "Building TypeScript sources"
npm run build

log "Render build script completed successfully"
