const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function updateSessionTimeout() {
  try {
    console.log('Updating session timeout settings...');
    
    // Update existing companies to have longer session timeouts
    const result = await pool.query(`
      UPDATE companies 
      SET 
        session_timeout_hours = 720,
        refresh_token_days = 90
      WHERE session_timeout_hours = 24 OR refresh_token_days = 30
    `);
    
    console.log(`Updated ${result.rowCount} companies`);
    
    // Update the default values for new companies
    await pool.query(`
      ALTER TABLE companies 
      ALTER COLUMN session_timeout_hours SET DEFAULT 720,
      ALTER COLUMN refresh_token_days SET DEFAULT 90
    `);
    
    console.log('Updated default values for new companies');
    console.log('Session timeout: 24 hours -> 30 days (720 hours)');
    console.log('Refresh token: 30 days -> 90 days');
    
  } catch (error) {
    console.error('Error updating session timeout:', error);
  } finally {
    await pool.end();
  }
}

updateSessionTimeout();
