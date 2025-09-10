import express from 'express';
import { pool } from '../db';

const tokensRouter = express.Router();

// Rebuild part tokens endpoint
tokensRouter.post("/admin/rebuild-part-tokens", async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Clear existing tokens
    await client.query("TRUNCATE part_tokens CASCADE");
    await client.query("TRUNCATE token_stats CASCADE");
    
    // Get all parts
    const partsResult = await client.query("SELECT part_id, part_number, part_description FROM Inventory");
    
    let count = 0;
    for (const part of partsResult.rows) {
      // Extract tokens using database functions
      const tokensResult = await client.query(
        "SELECT * FROM extract_tokens_from_part_number($1)",
        [part.part_number]
      );
      
      const descTokensResult = await client.query(
        "SELECT * FROM extract_tokens_from_description($1)",
        [part.part_description]
      );
      
      const fallbackTokensResult = await client.query(
        "SELECT * FROM extract_fallback_tokens($1, $2)",
        [part.part_number, part.part_description]
      );
      
      // Combine all tokens
      const allTokens = [
        ...tokensResult.rows,
        ...descTokensResult.rows,
        ...fallbackTokensResult.rows
      ];
      
      // Insert tokens
      for (const token of allTokens) {
        await client.query(
          "INSERT INTO part_tokens (part_id, type, value, origin, confidence) VALUES ($1, $2, $3, $4, $5)",
          [part.part_id, token.type, token.value, token.origin, token.confidence]
        );
      }
      
      count++;
    }
    
    await client.query("COMMIT");
    res.json({ ok: true, count });
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error("Rebuild failed:", e);
    res.status(500).json({ error: "rebuild failed", details: e.message });
  } finally {
    client.release();
  }
});

// Get global counts for all token types
tokensRouter.get("/search/global-counts", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        type,
        value,
        COUNT(*) as count
      FROM part_tokens 
      GROUP BY type, value 
      ORDER BY count DESC
    `);
    
    const facets: any = {};
    for (const row of result.rows) {
      if (!facets[row.type]) {
        facets[row.type] = [];
      }
      facets[row.type].push({
        value: row.value,
        count: parseInt(row.count)
      });
    }
    
    // Sort each facet by count
    for (const k of Object.keys(facets)) {
      facets[k].sort((a: any, b: any) => b.count - a.count);
    }
    
    res.json({ facets });
  } catch (e: any) {
    console.error("Global counts failed:", e);
    res.status(500).json({ error: "global counts failed", details: e.message });
  }
});

// Get facet suggestions based on selected tokens
tokensRouter.get("/search/facet-suggestions", async (req, res) => {
  try {
    const { tokens } = req.query;
    const selectedTokens = tokens ? (Array.isArray(tokens) ? tokens : [tokens]) : [];
    
    let query = `
      SELECT DISTINCT
        i.part_id,
        i.part_number,
        i.part_description,
        i.quantity_on_hand,
        i.last_unit_cost
      FROM Inventory i
    `;
    
    const queryParams: any[] = [];
    let paramIndex = 1;
    
    if (selectedTokens.length > 0) {
      query += ` WHERE i.part_id IN (
        SELECT DISTINCT part_id 
        FROM part_tokens 
        WHERE value = ANY($${paramIndex}::text[])
      )`;
      queryParams.push(selectedTokens);
      paramIndex++;
    }
    
    query += " ORDER BY i.part_number LIMIT 100";
    
    const partsResult = await pool.query(query, queryParams);
    
    // Get facet suggestions
    const facetsQuery = `
      SELECT 
        type,
        value,
        COUNT(*) as count
      FROM part_tokens 
      WHERE part_id = ANY($1::integer[])
      GROUP BY type, value 
      ORDER BY count DESC
    `;
    
    const partIds = partsResult.rows.map(p => p.part_id);
    const facetsResult = await pool.query(facetsQuery, [partIds]);
    
    const facets: any = {};
    for (const row of facetsResult.rows) {
      if (!facets[row.type]) {
        facets[row.type] = [];
      }
      facets[row.type].push({
        value: row.value,
        count: parseInt(row.count)
      });
    }
    
    res.json({
      parts: partsResult.rows,
      suggestions: facets
    });
  } catch (e: any) {
    console.error("Facet suggestions failed:", e);
    res.status(500).json({ error: "facet suggestions failed", details: e.message });
  }
});

// Record token click
tokensRouter.post("/analytics/click", async (req, res) => {
  try {
    const { token_type, token_value } = req.body;
    
    await pool.query(`
      INSERT INTO token_stats (token, type, clicks, last_selected)
      VALUES ($1, $2, 1, NOW())
      ON CONFLICT (token) 
      DO UPDATE SET 
        type = EXCLUDED.type,
        clicks = COALESCE(token_stats.clicks, 0) + 1,
        last_selected = NOW()
    `, [token_value, token_type]);
    
    res.json({ ok: true });
  } catch (e: any) {
    console.error("Click recording failed:", e);
    res.status(500).json({ error: "click recording failed", details: e.message });
  }
});

// Record token show
tokensRouter.post("/analytics/show", async (req, res) => {
  try {
    const { tokens } = req.body;
    
    for (const token of tokens) {
      await pool.query(`
        INSERT INTO token_stats (token, type, shows, last_selected)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (token) 
        DO UPDATE SET 
          type = EXCLUDED.type,
          shows = COALESCE(token_stats.shows, 0) + 1,
          last_selected = NOW()
      `, [token.token_value, token.token_type]);
    }
    
    res.json({ ok: true });
  } catch (e: any) {
    console.error("Show recording failed:", e);
    res.status(500).json({ error: "show recording failed", details: e.message });
  }
});

export { tokensRouter };
