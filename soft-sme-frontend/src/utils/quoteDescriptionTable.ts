export type QuoteDescriptionTable = {
  columns: string[];
  rows: string[][];
};

export type QuoteDescriptionTableTemplate = {
  type: 'table';
  version: 1;
  table: QuoteDescriptionTable;
};

const sanitizeCell = (value: string): string => value.replace(/\|/g, '¦');

export const tableToMarkdown = (table: QuoteDescriptionTable): string => {
  const columns = table.columns.length > 0 ? table.columns : ['Column 1', 'Column 2'];
  const columnCount = columns.length;

  const header = `| ${columns.map((c) => sanitizeCell(c)).join(' | ')} |`;
  const divider = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;

  const body = table.rows.map((row) => {
    const padded = Array.from({ length: columnCount }, (_, i) => sanitizeCell(row[i] ?? ''));
    return `| ${padded.join(' | ')} |`;
  });

  return [header, divider, ...body].join('\n');
};

const parseMarkdownTableRow = (line: string): string[] | null => {
  if (!line.includes('|')) {
    return null;
  }

  const trimmed = line.trim();
  const rawParts = trimmed.split('|');

  let parts = rawParts;
  if (parts.length >= 2 && parts[0].trim() === '') {
    parts = parts.slice(1);
  }
  if (parts.length >= 2 && parts[parts.length - 1].trim() === '') {
    parts = parts.slice(0, -1);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.map((part) => part.trim());
};

const isMarkdownTableDividerRow = (line: string): boolean => {
  const cells = parseMarkdownTableRow(line);
  if (!cells || cells.length === 0) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

export const tryParseSingleMarkdownTable = (value: string): QuoteDescriptionTable | null => {
  const trimmed = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }

  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return null;
  }

  const header = parseMarkdownTableRow(lines[0]);
  if (!header) {
    return null;
  }

  if (!isMarkdownTableDividerRow(lines[1])) {
    return null;
  }

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const row = parseMarkdownTableRow(lines[i]);
    if (!row) {
      return null;
    }
    rows.push(row);
  }

  const columnCount = header.length;
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, idx) => row[idx] ?? ''));

  return { columns: header, rows: normalizedRows };
};

export const encodeTableTemplate = (table: QuoteDescriptionTable): string => {
  const payload: QuoteDescriptionTableTemplate = { type: 'table', version: 1, table };
  return JSON.stringify(payload);
};

export const tryDecodeTableTemplate = (content: string): QuoteDescriptionTableTemplate | null => {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<QuoteDescriptionTableTemplate>;
    if (parsed?.type !== 'table' || parsed.version !== 1 || !parsed.table) {
      return null;
    }
    if (!Array.isArray(parsed.table.columns) || !Array.isArray(parsed.table.rows)) {
      return null;
    }
    return parsed as QuoteDescriptionTableTemplate;
  } catch {
    return null;
  }
};

export const createDefaultTwoColumnTable = (rowCount = 10): QuoteDescriptionTable => ({
  columns: ['Column 1', 'Column 2'],
  rows: Array.from({ length: Math.max(1, rowCount) }, () => ['', '']),
});

