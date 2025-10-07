#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/soft-sme-backend"
BACKEND_SCRIPT="${BACKEND_DIR}/render-build.sh"

if [[ -x "${BACKEND_SCRIPT}" ]]; then
  echo "Delegating Render build to ${BACKEND_SCRIPT}" >&2
  exec "${BACKEND_SCRIPT}"
fi

cat <<'MSG'
render-build.sh is intended to be executed from the soft-sme-backend
subdirectory. The expected build script now lives at
soft-sme-backend/render-build.sh. Ensure your Render service's root directory
is set to soft-sme-backend so the build command can find the script.
MSG

exit 1
