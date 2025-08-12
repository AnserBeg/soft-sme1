const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkProfilesData() {
  try {
    console.log('Checking profiles and user access data...');
    
    // Check profiles table
    const profilesResult = await pool.query(`
      SELECT 
        id, 
        name, 
        email,
        created_at,
        updated_at
      FROM profiles 
      ORDER BY name
    `);
    
    console.log(`\nFound ${profilesResult.rows.length} profiles:`);
    profilesResult.rows.forEach((row, index) => {
      console.log(`\nProfile ${index + 1}:`);
      console.log(`  ID: ${row.id}`);
      console.log(`  Name: ${row.name}`);
      console.log(`  Email: ${row.email}`);
      console.log(`  Created: ${row.created_at}`);
      console.log(`  Updated: ${row.updated_at}`);
    });
    
    // Check user_profile_access table
    const accessResult = await pool.query(`
      SELECT 
        upa.id,
        upa.user_id,
        u.username as user_username,
        u.access_role as user_role,
        upa.profile_id,
        p.name as profile_name,
        upa.is_active,
        upa.granted_at,
        upa.created_at
      FROM user_profile_access upa
      LEFT JOIN users u ON upa.user_id = u.id
      LEFT JOIN profiles p ON upa.profile_id = p.id
      ORDER BY upa.user_id, upa.profile_id
    `);
    
    console.log(`\nFound ${accessResult.rows.length} user profile access records:`);
    accessResult.rows.forEach((row, index) => {
      console.log(`\nAccess Record ${index + 1}:`);
      console.log(`  ID: ${row.id}`);
      console.log(`  User ID: ${row.user_id} (${row.user_username || 'Unknown'})`);
      console.log(`  User Role: ${row.user_role || 'Unknown'}`);
      console.log(`  Profile ID: ${row.profile_id} (${row.profile_name || 'Unknown'})`);
      console.log(`  Is Active: ${row.is_active}`);
      console.log(`  Granted At: ${row.granted_at}`);
      console.log(`  Created: ${row.created_at}`);
    });
    
    // Check users table
    const usersResult = await pool.query(`
      SELECT 
        id,
        username,
        email,
        access_role,
        created_at
      FROM users 
      ORDER BY username
    `);
    
    console.log(`\nFound ${usersResult.rows.length} users:`);
    usersResult.rows.forEach((row, index) => {
      console.log(`\nUser ${index + 1}:`);
      console.log(`  ID: ${row.id}`);
      console.log(`  Username: ${row.username}`);
      console.log(`  Email: ${row.email}`);
      console.log(`  Access Role: ${row.access_role}`);
      console.log(`  Created: ${row.created_at}`);
    });
    
    // Check if there are any profiles but no access records
    if (profilesResult.rows.length > 0 && accessResult.rows.length === 0) {
      console.log('\n⚠️  WARNING: There are profiles but no user_profile_access records!');
      console.log('This means mobile users cannot see any profiles.');
      console.log('You need to create user_profile_access records to grant access.');
    }
    
    // Check if there are users but no access records
    if (usersResult.rows.length > 0 && accessResult.rows.length === 0) {
      console.log('\n⚠️  WARNING: There are users but no user_profile_access records!');
      console.log('This means no users have access to any profiles.');
    }
    
  } catch (error) {
    console.error('Error checking profiles data:', error);
  } finally {
    await pool.end();
  }
}

checkProfilesData(); 