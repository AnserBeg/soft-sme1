"""Configure persistent cache directories for the AI agent."""
from __future__ import annotations

import os
import pathlib
from typing import Iterable, Tuple

DEFAULT_CACHE_ROOT = "/var/lib/render/ai-cache"
CACHE_ENV_VAR = "AI_CACHE_DIR"

# Keys that should point at directories which must exist
_CACHE_DIR_KEYS: Tuple[str, ...] = (
    "HF_HOME",
    "TRANSFORMERS_CACHE",
    "PIP_CACHE_DIR",
    "TMPDIR",
    "CHROMA_PERSIST_DIRECTORY",
)

_OPTIONAL_DIR_KEYS: Tuple[str, ...] = (
    "XDG_CACHE_HOME",
)

_CONFIGURED = False


def _mkdir(path: pathlib.Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _print_mapping(key: str, path: pathlib.Path) -> None:
    print(f"[AI Agent] Using {key} -> {path}")


def _ensure_directories(keys: Iterable[str]) -> None:
    for key in keys:
        value = os.environ.get(key)
        if not value:
            continue
        path = pathlib.Path(value).expanduser()
        _mkdir(path)
        _print_mapping(key, path)


def configure_cache_paths() -> pathlib.Path:
    """Ensure the AI cache directories are configured and created.

    Returns the resolved cache root path.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return pathlib.Path(os.environ.get(CACHE_ENV_VAR, DEFAULT_CACHE_ROOT))

    cache_root = pathlib.Path(os.getenv(CACHE_ENV_VAR, DEFAULT_CACHE_ROOT)).expanduser()
    os.environ.setdefault(CACHE_ENV_VAR, str(cache_root))

    # Hugging Face / Transformers cache
    os.environ.setdefault("HF_HOME", str(cache_root / "huggingface"))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(cache_root / "huggingface"))

    # Generic cache root used by various tools
    os.environ.setdefault("XDG_CACHE_HOME", str(cache_root))

    # Pip cache
    os.environ.setdefault("PIP_CACHE_DIR", str(cache_root / "pip"))

    # Temporary files
    tmp_dir = cache_root / "tmp"
    os.environ.setdefault("TMPDIR", str(tmp_dir))
    os.environ.setdefault("TMP", str(tmp_dir))
    os.environ.setdefault("TEMP", str(tmp_dir))

    # Vector database persistence
    os.environ.setdefault("CHROMA_PERSIST_DIRECTORY", str(cache_root / "chroma"))

    # Ensure the cache root itself exists before other directories
    _mkdir(cache_root)

    # Create and log the configured directories
    _ensure_directories(_CACHE_DIR_KEYS)

    # Ensure optional directories exist but avoid duplicate logs when they overlap
    for key in _OPTIONAL_DIR_KEYS:
        value = os.environ.get(key)
        if not value:
            continue
        path = pathlib.Path(value).expanduser()
        if key not in _CACHE_DIR_KEYS:
            _mkdir(path)
            _print_mapping(key, path)
        else:
            _mkdir(path)

    _CONFIGURED = True
    return cache_root


__all__ = [
    "configure_cache_paths",
    "DEFAULT_CACHE_ROOT",
    "CACHE_ENV_VAR",
]
