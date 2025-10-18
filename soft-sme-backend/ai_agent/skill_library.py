"""Client for managing reusable workflow skills via the Node backend."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional

import httpx

DEFAULT_BASE_URL = "http://127.0.0.1:10000/api/agent/v2"

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SkillWorkflow:
    """Serializable representation of a persisted workflow skill."""

    id: str
    name: str
    version: int
    description: Optional[str]
    entrypoint: str
    parameters: Dict[str, Any]


class SkillLibraryClient:
    """Lightweight HTTP client that mirrors the analytics sink auth surface."""

    def __init__(self, base_url: Optional[str] = None, *, timeout: Optional[float] = None):
        self.base_url = (base_url or os.getenv("AGENT_V2_API_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.service_token = self._sanitize(os.getenv("AI_AGENT_SERVICE_TOKEN"))
        self.service_api_key = self._sanitize(os.getenv("AI_AGENT_SERVICE_API_KEY"))
        self.timeout = timeout or float(os.getenv("AGENT_V2_HTTP_TIMEOUT", "15"))
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def list_workflows(self) -> List[SkillWorkflow]:
        client = await self._ensure_client()
        try:
            response = await client.get(
                f"{self.base_url}/skills",
                headers=self._build_headers(),
            )
            response.raise_for_status()
            payload = response.json() or {}
            skills = payload.get("skills")
            if not isinstance(skills, list):
                return []
            return [self._parse_skill(item) for item in skills if isinstance(item, Mapping)]
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Skill library list failed: %s", exc)
            return []

    async def upsert_workflow(self, definition: Mapping[str, Any]) -> Optional[SkillWorkflow]:
        client = await self._ensure_client()
        try:
            response = await client.post(
                f"{self.base_url}/skills",
                headers=self._build_headers(),
                json=dict(definition),
            )
            response.raise_for_status()
            payload = response.json() or {}
            skill = payload.get("skill")
            if isinstance(skill, Mapping):
                return self._parse_skill(skill)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Skill library upsert failed: %s", exc)
        return None

    async def record_run_reflection(self, payload: Mapping[str, Any]) -> None:
        client = await self._ensure_client()
        try:
            response = await client.post(
                f"{self.base_url}/skills/runs",
                headers=self._build_headers(),
                json=dict(payload),
            )
            response.raise_for_status()
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Skill library reflection failed: %s", exc)

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

    @staticmethod
    def _parse_skill(payload: Mapping[str, Any]) -> SkillWorkflow:
        parameters = payload.get("parameters")
        if isinstance(parameters, Mapping):
            normalized_parameters = dict(parameters)
        else:
            normalized_parameters = {}
        return SkillWorkflow(
            id=str(payload.get("id") or payload.get("skillWorkflowId") or ""),
            name=str(payload.get("name") or "").strip(),
            version=int(payload.get("version") or 1),
            description=(
                str(payload.get("description"))
                if payload.get("description") is not None
                else None
            ),
            entrypoint=str(payload.get("entrypoint") or "").strip(),
            parameters=normalized_parameters,
        )


__all__ = ["SkillLibraryClient", "SkillWorkflow"]
