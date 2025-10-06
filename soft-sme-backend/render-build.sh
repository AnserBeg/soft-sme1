#!/usr/bin/env bash
set -euo pipefail

# Ensure required OCR system packages are installed. Render's Node environment
# is Debian-based, so we can use apt-get when the binaries are missing.
if ! command -v tesseract >/dev/null 2>&1; then
  echo "Installing Tesseract OCR dependencies via apt-get..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils
  rm -rf /var/lib/apt/lists/*
else
  echo "Tesseract OCR already available; skipping apt-get install."
fi

npm install --include=dev
npm run build
