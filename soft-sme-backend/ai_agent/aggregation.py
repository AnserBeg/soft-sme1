"""Aggregation coordinator and streaming helpers for planner events.

This module introduces the initial `AggregationCoordinator` implementation. It
normalizes planner/subagent lifecycle events, assigns deterministic sequence
numbers, and persists the results in a replayable cache. The async streaming
API is used by the new SSE endpoint so reconnecting clients receive a
consistent timeline even when subagents execute concurrently.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
import os
from typing import Any, AsyncIterator, Deque, Dict, List, Mapping, Optional, Tuple

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


@dataclass(frozen=True)
class SafetyDirective:
    """Normalized instruction for the orchestrator based on a safety evaluation."""

    severity: str
    requires_manual_review: bool
    fallback_step: Optional[str]
    resolution: Optional[str]
    policy_tags: Tuple[str, ...]
    detected_issues: Tuple[str, ...]
    should_short_circuit: bool

    def to_payload(self) -> Dict[str, Any]:
        """Serialize the directive for analytics or prompting."""

        payload: Dict[str, Any] = {
            "severity": self.severity,
            "requires_manual_review": self.requires_manual_review,
            "policy_tags": list(self.policy_tags),
            "detected_issues": list(self.detected_issues),
            "short_circuit": self.should_short_circuit,
        }
        if self.fallback_step:
            payload["fallback_step"] = self.fallback_step
        if self.resolution:
            payload["resolution"] = self.resolution
        return payload


class TelemetryContextStore:
    """Abstract telemetry context store interface."""

    async def set(
        self,
        session_id: str,
        plan_step_id: str,
        subagent_key: str,
        telemetry: Optional[TelemetryPayload],
    ) -> None:
        raise NotImplementedError

    async def get(
        self, session_id: str, plan_step_id: str, subagent_key: str
    ) -> TelemetryPayload:
        raise NotImplementedError

    async def clear(self, session_id: str, plan_step_id: str) -> None:
        raise NotImplementedError


class InMemoryTelemetryContextStore(TelemetryContextStore):
    """In-memory telemetry context store used primarily for local development and tests."""

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


try:  # pragma: no cover - import is validated in tests via dependency injection
    from redis import asyncio as redis_asyncio
except Exception:  # pragma: no cover - redis is optional at runtime
    redis_asyncio = None


class RedisTelemetryContextStore(TelemetryContextStore):
    """Redis-backed telemetry store for horizontally scaled workers."""

    def __init__(
        self,
        *,
        redis_url: Optional[str] = None,
        ttl_seconds: int = 1800,
        namespace: str = "planner:telemetry",
        redis_client: Optional["redis_asyncio.Redis"] = None,
    ) -> None:
        if redis_client is not None:
            self._redis = redis_client
        else:
            if redis_asyncio is None:
                raise RuntimeError(
                    "redis package not available; install redis>=5.0.0 to use RedisTelemetryContextStore"
                )
            if not redis_url:
                raise ValueError("redis_url must be provided when redis_client is not supplied")
            self._redis = redis_asyncio.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
            )

        self._ttl_seconds = ttl_seconds
        self._namespace = namespace

    def _key(self, session_id: str, plan_step_id: str) -> str:
        return f"{self._namespace}:{session_id}:{plan_step_id}"

    async def set(
        self,
        session_id: str,
        plan_step_id: str,
        subagent_key: str,
        telemetry: Optional[TelemetryPayload],
    ) -> None:
        payload = json.dumps(telemetry or {}, separators=(",", ":"))
        key = self._key(session_id, plan_step_id)
        await self._redis.hset(key, subagent_key, payload)
        if self._ttl_seconds > 0:
            await self._redis.expire(key, self._ttl_seconds)

    async def get(
        self, session_id: str, plan_step_id: str, subagent_key: str
    ) -> TelemetryPayload:
        key = self._key(session_id, plan_step_id)
        payload = await self._redis.hget(key, subagent_key)
        if not payload:
            return {}
        try:
            return dict(json.loads(payload))
        except (TypeError, ValueError):
            logger.warning(
                "RedisTelemetryContextStore.get: failed to decode telemetry payload for %s/%s/%s",  # noqa: E501
                session_id,
                plan_step_id,
                subagent_key,
            )
            return {}

    async def clear(self, session_id: str, plan_step_id: str) -> None:
        key = self._key(session_id, plan_step_id)
        await self._redis.delete(key)


def create_telemetry_store_from_env(
    env: Optional[Mapping[str, str]] = None,
) -> TelemetryContextStore:
    """Create an appropriate telemetry store based on environment variables."""

    env = env or os.environ
    redis_url = env.get("AI_TELEMETRY_REDIS_URL") or env.get("REDIS_URL")
    ttl_raw = env.get("AI_TELEMETRY_REDIS_TTL_SECONDS")
    ttl_seconds = 1800
    if ttl_raw:
        try:
            ttl_seconds = max(int(ttl_raw), 0)
        except ValueError:
            logger.warning(
                "Invalid AI_TELEMETRY_REDIS_TTL_SECONDS=%s; defaulting to %s", ttl_raw, ttl_seconds
            )

    if redis_url:
        try:
            return RedisTelemetryContextStore(
                redis_url=redis_url,
                ttl_seconds=ttl_seconds,
            )
        except Exception as exc:  # pragma: no cover - exercised in integration
            logger.warning(
                "Falling back to in-memory telemetry store because Redis initialization failed: %s",
                exc,
            )

    return InMemoryTelemetryContextStore()


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
        if telemetry_store is None:
            telemetry_store = create_telemetry_store_from_env()
        self._telemetry_store = telemetry_store
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

    async def apply_safety_decision(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        decision: Mapping[str, Any],
        planner_context: Optional[Dict[str, Any]] = None,
    ) -> SafetyDirective:
        """Normalize a safety evaluation and emit corresponding aggregation events."""

        key = (session_id, plan_step_id)
        state = await self._get_state(key)
        if state is None:
            await self.register_plan_step(
                session_id=session_id,
                plan_step_id=plan_step_id,
                expected_subagents=[{"key": "safety", "result_key": decision.get("fallback_step")}],
                planner_context=planner_context,
            )

        severity = str(decision.get("severity", "info")).lower() or "info"
        if severity not in {"info", "warn", "block"}:
            severity = "info"

        requires_manual_review = bool(decision.get("requires_manual_review"))
        fallback_step = decision.get("fallback_step")
        resolution = decision.get("resolution")

        policy_tags = tuple(
            str(tag)
            for tag in decision.get("policy_tags", [])
            if isinstance(tag, str) and tag
        )
        detected_issues = tuple(
            str(issue)
            for issue in decision.get("detected_issues", [])
            if isinstance(issue, str) and issue
        )

        should_short_circuit = severity == "block" or requires_manual_review

        directive = SafetyDirective(
            severity=severity,
            requires_manual_review=requires_manual_review,
            fallback_step=str(fallback_step) if fallback_step else None,
            resolution=str(resolution) if resolution else None,
            policy_tags=policy_tags,
            detected_issues=detected_issues,
            should_short_circuit=should_short_circuit,
        )

        status_map = {
            "info": "pass",
            "warn": "warn",
            "block": "block",
        }

        payload: Dict[str, Any] = {
            "severity": directive.severity,
            "policy_tags": list(directive.policy_tags),
            "detected_issues": list(directive.detected_issues),
            "requires_manual_review": directive.requires_manual_review,
        }
        if directive.resolution:
            payload["resolution"] = directive.resolution
        if directive.fallback_step:
            payload["fallback_step"] = directive.fallback_step

        await self.emit_subagent_event(
            session_id=session_id,
            plan_step_id=plan_step_id,
            subagent="safety",
            status=status_map[directive.severity],
            payload=payload,
        )

        completion_payload = dict(payload)
        completion_payload["short_circuit"] = directive.should_short_circuit

        await self.emit_step_completed(
            session_id=session_id,
            plan_step_id=plan_step_id,
            status="blocked" if directive.should_short_circuit else "completed",
            payload=completion_payload,
        )

        return directive

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


class StreamMux:
    """Multiplexes coordinator events into SSE frames with heartbeat batching."""

    def __init__(
        self,
        coordinator: AggregationCoordinator,
        *,
        heartbeat_interval: float = 15.0,
        max_batch_size: int = 5,
        flush_interval: float = 0.25,
    ) -> None:
        if heartbeat_interval <= 0:
            raise ValueError("heartbeat_interval must be positive")
        if max_batch_size <= 0:
            raise ValueError("max_batch_size must be positive")
        if flush_interval <= 0:
            raise ValueError("flush_interval must be positive")

        self._coordinator = coordinator
        self._heartbeat_interval = heartbeat_interval
        self._max_batch_size = max_batch_size
        self._flush_interval = flush_interval

    async def stream_sse(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        last_event_id: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Yield SSE-formatted strings for the requested session step."""

        event_iter = self._coordinator.stream_events(
            session_id=session_id,
            plan_step_id=plan_step_id,
            last_sequence_id=last_event_id,
        )

        iterator = event_iter.__aiter__()
        next_event_task = asyncio.create_task(iterator.__anext__())
        heartbeat_task = asyncio.create_task(asyncio.sleep(self._heartbeat_interval))
        last_sequence: Optional[int] = None
        try:
            if last_event_id is not None:
                with contextlib.suppress(ValueError):
                    last_sequence = int(last_event_id)

            batch: List[AggregatedEvent] = []

            while True:
                done, _ = await asyncio.wait(
                    {next_event_task, heartbeat_task},
                    timeout=self._flush_interval,
                    return_when=asyncio.FIRST_COMPLETED,
                )

                if not done:
                    if batch:
                        yield self._format_batch(batch, last_sequence)
                        batch = []
                    continue

                if next_event_task in done:
                    try:
                        event = next_event_task.result()
                    except StopAsyncIteration:
                        if batch:
                            yield self._format_batch(batch, last_sequence)
                        break

                    if last_sequence is not None and event.sequence <= last_sequence:
                        next_event_task = asyncio.create_task(iterator.__anext__())
                        continue

                    last_sequence = event.sequence
                    batch.append(event)
                    if len(batch) >= self._max_batch_size:
                        yield self._format_batch(batch, last_sequence)
                        batch = []

                    next_event_task = asyncio.create_task(iterator.__anext__())

                if heartbeat_task in done:
                    heartbeat_task = asyncio.create_task(
                        asyncio.sleep(self._heartbeat_interval)
                    )
                    if batch:
                        yield self._format_batch(batch, last_sequence)
                        batch = []
                    yield self._format_heartbeat(last_sequence)
        finally:
            next_event_task.cancel()
            heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, StopAsyncIteration):
                await next_event_task
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task

    def _format_batch(
        self, batch: List[AggregatedEvent], last_sequence: Optional[int]
    ) -> str:
        payload = {
            "type": "event_batch",
            "batch_sequence": last_sequence,
            "events": [event.to_dict() for event in batch],
        }
        event_id = str(last_sequence) if last_sequence is not None else None
        return self._format_sse(event_type="planner_stream", event_id=event_id, data=payload)

    def _format_heartbeat(self, last_sequence: Optional[int]) -> str:
        payload = {
            "type": "heartbeat",
            "sequence": last_sequence,
        }
        event_id = str(last_sequence) if last_sequence is not None else None
        return self._format_sse(event_type="heartbeat", event_id=event_id, data=payload)

    def _format_sse(
        self,
        *,
        event_type: str,
        data: Dict[str, Any],
        event_id: Optional[str],
    ) -> str:
        body = json.dumps(data, separators=(",", ":"))
        lines = []
        if event_id is not None:
            lines.append(f"id: {event_id}")
        lines.append(f"event: {event_type}")
        for line in body.splitlines():
            lines.append(f"data: {line}")
        return "\n".join(lines) + "\n\n"


__all__ = [
    "AggregatedEvent",
    "AggregationCoordinator",
    "StreamMux",
    "TelemetryContextStore",
    "InMemoryTelemetryContextStore",
    "RedisTelemetryContextStore",
    "create_telemetry_store_from_env",
    "ResultCache",
    "SubagentExpectation",
    "SafetyDirective",
]
