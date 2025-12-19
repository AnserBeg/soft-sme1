import React, { useCallback, useMemo } from 'react';
import { Box, IconButton, Stack, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { QuoteDescriptionTable } from '../utils/quoteDescriptionTable';

export interface QuoteDescriptionTableEditorProps {
  value: QuoteDescriptionTable;
  onChange: (next: QuoteDescriptionTable) => void;
  disableColumnEditing?: boolean;
}

const cellSx = {
  '& .MuiInputBase-input': {
    fontFamily: 'Roboto Mono, Consolas, Menlo, monospace',
    fontSize: 14,
    padding: '6px 8px',
  },
  '& fieldset': { border: 'none' },
} as const;

const QuoteDescriptionTableEditor: React.FC<QuoteDescriptionTableEditorProps> = ({
  value,
  onChange,
  disableColumnEditing,
}) => {
  const columnCount = Math.max(1, value.columns.length);
  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, idx) => value.columns[idx] ?? ''),
    [columnCount, value.columns]
  );
  const rows = useMemo(
    () => value.rows.map((row) => Array.from({ length: columnCount }, (_, idx) => row[idx] ?? '')),
    [value.rows, columnCount]
  );

  const setColumn = useCallback(
    (index: number, nextValue: string) => {
      const nextColumns = columns.slice();
      nextColumns[index] = nextValue;
      onChange({ ...value, columns: nextColumns });
    },
    [columns, onChange, value]
  );

  const setCell = useCallback(
    (rowIndex: number, colIndex: number, nextValue: string) => {
      const nextRows = rows.map((row) => row.slice());
      nextRows[rowIndex][colIndex] = nextValue;
      onChange({ ...value, rows: nextRows });
    },
    [onChange, rows, value]
  );

  const addRowBelow = useCallback(
    (rowIndex: number) => {
      const nextRows = rows.map((row) => row.slice());
      nextRows.splice(rowIndex + 1, 0, Array.from({ length: columnCount }, () => ''));
      onChange({ ...value, rows: nextRows });
    },
    [columnCount, onChange, rows, value]
  );

  const deleteRow = useCallback(
    (rowIndex: number) => {
      const nextRows = rows.map((row) => row.slice());
      nextRows.splice(rowIndex, 1);
      onChange({ ...value, rows: nextRows.length > 0 ? nextRows : [Array.from({ length: columnCount }, () => '')] });
    },
    [columnCount, onChange, rows, value]
  );

  const handlePaste = useCallback(
    (rowIndex: number, colIndex: number, event: React.ClipboardEvent<any>) => {
      const text = event.clipboardData.getData('text');
      if (!text.includes('\t') && !text.includes('\n')) {
        return;
      }

      event.preventDefault();

      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const cells = lines.map((line) => line.split('\t'));

      const nextRows = rows.map((row) => row.slice());
      const requiredRows = rowIndex + cells.length;
      while (nextRows.length < requiredRows) {
        nextRows.push(Array.from({ length: columnCount }, () => ''));
      }

      for (let r = 0; r < cells.length; r += 1) {
        for (let c = 0; c < cells[r].length; c += 1) {
          const targetRow = rowIndex + r;
          const targetCol = colIndex + c;
          if (targetCol >= columnCount) {
            continue;
          }
          nextRows[targetRow][targetCol] = cells[r][c] ?? '';
        }
      }

      onChange({ ...value, rows: nextRows });
    },
    [columnCount, onChange, rows, value]
  );

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, 1fr) 70px`, bgcolor: 'background.paper' }}>
        {columns.map((col, colIndex) => (
          <TextField
            key={`h-${colIndex}`}
            value={col}
            onChange={(e) => setColumn(colIndex, e.target.value)}
            size="small"
            disabled={disableColumnEditing}
            placeholder={`Column ${colIndex + 1}`}
            sx={{ ...cellSx, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}
            inputProps={{ style: { fontWeight: 700 } }}
          />
        ))}
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }} />
      </Box>

      {rows.map((row, rowIndex) => (
        <Box
          key={`r-${rowIndex}`}
          sx={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, 1fr) 70px`, alignItems: 'stretch' }}
        >
          {row.map((cell, colIndex) => (
            <TextField
              key={`c-${rowIndex}-${colIndex}`}
              value={cell}
              onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
              onPaste={(e) => handlePaste(rowIndex, colIndex, e)}
              size="small"
              placeholder={colIndex === 0 ? '' : '...'}
              sx={{
                ...cellSx,
                borderBottom: rowIndex < rows.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
              }}
            />
          ))}
          <Stack
            direction="row"
            spacing={0}
            alignItems="center"
            justifyContent="center"
            sx={{
              borderBottom: rowIndex < rows.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider',
            }}
          >
            <Tooltip title="Add row">
              <IconButton size="small" onClick={() => addRowBelow(rowIndex)}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete row">
              <IconButton size="small" color="error" onClick={() => deleteRow(rowIndex)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      ))}
    </Box>
  );
};

export default QuoteDescriptionTableEditor;
