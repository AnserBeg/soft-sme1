"""Row-selection subagent scaffolding used for SQL table routing."""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from ..analytics_sink import AnalyticsSink

logger = logging.getLogger(__name__)

_DEFAULT_TABLE_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "inventory": (
        "inventory",
        "stock",
        "parts",
        "part",
        "sku",
        "quantity",
        "warehouse",
        "availability",
    ),
    "aggregated_parts_to_order": ("parts_to_order", "reorder", "restock", "backorder"),
    "salesorderhistory": ("sales", "order", "orders", "invoices", "revenue"),
    "salesorderlineitems": ("line", "lineitems", "items", "detail", "quantity"),
    "sales_order_parts_to_order": ("sales_order", "parts_to_order", "allocation"),
    "customermaster": ("customer", "client", "account", "buyer"),
    "vendormaster": ("vendor", "supplier", "payable"),
    "products": ("product", "catalog", "price", "sku"),
    "purchasehistory": ("purchase", "po", "procure", "spend", "order"),
    "purchaselineitems": ("purchase", "po", "line", "items", "detail"),
    "quotes": ("quote", "estimate", "proposal"),
    "time_entries": ("time", "clock", "hours", "attendance", "timesheet"),
    "attendance_shifts": ("shift", "schedule", "attendance"),
    "profiles": ("profile", "user", "role", "permission"),
    "business_profile": ("business", "company", "branding"),
    "global_settings": ("setting", "configuration", "default"),
    "labourrate": ("labor", "labour", "rate", "wage"),
    "overhead_expense_distribution": ("overhead", "expense", "distribution"),
    "qbo_account_mapping": ("qbo", "quickbooks", "account"),
    "qbo_connection": ("qbo", "quickbooks", "connection"),
    "sessions": ("session", "login", "auth"),
}

_SUPPORTED_INTENTS = {"row_selection", "table_selection", "sql_row_selection"}


@dataclass(slots=True)
class RowSelectionResult:
    """Structured payload returned to the orchestrator for row selection."""

    step_id: str
    status: str
    table_candidates: List[str]
    reasoning: Optional[str]
    metrics: Dict[str, Any]
    result_key: Optional[str] = None
    error: Optional[str] = None


class RowSelectionSubagent:
    """Planner-aware row selection executor that scores table candidates."""

    def __init__(
        self,
        *,
        analytics_sink: Optional[AnalyticsSink] = None,
        table_keywords: Optional[Mapping[str, Sequence[str]]] = None,
        max_candidates: int = 5,
    ) -> None:
        self._analytics = analytics_sink or AnalyticsSink()
        self._max_candidates = max(1, max_candidates)
        self._table_keywords = self._normalize_keyword_map(table_keywords)

    @staticmethod
    def _normalize_keyword_map(
        table_keywords: Optional[Mapping[str, Sequence[str]]]
    ) -> Dict[str, Tuple[str, ...]]:
        keywords = table_keywords or _DEFAULT_TABLE_KEYWORDS
        normalized: Dict[str, Tuple[str, ...]] = {}
        for table, values in keywords.items():
            deduped = {str(value).lower() for value in values if value}
            if deduped:
                normalized[str(table).lower()] = tuple(sorted(deduped))
        return normalized

    def supports_step(self, plan_step: Mapping[str, Any]) -> bool:
        """Return True when the planner step should be handled by this subagent."""

        if not isinstance(plan_step, Mapping):
            return False

        if str(plan_step.get("type") or "").lower() != "lookup":
            return False

        payload = plan_step.get("payload") or {}
        if not isinstance(payload, Mapping):
            return False

        target = str(payload.get("target") or "").lower()
        if target not in {"database", "db"}:
            return False

        filters = payload.get("filters") or {}
        if isinstance(filters, Mapping):
            intent = str(
                filters.get("intent")
                or filters.get("type")
                or filters.get("lookup_type")
                or ""
            ).lower()
            if intent in _SUPPORTED_INTENTS:
                return True
            if any(key in filters for key in ("preferred_tables", "table_hint", "tables")):
                return True

        query = str(payload.get("query") or "").lower()
        return any(token in query for token in ("table", "tables", "dataset", "records"))

    async def execute(
        self,
        *,
        step_id: str,
        question: str,
        filters: Optional[Mapping[str, Any]] = None,
        planner_payload: Optional[Mapping[str, Any]] = None,
        session_id: Optional[int] = None,
    ) -> RowSelectionResult:
        """Score potential tables based on the planner prompt and filters."""

        parsed_filters = dict(filters or {})
        result_key = (planner_payload or {}).get("result_key") or parsed_filters.get("result_key")

        metadata = {
            "step_id": step_id,
            "session_id": session_id,
            "result_key": result_key,
        }

        await self._analytics.log_event(
            "subagent_invocation_started",
            tool="row_selection",
            status="started",
            metadata={**metadata, "question": question, "filters": parsed_filters},
        )

        start_time = time.perf_counter()

        try:
            preferred_tables = self._normalize_tables(parsed_filters.get("preferred_tables"))
            required_tables = self._normalize_tables(parsed_filters.get("tables"))
            table_hint = self._normalize_table_name(parsed_filters.get("table_hint"))

            tokens = self._extract_tokens(question)
            tokens.update(self._tokens_from_filters(parsed_filters))

            candidates, keyword_hits = self._select_tables(
                tokens,
                preferred_tables=preferred_tables,
                required_tables=required_tables,
                table_hint=table_hint,
            )

            latency_ms = int((time.perf_counter() - start_time) * 1000)

            status = "success" if candidates else "no_match"
            reasoning = self._build_reasoning(candidates, keyword_hits, parsed_filters)
            metrics = {
                "latency_ms": latency_ms,
                "candidate_count": len(candidates),
                "matched_tables": list(keyword_hits.keys()),
            }

            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="row_selection",
                status=status,
                metadata={
                    **metadata,
                    "latency_ms": latency_ms,
                    "candidates": candidates,
                    "keyword_hits": keyword_hits,
                },
            )

            return RowSelectionResult(
                step_id=step_id,
                status=status,
                table_candidates=candidates,
                reasoning=reasoning,
                metrics=metrics,
                result_key=result_key,
            )

        except Exception as exc:  # pylint: disable=broad-except
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            logger.exception("Row selection subagent failed: %s", exc)
            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="row_selection",
                status="error",
                metadata={**metadata, "latency_ms": latency_ms, "error": str(exc)},
            )
            return RowSelectionResult(
                step_id=step_id,
                status="error",
                table_candidates=[],
                reasoning=None,
                metrics={"latency_ms": latency_ms},
                result_key=result_key,
                error=str(exc),
            )

    def _normalize_tables(self, value: Optional[Any]) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            candidates = re.split(r"[\s,]+", value)
        elif isinstance(value, Iterable):
            candidates = list(value)
        else:
            return []
        normalized = [self._normalize_table_name(item) for item in candidates]
        return [item for item in normalized if item]

    def _normalize_table_name(self, value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        candidate = str(value).strip().lower()
        if not candidate:
            return None
        if candidate in self._table_keywords:
            return candidate
        # Attempt to match known tables when keywords appear as substrings.
        for table in self._table_keywords:
            if candidate in table or table in candidate:
                return table
        return candidate

    def _extract_tokens(self, text: str) -> set[str]:
        if not text:
            return set()
        return {token for token in re.findall(r"[a-z0-9_]+", text.lower()) if token}

    def _tokens_from_filters(self, filters: Mapping[str, Any]) -> set[str]:
        tokens: set[str] = set()
        for value in filters.values():
            if isinstance(value, Mapping):
                tokens.update(self._tokens_from_filters(value))
            elif isinstance(value, str):
                tokens.update(self._extract_tokens(value))
            elif isinstance(value, Iterable):
                for item in value:
                    if isinstance(item, str):
                        tokens.update(self._extract_tokens(item))
        return tokens

    def _select_tables(
        self,
        tokens: set[str],
        *,
        preferred_tables: Sequence[str],
        required_tables: Sequence[str],
        table_hint: Optional[str],
    ) -> Tuple[List[str], Dict[str, List[str]]]:
        scores: Dict[str, float] = {}
        hits: Dict[str, List[str]] = {}

        for table, keywords in self._table_keywords.items():
            matched = [keyword for keyword in keywords if keyword in tokens]
            score = float(len(matched))

            if table in preferred_tables:
                score += 2.0
            if table in required_tables:
                score += 1.5
            if table_hint and table_hint == table:
                score += 1.0

            if score > 0:
                scores[table] = score
                hits[table] = matched

        for table in required_tables:
            scores.setdefault(table, 1.0)
            hits.setdefault(table, [])

        if not scores and table_hint:
            normalized_hint = self._normalize_table_name(table_hint)
            if normalized_hint:
                scores[normalized_hint] = 1.0
                hits.setdefault(normalized_hint, [])

        sorted_tables = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
        ordered_tables = [table for table, _ in sorted_tables[: self._max_candidates]]

        ordered_hits = {table: hits.get(table, []) for table in ordered_tables}
        return ordered_tables, ordered_hits

    def _build_reasoning(
        self,
        candidates: Sequence[str],
        keyword_hits: Mapping[str, Sequence[str]],
        filters: Mapping[str, Any],
    ) -> Optional[str]:
        if not candidates:
            if filters:
                return "No matching tables identified from planner filters."
            return "Unable to determine relevant tables from the prompt."

        reasoning_parts: List[str] = []
        for table in candidates:
            hits = [hit for hit in keyword_hits.get(table, []) if hit]
            if hits:
                reasoning_parts.append(
                    f"{table} (matched keywords: {', '.join(sorted(set(hits)))})"
                )

        if reasoning_parts:
            return "Selected tables based on keyword matches – " + "; ".join(reasoning_parts)

        if filters.get("preferred_tables"):
            return "Honored planner preferred_tables hint."

        if filters.get("tables"):
            return "Used planner-specified tables directive."

        if filters.get("table_hint"):
            return "Fell back to planner table_hint guidance."

        return "Selected default tables for database lookup."


__all__ = ["RowSelectionSubagent", "RowSelectionResult"]

