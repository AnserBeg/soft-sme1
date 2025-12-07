import { PART_SEARCH_DICTIONARY, PartSearchDictionary } from './partSearchDictionary';

type MaybeRecord = Record<string, unknown> | null | undefined;

export interface SmartIndexedItem<T> {
  item: T;
  tokenSet: Set<string>;
  dimensionSet: Set<string>;
  normalizedPartNumber: string;
  normalizedDescription: string;
  categoryHint?: string;
}

export interface SmartSearchHit<T> {
  item: T;
  score: number;
  matchedTokens: string[];
  matchedDimensions: string[];
  matchedCategory?: string;
  partNumberMatched?: boolean;
  descriptionMatched?: boolean;
}

export interface QueryAnalysis {
  normalized: string;
  normalizedPartNumber: string;
  tokens: string[];
  expandedTokens: string[];
  dimensions: string[];
}

const STOPWORDS = new Set((PART_SEARCH_DICTIONARY.stopwords || []).map((w) => w.toUpperCase()));

type ExpansionMap = Map<string, Set<string>>;

const splitTokens = (value: string): string[] =>
  (value || '')
    .split(/[^A-Za-z0-9]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.toUpperCase());

const buildExpansionMap = (dictionary: PartSearchDictionary): ExpansionMap => {
  const map: ExpansionMap = new Map();
  const addEdge = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const key = from.toUpperCase();
    const val = to.toUpperCase();
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(val);
  };

  const ingest = (entries: MaybeRecord) => {
    if (!entries) return;
    Object.entries(entries).forEach(([key, rawValue]) => {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue as string];
      const tokens = new Set<string>();
      splitTokens(key).forEach((t) => tokens.add(t));
      values.forEach((val) => splitTokens(String(val)).forEach((t) => tokens.add(t)));
      const arr = Array.from(tokens);
      arr.forEach((a) => arr.forEach((b) => addEdge(a, b)));
    });
  };

  ingest(dictionary.abbreviation_map);
  ingest(dictionary.material_grade_map);
  ingest(dictionary.finish_map);
  ingest(dictionary.thread_map);
  ingest(dictionary.unit_map as MaybeRecord);

  return map;
};

const EXPANSION_MAP = buildExpansionMap(PART_SEARCH_DICTIONARY);

const normalizeDescription = (value: string, dictionary: PartSearchDictionary = PART_SEARCH_DICTIONARY): string => {
  if (!value) return '';
  let out = String(value);
  const replacements = dictionary.description_normalization?.replace_characters || {};
  Object.entries(replacements).forEach(([from, to]) => {
    out = out.split(from).join(to);
  });
  const allowed = dictionary.description_normalization?.remove_punctuation_except || [];
  const punctPattern = new RegExp(`[^A-Za-z0-9\\s${allowed.map((c) => '\\' + c).join('')}]+`, 'g');
  out = out.replace(punctPattern, ' ');
  if (dictionary.description_normalization?.collapse_whitespace) {
    out = out.replace(/\s+/g, ' ');
  }
  if (dictionary.description_normalization?.to_upper) {
    out = out.toUpperCase();
  }
  return out.trim();
};

const normalizePartNumber = (value: string, dictionary: PartSearchDictionary = PART_SEARCH_DICTIONARY): string => {
  if (!value) return '';
  let out = String(value);
  const stripChars = dictionary.part_number_normalization?.strip_characters || [];
  stripChars.forEach((ch) => {
    const re = new RegExp(ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, '');
  });
  const collapseChars = dictionary.part_number_normalization?.collapse_characters_to_dash || [];
  collapseChars.forEach((ch) => {
    const re = new RegExp(ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, '-');
  });
  if (dictionary.part_number_normalization?.remove_leading_zeros) {
    out = out.replace(/(^|[^0-9])0+([0-9]+)/g, '$1$2');
    out = out.replace(/^0+/, '');
  }
  if (dictionary.part_number_normalization?.case === 'upper') {
    out = out.toUpperCase();
  }
  return out.trim();
};

const compileDimensionPatterns = (dictionary: PartSearchDictionary) =>
  (dictionary.dimension_patterns || []).map((p) => ({
    ...p,
    regexes: p.regexes.map((r) => new RegExp(r, 'gi')),
  }));

const DIMENSION_PATTERNS = compileDimensionPatterns(PART_SEARCH_DICTIONARY);

const formatDimension = (pattern: any, groups: Record<string, string | undefined>): string => {
  let normalized = pattern.normalized_form || '';
  normalized = normalized.replace(/\{(\w+)\}/g, (_, name) => groups[name] || '');
  if (pattern.length_ft_suffix && groups.length) {
    normalized = normalized.replace('{length_ft}', `${groups.length}${pattern.length_ft_suffix}`);
  } else {
    normalized = normalized.replace('{length_ft}', groups.length || '');
  }
  return normalized.replace(/\s+/g, ' ').trim().toUpperCase();
};

const extractDimensions = (text: string): Set<string> => {
  const result = new Set<string>();
  if (!text) return result;
  for (const pattern of DIMENSION_PATTERNS) {
    for (const regex of pattern.regexes as RegExp[]) {
      let match: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((match = regex.exec(text)) !== null) {
        const groups = match.groups || {};
        const normalized = formatDimension(pattern, groups);
        if (normalized) result.add(normalized);
      }
      regex.lastIndex = 0;
    }
  }
  return result;
};

const tokenize = (text: string): string[] => {
  const normalized = normalizeDescription(text);
  return normalized
    .split(/[^A-Z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
};

const expandTokens = (tokens: Iterable<string>): Set<string> => {
  const result = new Set<string>();
  for (const token of tokens) {
    const key = token.toUpperCase();
    result.add(key);
    const expansion = EXPANSION_MAP.get(key);
    if (expansion) {
      expansion.forEach((v) => result.add(v));
    }
  }
  return result;
};

const intersect = (a: Set<string>, b: Set<string>): Set<string> => {
  const result = new Set<string>();
  a.forEach((value) => {
    if (b.has(value)) result.add(value);
  });
  return result;
};

const inferCategory = (description: string, dictionary: PartSearchDictionary = PART_SEARCH_DICTIONARY): string | undefined => {
  if (!description) return undefined;
  const upper = description.toUpperCase();
  for (const rule of dictionary.category_inference_rules || []) {
    if (rule.if_description_contains_any?.some((kw) => upper.includes(kw))) {
      return rule.category;
    }
  }
  return undefined;
};

export const indexInventoryForSmartSearch = <T extends { part_number?: string; part_description?: string; category?: string }>(
  items: T[],
  dictionary: PartSearchDictionary = PART_SEARCH_DICTIONARY,
): SmartIndexedItem<T>[] => {
  return items.map((item) => {
    const combinedText = `${item.part_number || ''} ${item.part_description || ''}`;
    const tokenSet = expandTokens(tokenize(combinedText));
    const dimensionSet = extractDimensions(combinedText);
    const normalizedPartNumber = normalizePartNumber(item.part_number || '', dictionary);
    const normalizedDescription = normalizeDescription(item.part_description || '', dictionary);
    const categoryHint = item.category || inferCategory(normalizedDescription, dictionary);
    return { item, tokenSet, dimensionSet, normalizedPartNumber, normalizedDescription, categoryHint };
  });
};

export const analyzeQuery = (query: string): QueryAnalysis => {
  const normalized = normalizeDescription(query);
  const normalizedPartNumber = normalizePartNumber(query);
  const tokens = tokenize(query);
  const expanded = expandTokens(tokens);
  const dimensions = extractDimensions(query);
  return {
    normalized,
    normalizedPartNumber,
    tokens,
    expandedTokens: Array.from(expanded),
    dimensions: Array.from(dimensions),
  };
};

export const smartSearchInventory = <T>(
  indexedItems: SmartIndexedItem<T>[],
  query: string,
): SmartSearchHit<T>[] => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { normalized, normalizedPartNumber, expandedTokens, dimensions } = analyzeQuery(trimmed);
  const expandedTokenSet = new Set(expandedTokens);
  const dimensionSet = new Set(dimensions);

  const results: SmartSearchHit<T>[] = [];

  for (const item of indexedItems) {
    const matchedTokens = intersect(item.tokenSet, expandedTokenSet);
    const matchedDimensions = intersect(item.dimensionSet, dimensionSet);
    const partNumberMatched = normalizedPartNumber.length > 0 && item.normalizedPartNumber.includes(normalizedPartNumber);
    const descriptionMatched = normalized.length > 2 && item.normalizedDescription.includes(normalized);

    let score = 0;
    score += matchedTokens.size * 2;
    score += matchedDimensions.size * 3;
    if (partNumberMatched) score += 5;
    if (descriptionMatched) score += 2;

    if (score > 0) {
      const matchedCategory =
        item.categoryHint && (expandedTokenSet.has(item.categoryHint.toUpperCase()) || normalized.includes(item.categoryHint.toUpperCase()))
          ? item.categoryHint
          : undefined;
      results.push({
        item: item.item,
        score,
        matchedTokens: Array.from(matchedTokens),
        matchedDimensions: Array.from(matchedDimensions),
        matchedCategory,
        partNumberMatched,
        descriptionMatched,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || (String(a.item['part_number'] || '')).localeCompare(String(b.item['part_number'] || '')));
};
