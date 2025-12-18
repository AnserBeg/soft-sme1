import React, { useMemo } from 'react';
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

type QuoteDescriptionBlock =
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

  const cells = parts.map((part) => part.trim());
  if (cells.every((cell) => cell.length === 0)) {
    return null;
  }

  return cells;
};

const isMarkdownTableDividerRow = (line: string): boolean => {
  const cells = parseMarkdownTableRow(line);
  if (!cells || cells.length === 0) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const parseQuoteDescription = (input: string): QuoteDescriptionBlock[] => {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) {
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

export interface QuoteDescriptionPreviewProps {
  value: string;
}

const QuoteDescriptionPreview: React.FC<QuoteDescriptionPreviewProps> = ({ value }) => {
  const blocks = useMemo(() => parseQuoteDescription(value), [value]);

  if (blocks.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing to preview yet.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {blocks.map((block, index) => {
        if (block.kind === 'text') {
          return (
            <Box
              key={`text-${index}`}
              sx={{
                fontFamily: 'Roboto Mono, Consolas, Menlo, monospace',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.4,
              }}
            >
              {block.text}
            </Box>
          );
        }

        const columnCount = Math.max(
          block.header.length,
          block.rows.reduce((max, row) => Math.max(max, row.length), 0)
        );

        const paddedHeader = Array.from({ length: columnCount }, (_, colIndex) => block.header[colIndex] ?? '');
        const paddedRows = block.rows.map((row) =>
          Array.from({ length: columnCount }, (_, colIndex) => row[colIndex] ?? '')
        );

        return (
          <Table
            key={`table-${index}`}
            size="small"
            sx={{
              width: '100%',
              '& th, & td': { border: 'none', padding: '2px 10px 2px 0', verticalAlign: 'top' },
              '& th': { fontWeight: 700 },
            }}
          >
            <TableHead>
              <TableRow>
                {paddedHeader.map((cell, colIndex) => (
                  <TableCell key={`h-${colIndex}`}>{cell}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {paddedRows.map((row, rowIndex) => (
                <TableRow key={`r-${rowIndex}`}>
                  {row.map((cell, colIndex) => (
                    <TableCell key={`c-${rowIndex}-${colIndex}`}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      })}
    </Box>
  );
};

export default QuoteDescriptionPreview;

