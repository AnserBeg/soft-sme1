"""Simple PostgreSQL-backed task queue for follow-up actions."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Sequence

from psycopg2.extras import Json

from .db import get_conn

logger = logging.getLogger(__name__)

DB_UNAVAILABLE_MESSAGE = "Database connection unavailable"


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Return a naive UTC datetime when *value* is a valid ISO timestamp."""

    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        if candidate.endswith("Z"):
            candidate = candidate[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            logger.debug("TaskQueue: unable to parse scheduled_for value %s", value)
            return None
        return parsed

    logger.debug("TaskQueue: unsupported scheduled_for value type %s", type(value))
    return None


def _to_bool(value: Any, default: bool = True) -> bool:
    """Best-effort conversion of planner-provided truthy/falsey values."""

    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return default
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False

    return bool(value)


@dataclass(frozen=True)
class TaskQueueSpec:
    """Normalized representation of a task queue insert request."""

    task_type: str
    payload: Dict[str, Any]
    conversation_id: Optional[str] = None
    scheduled_for: Optional[datetime] = None


@dataclass(frozen=True)
class TaskQueueFanoutTarget:
    """Planner-provided fan-out target describing a task queue notification."""

    task_type: str
    base_payload: Dict[str, Any]
    conversation_id: Optional[str] = None
    scheduled_for: Optional[datetime] = None
    include_event_payload: bool = True
    include_metadata: bool = True
    event_payload_key: str = "event"
    metadata_key: str = "metadata"
    inherit_conversation_id: bool = True

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> Optional["TaskQueueFanoutTarget"]:
        """Create a target from a raw planner callback mapping."""

        target_type = str(payload.get("type") or payload.get("target") or "").lower()
        if target_type not in {"task_queue", "queue", "ai_task_queue"}:
            return None

        task_type = str(payload.get("task_type") or payload.get("taskType") or "").strip()
        if not task_type:
            logger.debug("TaskQueueFanoutTarget: missing task_type in %s", payload)
            return None

        raw_payload = payload.get("payload") or {}
        if isinstance(raw_payload, Mapping):
            base_payload = dict(raw_payload)
        else:
            logger.debug("TaskQueueFanoutTarget: payload must be mapping, received %s", type(raw_payload))
            base_payload = {}

        scheduled_for = _parse_datetime(payload.get("scheduled_for") or payload.get("scheduledFor"))

        include_event_payload = _to_bool(payload.get("include_event_payload"), True)
        include_metadata = _to_bool(payload.get("include_metadata"), True)
        inherit_conversation_id = _to_bool(payload.get("inherit_conversation_id"), True)

        event_payload_key = str(payload.get("event_payload_key") or payload.get("eventPayloadKey") or "event").strip() or "event"
        metadata_key = str(payload.get("metadata_key") or payload.get("metadataKey") or "metadata").strip() or "metadata"

        conversation_id = payload.get("conversation_id") or payload.get("conversationId")
        if isinstance(conversation_id, str):
            conversation_id = conversation_id.strip() or None
        else:
            conversation_id = None

        return cls(
            task_type=task_type,
            base_payload=base_payload,
            conversation_id=conversation_id,
            scheduled_for=scheduled_for,
            include_event_payload=include_event_payload,
            include_metadata=include_metadata,
            event_payload_key=event_payload_key,
            metadata_key=metadata_key,
            inherit_conversation_id=inherit_conversation_id,
        )

    def build_spec(self, event_payload: Mapping[str, Any], metadata: Mapping[str, Any]) -> TaskQueueSpec:
        payload: Dict[str, Any] = dict(self.base_payload)
        if self.include_event_payload:
            payload.setdefault(self.event_payload_key, dict(event_payload))
        if self.include_metadata:
            payload.setdefault(self.metadata_key, dict(metadata))

        conversation_id = self.conversation_id
        if self.inherit_conversation_id and not conversation_id:
            candidate = metadata.get("conversation_id") or metadata.get("conversationId")
            if isinstance(candidate, str) and candidate:
                conversation_id = candidate

        return TaskQueueSpec(
            task_type=self.task_type,
            payload=payload,
            conversation_id=conversation_id,
            scheduled_for=self.scheduled_for,
        )


class TaskQueue:
    def __init__(self) -> None:
        self._conn_error = DB_UNAVAILABLE_MESSAGE

    def _get_connection(self):
        conn = get_conn()
        if conn is None:
            raise RuntimeError(self._conn_error)
        return conn

    def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        conversation_id: Optional[str] = None,
        scheduled_for: Optional[datetime] = None,
    ) -> str:
        spec = TaskQueueSpec(
            task_type=task_type,
            payload=dict(payload or {}),
            conversation_id=conversation_id,
            scheduled_for=scheduled_for,
        )
        task_ids = self.fan_out([spec])
        return task_ids[0]

    def fan_out(self, tasks: Sequence[TaskQueueSpec]) -> List[str]:
        """Enqueue multiple task specs in a single database transaction."""

        if not tasks:
            return []

        task_ids: List[str] = []
        conn = self._get_connection()
        with conn.cursor() as cur:
            for spec in tasks:
                cur.execute(
                    """
                    INSERT INTO ai_task_queue (task_type, payload, conversation_id, scheduled_for)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        spec.task_type,
                        Json(spec.payload or {}),
                        spec.conversation_id,
                        spec.scheduled_for or datetime.utcnow(),
                    ),
                )
                task_id = cur.fetchone()[0]
                task_ids.append(task_id)

        logger.info(
            "Enqueued %s follow-up task(s) for conversations %s",  # pragma: no cover - logging
            len(task_ids),
            [spec.conversation_id for spec in tasks],
        )
        return task_ids

