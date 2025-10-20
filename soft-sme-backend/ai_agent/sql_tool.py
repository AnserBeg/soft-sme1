#!/usr/bin/env python3
"""Inventory SQL tool with dynamic schema introspection and safety guardrails."""

from __future__ import annotations

import asyncio
import hashlib
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
from psycopg2 import Error as PsycopgError
from psycopg2 import sql as psycopg_sql
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
    _FUZZY_STOPWORDS: ClassVar[set[str]] = {"for", "and", "the", "of"}
    _analytics_sink: Optional[AnalyticsSink] = PrivateAttr(default=None)
    _llm: Optional[ChatOpenAI] = PrivateAttr(default=None)
    _initialized: bool = PrivateAttr(default=False)
    _schema_introspector: SchemaIntrospector = PrivateAttr()
    _safe_tables: set[str] = PrivateAttr(default_factory=set)
    _fuzzy_config: FuzzyConfig = PrivateAttr()
    _fuzzy_fields: set[str] = PrivateAttr(default_factory=set)
    _trgm_available: Optional[bool] = PrivateAttr(default=None)
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
        self._fuzzy_config = self._load_fuzzy_config()
        self._fuzzy_fields = set(self._fuzzy_config.fields)
        self._trgm_available = None
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
    def _get_bool_env(name: str, default: bool) -> bool:
        raw = os.getenv(name)
        if raw is None:
            return default
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _get_int_env(name: str, default: int, minimum: Optional[int] = None) -> int:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            value = int(raw)
        except ValueError:
            logger.warning("Invalid integer for %s: %s. Using default %s.", name, raw, default)
            return default
        if minimum is not None and value < minimum:
            logger.warning("Value for %s below minimum %s. Using minimum.", name, minimum)
            return minimum
        return value

    @staticmethod
    def _get_float_env(name: str, default: float, minimum: Optional[float] = None) -> float:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            value = float(raw)
        except ValueError:
            logger.warning("Invalid float for %s: %s. Using default %s.", name, raw, default)
            return default
        if minimum is not None and value < minimum:
            logger.warning("Value for %s below minimum %s. Using minimum.", name, minimum)
            return minimum
        return value

    def _load_fuzzy_config(self) -> FuzzyConfig:
        fields = self._load_fuzzy_fields()
        enabled = self._get_bool_env("AI_FUZZY_ENABLED", True)
        limit = self._get_int_env("AI_FUZZY_LIMIT", 5, minimum=1)
        min_length = self._get_int_env("AI_FUZZY_MINLEN", 3, minimum=1)
        use_trgm = self._get_bool_env("AI_FUZZY_USE_TRGM", True)
        trgm_threshold = self._get_float_env("AI_FUZZY_TRGM_THRESHOLD", 0.25, minimum=0.0)
        tokenize = self._get_bool_env("AI_FUZZY_TOKENIZE", True)
        return FuzzyConfig(
            enabled=enabled,
            fields=fields,
            limit=limit,
            min_length=min_length,
            use_trgm=use_trgm,
            trgm_threshold=trgm_threshold,
            tokenize=tokenize,
        )

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
        aliases = self._extract_aliases(sql_text)
        qualified = re.findall(r"([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)", sql_text)
        for table, column in qualified:
            normalized_table = table.lower()
            normalized_column = column.lower()
            resolved_table = aliases.get(normalized_table, normalized_table)
            table_schema = schema_tables.get(resolved_table)
            if table_schema is None:
                continue
            allowed_columns = {col["name"].lower() for col in table_schema.columns}
            if normalized_column not in allowed_columns:
                if resolved_table != normalized_table:
                    raise ValueError(
                        "Column '{}' is not available on alias '{}' (maps to '{}')".format(
                            column,
                            table,
                            resolved_table,
                        )
                    )
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

    @staticmethod
    def _resolve_column_name(
        table_schema: TableSchema, column_name: str
    ) -> Optional[str]:
        target = column_name.lower()
        for column in table_schema.columns:
            if column["name"].lower() == target:
                return column["name"]
        return None

    @staticmethod
    def _is_textual_column(column: Dict[str, Any]) -> bool:
        data_type = str(column.get("type", "")).lower()
        return any(token in data_type for token in ("char", "text", "citext"))

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        if not re.match(r"^[A-Za-z0-9_]+$", identifier):
            raise ValueError(f"Unsafe identifier: {identifier}")
        return f'"{identifier}"'

    @staticmethod
    def _tokenize_search_value(value: str) -> List[str]:
        tokens = re.split(r"[^A-Za-z0-9]+", value)
        filtered: List[str] = []
        for token in tokens:
            if not token:
                continue
            if not any(ch.isalpha() for ch in token):
                continue
            filtered.append(token)
        return filtered

    @staticmethod
    def _hash_sql(sql_text: str) -> str:
        return hashlib.sha256(sql_text.encode("utf-8")).hexdigest()

    def _ensure_trgm_available(self, cursor) -> bool:
        if self._trgm_available is not None:
            return self._trgm_available
        if not self._fuzzy_config.use_trgm:
            self._trgm_available = False
            return False
        try:
            cursor.execute(
                "SELECT 1 FROM pg_extension WHERE extname = %s", ("pg_trgm",)
            )
            row = None
            try:
                row = cursor.fetchone()
            except AttributeError:
                fetched = cursor.fetchall()
                row = fetched[0] if fetched else None
            self._trgm_available = bool(row)
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("pg_trgm extension detection failed: %s", exc)
            self._trgm_available = False
        return bool(self._trgm_available)

    def _extract_aliases(self, sql_text: str) -> Dict[str, str]:
        alias_pattern = re.compile(
            r"\b(FROM|JOIN)\s+([a-zA-Z0-9_]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?",
            re.IGNORECASE,
        )
        aliases: Dict[str, str] = {}
        for match in alias_pattern.finditer(sql_text):
            table = match.group(2)
            alias = match.group(3) or table
            aliases[alias.lower()] = table
            aliases[table.lower()] = table
        return aliases

    def _extract_field_conditions(
        self, sql_text: str, aliases: Dict[str, str]
    ) -> List[FieldCondition]:
        pattern = re.compile(
            r"(?P<field>(?:[a-zA-Z0-9_]+\.)?[a-zA-Z0-9_]+)\s*=\s*(?P<value>'[^']*'|\"[^\"]*\"|%s|:\w+|%\([^\)]+\)s|\$\d+)",
            re.IGNORECASE,
        )
        conditions: List[FieldCondition] = []
        for match in pattern.finditer(sql_text):
            field = match.group("field").strip()
            value_token = match.group("value").strip()
            table: Optional[str] = None
            alias: Optional[str] = None
            column = field
            if "." in field:
                alias, column = [part.strip() for part in field.split(".", 1)]
            alias_key = alias.lower() if alias else None
            if alias_key and alias_key in aliases:
                table = aliases[alias_key]
            value: Optional[str] = None
            if value_token.startswith("'") and value_token.endswith("'"):
                value = value_token[1:-1].replace("''", "'")
            elif value_token.startswith('"') and value_token.endswith('"'):
                value = value_token[1:-1]
            elif value_token.lower() == "null":
                value = None
            conditions.append(
                FieldCondition(
                    table=table,
                    column=column,
                    value=value,
                    alias=alias_key,
                )
            )
        return conditions

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
    ) -> FuzzyAttempt:
        config = self._fuzzy_config
        if not config.enabled:
            return FuzzyAttempt(used=False, reason_no_fuzzy="disabled")

        normalized = sql_text.strip()
        if not normalized.upper().startswith("SELECT") and not normalized.upper().startswith("WITH"):
            return FuzzyAttempt(used=False, reason_no_fuzzy="not_select")

        aliases = self._extract_aliases(sql_text)
        conditions = self._extract_field_conditions(sql_text, aliases)
        if not conditions:
            return FuzzyAttempt(used=False, reason_no_fuzzy="no_equality_predicates")

        base_table = self._determine_primary_table(sql_text)
        chosen_condition: Optional[FieldCondition] = None
        chosen_table_schema: Optional[TableSchema] = None
        selected_column_lower: Optional[str] = None
        for condition in conditions:
            column_lower = condition.column.lower()
            if column_lower not in config.fields:
                continue
            if condition.value is None:
                continue
            value = condition.value.strip()
            if len(value) < config.min_length:
                continue
            if not re.search(r"[A-Za-z]", value):
                continue
            table_name = condition.table or base_table
            if not table_name:
                continue
            if table_name.lower() not in self._safe_tables:
                continue
            table_schema = schema_tables.get(table_name.lower())
            if not table_schema:
                continue
            column_schema = next(
                (
                    column
                    for column in table_schema.columns
                    if column["name"].lower() == column_lower
                ),
                None,
            )
            if not column_schema or not self._is_textual_column(column_schema):
                continue
            condition.table = table_schema.name
            condition.column = column_schema["name"]
            condition.value = value
            chosen_condition = condition
            chosen_table_schema = table_schema
            selected_column_lower = column_schema["name"].lower()
            break

        if not chosen_condition or not chosen_table_schema:
            return FuzzyAttempt(used=False, reason_no_fuzzy="no_fuzzy_field")

        additional_filters: List[FieldCondition] = []
        for condition in conditions:
            if condition.value is None:
                continue
            if selected_column_lower and condition.column.lower() == selected_column_lower:
                continue
            if (
                condition.table
                and condition.table.lower() == chosen_table_schema.name.lower()
            ):
                resolved = self._resolve_column_name(chosen_table_schema, condition.column)
                if not resolved:
                    continue
                condition.column = resolved
                condition.table = chosen_table_schema.name
                condition.value = condition.value.strip()
                additional_filters.append(condition)

        strategy = "ilike"
        fuzzy_query = ""
        params: List[Any] = []
        threshold: Optional[float] = None
        table_ident = self._quote_identifier(chosen_table_schema.name)
        field_ident = self._quote_identifier(chosen_condition.column)
        search_value = chosen_condition.value

        use_trgm = False
        if config.use_trgm and self._ensure_trgm_available(cursor):
            try:
                cursor.execute("SELECT set_limit(%s)", (config.trgm_threshold,))
                try:
                    cursor.fetchone()
                except AttributeError:
                    pass
                use_trgm = True
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Failed to configure trigram similarity: %s", exc)
                use_trgm = False

        candidates: List[Dict[str, Any]] = []
        try:
            if use_trgm:
                strategy = "trgm"
                threshold = config.trgm_threshold
                fuzzy_query = (
                    f"SELECT *, similarity({field_ident}, %s) AS similarity_score "
                    f"FROM {table_ident} "
                    f"WHERE {field_ident} % %s "
                    f"AND similarity({field_ident}, %s) >= %s"
                )
                params = [search_value, search_value, search_value, threshold]
            else:
                tokens = self._tokenize_search_value(search_value) if config.tokenize else []
                tokens = [
                    token
                    for token in tokens
                    if token.lower() not in self._FUZZY_STOPWORDS
                ]
                if not tokens:
                    tokens = [search_value]
                clauses = [f"{field_ident} ILIKE %s" for _ in tokens]
                params = [f"%{token}%" for token in tokens]
                fuzzy_query = (
                    f"SELECT * FROM {table_ident} "
                    f"WHERE {' AND '.join(clauses)}"
                )

            for filter_condition in additional_filters:
                filter_field = self._quote_identifier(filter_condition.column)
                fuzzy_query += f" AND {filter_field} = %s"
                params.append(filter_condition.value)

            if use_trgm:
                fuzzy_query += " ORDER BY similarity_score DESC LIMIT %s"
            else:
                fuzzy_query += f" ORDER BY LENGTH({field_ident}) ASC LIMIT %s"
            params.append(config.limit)

            cursor.execute(fuzzy_query, tuple(params))
            rows = cursor.fetchall()
            candidates = [dict(row) for row in rows]
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Fuzzy query execution failed: %s", exc)
            return FuzzyAttempt(used=False, reason_no_fuzzy="fuzzy_execution_failed")

        for row in candidates:
            row.pop("similarity_score", None)

        query_hash = self._hash_sql(fuzzy_query)

        return FuzzyAttempt(
            used=True,
            field=chosen_condition.column,
            table=chosen_table_schema.name,
            strategy=strategy,
            candidates=candidates,
            search_value=search_value,
            fuzzy_query_hash=query_hash,
            limit=config.limit,
            threshold=threshold,
        )

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

    def _should_refresh_on_validation_error(self, error: Exception) -> bool:
        message = str(error).lower()
        if "column" not in message:
            return False
        return any(token in message for token in ("not allowed", "not available", "unknown"))

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
        validation_retry_performed = False
        used_fuzzy = False
        fuzzy_candidates: Optional[List[Dict[str, Any]]] = None
        fuzzy_field: Optional[str] = None
        fuzzy_strategy: Optional[str] = None
        fuzzy_reason: Optional[str] = None
        fuzzy_search_value: Optional[str] = None
        fuzzy_query_hash: Optional[str] = None
        fuzzy_limit: Optional[int] = None
        fuzzy_threshold: Optional[float] = None
        base_query_hash: Optional[str] = None
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
            alias_rewrites: List[AliasRewrite] = []
            try:
                used_fuzzy = False
                fuzzy_candidates = None
                fuzzy_field = None
                fuzzy_strategy = None
                fuzzy_reason = None
                fuzzy_search_value = None
                fuzzy_query_hash = None
                fuzzy_limit = None
                fuzzy_threshold = None
                base_query_hash = None
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
                    base_query_hash = self._hash_sql(rewritten_sql)

                    if rows_returned == 0:
                        fuzzy_outcome = self._maybe_apply_fuzzy_fallback(
                            rewritten_sql,
                            cursor,
                            schema_tables,
                        )
                        fuzzy_reason = fuzzy_outcome.reason_no_fuzzy
                        fuzzy_candidates = fuzzy_outcome.candidates
                        if fuzzy_outcome.used:
                            used_fuzzy = True
                            fuzzy_field = fuzzy_outcome.field
                            fuzzy_strategy = fuzzy_outcome.strategy
                            fuzzy_search_value = fuzzy_outcome.search_value
                            fuzzy_query_hash = fuzzy_outcome.fuzzy_query_hash
                            fuzzy_limit = fuzzy_outcome.limit
                            fuzzy_threshold = fuzzy_outcome.threshold
                            candidate_count = len(fuzzy_candidates or [])
                            if candidate_count == 0:
                                self._emit_event(
                                    "sql_empty_result_after_fuzzy",
                                    status="empty",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    field=fuzzy_field,
                                    strategy=fuzzy_strategy,
                                    search_value=fuzzy_search_value,
                                )
                                self._emit_event(
                                    "sql_tool_completed",
                                    status="empty",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    refresh_reason=refresh_reason,
                                    retry_count=retry_count,
                                    used_fuzzy=True,
                                    fuzzy_field=fuzzy_field,
                                    fuzzy_strategy=fuzzy_strategy,
                                    search_value=fuzzy_search_value,
                                    candidates_returned=0,
                                    reason_no_fuzzy=fuzzy_reason,
                                    base_query_hash=base_query_hash,
                                    fuzzy_query_hash=fuzzy_query_hash,
                                    fuzzy_limit=fuzzy_limit,
                                    fuzzy_threshold=fuzzy_threshold,
                                    alias_rewrites=[
                                        rewrite.__dict__ for rewrite in alias_rewrites
                                    ]
                                    or None,
                                    rows_returned=0,
                                )
                                return "No results found, even after a fuzzy lookup."
                            if candidate_count == 1:
                                rows_returned = 1
                                results = fuzzy_candidates or []
                            else:
                                table_name = (fuzzy_outcome.table or "").lower()
                                table_schema = schema_tables.get(table_name)
                                primary_keys = table_schema.primary_key if table_schema else []
                                candidate_entries: List[Dict[str, Any]] = []
                                for row in (fuzzy_candidates or [])[: self._fuzzy_config.limit]:
                                    candidate_entries.append(
                                        {
                                            "display_value": row.get(fuzzy_field) if fuzzy_field else None,
                                            "primary_keys": {
                                                pk: row.get(pk) for pk in primary_keys
                                            },
                                            "row": row,
                                        }
                                    )
                                disambiguation_payload = {
                                    "type": "disambiguation",
                                    "table": fuzzy_outcome.table,
                                    "field": fuzzy_field,
                                    "limit": fuzzy_limit,
                                    "candidates": candidate_entries,
                                }
                                self._emit_event(
                                    "sql_fuzzy_fallback",
                                    status="disambiguate",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    field=fuzzy_field,
                                    candidate_count=candidate_count,
                                    strategy=fuzzy_strategy,
                                    search_value=fuzzy_search_value,
                                )
                                self._emit_event(
                                    "sql_tool_completed",
                                    status="disambiguate",
                                    schema_version=schema_metadata.get("schema_version"),
                                    schema_hash=schema_metadata.get("schema_hash"),
                                    refresh_reason=refresh_reason,
                                    retry_count=retry_count,
                                    used_fuzzy=True,
                                    fuzzy_field=fuzzy_field,
                                    fuzzy_strategy=fuzzy_strategy,
                                    search_value=fuzzy_search_value,
                                    candidates_returned=candidate_count,
                                    reason_no_fuzzy=fuzzy_reason,
                                    base_query_hash=base_query_hash,
                                    fuzzy_query_hash=fuzzy_query_hash,
                                    fuzzy_limit=fuzzy_limit,
                                    fuzzy_threshold=fuzzy_threshold,
                                    alias_rewrites=[
                                        rewrite.__dict__ for rewrite in alias_rewrites
                                    ]
                                    or None,
                                    rows_returned=0,
                                )
                                return json.dumps(disambiguation_payload, default=str)

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
                        fuzzy_strategy=fuzzy_strategy,
                        search_value=fuzzy_search_value,
                        candidates_returned=len(fuzzy_candidates or []),
                        reason_no_fuzzy=fuzzy_reason,
                        base_query_hash=base_query_hash,
                        fuzzy_query_hash=fuzzy_query_hash,
                        fuzzy_limit=fuzzy_limit,
                        fuzzy_threshold=fuzzy_threshold,
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
                            strategy=fuzzy_strategy,
                            search_value=fuzzy_search_value,
                            candidate_count=len(fuzzy_candidates),
                        )
                    return response
            except AliasRewriteError as exc:
                logger.warning("Alias rewrite error: %s", exc)
                return f"Unable to rewrite SQL aliases safely: {exc}"
            except ValueError as exc:
                logger.warning("SQL validation error: %s", exc)
                if (
                    not validation_retry_performed
                    and self._should_refresh_on_validation_error(exc)
                ):
                    validation_retry_performed = True
                    retry_count += 1
                    refresh_reason = "schema_validation_mismatch"
                    cache = self._schema_introspector.refresh()
                    if user_question:
                        sql_text, schema_metadata = self._generate_sql(user_question)
                    else:
                        schema_metadata = {
                            "schema_version": cache.schema_version,
                            "schema_hash": cache.schema_hash,
                        }
                    self._emit_event(
                        "sql_refresh_on_error",
                        status="refresh",
                        schema_version=schema_metadata.get("schema_version"),
                        schema_hash=schema_metadata.get("schema_hash"),
                        reason=refresh_reason,
                    )
                    continue
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
@dataclass
class FuzzyConfig:
    enabled: bool
    fields: set[str]
    limit: int
    min_length: int
    use_trgm: bool
    trgm_threshold: float
    tokenize: bool


@dataclass
class FieldCondition:
    table: Optional[str]
    column: str
    value: Optional[str]
    alias: Optional[str]


@dataclass
class FuzzyAttempt:
    used: bool
    field: Optional[str] = None
    table: Optional[str] = None
    strategy: Optional[str] = None
    candidates: Optional[List[Dict[str, Any]]] = None
    reason_no_fuzzy: Optional[str] = None
    search_value: Optional[str] = None
    fuzzy_query_hash: Optional[str] = None
    limit: Optional[int] = None
    threshold: Optional[float] = None
