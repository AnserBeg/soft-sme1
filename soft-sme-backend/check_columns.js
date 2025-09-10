const { pool } = require('./dist/db');

async function checkColumns() {
  try {
    // Check exact column names
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'part_tokens' 
      ORDER BY ordinal_position
    `);
    
    console.log('part_tokens table columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Check sample data
    const sampleResult = await pool.query('SELECT * FROM part_tokens LIMIT 3');
    console.log('\nSample data:');
    sampleResult.rows.forEach(row => {
      console.log(row);
    });
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkColumns();



