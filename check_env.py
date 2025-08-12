#!/usr/bin/env python3
"""
Check environment variables and .env file
"""

import os

def check_env():
    """Check environment variables and .env files"""
    print("🔍 Checking environment variables...")
    
    # Check if .env file exists in backend
    backend_env_path = os.path.join('soft-sme-backend', '.env')
    if os.path.exists(backend_env_path):
        print(f"✅ Found .env file at: {backend_env_path}")
        
        # Try to read it
        try:
            with open(backend_env_path, 'r') as f:
                content = f.read()
                lines = content.split('\n')
                print(f"📄 File has {len(lines)} lines")
                
                # Look for GEMINI_API_KEY
                for line in lines:
                    if line.strip().startswith('GEMINI_API_KEY='):
                        key_value = line.split('=', 1)
                        if len(key_value) == 2:
                            key = key_value[0]
                            value = key_value[1]
                            if value and value != 'your-gemini-api-key-here':
                                print(f"✅ Found {key}: {value[:10]}...")
                            else:
                                print(f"⚠️  Found {key} but it's not set to a real value")
                        break
                else:
                    print("❌ GEMINI_API_KEY not found in .env file")
                    
        except Exception as e:
            print(f"❌ Error reading .env file: {e}")
    else:
        print(f"❌ No .env file found at: {backend_env_path}")
    
    # Check current environment
    gemini_key = os.getenv('GEMINI_API_KEY')
    if gemini_key:
        print(f"✅ GEMINI_API_KEY in environment: {gemini_key[:10]}...")
    else:
        print("❌ GEMINI_API_KEY not found in environment variables")
    
    # List all environment variables that start with GEMINI
    gemini_vars = [k for k in os.environ.keys() if k.startswith('GEMINI')]
    if gemini_vars:
        print(f"📋 Found {len(gemini_vars)} GEMINI environment variables:")
        for var in gemini_vars:
            value = os.environ[var]
            print(f"   {var}: {value[:10]}...")
    else:
        print("📋 No GEMINI environment variables found")

if __name__ == "__main__":
    check_env() 