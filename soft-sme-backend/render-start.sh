#!/usr/bin/env bash
set -euo pipefail

# Resolve the directory containing this script so we can locate resources that
# were installed during the build step (for example the portable apt tree).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '[render-start] %s\n' "$*"
}

cd "${SCRIPT_DIR}"

# Clean up stale temporary files without failing the deployment if the command
# encounters permission issues.
find /tmp -maxdepth 1 -mindepth 1 -mtime +1 -exec rm -rf {} + || true

# Ensure any configured cache directories exist before starting the server.
cache_vars=(
  "HF_HOME"
  "HUGGINGFACE_HUB_CACHE"
  "TRANSFORMERS_CACHE"
  "XDG_CACHE_HOME"
  "PIP_CACHE_DIR"
  "UV_CACHE_DIR"
)

for var_name in "${cache_vars[@]}"; do
  value="${!var_name:-}"
  if [[ -n "${value}" ]]; then
    mkdir -p "${value}"
  fi
done

# Make portable apt-installed binaries available at runtime if present.
APT_ROOT="${SCRIPT_DIR}/.apt"

if [[ -d "${APT_ROOT}/usr/bin" ]]; then
  export PATH="${APT_ROOT}/usr/bin:${PATH}"
fi

portable_lib_dirs=()
if [[ -d "${APT_ROOT}/usr/lib" ]]; then
  portable_lib_dirs+=("${APT_ROOT}/usr/lib")
fi
if [[ -d "${APT_ROOT}/usr/lib/x86_64-linux-gnu" ]]; then
  portable_lib_dirs+=("${APT_ROOT}/usr/lib/x86_64-linux-gnu")
fi

if [[ ${#portable_lib_dirs[@]} -gt 0 ]]; then
  lib_path=$(IFS=:; echo "${portable_lib_dirs[*]}")
  if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    export LD_LIBRARY_PATH="${lib_path}:${LD_LIBRARY_PATH}"
  else
    export LD_LIBRARY_PATH="${lib_path}"
  fi
fi

if [[ -d "${APT_ROOT}/usr/share/tesseract-ocr/4.00/tessdata" ]]; then
  export TESSDATA_PREFIX="${APT_ROOT}/usr/share/tesseract-ocr/4.00/tessdata"
fi

ASSISTANT_PID=""
ASSISTANT_SCRIPT="${SCRIPT_DIR}/../Aiven.ai/assistant_server.py"
ENABLE_AI_AGENT_FLAG="${ENABLE_AI_AGENT:-1}"
ASSISTANT_SCRIPT_PRESENT="no"
if [[ -f "${ASSISTANT_SCRIPT}" ]]; then
  ASSISTANT_SCRIPT_PRESENT="yes"
fi

if [[ "${ENABLE_AI_AGENT_FLAG}" != "0" && -f "${ASSISTANT_SCRIPT}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    export ASSISTANT_PORT="${ASSISTANT_PORT:-5001}"
    export ASSISTANT_API_URL="${ASSISTANT_API_URL:-http://127.0.0.1:${ASSISTANT_PORT}}"
    log "Starting local assistant service on ${ASSISTANT_API_URL}"
    python3 -u "${ASSISTANT_SCRIPT}" &
    ASSISTANT_PID=$!
    trap 'if [[ -n "${ASSISTANT_PID}" ]]; then kill "${ASSISTANT_PID}" 2>/dev/null || true; fi' EXIT
  else
    log "python3 not available; skipping assistant service startup"
  fi
else
  log "Assistant service start skipped (ENABLE_AI_AGENT=${ENABLE_AI_AGENT_FLAG}, script present: ${ASSISTANT_SCRIPT_PRESENT})"
fi

exec npm start
