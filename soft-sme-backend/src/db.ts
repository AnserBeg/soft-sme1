import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { logger } from './utils/logger';

// Load environment variables - only load from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

type TenantContext = { tenantId: string };

const tenantStore = new AsyncLocalStorage<TenantContext>();
const tenantPools = new Map<string, Pool>();

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

const shouldUseSSL = (() => {
  if (process.env.DB_SSL === 'true') {
    return true;
  }

  if (process.env.DB_SSL === 'false') {
    return false;
  }

  if (process.env.DATABASE_URL) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
})();

function buildPoolConfigFromEnv(): PoolConfig {
  const useDatabaseUrl = Boolean(process.env.DATABASE_URL);

  return useDatabaseUrl
    ? {
        connectionString: process.env.DATABASE_URL,
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
}

function parseTenantUrlMap(raw?: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  // Support JSON object or semicolon-delimited list: "1=postgres://...;2=postgres://..."
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

const tenantUrlMap = parseTenantUrlMap(process.env.TENANT_DATABASE_URLS);
const defaultTenantId =
  process.env.DEFAULT_TENANT_ID ||
  Object.keys(tenantUrlMap)[0] ||
  'default';

function buildPoolConfigForTenant(tenantId: string): PoolConfig {
  const tenantUrl = tenantUrlMap[tenantId];

  if (tenantUrl) {
    return {
      connectionString: tenantUrl,
      ssl: renderSslConfig,
      ...commonPoolOptions,
    };
  }

  // Fallback to single-tenant env config to keep backward compatibility
  if (tenantId === defaultTenantId) {
    return buildPoolConfigFromEnv();
  }

  throw new Error(
    `No database connection configured for tenant "${tenantId}". Set TENANT_DATABASE_URLS or DEFAULT_TENANT_ID.`
  );
}

function getOrCreatePool(tenantId: string): Pool {
  if (!tenantPools.has(tenantId)) {
    const cfg = buildPoolConfigForTenant(tenantId);
    const pool = new Pool(cfg);
    tenantPools.set(tenantId, pool);
    logger.info(`[db] Created pool for tenant ${tenantId}`);
  }
  return tenantPools.get(tenantId)!;
}

/**
 * Run a function within a tenant context. All downstream code that uses the exported
 * tenant-aware pool will automatically use the correct database.
 */
export function runWithTenantContext<T>(tenantId: string, fn: () => T): T {
  return tenantStore.run({ tenantId }, fn);
}

export function getTenantId(): string | undefined {
  return tenantStore.getStore()?.tenantId;
}

export function getTenantPool(tenantId?: string): Pool {
  const effectiveTenantId = tenantId ?? getTenantId() ?? defaultTenantId;
  return getOrCreatePool(effectiveTenantId);
}

// Proxy that forwards Pool methods to the tenant-specific pool based on the current AsyncLocalStorage context.
const tenantAwarePool = new Proxy(getOrCreatePool(defaultTenantId), {
  get(target, prop, receiver) {
    const tenantId = tenantStore.getStore()?.tenantId;
    const pool = tenantId ? getOrCreatePool(tenantId) : target;
    const value = Reflect.get(pool as any, prop, receiver);
    if (typeof value === 'function') {
      return (value as Function).bind(pool);
    }
    return value;
  },
});

export { tenantAwarePool as pool };
