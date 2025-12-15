import { Pool, type PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const renderSslConfig = { rejectUnauthorized: false } as const;

function shouldUseSSL(): boolean {
  if (process.env.DB_SSL === 'true') return true;
  if (process.env.DB_SSL === 'false') return false;
  if (process.env.DATABASE_URL) return true;
  return process.env.NODE_ENV === 'production';
}

function buildDefaultPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: renderSslConfig,
    };
  }

  const cfg: PoolConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'soft_sme_db',
    password: process.env.DB_PASSWORD || '123',
    port: parseInt(process.env.DB_PORT || '5432', 10),
  };

  if (shouldUseSSL()) {
    cfg.ssl = renderSslConfig;
  }

  return cfg;
}

function parseTenantUrlMap(raw?: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, string>).filter(
          ([, url]) => typeof url === 'string' && url.length > 0
        )
      );
    }
  } catch {
    /* fall back to delimiter parsing */
  }

  return raw
    .split(';')
    .map(entry => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [tenantId, url] = entry.split('=');
      if (tenantId && url) {
        acc[tenantId.trim()] = url.trim();
      }
      return acc;
    }, {});
}

async function runMigrationsForPool(pool: Pool, label: string, migrationsDir: string) {
  const client = await pool.connect();
  try {
    console.log(`Starting database migrations for tenant "${label}"...`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const result = await client.query('SELECT name FROM migrations');
    const executedMigrations = new Set(result.rows.map(row => row.name));

    let executedCount = 0;
    for (const file of files) {
      if (executedMigrations.has(file)) {
        continue;
      }

      console.log(`Running migration (${label}): ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executedCount++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error running migration (${label}) ${file}:`, error);
        throw error;
      }
    }

    if (executedCount === 0) {
      console.log(`No new migrations to run for "${label}".`);
    } else {
      console.log(`Migrations complete for "${label}". Executed ${executedCount} new migrations.`);
    }
  } finally {
    client.release();
  }
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const tenantUrlMap = parseTenantUrlMap(process.env.TENANT_DATABASE_URLS);
  const tenantIds = Object.keys(tenantUrlMap);

  const poolsToClose: Pool[] = [];

  try {
    if (tenantIds.length === 0) {
      const pool = new Pool(buildDefaultPoolConfig());
      poolsToClose.push(pool);
      await runMigrationsForPool(pool, 'default', migrationsDir);
      return;
    }

    console.log(`Detected ${tenantIds.length} tenant databases in TENANT_DATABASE_URLS: ${tenantIds.join(', ')}`);

    for (const tenantId of tenantIds) {
      const pool = new Pool({
        connectionString: tenantUrlMap[tenantId],
        ssl: renderSslConfig,
      });
      poolsToClose.push(pool);
      await runMigrationsForPool(pool, tenantId, migrationsDir);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await Promise.allSettled(poolsToClose.map(p => p.end()));
  }
}

runMigrations();

