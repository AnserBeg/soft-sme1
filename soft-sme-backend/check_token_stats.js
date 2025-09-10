const { pool } = require('./dist/db');

async function checkTokenStats() {
  try {
    // Check if token_stats table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'token_stats'
      );
    `);
    
    console.log('token_stats table exists:', tableExists.rows[0].exists);
    
    if (tableExists.rows[0].exists) {
      // Check structure
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'token_stats' 
        ORDER BY ordinal_position
      `);
      
      console.log('\ntoken_stats table structure:');
      result.rows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
      });
      
      // Check data count
      const countResult = await pool.query('SELECT COUNT(*) FROM token_stats');
      console.log(`\nTotal rows in token_stats: ${countResult.rows[0].count}`);
    }
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkTokenStats();



