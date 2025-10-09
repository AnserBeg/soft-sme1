#!/usr/bin/env python3
"""
Simple script to fetch and display customer data from Aiven database
"""

import os
import sys
from ai_database_connection_optimized import OptimizedAivenDatabase

def get_customer_list():
    """Fetch and display customer list"""
    print("🔍 Fetching customer list from Aiven database...")
    
    # Initialize database connection
    db = OptimizedAivenDatabase(
        max_connections=3,
        cache_size=50,
        cache_ttl=180
    )
    
    try:
        # Get customer data
        customers = db.get_customers(100)  # Get up to 100 customers
        
        if customers is None or customers.empty:
            print("❌ No customers found or database connection failed")
            return
        
        print(f"\n✅ Found {len(customers)} customers:")
        print("=" * 80)
        
        # Display customer information
        for index, customer in customers.iterrows():
            print(f"\n{index + 1}. {customer['customer_name']}")
            print(f"   Contact: {customer['contact_person']}")
            print(f"   Email: {customer['email']}")
            print(f"   Phone: {customer['phone_number']}")
            print(f"   Address: {customer['street_address']}, {customer['city']}, {customer['province']}")
            print(f"   Country: {customer['country']}")
            print(f"   Postal Code: {customer['postal_code']}")
            if customer['website']:
                print(f"   Website: {customer['website']}")
            print("-" * 40)
        
        # Show summary statistics
        print(f"\n📊 Customer Summary:")
        print(f"   Total customers: {len(customers)}")
        
        # Count by province
        if 'province' in customers.columns:
            province_counts = customers['province'].value_counts()
            print(f"   By province:")
            for province, count in province_counts.head(5).items():
                print(f"     {province}: {count}")
        
        # Show performance stats
        perf_stats = db.get_performance_stats()
        print(f"\n⚡ Performance:")
        print(f"   Cache hit rate: {perf_stats['cache_hit_rate']:.1f}%")
        print(f"   Average query time: {perf_stats['performance_metrics']['avg_query_time']:.3f}s")
        
    except Exception as e:
        print(f"❌ Error fetching customers: {e}")
        print("\nTroubleshooting:")
        print("1. Ensure PostgreSQL is running")
        print("2. Check database connection parameters")
        print("3. Verify 'ai_assistant' user has proper permissions")
        print("4. Ensure 'soft_sme' database exists")
    
    finally:
        db.cleanup()

def get_customer_summary():
    """Get customer summary data"""
    print("\n📊 Fetching customer summary...")
    
    db = OptimizedAivenDatabase()
    
    try:
        summary = db.get_customers_summary(10)
        
        if summary is not None and not summary.empty:
            print(f"\n✅ Customer Summary (Top 10):")
            print("=" * 50)
            
            for index, row in summary.iterrows():
                print(f"{index + 1}. {row['customer_name']}")
                print(f"   Location: {row['city']}, {row['province']}")
                print(f"   Contact: {row['contact_person']}")
                print("-" * 30)
        
    except Exception as e:
        print(f"❌ Error fetching summary: {e}")
    finally:
        db.cleanup()

if __name__ == "__main__":
    print("🚀 Aiven Customer Data Fetcher")
    print("=" * 50)
    
    # Check if database is accessible
    try:
        test_db = OptimizedAivenDatabase()
        if not test_db.connect():
            print("❌ Cannot connect to database. Please check your database setup.")
            sys.exit(1)
        test_db.disconnect()
        print("✅ Database connection verified")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)
    
    # Get full customer list
    get_customer_list()
    
    # Get customer summary
    get_customer_summary()
    
    print("\n🎉 Customer data retrieval completed!") 