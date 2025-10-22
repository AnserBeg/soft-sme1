import { pool } from '../db';
import { canonicalizeName, canonicalizePartNumber } from '../lib/normalize';

export type FuzzySearchType = 'vendor' | 'customer' | 'part';

export interface FuzzySearchOptions {
  type: FuzzySearchType;
  query: string;
  limit?: number;
  minScore?: number;
}

export interface FuzzySearchMatch {
  id: number;
  label: string;
  score: number;
  extra: Record<string, unknown>;
}

type QueryRow = {
  id: number;
  label: string;
  score: number | string;
  canonical_value: string | null;
} & Record<string, any>;

interface SearchConfig {
  table: string;
  idColumn: string;
  labelColumn: string;
  canonicalColumn: string;
  extraColumns: string[];
  canonicalize: (value: unknown) => string;
  buildExtra: (row: QueryRow) => Record<string, unknown>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_MIN_SCORE = 0.35;

const searchConfigs: Record<FuzzySearchType, SearchConfig> = {
  vendor: {
    table: 'vendormaster',
    idColumn: 'vendor_id',
    labelColumn: 'vendor_name',
    canonicalColumn: 'canonical_name',
    extraColumns: ['city', 'province', 'country'],
    canonicalize: canonicalizeName,
    buildExtra: (row: QueryRow) => {
      return {
        type: 'vendor',
        canonical: row.canonical_value || null,
        city: row.city ?? null,
        province: row.province ?? null,
        country: row.country ?? null,
      };
    },
  },
  customer: {
    table: 'customermaster',
    idColumn: 'customer_id',
    labelColumn: 'customer_name',
    canonicalColumn: 'canonical_name',
    extraColumns: ['city', 'province', 'country'],
    canonicalize: canonicalizeName,
    buildExtra: (row: QueryRow) => {
      return {
        type: 'customer',
        canonical: row.canonical_value || null,
        city: row.city ?? null,
        province: row.province ?? null,
        country: row.country ?? null,
      };
    },
  },
  part: {
    table: 'inventory',
    idColumn: 'part_id',
    labelColumn: 'part_number',
    canonicalColumn: 'canonical_part_number',
    extraColumns: ['part_description', 'unit', 'part_type'],
    canonicalize: canonicalizePartNumber,
    buildExtra: (row: QueryRow) => {
      return {
        type: 'part',
        canonical: row.canonical_value || null,
        description: row.part_description ?? null,
        unit: row.unit ?? null,
        partType: row.part_type ?? null,
      };
    },
  },
};

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  const floored = Math.floor(Number(value));
  if (!Number.isFinite(floored) || floored <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, floored);
}

function normalizeMinScore(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MIN_SCORE;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MIN_SCORE;
  }
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return 1;
  }
  return numeric;
}

export async function fuzzySearch(options: FuzzySearchOptions): Promise<FuzzySearchMatch[]> {
  const config = searchConfigs[options.type];
  if (!config) {
    throw new Error(`Unsupported search type: ${options.type}`);
  }

  const limit = normalizeLimit(options.limit);
  const minScore = normalizeMinScore(options.minScore);

  const canonicalQuery = config.canonicalize(options.query);
  if (!canonicalQuery) {
    return [];
  }

  const extraSelect = config.extraColumns.length > 0 ? `, ${config.extraColumns.join(', ')}` : '';

  const queryText = `
    SELECT ${config.idColumn} AS id,
           ${config.labelColumn} AS label,
           similarity(${config.canonicalColumn}, $1) AS score,
           ${config.canonicalColumn} AS canonical_value${extraSelect}
      FROM ${config.table}
     WHERE similarity(${config.canonicalColumn}, $1) >= $2
        OR ${config.canonicalColumn} LIKE $3
     ORDER BY (${config.canonicalColumn} = $1) DESC, score DESC
     LIMIT $4
  `;

  const result = await pool.query<QueryRow>(queryText, [canonicalQuery, minScore, `${canonicalQuery}%`, limit]);

  return (result.rows || []).map((row) => {
    const score = typeof row.score === 'number' ? row.score : Number(row.score ?? 0);
    return {
      id: row.id,
      label: row.label,
      score: Number.isFinite(score) ? score : 0,
      extra: config.buildExtra(row),
    };
  });
}

