const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
});

async function checkDatabaseState() {
  const client = await pool.connect();
  try {
    console.log('=== Database State Check ===');
    
    // Check if companies table exists and has data
    console.log('\n1. Checking companies table:');
    const companiesResult = await client.query('SELECT * FROM companies');
    console.log('Companies found:', companiesResult.rows.length);
    companiesResult.rows.forEach(company => {
      console.log(`  - ID: ${company.id}, Name: ${company.company_name}`);
    });
    
    // Check if users table exists and has data
    console.log('\n2. Checking users table:');
    const usersResult = await client.query('SELECT id, email, username, company_id, access_role FROM users');
    console.log('Users found:', usersResult.rows.length);
    usersResult.rows.forEach(user => {
      console.log(`  - ID: ${user.id}, Email: ${user.email}, Username: ${user.username}, Company ID: ${user.company_id}, Role: ${user.access_role}`);
    });
    
    // Check table structure
    console.log('\n3. Checking users table structure:');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    columnsResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable}, default: ${col.column_default})`);
    });
    
    // Check foreign key constraints
    console.log('\n4. Checking foreign key constraints:');
    const fkResult = await client.query(`
      SELECT 
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='users'
    `);
    fkResult.rows.forEach(fk => {
      console.log(`  - ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
    
  } catch (error) {
    console.error('Error checking database state:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkDatabaseState(); 