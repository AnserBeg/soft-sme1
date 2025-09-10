const { pool } = require('./dist/db');

async function checkTable() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'part_tokens' 
      ORDER BY ordinal_position
    `);
    
    console.log('part_tokens table structure:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Also check if table has any data
    const countResult = await pool.query('SELECT COUNT(*) FROM part_tokens');
    console.log(`\nTotal rows in part_tokens: ${countResult.rows[0].count}`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkTable();



