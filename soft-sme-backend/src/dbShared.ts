import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables - only load from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

const useDatabaseUrl = Boolean(process.env.SHARED_DATABASE_URL || process.env.DATABASE_URL);

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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

/**
 * Render managed Postgres databases require SSL but provide certificates that
 * are not signed by a public CA, so we disable certificate verification.
 */
const renderSslConfig = { rejectUnauthorized: false } as const;

const dbConfig: PoolConfig = useDatabaseUrl
  ? {
      connectionString: process.env.SHARED_DATABASE_URL || process.env.DATABASE_URL,
      ssl: renderSslConfig,
      ...commonPoolOptions,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_DATABASE || 'soft_sme_db',
      password: process.env.DB_PASSWORD || '123',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      ...commonPoolOptions,
      ...(shouldUseSSL ? { ssl: renderSslConfig } : {}),
    };

const sslEnabled = Boolean((dbConfig as PoolConfig).ssl);

const sharedPool = new Pool(dbConfig);

console.log(
  `[db-shared] Pool initialized with connectionString=${useDatabaseUrl} sslEnabled=${sslEnabled}`
);

export { sharedPool };
