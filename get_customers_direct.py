#!/usr/bin/env python3
"""
Direct customer data fetcher - simple and reliable
"""

import psycopg2
import pandas as pd

def get_customer_list():
    """Fetch and display customer list directly"""
    print("🔍 Fetching customer list from Aiven database...")
    
    try:
        # Connect directly to database
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database='soft_sme_db',
            user='ai_assistant',
            password='ai_secure_password_2024'
        )
        
        print("✅ Connected to database successfully")
        
        # Get customer data with correct column names
        query = """
        SELECT customer_id, customer_name, contact_person, email, telephone_number,
               street_address, city, province, country, postal_code, website,
               created_at, updated_at
        FROM customermaster 
        ORDER BY customer_name
        """
        
        customers = pd.read_sql_query(query, conn)
        
        if customers.empty:
            print("❌ No customers found")
            return
        
        print(f"\n✅ Found {len(customers)} customers:")
        print("=" * 80)
        
        # Display customer information
        for index, customer in customers.iterrows():
            print(f"\n{index + 1}. {customer['customer_name']}")
            print(f"   ID: {customer['customer_id']}")
            print(f"   Contact: {customer['contact_person'] if pd.notna(customer['contact_person']) else 'N/A'}")
            print(f"   Email: {customer['email'] if pd.notna(customer['email']) else 'N/A'}")
            print(f"   Phone: {customer['telephone_number'] if pd.notna(customer['telephone_number']) else 'N/A'}")
            print(f"   Address: {customer['street_address'] if pd.notna(customer['street_address']) else 'N/A'}, {customer['city'] if pd.notna(customer['city']) else 'N/A'}, {customer['province'] if pd.notna(customer['province']) else 'N/A'}")
            print(f"   Country: {customer['country'] if pd.notna(customer['country']) else 'N/A'}")
            print(f"   Postal Code: {customer['postal_code'] if pd.notna(customer['postal_code']) else 'N/A'}")
            if customer['website'] and pd.notna(customer['website']):
                print(f"   Website: {customer['website']}")
            print("-" * 40)
        
        # Show summary statistics
        print(f"\n📊 Customer Summary:")
        print(f"   Total customers: {len(customers)}")
        
        # Count by province
        if 'province' in customers.columns:
            province_counts = customers['province'].value_counts()
            print(f"   By province:")
            for province, count in province_counts.items():
                if pd.notna(province) and province:
                    print(f"     {province}: {count}")
                else:
                    print(f"     No province specified: {count}")
        
        # Show recent customers
        if 'created_at' in customers.columns:
            recent_customers = customers.sort_values('created_at', ascending=False).head(3)
            print(f"\n📅 Recent customers:")
            for _, customer in recent_customers.iterrows():
                print(f"   - {customer['customer_name']} (created: {customer['created_at']})")
        
        conn.close()
        
    except Exception as e:
        print(f"❌ Error fetching customers: {e}")
        print("\nTroubleshooting:")
        print("1. Ensure PostgreSQL is running")
        print("2. Check database connection parameters")
        print("3. Verify 'ai_assistant' user has proper permissions")
        print("4. Ensure 'soft_sme_db' database exists")

def get_business_overview():
    """Get business overview data"""
    print("\n📊 Fetching business overview...")
    
    try:
        conn = psycopg2.connect(
            host='localhost',
            port=5432,
            database='soft_sme_db',
            user='ai_assistant',
            password='ai_secure_password_2024'
        )
        
        # Get counts from different tables
        tables = ['customermaster', 'vendormaster', 'products', 'inventory', 'salesorderhistory']
        
        print("📈 Business Overview:")
        for table in tables:
            try:
                cursor = conn.cursor()
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                print(f"   {table}: {count} records")
                cursor.close()
            except Exception as e:
                print(f"   {table}: Error - {e}")
        
        conn.close()
        
    except Exception as e:
        print(f"❌ Error fetching business overview: {e}")

if __name__ == "__main__":
    print("🚀 Aiven Customer Data Fetcher (Direct)")
    print("=" * 50)
    
    # Get customer list
    get_customer_list()
    
    # Get business overview
    get_business_overview()
    
    print("\n🎉 Customer data retrieval completed!") 