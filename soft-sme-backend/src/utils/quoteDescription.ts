import PDFDocument from 'pdfkit';
import { escapeHtml, normalizeDocumentText } from './documentText';

type PDFKitDocument = InstanceType<typeof PDFDocument>;

export type QuoteDescriptionBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

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

export const parseQuoteDescription = (input: unknown): QuoteDescriptionBlock[] => {
  const normalized = normalizeDocumentText(input);
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const blocks: QuoteDescriptionBlock[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    const text = textBuffer.join('\n');
    if (text.trim().length > 0) {
      blocks.push({ kind: 'text', text });
    }
    textBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headerRow = parseMarkdownTableRow(line);

    if (headerRow && i + 1 < lines.length && isMarkdownTableDividerRow(lines[i + 1])) {
      flushText();

      const header = headerRow;
      const rows: string[][] = [];
      i += 2;

      for (; i < lines.length; i += 1) {
        const rowLine = lines[i];
        if (rowLine.trim().length === 0) {
          break;
        }

        const row = parseMarkdownTableRow(rowLine);
        if (!row) {
          i -= 1;
          break;
        }

        rows.push(row);
      }

      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    textBuffer.push(line);
  }

  flushText();
  return blocks;
};

export const renderQuoteDescriptionHtml = (input: unknown): string => {
  const blocks = parseQuoteDescription(input);
  if (blocks.length === 0) {
    return `<div style="white-space: pre-wrap; margin: 0;"></div>`;
  }

  const pieces: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'text') {
      pieces.push(
        `<div style="white-space: pre-wrap; margin: 0; line-height: 1.35; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;">${escapeHtml(block.text)}</div>`
      );
      continue;
    }

    const headerCells = block.header.map(
      (cell) =>
        `<th style="border: none; text-align: left; padding: 2px 10px 2px 0; font-weight: 700;">${escapeHtml(cell)}</th>`
    );

    const bodyRows = block.rows.map((row) => {
      const cells = row.map(
        (cell) =>
          `<td style="border: none; text-align: left; padding: 2px 10px 2px 0; vertical-align: top;">${escapeHtml(cell)}</td>`
      );
      return `<tr>${cells.join('')}</tr>`;
    });

    pieces.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; margin: 6px 0;">` +
        `<thead><tr>${headerCells.join('')}</tr></thead>` +
        `<tbody>${bodyRows.join('')}</tbody>` +
        `</table>`
    );
  }

  return pieces.join('');
};

export const renderQuoteDescriptionPlainText = (input: unknown): string => {
  const blocks = parseQuoteDescription(input);
  if (blocks.length === 0) {
    return '';
  }

  const pieces: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'text') {
      pieces.push(block.text);
      continue;
    }

    const rows = [block.header, ...block.rows];
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const columnWidths = Array.from({ length: columnCount }, (_, index) =>
      rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 0)
    );

    const formattedRows = rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => {
        const value = row[index] ?? '';
        const width = columnWidths[index] ?? 0;
        return value.padEnd(width);
      }).join('  ')
    );

    pieces.push(formattedRows.join('\n'));
  }

  return pieces.join('\n\n');
};

export const renderQuoteDescriptionToPdf = (
  doc: PDFKitDocument,
  input: unknown,
  x: number,
  y: number,
  width: number
): number => {
  const blocks = parseQuoteDescription(input);
  if (blocks.length === 0) {
    doc.text('N/A', x, y, { width });
    return doc.y;
  }

  doc.font('Courier').fontSize(10).fillColor('#000000');

  const ensurePageSpace = (heightNeeded: number) => {
    const bottomLimit = doc.page.height - doc.page.margins.bottom;
    if (y + heightNeeded <= bottomLimit) {
      return;
    }
    doc.addPage();
    y = doc.page.margins.top;
  };

  for (const block of blocks) {
    if (block.kind === 'text') {
      ensurePageSpace(14);
      doc.text(block.text, x, y, { width, lineGap: 2 });
      y = doc.y + 6;
      continue;
    }

    const tableRows = [block.header, ...block.rows];
    const columnCount = tableRows.reduce((max, row) => Math.max(max, row.length), 0);
    if (columnCount === 0) {
      continue;
    }

    const columnMaxWidths = Array.from({ length: columnCount }, () => 0);
    for (const row of tableRows) {
      for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
        const text = row[colIndex] ?? '';
        const measured = doc.widthOfString(text);
        columnMaxWidths[colIndex] = Math.max(columnMaxWidths[colIndex], measured);
      }
    }

    const padding = 10;
    const naturalTotal = columnMaxWidths.reduce((sum, w) => sum + w, 0) + padding * (columnCount - 1);
    const scale = naturalTotal > width && naturalTotal > 0 ? width / naturalTotal : 1;
    const columnWidths = columnMaxWidths.map((w, index) => {
      const remainingColumns = columnCount - index - 1;
      const maxAllowed = width - padding * remainingColumns;
      return Math.min(Math.max(w * scale, 40), maxAllowed);
    });

    const columnOffsets: number[] = [];
    let running = 0;
    for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
      columnOffsets.push(running);
      running += columnWidths[colIndex] + padding;
    }

    for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
      const row = tableRows[rowIndex];

      const rowHeight =
        row.reduce((max, cell, colIndex) => {
          const text = cell ?? '';
          const cellHeight = doc.heightOfString(text, { width: columnWidths[colIndex], lineGap: 2 });
          return Math.max(max, cellHeight);
        }, doc.currentLineHeight(true)) + 2;

      ensurePageSpace(rowHeight + 4);

      doc.font(rowIndex === 0 ? 'Courier-Bold' : 'Courier').fontSize(10);
      for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
        const cellText = row[colIndex] ?? '';
        doc.text(cellText, x + columnOffsets[colIndex], y, { width: columnWidths[colIndex], lineGap: 2 });
      }

      y += rowHeight + 2;
      doc.y = y;
    }

    y += 6;
    doc.y = y;
  }

  return y;
};
