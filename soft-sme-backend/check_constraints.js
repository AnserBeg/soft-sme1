const { pool } = require('./dist/db');

async function checkConstraints() {
  try {
    // Check constraints on token_stats table
    const constraintsResult = await pool.query(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage ccu 
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'token_stats'
      ORDER BY tc.constraint_type, tc.constraint_name;
    `);
    
    console.log('Constraints on token_stats table:');
    constraintsResult.rows.forEach(row => {
      console.log(`  ${row.constraint_type}: ${row.constraint_name} (${row.column_name})`);
    });
    
    // Check if there's a unique constraint on (token, type)
    const uniqueResult = await pool.query(`
      SELECT 
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'token_stats' 
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name;
    `);
    
    console.log('\nUnique constraints:');
    uniqueResult.rows.forEach(row => {
      console.log(`  ${row.constraint_name}: (${row.columns})`);
    });
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkConstraints();



