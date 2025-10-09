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

exec npm start
