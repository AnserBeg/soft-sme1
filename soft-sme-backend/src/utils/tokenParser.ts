export type TypedToken = { 
  type: string; 
  value: string; 
  origin?: string; 
  confidence?: number; 
};

// Enhanced token types based on your database schema
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

// Token type weights for ranking (matching your database)
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

// Facet order for UI display
export const FACET_ORDER = [
  'CATEGORY', 'MATERIAL', 'GRADE', 
  'SIZE4', 'SIZE3', 'SIZE2', 'D1', 'D2', 'D3',
  'OD', 'ID', 'GA', 'SCH', 'LEN', 
  'FEATURE', 'FRAC', 'FRAC_DEC',
  'PN_WORD', 'PN_NUM', 'PN_ALL', 'WORD'
];

// Legacy functions for backward compatibility
export function parseTokensFromPN(pn?: string): TypedToken[] {
  if (!pn) return [];
  let s = pn.toUpperCase().replace(/×/g,"X").replace(/\s+/g,"").replace(/-+/g,"");
  const out: TypedToken[] = [];
  const add = (type:string, value:string) => { 
    if (type && value) out.push({
      type, 
      value, 
      origin: 'PN',
      confidence: TOKEN_WEIGHTS[type] || 50
    }); 
  };

  // FRACTIONS
  const frRe = /\(?(\d+\/\d+)\)?/g;
  for (const m of s.matchAll(frRe)) {
    const f = m[1];
    add("FRAC", f);
    const dec = toDec(f); if (dec) add("FRAC_DEC", dec);
  }

  // OD/ID
  for (const m of s.matchAll(/(OD|ID)\s*(\d+(?:\.\d+)?|\(?\d+\/\d+\)?)/g)) {
    const unit = m[1];
    const raw = m[2].replace(/[()]/g,"");
    const dec = raw.includes("/") ? (toDec(raw) ?? raw) : raw;
    add(unit, dec);
  }

  // GAUGE
  const ga = s.match(/(\d{1,2})\s*GA/);
  if (ga) add("GA", ga[1]);

  // SCHEDULE
  const sch = s.match(/SCH\s*(\d{1,3})/);
  if (sch) add("SCH", sch[1]);

  // LENGTH
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(FT|'|IN|")/g)) {
    const n = m[1], u = m[2];
    add("LEN", (u==="FT"||u==="'") ? `${n}FT` : `${n}IN`);
  }

  // X-separated dims
  if (s.includes("X")) {
    const seg = s.split("X").filter(Boolean);
    if (seg.length >= 2 && seg.length <= 4) {
      const clean = seg.map(x=> x.replace(/[()]/g,""));
      add(`SIZE${clean.length}`, clean.join("X"));
      add("SIZE2", clean.slice(0,2).join("X"));
      clean.slice(0,3).forEach((d,i)=> {
        add(`D${i+1}`, d);
        // Add decimal versions for fractions
        if (d.includes("/")) {
          const dec = toDec(d);
          if (dec) add(`D${i+1}_DEC`, dec);
        }
      });
    }
  }
  return dedupe(out);
}

export function parseTokensFromDesc(text?: string): TypedToken[] {
  if (!text) return [];
  const words = (text.toUpperCase().match(/[A-Z0-9]+/g) || []).filter(w=>w.length>=2);
  const uniq = new Set(words.map(normWord));
  const out: TypedToken[] = [];
  for (const w of uniq) {
    if (SHAPES.has(w)) out.push({type:"CATEGORY", value:w, origin: 'DESC', confidence: TOKEN_WEIGHTS.CATEGORY});
    if (MATERIALS.has(w)) out.push({type:"MATERIAL", value:w, origin: 'DESC', confidence: TOKEN_WEIGHTS.MATERIAL});
    if (GRADES.has(w)) out.push({type:"GRADE", value:w, origin: 'DESC', confidence: TOKEN_WEIGHTS.GRADE});
    if (FEATURE_WORDS.has(w)) out.push({type:"FEATURE", value:w, origin: 'DESC', confidence: TOKEN_WEIGHTS.FEATURE});
  }
  return dedupe(out);
}

export function parseTypedTokensForPart(pn?: string, desc?: string): TypedToken[] {
  return dedupe([...parseTokensFromPN(pn), ...parseTokensFromDesc(desc)]);
}

function dedupe(arr: TypedToken[]): TypedToken[] {
  const seen = new Set<string>();
  return arr.filter(t => {
    const key = `${t.type}:${t.value}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// Helper functions
const SYN: Record<string,string> = {
  SS:"STAINLESS", STAIN:"STAINLESS", STAINLESS:"STAINLESS",
  AL:"ALUMINUM", ALUM:"ALUMINUM",
  GALV:"GALVANIZED", GALVANIZED:"GALVANIZED",
  SQ:"SQUARE", RECT:"RECTANGULAR", TUBE:"TUBING",
  CRS:"CARBON", CS:"CARBON", MS:"MILD", PL:"PLATE"
};

const SHAPES = new Set(["TUBING","PIPE","ANGLE","BAR","FLAT","BEAM","CHANNEL","SHEET","PLATE","ROUND","SQUARE","RECTANGULAR"]);
const MATERIALS = new Set(["STAINLESS","ALUMINUM","GALVANIZED","CARBON","STEEL","MILD","BRASS","COPPER"]);
const GRADES = new Set(["304","316","A36","A500","6061","6063","G40","1018","1020"]);
const FEATURE_WORDS = new Set(["THREADED","HITCH","AXLE","ZINC","HOTDIP","HOT-DIP","BLACK","PICKLED","OIL","ANNEALED","NPT","UNC","UNF","THREAD","THD"]);

const normWord = (w: string) => SYN[w] || w;
const toDec = (frac: string): string | null => {
  const [a,b] = frac.split("/");
  const A = Number(a), B = Number(b);
  if (!A || !B) return null;
  return (A/B).toFixed(4).replace(/0+$/,"").replace(/\.$/,"");
};
