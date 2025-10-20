import unittest
from unittest.mock import patch

from ai_agent.schema_introspector import SchemaIntrospector, TableSchema


class _FakeCursor:
    def __init__(self, rows_by_query):
        self._rows_by_query = rows_by_query
        self._current_rows = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        key = None
        normalized = " ".join(query.split())
        if "information_schema.columns" in normalized:
            key = "columns"
        elif "PRIMARY KEY" in normalized:
            key = "primary"
        elif "FOREIGN KEY" in normalized:
            key = "foreign"
        self._current_rows = self._rows_by_query.get(key, [])

    def fetchall(self):
        return list(self._current_rows)


class _FakeConnection:
    def __init__(self, rows_by_query):
        self.rows_by_query = rows_by_query

    def cursor(self, cursor_factory=None):  # pylint: disable=unused-argument
        return _FakeCursor(self.rows_by_query)


class SchemaIntrospectorTests(unittest.TestCase):
    def setUp(self):
        self.rows_by_query = {
            "columns": [
                {
                    "table_name": "vendormaster",
                    "column_name": "vendor_id",
                    "data_type": "integer",
                    "is_nullable": "NO",
                    "character_maximum_length": None,
                    "numeric_precision": 32,
                    "numeric_scale": 0,
                },
                {
                    "table_name": "vendormaster",
                    "column_name": "vendor_name",
                    "data_type": "character varying",
                    "is_nullable": "NO",
                    "character_maximum_length": 120,
                    "numeric_precision": None,
                    "numeric_scale": None,
                },
                {
                    "table_name": "vendormaster",
                    "column_name": "email",
                    "data_type": "character varying",
                    "is_nullable": "YES",
                    "character_maximum_length": 255,
                    "numeric_precision": None,
                    "numeric_scale": None,
                },
            ],
            "primary": [
                {"table_name": "vendormaster", "column_name": "vendor_id"},
            ],
            "foreign": [
                {
                    "table_name": "vendormaster",
                    "column_name": "company_id",
                    "foreign_table_name": "customermaster",
                    "foreign_column_name": "customer_id",
                }
            ],
        }
        self.fake_connection = _FakeConnection(self.rows_by_query)

    def test_refresh_builds_cache_and_hash(self):
        with patch("ai_agent.schema_introspector.get_conn", return_value=self.fake_connection):
            introspector = SchemaIntrospector(
                allowed_tables=["vendormaster", "customermaster"],
                deny_columns=["email"],
                ttl_minutes=1,
            )
            cache = introspector.refresh()

        self.assertIn("vendormaster", cache.tables)
        table: TableSchema = cache.tables["vendormaster"]
        column_names = [column["name"] for column in table.columns]
        self.assertEqual(column_names, ["vendor_id", "vendor_name"])
        self.assertEqual(table.primary_key, ["vendor_id"])
        self.assertEqual(len(table.foreign_keys), 1)
        self.assertTrue(cache.schema_hash)
        self.assertTrue(cache.schema_version)

    def test_schema_hash_stable_across_refresh(self):
        with patch("ai_agent.schema_introspector.get_conn", return_value=self.fake_connection):
            introspector = SchemaIntrospector(allowed_tables=["vendormaster"], ttl_minutes=1)
            first = introspector.refresh().schema_hash
            second = introspector.refresh().schema_hash

        self.assertEqual(first, second)

    def test_deny_columns_not_in_snippet(self):
        with patch("ai_agent.schema_introspector.get_conn", return_value=self.fake_connection):
            introspector = SchemaIntrospector(
                allowed_tables=["vendormaster"],
                deny_columns=["email"],
                ttl_minutes=1,
            )
            snippet, _ = introspector.get_llm_snippet()

        self.assertNotIn("email", snippet)
        self.assertIn("vendor_name", snippet)


if __name__ == "__main__":  # pragma: no cover - manual execution
    unittest.main()
