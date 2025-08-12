import { DataGrid } from '@mui/x-data-grid';

export default function MarginPage() {
  return (
    <DataGrid
      columns={[]}
      rows={[]}
      sx={{
        cursor: 'pointer',
        '& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeaderTitle': {
          fontSize: '1.1rem',
        },
        '& .MuiDataGrid-cell': {
          borderBottom: '1px solid rgba(224, 224, 224, 1)',
        },
        '& .MuiDataGrid-columnHeaders': {
          backgroundColor: 'background.paper',
          borderBottom: '2px solid rgba(224, 224, 224, 1)',
        },
        '& .MuiDataGrid-row': {
          minHeight: '52px !important',
          maxHeight: '52px !important',
        },
        '& .MuiDataGrid-columnHeadersInner': {
          minHeight: '60px !important',
          maxHeight: '60px !important',
        },
        '& .MuiDataGrid-row:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    />
  );
} 