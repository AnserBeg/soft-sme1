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

mapfile -t APT_PACKAGES < <(grep -Ev '^(#|\s*$)' "${APT_FILE}")

if ! command -v tesseract >/dev/null 2>&1; then
  if ((${#APT_PACKAGES[@]} == 0)); then
    cat <<'EOF'
ERROR: apt.txt is present but does not list any packages to install.
Please add the required OCR packages (e.g., tesseract-ocr) and redeploy.
EOF
    exit 1
  fi

  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      USE_SUDO=1
    else
      cat <<'EOF'
ERROR: Tesseract is missing and the build is running without root privileges.
Render normally installs the packages listed in soft-sme-backend/apt.txt
before executing the build command. Please confirm the service root is set to
soft-sme-backend (or otherwise ensure Render provisions the apt packages) and
redeploy.
EOF
      exit 1
    fi
  fi

  echo "Tesseract not found; installing packages from apt.txt..."

  export DEBIAN_FRONTEND=noninteractive
  APT_CACHE_DIR="${TMPDIR:-/tmp}/render-apt-cache"
  APT_STATE_DIR="${TMPDIR:-/tmp}/render-apt-state"
  mkdir -p "${APT_CACHE_DIR}/archives/partial" \
           "${APT_STATE_DIR}/lists/partial"

  APT_OPTS=(
    "-o" "Dir::Cache=${APT_CACHE_DIR}"
    "-o" "Dir::State=${APT_STATE_DIR}"
    "-o" "Dir::State::status=${APT_STATE_DIR}/status"
  )

  run_apt() {
    if [[ ${USE_SUDO:-0} -eq 1 ]]; then
      sudo -E apt-get "${APT_OPTS[@]}" "$@"
    else
      apt-get "${APT_OPTS[@]}" "$@"
    fi
  }

  if ! run_apt update; then
    cat <<'EOF'
ERROR: Failed to update apt indices while attempting to install OCR packages.
Please inspect the build logs above for details.
EOF
    exit 1
  fi

  if ! run_apt install -y --no-install-recommends "${APT_PACKAGES[@]}"; then
    cat <<'EOF'
ERROR: apt-get could not install the OCR packages from apt.txt.
Review the errors above. If the failure is due to missing permissions, ensure
Render installs the packages automatically by keeping apt.txt in the service
root (soft-sme-backend) and redeploying.
EOF
    exit 1
  fi
fi

npm install --include=dev
npm run build
