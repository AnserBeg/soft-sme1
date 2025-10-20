#!/usr/bin/env python3
"""Inventory SQL tool with dynamic schema introspection and safety guardrails."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, ClassVar, Dict, Iterable, List, Optional, Sequence, Tuple

from langchain.prompts import PromptTemplate
from langchain.tools import BaseTool
from langchain_openai import ChatOpenAI
from pydantic import PrivateAttr
from psycopg2 import sql as psycopg_sql
from psycopg2 import Error as PsycopgError
from psycopg2.extras import RealDictCursor

from .analytics_sink import AnalyticsSink
from .db import get_conn
from .schema_introspector import (
    SchemaIntrospector,
    TableSchema,
    get_schema_introspector,
)

logger = logging.getLogger(__name__)


@dataclass
class AliasRewrite:
    """Record of an alias rewrite performed on the generated SQL."""

    alias: str
    columns: List[str]


class AliasRewriteError(RuntimeError):
    """Raised when alias rewrites cannot be safely applied."""


class InventorySQLTool(BaseTool):
    """SQL tool for Aiven inventory queries with strict safety enforcement."""

    name: str = "inventory_query"
    description: str = "Query live inventory and order data from the Aiven database"
    _SQL_PREFIX: ClassVar[re.Pattern[str]] = re.compile(
        r"^\s*(SELECT|WITH|UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|TRUNCATE)\b",
        re.IGNORECASE,
    )
    _analytics_sink: Optional[AnalyticsSink] = PrivateAttr(default=None)
    _llm: Optional[ChatOpenAI] = PrivateAttr(default=None)
    _initialized: bool = PrivateAttr(default=False)
    _schema_introspector: SchemaIntrospector = PrivateAttr()
    _safe_tables: set[str] = PrivateAttr(default_factory=set)
    _fuzzy_fields: set[str] = PrivateAttr(default_factory=set)
    _alias_map: Dict[str, List[str]] = PrivateAttr(default_factory=dict)

    def __init__(
        self,
        db_config: Dict[str, Any],  # kept for backwards compatibility
        analytics_sink: Optional[AnalyticsSink] = None,
    ) -> None:
        super().__init__()
        self._analytics_sink = analytics_sink
        self._llm = None
        self._schema_introspector = get_schema_introspector()
        self._safe_tables = set(self._schema_introspector.allowed_tables)
        self._fuzzy_fields = self._load_fuzzy_fields()
        self._alias_map = self._load_alias_map()

        self._initialize()

    # ------------------------------------------------------------------
    # Initialization helpers
    # ------------------------------------------------------------------
    def _initialize(self) -> None:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            gemini_api_key = os.getenv("GEMINI_API_KEY")
            if not gemini_api_key:
                raise RuntimeError("GEMINI_API_KEY environment variable is required")

            self._llm = ChatGoogleGenerativeAI(
                model=os.getenv("AI_MODEL", "gemini-2.5-flash"),
                temperature=0,
                google_api_key=gemini_api_key,
            )
            self._initialized = True
            logger.info("Inventory SQL Tool initialized successfully")
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to initialize SQL Tool: %s", exc)
            raise

    @staticmethod
    def _load_fuzzy_fields() -> set[str]:
        raw = os.getenv("AI_FUZZY_FIELDS", "vendor_name,customer_name,part_name")
        fields = [item.strip().lower() for item in raw.split(",") if item.strip()]
        return set(fields)

    @staticmethod
    def _load_alias_map() -> Dict[str, List[str]]:
        default_map = {"address": ["street_address", "city", "province", "postal_code"]}
        raw = os.getenv("AI_SQL_ALIAS_MAP")
        if not raw:
            return default_map
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON for AI_SQL_ALIAS_MAP. Using default mapping.")
            return default_map
        result: Dict[str, List[str]] = {}
        for key, value in parsed.items():
            if not isinstance(key, str):
                continue
            if isinstance(value, str):
                columns = [value]
            elif isinstance(value, Sequence):
                columns = [str(item) for item in value if str(item).strip()]
            else:
                continue
            normalized_key = key.strip().lower()
            if normalized_key and columns:
                result[normalized_key] = [col.strip() for col in columns if col.strip()]
        return result or default_map

    # ------------------------------------------------------------------
    # Prompt construction
    # ------------------------------------------------------------------
    def _build_prompt(self, question: str) -> Tuple[str, Dict[str, str]]:
        schema_snippet, metadata = self._schema_introspector.get_llm_snippet()
        template = PromptTemplate(
            input_variables=["question", "schema_info", "schema_version", "schema_hash"],
            template="""
You are a SQL expert for the Aiven inventory management system.
Schema version: {schema_version} / hash: {schema_hash}
Generate a safe, read-only SQL query using only the allowed schema below.

{schema_info}

User question: {question}

Generate a single SELECT statement that answers the question.
Return only the SQL query, nothing else.
""",
        )
        prompt = template.format(
            question=question,
            schema_info=schema_snippet,
            schema_version=metadata.get("schema_version", "unknown"),
            schema_hash=metadata.get("schema_hash", "unknown"),
        )
        return prompt, metadata

    def _generate_sql(self, question: str) -> Tuple[str, Dict[str, str]]:
        if not self._llm:
            raise RuntimeError("LLM not initialized")
        prompt, metadata = self._build_prompt(question)
        sql_text = self._llm.invoke(prompt).content
        sql_text = self._normalize_sql_response(sql_text)
        return sql_text, metadata

    @staticmethod
    def _normalize_sql_response(sql_text: str) -> str:
        sql_text = sql_text.strip()
        if sql_text.startswith("```sql"):
            sql_text = sql_text[6:]
        if sql_text.endswith("```"):
            sql_text = sql_text[:-3]
        return sql_text.strip()

    # ------------------------------------------------------------------
    # Safety validation and rewriting
    # ------------------------------------------------------------------
    def _validate_sql(self, sql_text: str, schema_tables: Dict[str, TableSchema]) -> None:
        upper = sql_text.upper()

        dangerous_keywords = [
            "DELETE",
            "DROP",
            "INSERT",
            "UPDATE",
            "ALTER",
            "CREATE",
            "TRUNCATE",
            "GRANT",
            "REVOKE",
        ]
        for keyword in dangerous_keywords:
            if re.search(rf"\b{keyword}\b", upper):
                raise ValueError(f"Dangerous SQL keyword detected: {keyword}")

        if not upper.startswith("SELECT"):
            raise ValueError("Only SELECT statements are allowed")

        tables_in_query = self._extract_tables(sql_text)
        if not tables_in_query:
            raise ValueError("No tables referenced in query")

        for table in tables_in_query:
            if table.lower() not in self._safe_tables:
                raise ValueError(f"Table '{table}' is not in the allowed list")

        # Validate qualified column references
        qualified = re.findall(r"([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)", sql_text)
        for table, column in qualified:
            normalized_table = table.lower()
            normalized_column = column.lower()
            table_schema = schema_tables.get(normalized_table)
            if table_schema is None:
                continue
            allowed_columns = {col["name"].lower() for col in table_schema.columns}
            if normalized_column not in allowed_columns:
                raise ValueError(
                    f"Column '{column}' is not allowed on table '{table}'"
                )

    def _extract_tables(self, sql_text: str) -> List[str]:
        pattern = re.compile(r"\bFROM\s+([a-zA-Z0-9_]+)|\bJOIN\s+([a-zA-Z0-9_]+)", re.IGNORECASE)
        matches = pattern.findall(sql_text)
        tables = {match[0] or match[1] for match in matches}
        return [table for table in tables if table]

    def _rewrite_aliases(
        self,
        sql_text: str,
        schema_tables: Dict[str, TableSchema],
    ) -> Tuple[str, List[AliasRewrite]]:
        rewrites: List[AliasRewrite] = []
        updated_sql = sql_text

        select_pattern = re.compile(
            r"SELECT\s+(.*?)\s+FROM\s",
            re.IGNORECASE | re.DOTALL,
        )

        for alias, columns in self._alias_map.items():
            pattern = re.compile(rf"\b{re.escape(alias)}\b", re.IGNORECASE)
            if not pattern.search(updated_sql):
                continue

            select_match = select_pattern.search(updated_sql)
            select_clause = select_match.group(1) if select_match else None
            for column in columns:
                if not self._column_exists(column, schema_tables):
                    raise AliasRewriteError(
                        f"Alias '{alias}' maps to unknown column '{column}'"
                    )

            select_changed = False
            if select_clause and select_match:
                replaced = pattern.sub(", ".join(columns), select_clause)
                if replaced != select_clause:
                    updated_sql = (
                        updated_sql[: select_match.start(1)]
                        + replaced
                        + updated_sql[select_match.end(1) :]
                    )
                    select_clause = replaced
                    select_changed = True

            def where_rewrite(match: re.Match[str]) -> str:
                operator = match.group("op")
                value = match.group("value")
                rewritten = " OR ".join(
                    f"{col} {operator} {value}" for col in columns
                )
                return f"({rewritten})"

            where_pattern = re.compile(
                rf"\b{re.escape(alias)}\b\s*(?P<op>=|ILIKE|LIKE)\s*(?P<value>[^)\n]+)",
                re.IGNORECASE,
            )
            updated_sql, occurrences = where_pattern.subn(where_rewrite, updated_sql)

            if occurrences > 0 or select_changed:
                rewrites.append(AliasRewrite(alias=alias, columns=columns))

        return updated_sql, rewrites

    @staticmethod
    def _column_exists(column: str, schema_tables: Dict[str, TableSchema]) -> bool:
        for table in schema_tables.values():
            if any(col["name"].lower() == column.lower() for col in table.columns):
                return True
        return False

    # ------------------------------------------------------------------
    # Execution helpers
    # ------------------------------------------------------------------
    def _execute_sql(self, sql_text: str) -> Tuple[List[Dict[str, Any]], int]:
        conn = get_conn()
        if conn is None:
            raise RuntimeError("Database connection unavailable")
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql_text)
            results = cursor.fetchall()
        return [dict(row) for row in results], len(results)

    def _maybe_apply_fuzzy_fallback(
        self,
        sql_text: str,
        cursor,
        schema_tables: Dict[str, TableSchema],
    ) -> Tuple[Optional[str], Optional[List[Dict[str, Any]]], Optional[str]]:
        table = self._determine_primary_table(sql_text)
        if not table:
            return None, None, None

        table_schema = schema_tables.get(table.lower())
        if not table_schema:
            return None, None, None

        for field in self._fuzzy_fields:
            pattern = re.compile(
                rf"\b{field}\b\s*=\s*(['\"])(?P<value>[^'\"]+)\1",
                re.IGNORECASE,
            )
            match = pattern.search(sql_text)
            if not match:
                continue
            value = match.group("value").strip()
            if not value or value.isdigit():
                continue
            matching_column = next(
                (col["name"] for col in table_schema.columns if col["name"].lower() == field),
                None,
            )
            if not matching_column:
                continue

            like_value = "%" + "%".join(value.split()) + "%"
            pk_columns = list(table_schema.primary_key)
            select_columns: List[str] = []
            for column_name in [*pk_columns, matching_column]:
                if column_name not in select_columns:
                    select_columns.append(column_name)

            identifier_table = psycopg_sql.Identifier(table)
            identifier_field = psycopg_sql.Identifier(matching_column)
            order_identifier = psycopg_sql.Identifier(pk_columns[0] if pk_columns else matching_column)
            select_list = psycopg_sql.SQL(", ").join(
                psycopg_sql.Identifier(col) for col in select_columns
            )
            fuzzy_query = psycopg_sql.SQL("SELECT {columns} FROM {table} WHERE {field} ILIKE %s ORDER BY {order} LIMIT 5").format(
                columns=select_list,
                table=identifier_table,
                field=identifier_field,
                order=order_identifier,
            )

            cursor.execute(fuzzy_query, (like_value,))
            candidate_rows = [dict(row) for row in cursor.fetchall()]
            if not candidate_rows:
                return matching_column, [], table
            return matching_column, candidate_rows, table

        return None, None, table

    def _determine_primary_table(self, sql_text: str) -> Optional[str]:
        match = re.search(r"\bFROM\s+([a-zA-Z0-9_]+)", sql_text, re.IGNORECASE)
        return match.group(1) if match else None

    def _should_refresh_on_error(self, error: Exception) -> bool:
        message = str(error).lower()
        return any(
            token in message
            for token in (
                "does not exist",
                "undefined table",
                "undefined column",
                "relation",
            )
        )

    def _log_async(self, coro: Optional[Any]) -> None:
        if not coro:
            return
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            loop.create_task(coro)  # type: ignore[attr-defined]
        else:
            asyncio.run(coro)

    def _emit_event(self, event_type: str, **metadata: Any) -> None:
        if not self._analytics_sink:
            return
        coro = self._analytics_sink.log_event(
            event_type,
            tool="inventory_query",
            status=metadata.pop("status", None),
            metadata=metadata or None,
        )
        self._log_async(coro)

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------
    def _run(self, query: str) -> str:
        if not self._initialized:
            return "SQL Tool not initialized"

        user_question: Optional[str] = None
        retry_count = 0
        refresh_reason: Optional[str] = None
        alias_rewrites: List[AliasRewrite] = []
        used_fuzzy = False
        fuzzy_candidates: Optional[List[Dict[str, Any]]] = None
        fuzzy_field: Optional[str] = None
        schema_metadata: Dict[str, str] = {}

        normalized_query = query.strip()
        if self._looks_like_sql(normalized_query):
            sql_text = normalized_query
            _, schema_metadata = self._schema_introspector.get_llm_snippet()
        else:
            user_question = query
            try:
                sql_text, schema_metadata = self._generate_sql(query)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("SQL generation error: %s", exc)
                return f"Failed to generate SQL: {exc}"

        while True:
            try:
                schema_tables = self._schema_introspector.get_tables()
                rewritten_sql, new_rewrites = self._rewrite_aliases(sql_text, schema_tables)
                alias_rewrites.extend(new_rewrites)
                self._validate_sql(rewritten_sql, schema_tables)

                conn = get_conn()
                if conn is None:
                    raise RuntimeError("Database error: connection unavailable")

                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(rewritten_sql)
                    results = [dict(row) for row in cursor.fetchall()]
                    rows_returned = len(results)

                    if rows_returned == 0:
                        field, candidates, table_name = self._maybe_apply_fuzzy_fallback(
                            rewritten_sql,
                            cursor,
                            schema_tables,
                        )
                        if field is not None:
                            used_fuzzy = True
                            fuzzy_field = field
                            fuzzy_candidates = candidates
                            if not candidates:
                                self._emit_event(
                                    "sql_empty_result_after_fuzzy",
                                    status="empty",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    field=field,
                                )
                                return "No results found, even after a fuzzy lookup."
                            if len(candidates) == 1:
                                rows_returned = 1
                                results = candidates
                            else:
                                table_schema = schema_tables.get((table_name or "").lower())
                                primary_keys = table_schema.primary_key if table_schema else []
                                top_candidates = [
                                    {
                                        key: row.get(key)
                                        for key in sorted(row.keys())
                                        if key in set(primary_keys) | {field}
                                    }
                                    for row in candidates
                                ]
                                candidate_lines = [
                                    ", ".join(f"{key}={value}" for key, value in item.items() if value is not None)
                                    for item in top_candidates
                                ]
                                self._emit_event(
                                    "sql_fuzzy_fallback",
                                    status="disambiguate",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    field=field,
                                    candidate_count=len(candidates),
                                )
                                return (
                                    "I found multiple possible matches. Please confirm which one you meant:\n"
                                    + "\n".join(f"- {line}" for line in candidate_lines)
                                )

                    response = self._format_results(results, rows_returned)
                    self._emit_event(
                        "sql_tool_completed",
                        status="success",
                        schema_version=schema_metadata.get("schema_version"),
                        schema_hash=schema_metadata.get("schema_hash"),
                        refresh_reason=refresh_reason,
                        retry_count=retry_count,
                        used_fuzzy=used_fuzzy,
                        fuzzy_field=fuzzy_field,
                        alias_rewrites=[rewrite.__dict__ for rewrite in alias_rewrites] or None,
                        rows_returned=rows_returned,
                    )
                    if used_fuzzy and fuzzy_candidates:
                        self._emit_event(
                            "sql_fuzzy_fallback",
                            status="success",
                            schema_version=schema_metadata.get("schema_version"),
                            schema_hash=schema_metadata.get("schema_hash"),
                            field=fuzzy_field,
                            candidate_count=len(fuzzy_candidates),
                        )
                    return response
            except AliasRewriteError as exc:
                logger.warning("Alias rewrite error: %s", exc)
                return f"Unable to rewrite SQL aliases safely: {exc}"
            except ValueError as exc:
                logger.warning("SQL validation error: %s", exc)
                return f"Error: {exc}"
            except PsycopgError as exc:  # pragma: no cover - runtime DB errors
                logger.error("SQL execution error: %s", exc)
                if retry_count == 0 and self._should_refresh_on_error(exc):
                    retry_count += 1
                    refresh_reason = "ddl_mismatch"
                    self._schema_introspector.refresh()
                    self._emit_event(
                        "sql_refresh_on_error",
                        status="refresh",
                        schema_version=schema_metadata.get("schema_version"),
                        schema_hash=schema_metadata.get("schema_hash"),
                        reason=refresh_reason,
                    )
                    if user_question:
                        sql_text, schema_metadata = self._generate_sql(user_question)
                    else:
                        _, schema_metadata = self._schema_introspector.get_llm_snippet()
                    continue
                self._emit_event(
                    "sql_ddl_mismatch_failure",
                    status="failed",
                    schema_version=schema_metadata.get("schema_version"),
                    schema_hash=schema_metadata.get("schema_hash"),
                    retry_count=retry_count,
                    error=str(exc),
                )
                return f"Database error: {exc}"
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Unexpected SQL tool error: %s", exc)
                self._emit_event(
                    "sql_tool_completed",
                    status="error",
                    schema_version=schema_metadata.get("schema_version"),
                    schema_hash=schema_metadata.get("schema_hash"),
                    refresh_reason=refresh_reason,
                    retry_count=retry_count,
                    error=str(exc),
                )
                return f"Database error: {exc}"

    def _format_results(self, rows: List[Dict[str, Any]], total_rows: int) -> str:
        if not rows:
            return "No data found for this query."
        limited = rows[:20]
        payload = json.dumps(limited, default=str)
        if total_rows > 20:
            return f"Found {total_rows} results (showing first 20):\n{payload}"
        return f"Found {total_rows} results:\n{payload}"

    @classmethod
    def _looks_like_sql(cls, text: str) -> bool:
        return bool(cls._SQL_PREFIX.match(text))

    async def _arun(self, query: str) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run, query)

    def test_connection(self) -> bool:
        try:
            conn = get_conn()
            if conn is None:
                return False
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            return True
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Database connection test failed: %s", exc)
            return False

    def get_table_info(self, table_name: str) -> List[Dict[str, Any]]:
        schema = self._schema_introspector.get_table(table_name.lower())
        if not schema:
            return []
        return list(schema.columns)

    def get_sample_data(self, table_name: str, limit: int = 5) -> List[Dict[str, Any]]:
        conn = get_conn()
        if conn is None:
            return []
        if table_name.lower() not in self._safe_tables:
            return []
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                psycopg_sql.SQL("SELECT * FROM {table} LIMIT %s").format(
                    table=psycopg_sql.Identifier(table_name)
                ),
                (limit,),
            )
            rows = cursor.fetchall()
        return [dict(row) for row in rows]
