#!/usr/bin/env python3
"""
Script to check available databases in PostgreSQL
"""

import psycopg2

def check_databases(password="123"):
    """Check what databases exist"""
    print("🔍 Checking available databases...")
    
    try:
        # Connect to default postgres database
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database='postgres',  # Connect to default database
            user='postgres',
            password=password
        )
        
        cursor = conn.cursor()
        
        # List all databases
        cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false")
        databases = cursor.fetchall()
        
        print(f"✅ Found {len(databases)} databases:")
        for db in databases:
            print(f"   - {db[0]}")
        
        # Check if any look like Aiven
        soft_sme_candidates = []
        for db in databases:
            db_name = db[0].lower()
            if 'soft' in db_name or 'sme' in db_name or 'business' in db_name:
                soft_sme_candidates.append(db[0])
        
        if soft_sme_candidates:
            print(f"\n🎯 Potential Aiven databases:")
            for candidate in soft_sme_candidates:
                print(f"   - {candidate}")
        
        cursor.close()
        conn.close()
        
        return [db[0] for db in databases]
        
    except Exception as e:
        print(f"❌ Error connecting to PostgreSQL: {e}")
        return []

def test_database_connection(database_name, password="123"):
    """Test connection to a specific database"""
    print(f"\n🔍 Testing connection to '{database_name}'...")
    
    try:
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database=database_name,
            user='postgres',
            password=password
        )
        
        cursor = conn.cursor()
        
        # Check if customermaster table exists
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('customermaster', 'vendormaster', 'inventory', 'products')
        """)
        
        tables = cursor.fetchall()
        
        if tables:
            print(f"✅ Connected to '{database_name}' successfully!")
            print(f"📊 Found {len(tables)} business tables:")
            for table in tables:
                print(f"   - {table[0]}")
            
            # Check customer count
            if ('customermaster',) in tables:
                cursor.execute("SELECT COUNT(*) FROM customermaster")
                count = cursor.fetchone()[0]
                print(f"   📈 Total customers: {count}")
            
            cursor.close()
            conn.close()
            return True
        else:
            print(f"❌ No business tables found in '{database_name}'")
            cursor.close()
            conn.close()
            return False
            
    except Exception as e:
        print(f"❌ Error connecting to '{database_name}': {e}")
        return False

if __name__ == "__main__":
    print("🚀 PostgreSQL Database Checker")
    print("=" * 40)
    
    password = "123"  # Your database password
    
    # Check available databases
    databases = check_databases(password)
    
    if databases:
        print(f"\n🔍 Testing each database for Aiven tables...")
        
        found_soft_sme = False
        for db in databases:
            if test_database_connection(db, password):
                found_soft_sme = True
                print(f"\n🎉 Found Aiven database: '{db}'")
                print(f"You can now run: python setup_database_access.py 123 --database {db}")
                break
        
        if not found_soft_sme:
            print("\n❌ No database with Aiven tables found")
            print("Please ensure your Aiven application is properly installed")
    else:
        print("\n❌ No databases found or connection failed") 