import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import psycopg2

from ai_agent.schema_introspector import TableSchema
from ai_agent.sql_tool import InventorySQLTool


class _StubCursor:
    def __init__(self, script):
        self._script = script
        self._rows = []
        self.last_sql = None
        self.calls = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.calls += 1
        self.last_sql = sql
        result = self._script(sql, params, self.calls)
        if isinstance(result, Exception):
            raise result
        self._rows = result

    def fetchall(self):
        return list(self._rows)


class _StubConnection:
    def __init__(self, script):
        self._script = script
        self.cursors = []

    def cursor(self, cursor_factory=None):  # pylint: disable=unused-argument
        cursor = _StubCursor(self._script)
        self.cursors.append(cursor)
        return cursor


class _StubIntrospector:
    def __init__(self, tables, snippet="Table"):  # tables: Dict[str, TableSchema]
        self.allowed_tables = set(tables.keys())
        self._tables = tables
        self._snippet = snippet
        self.schema_version = "v1"
        self.schema_hash = "hash1"
        self.refresh_count = 0

    def get_llm_snippet(self, allowed_subset=None):
        return self._snippet, {
            "schema_version": self.schema_version,
            "schema_hash": self.schema_hash,
        }

    def get_tables(self):
        return self._tables

    def refresh(self):
        self.refresh_count += 1
        return SimpleNamespace(
            schema_version=self.schema_version,
            schema_hash=self.schema_hash,
            tables=self._tables,
            llm_snippet=self._snippet,
        )

    def get_table(self, name):
        return self._tables.get(name)


def _table_schema():
    return {
        "vendormaster": TableSchema(
            name="vendormaster",
            columns=[
                {"name": "vendor_id", "type": "integer", "nullable": False},
                {"name": "vendor_name", "type": "character varying(120)", "nullable": False},
                {"name": "street_address", "type": "text", "nullable": True},
                {"name": "city", "type": "text", "nullable": True},
                {"name": "province", "type": "text", "nullable": True},
                {"name": "postal_code", "type": "text", "nullable": True},
            ],
            primary_key=["vendor_id"],
            foreign_keys=[],
        )
    }


def _fake_initialize(self):
    self._initialized = True
    self._llm = None


class InventorySQLToolTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(InventorySQLTool, "_initialize", _fake_initialize)
        self.addCleanup(patcher.stop)
        patcher.start()

    def _make_tool(self, connection_script, introspector=None):
        schema = introspector or _StubIntrospector(_table_schema())
        get_conn_patch = patch("ai_agent.sql_tool.get_conn", return_value=_StubConnection(connection_script))
        introspector_patch = patch("ai_agent.sql_tool.get_schema_introspector", return_value=schema)
        self.addCleanup(get_conn_patch.stop)
        self.addCleanup(introspector_patch.stop)
        get_conn_patch.start()
        introspector_patch.start()
        tool = InventorySQLTool({})
        tool._llm = SimpleNamespace(invoke=lambda prompt: SimpleNamespace(content="SELECT 1"))
        return tool, schema

    def test_exact_match_vendor_returns_row(self):
        def script(sql, _params, _call):
            return [
                {"vendor_id": 10, "vendor_name": "Parts for Truck Inc"},
            ]

        tool, _ = self._make_tool(script)
        result = tool._run("SELECT vendor_id, vendor_name FROM vendormaster WHERE vendor_name = 'Parts for Truck Inc'")
        self.assertIn("Parts for Truck Inc", result)
        self.assertIn("Found 1 results", result)

    def test_near_match_triggers_disambiguation(self):
        def script(sql, _params, call):
            if call == 1:
                return []
            raise AssertionError("Fallback should not execute real query when patched")

        tool, _ = self._make_tool(script)

        with patch.object(tool, "_emit_event", return_value=None), patch.object(
            tool,
            "_maybe_apply_fuzzy_fallback",
            return_value=(
                "vendor_name",
                [
                    {"vendor_id": 1, "vendor_name": "Parts for Truck Inc"},
                    {"vendor_id": 2, "vendor_name": "Parts 4 Trucks"},
                ],
                "vendormaster",
            ),
        ):
            result = tool._run(
                "SELECT vendor_id, vendor_name FROM vendormaster WHERE vendor_name = 'Parts for Trucks'"
            )

        self.assertIn("multiple possible matches", result)
        self.assertIn("Parts 4 Trucks", result)

    def test_refresh_on_error_retries_once(self):
        attempts = {"count": 0}

        def script(sql, _params, _call):
            attempts["count"] += 1
            if attempts["count"] == 1:
                return psycopg2.ProgrammingError('column "vendor_code" does not exist')
            return [{"vendor_id": 99, "vendor_name": "Retry Vendor"}]

        tool, stub_introspector = self._make_tool(script)
        tool._llm = SimpleNamespace(
            invoke=lambda prompt: SimpleNamespace(content="SELECT vendor_id, vendor_name FROM vendormaster")
        )

        with patch.object(tool, "_emit_event", return_value=None):
            result = tool._run("Show me vendor info")

        self.assertIn("Retry Vendor", result)
        self.assertEqual(attempts["count"], 2)
        self.assertEqual(stub_introspector.refresh_count, 1)

    def test_alias_rewrite_expands_address(self):
        captured_sql = {"value": None}

        def script(sql, _params, _call):
            captured_sql["value"] = sql
            return [
                {
                    "vendor_id": 5,
                    "street_address": "123 Main",
                    "city": "Waterloo",
                    "province": "ON",
                    "postal_code": "N2L",
                }
            ]

        tool, _ = self._make_tool(script)
        with patch.object(tool, "_emit_event", return_value=None), patch.object(
            tool,
            "_maybe_apply_fuzzy_fallback",
            return_value=(None, None, None),
        ):
            result = tool._run("SELECT address FROM vendormaster WHERE address ILIKE '%Main%'")

        executed_sql = captured_sql["value"]
        self.assertIsInstance(executed_sql, str)
        self.assertIn("street_address", executed_sql)
        self.assertIn("province", executed_sql)
        payload = json.loads(result.split("\n", 1)[1])
        self.assertEqual(payload[0]["street_address"], "123 Main")

    def test_rejects_non_read_only_queries(self):
        tool, _ = self._make_tool(lambda *_: [])
        result = tool._run("UPDATE vendormaster SET vendor_name='Hack'")
        self.assertIn("Dangerous SQL keyword", result)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
