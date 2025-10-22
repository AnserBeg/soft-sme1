export interface FuzzyConfig {
  minScoreAuto: number;
  minScoreShow: number;
  maxResults: number;
}

export interface CanonicalConfig {
  enforceUniquePart: boolean;
}

export interface DocsConfig {
  requireCitations: boolean;
}

type NumberBounds = {
  min?: number;
  max?: number;
};

function clamp(value: number, bounds?: NumberBounds): number {
  if (!bounds) {
    return value;
  }
  const { min, max } = bounds;
  let result = value;
  if (typeof min === 'number' && result < min) {
    result = min;
  }
  if (typeof max === 'number' && result > max) {
    result = max;
  }
  return result;
}

function parseFloatSetting(name: string, defaultValue: number, bounds?: NumberBounds): number {
  const raw = process.env[name];
  if (raw == null) {
    return defaultValue;
  }

  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) {
    return defaultValue;
  }

  return clamp(numeric, bounds);
}

function parseIntegerSetting(name: string, defaultValue: number, bounds?: NumberBounds): number {
  const raw = process.env[name];
  if (raw == null) {
    return defaultValue;
  }

  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric)) {
    return defaultValue;
  }

  return clamp(numeric, bounds);
}

function parseBooleanSetting(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function getFuzzyConfig(): FuzzyConfig {
  return {
    minScoreAuto: parseFloatSetting('FUZZY_MIN_SCORE_AUTO', 0.6, { min: 0, max: 1 }),
    minScoreShow: parseFloatSetting('FUZZY_MIN_SCORE_SHOW', 0.35, { min: 0, max: 1 }),
    maxResults: parseIntegerSetting('FUZZY_MAX_RESULTS', 10, { min: 1, max: 50 }),
  };
}

export function getCanonicalConfig(): CanonicalConfig {
  return {
    enforceUniquePart: parseBooleanSetting('CANON_ENFORCE_UNIQUE_PART', true),
  };
}

export function getDocsConfig(): DocsConfig {
  return {
    requireCitations: parseBooleanSetting('DOCS_REQUIRE_CITATIONS', false),
  };
}
