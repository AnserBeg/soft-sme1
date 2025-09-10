import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';

const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface VoiceSearchRequest {
  audioData: string;
  audioFormat: string;
}

interface InterpretQueryRequest {
  query: string;
}

interface VoiceSearchResponse {
  searchTerms: string[];
  confidence: number;
  originalQuery: string;
}

interface InterpretQueryResponse {
  query: string;
  searchInPartNumbers: boolean;
  searchInDescriptions: boolean;
  extractedTerms: string[];
}

// Voice search endpoint - processes audio and converts to search terms
router.post('/search-parts', async (req, res) => {
  try {
    const { audioData, audioFormat }: VoiceSearchRequest = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Check payload size
    const payloadSize = Buffer.byteLength(audioData, 'base64');
    const maxSize = 5 * 1024 * 1024; // 5MB limit
    if (payloadSize > maxSize) {
      return res.status(413).json({ 
        error: `Audio data too large (${(payloadSize / 1024 / 1024).toFixed(2)}MB). Please record a shorter message.` 
      });
    }

    // For now, we'll use text input as a fallback since Gemini Live audio processing
    // requires specific setup. In a full implementation, you'd use Gemini Live's
    // audio processing capabilities.
    
    // Convert base64 audio to buffer (simplified - in real implementation you'd process audio)
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Use Gemini to interpret the audio query
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `
    You are an AI assistant that helps users find parts in an inventory system. 
    The user has spoken a query that needs to be converted into search terms.
    
    Since we cannot directly process the audio, please provide a helpful response suggesting
    the user try the text-based search instead, or provide some common search terms.
    
    Return a JSON response with:
    {
      "searchTerms": ["COMMON", "SEARCH", "TERMS"],
      "confidence": 0.5,
      "originalQuery": "Audio processing not available - please use text search"
    }
    
    For now, suggest these common search terms that users might find helpful:
    {
      "searchTerms": ["PLUG", "CONNECTOR", "TUBE", "ANGLE", "STEEL", "ALUMINUM", "BRACKET"],
      "confidence": 0.5,
      "originalQuery": "Audio processing not available - please use text search or try common terms"
    }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Parse the JSON response
    let parsedResponse: VoiceSearchResponse;
    try {
      parsedResponse = JSON.parse(text);
    } catch (parseError) {
      // Fallback if JSON parsing fails
      parsedResponse = {
        searchTerms: [text.trim()],
        confidence: 0.5,
        originalQuery: text.trim()
      };
    }

    res.json(parsedResponse);

  } catch (error) {
    console.error('Error in voice search:', error);
    res.status(500).json({ error: 'Failed to process voice search' });
  }
});

// Text query interpretation endpoint with enhanced AI processing
router.post('/interpret-query', async (req, res) => {
  try {
    const { query }: InterpretQueryRequest = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // First, get all available tokens from the inventory
    const tokensResult = await pool.query(`
      SELECT part_number, part_description 
      FROM inventory 
      WHERE part_number IS NOT NULL OR part_description IS NOT NULL
      LIMIT 5000
    `);

    const tokens = new Set<string>();
    const synonymMap: Record<string, string> = { 
      SS:'STAINLESS', STAIN:'STAINLESS', STAINLESS:'STAINLESS', 
      AL:'ALUMINUM', ALUM:'ALUMINUM', GALV:'GALVANIZED', GALVANIZED:'GALVANIZED', 
      SQ:'SQUARE', RECT:'RECTANGULAR', TUBE:'TUBING' 
    };
    const shapeSet = new Set(['TUBING','PIPE','ANGLE','BAR','FLAT','BEAM','CHANNEL','SHEET','PLATE','ROUND','SQUARE','RECTANGULAR']);

    const normalizeToken = (w: string) => synonymMap[w] || w;
    const add = (t: string) => { const tok = t.trim().toUpperCase(); if (tok && tok.length >= 2) tokens.add(tok); };
    const makeDecimal = (f: string) => { const [a,b] = f.split('/').map(Number); if(!a||!b) return null; return (a/b).toFixed(4).replace(/0+$/,'').replace(/\.$/,''); };
    const parseDims = (pn: string) => {
      const out = new Set<string>();
      if (!pn) return [];
    
      let s = pn
        .toUpperCase()
        .replace(/[\s-]+/g, '')
        .replace(/×/g, 'X')
        .replace(/[()]/g, '');
    
      const addOut = (t: string) => {
        const v = t?.trim();
        if (v) out.add(v);
      };
    
      const makeDecimal = (f: string) => {
        const [a, b] = f.split('/').map(Number);
        if (!a || !b) return null;
        return (a / b).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      };
    
      const fr = s.match(/\d+\/\d+/g) || [];
    
      if (s.includes('X')) {
        const seg = s.split('X');
        if (seg.length >= 2 && seg.length <= 4) {
          addOut(seg.slice(0, 2).join('X')); // e.g., 5X5
          addOut(seg.join('X'));             // e.g., 5X5X0.125
        }
      }
    
      fr.forEach(f => {
        addOut(f); // keep fraction form
        const dec = makeDecimal(f);
        if (dec) addOut(dec); // decimal form
      });
    
      (s.match(/(\d+)GA/g) || []).forEach(g => addOut(g));                             // e.g., 16GA
      (s.match(/SCH\s*\d+/g) || []).forEach(m => addOut(m.replace(/\s+/g, '')));       // e.g., SCH40
      (s.match(/OD\d+(?:\.\d+)?/g) || []).forEach(v => addOut(v));                      // e.g., OD2
      (s.match(/ID\d+(?:\.\d+)?/g) || []).forEach(v => addOut(v));                      // e.g., ID1.5
      (s.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).forEach(d => addOut(d));            // first 3 raw numbers
    
      return Array.from(out);
    };
    
    

    for (const row of tokensResult.rows) {
      // Add part numbers
      if (row.part_number) {
        add(row.part_number);
        // Parse dimensions from part numbers
        const dims = parseDims(row.part_number);
        dims.forEach(d => add(d));
      }

      // Add description words
      if (row.part_description) {
        const wordsRaw = String(row.part_description).toUpperCase().split(/[^A-Z0-9]+/).filter(w=>w.length>=2);
        const words = wordsRaw.map(normalizeToken);
        words.forEach(add);
        
        // Add bigrams (shape+material combos)
        const uniq = Array.from(new Set(words));
        uniq.forEach(a=>uniq.forEach(b=>{ 
          if(a!==b && (shapeSet.has(a)||shapeSet.has(b))) add(`${a} ${b}`); 
        }));
      }
    }

    const availableTokens = Array.from(tokens).sort();
    const sampleTokens = availableTokens.slice(0, 200); // Send first 200 tokens to avoid token limit

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `
    You are an AI assistant that helps users find parts in an inventory system.
    The user has entered a text query that needs to be interpreted for part searching.
    
    AVAILABLE TOKENS IN THE INVENTORY SYSTEM:
    ${sampleTokens.join(', ')}
    
    INSTRUCTIONS:
    1. Analyze the user's natural language query
    2. For DESCRIPTIONS (materials, shapes, types): Find the most similar tokens from the available list above
    3. For MEASUREMENTS: Convert to various formats and search part numbers
    4. Handle common variations in formatting (spaces, dashes, fractions to decimals)
    5. Use synonyms and abbreviations appropriately
    
    EXAMPLES:
    - "steel tube" → Look for "STEEL", "TUBE", "TUBING" in descriptions
    - "5 by 5 by 1/8" → Search part numbers for "5", "5X5", "0.125", "5X5X0.125", "5-5-0.125"
    - "aluminum angle" → Look for "ALUMINUM", "AL", "ANGLE" in descriptions
    - "2 pin connector" → Look for "2", "PIN", "CONNECTOR", "2PIN" in both part numbers and descriptions
    
    Return a JSON response with:
    {
      "query": "original query",
      "searchInPartNumbers": true/false,
      "searchInDescriptions": true/false,
      "extractedTerms": ["term1", "term2", "term3"],
      "reasoning": "brief explanation of the search strategy"
    }
    
    IMPORTANT: For measurements, include multiple format variations in extractedTerms.
    For descriptions, choose the most relevant tokens from the available list.
    `;
    
    const result = await model.generateContent(prompt + `\n\nUser Query: "${query}"`);
    const response = await result.response;
    const text = response.text();
    
    // Parse the JSON response
    let parsedResponse: InterpretQueryResponse & { reasoning?: string };
    try {
      parsedResponse = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse AI response:', text);
        // Fallback if JSON parsing fails
        parsedResponse = {
          query: query,
          searchInPartNumbers: true,
          searchInDescriptions: true,
          extractedTerms: [query.toUpperCase()],
          reasoning: 'Fallback processing due to AI response parsing error'
        };
    }

    // Ensure we have the required fields
    const finalResponse: InterpretQueryResponse = {
      query: parsedResponse.query || query,
      searchInPartNumbers: parsedResponse.searchInPartNumbers !== false,
      searchInDescriptions: parsedResponse.searchInDescriptions !== false,
      extractedTerms: parsedResponse.extractedTerms || [query.toUpperCase()]
    };

    console.log('AI Query Interpretation:', {
      original: query,
      result: finalResponse,
      reasoning: parsedResponse.reasoning
    });

    res.json(finalResponse);

  } catch (error) {
    console.error('Error interpreting query:', error);
    res.status(500).json({ error: 'Failed to interpret query' });
  }
});

// Get all available tokens from inventory for AI processing
router.get('/available-tokens', async (req, res) => {
  try {
    // Get all part numbers and descriptions
    const result = await pool.query(`
      SELECT part_number, part_description 
      FROM inventory 
      WHERE part_number IS NOT NULL OR part_description IS NOT NULL
      LIMIT 10000
    `);

    const tokens = new Set<string>();
    const synonymMap: Record<string, string> = { 
      SS:'STAINLESS', STAIN:'STAINLESS', STAINLESS:'STAINLESS', 
      AL:'ALUMINUM', ALUM:'ALUMINUM', GALV:'GALVANIZED', GALVANIZED:'GALVANIZED', 
      SQ:'SQUARE', RECT:'RECTANGULAR', TUBE:'TUBING' 
    };
    const shapeSet = new Set(['TUBING','PIPE','ANGLE','BAR','FLAT','BEAM','CHANNEL','SHEET','PLATE','ROUND','SQUARE','RECTANGULAR']);

    const normalizeToken = (w: string) => synonymMap[w] || w;
    const add = (t: string) => { const tok = t.trim().toUpperCase(); if (tok && tok.length >= 2) tokens.add(tok); };
    const makeDecimal = (f: string) => { const [a,b] = f.split('/').map(Number); if(!a||!b) return null; return (a/b).toFixed(4).replace(/0+$/,'').replace(/\.$/,''); };
    const parseDims = (pn: string) => {
      const out = new Set<string>();
      if (!pn) return [];
    
      let s = pn
        .toUpperCase()
        .replace(/[\s-]+/g, '')
        .replace(/×/g, 'X')
        .replace(/[()]/g, '');
    
      const addOut = (t: string) => {
        const v = t?.trim();
        if (v) out.add(v);
      };
    
      const makeDecimal = (f: string) => {
        const [a, b] = f.split('/').map(Number);
        if (!a || !b) return null;
        return (a / b).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      };
    
      const fr = s.match(/\d+\/\d+/g) || [];
    
      if (s.includes('X')) {
        const seg = s.split('X');
        if (seg.length >= 2 && seg.length <= 4) {
          addOut(seg.slice(0, 2).join('X')); // e.g., 5X5
          addOut(seg.join('X'));             // e.g., 5X5X0.125
        }
      }
    
      fr.forEach(f => {
        addOut(f); // keep fraction form
        const dec = makeDecimal(f);
        if (dec) addOut(dec); // decimal form
      });
    
      (s.match(/(\d+)GA/g) || []).forEach(g => addOut(g));                             // e.g., 16GA
      (s.match(/SCH\s*\d+/g) || []).forEach(m => addOut(m.replace(/\s+/g, '')));       // e.g., SCH40
      (s.match(/OD\d+(?:\.\d+)?/g) || []).forEach(v => addOut(v));                      // e.g., OD2
      (s.match(/ID\d+(?:\.\d+)?/g) || []).forEach(v => addOut(v));                      // e.g., ID1.5
      (s.match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).forEach(d => addOut(d));            // first 3 raw numbers
    
      return Array.from(out);
    };
    

    for (const row of result.rows) {
      // Add part numbers
      if (row.part_number) {
        add(row.part_number);
        // Parse dimensions from part numbers
        const dims = parseDims(row.part_number);
        dims.forEach(d => add(d));
      }

      // Add description words
      if (row.part_description) {
        const wordsRaw = String(row.part_description).toUpperCase().split(/[^A-Z0-9]+/).filter(w=>w.length>=2);
        const words = wordsRaw.map(normalizeToken);
        words.forEach(add);
        
        // Add bigrams (shape+material combos)
        const uniq = Array.from(new Set(words));
        uniq.forEach(a=>uniq.forEach(b=>{ 
          if(a!==b && (shapeSet.has(a)||shapeSet.has(b))) add(`${a} ${b}`); 
        }));
      }
    }

    res.json({
      tokens: Array.from(tokens).sort(),
      totalTokens: tokens.size
    });

  } catch (error) {
    console.error('Error getting available tokens:', error);
    res.status(500).json({ error: 'Failed to get available tokens' });
  }
});

// Enhanced part search endpoint that uses the interpreted query
router.post('/search-inventory', async (req, res) => {
  try {
    const { searchTerms, searchInPartNumbers, searchInDescriptions } = req.body;

    if (!searchTerms || !Array.isArray(searchTerms)) {
      return res.status(400).json({ error: 'Search terms array is required' });
    }

    // Build SQL query based on search parameters
    let sql = `
      SELECT part_number, part_description, unit, last_unit_cost, quantity_on_hand
      FROM inventory 
      WHERE 1=0
    `;
    
    const params: string[] = [];
    let paramIndex = 1;

    if (searchInPartNumbers) {
      searchTerms.forEach(term => {
        sql += ` OR part_number ILIKE $${paramIndex}`;
        params.push(`%${term}%`);
        paramIndex++;
      });
    }

    if (searchInDescriptions) {
      searchTerms.forEach(term => {
        sql += ` OR part_description ILIKE $${paramIndex}`;
        params.push(`%${term}%`);
        paramIndex++;
      });
    }

    sql += ' ORDER BY part_number LIMIT 100';

    const result = await pool.query(sql, params);
    
    res.json({
      parts: result.rows,
      searchTerms: searchTerms,
      totalFound: result.rows.length
    });

  } catch (error) {
    console.error('Error searching inventory:', error);
    res.status(500).json({ error: 'Failed to search inventory' });
  }
});

export default router;
