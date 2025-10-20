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
APT_PACKAGES=()

function read_apt_packages() {
  if [[ ! -f "${APT_FILE}" ]]; then
    return 1
  fi

  mapfile -t APT_PACKAGES < <(grep -vE '^\s*(#|$)' "${APT_FILE}" | awk '{print $1}')
  if [[ ${#APT_PACKAGES[@]} -eq 0 ]]; then
    return 1
  fi

  return 0
}

function install_with_system_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get binary not found; cannot perform system-wide installation"
    return 1
  fi

  local apt_state_dirs=("/var/lib/apt/lists" "/var/cache/apt/archives")
  for dir in "${apt_state_dirs[@]}"; do
    if [[ -e "${dir}" && ! -w "${dir}" ]]; then
      log "apt state directory ${dir} is not writable; skipping system apt-get installation"
      return 1
    fi
  done

  log "Attempting system apt-get installation for packages: ${APT_PACKAGES[*]}"
  export DEBIAN_FRONTEND=noninteractive

  if apt-get update && apt-get install -y --no-install-recommends "${APT_PACKAGES[@]}"; then
    log "System apt-get installation completed"
    rm -rf /var/lib/apt/lists/* || true
    return 0
  fi

  log "System apt-get installation failed"
  return 1
}

function install_portable_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    log "apt-get binary not found; cannot perform portable apt download"
    return 1
  fi

  if ! command -v dpkg-deb >/dev/null 2>&1; then
    log "dpkg-deb binary not found; cannot extract downloaded packages"
    return 1
  fi

  local portable_root="${SCRIPT_DIR}/.apt"
  local work_root="${SCRIPT_DIR}/.apt-work"
  local state_dir="${work_root}/state"
  local cache_dir="${work_root}/cache"
  local apt_config="${work_root}/apt.conf"

  mkdir -p "${state_dir}/lists/partial" "${cache_dir}/archives/partial" "${portable_root}"
  touch "${state_dir}/status"

  cat >"${apt_config}" <<EOF
Dir "${work_root}";
Dir::State "${state_dir}";
Dir::State::status "${state_dir}/status";
Dir::State::lists "${state_dir}/lists";
Dir::State::lists::partial "${state_dir}/lists/partial";
Dir::Cache "${cache_dir}";
Dir::Cache::archives "${cache_dir}/archives";
Dir::Cache::archives::partial "${cache_dir}/archives/partial";
Dir::Etc::sourcelist "/etc/apt/sources.list";
Dir::Etc::sourceparts "/etc/apt/sources.list.d";
Dir::Etc::main "/etc/apt/apt.conf";
Dir::Etc::trusted "/etc/apt/trusted.gpg";
Dir::Etc::trustedparts "/etc/apt/trusted.gpg.d";
DPkg::Post-Invoke "";
DPkg::Post-Invoke-Success "";
Acquire::Retries "3";
EOF

  local cleanup_cmd
  printf -v cleanup_cmd 'trap - RETURN; rm -rf -- %q' "${work_root}"
  trap "${cleanup_cmd}" RETURN

  log "Downloading apt packages into project-local .apt directory"
  if ! APT_CONFIG="${apt_config}" apt-get update; then
    log "Portable apt-get update failed"
    return 1
  fi

  if ! APT_CONFIG="${apt_config}" apt-get install -y --no-install-recommends --download-only "${APT_PACKAGES[@]}"; then
    log "Portable apt-get download failed"
    return 1
  fi

  shopt -s nullglob
  local archives=("${cache_dir}/archives"/*.deb)
  shopt -u nullglob

  if [[ ${#archives[@]} -eq 0 ]]; then
    log "No downloaded archives were found for extraction"
    return 1
  fi

  local extracted=0
  for archive in "${archives[@]}"; do
    if dpkg-deb -x "${archive}" "${portable_root}"; then
      extracted=$((extracted + 1))
    else
      log "Failed to extract ${archive}"
      return 1
    fi
  done

  if [[ ${extracted} -eq 0 ]]; then
    log "No archives extracted; portable installation failed"
    return 1
  fi

  log "Extracted ${extracted} archives into ${portable_root}"

  export PATH="${portable_root}/usr/bin:${PATH}"
  local portable_ld_paths="${portable_root}/usr/lib:${portable_root}/usr/lib/x86_64-linux-gnu"
  if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    export LD_LIBRARY_PATH="${portable_ld_paths}:${LD_LIBRARY_PATH}"
  else
    export LD_LIBRARY_PATH="${portable_ld_paths}"
  fi
  export TESSDATA_PREFIX="${portable_root}/usr/share/tesseract-ocr/4.00/tessdata"

  return 0
}

function ensure_apt_packages() {
  if [[ "${SKIP_APT_INSTALL}" == "1" ]]; then
    log "apt.txt detected but SKIP_APT_INSTALL=1, skipping package installation"
    return
  fi

  if ! read_apt_packages; then
    log "apt.txt detected but no installable packages were listed"
    return
  fi

  if install_with_system_apt; then
    return
  fi

  log "Falling back to portable apt extraction"
  if install_portable_apt; then
    return
  fi

  log "Failed to install apt packages using both system and portable methods"
}

if [[ -f "${APT_FILE}" ]]; then
  ensure_apt_packages
else
  log "No apt.txt file detected. Skipping apt package installation"
fi

export npm_config_production="false"
export NODE_ENV="${NODE_ENV:-development}"

cleanup_npmrc() {
  if [[ -z "${TEMP_NPMRC:-}" ]]; then
    return
  fi

  if [[ -f "${TEMP_NPMRC}" ]]; then
    rm -f "${TEMP_NPMRC}"
  fi

  if [[ "${ORIGINAL_USERCONFIG_SET}" -eq 1 ]]; then
    export npm_config_userconfig="${ORIGINAL_USERCONFIG}"
  else
    unset npm_config_userconfig || true
  fi
}

ORIGINAL_USERCONFIG=""
ORIGINAL_USERCONFIG_SET=0
if [[ -v npm_config_userconfig ]]; then
  ORIGINAL_USERCONFIG_SET=1
  ORIGINAL_USERCONFIG="${npm_config_userconfig}"
fi

TEMP_NPMRC=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  NODE_ROOT="$(cd "$(dirname "${NODE_BIN}")/.." && pwd)"
  if [[ -d "${NODE_ROOT}/include/node" ]]; then
    TEMP_NPMRC="${SCRIPT_DIR}/.render-build-npmrc"
    printf 'nodedir=%s\n' "${NODE_ROOT}" >"${TEMP_NPMRC}"
    export npm_config_userconfig="${TEMP_NPMRC}"
    trap cleanup_npmrc EXIT
  fi
fi

if [[ -f package-lock.json ]]; then
  log "Installing npm dependencies with npm ci"
  if ! npm ci --include=dev; then
    log "npm ci failed; falling back to npm install --include=dev"
    npm install --include=dev
  fi
else
  log "No package-lock.json found. Falling back to npm install"
  npm install --include=dev
fi

log "Building TypeScript sources"
npm run build

log "Preparing AI agent Python environment"
python3 -m venv ai_agent/.venv
ai_agent/.venv/bin/pip install --upgrade pip setuptools wheel
ai_agent/.venv/bin/pip install -r ai_agent/requirements.txt

log "Render build script completed successfully"
