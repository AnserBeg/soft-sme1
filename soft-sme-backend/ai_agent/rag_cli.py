#!/usr/bin/env python3
"""Lightweight CLI for documentation RAG queries."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any, Dict, List, Optional


def _load_env() -> None:
    try:  # pragma: no cover - optional dependency
        from dotenv import load_dotenv
    except Exception:  # pragma: no cover - best-effort only
        return

    load_dotenv()


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query the documentation RAG index")
    parser.add_argument("--query", required=True, help="Natural language query")
    parser.add_argument("--top_k", type=int, default=5, help="Number of chunks to retrieve")
    return parser.parse_args(argv)


def _format_chunks(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    for item in results:
        metadata = item.get("metadata", {}) or {}
        chunks.append(
            {
                "title": metadata.get("title"),
                "path": metadata.get("file_path"),
                "text": item.get("text"),
                "score": item.get("score"),
            }
        )
    return chunks


def _maybe_run_qa(
    query: str,
    rag_tool: Any,
    *,
    top_k: int,
) -> Optional[Dict[str, Any]]:
    try:
        from ai_agent.subagents.documentation_qa import DocumentationQASubagent
        from langchain_google_genai import ChatGoogleGenerativeAI
    except Exception:  # pragma: no cover - QA module optional
        return None

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        llm = ChatGoogleGenerativeAI(
            model=os.getenv("AI_MODEL", "gemini-2.5-flash"),
            temperature=float(os.getenv("AI_TEMPERATURE", "0.7")),
            google_api_key=api_key,
        )

        subagent = DocumentationQASubagent(
            rag_tool=rag_tool,
            llm=llm,
            max_queries=max(1, top_k),
        )
        result = asyncio.run(subagent.execute(step_id="rag-cli", question=query))
    except Exception:  # pragma: no cover - fall back to raw retrieval
        return None

    return {
        "answer": result.answer,
        "citations": [
            {
                "title": citation.get("title"),
                "path": citation.get("path"),
                "score": citation.get("score"),
            }
            for citation in result.citations
        ],
    }


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    _load_env()

    from ai_agent.rag_tool import DocumentationRAGTool

    rag_tool = DocumentationRAGTool()
    top_k = max(1, args.top_k)
    search_results = rag_tool.search_with_metadata(args.query, top_k=top_k)
    chunks = _format_chunks(search_results)

    qa_payload = _maybe_run_qa(args.query, rag_tool, top_k=top_k)
    citations = qa_payload["citations"] if qa_payload else [
        {"title": chunk["title"], "path": chunk["path"], "score": chunk["score"]}
        for chunk in chunks
    ]

    output = {
        "answer": qa_payload["answer"] if qa_payload else None,
        "chunks": chunks,
        "citations": citations,
    }

    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    try:
        sys.exit(main())
    except Exception as exc:  # pragma: no cover - fail fast with minimal message
        print(str(exc), file=sys.stderr)
        sys.exit(1)
