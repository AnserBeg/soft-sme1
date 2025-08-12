const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/soft_sme_db'
});

async function checkMobileAccess() {
  try {
    console.log('🔍 Checking Mobile Access Database State...\n');

    // Check if profiles table exists and has data
    console.log('1. Checking profiles table:');
    const profilesResult = await pool.query('SELECT id, name, email FROM profiles ORDER BY id');
    console.log(`   Found ${profilesResult.rows.length} profiles:`);
    profilesResult.rows.forEach(profile => {
      console.log(`   - ID: ${profile.id}, Name: ${profile.name}, Email: ${profile.email}`);
    });

    // Check if there are any Mobile Time Tracker users
    console.log('\n2. Checking Mobile Time Tracker users:');
    const mobileUsersResult = await pool.query(`
      SELECT id, email, access_role, created_at 
      FROM users 
      WHERE access_role = 'Mobile Time Tracker'
      ORDER BY email
    `);
    console.log(`   Found ${mobileUsersResult.rows.length} Mobile Time Tracker users:`);
    mobileUsersResult.rows.forEach(user => {
      console.log(`   - ID: ${user.id}, Email: ${user.email}, Role: ${user.access_role}`);
    });

    // Check if user_profile_access table exists and has data
    console.log('\n3. Checking user_profile_access table:');
    const accessResult = await pool.query(`
      SELECT 
        upa.id,
        upa.user_id,
        u.email as user_email,
        upa.profile_id,
        p.name as profile_name,
        upa.granted_by,
        upa.is_active,
        upa.created_at
      FROM user_profile_access upa
      LEFT JOIN users u ON upa.user_id = u.id
      LEFT JOIN profiles p ON upa.profile_id = p.id
      ORDER BY upa.created_at DESC
    `);
    console.log(`   Found ${accessResult.rows.length} access records:`);
    accessResult.rows.forEach(access => {
      console.log(`   - ID: ${access.id}, User: ${access.user_email}, Profile: ${access.profile_name}, Active: ${access.is_active}`);
    });

    // Check if there are any Admin users
    console.log('\n4. Checking Admin users:');
    const adminUsersResult = await pool.query(`
      SELECT id, email, access_role 
      FROM users 
      WHERE access_role = 'Admin'
      ORDER BY email
    `);
    console.log(`   Found ${adminUsersResult.rows.length} Admin users:`);
    adminUsersResult.rows.forEach(user => {
      console.log(`   - ID: ${user.id}, Email: ${user.email}, Role: ${user.access_role}`);
    });

    console.log('\n✅ Database check completed!');

  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await pool.end();
  }
}

checkMobileAccess(); 