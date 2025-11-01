from datetime import datetime
import json
import psycopg2
from psycopg2.sql import SQL, Identifier


# comm
class PostgresManager:
    """
    A class to manage postgres connections and queries
    """

    def __init__(self):
        self.conn = None
        self.cur = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.cur:
            self.cur.close()
        if self.conn:
            self.conn.close()

    def connect_with_url(self, url):
        # Enable TCP keepalives to reduce idle disconnects from hosted providers
        # Values are conservative and supported by most platforms.
        self.conn = psycopg2.connect(
            url,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
        )
        self.cur = self.conn.cursor()

    def close(self):
        if self.cur:
            self.cur.close()
        if self.conn:
            self.conn.close()

    def run_sql(self, sql) -> str:
        """
        Run a SQL query against the postgres database
        """
        self.cur.execute(sql)
        columns = [desc[0] for desc in self.cur.description]
        res = self.cur.fetchall()

        list_of_dicts = [dict(zip(columns, row)) for row in res]

        json_result = json.dumps(list_of_dicts, indent=4, default=self.datetime_handler)

        return json_result

    def datetime_handler(self, obj):
        """
        Handle datetime objects when serializing to JSON.
        """
        if isinstance(obj, datetime):
            return obj.isoformat()
        return str(obj)  # or just return the object unchanged, or another default value

    def get_table_definition(self, table_name):
        """
        Generate the 'create' definition for a table
        """

        get_def_stmt = """
        SELECT pg_class.relname as tablename,
               pg_attribute.attnum,
               pg_attribute.attname,
               format_type(atttypid, atttypmod)
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid
        WHERE pg_attribute.attnum > 0
          AND pg_class.relname = %s
          AND pg_namespace.nspname = 'public'
        """
        # Table comment
        table_comment_stmt = """
        SELECT COALESCE(NULLIF(obj_description(pg_class.oid), ''), '')
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_class.relname = %s AND pg_namespace.nspname = 'public'
        """
        # Column comments
        col_comments_stmt = """
        SELECT pg_attribute.attname,
               COALESCE(NULLIF(col_description(pg_attribute.attrelid, pg_attribute.attnum), ''), '')
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid
        WHERE pg_attribute.attnum > 0
          AND pg_class.relname = %s
          AND pg_namespace.nspname = 'public'
        """
        self.cur.execute(get_def_stmt, (table_name,))
        rows = self.cur.fetchall()
        # comments
        self.cur.execute(table_comment_stmt, (table_name,))
        tcomm_row = self.cur.fetchone()
        table_comment = tcomm_row[0] if tcomm_row else ""

        self.cur.execute(col_comments_stmt, (table_name,))
        col_comments = {name: comm for (name, comm) in self.cur.fetchall()}

        header = f"-- Table: {table_name}\n"
        if table_comment:
            header += f"-- Comment: {table_comment}\n"
        create_table_stmt = header + "CREATE TABLE {} (\n".format(table_name)
        for row in rows:
            col_name = row[2]
            dtype = row[3]
            ccomm = col_comments.get(col_name, "")
            if ccomm:
                create_table_stmt += f"    -- {ccomm}\n"
            create_table_stmt += f"    {col_name} {dtype},\n"
        create_table_stmt = create_table_stmt.rstrip(",\n") + "\n);"
        return create_table_stmt

    def get_all_table_names(self):
        """
        Get all table names in the database
        """
        get_all_tables_stmt = (
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
        )
        self.cur.execute(get_all_tables_stmt)
        return [row[0] for row in self.cur.fetchall()]

    def get_table_definitions_for_prompt(self):
        """
        Get all table 'create' definitions in the database
        """
        table_names = self.get_all_table_names()
        definitions = []
        for table_name in table_names:
            definitions.append(self.get_table_definition(table_name))
        return "\n\n".join(definitions)

    def get_table_inventory_for_prompt(self, schema: str = 'public') -> str:
        """
        Returns a compact inventory string of tables and their one-line comments
        for the given schema, suitable to prepend to LLM prompts.
        """
        stmt = (
            """
            SELECT c.relname AS table_name,
                   COALESCE(NULLIF(obj_description(c.oid), ''), '') AS table_comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s AND c.relkind IN ('r','p')
            ORDER BY c.relname;
            """
        )
        self.cur.execute(stmt, (schema,))
        rows = self.cur.fetchall()
        lines = [
            f"- {name} — {comment}" if (comment and comment.strip()) else f"- {name}"
            for (name, comment) in rows
        ]
        return "\n".join(lines)

    def get_all_columns_inventory_for_prompt(self, schema: str = 'public') -> str:
        """
        Returns a formatted string of all tables with their columns, types, and
        column comments for the given schema. Suitable to include in prompts.
        """
        cols_sql = (
            """
            SELECT c.relname AS table_name,
                   a.attnum   AS ordinal_position,
                   a.attname  AS column_name,
                   format_type(a.atttypid, a.atttypmod) AS data_type,
                   COALESCE(NULLIF(col_description(a.attrelid,a.attnum), ''), '') AS column_comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname = %s AND c.relkind IN ('r','p')
            ORDER BY c.relname, a.attnum;
            """
        )
        self.cur.execute(cols_sql, (schema,))
        rows = self.cur.fetchall()
        out_lines = []
        cur_table = None
        for table_name, _pos, col, dtype, ccomm in rows:
            if table_name != cur_table:
                if cur_table is not None:
                    out_lines.append("")
                out_lines.append(f"{table_name}")
                cur_table = table_name
            if ccomm and ccomm.strip():
                out_lines.append(f"- {col} ({dtype}) — {ccomm}")
            else:
                out_lines.append(f"- {col} ({dtype})")
        return "\n".join(out_lines)

    def get_table_definition_map_for_embeddings(self):
        """
        Creates a map of table names to table definitions
        """
        table_names = self.get_all_table_names()
        definitions = {}
        for table_name in table_names:
            definitions[table_name] = self.get_table_definition(table_name)
        return definitions

    def get_related_tables(self, table_list, n=2):
        """
        Get tables that have foreign keys referencing the given table
        """

        related_tables_dict = {}

        for table in table_list:
            # Query to fetch tables that have foreign keys referencing the given table
            self.cur.execute(
                """
                SELECT 
                    a.relname AS table_name
                FROM 
                    pg_constraint con 
                    JOIN pg_class a ON a.oid = con.conrelid 
                WHERE 
                    confrelid = (SELECT oid FROM pg_class WHERE relname = %s)
                LIMIT %s;
                """,
                (table, n),
            )

            related_tables = [row[0] for row in self.cur.fetchall()]

            # Query to fetch tables that the given table references
            self.cur.execute(
                """
                SELECT 
                    a.relname AS referenced_table_name
                FROM 
                    pg_constraint con 
                    JOIN pg_class a ON a.oid = con.confrelid 
                WHERE 
                    conrelid = (SELECT oid FROM pg_class WHERE relname = %s)
                LIMIT %s;
                """,
                (table, n),
            )

            related_tables += [row[0] for row in self.cur.fetchall()]

            related_tables_dict[table] = related_tables

        # convert dict to list and remove dups
        related_tables_list = []
        for table, related_tables in related_tables_dict.items():
            related_tables_list += related_tables

        related_tables_list = list(set(related_tables_list))

        return related_tables_list

    def roll_back(self):
        self.conn.rollback()
