import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables - only load from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

const useDatabaseUrl = Boolean(process.env.DATABASE_URL);

const shouldUseSSL = (() => {
  if (process.env.DB_SSL === 'true') {
    return true;
  }

  if (process.env.DB_SSL === 'false') {
    return false;
  }

  if (useDatabaseUrl) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
})();

const commonPoolOptions: Partial<PoolConfig> = {
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

const dbConfig: PoolConfig = useDatabaseUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      ...commonPoolOptions,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_DATABASE || 'soft_sme_db',
      password: process.env.DB_PASSWORD || '123',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      ...commonPoolOptions,
      ...(shouldUseSSL ? { ssl: { rejectUnauthorized: false } } : {}),
    };

const sslEnabled = Boolean((dbConfig as PoolConfig).ssl);

// Debug: Log database configuration (without sensitive details)
console.log('Database configuration source:', useDatabaseUrl ? 'DATABASE_URL' : 'individual environment variables');
console.log('Database host:', useDatabaseUrl ? 'From connection string' : dbConfig.host);
console.log('Database name:', useDatabaseUrl ? 'From connection string' : dbConfig.database);
console.log('Database port:', useDatabaseUrl ? 'From connection string' : dbConfig.port);
console.log('Database connection SSL enabled:', sslEnabled);

const pool = new Pool(dbConfig);

export { pool };
