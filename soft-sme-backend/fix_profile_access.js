const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function fixProfileAccess() {
  try {
    console.log('Fixing profile access...');
    
    // Get all profiles
    const profilesResult = await pool.query('SELECT id, name FROM profiles ORDER BY name');
    console.log(`Found ${profilesResult.rows.length} profiles`);
    
    // Get users that need profile access (Mobile Time Tracker, Time Tracking, Admin)
    const usersResult = await pool.query(`
      SELECT id, username, access_role 
      FROM users 
      WHERE access_role IN ('Mobile Time Tracker', 'Time Tracking', 'Admin')
      ORDER BY username
    `);
    console.log(`Found ${usersResult.rows.length} users that need profile access`);
    
    // Grant access to all profiles for each user
    for (const user of usersResult.rows) {
      for (const profile of profilesResult.rows) {
        try {
          // Check if access already exists
          const existingAccess = await pool.query(
            'SELECT id FROM user_profile_access WHERE user_id = $1 AND profile_id = $2',
            [user.id, profile.id]
          );
          
          if (existingAccess.rows.length === 0) {
            // Grant access
            await pool.query(
              'INSERT INTO user_profile_access (user_id, profile_id, granted_by, is_active) VALUES ($1, $2, $3, true)',
              [user.id, profile.id, user.id] // granted_by is the same user for now
            );
            console.log(`✓ Granted access: User "${user.username}" (${user.access_role}) -> Profile "${profile.name}"`);
          } else {
            console.log(`- Access already exists: User "${user.username}" -> Profile "${profile.name}"`);
          }
        } catch (error) {
          console.error(`✗ Error granting access for user ${user.username} to profile ${profile.name}:`, error.message);
        }
      }
    }
    
    // Verify the changes
    const accessResult = await pool.query(`
      SELECT 
        upa.id,
        u.username as user_username,
        u.access_role as user_role,
        p.name as profile_name,
        upa.is_active
      FROM user_profile_access upa
      JOIN users u ON upa.user_id = u.id
      JOIN profiles p ON upa.profile_id = p.id
      ORDER BY u.username, p.name
    `);
    
    console.log(`\n✅ Created ${accessResult.rows.length} profile access records:`);
    accessResult.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.user_username} (${row.user_role}) -> ${row.profile_name} [${row.is_active ? 'Active' : 'Inactive'}]`);
    });
    
  } catch (error) {
    console.error('Error fixing profile access:', error);
  } finally {
    await pool.end();
  }
}

fixProfileAccess(); 