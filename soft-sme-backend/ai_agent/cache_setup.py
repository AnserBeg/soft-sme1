"""Configure persistent cache directories for the AI agent."""
from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass
from typing import Dict

DEFAULT_DATA_ROOT = pathlib.Path("/var/lib/render/ai-cache/soft-sme")
FALLBACK_DATA_ROOT = pathlib.Path("/tmp/soft-sme")
CACHE_ENV_VAR = "AI_CACHE_DIR"


@dataclass(frozen=True)
class StoragePaths:
    """Resolved storage directories used by the AI agent."""

    data_root: pathlib.Path
    vectors_dir: pathlib.Path
    models_dir: pathlib.Path
    cache_dir: pathlib.Path
    transformers_cache: pathlib.Path
    hf_home: pathlib.Path
    xdg_cache_home: pathlib.Path
    tmp_dir: pathlib.Path

    def to_mapping(self) -> Dict[str, str]:
        """Return a mapping of descriptive keys to directory strings."""

        return {
            "data_root": str(self.data_root),
            "vectors": str(self.vectors_dir),
            "models": str(self.models_dir),
            "cache": str(self.cache_dir),
            "transformers_cache": str(self.transformers_cache),
            "hf_home": str(self.hf_home),
            "xdg_cache": str(self.xdg_cache_home),
            "tmp": str(self.tmp_dir),
        }


_STORAGE_PATHS: StoragePaths | None = None


def _mkdir(path: pathlib.Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _print_mapping(key: str, path: pathlib.Path) -> None:
    print(f"[AI Agent] Using {key} -> {path}")


def _select_data_root() -> pathlib.Path:
    """Return the first writable data directory from the candidate list."""

    candidates = []
    env_value = os.getenv("AGENT_DATA_DIR")
    if env_value:
        candidates.append(pathlib.Path(env_value).expanduser())
    candidates.extend([DEFAULT_DATA_ROOT, FALLBACK_DATA_ROOT])

    for candidate in candidates:
        try:
            _mkdir(candidate)
        except PermissionError as exc:
            print(f"[AI Agent] Unable to use data directory {candidate}: {exc}")
            continue
        else:
            return candidate

    raise RuntimeError(
        "Unable to create a writable directory for the AI agent. "
        "Set AGENT_DATA_DIR to a directory the process can access."
    )


def configure_cache_paths() -> StoragePaths:
    """Ensure the AI data directories are configured and created."""

    global _STORAGE_PATHS
    if _STORAGE_PATHS is not None:
        return _STORAGE_PATHS

    data_root = _select_data_root()
    os.environ["AGENT_DATA_DIR"] = str(data_root)

    vectors_dir = data_root / "vectors"
    models_dir = data_root / "models"
    cache_dir = data_root / "cache"
    tmp_dir = cache_dir / "tmp"

    for path in (data_root, vectors_dir, models_dir, cache_dir, tmp_dir):
        _mkdir(path)

    os.environ.setdefault(CACHE_ENV_VAR, str(cache_dir))

    env_defaults = {
        "HF_HOME": models_dir / "huggingface",
        "TRANSFORMERS_CACHE": models_dir / "transformers",
        "SENTENCE_TRANSFORMERS_HOME": models_dir / "sentence-transformers",
        "XDG_CACHE_HOME": cache_dir,
        "PIP_CACHE_DIR": cache_dir / "pip",
        "TMPDIR": tmp_dir,
        "TMP": tmp_dir,
        "TEMP": tmp_dir,
        "CHROMA_PERSIST_DIRECTORY": vectors_dir,
    }

    for key, default_path in env_defaults.items():
        os.environ.setdefault(key, str(default_path))

    # Ensure configured directories exist and log the mapping
    logged_paths: Dict[pathlib.Path, str] = {}
    for key in (
        "HF_HOME",
        "TRANSFORMERS_CACHE",
        "SENTENCE_TRANSFORMERS_HOME",
        "XDG_CACHE_HOME",
        "PIP_CACHE_DIR",
        "CHROMA_PERSIST_DIRECTORY",
        "TMPDIR",
    ):
        value = os.environ.get(key)
        if not value:
            continue
        path_value = pathlib.Path(value).expanduser()
        _mkdir(path_value)
        if path_value not in logged_paths:
            _print_mapping(key, path_value)
            logged_paths[path_value] = key
        else:
            _print_mapping(key, path_value)

    _STORAGE_PATHS = StoragePaths(
        data_root=data_root,
        vectors_dir=vectors_dir,
        models_dir=models_dir,
        cache_dir=cache_dir,
        transformers_cache=pathlib.Path(os.environ["TRANSFORMERS_CACHE"]).expanduser(),
        hf_home=pathlib.Path(os.environ["HF_HOME"]).expanduser(),
        xdg_cache_home=pathlib.Path(os.environ["XDG_CACHE_HOME"]).expanduser(),
        tmp_dir=tmp_dir,
    )
    return _STORAGE_PATHS


__all__ = [
    "configure_cache_paths",
    "StoragePaths",
    "DEFAULT_DATA_ROOT",
    "FALLBACK_DATA_ROOT",
    "CACHE_ENV_VAR",
]
