#!/usr/bin/env bash
set -euo pipefail

# Ensure the Render build uses the backend directory as the root so `apt.txt`
# is visible to the platform-level apt installer. Without it the OCR binaries
# never get provisioned and the build fails later when the app boots.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APT_FILE="${SCRIPT_DIR}/apt.txt"

if [[ ! -f "${APT_FILE}" ]]; then
  cat <<'EOF'
ERROR: Expected to find soft-sme-backend/apt.txt next to render-build.sh.
Render only installs Tesseract/Poppler automatically when that file is present
in the service root. Please restore the file or update the Render service's
root directory to point at soft-sme-backend.
EOF
  exit 1
fi

# Render should have already installed the packages from apt.txt before this
# script runs. If Tesseract is still missing we fail fast with an actionable
# message instead of attempting apt-get (which is blocked in the sandbox).
if ! command -v tesseract >/dev/null 2>&1; then
  cat <<'EOF'
ERROR: Tesseract is not available even though apt.txt is present.
Render installs the packages listed in apt.txt during the dependency phase.
Double-check that the service root is soft-sme-backend and redeploy so the
platform can provision the OCR packages.
EOF
  exit 1
fi

npm install --include=dev
npm run build
