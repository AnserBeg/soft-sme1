"""Voice/call subagent execution harness with retry and callback dispatch."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable as AwaitableType
from collections.abc import Callable as CallableType
from collections.abc import Iterable as IterableType
from collections.abc import Mapping as MappingType
from collections.abc import Sequence as SequenceType
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

import httpx

from ..analytics_sink import AnalyticsSink

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://127.0.0.1:5000/api/voice"
_DEFAULT_TIMEOUT = 12.0
_DEFAULT_MAX_RETRIES = 3
_DEFAULT_INITIAL_BACKOFF = 0.75
_DEFAULT_BACKOFF_MULTIPLIER = 2.0

CallbackType = Union[str, CallableType[[Dict[str, Any], Dict[str, Any]], Union[AwaitableType[None], None]]]


@dataclass(slots=True)
class VoiceCallResult:
    """Structured payload returned to the orchestrator after initiating a call."""

    step_id: str
    status: str
    session_id: Optional[int]
    structured_notes: Optional[Dict[str, Any]]
    events: Sequence[Dict[str, Any]]
    vendor_phone: Optional[str]
    provider: Optional[str]
    telnyx_placed: bool
    raw_session: Dict[str, Any]
    metrics: Dict[str, Any]
    result_key: Optional[str] = None
    error: Optional[str] = None


class VoiceCallSubagent:
    """Planner-integrated subagent that orchestrates vendor voice calls."""

    def __init__(
        self,
        *,
        analytics_sink: Optional[AnalyticsSink] = None,
        base_url: Optional[str] = None,
        http_timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        backoff_initial: Optional[float] = None,
        backoff_multiplier: Optional[float] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        env_base = (os.getenv("VOICE_SERVICE_BASE_URL") or "").strip()
        self.base_url = (base_url or env_base or _DEFAULT_BASE_URL).rstrip("/")
        timeout_value = http_timeout or self._to_float(os.getenv("VOICE_SERVICE_TIMEOUT"))
        self.timeout = timeout_value if timeout_value is not None else _DEFAULT_TIMEOUT
        retries_value = max_retries or self._to_int(os.getenv("VOICE_SERVICE_MAX_RETRIES"))
        self.max_retries = retries_value if retries_value is not None else _DEFAULT_MAX_RETRIES
        backoff_value = backoff_initial or self._to_float(os.getenv("VOICE_SERVICE_RETRY_BACKOFF"))
        self.backoff_initial = (
            backoff_value if backoff_value is not None else _DEFAULT_INITIAL_BACKOFF
        )
        multiplier_value = backoff_multiplier or self._to_float(
            os.getenv("VOICE_SERVICE_RETRY_MULTIPLIER")
        )
        self.backoff_multiplier = (
            multiplier_value if multiplier_value is not None else _DEFAULT_BACKOFF_MULTIPLIER
        )
        self._analytics = analytics_sink or AnalyticsSink()
        self._client = http_client
        self._owns_client = http_client is None
        self._service_token = self._sanitize(os.getenv("AI_AGENT_SERVICE_TOKEN"))
        self._service_api_key = self._sanitize(os.getenv("AI_AGENT_SERVICE_API_KEY"))

    def supports_step(self, plan_step: MappingType[str, Any]) -> bool:
        """Return True when the planner step should be handled by this subagent."""

        if not isinstance(plan_step, MappingType):
            return False

        payload = plan_step.get("payload") or {}
        if not isinstance(payload, MappingType):
            payload = {}

        step_type = str(plan_step.get("type") or "").lower()
        tool_name = str(
            payload.get("tool_name")
            or payload.get("action")
            or payload.get("name")
            or plan_step.get("tool")
            or ""
        ).lower()

        if step_type in {"tool", "action"}:
            return "voice_vendor_call" in tool_name or tool_name.endswith("vendor_call")

        if step_type == "workflow":
            return "voice" in tool_name and "call" in tool_name

        return False

    async def execute(
        self,
        *,
        step_id: str,
        purchase_id: Union[int, str],
        agent_session_id: Optional[Union[int, str]] = None,
        goals: Optional[IterableType[str]] = None,
        metadata: Optional[MappingType[str, Any]] = None,
        planner_payload: Optional[MappingType[str, Any]] = None,
        conversation_id: Optional[str] = None,
        session_id: Optional[int] = None,
    ) -> VoiceCallResult:
        """Initiate the vendor call and return normalized session details."""

        result_key = (planner_payload or {}).get("result_key")
        callbacks = self._extract_callbacks((planner_payload or {}).get("callbacks"))

        analytics_metadata = {
            "step_id": step_id,
            "session_id": session_id,
            "conversation_id": conversation_id,
            "purchase_id": None,
            "agent_session_id": None,
        }

        start_time = time.perf_counter()
        attempt = 0
        total_sleep = 0.0
        error_message: Optional[str] = None
        call_response: Optional[Dict[str, Any]] = None

        try:
            normalized_purchase_id = self._to_int(purchase_id)
            if normalized_purchase_id is None:
                raise ValueError("purchase_id is required for voice call subagent")

            normalized_agent_session = self._to_int(agent_session_id)

            request_body: Dict[str, Any] = {"purchase_id": normalized_purchase_id}
            if normalized_agent_session is not None:
                request_body["agent_session_id"] = normalized_agent_session
            if goals:
                request_body["goals"] = [str(goal) for goal in goals]
            if metadata:
                request_body["metadata"] = dict(metadata)

            analytics_metadata.update(
                {
                    "purchase_id": normalized_purchase_id,
                    "agent_session_id": normalized_agent_session,
                }
            )

            await self._analytics.log_event(
                "subagent_invocation_started",
                tool="voice_call",
                status="started",
                metadata={**analytics_metadata, "goals": list(goals or [])},
            )

            while attempt < max(1, self.max_retries):
                attempt += 1
                try:
                    response = await self._post("/call-vendor", request_body)
                    call_response = response.json() or {}
                    break
                except Exception as exc:  # pylint: disable=broad-except
                    error_message = str(exc)
                    logger.warning(
                        "Voice call initiation attempt %s failed: %s", attempt, exc
                    )
                    await self._analytics.log_event(
                        "voice_call_retry",
                        tool="voice_call",
                        status="retry",
                        metadata={
                            **analytics_metadata,
                            "attempt": attempt,
                            "error": error_message,
                        },
                    )
                    if attempt >= max(1, self.max_retries):
                        raise
                    sleep_time = self.backoff_initial * (self.backoff_multiplier ** (attempt - 1))
                    total_sleep += sleep_time
                    await asyncio.sleep(sleep_time)

            if call_response is None:
                raise RuntimeError("Voice call initiation did not return a response")

            session_identifier = self._extract_session_id(call_response)
            if session_identifier is None:
                raise RuntimeError("Voice call API response missing session identifier")

            session_snapshot = await self._fetch_session(session_identifier)
            normalized_session = self._normalize_session(session_snapshot)
            status = normalized_session.get("status") or call_response.get("status") or "initiated"
            structured_notes = normalized_session.get("structured_notes")
            events = normalized_session.get("events") or []
            vendor_phone = normalized_session.get("vendor_phone")
            provider = (call_response.get("provider") or normalized_session.get("provider"))
            telnyx_placed = bool(
                call_response.get("telnyx")
                or call_response.get("telnyxPlaced")
                or normalized_session.get("telnyxPlaced")
            )

            metrics = {
                "latency_ms": int((time.perf_counter() - start_time) * 1000),
                "attempts": attempt,
                "retry_sleep_seconds": round(total_sleep, 3),
            }

            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="voice_call",
                status="success",
                metadata={
                    **analytics_metadata,
                    "voice_session_id": session_identifier,
                    "attempts": attempt,
                    "status": status,
                },
            )

            await self._dispatch_callbacks(
                callbacks,
                status_payload=self._build_status_payload(status, normalized_session),
                structured_payload=self._build_structured_payload(structured_notes),
                metadata={
                    "session_id": session_identifier,
                    "step_id": step_id,
                    "conversation_id": conversation_id,
                },
            )

            return VoiceCallResult(
                step_id=step_id,
                status=status,
                session_id=session_identifier,
                structured_notes=structured_notes,
                events=events,
                vendor_phone=vendor_phone,
                provider=provider,
                telnyx_placed=telnyx_placed,
                raw_session=normalized_session,
                metrics=metrics,
                result_key=result_key,
            )

        except Exception as exc:  # pylint: disable=broad-except
            error_message = str(exc)
            logger.exception("Voice call subagent failed: %s", exc)
            await self._analytics.log_event(
                "subagent_invocation_completed",
                tool="voice_call",
                status="error",
                metadata={**analytics_metadata, "error": error_message, "attempts": attempt},
            )
            metrics = {
                "latency_ms": int((time.perf_counter() - start_time) * 1000),
                "attempts": attempt,
                "retry_sleep_seconds": round(total_sleep, 3),
            }
            return VoiceCallResult(
                step_id=step_id,
                status="error",
                session_id=None,
                structured_notes=None,
                events=[],
                vendor_phone=None,
                provider=None,
                telnyx_placed=False,
                raw_session={},
                metrics=metrics,
                result_key=result_key,
                error=error_message,
            )

    async def aclose(self) -> None:
        """Close the underlying HTTP client when owned by the subagent."""

        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _post(self, path: str, payload: Dict[str, Any]) -> httpx.Response:
        client = await self._ensure_client()
        response = await client.post(
            f"{self.base_url}{path}",
            json=payload,
            headers=self._build_headers(),
        )
        response.raise_for_status()
        return response

    async def _fetch_session(self, session_id: int) -> Dict[str, Any]:
        client = await self._ensure_client()
        response = await client.get(
            f"{self.base_url}/vendor-call/{session_id}",
            headers=self._build_headers(),
        )
        response.raise_for_status()
        data = response.json() or {}
        if not isinstance(data, MappingType):
            raise RuntimeError("Voice service returned unexpected session payload")
        return dict(data)

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def _dispatch_callbacks(
        self,
        callbacks: Dict[str, SequenceType[CallbackType]],
        *,
        status_payload: Optional[Dict[str, Any]],
        structured_payload: Optional[Dict[str, Any]],
        metadata: Dict[str, Any],
    ) -> None:
        if not callbacks:
            return

        if status_payload:
            await self._emit_callback("onStatusChange", callbacks.get("onStatusChange"), status_payload, metadata)
        if structured_payload:
            await self._emit_callback(
                "onStructuredUpdate",
                callbacks.get("onStructuredUpdate"),
                structured_payload,
                metadata,
            )

    async def _emit_callback(
        self,
        callback_name: str,
        targets: Optional[SequenceType[CallbackType]],
        payload: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> None:
        if not targets:
            return

        for target in targets:
            if isinstance(target, str):
                await self._invoke_callback_url(callback_name, target, payload, metadata)
            elif isinstance(target, CallableType):
                await self._invoke_callback_callable(callback_name, target, payload, metadata)

    async def _invoke_callback_url(
        self,
        callback_name: str,
        url: str,
        payload: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> None:
        try:
            client = await self._ensure_client()
            response = await client.post(
                url,
                json={"payload": payload, "metadata": metadata},
                headers=self._build_headers(),
            )
            response.raise_for_status()
            await self._analytics.log_event(
                "voice_callback_dispatched",
                tool="voice_call",
                status="success",
                metadata={**metadata, "callback": callback_name, "target": url},
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Voice callback %s to %s failed: %s", callback_name, url, exc)
            await self._analytics.log_event(
                "voice_callback_dispatched",
                tool="voice_call",
                status="error",
                metadata={
                    **metadata,
                    "callback": callback_name,
                    "target": url,
                    "error": str(exc),
                },
            )

    async def _invoke_callback_callable(
        self,
        callback_name: str,
        handler: CallableType[[Dict[str, Any], Dict[str, Any]], Union[AwaitableType[None], None]],
        payload: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> None:
        try:
            result = handler(payload, metadata)
            if asyncio.iscoroutine(result):
                await result
            await self._analytics.log_event(
                "voice_callback_dispatched",
                tool="voice_call",
                status="success",
                metadata={**metadata, "callback": callback_name, "target": "callable"},
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Voice callback %s callable failed: %s", callback_name, exc)
            await self._analytics.log_event(
                "voice_callback_dispatched",
                tool="voice_call",
                status="error",
                metadata={
                    **metadata,
                    "callback": callback_name,
                    "target": "callable",
                    "error": str(exc),
                },
            )

    def _build_status_payload(
        self,
        status: str,
        session: MappingType[str, Any],
    ) -> Dict[str, Any]:
        timestamp = session.get("updated_at") or session.get("created_at")
        if hasattr(timestamp, "isoformat"):
            iso_timestamp = timestamp.isoformat()
        else:
            iso_timestamp = datetime.now(timezone.utc).isoformat()
        notes = session.get("pickup_notes") or session.get("pickup_time")
        return {"status": status, "timestamp": iso_timestamp, "notes": notes}

    @staticmethod
    def _build_structured_payload(structured: Optional[MappingType[str, Any]]) -> Optional[Dict[str, Any]]:
        if not structured:
            return None
        normalized = dict(structured)
        normalized.setdefault("source", "session_snapshot")
        return normalized

    @staticmethod
    def _normalize_session(session: MappingType[str, Any]) -> Dict[str, Any]:
        normalized = dict(session)
        events = normalized.get("events")
        if isinstance(events, SequenceType):
            normalized["events"] = list(events)
        else:
            normalized["events"] = []
        return normalized

    @staticmethod
    def _extract_session_id(payload: MappingType[str, Any]) -> Optional[int]:
        if not isinstance(payload, MappingType):
            return None
        if "session_id" in payload:
            return VoiceCallSubagent._to_int(payload.get("session_id"))
        session = payload.get("session")
        if isinstance(session, MappingType) and "id" in session:
            return VoiceCallSubagent._to_int(session.get("id"))
        return None

    @staticmethod
    def _extract_callbacks(raw_callbacks: Any) -> Dict[str, SequenceType[CallbackType]]:
        callbacks: Dict[str, SequenceType[CallbackType]] = {}
        if not isinstance(raw_callbacks, MappingType):
            return callbacks
        for key in ("onStatusChange", "onStructuredUpdate"):
            value = raw_callbacks.get(key)
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                callbacks[key] = [
                    item
                    for item in value
                    if isinstance(item, (str, CallableType))
                ]
            else:
                callbacks[key] = [value]
        return callbacks

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._service_token:
            headers["Authorization"] = self._service_token
        if self._service_api_key:
            headers["x-api-key"] = self._service_api_key
        return headers

    @staticmethod
    def _to_int(value: Any) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _to_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _sanitize(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


__all__ = ["VoiceCallSubagent", "VoiceCallResult"]
