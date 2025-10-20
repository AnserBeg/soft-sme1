"""Dynamic schema introspection and prompt preparation for the SQL tool."""

from __future__ import annotations

import json
import hashlib
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from psycopg2.extras import RealDictCursor

from .db import get_conn

logger = logging.getLogger(__name__)

_DEFAULT_ALLOWED_TABLES = {
    "inventory",
    "customermaster",
    "vendormaster",
    "products",
    "salesorderhistory",
    "salesorderlineitems",
    "purchasehistory",
    "purchaselineitems",
    "quotes",
    "time_entries",
    "profiles",
    "business_profile",
    "global_settings",
    "labourrate",
    "qbo_account_mapping",
    "qbo_connection",
    "sessions",
    "attendance_shifts",
    "overhead_expense_distribution",
    "aggregated_parts_to_order",
    "sales_order_parts_to_order",
}


@dataclass
class ForeignKey:
    """Simple representation of a foreign key relationship."""

    column: str
    references_table: str
    references_column: str


@dataclass
class TableSchema:
    """Structured schema information for a table."""

    name: str
    columns: List[Dict[str, object]] = field(default_factory=list)
    primary_key: List[str] = field(default_factory=list)
    foreign_keys: List[ForeignKey] = field(default_factory=list)

    def filtered_columns(self, deny_list: Iterable[str]) -> List[Dict[str, object]]:
        deny = {col.lower() for col in deny_list}
        return [column for column in self.columns if column["name"].lower() not in deny]


class SchemaCache:
    """Internal cache payload for the introspector."""

    def __init__(
        self,
        tables: Dict[str, TableSchema],
        schema_hash: str,
        schema_version: str,
        llm_snippet: str,
    ) -> None:
        self.tables = tables
        self.schema_hash = schema_hash
        self.schema_version = schema_version
        self.llm_snippet = llm_snippet


class SchemaIntrospector:
    """Introspect the live PostgreSQL schema for allowed tables."""

    def __init__(
        self,
        *,
        allowed_tables: Optional[Iterable[str]] = None,
        deny_columns: Optional[Iterable[str]] = None,
        ttl_minutes: Optional[int] = None,
    ) -> None:
        raw_allowed = allowed_tables or self._parse_csv(os.getenv("AI_SQL_ALLOWED_TABLES"))
        if raw_allowed:
            normalized_allowed = {table.strip().lower() for table in raw_allowed if table.strip()}
        else:
            normalized_allowed = set(_DEFAULT_ALLOWED_TABLES)

        if not normalized_allowed:
            raise ValueError("SchemaIntrospector requires at least one allowed table")

        self.allowed_tables: frozenset[str] = frozenset(sorted(normalized_allowed))

        raw_deny = deny_columns or self._parse_csv(os.getenv("AI_SQL_DENY_COLUMNS"))
        self.deny_columns: frozenset[str] = frozenset(
            column.strip().lower() for column in (raw_deny or []) if column.strip()
        )

        ttl_value = ttl_minutes or self._parse_int(os.getenv("AI_SCHEMA_TTL_MINUTES"), default=15, minimum=1)
        self.ttl_seconds = ttl_value * 60

        self._lock = threading.RLock()
        self._cache: Optional[SchemaCache] = None
        self._cache_expiry: float = 0.0

    @staticmethod
    def _parse_csv(value: Optional[str]) -> Optional[List[str]]:
        if value is None:
            return None
        items = [item.strip() for item in value.split(",")]
        cleaned = [item for item in items if item]
        return cleaned or None

    @staticmethod
    def _parse_int(value: Optional[str], *, default: int, minimum: int) -> int:
        if value is None:
            return default
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            logger.warning("Invalid integer '%s' provided for schema TTL. Using default %s minutes.", value, default)
            return default
        return max(parsed, minimum)

    def refresh(self) -> SchemaCache:
        """Force refresh the schema cache."""

        with self._lock:
            cache = self._load_schema()
            self._cache = cache
            self._cache_expiry = time.time() + self.ttl_seconds
            return cache

    def get_llm_snippet(
        self,
        allowed_subset: Optional[Sequence[str]] = None,
    ) -> Tuple[str, Dict[str, str]]:
        """Return a concise schema snippet and metadata for prompts."""

        cache = self._ensure_cache()
        if allowed_subset:
            subset = {table.lower() for table in allowed_subset}
            snippet = self._build_llm_snippet(cache.tables, subset)
        else:
            snippet = cache.llm_snippet

        metadata = {
            "schema_version": cache.schema_version,
            "schema_hash": cache.schema_hash,
        }
        return snippet, metadata

    def get_table(self, name: str) -> Optional[TableSchema]:
        """Return cached schema for *name* if available."""

        cache = self._ensure_cache()
        return cache.tables.get(name.lower())

    def get_tables(self) -> Dict[str, TableSchema]:
        """Return cached schema for all allowed tables."""

        cache = self._ensure_cache()
        return cache.tables

    def _ensure_cache(self) -> SchemaCache:
        with self._lock:
            now = time.time()
            if self._cache is None or now >= self._cache_expiry:
                self._cache = self._load_schema()
                self._cache_expiry = now + self.ttl_seconds
            return self._cache

    def _load_schema(self) -> SchemaCache:
        conn = get_conn()
        if conn is None:
            raise RuntimeError("Database connection unavailable for schema introspection")

        tables: Dict[str, TableSchema] = {}
        allowed_list = sorted(self.allowed_tables)

        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT
                    LOWER(c.table_name) AS table_name,
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    c.character_maximum_length,
                    c.numeric_precision,
                    c.numeric_scale
                FROM information_schema.columns c
                WHERE
                    c.table_schema = 'public'
                    AND LOWER(c.table_name) = ANY(%s)
                ORDER BY c.table_name, c.ordinal_position
                """,
                (allowed_list,),
            )
            column_rows = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    LOWER(tc.table_name) AS table_name,
                    kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE
                    tc.constraint_type = 'PRIMARY KEY'
                    AND tc.table_schema = 'public'
                    AND LOWER(tc.table_name) = ANY(%s)
                ORDER BY tc.table_name, kcu.ordinal_position
                """,
                (allowed_list,),
            )
            pk_rows = cursor.fetchall()

            cursor.execute(
                """
                SELECT
                    LOWER(tc.table_name) AS table_name,
                    kcu.column_name,
                    LOWER(ccu.table_name) AS foreign_table_name,
                    ccu.column_name AS foreign_column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                WHERE
                    tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema = 'public'
                    AND LOWER(tc.table_name) = ANY(%s)
                ORDER BY tc.table_name, kcu.column_name
                """,
                (allowed_list,),
            )
            fk_rows = cursor.fetchall()

        for row in column_rows:
            table_name = row["table_name"].lower()
            table = tables.setdefault(table_name, TableSchema(name=table_name))
            table.columns.append(
                {
                    "name": row["column_name"],
                    "type": self._format_type(row),
                    "nullable": row["is_nullable"] == "YES",
                }
            )

        for row in pk_rows:
            table_name = row["table_name"].lower()
            if table_name not in tables:
                continue
            tables[table_name].primary_key.append(row["column_name"])

        for row in fk_rows:
            table_name = row["table_name"].lower()
            references_table = row["foreign_table_name"].lower()
            if table_name not in tables:
                continue
            if references_table not in self.allowed_tables:
                continue
            tables[table_name].foreign_keys.append(
                ForeignKey(
                    column=row["column_name"],
                    references_table=references_table,
                    references_column=row["foreign_column_name"],
                )
            )

        for table_name in allowed_list:
            tables.setdefault(table_name, TableSchema(name=table_name))

        for table in tables.values():
            table.columns = table.filtered_columns(self.deny_columns)

        schema_payload = {
            name: {
                "columns": table.columns,
                "primary_key": list(table.primary_key),
                "foreign_keys": [
                    {
                        "column": fk.column,
                        "references_table": fk.references_table,
                        "references_column": fk.references_column,
                    }
                    for fk in table.foreign_keys
                ],
            }
            for name, table in sorted(tables.items())
        }

        serialized = json.dumps(schema_payload, sort_keys=True)
        schema_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        schema_version = datetime.now(timezone.utc).isoformat()
        snippet = self._build_llm_snippet(tables, None)

        return SchemaCache(tables, schema_hash, schema_version, snippet)

    def _build_llm_snippet(
        self,
        tables: Dict[str, TableSchema],
        subset: Optional[Iterable[str]],
    ) -> str:
        target_tables = {name.lower() for name in subset} if subset else set(tables.keys())
        ordered_tables = sorted(target_tables & set(tables.keys()))
        deny = self.deny_columns

        lines: List[str] = []
        for table_name in ordered_tables:
            table = tables[table_name]
            columns = table.filtered_columns(deny)
            if not columns and not table.primary_key and not table.foreign_keys:
                continue

            heading = table.name
            if table.primary_key:
                heading += f" (primary key: {', '.join(table.primary_key)})"
            lines.append(heading)

            for column in columns:
                nullable = "NULL" if column["nullable"] else "NOT NULL"
                lines.append(f"  - {column['name']} ({column['type']}, {nullable})")

            if table.foreign_keys:
                lines.append("  foreign keys:")
                for fk in table.foreign_keys:
                    lines.append(
                        f"    * {fk.column} → {fk.references_table}.{fk.references_column}"
                    )

        return "\n".join(lines)

    @staticmethod
    def _format_type(row: Dict[str, object]) -> str:
        data_type = str(row.get("data_type") or "").lower()
        char_len = row.get("character_maximum_length")
        numeric_precision = row.get("numeric_precision")
        numeric_scale = row.get("numeric_scale")

        if char_len and isinstance(char_len, int):
            return f"{data_type}({char_len})"
        if numeric_precision and isinstance(numeric_precision, int):
            if numeric_scale and isinstance(numeric_scale, int):
                return f"{data_type}({numeric_precision},{numeric_scale})"
            return f"{data_type}({numeric_precision})"
        return data_type


_INTROSPECTOR_SINGLETON: Optional[SchemaIntrospector] = None
_SINGLETON_LOCK = threading.Lock()


def get_schema_introspector() -> SchemaIntrospector:
    """Return the shared SchemaIntrospector instance."""

    global _INTROSPECTOR_SINGLETON  # pylint: disable=global-statement
    if _INTROSPECTOR_SINGLETON is None:
        with _SINGLETON_LOCK:
            if _INTROSPECTOR_SINGLETON is None:
                _INTROSPECTOR_SINGLETON = SchemaIntrospector()
    return _INTROSPECTOR_SINGLETON


__all__ = ["SchemaIntrospector", "get_schema_introspector", "TableSchema", "ForeignKey"]
