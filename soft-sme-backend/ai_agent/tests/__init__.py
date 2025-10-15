"""Test package bootstrap for ai_agent modules."""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = PROJECT_ROOT / "soft-sme-backend" / "ai_agent"

for candidate in (PROJECT_ROOT, PACKAGE_ROOT):
    candidate_path = str(candidate)
    if candidate_path not in sys.path:
        sys.path.insert(0, candidate_path)
