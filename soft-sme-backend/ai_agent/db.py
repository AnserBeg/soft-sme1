"""Database connection utilities for the AI agent."""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional, Tuple

import psycopg2
from psycopg2 import OperationalError
from psycopg2.extensions import connection, make_dsn

logger = logging.getLogger(__name__)

_CONNECTION_LOCK = threading.Lock()
_CONNECTION: Optional[connection] = None
_DSN_CACHE: Optional[Tuple[str, bool]] = None
_MAX_RETRIES = 10
_INITIAL_BACKOFF = 0.5


def _build_dsn() -> Tuple[str, bool]:
    """Return the connection string and whether it originated from DATABASE_URL."""
    global _DSN_CACHE  # pylint: disable=global-statement

    if _DSN_CACHE is not None:
        return _DSN_CACHE

    database_url = os.getenv("DATABASE_URL")
    if database_url:
        _DSN_CACHE = (database_url, True)
        return _DSN_CACHE

    params = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "dbname": os.getenv("DB_DATABASE", "soft_sme_db"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
        "sslmode": "require",
    }

    dsn = make_dsn(**params)
    _DSN_CACHE = (dsn, False)
    return _DSN_CACHE


def _connect_with_retry(dsn: str) -> Optional[connection]:
    """Attempt to connect to PostgreSQL with retries."""
    delay = _INITIAL_BACKOFF
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            conn = psycopg2.connect(dsn, connect_timeout=10)
            conn.autocommit = True
            logger.info("Database connection established on attempt %s", attempt)
            return conn
        except OperationalError as exc:  # pragma: no cover - transient errors
            logger.warning(
                "Database connection attempt %s/%s failed: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )
        except Exception as exc:  # pragma: no cover - unexpected errors
            logger.exception(
                "Unexpected error while connecting to the database on attempt %s/%s: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )

        if attempt < _MAX_RETRIES:
            time.sleep(delay)
            delay = min(delay * 2, 8)

    logger.error("All %s attempts to connect to the database have failed", _MAX_RETRIES)
    return None


def _ensure_connection() -> Optional[connection]:
    """Ensure a live database connection is available."""
    global _CONNECTION  # pylint: disable=global-statement

    with _CONNECTION_LOCK:
        if _CONNECTION and getattr(_CONNECTION, "closed", 0) == 0:
            return _CONNECTION

        # Close stale connections before attempting to reconnect
        if _CONNECTION and getattr(_CONNECTION, "closed", 0) != 0:
            try:
                _CONNECTION.close()
            except Exception:  # pragma: no cover - defensive close
                pass
        _CONNECTION = None

        dsn, _ = _build_dsn()
        _CONNECTION = _connect_with_retry(dsn)
        return _CONNECTION


def get_conn() -> Optional[connection]:
    """Return a live PostgreSQL connection or ``None`` if unavailable."""
    conn = _CONNECTION
    if conn and getattr(conn, "closed", 1) == 0:
        return conn

    return _ensure_connection()


def reset_connection() -> None:
    """Force the next ``get_conn`` call to establish a fresh connection."""
    global _CONNECTION  # pylint: disable=global-statement

    with _CONNECTION_LOCK:
        if _CONNECTION and getattr(_CONNECTION, "closed", 0) == 0:
            try:
                _CONNECTION.close()
            except Exception:  # pragma: no cover - defensive close
                logger.debug("Failed to close existing database connection during reset", exc_info=True)
        _CONNECTION = None


def database_url_present() -> bool:
    """Return True when DATABASE_URL is configured."""
    return bool(os.getenv("DATABASE_URL"))


__all__ = ["get_conn", "reset_connection", "database_url_present"]
