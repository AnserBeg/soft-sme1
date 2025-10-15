"""Documentation QA subagent scaffolding.

This module provides the scaffolding for a planner-driven documentation QA
subagent. The implementation focuses on orchestrating retrieval from the
existing RAG tool, running synthesis with the configured LLM, and surfacing
structured results with telemetry hooks. The MVP intentionally keeps the
surface area small so it can be integrated behind a feature flag and evolved
without breaking the orchestrator contract.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence

from langchain_core.messages import BaseMessage, HumanMessage

from ..analytics_sink import AnalyticsSink
from ..rag_tool import DocumentationRAGTool

logger = logging.getLogger(__name__)

_DEFAULT_RETRIEVAL_QUERIES = 2
_DEFAULT_MIN_SCORE = 0.55
_FALLBACK_MIN_SCORE = 0.45


@dataclass(slots=True)
class DocumentationQAResult:
    """Structured payload returned to the orchestrator."""

    step_id: str
    status: str
    answer: Optional[str]
    citations: List[Dict[str, Any]]
    reasoning: Optional[str]
    metrics: Dict[str, Any]
    result_key: Optional[str] = None
    error: Optional[str] = None


class DocumentationQASubagent:
    """Planner-aware documentation QA executor."""

    def __init__(
        self,
        *,
        rag_tool: DocumentationRAGTool,
        llm,
        analytics_sink: Optional[AnalyticsSink] = None,
        max_queries: int = _DEFAULT_RETRIEVAL_QUERIES,
        min_score: float = _DEFAULT_MIN_SCORE,
        fallback_min_score: float = _FALLBACK_MIN_SCORE,
    ) -> None:
        self._rag_tool = rag_tool
        self._llm = llm
        self._analytics = analytics_sink or AnalyticsSink()
        self._max_queries = max(1, max_queries)
        self._min_score = min_score
        self._fallback_min_score = fallback_min_score

    def supports_step(self, plan_step: Dict[str, Any]) -> bool:
        """Return True when the step should be handled by this subagent."""

        tool_name = (
            (plan_step or {})
            .get("payload", {})
            .get("tool_name")
            or plan_step.get("tool")
            or ""
        ).lower()
        step_type = (plan_step or {}).get("type", "").lower()

        if step_type in {"lookup", "tool"}:
            return any(
                keyword in tool_name
                for keyword in ("doc", "documentation_qa", "documentation_lookup")
            )
        return False

    async def execute(
        self,
        *,
        step_id: str,
        question: str,
        conversation_tail: Optional[Sequence[Dict[str, str]]] = None,
        focus_hints: Optional[Dict[str, Any]] = None,
        planner_payload: Optional[Dict[str, Any]] = None,
        session_id: Optional[int] = None,
    ) -> DocumentationQAResult:
        """Execute the documentation QA flow and return a structured result."""

        citations: List[Dict[str, Any]] = []
        start_time = time.perf_counter()
        result_key = (planner_payload or {}).get("result_key")

        metadata = {
            "step_id": step_id,
            "session_id": session_id,
            "result_key": result_key,
        }

        await self._analytics.log_event(
            "subagent_invocation_started",
            tool="documentation_qa",
            status="started",
            metadata={**metadata, "question": question},
        )

        try:
            retrieval_queries = self._build_queries(
                question=question,
                focus_hints=focus_hints,
                conversation_tail=conversation_tail,
            )
            retrieved_chunks = await self._run_retrieval(retrieval_queries)

            coverage_score = self._calculate_coverage(retrieved_chunks)
            logger.debug(
                "Documentation QA coverage score %.2f using %d chunks",
                coverage_score,
                len(retrieved_chunks),
            )

            if not retrieved_chunks or coverage_score < self._fallback_min_score:
                reasoning = "Insufficient documentation retrieved to answer confidently."
                await self._analytics.log_event(
                    "subagent_invocation_completed",
                    tool="documentation_qa",
                    status="no_answer",
                    metadata={**metadata, "coverage_score": coverage_score},
                )
                return DocumentationQAResult(
                    step_id=step_id,
                    status="no_answer",
                    answer=None,
                    citations=[],
                    reasoning=reasoning,
                    metrics=self._build_metrics(start_time, len(retrieved_chunks)),
                    result_key=result_key,
                )

            if coverage_score < self._min_score:
                logger.info(
                    "Coverage below minimum threshold %.2f < %.2f; marking as low confidence",
                    coverage_score,
                    self._min_score,
                )

            prompt = self._build_synthesis_prompt(
                question=question,
                chunks=retrieved_chunks,
                conversation_tail=conversation_tail,
                focus_hints=focus_hints,
            )
            llm_response = await self._llm.ainvoke(prompt)
            answer_text = getattr(llm_response, "content", str(llm_response))

            citations = [
                {
                    "title": chunk.get("metadata", {}).get("title"),
                    "path": chunk.get("metadata", {}).get("file_path"),
                    "score": chunk.get("score"),
                }
                for chunk in retrieved_chunks
            ]

            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="documentation_qa",
                status="success",
                metadata={
                    **metadata,
                    "coverage_score": coverage_score,
                    "retrieval_count": len(retrieved_chunks),
                },
            )

            return DocumentationQAResult(
                step_id=step_id,
                status="success",
                answer=answer_text,
                citations=citations,
                reasoning="Answer synthesized from retrieved documentation",
                metrics=self._build_metrics(start_time, len(retrieved_chunks)),
                result_key=result_key,
            )

        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Documentation QA subagent failed: %%s", exc)
            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="documentation_qa",
                status="error",
                metadata={**metadata, "error": str(exc)},
            )
            return DocumentationQAResult(
                step_id=step_id,
                status="error",
                answer=None,
                citations=citations,
                reasoning="Encountered unexpected error while answering",
                metrics=self._build_metrics(start_time, 0),
                result_key=result_key,
                error=str(exc),
            )

    def _build_queries(
        self,
        *,
        question: str,
        focus_hints: Optional[Dict[str, Any]],
        conversation_tail: Optional[Sequence[Dict[str, str]]],
    ) -> List[str]:
        queries = [question.strip()]

        focus = focus_hints or {}
        focus_values = [str(value) for value in focus.values() if value]
        if focus_values:
            queries.append(" ".join([question, *focus_values]))

        tail_text = self._conversation_tail_text(conversation_tail)
        if tail_text:
            queries.append(f"{question} {tail_text}")

        # Deduplicate while preserving order
        deduped: List[str] = []
        for query in queries:
            normalized = query.strip()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
            if len(deduped) >= self._max_queries:
                break
        return deduped

    def _conversation_tail_text(
        self, conversation_tail: Optional[Sequence[Dict[str, str]]]
    ) -> str:
        if not conversation_tail:
            return ""
        tail_segments: List[str] = []
        for turn in conversation_tail:
            role = (turn or {}).get("role") or "user"
            prefix = "User" if role == "user" else "Assistant"
            content = (turn or {}).get("content") or ""
            if content:
                tail_segments.append(f"{prefix}: {content}")
        return " | ".join(tail_segments)

    async def _run_retrieval(
        self,
        queries: Iterable[str],
    ) -> List[Dict[str, Any]]:
        retrieved: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()

        for query in queries:
            try:
                results = await self._search_with_metadata(query, top_k=5)
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("Documentation retrieval failed for query '%s': %s", query, exc)
                continue

            if not results:
                continue

            for item in results:
                if not isinstance(item, dict):
                    logger.debug("Unexpected retrieval format for query '%s': %r", query, item)
                    continue

                chunk_id = item.get("id")
                if chunk_id is not None:
                    chunk_id = str(chunk_id)
                    if chunk_id in seen_ids:
                        continue
                    seen_ids.add(chunk_id)

                retrieved.append(item)

        retrieved.sort(key=lambda item: item.get("score", 0) or 0, reverse=True)
        return retrieved

    async def _search_with_metadata(
        self,
        query: str,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._rag_tool.search_with_metadata, query, top_k)

    def _calculate_coverage(self, chunks: Sequence[Dict[str, Any]]) -> float:
        if not chunks:
            return 0.0
        scores = [chunk.get("score", 0.0) or 0.0 for chunk in chunks]
        if not scores:
            return 0.0
        top_scores = scores[: min(len(scores), 3)]
        return sum(top_scores) / len(top_scores)

    def _build_synthesis_prompt(
        self,
        *,
        question: str,
        chunks: Sequence[Dict[str, Any]],
        conversation_tail: Optional[Sequence[Dict[str, str]]],
        focus_hints: Optional[Dict[str, Any]],
    ) -> List[BaseMessage]:
        context_sections = []
        for idx, chunk in enumerate(chunks[:5], start=1):
            metadata = chunk.get("metadata", {})
            body = chunk.get("text") or chunk.get("content") or ""
            section_title = metadata.get("title") or metadata.get("sections") or "Documentation"
            context_sections.append(
                f"Section {idx}: {section_title}\nScore: {chunk.get('score')}\n{body}"
            )

        instructions = (
            "You are the documentation QA subagent for the Soft SME assistant. "
            "Answer strictly using the provided documentation excerpts. "
            "Mention UI labels and workflow names exactly as written. "
            "If the documentation does not cover the request, reply that the information is unavailable."
        )

        focus_text = ""
        if focus_hints:
            focus_text = "\n".join(f"- {key}: {value}" for key, value in focus_hints.items() if value)

        tail = self._conversation_tail_text(conversation_tail)

        prompt = [
            HumanMessage(
                content=(
                    f"{instructions}\n\n"
                    f"Question: {question}\n\n"
                    + (f"Focus hints:\n{focus_text}\n\n" if focus_text else "")
                    + (f"Recent conversation: {tail}\n\n" if tail else "")
                    + "Documentation excerpts:\n"
                    + "\n\n".join(context_sections)
                )
            )
        ]
        return prompt

    def _build_metrics(self, start_time: float, retrieval_count: int) -> Dict[str, Any]:
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "latency_ms": elapsed_ms,
            "retrieval_count": retrieval_count,
        }


__all__ = ["DocumentationQASubagent", "DocumentationQAResult"]
