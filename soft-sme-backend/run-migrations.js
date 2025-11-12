const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Prefer DATABASE_URL if provided (Render/Heroku style). Fallback to discrete vars.
const useDatabaseUrl = Boolean(process.env.DATABASE_URL);
const connectionOptions = useDatabaseUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      // Render-managed Postgres often needs SSL with relaxed cert validation
      ssl: { rejectUnauthorized: false },
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      // Support both DB_DATABASE and DB_NAME keys
      database: process.env.DB_DATABASE || process.env.DB_NAME || 'soft_sme_db',
      password: process.env.DB_PASSWORD || '123',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    };

const pool = new Pool(connectionOptions);

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`Running migration: ${file}`);
      await client.query(sql);
    }
    console.log('All migrations ran successfully.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations().then(() => process.exit(0));
}

module.exports = runMigrations; 
