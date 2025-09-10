// Enhanced token types matching your database schema
export const TOKEN_TYPES = {
  // High-priority dimension tokens
  SIZE4: 'SIZE4',
  SIZE3: 'SIZE3', 
  SIZE2: 'SIZE2',
  D1: 'D1',
  D2: 'D2',
  D3: 'D3',
  D1_DEC: 'D1_DEC',
  D2_DEC: 'D2_DEC',
  D3_DEC: 'D3_DEC',
  
  // Measurement tokens
  OD: 'OD',
  OD_DEC: 'OD_DEC',
  ID: 'ID', 
  ID_DEC: 'ID_DEC',
  GA: 'GA',
  SCH: 'SCH',
  LEN: 'LEN',
  
  // Material and grade tokens
  GRADE: 'GRADE',
  MATERIAL: 'MATERIAL',
  CATEGORY: 'CATEGORY',
  FEATURE: 'FEATURE',
  
  // Fraction tokens
  FRAC: 'FRAC',
  FRAC_DEC: 'FRAC_DEC',
  
  // Part number tokens
  PN_WORD: 'PN_WORD',
  PN_NUM: 'PN_NUM',
  PN_ALL: 'PN_ALL',
  
  // General word tokens
  WORD: 'WORD'
} as const;

// Facet order for UI display (matching backend)
export const FACET_ORDER = [
  'CATEGORY', 'MATERIAL', 'GRADE', 
  'SIZE4', 'SIZE3', 'SIZE2', 'D1', 'D2', 'D3',
  'OD', 'ID', 'GA', 'SCH', 'LEN', 
  'FEATURE', 'FRAC', 'FRAC_DEC',
  'PN_WORD', 'PN_NUM', 'PN_ALL', 'WORD'
];

// Token type weights for ranking
export const TOKEN_WEIGHTS: Record<string, number> = {
  SIZE4: 100,
  SIZE3: 96,
  SIZE2: 92,
  D1: 90,
  D2: 88,
  D3: 86,
  D1_DEC: 89,
  D2_DEC: 87,
  D3_DEC: 85,
  OD: 84,
  OD_DEC: 83,
  ID: 82,
  ID_DEC: 81,
  GA: 80,
  SCH: 78,
  LEN: 76,
  GRADE: 70,
  MATERIAL: 68,
  CATEGORY: 66,
  FEATURE: 60,
  FRAC: 58,
  FRAC_DEC: 57,
  PN_WORD: 50,
  PN_NUM: 48,
  PN_ALL: 45,
  WORD: 30
};

export const splitToken = (tok: string): [string, string] => {
  const i = tok.indexOf(":");
  return i === -1 ? ["", tok] : [tok.slice(0, i), tok.slice(i + 1)];
};

export interface TypedToken {
  type: string;
  value: string;
  origin?: string;
  confidence?: number;
}

export interface FacetSuggestion {
  value: string;
  count: number;
  confidence?: number;
  origin?: string;
}

export interface FacetSearchResult {
  selected: string[];
  count: number;
  parts: Array<{
    part_id: number;
    part_number: string;
    part_description: string;
  }>;
  suggestions: Record<string, string[]>;
  order: string[];
}

// Helper function to get token display name
export function getTokenDisplayName(token: string): string {
  const [type, value] = splitToken(token);
  
  // Format specific token types for better display
  switch (type) {
    case 'SIZE4':
    case 'SIZE3':
    case 'SIZE2':
      return `${value} (${type})`;
    case 'D1':
    case 'D2':
    case 'D3':
      return `Dimension ${type.slice(1)}: ${value}`;
    case 'D1_DEC':
    case 'D2_DEC':
    case 'D3_DEC':
      return `Dimension ${type.slice(1, -4)}: ${value}`;
    case 'OD':
    case 'ID':
      return `${type}: ${value}`;
    case 'OD_DEC':
    case 'ID_DEC':
      return `${type.slice(0, -4)}: ${value}`;
    case 'GA':
      return `Gauge ${value}`;
    case 'SCH':
      return `Schedule ${value}`;
    case 'LEN':
      return `Length ${value}`;
    case 'FRAC':
      return `Fraction ${value}`;
    case 'FRAC_DEC':
      return `Decimal ${value}`;
    case 'PN_WORD':
      return `Word: ${value}`;
    case 'PN_NUM':
      return `Number: ${value}`;
    case 'PN_ALL':
      return `Part: ${value}`;
    case 'WORD':
      return value;
    default:
      return value;
  }
}
