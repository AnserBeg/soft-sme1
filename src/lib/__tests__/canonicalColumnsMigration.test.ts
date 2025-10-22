import fs from 'fs';
import path from 'path';

describe('canonical columns migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../../soft-sme-backend/migrations/20251022_add_canonical_columns.sql',
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  it('enables required text search extensions', () => {
    expect(migrationSql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    expect(migrationSql).toContain('CREATE EXTENSION IF NOT EXISTS unaccent;');
    expect(migrationSql).toContain('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;');
  });

  it('backfills canonical columns for vendors, customers, and inventory', () => {
    expect(migrationSql).toMatch(/ALTER TABLE\s+vendormaster\s+ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';/);
    expect(migrationSql).toMatch(/ALTER TABLE\s+customermaster\s+ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';/);
    expect(migrationSql).toMatch(
      /ALTER TABLE\s+inventory\s+ADD COLUMN IF NOT EXISTS canonical_part_number TEXT NOT NULL DEFAULT '',\s+ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';/,
    );

    expect(migrationSql).toMatch(/UPDATE\s+vendormaster\s+SET\s+canonical_name = canonicalize_text\(vendor_name\);/);
    expect(migrationSql).toMatch(/UPDATE\s+customermaster\s+SET\s+canonical_name = canonicalize_text\(customer_name\);/);
    expect(migrationSql).toMatch(
      /UPDATE\s+inventory\s+SET\s+canonical_part_number = canonicalize_part_number\(part_number\),\s+canonical_name = canonicalize_text\(part_description\);/,
    );
  });
});
