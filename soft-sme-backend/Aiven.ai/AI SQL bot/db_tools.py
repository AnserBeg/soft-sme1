import os
import re
from typing import Any, Dict, List, Optional, Union
from datetime import date, datetime, time
from decimal import Decimal
try:
    from uuid import UUID
except Exception:  # pragma: no cover
    UUID = None  # type: ignore

# Third-party deps expected:
#   pip install -U psycopg[binary] sqlglot
import psycopg
import sqlglot


DB_URL = os.getenv("DATABASE_URL")
DB_SCHEMA = os.getenv("DB_SCHEMA", "public")
ROW_LIMIT = int(os.getenv("ROW_LIMIT", "200"))
STATEMENT_TIMEOUT_MS = int(os.getenv("STATEMENT_TIMEOUT_MS", "8000"))


TABLES_SQL = """
SELECT c.relname AS table_name,
       COALESCE(NULLIF(obj_description(c.oid), ''), '') AS table_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relkind IN ('r','p')
ORDER BY c.relname;
"""

COLS_SQL = """
SELECT c.relname AS table_name,
       a.attnum AS ordinal_position,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS is_nullable,
       pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
       COALESCE(col_description(a.attrelid, a.attnum), '') AS column_comment,
       COALESCE(obj_description(c.oid), '') AS table_comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attribute a
  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = %s AND c.relkind IN ('r','p') AND c.relname = ANY(%s)
ORDER BY c.relname, a.attnum;
"""

PKS_SQL = """
SELECT tc.table_name,
       kcu.column_name,
       tc.constraint_name,
       kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
  AND kcu.table_schema = tc.table_schema
WHERE tc.table_schema = %s AND tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_name = ANY(%s)
ORDER BY tc.table_name, kcu.ordinal_position;
"""

FKS_SQL = """
SELECT tc.table_name AS local_table,
       kcu.column_name AS local_column,
       ccu.table_name AS foreign_table,
       ccu.column_name AS foreign_column,
       tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.table_schema = %s AND tc.constraint_type = 'FOREIGN KEY'
  AND (tc.table_name = ANY(%s) OR ccu.table_name = ANY(%s));
"""


def _connect():
    if not DB_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Please export DATABASE_URL before using DB tools.")
    conn = psycopg.connect(DB_URL)
    with conn.cursor() as cur:
        # Harden session: read-only and timeout
        try:
            cur.execute("SET default_transaction_read_only = on;")
        except Exception:
            pass
        try:
            cur.execute(f"SET statement_timeout = '{STATEMENT_TIMEOUT_MS}ms';")
        except Exception:
            pass
    return conn


def list_tables() -> List[Dict[str, str]]:
    """List base tables for the active schema.

    Returns a list of objects with fields:
    - table_name: str
    - table_comment: str

    Use this first to decide which tables are relevant.
    """
    # Simple in-process cache per schema to reduce RPM
    cache_key = ("list_tables", DB_SCHEMA)
    if hasattr(list_tables, "_cache"):
        cached = list_tables._cache.get(cache_key)  # type: ignore[attr-defined]
        if cached is not None:
            return cached

    with _connect() as conn, conn.cursor() as cur:
        cur.execute(TABLES_SQL, (DB_SCHEMA,))
        result = [
            {"table_name": t, "table_comment": (c or "").strip()} for (t, c) in cur.fetchall()
        ]
    # store cache
    if not hasattr(list_tables, "_cache"):
        list_tables._cache = {}
    list_tables._cache[cache_key] = result  # type: ignore[attr-defined]
    return result


def get_schema_slice(
    tables: Optional[List[str]] = None, keywords: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Return a compact schema JSON slice for selected tables.

    Either provide `tables` explicitly, or pass `keywords` to fuzzy-match
    table names/comments from the inventory returned by list_tables().

    Output structure aligns with the metadata class diagram intent:
    {
      "db_flavor": "postgres",
      "schema": "public",
      "tables": [
        {
          "name": "...",
          "description": "...",
          "columns": [
            {
              "name": "...",
              "data_type": "...",
              "nullable": true,
              "default": "...",
              "description": "...",
              "constraints": [
                {"name": "pk_...", "constraint_type": "PRIMARY_KEY"}
              ]
            }
          ],
          "relationships": [
            {"name": "fk_...", "related_table": "...", "type": "MANY_TO_ONE",
             "details": {"local_key": "...", "remote_key": "..."}}
          ]
        }
      ]
    }
    """
    if (not tables or len(tables) == 0) and keywords:
        inv = list_tables()
        keys = {k.lower() for k in keywords}
        tables = [
            i["table_name"]
            for i in inv
            if keys
            & set(
                re.findall(
                    r"[a-z0-9_]+",
                    (i["table_name"] + " " + (i.get("table_comment") or "")).lower(),
                )
            )
        ]

    if not tables:
        return {"db_flavor": "postgres", "schema": DB_SCHEMA, "tables": []}

    # Cache by explicit tables list; avoid re-calling for same inputs
    cache_key = ("get_schema_slice", DB_SCHEMA, tuple(sorted(tables)))
    if hasattr(get_schema_slice, "_cache"):
        cached = get_schema_slice._cache.get(cache_key)  # type: ignore[attr-defined]
        if cached is not None:
            return cached

    tbl_map: Dict[str, Any] = {}
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(COLS_SQL, (DB_SCHEMA, tables))
        for t, pos, col, dtype, nullable, default, ccomm, tcomm in cur.fetchall():
            tbl = tbl_map.setdefault(
                t,
                {"name": t, "description": (tcomm or "").strip(), "columns": [], "relationships": []},
            )
            if col:
                tbl["columns"].append(
                    {
                        "name": col,
                        "data_type": dtype,
                        "nullable": bool(nullable),
                        "default": default,
                        "description": (ccomm or "").strip(),
                        "constraints": [],
                    }
                )

        # Primary keys -> annotate column constraints
        cur.execute(PKS_SQL, (DB_SCHEMA, tables))
        for table_name, column_name, cname, _pos in cur.fetchall():
            t = tbl_map.get(table_name)
            if not t:
                continue
            for col in t["columns"]:
                if col["name"] == column_name:
                    col["constraints"].append(
                        {"name": cname, "constraint_type": "PRIMARY_KEY"}
                    )

        # Foreign keys -> relationships
        cur.execute(FKS_SQL, (DB_SCHEMA, tables, tables))
        for lt, lc, ft, fc, cname in cur.fetchall():
            if lt in tbl_map:
                tbl_map[lt]["relationships"].append(
                    {
                        "name": cname,
                        "related_table": ft,
                        "type": "MANY_TO_ONE",
                        "details": {"local_key": lc, "remote_key": fc},
                    }
                )

    result = {"db_flavor": "postgres", "schema": DB_SCHEMA, "tables": list(tbl_map.values())}
    if not hasattr(get_schema_slice, "_cache"):
        get_schema_slice._cache = {}
    get_schema_slice._cache[cache_key] = result  # type: ignore[attr-defined]
    return result


BANNED = {
    "insert",
    "update",
    "delete",
    "merge",
    "truncate",
    "alter",
    "drop",
    "create",
    "grant",
    "revoke",
    "copy",
    "call",
    "do",
    "vacuum",
    "analyze",
    "set",
    "show",
    "explain",
    "commit",
    "rollback",
}


_COMMENT_SINGLE = re.compile(r"--.*?$", re.M)
_COMMENT_MULTI = re.compile(r"/\*.*?\*/", re.S)


def _decomment(sql: str) -> str:
    # Remove SQL comments (both -- and /* */) to avoid false positives in scans
    s = _COMMENT_MULTI.sub(" ", sql)
    s = _COMMENT_SINGLE.sub(" ", s)
    return s


def _ensure_safe_select(sql: str) -> None:
    s = sql.strip()
    decommented = _decomment(s)
    lo = decommented.lower()
    if not (lo.startswith("select") or lo.startswith("with")):
        raise ValueError("Only SELECT/WITH allowed.")
    for bad in BANNED:
        if re.search(rf"\b{bad}\b", lo):
            raise ValueError(f"Disallowed token: {bad}")
    try:
        # Ensure exactly one statement by parsing list
        nodes = sqlglot.parse(s, read="postgres")
        if not nodes or len(nodes) != 1:
            raise ValueError("Multiple statements not allowed.")
        node = nodes[0]
    except Exception as e:
        raise ValueError(f"SQL parse error: {e}")
    node_key = str(getattr(node, "key", "")).lower()
    if node_key not in ("select", "with"):
        raise ValueError(f"Only SELECT/WITH permitted (found {node_key}).")


def _ensure_limit(sql: str, default_limit: int = ROW_LIMIT) -> str:
    if re.search(r"\blimit\b", sql, flags=re.I):
        return sql
    return f"{sql.rstrip()}\nLIMIT {default_limit}"


# SDK tool schema supports primitives and lists of primitives. Define Param accordingly.
Param = Union[int, float, bool, str]


def run_select_readonly(sql: str, params: Optional[List[Param]] = None) -> Dict[str, Any]:
    """Execute a single SELECT safely and return a small preview.

    Args:
        sql: Postgres SELECT/WITH statement. One statement only.
        params: Optional positional parameters for the query.

    Returns:
        {"columns": [..], "rows": [[..], ...]}

    Security:
        - Lints/AST-checks the SQL; denies DDL/DML/admin tokens
        - Enforces single-statement and SELECT/WITH only
        - Auto-appends LIMIT if missing
        - Session hardened with read-only + statement_timeout
    """
    _ensure_safe_select(sql)
    sql = _ensure_limit(sql)
    params = params or []

    try:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    except Exception as e:
        # Return structured error so the model can surface it
        return {"error": str(e), "sql": sql}

    # Truncate to ROW_LIMIT for safety.
    rows = rows[:ROW_LIMIT]

    def _to_jsonable(v: Any) -> Any:
        if isinstance(v, (datetime, date, time)):
            # ISO format strings are JSON-safe and readable
            return v.isoformat()
        if isinstance(v, Decimal):
            # Keep precision; let the model parse if needed
            return str(v)
        if UUID is not None and isinstance(v, UUID):  # type: ignore[arg-type]
            return str(v)
        if isinstance(v, (bytes, bytearray, memoryview)):
            return bytes(v).hex()
        if isinstance(v, (set,)):
            return list(v)
        if isinstance(v, list):
            return [_to_jsonable(x) for x in v]
        if isinstance(v, tuple):
            return [_to_jsonable(x) for x in v]
        if isinstance(v, dict):
            return {k: _to_jsonable(val) for k, val in v.items()}
        return v

    json_rows = [[_to_jsonable(v) for v in r] for r in rows]
    return {"columns": cols, "rows": json_rows}
