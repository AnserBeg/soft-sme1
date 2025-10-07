# ---- user-space tesseract install (no root) ----
set -euxo pipefail
mkdir -p .vendor/debs .vendor/usr

# Find architecture (amd64 on Render)
ARCH="$(dpkg --print-architecture || echo amd64)"

# Grab minimal runtime deps (versions pinned loosely; these URLs work on bookworm)
cd .vendor/debs
curl -L -O http://deb.debian.org/debian/pool/main/t/tesseract/tesseract-ocr_5.3.0-2_${ARCH}.deb
curl -L -O http://deb.debian.org/debian/pool/main/t/tesseract/libtesseract5_5.3.0-2_${ARCH}.deb
curl -L -O http://deb.debian.org/debian/pool/main/l/leptonlib/liblept5_1.82.0-3_${ARCH}.deb
curl -L -O http://deb.debian.org/debian/pool/main/t/tesseract/tesseract-ocr-eng_1%3a4.1.0-2_all.deb

# Extract into .vendor/usr
for f in *.deb; do dpkg-deb -x "$f" ../usr; done
cd ../..

# Wire up PATH and libs for build & runtime
export PATH="$PWD/.vendor/usr/usr/bin:$PATH"
export LD_LIBRARY_PATH="$PWD/.vendor/usr/usr/lib:$LD_LIBRARY_PATH"
export TESSDATA_PREFIX="$PWD/.vendor/usr/usr/share/tesseract-ocr/4.00/tessdata"
# Optional: persist for runtime by writing an env file your app loads, or export again in start script

# Sanity check
command -v tesseract && tesseract --version || echo "tesseract still not found"
# ---- end user-space tesseract install ----



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
