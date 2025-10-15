"""Async client for interacting with the planner service."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://127.0.0.1:8000"


class PlannerServiceError(Exception):
    """Raised when the planner service request fails."""


class PlannerClient:
    """Lightweight HTTP client used to communicate with the planner service."""

    def __init__(self) -> None:
        disabled_flag = os.getenv("PLANNER_SERVICE_DISABLED", "false").strip().lower()
        self._disabled = disabled_flag in {"1", "true", "yes", "on"}
        base_url = os.getenv("PLANNER_SERVICE_URL", _DEFAULT_BASE_URL).strip()
        self.base_url = base_url.rstrip("/") if base_url else _DEFAULT_BASE_URL
        self.timeout = float(os.getenv("PLANNER_SERVICE_TIMEOUT", "8"))
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def is_enabled(self) -> bool:
        """Return True when planner requests should be attempted."""

        return not self._disabled

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def generate_plan(
        self,
        *,
        session_id: int,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Call the planner service and return the parsed JSON response."""

        if not self.is_enabled:
            logger.debug("Planner client disabled via PLANNER_SERVICE_DISABLED flag; skipping call.")
            return None

        payload: Dict[str, Any] = {"session_id": session_id, "message": message}
        if context:
            payload["context"] = context

        try:
            client = await self._ensure_client()
            response = await client.post(f"{self.base_url}/plan", json=payload)
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pylint: disable=broad-except
            raise PlannerServiceError("Planner service request failed") from exc

        try:
            return response.json()
        except ValueError as exc:  # pragma: no cover - defensive guard
            raise PlannerServiceError("Planner service returned invalid JSON") from exc

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""

        if self._client:
            await self._client.aclose()
            self._client = None


__all__ = ["PlannerClient", "PlannerServiceError"]
