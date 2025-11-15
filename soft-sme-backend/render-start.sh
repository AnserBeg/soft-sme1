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

# No Tesseract runtime needed; Gemini handles OCR

ASSISTANT_PID=""
ASSISTANT_SCRIPT="${SCRIPT_DIR}/../Aiven.ai/assistant_server.py"
ENABLE_AI_AGENT_FLAG="${ENABLE_AI_AGENT:-1}"
ASSISTANT_SCRIPT_PRESENT="no"
if [[ -f "${ASSISTANT_SCRIPT}" ]]; then
  ASSISTANT_SCRIPT_PRESENT="yes"
fi

# If Python packages were installed with --user, include user site-packages
USER_SITE="$(python3 - <<'PY'
import site, sys
try:
    sys.stdout.write(site.getusersitepackages() or '')
except Exception:
    sys.stdout.write('')
PY
)"
added_path=""
if [[ -n "${USER_SITE}" && -d "${USER_SITE}" ]]; then
  added_path="${USER_SITE}"
else
  # Fallback to common user site locations on Render
  for p in \
    "/opt/render/.local/lib/python"*/site-packages \
    "${HOME}/.local/lib/python"*/site-packages; do
    if [[ -d "$p" ]]; then
      added_path="$p"
      break
    fi
  done
fi

if [[ -n "${added_path}" ]]; then
  export PYTHONPATH="${added_path}:${PYTHONPATH:-}"
  log "Using Python site-packages at ${added_path}"
fi

if [[ "${ENABLE_AI_AGENT_FLAG}" != "0" && -f "${ASSISTANT_SCRIPT}" ]]; then
  # Prefer project-local virtualenv python if present
  PY_BIN="python3"
  if [[ -x "${SCRIPT_DIR}/../.venv/bin/python3" ]]; then
    PY_BIN="${SCRIPT_DIR}/../.venv/bin/python3"
  fi

  if command -v "${PY_BIN}" >/dev/null 2>&1 || [[ -x "${PY_BIN}" ]]; then
    export ASSISTANT_PORT="${ASSISTANT_PORT:-5001}"
    export ASSISTANT_API_URL="${ASSISTANT_API_URL:-http://127.0.0.1:${ASSISTANT_PORT}}"

    # Ensure Python deps are in place (idempotent, uses pip cache if configured)
    if [[ -f "${SCRIPT_DIR}/../Aiven.ai/requirements.txt" ]]; then
      log "Ensuring assistant Python deps are installed"
      "${PY_BIN}" -m pip install --disable-pip-version-check -r "${SCRIPT_DIR}/../Aiven.ai/requirements.txt" >/dev/null 2>&1 || true
    fi

    # Run via gunicorn if available; fallback to Flask dev server otherwise
    if "${PY_BIN}" -m gunicorn --version >/dev/null 2>&1; then
      log "Starting local assistant with gunicorn on ${ASSISTANT_API_URL}"
      (
        cd "${SCRIPT_DIR}/../Aiven.ai" && \
        "${PY_BIN}" -m gunicorn -w 1 -b "127.0.0.1:${ASSISTANT_PORT}" "assistant_server:app"
      ) &
    else
      log "Starting local assistant service on ${ASSISTANT_API_URL}"
      "${PY_BIN}" -u "${ASSISTANT_SCRIPT}" &
    fi

    ASSISTANT_PID=$!
    trap 'if [[ -n "${ASSISTANT_PID}" ]]; then kill "${ASSISTANT_PID}" 2>/dev/null || true; fi' EXIT
  else
    log "python not available; skipping assistant service startup"
  fi
else
  log "Assistant service start skipped (ENABLE_AI_AGENT=${ENABLE_AI_AGENT_FLAG}, script present: ${ASSISTANT_SCRIPT_PRESENT})"
fi

exec npm start
