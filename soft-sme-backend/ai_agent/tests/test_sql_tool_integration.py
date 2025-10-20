import json
import os
import re
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ai_agent.schema_introspector import TableSchema
from ai_agent.sql_tool import InventorySQLTool


def _vendor_table_schema():
    return {
        "vendormaster": TableSchema(
            name="vendormaster",
            columns=[
                {"name": "vendor_id", "type": "integer", "nullable": False},
                {"name": "vendor_name", "type": "text", "nullable": False},
            ],
            primary_key=["vendor_id"],
            foreign_keys=[],
        )
    }


class _IntegrationIntrospector:
    def __init__(self, tables):
        self.allowed_tables = set(tables.keys())
        self._tables = tables
        self.schema_version = "v1"
        self.schema_hash = "hash1"

    def get_llm_snippet(self, allowed_subset=None):  # pylint: disable=unused-argument
        return "schema", {
            "schema_version": self.schema_version,
            "schema_hash": self.schema_hash,
        }

    def get_tables(self):
        return self._tables

    def refresh(self):  # pragma: no cover - not used in integration tests
        return SimpleNamespace(tables=self._tables)

    def get_table(self, name):
        return self._tables.get(name)


class _FakeInventoryDB:
    def __init__(self, rows, trgm_enabled=True):
        self.rows = rows
        self.trgm_enabled = trgm_enabled
        self._last_result = []
        self._fetch_index = 0
        self.threshold = 0.0

    def cursor(self, cursor_factory=None):  # pylint: disable=unused-argument
        return _FakeInventoryCursor(self)

    def _handle(self, sql, params):
        text = str(sql)
        normalized = " ".join(text.split())
        self._fetch_index = 0
        if "FROM pg_extension" in normalized:
            self._last_result = [{"exists": 1}] if self.trgm_enabled else []
            return
        if "set_limit" in normalized:
            self.threshold = params[0]
            self._last_result = [(self.threshold,)]
            return
        if "similarity(" in normalized:
            self._last_result = self._trigram_search(params)
            return
        if " ILIKE " in normalized:
            self._last_result = self._ilike_search(params)
            return
        match = re.search(r"vendor_name\s*=\s*'([^']+)'", normalized)
        if match:
            target = match.group(1)
            self._last_result = [row for row in self.rows if row["vendor_name"] == target]
        else:
            self._last_result = []

    def _trigram_search(self, params):
        search = params[0]
        threshold = params[3]
        limit = params[-1]
        results = []
        for row in self.rows:
            score = self._similarity(row["vendor_name"], search)
            if score >= threshold:
                enriched = dict(row)
                enriched["similarity_score"] = score
                results.append(enriched)
        results.sort(key=lambda item: item["similarity_score"], reverse=True)
        return results[:limit]

    def _ilike_search(self, params):
        limit = params[-1]
        tokens = [token.strip("%") for token in params[:-1]]
        matches = []
        for row in self.rows:
            name = row["vendor_name"].lower()
            if all(token.lower() in name for token in tokens):
                matches.append(dict(row))
        matches.sort(key=lambda item: len(item["vendor_name"]))
        return matches[:limit]

    @staticmethod
    def _similarity(left, right):
        from collections import Counter

        def _trigrams(text):
            padded = f"  {text.lower()} "
            return [padded[i : i + 3] for i in range(len(padded) - 2)]

        left_counts = Counter(_trigrams(left))
        right_counts = Counter(_trigrams(right))
        common = sum((left_counts & right_counts).values())
        total = sum(left_counts.values()) + sum(right_counts.values())
        if total == 0:
            return 0.0
        return (2.0 * common) / total

    def fetchall(self):
        return list(self._last_result)

    def fetchone(self):
        if self._fetch_index >= len(self._last_result):
            return None
        row = self._last_result[self._fetch_index]
        self._fetch_index += 1
        return row


class _FakeInventoryCursor:
    def __init__(self, database):
        self._database = database
        self.last_sql = None
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.last_sql = sql
        self.last_params = params
        self._database._handle(sql, params)

    def fetchall(self):
        return self._database.fetchall()

    def fetchone(self):
        return self._database.fetchone()


class InventorySQLToolIntegrationTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(InventorySQLTool, "_initialize", lambda self: setattr(self, "_initialized", True))
        self.addCleanup(patcher.stop)
        patcher.start()
        self.rows = [
            {"vendor_id": 1, "vendor_name": "Parts for Truck Inc."},
            {"vendor_id": 2, "vendor_name": "Parts 4 Trucks Incorporated"},
            {"vendor_id": 3, "vendor_name": "Truck Parts Co"},
        ]

    def _make_tool(self, trgm_enabled=True):
        tables = _vendor_table_schema()
        db = _FakeInventoryDB(self.rows, trgm_enabled=trgm_enabled)
        introspector = _IntegrationIntrospector(tables)
        conn_patch = patch("ai_agent.sql_tool.get_conn", return_value=db)
        introspector_patch = patch("ai_agent.sql_tool.get_schema_introspector", return_value=introspector)
        self.addCleanup(conn_patch.stop)
        self.addCleanup(introspector_patch.stop)
        conn_patch.start()
        introspector_patch.start()
        tool = InventorySQLTool({})
        tool._llm = SimpleNamespace(invoke=lambda prompt: SimpleNamespace(content="SELECT 1"))
        return tool

    def test_trigram_single_match(self):
        with patch.dict(os.environ, {"AI_FUZZY_TRGM_THRESHOLD": "0.6"}, clear=False):
            tool = self._make_tool(trgm_enabled=True)
        with patch.object(tool, "_emit_event", return_value=None):
            result = tool._run(
                "SELECT vendor_id, vendor_name FROM vendormaster WHERE vendor_name = 'Parts for Truck Inc'"
            )
        self.assertTrue(result.startswith("Found"), result)
        self.assertIn("Parts for Truck Inc.", result)
        payload = json.loads(result.split("\n", 1)[1])
        self.assertEqual(payload[0]["vendor_id"], 1)

    def test_partial_name_disambiguation_limit(self):
        with patch.dict(os.environ, {"AI_FUZZY_LIMIT": "2"}, clear=False):
            tool = self._make_tool(trgm_enabled=True)
        with patch.object(tool, "_emit_event", return_value=None):
            raw = tool._run(
                "SELECT vendor_id, vendor_name FROM vendormaster WHERE vendor_name = 'Parts for Truck'"
            )
        payload = json.loads(raw)
        self.assertEqual(payload["type"], "disambiguation")
        self.assertEqual(len(payload["candidates"]), 2)
        ids = [candidate["primary_keys"]["vendor_id"] for candidate in payload["candidates"]]
        expected = [row["vendor_id"] for row in sorted(self.rows, key=lambda item: _FakeInventoryDB._similarity(item["vendor_name"], "Parts for Truck"), reverse=True)[:2]]
        self.assertEqual(ids, expected)

    def test_ilike_fallback_without_trgm(self):
        with patch.dict(os.environ, {"AI_FUZZY_USE_TRGM": "false"}, clear=False):
            tool = self._make_tool(trgm_enabled=False)
        with patch.object(tool, "_emit_event", return_value=None):
            result = tool._run(
                "SELECT vendor_id, vendor_name FROM vendormaster WHERE vendor_name = 'Parts for Truck Inc'"
            )
        self.assertIn("Parts for Truck Inc.", result)
        if result.startswith("{"):
            payload = json.loads(result)
            self.assertEqual(payload["candidates"][0]["primary_keys"]["vendor_id"], 1)
        else:
            payload = json.loads(result.split("\n", 1)[1])
            self.assertEqual(payload[0]["vendor_id"], 1)


if __name__ == "__main__":  # pragma: no cover - manual execution
    unittest.main()
