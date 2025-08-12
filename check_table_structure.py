#!/usr/bin/env python3
"""
Check table structure to understand the correct column names
"""

import psycopg2

def check_table_structure():
    """Check the structure of the customermaster table"""
    print("🔍 Checking customermaster table structure...")
    
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
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'customermaster'
            ORDER BY ordinal_position
        """)
        
        columns = cursor.fetchall()
        
        print("📋 customermaster table structure:")
        print("=" * 50)
        for column_name, data_type, is_nullable in columns:
            nullable = "NULL" if is_nullable == "YES" else "NOT NULL"
            print(f"   {column_name}: {data_type} ({nullable})")
        
        # Get a sample row
        cursor.execute("SELECT * FROM customermaster LIMIT 1")
        sample = cursor.fetchone()
        
        if sample:
            print(f"\n📝 Sample row:")
            print("=" * 30)
            for i, (column_name, data_type, is_nullable) in enumerate(columns):
                value = sample[i] if sample[i] is not None else "NULL"
                print(f"   {column_name}: {value}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error checking table structure: {e}")

if __name__ == "__main__":
    check_table_structure() 