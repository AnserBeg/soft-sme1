"""Database-backed conversation manager for the AI agent."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json, RealDictCursor

from .db import get_conn

logger = logging.getLogger(__name__)

DB_UNAVAILABLE_MESSAGE = "Database connection unavailable"

class ConversationManager:
    """Persist conversations to PostgreSQL."""

    def _get_connection(self):
        conn = get_conn()
        if conn is None:
            raise RuntimeError(DB_UNAVAILABLE_MESSAGE)
        return conn

    def create_conversation(self, user_id: Optional[int] = None) -> str:
        conversation_id = str(uuid.uuid4())
        conn = self._get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_conversations (id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (conversation_id, user_id),
            )
        logger.info("Created conversation %s for user %s", conversation_id, user_id)
        return conversation_id

    def add_message(
        self,
        conversation_id: str,
        message: str,
        is_user: bool,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        role = "user" if is_user else "assistant"
        message_id = str(uuid.uuid4())
        conn = self._get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_messages (id, conversation_id, role, content, metadata)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (message_id, conversation_id, role, message, Json(metadata or {})),
            )
            cur.execute(
                """
                UPDATE ai_conversations
                   SET last_message_at = NOW(),
                       updated_at = NOW()
                 WHERE id = %s
                """,
                (conversation_id,),
            )
        logger.debug("Added %s message %s to conversation %s", role, message_id, conversation_id)
        return message_id

    def get_conversation_history(
        self, conversation_id: str, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        sql = (
            """
            SELECT id, role, content, metadata, created_at
              FROM ai_messages
             WHERE conversation_id = %s
             ORDER BY created_at ASC
            """
        )
        if limit:
            sql += " LIMIT %s"
            params: tuple[Any, ...] = (conversation_id, limit)
        else:
            params = (conversation_id,)

        conn = self._get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        history: List[Dict[str, Any]] = []
        for row in rows:
            history.append(
                {
                    "id": row["id"],
                    "text": row["content"],
                    "is_user": row["role"] == "user",
                    "timestamp": row["created_at"].isoformat()
                    if isinstance(row["created_at"], datetime)
                    else str(row["created_at"]),
                    "metadata": row.get("metadata") or {},
                }
            )
        return history

    def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        conn = self._get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, status, metadata, created_at, updated_at, last_message_at
                  FROM ai_conversations
                 WHERE id = %s
                """,
                (conversation_id,),
            )
            row = cur.fetchone()

        if not row:
            return None

        return {
            "id": row["id"],
            "user_id": row.get("user_id"),
            "status": row.get("status"),
            "metadata": row.get("metadata") or {},
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
            "last_message_at": row.get("last_message_at"),
        }

    def clear_conversation(self, conversation_id: str) -> None:
        conn = self._get_connection()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ai_conversations WHERE id = %s", (conversation_id,))
        logger.info("Cleared conversation %s", conversation_id)

    def get_statistics(self) -> Dict[str, Any]:
        conn = self._get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ai_conversations")
            total_conversations = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM ai_messages")
            total_messages = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM ai_conversations WHERE status = 'active'")
            active = cur.fetchone()[0]

        return {
            "total_conversations": int(total_conversations or 0),
            "total_messages": int(total_messages or 0),
            "active_conversations": int(active or 0),
        }

    def record_reflection(
        self,
        conversation_id: str,
        *,
        trigger: str,
        summary: str,
        risk_level: str = "normal",
        recommendation: Optional[str] = None,
        requires_revision: bool = False,
        impacted_tools: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Persist a critic or reflection entry for the conversation."""

        reflection_id = str(uuid.uuid4())
        impacted_tools = impacted_tools or []
        payload = Json(metadata or {})

        conn = self._get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_conversation_reflections (
                    id,
                    conversation_id,
                    trigger,
                    risk_level,
                    summary,
                    recommendation,
                    requires_revision,
                    impacted_tools,
                    metadata
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                """,
                (
                    reflection_id,
                    conversation_id,
                    trigger,
                    risk_level.lower(),
                    summary,
                    recommendation,
                    requires_revision,
                    Json(list(impacted_tools or [])),
                    payload,
                ),
            )

        logger.debug(
            "Recorded reflection %s for conversation %s with trigger %s",
            reflection_id,
            conversation_id,
            trigger,
        )

        return reflection_id
