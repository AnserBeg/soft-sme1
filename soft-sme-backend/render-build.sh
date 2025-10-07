#!/usr/bin/env bash
set -euxo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APT_FILE="${SCRIPT_DIR}/apt.txt"

if [[ -f "${APT_FILE}" ]]; then
  echo "Found apt.txt at soft-sme-backend/apt.txt; Render installs these packages before running the build command."
else
  echo "WARN: soft-sme-backend/apt.txt is missing. Render will not preinstall Tesseract/Poppler without it."
fi

if command -v tesseract >/dev/null 2>&1; then
  echo "Tesseract available at $(command -v tesseract)"
else
  echo "WARN: tesseract not in PATH yet (Render should provision it from apt.txt before the app starts)."
fi

npm ci --include=dev
npm run build
