#!/usr/bin/env bash
set -euo pipefail

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

exec npm start
