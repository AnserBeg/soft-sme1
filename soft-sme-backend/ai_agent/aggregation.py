"""Aggregation coordinator and streaming helpers for planner events.

This module introduces the initial `AggregationCoordinator` implementation. It
normalizes planner/subagent lifecycle events, assigns deterministic sequence
numbers, and persists the results in a replayable cache. The async streaming
API is used by the new SSE endpoint so reconnecting clients receive a
consistent timeline even when subagents execute concurrently.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
from typing import Any, AsyncIterator, Deque, Dict, List, Optional, Tuple

from .analytics_sink import AnalyticsSink

logger = logging.getLogger(__name__)

EventPayload = Dict[str, Any]
TelemetryPayload = Dict[str, Any]


@dataclass
class AggregatedEvent:
    """Normalized event emitted by the aggregation coordinator."""

    session_id: str
    plan_step_id: str
    sequence: int
    event_type: str
    content: EventPayload
    telemetry: TelemetryPayload
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the event into a JSON-friendly structure."""

        return {
            "session_id": self.session_id,
            "plan_step_id": self.plan_step_id,
            "sequence": self.sequence,
            "type": self.event_type,
            "timestamp": self.timestamp.isoformat(),
            "content": self.content,
            "telemetry": self.telemetry,
        }


@dataclass
class SubagentExpectation:
    """Planner-provided expectation for a subagent."""

    key: str
    result_key: Optional[str]
    telemetry: TelemetryPayload


@dataclass
class SessionStepState:
    """Internal state tracking for a `(session_id, plan_step_id)` tuple."""

    queue: "asyncio.Queue[AggregatedEvent]"
    expected_subagents: Dict[str, SubagentExpectation]
    planner_context: EventPayload
    sequence: int = 0
    closed: bool = False


class TelemetryContextStore:
    """In-memory telemetry context store used until Redis is introduced."""

    def __init__(self) -> None:
        self._store: Dict[str, Dict[str, Dict[str, TelemetryPayload]]] = {}
        self._lock = asyncio.Lock()

    async def set(
        self,
        session_id: str,
        plan_step_id: str,
        subagent_key: str,
        telemetry: Optional[TelemetryPayload],
    ) -> None:
        async with self._lock:
            plan_store = self._store.setdefault(session_id, {})
            subagent_store = plan_store.setdefault(plan_step_id, {})
            subagent_store[subagent_key] = dict(telemetry or {})

    async def get(
        self, session_id: str, plan_step_id: str, subagent_key: str
    ) -> TelemetryPayload:
        async with self._lock:
            return dict(
                self._store
                .get(session_id, {})
                .get(plan_step_id, {})
                .get(subagent_key, {})
            )

    async def clear(self, session_id: str, plan_step_id: str) -> None:
        async with self._lock:
            plan_store = self._store.get(session_id)
            if not plan_store:
                return
            plan_store.pop(plan_step_id, None)
            if not plan_store:
                self._store.pop(session_id, None)


class ResultCache:
    """Simple ring-buffer cache keyed by `(session_id, plan_step_id)`."""

    def __init__(self, max_events: int = 200) -> None:
        self._max_events = max_events
        self._cache: Dict[Tuple[str, str], Deque[AggregatedEvent]] = {}
        self._lock = asyncio.Lock()

    async def append(self, key: Tuple[str, str], event: AggregatedEvent) -> None:
        async with self._lock:
            events = self._cache.setdefault(key, deque(maxlen=self._max_events))
            events.append(event)

    async def replay(
        self,
        key: Tuple[str, str],
        *,
        after_sequence: Optional[int] = None,
    ) -> List[AggregatedEvent]:
        async with self._lock:
            events = list(self._cache.get(key, ()))

        if after_sequence is None:
            return events

        return [event for event in events if event.sequence > after_sequence]

    async def clear(self, key: Tuple[str, str]) -> None:
        async with self._lock:
            self._cache.pop(key, None)

    async def has_events(self, key: Tuple[str, str]) -> bool:
        async with self._lock:
            return key in self._cache and bool(self._cache[key])


class AggregationCoordinator:
    """Coordinator that emits normalized events for planner/subagent progress."""

    def __init__(
        self,
        *,
        telemetry_store: Optional[TelemetryContextStore] = None,
        result_cache: Optional[ResultCache] = None,
        analytics_sink: Optional[AnalyticsSink] = None,
    ) -> None:
        self._telemetry_store = telemetry_store or TelemetryContextStore()
        self._result_cache = result_cache or ResultCache()
        self._analytics_sink = analytics_sink
        self._states: Dict[Tuple[str, str], SessionStepState] = {}
        self._lock = asyncio.Lock()

    async def register_plan_step(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        expected_subagents: List[Dict[str, Any]],
        planner_context: Optional[Dict[str, Any]] = None,
    ) -> None:
        key = (session_id, plan_step_id)
        queue: "asyncio.Queue[AggregatedEvent]" = asyncio.Queue()
        expectations = {
            item["key"]: SubagentExpectation(
                key=item["key"],
                result_key=item.get("result_key"),
                telemetry=dict(item.get("telemetry", {})),
            )
            for item in expected_subagents
        }

        async with self._lock:
            if key in self._states:
                logger.debug(
                    "AggregationCoordinator.register_plan_step: replacing existing state for %s", key
                )
            self._states[key] = SessionStepState(
                queue=queue,
                expected_subagents=expectations,
                planner_context=dict(planner_context or {}),
            )

        for expectation in expectations.values():
            await self._telemetry_store.set(
                session_id, plan_step_id, expectation.key, expectation.telemetry
            )

        await self._emit_event(
            key,
            event_type="step_started",
            content={
                "status": "pending",
                "expected_subagents": [
                    {"key": exp.key, "result_key": exp.result_key}
                    for exp in expectations.values()
                ],
                "planner_context": dict(planner_context or {}),
            },
            subagent=None,
        )

    async def emit_subagent_event(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        subagent: str,
        status: str,
        payload: Optional[Dict[str, Any]] = None,
        telemetry: Optional[TelemetryPayload] = None,
        revision: Optional[int] = None,
    ) -> None:
        base_telemetry = await self._telemetry_store.get(session_id, plan_step_id, subagent)
        merged_telemetry = {**base_telemetry, **(telemetry or {})}
        content = {
            "stage": subagent,
            "status": status,
            "payload": payload or {},
        }
        if revision is not None:
            content["revision"] = revision

        await self._emit_event(
            (session_id, plan_step_id),
            event_type="subagent_result",
            content=content,
            subagent=subagent,
            telemetry=merged_telemetry,
        )

    async def emit_timeout(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        subagent: str,
        reason: str,
        telemetry: Optional[TelemetryPayload] = None,
    ) -> None:
        await self.emit_subagent_event(
            session_id=session_id,
            plan_step_id=plan_step_id,
            subagent=subagent,
            status="timeout",
            payload={"reason": reason},
            telemetry=telemetry,
        )

    async def emit_step_completed(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        status: str,
        payload: Optional[Dict[str, Any]] = None,
        telemetry: Optional[TelemetryPayload] = None,
    ) -> None:
        key = (session_id, plan_step_id)
        state = await self._get_state(key)
        if state:
            state.closed = True
        await self._emit_event(
            key,
            event_type="plan_step_completed",
            content={
                "status": status,
                "payload": payload or {},
            },
            subagent=None,
            telemetry=telemetry,
        )
        await self._telemetry_store.clear(session_id, plan_step_id)

    async def stream_events(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        last_sequence_id: Optional[str] = None,
    ) -> AsyncIterator[AggregatedEvent]:
        key = (session_id, plan_step_id)
        after_sequence: Optional[int] = None
        if last_sequence_id:
            try:
                after_sequence = int(last_sequence_id)
            except ValueError:
                logger.debug(
                    "AggregationCoordinator.stream_events: invalid last_sequence_id %s", last_sequence_id
                )
        cached = await self._result_cache.replay(key, after_sequence=after_sequence)
        for event in cached:
            yield event

        state = await self._get_state(key)
        if state is None:
            # Plan step already completed; replayed events are all we have.
            return

        while True:
            event = await state.queue.get()
            try:
                yield event
            finally:
                state.queue.task_done()
            if state.closed and event.event_type == "plan_step_completed":
                await self._cleanup_state(key)
                break

    async def _emit_event(
        self,
        key: Tuple[str, str],
        *,
        event_type: str,
        content: Dict[str, Any],
        subagent: Optional[str],
        telemetry: Optional[TelemetryPayload] = None,
    ) -> None:
        state = await self._ensure_state(key)
        state.sequence += 1
        merged_content = dict(content)
        if subagent:
            merged_content.setdefault("stage", subagent)
        event = AggregatedEvent(
            session_id=key[0],
            plan_step_id=key[1],
            sequence=state.sequence,
            event_type=event_type,
            content=merged_content,
            telemetry=telemetry or {},
        )
        await self._result_cache.append(key, event)
        await state.queue.put(event)

        if self._analytics_sink:
            asyncio.create_task(
                self._analytics_sink.log_event(
                    "planner_stream_emitted",
                    session_id=int(key[0]) if str(key[0]).isdigit() else None,
                    status=merged_content.get("status"),
                    metadata={
                        "plan_step_id": key[1],
                        "sequence": event.sequence,
                        "event_type": event_type,
                        "subagent": subagent,
                    },
                )
            )

    async def _ensure_state(self, key: Tuple[str, str]) -> SessionStepState:
        state = await self._get_state(key)
        if state is None:
            raise RuntimeError(f"AggregationCoordinator state not initialized for {key}")
        return state

    async def _get_state(self, key: Tuple[str, str]) -> Optional[SessionStepState]:
        async with self._lock:
            return self._states.get(key)

    async def _cleanup_state(self, key: Tuple[str, str]) -> None:
        async with self._lock:
            self._states.pop(key, None)
        if not await self._result_cache.has_events(key):
            await self._result_cache.clear(key)


__all__ = [
    "AggregatedEvent",
    "AggregationCoordinator",
    "TelemetryContextStore",
    "ResultCache",
    "SubagentExpectation",
]
