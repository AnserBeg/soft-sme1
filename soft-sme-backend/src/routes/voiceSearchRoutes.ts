import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db'; // ASSUMPTION: ../db exports a pg.Pool named `pool`

/* ===========================
   SYNONYMS (shapes/materials)
   =========================== */
const SHAPE_SYNONYMS: Record<string, string[]> = {
  TUBING: ['TUBING', 'TUBE', 'PIPE'],
  ANGLE: ['ANGLE', 'L-BRACKET', 'BRACKET'],
  PLATE: ['PLATE', 'SHEET'],
  ROUND: ['ROUND', 'CIRCULAR'],
  SQUARE: ['SQUARE', 'SQ'],
  RECTANGULAR: ['RECTANGULAR', 'RECT'],
  CHANNEL: ['CHANNEL'],
  BEAM: ['BEAM'],
  BAR: ['BAR', 'FLAT BAR', 'FLAT'],
  ROD: ['ROD'],
};

const MATERIAL_SYNONYMS: Record<string, string[]> = {
  STEEL: ['STEEL'],
  ALUMINUM: ['ALUMINUM', 'ALUM', 'AL'],
  BRASS: ['BRASS'],
  COPPER: ['COPPER'],
  BRONZE: ['BRONZE'],
  GALVANIZED: ['GALV', 'GALVANIZED'],
  A36: ['A36'],
  CR: ['CR', 'COLD ROLL'],
  HR: ['HR', 'HOT ROLL'],
  // NOTE: Intentionally do NOT map "SS" to STEEL to avoid stainless collisions.
};

const SHAPE_KEYS = Object.keys(SHAPE_SYNONYMS);
const MATERIAL_KEYS = Object.keys(MATERIAL_SYNONYMS);

function isShapeTerm(term: string): boolean {
  const U = term.toUpperCase();
  return SHAPE_KEYS.some(k => SHAPE_SYNONYMS[k].includes(U) || k === U);
}
function isMaterialTerm(term: string): boolean {
  const U = term.toUpperCase();
  return MATERIAL_KEYS.some(k => MATERIAL_SYNONYMS[k].includes(U) || k === U);
}

/* ===========================
   DIMENSION / FRACTION UTILS
   =========================== */
// Regexes
const DEC = /\b\d+\.\d+\b/gi;
const FRAC_ANY = /\(?\d+\s*\/\s*\d+\)?/gi;                 // 3/16 or (3/16)
const PN_PIECE = String.raw`(?:\d+|\(\d+\/\d+\))`;         // strict PN piece
const PN_X = new RegExp(String.raw`\b${PN_PIECE}(?:X${PN_PIECE}){1,5}\b`, "i");

// tolerant text piece: decimal | bare frac | paren frac | mixed number
const TXT_PIECE = String.raw`(?:\d+(?:\.\d+)?|\(?\d+\/\d+\)?|\d+\s+\d+\s*\/\s*\d+)`;
const TXT_X = new RegExp(String.raw`\b${TXT_PIECE}(?:\s*[Xx×]\s*${TXT_PIECE}){1,5}\b`, "i");

// Fraction helpers
const FRACTION_BARE = /(?<!\()(\d+)\s*\/\s*(\d+)(?!\))/g; // 3/16 not inside ()
const FRACTION_PAREN = /\((\d+)\s*\/\s*(\d+)\)/g;

function addParensToFractions(s: string): string {
  return (s || "").replace(FRACTION_BARE, "($1/$2)");
}
function removeParensFromFractions(s: string): string {
  return (s || "").replace(FRACTION_PAREN, "$1/$2");
}
function stripSpacesAndUpperX(s: string): string {
  return (s || "").toUpperCase().replace(/\s+/g, "").replace(/×/g, "X");
}

function fracToDecimal(raw: string): number | null {
  const s = raw.replace(/[()]/g, "").trim();
  // mixed number? (e.g., "2 1/2")
  const mix = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mix) { const w=+mix[1], n=+mix[2], d=+mix[3]; return d ? w + n/d : null; }
  // simple fraction
  const f = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) { const n=+f[1], d=+f[2]; return d ? n/d : null; }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// Strict parser for part numbers (no spaces, X, fractions in ())
function tokensFromPartNumber(partNumber: string): string[] {
  const S = stripSpacesAndUpperX(partNumber);
  const out = new Set<string>();

  const xMatch = S.match(PN_X);
  if (xMatch) {
    const raw = xMatch[0];                // e.g., 2X2X(3/16)
    out.add(raw);

    const noParens = removeParensFromFractions(raw); // 2X2X3/16
    out.add(noParens);

    const parts = raw.split("X");
    const decParts = parts.map(p => {
      const dec = fracToDecimal(p);
      return dec !== null ? dec.toString() : p; // integers stay integers
    });
    if (decParts.every(p => /^\d+(\.\d+)?$/.test(p))) out.add(decParts.join("X"));

    if (parts.length >= 2) out.add([parts[0], parts[1]].join("X"));
  }

  // isolated thickness aliases
  const allFracs = S.match(FRAC_ANY) || [];
  for (const f of allFracs) {
    out.add(f);                                // (3/16)
    out.add(removeParensFromFractions(f));     // 3/16
    const d = fracToDecimal(f);
    if (d !== null) out.add(d.toString());     // 0.1875
  }
  return Array.from(out);
}

// Tolerant parser for free text (spaces, 'by'/x/×, mixed numbers, bare/paren fractions)
function tokensFromText(text: string): string[] {
  const U = (text || "").toUpperCase();
  const out = new Set<string>();

  const xMatch = U.match(TXT_X);
  if (xMatch) {
    const raw = xMatch[0].toUpperCase().replace(/\s+/g, "").replace(/[×x]/g, "X"); // 2X2X3/16
    out.add(raw);
    out.add(addParensToFractions(raw));               // 2X2X(3/16)

    const parts = raw.split("X");
    const decParts = parts.map(p => {
      const d = fracToDecimal(p);
      return d !== null ? d.toString() : p;
    });
    if (decParts.every(p => /^\d+(\.\d+)?$/.test(p))) out.add(decParts.join("X"));
    if (parts.length >= 2) out.add([parts[0], parts[1]].join("X")); // 2X2
  }

  // fractions → add bare, paren, decimal
  for (const m of U.match(FRAC_ANY) || []) {
    const bare = removeParensFromFractions(m);   // 3/16
    out.add(bare);
    out.add(addParensToFractions(bare));         // (3/16)
    const d = fracToDecimal(bare);
    if (d !== null) out.add(d.toString());       // 0.1875
  }

  // decimals
  for (const d of U.match(DEC) || []) out.add(d);

  // word-based fractions (e.g., "quarter", "half", "three quarters", "one eighth")
  const addWordFraction = (numerator: number, denominator: number) => {
    const bare = `${numerator}/${denominator}`;
    out.add(bare);
    out.add(addParensToFractions(bare));
    const dec = numerator / denominator;
    if (Number.isFinite(dec)) out.add(dec.toString());
  };

  // Simple common phrases
  if (/(^|\b)HALF(\b|$)/i.test(U)) addWordFraction(1, 2);
  if (/(^|\b)QUARTER(S)?(\b|$)/i.test(U)) addWordFraction(1, 4);
  if (/THREE\s+QUARTER(S)?/i.test(U)) addWordFraction(3, 4);

  // Eighths
  if (/(^|\b)(ONE|AN)\s+EIGHTH(S)?(\b|$)/i.test(U)) addWordFraction(1, 8);
  if (/THREE\s+EIGHTH(S)?/i.test(U)) addWordFraction(3, 8);
  if (/FIVE\s+EIGHTH(S)?/i.test(U)) addWordFraction(5, 8);
  if (/SEVEN\s+EIGHTH(S)?/i.test(U)) addWordFraction(7, 8);

  // Sixteenths (common ones)
  if (/(^|\b)(ONE|AN)\s+SIXTEENTH(S)?(\b|$)/i.test(U)) addWordFraction(1, 16);
  if (/THREE\s+SIXTEENTH(S)?/i.test(U)) addWordFraction(3, 16);

  return Array.from(out);
}

// Field-aware expansion for SQL
function variantsForField(token: string, field: "part_number" | "part_description"): string[] {
  const U = stripSpacesAndUpperX(token);

  if (field === "part_number") {
    // Strict: ensure () for fractions and no spaces
    const pnLike = addParensToFractions(U);
    return [pnLike];
  }
  // Description: allow bare + decimal + raw
  const variants = new Set<string>();
  const bare = removeParensFromFractions(U);
  variants.add(bare);                 // 2X2X3/16 or 3/16
  variants.add(U);                    // as-is too
  const d = fracToDecimal(bare);
  if (d !== null) variants.add(d.toString()); // 0.1875
  return Array.from(variants);
}

/* ===========================
   LEXICON (inventory-based)
   =========================== */
type Lexicon = {
  shapes: Set<string>;
  materials: Set<string>;
  dimAliasSet: Set<string>;       // "2X2X(3/16)", "2X2X3/16", "2X2X0.1875", "3/16", "0.1875", "2X2"
  frequency: Map<string, number>; // token -> frequency across inventory
  decimals: number[];             // numeric values seen (for nearest snapping)
};

async function buildLexiconFromDB(): Promise<Lexicon> {
  const res = await pool.query(`
    SELECT part_number, part_description
    FROM inventory
    WHERE COALESCE(part_number,'') <> '' OR COALESCE(part_description,'') <> ''
  `);

  const shapes = new Set<string>();
  const materials = new Set<string>();
  const dimAliasSet = new Set<string>();
  const frequency = new Map<string, number>();
  const decimals: number[] = [];

  const SHAPE_CUES = new Set(
    Object.values(SHAPE_SYNONYMS).flat().map(s => s.toUpperCase()).concat(Object.keys(SHAPE_SYNONYMS))
  );
  const MAT_CUES = new Set(
    Object.values(MATERIAL_SYNONYMS).flat().map(s => s.toUpperCase()).concat(Object.keys(MATERIAL_SYNONYMS))
  );

  const bump = (tok: string) => {
    const t = tok.toUpperCase();
    frequency.set(t, (frequency.get(t) || 0) + 1);
  };

  for (const row of res.rows) {
    const pn = (row.part_number || "").toString().toUpperCase();
    const desc = (row.part_description || "").toString().toUpperCase();
    const combined = `${pn} ${desc}`;

    // shapes/materials seen
    for (const word of SHAPE_CUES) if (combined.includes(word)) { shapes.add(word); bump(word); }
    for (const word of MAT_CUES)   if (combined.includes(word)) { materials.add(word); bump(word); }

    // dimension aliases from both fields
    for (const t of tokensFromPartNumber(pn)) { dimAliasSet.add(t.toUpperCase()); bump(t); }
    for (const t of tokensFromText(desc))     { dimAliasSet.add(t.toUpperCase()); bump(t); }

    // numeric decimals help nearest snapping
    const decs = combined.match(/\b\d+\.\d+\b/g) || [];
    for (const d of decs) {
      const v = Number(d);
      if (Number.isFinite(v)) decimals.push(v);
    }
  }

  const uniqDec = Array.from(new Set(decimals)).sort((a,b)=>a-b);
  return { shapes, materials, dimAliasSet, frequency, decimals: uniqDec };
}

/* ===========================
   SNAP-TO-INVENTORY
   =========================== */
type SnapResult = {
  original: string;
  snapped: string;            // chosen replacement (or original if unchanged)
  alternatives: string[];     // other good candidates (sorted best→worse)
  reason: string;             // short explanation for UI/logs
  changed: boolean;
};

function nearestNumeric(target: number, candidates: number[]): number | null {
  if (!candidates.length || !Number.isFinite(target)) return null;
  let best = candidates[0], bestD = Math.abs(candidates[0] - target);
  for (let i=1;i<candidates.length;i++) {
    const d = Math.abs(candidates[i]-target);
    if (d < bestD) { best = candidates[i]; bestD = d; }
  }
  return best;
}

function snapTokenToInventory(tok: string, L: Lexicon): SnapResult {
  const U = stripSpacesAndUpperX(tok);
  const originalUpper = tok.toUpperCase();
  console.log('🎯 Snapping token:', { original: tok, normalized: U, originalUpper });

  // Check exact matches first (both normalized and original)
  if (L.dimAliasSet.has(U) || L.shapes.has(U) || L.materials.has(U)) {
    console.log('🎯 Exact match found for:', U);
    return { original: tok, snapped: U, alternatives: [], reason: "exact match", changed: false };
  }
  
  // For multi-word terms, also check the original (with spaces)
  if (L.dimAliasSet.has(originalUpper) || L.shapes.has(originalUpper) || L.materials.has(originalUpper)) {
    console.log('🎯 Exact match found for original:', originalUpper);
    return { original: tok, snapped: originalUpper, alternatives: [], reason: "exact match (original)", changed: false };
  }

  const alts = new Set<string>();

  // 1) punctuation/format rescue (paren/bare)
  const bare = removeParensFromFractions(U);     // 2X2X3/16
  const paren = addParensToFractions(U);         // 2X2X(3/16)
  [bare, paren].forEach(v => { if (L.dimAliasSet.has(v)) alts.add(v); });

  // ASR compression (e.g., 316 → 3/16)
  const shortFrac = U.match(/^(\d{1,2})16$/) ? `${U[0]}/${U.slice(1)}` : null;
  if (shortFrac) {
    const b = removeParensFromFractions(shortFrac);
    const p = addParensToFractions(shortFrac);
    [b,p].forEach(v => { if (L.dimAliasSet.has(v)) alts.add(v); });
  }

  // 2) numeric rescue - ONLY if the original token looks numeric
  if (/^\d+\.?\d*$/.test(bare) || /^\d+\/\d+$/.test(bare) || /^\(\d+\/\d+\)$/.test(bare)) {
    const numStr = bare.replace(/[^0-9.]/g, "");
    const numeric = Number(numStr);
    if (Number.isFinite(numeric)) {
      const nearest = nearestNumeric(numeric, L.decimals);
      if (nearest != null) {
        alts.add(nearest.toString()); // decimal variant
        // try to find any alias in lexicon that includes this decimal
        for (const a of L.dimAliasSet) {
          if (a.includes(nearest.toString())) alts.add(a);
        }
      }
    }
  }

  // 3) frequency-weighted pick
  const scored = Array.from(alts).map(a => [a, L.frequency.get(a.toUpperCase()) || 0] as const)
                       .sort((x,y) => y[1]-x[1]);

  if (scored.length) {
    console.log('🎯 Found alternatives for', tok, ':', scored.map(([term, freq]) => `${term}(${freq})`));
    return {
      original: tok,
      snapped: scored[0][0],
      alternatives: scored.slice(1).map(x => x[0]),
      reason: "nearest in inventory by format/decimal/frequency",
      changed: true
    };
  }

  // 4) no good candidate → keep original (fuzzy search may still hit)
  console.log('🎯 No alternatives found for', tok, '- keeping original');
  return { original: tok, snapped: U, alternatives: [], reason: "no close inventory match", changed: false };
}

/* ===========================
   MISC HELPERS
   =========================== */
const router = express.Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const AI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';

let LEXICON: Lexicon | null = null;
(async () => {
  try {
    console.log('📚 Building lexicon from database...');
    LEXICON = await buildLexiconFromDB();
    console.log('✅ Lexicon built successfully:', {
      shapes: LEXICON.shapes.size,
      materials: LEXICON.materials.size,
      dimAliases: LEXICON.dimAliasSet.size,
      decimals: LEXICON.decimals.length
    });
    console.log('📚 Sample shapes found:', Array.from(LEXICON.shapes).slice(0, 5));
    console.log('📚 Sample materials found:', Array.from(LEXICON.materials).slice(0, 5));
    console.log('📚 Sample dimension aliases:', Array.from(LEXICON.dimAliasSet).slice(0, 5));
  } catch (e) {
    console.error('❌ Failed to build lexicon:', e);
  }
})();

function ensureLexicon(): void {
  if (!LEXICON) throw new Error('Lexicon not initialized yet');
}
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

function parseGeminiJsonSafe(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return null;
}

function splitMustShould(terms: string[]) {
  const MUST: string[] = [];
  const SHOULD: string[] = [];
  for (const t of terms) {
    const U = t.toUpperCase();
    if (isShapeTerm(U)) MUST.push(U);
    else if (U.includes('X') || U.includes('/')) MUST.push(U);  // dimensions are MUST
    else SHOULD.push(U); // materials/specs are SHOULD
  }
  return { MUST: uniq(MUST), SHOULD: uniq(SHOULD) };
}

/* ===========================
   ROUTES
   =========================== */
// Health check
router.get('/test', (_req, res) => {
  res.json({
    message: 'Voice search routes are working',
    model: AI_MODEL,
    hasApiKey: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// Voice (placeholder)
router.post('/search-parts', (req, res) => {
  const { audioData } = req.body || {};
  console.log('🎤 Voice search endpoint hit - Audio data received');
  console.log('🎤 Audio data length:', audioData ? audioData.length : 0);
  
  if (!audioData) return res.status(400).json({ error: 'Audio data is required' });

  const payloadSize = Buffer.byteLength(audioData, 'base64');
  const maxSize = 5 * 1024 * 1024;
  console.log('🎤 Audio payload size:', `${(payloadSize/1024).toFixed(2)}KB`);
  
  if (payloadSize > maxSize) {
    console.log('❌ Audio data too large:', `${(payloadSize/1024/1024).toFixed(2)}MB`);
    return res.status(413).json({ error: `Audio data too large (${(payloadSize/1024/1024).toFixed(2)}MB). Please record a shorter message.` });
  }

  console.log('🎤 Voice search not implemented - returning fallback response');
  return res.json({
    searchTerms: ["VOICE","SEARCH","NOT","AVAILABLE"],
    confidence: 0.1,
    originalQuery: "Audio processing not available - please use text search"
  });
});

// Interpret query via Gemini → augment with local tokens → snap to inventory
router.post('/interpret-query', async (req, res) => {
  try {
    const { query } = req.body || {};
    console.log('🤖 Interpret query endpoint hit');
    console.log('🤖 Raw user query:', query);
    
    if (!query) return res.status(400).json({ error: 'Query is required' });
    if (!process.env.GEMINI_API_KEY) {
      console.log('❌ No Gemini API key configured');
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }
    
    console.log('🤖 Using AI model:', AI_MODEL);
    const model = genAI.getGenerativeModel({ model: AI_MODEL });

    const prompt = `
You are an AI that extracts search tokens for a metal inventory.
Rules:
- Remove filler words; focus on shapes, materials, dimensions, specs.
- Convert spoken dimensions to "X" forms (e.g., "2 by 2 by 3/16" -> "2X2X3/16").
- Include both fractions and decimal equivalents when applicable.
- Use PRIMARY synonyms only:
  TUBING/TUBE/PIPE -> TUBING
  ANGLE/L-BRACKET/BRACKET -> ANGLE
  PLATE/SHEET -> PLATE
  ROUND/CIRCULAR -> ROUND
  SQUARE/SQ -> SQUARE
  RECTANGULAR/RECT -> RECTANGULAR
  ALUMINUM/AL/ALUM -> ALUMINUM
  GALVANIZED/GALV -> GALVANIZED
- CRITICAL: Only extract terms that are EXPLICITLY mentioned in the query
- DO NOT infer shapes from dimensions (e.g., don't assume "12 by 8" means rectangular)
- DO NOT add terms that aren't directly stated by the user
- IMPORTANT: Return JSON only, no prose.

Output JSON:
{
  "query": string,
  "searchInPartNumbers": boolean,
  "searchInDescriptions": boolean,
  "extractedTerms": string[],
  "reasoning": string
}

User Query: "${query}"
`.trim();

    console.log('🤖 Sending prompt to Gemini AI...');
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log('🤖 Raw AI response:', text);
    
    const parsed = parseGeminiJsonSafe(text);
    console.log('🤖 Parsed AI response:', parsed);

    const ai = parsed && parsed.extractedTerms && Array.isArray(parsed.extractedTerms)
      ? parsed
      : {
          query,
          searchInPartNumbers: true,
          searchInDescriptions: true,
          extractedTerms: [stripSpacesAndUpperX(query)],
          reasoning: 'Fallback: unparsed model response'
        };

    console.log('🤖 AI extracted terms:', ai.extractedTerms);
    console.log('🤖 AI reasoning:', ai.reasoning);

    // Augment with local tolerant dimension tokens
    console.log('🔧 Generating local dimension tokens...');
    const localDims = tokensFromText(query);
    console.log('🔧 Local dimension tokens:', localDims);
    
    // Combine AI terms with local terms, but preserve original AI terms as-is
    const allTerms = [...(ai.extractedTerms || []), ...localDims];
    console.log('🔧 All terms before processing:', allTerms);
    
    // Process AI terms (keep original spacing) and local terms (normalize)
    const extractedTerms: string[] = uniq([
      ...(ai.extractedTerms || []), // Keep AI terms as-is (preserves "AIR TANK", "MULTIPORT")
      ...localDims.map(stripSpacesAndUpperX) // Normalize local dimension tokens
    ]);
    console.log('🔧 Combined extracted terms:', extractedTerms);

    // Snap to inventory
    console.log('🎯 Snapping terms to inventory lexicon...');
    ensureLexicon();
    const snapResults: SnapResult[] = extractedTerms.map(t => snapTokenToInventory(t, LEXICON!));
    console.log('🎯 Snap results:', snapResults);
    
    const snappedTerms = uniq(snapResults.map(s => s.snapped));
    console.log('🎯 Final snapped terms:', snappedTerms);

    const response = {
      query,
      searchInPartNumbers: ai.searchInPartNumbers !== false,
      searchInDescriptions: ai.searchInDescriptions !== false,
      extractedTerms,
      snappedTerms,
      snappingNotes: snapResults.filter(s => s.changed).map(s => ({ from: s.original, to: s.snapped, reason: s.reason })),
      reasoning: ai.reasoning || 'Tokens augmented by local dimension parser and inventory snapping'
    };
    
    console.log('✅ Final response:', response);
    res.json(response);

  } catch (error) {
    console.error('💥 Error interpreting query:', error);
    if (error instanceof Error) console.error(error.stack);
    res.status(500).json({ error: 'Failed to interpret query' });
  }
});

// Shared search executor (MUST/SHOULD + field-aware variants + backoff)
async function executeInventorySearch(opts: {
  terms: string[],
  searchInPartNumbers: boolean,
  searchInDescriptions: boolean
}) {
  const { terms, searchInPartNumbers, searchInDescriptions } = opts;

  console.log('🔍 Execute inventory search called with:', { terms, searchInPartNumbers, searchInDescriptions });
  ensureLexicon();

  // Snap terms first
  console.log('🎯 Snapping search terms to inventory...');
  const snapped = uniq(terms.map(String).map(t => snapTokenToInventory(t, LEXICON!).snapped));
  console.log('🎯 Snapped terms:', snapped);

  // MUST/SHOULD split - make dimensions more flexible
  const MUST: string[] = [];
  const SHOULD: string[] = [];
  for (const t of snapped) {
    const U = t.toUpperCase();
    if (isShapeTerm(U)) {
      MUST.push(U); // Shapes are always MUST
    } else if (U.includes('X') || U.includes('/')) {
      // Dimensions can be SHOULD if they're very specific (like 3X1/4)
      // but basic fractions (like 1/4) can be SHOULD
      if (U.includes('X') && U.split('X').length > 1) {
        SHOULD.push(U); // Multi-part dimensions like 3X1/4 are SHOULD
      } else {
        SHOULD.push(U); // Basic fractions like 1/4 are SHOULD
      }
    } else {
      SHOULD.push(U); // Materials/specs are SHOULD
    }
  }
  
  console.log('🔍 MUST terms (shapes/dimensions):', MUST);
  console.log('🔍 SHOULD terms (materials/specs):', SHOULD);

  // inner function to build/run SQL
  const run = async (must: string[], should: string[]) => {
    console.log('🔍 Building SQL query for:', { must, should });
    
    let sql = `
      SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand
      FROM inventory
      WHERE 1=1
    `;
    const params: string[] = [];
    let idx = 1;

    // Build MUST conditions (shapes/dimensions - these are required)
    for (const t of must) {
      const pieces: string[] = [];
      console.log('🔍 Processing MUST term:', t);
      
      if (searchInPartNumbers) {
        const vPN = variantsForField(t, "part_number");
        console.log('🔍 Part number variants for', t, ':', vPN);
        if (vPN.length) {
          pieces.push(`(${vPN.map(() => `(part_number ILIKE $${idx++})`).join(" OR ")})`);
          vPN.forEach(v => params.push(`%${v}%`));
        }
      }
      if (searchInDescriptions) {
        const vPD = variantsForField(t, "part_description");
        console.log('🔍 Description variants for', t, ':', vPD);
        if (vPD.length) {
          // For multi-word terms, try multiple matching strategies
          let allVariants = [...vPD];
          
          if (t.includes(' ')) {
            // Multi-word term: try original, no-spaces, and individual words
            const noSpaces = t.replace(/\s+/g, '');
            const individualWords = t.split(/\s+/).filter(w => w.length > 1);
            
            allVariants.push(t, noSpaces, ...individualWords);
            console.log('🔍 Multi-word variants for', t, ':', { original: t, noSpaces, individualWords });
          }
          
          allVariants = [...new Set(allVariants)];
          console.log('🔍 All description variants for', t, ':', allVariants);
          
          pieces.push(`(${allVariants.map(() => `(part_description ILIKE $${idx++})`).join(" OR ")})`);
          allVariants.forEach(v => params.push(`%${v}%`));
        }
      }
      if (pieces.length) {
        sql += ` AND (${pieces.join(" OR ")})`;
        console.log('🔍 Added MUST condition for', t, ':', pieces.join(" OR "));
      } else {
        console.log('⚠️ No variants found for MUST term:', t, '- this will cause no results!');
      }
    }

    // Build SHOULD conditions (materials/specs - these are optional but help narrow results)
    if (should.length > 0) {
      const shouldPieces: string[] = [];
      console.log('🔍 Building SHOULD conditions for:', should);
      
      for (const t of should) {
        if (searchInPartNumbers) {
          const vPN = variantsForField(t, "part_number");
          if (vPN.length) {
            shouldPieces.push(`(${vPN.map(() => `(part_number ILIKE $${idx++})`).join(" OR ")})`);
            vPN.forEach(v => params.push(`%${v}%`));
          }
        }
        if (searchInDescriptions) {
          const vPD = variantsForField(t, "part_description");
          if (vPD.length) {
            shouldPieces.push(`(${vPD.map(() => `(part_description ILIKE $${idx++})`).join(" OR ")})`);
            vPD.forEach(v => params.push(`%${v}%`));
          }
        }
      }
      if (shouldPieces.length) {
        sql += ` AND ( ${shouldPieces.join(" OR ")} )`;
        console.log('🔍 Added SHOULD conditions:', shouldPieces.join(" OR "));
      }
    }

    sql += ` ORDER BY part_number LIMIT 200`;

    console.log('🔍 Final SQL query:', sql);
    console.log('🔍 SQL parameters:', params);

    const result = await pool.query(sql, params);
    console.log('🔍 Database returned', result.rows.length, 'rows');
    
    // Log a few sample results to see what we're getting
    if (result.rows.length > 0) {
      console.log('🔍 Sample results:');
      result.rows.slice(0, 3).forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.part_number}: ${row.part_description}`);
      });
    }
    
    return { sql, params, rows: result.rows, snapped, MUST, SHOULD };
  };

  // Try with MUST+SHOULD, then backoff to MUST-only (but only if we have MUST terms)
  console.log('🔍 Attempting search with MUST+SHOULD terms...');
  let attempt = await run(MUST, SHOULD);
  console.log('🔍 First attempt results:', attempt.rows.length, 'rows');
  
  if (attempt.rows.length === 0 && SHOULD.length > 0 && MUST.length > 0) {
    console.log('🔍 No results found, trying with MUST terms only...');
    attempt = await run(MUST, []);
    console.log('🔍 Second attempt results:', attempt.rows.length, 'rows');
  } else if (attempt.rows.length === 0 && MUST.length === 0) {
    console.log('🔍 No results found and no MUST terms - not falling back to empty search');
  }
  
  console.log('🔍 Final search results:', attempt.rows.length, 'rows');
  return attempt;
}

// Inventory search route
router.post('/search-inventory', async (req, res) => {
  try {
    const {
      searchTerms,
      searchInPartNumbers = true,
      searchInDescriptions = true
    } = req.body || {};

    if (!searchTerms || !Array.isArray(searchTerms)) {
      return res.status(400).json({ error: 'Search terms array is required' });
    }

    const result = await executeInventorySearch({
      terms: searchTerms,
      searchInPartNumbers,
      searchInDescriptions
    });

    res.json({
      parts: result.rows,
      snappedTerms: result.snapped,
      must: result.MUST,
      should: result.SHOULD,
      totalFound: result.rows.length,
      debug: { sql: result.sql, params: result.params }
    });

  } catch (error) {
    console.error('Error searching inventory:', error);
    res.status(500).json({ error: 'Failed to search inventory' });
  }
});

// Direct search route - bypasses token system for natural language queries
router.post('/search-direct', async (req, res) => {
  try {
    const { query } = req.body || {};
    console.log('🔍 Direct search endpoint hit');
    console.log('🔍 Raw query:', query);
    
    if (!query || typeof query !== 'string') {
      console.log('❌ Invalid query received');
      return res.status(400).json({ error: 'Query string is required' });
    }

    console.log('🔍 Executing direct search...');
    
    // Simple, direct search without tokenization or snapping
    const sql = `
      SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand
      FROM inventory 
      WHERE part_number ILIKE $1 OR part_description ILIKE $1
      ORDER BY 
        CASE 
          WHEN part_description ILIKE $1 THEN 1 
          WHEN part_number ILIKE $1 THEN 2 
          ELSE 3 
        END,
        part_number
      LIMIT 100
    `;
    
    const searchTerm = `%${query.toUpperCase()}%`;
    console.log('🔍 Direct SQL query:', sql);
    console.log('🔍 Search term:', searchTerm);
    
    const result = await pool.query(sql, [searchTerm]);
    console.log('🔍 Database returned', result.rows.length, 'rows');
    
    const response = {
      parts: result.rows,
      query: query,
      totalFound: result.rows.length,
      searchStrategy: 'direct_text_search',
      debug: { sql, searchTerm }
    };
    
    console.log('✅ Direct search completed successfully:', {
      totalFound: response.totalFound,
      query: response.query
    });
    
    res.json(response);

  } catch (e) {
    console.error('❌ Error in direct search:', e);
    res.status(500).json({ error: 'Direct search failed' });
  }
});

// Hybrid search route - tries direct search first, falls back to token search if needed
router.post('/search-hybrid', async (req, res) => {
  try {
    const { query, minResults = 5 } = req.body || {};
    console.log('🔍 Hybrid search endpoint hit');
    console.log('🔍 Raw query:', query);
    console.log('🔍 Minimum results threshold:', minResults);
    
    if (!query || typeof query !== 'string') {
      console.log('❌ Invalid query received');
      return res.status(400).json({ error: 'Query string is required' });
    }

    // Step 1: Try direct search first
    console.log('🔍 Step 1: Attempting direct search...');
    const directSql = `
      SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand
      FROM inventory 
      WHERE part_number ILIKE $1 OR part_description ILIKE $1
      ORDER BY 
        CASE 
          WHEN part_description ILIKE $1 THEN 1 
          WHEN part_number ILIKE $1 THEN 2 
          ELSE 3 
        END,
        part_number
      LIMIT 100
    `;
    
    const searchTerm = `%${query.toUpperCase()}%`;
    const directResult = await pool.query(directSql, [searchTerm]);
    console.log('🔍 Direct search returned', directResult.rows.length, 'rows');
    
    // If direct search gives enough results, return them
    if (directResult.rows.length >= minResults) {
      console.log('✅ Direct search successful, returning results');
      const response = {
        parts: directResult.rows,
        query: query,
        totalFound: directResult.rows.length,
        searchStrategy: 'direct_text_search',
        fallbackUsed: false,
        debug: { sql: directSql, searchTerm }
      };
      
      res.json(response);
      return;
    }
    
    // Step 2: Fall back to token-based search if direct search didn't give enough results
    console.log('🔍 Step 2: Direct search returned insufficient results, trying token search...');
    
    // Use the AI to extract tokens from the query
    if (!process.env.GEMINI_API_KEY) {
      console.log('❌ No Gemini API key for token extraction');
      // Return direct search results even if insufficient
      const response = {
        parts: directResult.rows,
        query: query,
        totalFound: directResult.rows.length,
        searchStrategy: 'direct_text_search_insufficient',
        fallbackUsed: false,
        debug: { sql: directSql, searchTerm }
      };
      res.json(response);
      return;
    }
    
    const model = genAI.getGenerativeModel({ model: AI_MODEL });
    const prompt = `
You are an AI that extracts search tokens for a metal inventory.
Rules:
- Remove filler words; focus on shapes, materials, dimensions, specs.
- Convert spoken dimensions to "X" forms (e.g., "2 by 2 by 3/16" -> "2X2X3/16").
- Include both fractions and decimal equivalents when applicable.
- Use PRIMARY synonyms only:
  TUBING/TUBE/PIPE -> TUBING
  ANGLE/L-BRACKET/BRACKET -> ANGLE
  PLATE/SHEET -> PLATE
  ROUND/CIRCULAR -> ROUND
  SQUARE/SQ -> SQUARE
  RECTANGULAR/RECT -> RECTANGULAR
  ALUMINUM/AL/ALUM -> ALUMINUM
  GALVANIZED/GALV -> GALVANIZED
- CRITICAL: Only extract terms that are EXPLICITLY mentioned in the query
- DO NOT infer shapes from dimensions (e.g., don't assume "12 by 8" means rectangular)
- DO NOT add terms that aren't directly stated by the user
- IMPORTANT: Return JSON only, no prose.

Output JSON:
{
  "extractedTerms": string[]
}

User Query: "${query}"
`.trim();

    const aiResult = await model.generateContent(prompt);
    const aiText = aiResult.response.text();
    const aiParsed = parseGeminiJsonSafe(aiText);
    
    let extractedTerms: string[] = [];
    if (aiParsed && aiParsed.extractedTerms && Array.isArray(aiParsed.extractedTerms)) {
      extractedTerms = aiParsed.extractedTerms;
      console.log('🤖 AI extracted terms for fallback:', extractedTerms);
    } else {
      // Fallback: use the original query as a single term
      extractedTerms = [query.toUpperCase()];
      console.log('🤖 Using fallback terms:', extractedTerms);
    }
    
    // Execute token-based search
    const tokenResult = await executeInventorySearch({
      terms: extractedTerms,
      searchInPartNumbers: true,
      searchInDescriptions: true
    });
    
    console.log('🔍 Token search returned', tokenResult.rows.length, 'rows');
    
    const response = {
      parts: tokenResult.rows,
      query: query,
      totalFound: tokenResult.rows.length,
      searchStrategy: 'token_based_fallback',
      fallbackUsed: true,
      directSearchResults: directResult.rows.length,
      extractedTerms: extractedTerms,
      snappedTerms: tokenResult.snapped,
      must: tokenResult.MUST,
      should: tokenResult.SHOULD,
      debug: { 
        directSql, 
        searchTerm, 
        tokenSql: tokenResult.sql, 
        tokenParams: tokenResult.params 
      }
    };
    
    console.log('✅ Hybrid search completed successfully:', {
      totalFound: response.totalFound,
      fallbackUsed: response.fallbackUsed,
      directResults: response.directSearchResults
    });
    
    res.json(response);

  } catch (e) {
    console.error('❌ Error in hybrid search:', e);
    res.status(500).json({ error: 'Hybrid search failed' });
  }
});

// Token-based search (compatible with earlier API)
router.post('/search-by-tokens', async (req, res) => {
  try {
    const { tokens } = req.body || {};
    console.log('🔍 Search-by-tokens endpoint hit');
    console.log('🔍 Received tokens:', tokens);
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      console.log('❌ Invalid tokens received');
      return res.status(400).json({ error: 'Tokens array is required' });
    }

    console.log('🔍 Executing inventory search with tokens...');
    const result = await executeInventorySearch({
      terms: tokens,
      searchInPartNumbers: true,
      searchInDescriptions: true
    });

    const response = {
      parts: result.rows,
      snappedTerms: result.snapped,
      must: result.MUST,
      should: result.SHOULD,
      totalFound: result.rows.length,
      debug: { sql: result.sql, params: result.params }
    };
    
    console.log('✅ Search completed successfully:', {
      totalFound: response.totalFound,
      mustTerms: response.must,
      shouldTerms: response.should,
      snappedTerms: response.snappedTerms
    });
    
    res.json(response);

  } catch (e) {
    console.error('❌ Error in search-by-tokens:', e);
    res.status(500).json({ error: 'Unknown error occurred' });
  }
});

// Debug routes
router.get('/debug-snap', (_req, res) => {
  try {
    ensureLexicon();
    const term = String(_req.query.term || '');
    const snap = snapTokenToInventory(term, LEXICON!);
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: 'lexicon not ready' });
  }
});
router.get('/lexicon-stats', (_req, res) => {
  try {
    ensureLexicon();
    res.json({
      shapes: LEXICON!.shapes.size,
      materials: LEXICON!.materials.size,
      dimAliases: LEXICON!.dimAliasSet.size,
      decimals: LEXICON!.decimals.length
    });
  } catch (e) {
    res.status(500).json({ error: 'lexicon not ready' });
  }
});

// Debug endpoint to test lexicon lookups and search queries
router.get('/debug-lexicon', async (req, res) => {
  try {
    ensureLexicon();
    const term = String(req.query.term || '');
    const searchQuery = String(req.query.search || '');
    
    console.log('🔍 Debug lexicon endpoint hit:', { term, searchQuery });
    
    if (term) {
      // Test lexicon lookup for a specific term
      const snap = snapTokenToInventory(term, LEXICON!);
      console.log('🔍 Lexicon lookup for', term, ':', snap);
      
      // Check if term exists in various lexicon sets
      const inShapes = LEXICON!.shapes.has(term.toUpperCase());
      const inMaterials = LEXICON!.materials.has(term.toUpperCase());
      const inDimAliases = LEXICON!.dimAliasSet.has(term.toUpperCase());
      
      res.json({
        term,
        snap,
        lexiconStatus: {
          inShapes,
          inMaterials,
          inDimAliases,
          frequency: LEXICON!.frequency.get(term.toUpperCase()) || 0
        }
      });
    } else if (searchQuery) {
      // Test a simple search query
      const sql = `
        SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand
        FROM inventory 
        WHERE part_number ILIKE $1 OR part_description ILIKE $1
        LIMIT 10
      `;
      
      const searchTerm = `%${searchQuery.toUpperCase()}%`;
      const result = await pool.query(sql, [searchTerm]);
      
      res.json({
        searchQuery,
        searchTerm,
        results: result.rows,
        totalFound: result.rows.length,
        sql
      });
    } else {
      // Return lexicon stats
      res.json({
        shapes: Array.from(LEXICON!.shapes).slice(0, 20),
        materials: Array.from(LEXICON!.materials).slice(0, 20),
        dimAliases: Array.from(LEXICON!.dimAliasSet).slice(0, 20),
        totalShapes: LEXICON!.shapes.size,
        totalMaterials: LEXICON!.materials.size,
        totalDimAliases: LEXICON!.dimAliasSet.size
      });
    }
  } catch (e) {
    console.error('❌ Debug lexicon error:', e);
    res.status(500).json({ error: 'Debug failed', details: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
