import { pool } from './db';

async function checkDatabase() {
  try {
    // Test connection
    const client = await pool.connect();
    console.log('Database connection successful');

    // Check companies table
    const companiesResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'companies'
      );
    `);
    console.log('Companies table exists:', companiesResult.rows[0].exists);

    // Check users table
    const usersResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    console.log('Users table exists:', usersResult.rows[0].exists);

    // Check table structures
    const companiesColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'companies';
    `);
    console.log('\nCompanies table structure:');
    companiesColumns.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}`);
    });

    const usersColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users';
    `);
    console.log('\nUsers table structure:');
    usersColumns.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}`);
    });

    client.release();
  } catch (error) {
    console.error('Database check failed:', error);
  } finally {
    await pool.end();
  }
}

checkDatabase(); 