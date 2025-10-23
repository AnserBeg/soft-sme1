#!/usr/bin/env python3
"""Simple CLI entry point for querying the documentation RAG tool.

The script is intentionally lightweight so the Node backend can shell out to it
when the HTTP RAG service is unavailable. It accepts a query and desired top-k
value, performs retrieval using the existing ``DocumentationRAGTool`` and prints
JSON compatible with the ``RagResponse`` interface consumed by the backend.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

# Ensure the backend root is on the Python path so ``ai_agent`` can be imported
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

try:  # pragma: no cover - executed as a standalone script
    from ai_agent.rag_tool import DocumentationRAGTool, EmbeddingModelLoadError
except ImportError:  # pragma: no cover - fallback when executed as a script
    from rag_tool import DocumentationRAGTool, EmbeddingModelLoadError

LOGGER = logging.getLogger(__name__)

DEFAULT_RESPONSE: Dict[str, Any] = {
    "answer": None,
    "chunks": [],
    "citations": [],
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Query the documentation RAG tool")
    parser.add_argument("--query", required=True, help="Question to query the documentation with")
    parser.add_argument("--top_k", type=int, default=5, help="Number of chunks to return")
    return parser


def serialize_chunk(raw: Dict[str, Any]) -> Dict[str, Any]:
    metadata = raw.get("metadata") or {}
    return {
        "title": metadata.get("title") or metadata.get("sections") or metadata.get("filename") or "",
        "path": metadata.get("file_path") or metadata.get("filename") or "",
        "text": raw.get("text") or raw.get("content") or "",
        "score": raw.get("score") or 0.0,
    }


def serialize_citation(raw: Dict[str, Any]) -> Dict[str, Any]:
    metadata = raw.get("metadata") or {}
    return {
        "title": metadata.get("title") or metadata.get("sections") or metadata.get("filename") or "",
        "path": metadata.get("file_path") or metadata.get("filename") or "",
        "score": raw.get("score") or 0.0,
    }


def main(argv: List[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        tool = DocumentationRAGTool()
    except EmbeddingModelLoadError as exc:
        LOGGER.error("Failed to initialize embeddings: %s", exc)
        print(json.dumps(DEFAULT_RESPONSE))
        return 0
    except Exception as exc:  # pragma: no cover - unexpected import/initialization errors
        LOGGER.error("Unexpected failure while bootstrapping RAG tool: %s", exc)
        print(json.dumps(DEFAULT_RESPONSE))
        return 0

    try:
        results = tool.search_with_metadata(args.query, max(1, args.top_k))
    except Exception as exc:  # pragma: no cover - safeguard against retrieval errors
        LOGGER.error("Documentation search failed: %s", exc)
        print(json.dumps(DEFAULT_RESPONSE))
        return 0

    chunks = [serialize_chunk(item) for item in results or []]
    citations = [serialize_citation(item) for item in results or []]
    answer = chunks[0]["text"] if chunks else None

    payload = {
        "answer": answer,
        "chunks": chunks,
        "citations": citations,
    }

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":  # pragma: no cover - script entry point
    sys.exit(main())
