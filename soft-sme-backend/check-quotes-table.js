const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkQuotesTable() {
  const client = await pool.connect();
  try {
    // Check if table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'quotes'
      );
    `);
    console.log('Quotes table exists:', tableExists.rows[0].exists);

    if (tableExists.rows[0].exists) {
      // Get table structure
      const tableStructure = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'quotes'
        ORDER BY ordinal_position;
      `);
      console.log('Quotes table structure:', tableStructure.rows);

      // Get foreign key constraints
      const foreignKeys = await client.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'quotes';
      `);
      console.log('Foreign key constraints:', foreignKeys.rows);
    }
  } catch (err) {
    console.error('Error checking quotes table:', err);
  } finally {
    client.release();
    pool.end();
  }
}

checkQuotesTable(); 