#!/usr/bin/env python3
"""
Inventory SQL Tool
=================

SQL tool for querying Aiven database for live inventory and order data.
Includes natural language to SQL conversion and safety validation.
"""

import os
import logging
import re
from typing import Dict, Any, List, Optional
from langchain.tools import BaseTool
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate
from psycopg2.extras import RealDictCursor
import asyncio

from .db import get_conn

logger = logging.getLogger(__name__)

class InventorySQLTool(BaseTool):
    """SQL tool for Aiven inventory queries"""
    
    name: str = "inventory_query"
    description: str = "Query live inventory and order data from the Aiven database"
    db_config: Dict[str, Any] = {}
    llm: Any = None
    safe_tables: set = set()
    initialized: bool = False
    
    def __init__(self, db_config: Dict[str, Any]):
        super().__init__()
        self.db_config = db_config
        self.llm = None
        self.safe_tables = {
            'inventory', 'customermaster', 'vendormaster', 'products',
            'salesorderhistory', 'salesorderlineitems', 'purchasehistory',
            'purchaselineitems', 'quotes', 'time_entries', 'profiles',
            'business_profile', 'global_settings', 'labourrate',
            'qbo_account_mapping', 'qbo_connection', 'sessions',
            'attendance_shifts', 'overhead_expense_distribution',
            'aggregated_parts_to_order', 'sales_order_parts_to_order'
        }
        self.initialized = False
        
        # Initialize the tool
        self._initialize()
    
    def _initialize(self):
        """Initialize the SQL tool"""
        try:
            # Initialize LLM for SQL generation (using Gemini)
            from langchain_google_genai import ChatGoogleGenerativeAI
            
            gemini_api_key = os.getenv("GEMINI_API_KEY")
            if not gemini_api_key:
                raise Exception("GEMINI_API_KEY environment variable is required")
            
            self.llm = ChatGoogleGenerativeAI(
                model=os.getenv("AI_MODEL", "gemini-2.5-flash"),
                temperature=0,
                google_api_key=gemini_api_key
            )
            
            self.initialized = True
            logger.info("Inventory SQL Tool initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize SQL Tool: {e}")
            raise
    
    def _validate_sql(self, sql: str) -> bool:
        """Validate SQL query for safety"""
        sql_upper = sql.upper()
        
        # Check for dangerous operations
        dangerous_keywords = ['DELETE', 'DROP', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE']
        for keyword in dangerous_keywords:
            if keyword in sql_upper:
                logger.warning(f"Dangerous SQL keyword detected: {keyword}")
                return False
        
        # Check for table access
        table_found = False
        for table in self.safe_tables:
            if table.upper() in sql_upper:
                table_found = True
                break
        
        if not table_found:
            logger.warning("No safe tables found in SQL query")
            return False
        
        # Check for basic SELECT structure
        if not sql_upper.startswith('SELECT'):
            logger.warning("Query must start with SELECT")
            return False
        
        return True
    
    def _get_schema_info(self) -> str:
        """Get database schema information for SQL generation"""
        return """
Available tables and their key columns:

INVENTORY:
- part_number (VARCHAR)
- part_description (TEXT)
- quantity_on_hand (VARCHAR)
- unit (VARCHAR)
- last_unit_cost (DECIMAL)
- part_type (VARCHAR)

CUSTOMERMASTER:
- customer_id (INTEGER)
- customer_name (VARCHAR)
- contact_person (VARCHAR)
- email (VARCHAR)
- phone (VARCHAR)
- address (TEXT)
- postal_code (VARCHAR)

VENDORMASTER:
- vendor_id (INTEGER)
- vendor_name (VARCHAR)
- contact_person (VARCHAR)
- email (VARCHAR)
- phone (VARCHAR)
- address (TEXT)
- postal_code (VARCHAR)

SALESORDERHISTORY:
- sales_order_id (INTEGER)
- customer_id (INTEGER)
- sales_date (DATE)
- status (VARCHAR)
- total_amount (DECIMAL)
- sequence_number (INTEGER)

SALESORDERLINEITEMS:
- line_item_id (INTEGER)
- sales_order_id (INTEGER)
- part_number (VARCHAR)
- quantity (INTEGER)
- unit_price (DECIMAL)
- total_price (DECIMAL)

PURCHASEHISTORY:
- purchase_id (INTEGER)
- vendor_id (INTEGER)
- purchase_date (DATE)
- status (VARCHAR)
- total_amount (DECIMAL)

PURCHASELINEITEMS:
- line_item_id (INTEGER)
- purchase_id (INTEGER)
- part_number (VARCHAR)
- quantity (INTEGER)
- unit_cost (DECIMAL)
- total_cost (DECIMAL)

QUOTES:
- quote_id (INTEGER)
- customer_id (INTEGER)
- quote_date (DATE)
- status (VARCHAR)
- total_amount (DECIMAL)
- sequence_number (INTEGER)

TIME_ENTRIES:
- entry_id (INTEGER)
- user_id (INTEGER)
- clock_in (TIMESTAMP)
- clock_out (TIMESTAMP)
- sales_order_id (INTEGER)
- description (TEXT)

PROFILES:
- profile_id (INTEGER)
- user_id (INTEGER)
- name (VARCHAR)
- email (VARCHAR)
- role (VARCHAR)

BUSINESS_PROFILE:
- profile_id (INTEGER)
- business_name (VARCHAR)
- address (TEXT)
- phone (VARCHAR)
- email (VARCHAR)
- website (VARCHAR)

GLOBAL_SETTINGS:
- setting_id (INTEGER)
- setting_name (VARCHAR)
- setting_value (TEXT)
- overhead_rate (DECIMAL)

LABOURRATE:
- rate_id (INTEGER)
- rate_name (VARCHAR)
- hourly_rate (DECIMAL)
- description (TEXT)

Only use SELECT statements. Do not modify data.
"""
    
    def _generate_sql(self, question: str) -> str:
        """Generate SQL from natural language"""
        try:
            if not self.llm:
                raise Exception("LLM not initialized")
            
            prompt_template = PromptTemplate(
                input_variables=["question", "schema_info"],
                template="""
You are a SQL expert for the Aiven inventory management system. 
Generate a safe, read-only SQL query based on the user's question.

Available tables and their key columns:
{schema_info}

User question: {question}

Generate a SELECT query that answers this question. Only use SELECT statements.
Return only the SQL query, nothing else.

Examples:
- "How many units of part ABC are available?" → SELECT part_number, quantity_on_hand FROM inventory WHERE part_number = 'ABC'
- "Show me recent sales orders" → SELECT * FROM salesorderhistory ORDER BY sales_date DESC LIMIT 10
- "What's my current inventory value?" → SELECT SUM(quantity_on_hand::numeric * last_unit_cost) as total_value FROM inventory WHERE quantity_on_hand != '0'
"""
            )
            
            prompt = prompt_template.format(
                question=question,
                schema_info=self._get_schema_info()
            )
            
            sql = self.llm.invoke(prompt).content
            
            # Clean up the response
            sql = sql.strip()
            if sql.startswith("```sql"):
                sql = sql[6:]
            if sql.endswith("```"):
                sql = sql[:-3]
            
            return sql.strip()
            
        except Exception as e:
            logger.error(f"SQL generation error: {e}")
            raise
    
    def _run(self, query: str) -> str:
        """Execute SQL query safely"""
        try:
            if not self.initialized:
                return "SQL Tool not initialized"
            
            # Generate SQL from natural language if it doesn't look like SQL
            if not query.strip().upper().startswith('SELECT'):
                sql_query = self._generate_sql(query)
            else:
                sql_query = query
            
            # Validate SQL
            if not self._validate_sql(sql_query):
                return "Error: Query contains unsafe operations or accesses unauthorized tables."
            
            conn = get_conn()
            if conn is None:
                logger.error("SQL Tool cannot access the database: connection unavailable")
                return "Database error: connection unavailable"
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Execute query
            cursor.execute(sql_query)
            results = cursor.fetchall()

            # Format results
            if not results:
                return "No data found for this query."

            # Convert to readable format
            formatted_results = []
            for row in results[:20]:  # Limit to 20 rows
                formatted_results.append(dict(row))

            cursor.close()

            # Format the response
            if len(results) > 20:
                return f"Found {len(results)} results (showing first 20):\n{formatted_results}"
            else:
                return f"Found {len(results)} results:\n{formatted_results}"

        except Exception as e:
            logger.error(f"SQL execution error: {e}")
            return f"Database error: {str(e)}"
    
    async def _arun(self, query: str) -> str:
        """Execute SQL query (asynchronous version)"""
        # Run the synchronous version in a thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run, query)
    
    def test_connection(self) -> bool:
        """Test database connection"""
        try:
            conn = get_conn()
            if conn is None:
                return False
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            return True
        except Exception as e:
            logger.error(f"Database connection test failed: {e}")
            return False

    def get_table_info(self, table_name: str) -> List[Dict[str, Any]]:
        """Get information about a specific table"""
        try:
            if table_name.lower() not in self.safe_tables:
                return []
            
            conn = get_conn()
            if conn is None:
                logger.error("Table info request failed: database connection unavailable")
                return []
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Get column information
            cursor.execute("""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = %s
                ORDER BY ordinal_position
            """, (table_name,))
            
            columns = cursor.fetchall()
            
            cursor.close()

            return [dict(col) for col in columns]

        except Exception as e:
            logger.error(f"Error getting table info for {table_name}: {e}")
            return []
    
    def get_sample_data(self, table_name: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Get sample data from a table"""
        try:
            if table_name.lower() not in self.safe_tables:
                return []
            
            conn = get_conn()
            if conn is None:
                logger.error("Sample data request failed: database connection unavailable")
                return []
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Get sample data
            cursor.execute(f"SELECT * FROM {table_name} LIMIT %s", (limit,))
            results = cursor.fetchall()
            
            cursor.close()

            return [dict(row) for row in results]
            
        except Exception as e:
            logger.error(f"Error getting sample data for {table_name}: {e}")
            return [] 