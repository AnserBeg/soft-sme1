import { pool } from './db';
import * as fs from 'fs';
import * as path from 'path';

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting database migrations...');
    
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`📁 Found ${files.length} migration files:`, files);

    // Get list of executed migrations
    const result = await client.query('SELECT name FROM migrations');
    const executedMigrations = new Set(result.rows.map(row => row.name));

    console.log(`✅ Already executed migrations:`, Array.from(executedMigrations));

    // Run pending migrations
    let executedCount = 0;
    for (const file of files) {
      if (!executedMigrations.has(file)) {
        console.log(`\n🔄 Running migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`✅ Migration ${file} completed successfully`);
          executedCount++;
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`❌ Error running migration ${file}:`, error);
          throw error;
        }
      } else {
        console.log(`⏭️  Skipping already executed migration: ${file}`);
      }
    }

    if (executedCount === 0) {
      console.log('\n🎉 No new migrations to run - database is up to date!');
    } else {
      console.log(`\n🎉 All migrations completed successfully! Executed ${executedCount} new migrations.`);
    }
    
    // Show current database schema for pickup and order tracking fields
    console.log('\n📊 Checking current database schema...');
    try {
      const schemaResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'purchasehistory' 
        AND (column_name LIKE 'pickup_%' OR column_name LIKE 'order_%' OR column_name LIKE 'vendor_%' OR column_name LIKE 'pricing_%' OR column_name LIKE 'quantity_%')
        ORDER BY column_name
      `);
      
      if (schemaResult.rows.length > 0) {
        console.log('\n📋 Current pickup and order tracking fields:');
        schemaResult.rows.forEach(row => {
          console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });
      } else {
        console.log('\n⚠️  No pickup or order tracking fields found - migrations may not have run yet');
      }
    } catch (schemaError) {
      console.log('\n⚠️  Could not check schema (table may not exist yet):', (schemaError as Error).message);
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations(); 