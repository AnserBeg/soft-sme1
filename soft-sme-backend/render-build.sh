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

function can_use_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get is not available in this environment"
    return 1
  fi

  local apt_lists_dir="/var/lib/apt/lists"
  if [[ ! -d "${apt_lists_dir}" ]]; then
    if ! mkdir -p "${apt_lists_dir}" 2>/dev/null; then
      log "Unable to create ${apt_lists_dir}; filesystem may be read-only"
      return 1
    fi
  fi

  local writability_probe="${apt_lists_dir}/.apt-writability-check"
  if ! touch "${writability_probe}" 2>/dev/null; then
    log "Cannot write to ${apt_lists_dir}; skipping apt package installation"
    return 1
  fi

  rm -f "${writability_probe}" 2>/dev/null || true
  return 0
}

if [[ -f "${APT_FILE}" ]]; then
  if [[ "${SKIP_APT_INSTALL}" == "1" ]]; then
    log "apt.txt detected but SKIP_APT_INSTALL=1, skipping package installation"
  elif can_use_apt; then
    log "apt.txt detected. Installing required apt packages"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    xargs -a "${APT_FILE}" -r apt-get install -y --no-install-recommends
    rm -rf /var/lib/apt/lists/*
  else
    log "apt prerequisites not met; skipping apt package installation"
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
