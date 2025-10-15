"""Structured telemetry helpers for the planner service."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Iterable, Optional


def _json_default(value: Any) -> Any:
    """Best-effort JSON serializer that falls back to ``str`` for unknown types."""

    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, set):
        return list(value)
    return str(value)


class PlannerTelemetryEmitter:
    """Emit structured planner telemetry as JSON log lines."""

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        self._logger = logger or logging.getLogger("planner_service.telemetry")

    def emit(
        self,
        event_type: str,
        *,
        trace_id: str,
        session_id: Optional[int] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "component": "planner_service",
            "event": event_type,
            "trace_id": trace_id,
        }

        if session_id is not None:
            payload["session_id"] = session_id
        if latency_ms is not None:
            payload["latency_ms"] = latency_ms
        if metadata:
            payload["metadata"] = metadata
        if extra:
            payload.update({k: v for k, v in extra.items() if v is not None})

        self._logger.info(json.dumps(payload, default=_json_default, sort_keys=True))

    def plan_request(
        self,
        *,
        trace_id: str,
        session_id: int,
        message: str,
        context: Dict[str, Any],
    ) -> None:
        self.emit(
            "planner.request.received",
            trace_id=trace_id,
            session_id=session_id,
            extra={
                "message": message,
                "context": context,
            },
        )

    def plan_success(
        self,
        *,
        trace_id: str,
        session_id: int,
        latency_ms: int,
        step_types: Iterable[str],
        planner_version: Optional[str],
        planner_model: Optional[str],
    ) -> None:
        self.emit(
            "planner.plan.generated",
            trace_id=trace_id,
            session_id=session_id,
            latency_ms=latency_ms,
            extra={
                "step_types": list(step_types),
                "planner_version": planner_version,
                "planner_model": planner_model,
            },
        )

    def plan_failure(
        self,
        *,
        trace_id: str,
        session_id: int,
        latency_ms: int,
        error: str,
    ) -> None:
        self.emit(
            "planner.plan.failed",
            trace_id=trace_id,
            session_id=session_id,
            latency_ms=latency_ms,
            extra={"error": error},
        )


telemetry = PlannerTelemetryEmitter()


__all__ = ["telemetry", "PlannerTelemetryEmitter"]
