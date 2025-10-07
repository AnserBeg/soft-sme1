#!/usr/bin/env python3
"""
Comprehensive table structure checker for NeuraTask database
Examines migration scripts and queries actual database structure
"""

import psycopg2
import os
import re
from pathlib import Path

def get_tables_from_migrations():
    """Extract table names from migration scripts"""
    print("🔍 Analyzing migration scripts...")
    
    migration_dir = Path("soft-sme-backend/migrations")
    tables_found = set()
    
    if not migration_dir.exists():
        print("❌ Migration directory not found")
        return tables_found
    
    # Look for CREATE TABLE statements in migration files
    for migration_file in migration_dir.glob("*.sql"):
        try:
            with open(migration_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Find CREATE TABLE statements
            create_table_matches = re.findall(r'CREATE TABLE\s+(\w+)', content, re.IGNORECASE)
            for table_name in create_table_matches:
                tables_found.add(table_name)
                
            # Also look for table references in other statements
            table_refs = re.findall(r'FROM\s+(\w+)', content, re.IGNORECASE)
            table_refs.extend(re.findall(r'JOIN\s+(\w+)', content, re.IGNORECASE))
            table_refs.extend(re.findall(r'UPDATE\s+(\w+)', content, re.IGNORECASE))
            table_refs.extend(re.findall(r'INSERT INTO\s+(\w+)', content, re.IGNORECASE))
            
            for table_name in table_refs:
                if table_name not in ['SELECT', 'WHERE', 'AND', 'OR', 'ORDER', 'GROUP', 'HAVING', 'LIMIT']:
                    tables_found.add(table_name)
                    
        except Exception as e:
            print(f"⚠️  Error reading {migration_file}: {e}")
    
    return tables_found

def get_actual_tables_from_db():
    """Get actual tables from database"""
    print("🔍 Querying actual database tables...")
    
    try:
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database='soft_sme_db',
            user='ai_assistant',
            password='ai_secure_password_2024'
        )
        
        cursor = conn.cursor()
        
        # Get all tables in public schema
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        
        tables = [row[0] for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        
        return tables
        
    except Exception as e:
        print(f"❌ Error querying database: {e}")
        return []

def get_table_structure(table_name):
    """Get detailed structure of a specific table"""
    try:
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database='soft_sme_db',
            user='ai_assistant',
            password='ai_secure_password_2024'
        )
        
        cursor = conn.cursor()
        
        # Get column information
        cursor.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = %s AND table_schema = 'public'
            ORDER BY ordinal_position
        """, (table_name,))
        
        columns = cursor.fetchall()
        
        # Get row count
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        row_count = cursor.fetchone()[0]
        
        # Get sample data
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 1")
        sample = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return {
            'columns': columns,
            'row_count': row_count,
            'sample': sample
        }
        
    except Exception as e:
        return {
            'error': str(e),
            'columns': [],
            'row_count': 0,
            'sample': None
        }

def analyze_table(table_name, table_info):
    """Analyze and display table information"""
    print(f"\n📋 Table: {table_name}")
    print("=" * 60)
    
    if 'error' in table_info:
        print(f"❌ Error: {table_info['error']}")
        return
    
    print(f"📊 Row count: {table_info['row_count']}")
    print(f"📋 Columns ({len(table_info['columns'])}):")
    
    for column_name, data_type, is_nullable, column_default in table_info['columns']:
        nullable = "NULL" if is_nullable == "YES" else "NOT NULL"
        default = f" DEFAULT {column_default}" if column_default else ""
        print(f"   {column_name}: {data_type} ({nullable}){default}")
    
    if table_info['sample']:
        print(f"\n📝 Sample row:")
        print("-" * 30)
        for i, (column_name, data_type, is_nullable, column_default) in enumerate(table_info['columns']):
            value = table_info['sample'][i] if table_info['sample'][i] is not None else "NULL"
            print(f"   {column_name}: {value}")

def main():
    """Main analysis function"""
    print("🚀 NeuraTask Database Structure Analysis")
    print("=" * 60)
    
    # Get tables from migrations
    migration_tables = get_tables_from_migrations()
    print(f"📁 Found {len(migration_tables)} tables in migration scripts:")
    for table in sorted(migration_tables):
        print(f"   - {table}")
    
    # Get actual tables from database
    actual_tables = get_actual_tables_from_db()
    print(f"\n🗄️  Found {len(actual_tables)} tables in database:")
    for table in sorted(actual_tables):
        print(f"   - {table}")
    
    # Find differences
    migration_only = migration_tables - set(actual_tables)
    actual_only = set(actual_tables) - migration_tables
    
    if migration_only:
        print(f"\n⚠️  Tables in migrations but not in database ({len(migration_only)}):")
        for table in sorted(migration_only):
            print(f"   - {table}")
    
    if actual_only:
        print(f"\n⚠️  Tables in database but not in migrations ({len(actual_only)}):")
        for table in sorted(actual_only):
            print(f"   - {table}")
    
    # Analyze each table structure
    print(f"\n🔍 Analyzing table structures...")
    
    all_tables = sorted(set(actual_tables) | migration_tables)
    
    for table_name in all_tables:
        if table_name in actual_tables:
            table_info = get_table_structure(table_name)
            analyze_table(table_name, table_info)
        else:
            print(f"\n📋 Table: {table_name}")
            print("=" * 60)
            print("❌ Table not found in database")
    
    print(f"\n🎉 Analysis completed!")
    print(f"📊 Summary:")
    print(f"   - Migration tables: {len(migration_tables)}")
    print(f"   - Database tables: {len(actual_tables)}")
    print(f"   - Total unique tables: {len(all_tables)}")

if __name__ == "__main__":
    main() 