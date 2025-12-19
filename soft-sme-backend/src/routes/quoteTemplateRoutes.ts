import express, { Request, Response } from 'express';
import { pool } from '../db';
import { stripUnsafeText } from '../utils/documentText';

const router = express.Router();

const normalizeTemplateName = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const coerceContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

type QuoteTemplateTablePayload = {
  type: 'table';
  version: 1;
  table: { columns: unknown; rows: unknown };
};

const sanitizeTableTemplateJson = (rawContent: string): string | null => {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<QuoteTemplateTablePayload>;
    if (parsed?.type !== 'table' || parsed.version !== 1 || !parsed.table) {
      return null;
    }

    const columnsRaw = (parsed.table as any).columns;
    const rowsRaw = (parsed.table as any).rows;

    if (!Array.isArray(columnsRaw) || !Array.isArray(rowsRaw)) {
      return null;
    }

    const columns = columnsRaw.map((value: unknown) => stripUnsafeText(typeof value === 'string' ? value : String(value ?? '')));
    const rows = rowsRaw.map((row: unknown) => {
      if (!Array.isArray(row)) {
        return [];
      }
      return row.map((value: unknown) => stripUnsafeText(typeof value === 'string' ? value : String(value ?? '')));
    });

    return JSON.stringify({ type: 'table', version: 1, table: { columns, rows } });
  } catch {
    return null;
  }
};

const sanitizeTemplateContent = (rawContent: string): string => {
  const jsonTable = sanitizeTableTemplateJson(rawContent);
  if (jsonTable) {
    return jsonTable;
  }
  return stripUnsafeText(rawContent);
};

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT template_id, name, content, created_by, created_at, updated_at
       FROM quote_description_templates
       ORDER BY LOWER(name) ASC`
    );

    res.json({ success: true, templates: result.rows });
  } catch (error) {
    console.error('quoteTemplateRoutes: error fetching templates', error);
    res.status(500).json({ success: false, message: 'Failed to load quote templates' });
  }
});

router.get('/:templateId', async (req: Request, res: Response) => {
  const templateId = Number(req.params.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid template id' });
  }

  try {
    const result = await pool.query(
      `SELECT template_id, name, content, created_by, created_at, updated_at
       FROM quote_description_templates
       WHERE template_id = $1`,
      [templateId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('quoteTemplateRoutes: error fetching template', error);
    res.status(500).json({ success: false, message: 'Failed to load quote template' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const name = normalizeTemplateName(req.body?.name);
    const rawContent = sanitizeTemplateContent(coerceContent(req.body?.content));

    if (!name) {
      return res.status(400).json({ success: false, message: 'Template name is required' });
    }

    if (!rawContent.trim()) {
      return res.status(400).json({ success: false, message: 'Template content is required' });
    }

    const createdBy = req.user?.id ? Number(req.user.id) : null;

    const insertResult = await pool.query(
      `INSERT INTO quote_description_templates (name, content, created_by)
       VALUES ($1, $2, $3)
       RETURNING template_id, name, content, created_by, created_at, updated_at`,
      [name, rawContent, createdBy]
    );

    res.status(201).json({ success: true, template: insertResult.rows[0] });
  } catch (error) {
    console.error('quoteTemplateRoutes: error creating template', error);
    res.status(500).json({ success: false, message: 'Failed to create quote template' });
  }
});

router.put('/:templateId', async (req: Request, res: Response) => {
  const templateId = Number(req.params.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid template id' });
  }

  try {
    const name = normalizeTemplateName(req.body?.name);
    const rawContent = sanitizeTemplateContent(coerceContent(req.body?.content));

    if (!name) {
      return res.status(400).json({ success: false, message: 'Template name is required' });
    }

    if (!rawContent.trim()) {
      return res.status(400).json({ success: false, message: 'Template content is required' });
    }

    const updateResult = await pool.query(
      `UPDATE quote_description_templates
       SET name = $1,
           content = $2,
           updated_at = NOW()
       WHERE template_id = $3
       RETURNING template_id, name, content, created_by, created_at, updated_at`,
      [name, rawContent, templateId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, template: updateResult.rows[0] });
  } catch (error) {
    console.error('quoteTemplateRoutes: error updating template', error);
    res.status(500).json({ success: false, message: 'Failed to update quote template' });
  }
});

router.delete('/:templateId', async (req: Request, res: Response) => {
  const templateId = Number(req.params.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid template id' });
  }

  try {
    const deleteResult = await pool.query(
      'DELETE FROM quote_description_templates WHERE template_id = $1 RETURNING template_id',
      [templateId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('quoteTemplateRoutes: error deleting template', error);
    res.status(500).json({ success: false, message: 'Failed to delete quote template' });
  }
});

export default router;
