"""Analytics sink for shipping structured agent events to the Node backend."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://127.0.0.1:5000/api/agent/v2"


class AnalyticsSink:
    """Small client that forwards structured analytics events to the backend."""

    def __init__(self) -> None:
        self.base_url = os.getenv("AGENT_V2_API_URL", DEFAULT_BASE_URL).rstrip("/")
        self.service_token = self._sanitize(os.getenv("AI_AGENT_SERVICE_TOKEN"))
        self.service_api_key = self._sanitize(os.getenv("AI_AGENT_SERVICE_API_KEY"))
        self.timeout = float(os.getenv("AGENT_V2_HTTP_TIMEOUT", "15"))
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def log_event(
        self,
        event_type: str,
        *,
        source: str = "python_agent",
        session_id: Optional[int] = None,
        conversation_id: Optional[str] = None,
        tool: Optional[str] = None,
        status: Optional[str] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        trace_id: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "source": source,
            "eventType": event_type,
        }

        if session_id is not None:
            payload["sessionId"] = session_id
        if conversation_id is not None:
            payload["conversationId"] = conversation_id
        if tool is not None:
            payload["tool"] = tool
        if status is not None:
            payload["status"] = status
        if error_code is not None:
            payload["errorCode"] = error_code
        if error_message is not None:
            payload["errorMessage"] = error_message
        if trace_id is not None:
            payload["traceId"] = trace_id
        if latency_ms is not None:
            payload["latencyMs"] = latency_ms
        if metadata is not None:
            payload["metadata"] = metadata

        try:
            client = await self._ensure_client()
            response = await client.post(
                f"{self.base_url}/analytics/events",
                headers=self._build_headers(),
                json=payload,
            )
            response.raise_for_status()
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Analytics sink failed to log %s: %s", event_type, exc)

    async def aclose(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.service_token:
            headers["Authorization"] = self.service_token
        if self.service_api_key:
            headers["x-api-key"] = self.service_api_key
        return headers

    @staticmethod
    def _sanitize(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.startswith(('"', "'")) and stripped.endswith(('"', "'")):
            stripped = stripped[1:-1].strip()
        return stripped or None

