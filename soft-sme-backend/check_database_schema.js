const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/soft_sme_db'
});

async function checkDatabaseSchema() {
  try {
    console.log('🔍 Checking Complete Database Schema...\n');

    // Get all tables in the database
    console.log('1. All Tables in Database:');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`   Found ${tablesResult.rows.length} tables:`);
    tablesResult.rows.forEach(table => {
      console.log(`   - ${table.table_name}`);
    });

    console.log('\n' + '='.repeat(80) + '\n');

    // Check each table's structure
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      console.log(`📋 Table: ${tableName}`);
      console.log('-'.repeat(50));
      
      const columnsResult = await pool.query(`
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);

      if (columnsResult.rows.length === 0) {
        console.log('   ❌ No columns found');
      } else {
        console.log(`   Found ${columnsResult.rows.length} columns:`);
        columnsResult.rows.forEach(col => {
          const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
          const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
          const maxLength = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
          console.log(`   - ${col.column_name}: ${col.data_type}${maxLength} ${nullable}${defaultVal}`);
        });
      }
      console.log('');
    }

    // Check for specific missing columns/issues
    console.log('🔍 Checking for Known Issues:');
    console.log('-'.repeat(50));

    // Check user_profile_access table
    const userProfileAccessExists = tablesResult.rows.some(t => t.table_name === 'user_profile_access');
    console.log(`1. user_profile_access table: ${userProfileAccessExists ? '✅ EXISTS' : '❌ MISSING'}`);

    // Check purchasehistory table for specific columns
    const purchaseHistoryExists = tablesResult.rows.some(t => t.table_name === 'purchasehistory');
    if (purchaseHistoryExists) {
      const phColumnsResult = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'purchasehistory' 
        AND table_schema = 'public'
      `);
      const phColumns = phColumnsResult.rows.map(c => c.column_name);
      
      console.log(`2. purchasehistory table columns:`);
      console.log(`   - gst_rate: ${phColumns.includes('gst_rate') ? '✅ EXISTS' : '❌ MISSING'}`);
      console.log(`   - exported_to_qbo: ${phColumns.includes('exported_to_qbo') ? '✅ EXISTS' : '❌ MISSING'}`);
      console.log(`   - qbo_exported_at: ${phColumns.includes('qbo_exported_at') ? '✅ EXISTS' : '❌ MISSING'}`);
      console.log(`   - qbo_export_status: ${phColumns.includes('qbo_export_status') ? '✅ EXISTS' : '❌ MISSING'}`);
    } else {
      console.log(`2. purchasehistory table: ❌ MISSING`);
    }

    // Check profiles table
    const profilesExists = tablesResult.rows.some(t => t.table_name === 'profiles');
    console.log(`3. profiles table: ${profilesExists ? '✅ EXISTS' : '❌ MISSING'}`);

    // Check users table
    const usersExists = tablesResult.rows.some(t => t.table_name === 'users');
    console.log(`4. users table: ${usersExists ? '✅ EXISTS' : '❌ MISSING'}`);

    // Check business_profile table
    const businessProfileExists = tablesResult.rows.some(t => t.table_name === 'business_profile');
    if (businessProfileExists) {
      const bpColumnsResult = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'business_profile' 
        AND table_schema = 'public'
      `);
      const bpColumns = bpColumnsResult.rows.map(c => c.column_name);
      
      console.log(`5. business_profile table columns:`);
      console.log(`   - website: ${bpColumns.includes('website') ? '✅ EXISTS' : '❌ MISSING'}`);
      console.log(`   - postal_code: ${bpColumns.includes('postal_code') ? '✅ EXISTS' : '❌ MISSING'}`);
    } else {
      console.log(`5. business_profile table: ❌ MISSING`);
    }

    console.log('\n✅ Database schema check completed!');

  } catch (error) {
    console.error('❌ Error checking database schema:', error);
  } finally {
    await pool.end();
  }
}

checkDatabaseSchema(); 