"""Simple PostgreSQL-backed task queue for follow-up actions."""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, Optional

import psycopg2
from psycopg2.extras import Json

logger = logging.getLogger(__name__)


def _connection_params() -> Dict[str, Any]:
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "dbname": os.getenv("DB_DATABASE", "soft_sme_db"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", "123"),
        "port": int(os.getenv("DB_PORT", "5432")),
    }


class TaskQueue:
    def __init__(self) -> None:
        self._conn_params = _connection_params()

    def _get_connection(self):
        return psycopg2.connect(**self._conn_params)

    def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        conversation_id: Optional[str] = None,
        scheduled_for: Optional[datetime] = None,
    ) -> str:
        with self._get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_task_queue (task_type, payload, conversation_id, scheduled_for)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (
                    task_type,
                    Json(payload or {}),
                    conversation_id,
                    scheduled_for or datetime.utcnow(),
                ),
            )
            task_id = cur.fetchone()[0]
        logger.info("Enqueued follow-up task %s for conversation %s", task_id, conversation_id)
        return task_id
