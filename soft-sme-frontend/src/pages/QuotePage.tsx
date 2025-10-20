// src/pages/QuotePage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  InputAdornment,
  Stack,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
  Chip,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridPaginationModel,
} from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { format } from 'date-fns';
import api from '../api/axios';
import { normalizeQuoteStatus, QuoteStatus } from '../utils/quoteStatus';

interface Quote {
  quote_id: number;
  quote_number: string;
  customer_id: number;
  customer_name: string;
  quote_date: string;
  valid_until: string;
  product_name: string;
  product_description: string;
  estimated_cost: number;
  status: QuoteStatus;
  terms?: string;
  customer_po_number?: string;
  vin_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
}

const formatInt = (v: number | string | null | undefined) => {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(n);
};

const QuotePage: React.FC = () => {
  const navigate = useNavigate();

  // data
  const [quotes, setQuotes] = useState<Quote[]>([]);
  // ui
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuoteStatus>('Open');
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 10 });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchQuotes();
  }, []);

  const fetchQuotes = async () => {
    try {
      const res = await api.get('/api/quotes');
      const normalizedQuotes: Quote[] = (res.data || []).map((quote: any) => ({
        ...quote,
        status: normalizeQuoteStatus(quote.status),
      }));
      setQuotes(normalizedQuotes);
    } catch (e) {
      console.error('Error fetching quotes:', e);
      setError('Failed to fetch quotes');
    }
  };

  const handleDeleteQuote = async (quoteId: number) => {
    if (!window.confirm('Are you sure you want to delete this quote?')) return;
    try {
      await api.delete(`/api/quotes/${quoteId}`);
      setSuccess('Quote deleted successfully');
      fetchQuotes();
    } catch {
      setError('Failed to delete quote');
    }
  };

  const handleExportCSV = () => {
    const csvData = quotes.map((q) => ({
      'Quote #': q.quote_number,
      Customer: q.customer_name,
      Product: q.product_name,
      Make: q.vehicle_make || '',
      Model: q.vehicle_model || '',
      'Est. Price': formatInt(q.estimated_cost),
      'Quote Date': q.quote_date ? format(new Date(q.quote_date), 'MM/dd/yyyy') : '',
      'Valid Until': q.valid_until ? format(new Date(q.valid_until), 'MM/dd/yyyy') : '',
      Status: q.status,
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'quotes.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const lowerSearch = searchTerm.toLowerCase();

  const statusCounts = useMemo(
    () =>
      quotes.reduce(
        (acc, quote) => {
          acc[quote.status] = (acc[quote.status] ?? 0) + 1;
          return acc;
        },
        { Open: 0, Approved: 0, Rejected: 0 } as Record<QuoteStatus, number>
      ),
    [quotes]
  );

  const filteredQuotes = useMemo(() => {
    const byStatus = quotes.filter((q) => q.status === statusFilter);
    if (!lowerSearch) {
      return byStatus;
    }

    return byStatus.filter(
      (q) =>
        q.quote_number?.toLowerCase?.().includes(lowerSearch) ||
        q.customer_name?.toLowerCase?.().includes(lowerSearch) ||
        q.product_name?.toLowerCase?.().includes(lowerSearch) ||
        q.vehicle_make?.toLowerCase?.().includes(lowerSearch) ||
        q.vehicle_model?.toLowerCase?.().includes(lowerSearch)
    );
  }, [quotes, statusFilter, lowerSearch]);

  const getStatusChipStyles = (status: QuoteStatus) => {
    switch (status) {
      case 'Approved':
        return { backgroundColor: 'rgba(76, 175, 80, 0.12)', color: '#2e7d32' };
      case 'Rejected':
        return { backgroundColor: 'rgba(244, 67, 54, 0.12)', color: '#c62828' };
      default:
        return { backgroundColor: 'rgba(33, 150, 243, 0.12)', color: '#1565c0' };
    }
  };

  const rows = filteredQuotes.map((q) => ({ ...q, id: q.quote_id }));

  const columns: GridColDef[] = [
    { field: 'quote_number', headerName: 'Quote #', flex: 1.05, minWidth: 150, valueFormatter: (params) => params.value ? String(params.value).replace('QO-', '') : '' },
    { field: 'customer_name', headerName: 'Customer', flex: 1.2, minWidth: 170 },
    { field: 'product_name', headerName: 'Product', flex: 1.1, minWidth: 160 },
    { field: 'vehicle_make', headerName: 'Make', flex: 0.9, minWidth: 130 },
    { field: 'vehicle_model', headerName: 'Model', flex: 0.9, minWidth: 130 },
    {
      field: 'estimated_cost',
      headerName: 'Est. Price',
      type: 'number',
      flex: 0.8,
      minWidth: 110,
      headerAlign: 'left',
      align: 'left',
      valueFormatter: (p) => formatInt(p.value),
    },
    {
      field: 'quote_date',
      headerName: 'Quote Date',
      flex: 0.95,
      minWidth: 130,
      valueFormatter: (p) => (p.value ? format(new Date(p.value as string), 'yyyy-MM-dd') : ''),
    },
    {
      field: 'valid_until',
      headerName: 'Valid Until',
      flex: 0.95,
      minWidth: 130,
      valueFormatter: (p) => (p.value ? format(new Date(p.value as string), 'yyyy-MM-dd') : ''),
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.8,
      minWidth: 130,
      sortable: false,
      renderCell: (params) => {
        const status = params.value as QuoteStatus;
        const styles = getStatusChipStyles(status);
        return <Chip label={status} size="small" sx={{ fontWeight: 600, ...styles }} />;
      },
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      flex: 0,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                const id = (params.row as Quote).quote_id;
                handleDeleteQuote(id);
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  const handleRowClick = (params: GridRowParams) => {
    const q = params.row as Quote;
    navigate(`/quotes/${q.quote_id}`);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
          Quotes
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={() => navigate('/quotes/new')}>
            NEW QUOTE
          </Button>
          <Button variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleExportCSV}>
            EXPORT CSV
          </Button>
        </Stack>
      </Box>

      {/* Table */}
      <Paper
        sx={{ width: '100%', overflow: 'hidden', mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
        elevation={0}
      >
        <Box sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2.5}
            alignItems={{ xs: 'stretch', md: 'center' }}
            justifyContent="space-between"
            sx={{ mb: 3 }}
          >
            <TextField
              label="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 32 }} />
                  </InputAdornment>
                ),
                sx: { fontSize: 22, height: 56 },
              }}
              sx={{
                width: { xs: '100%', md: 360 },
                '& .MuiInputBase-input': { fontSize: 22, py: 2 },
                '& .MuiInputLabel-root': { fontSize: 20 },
              }}
              size="medium"
              variant="outlined"
            />
            <Stack
              direction="row"
              spacing={1.5}
              flexWrap="wrap"
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
            >
              <Chip
                label={`Open (${statusCounts.Open})`}
                onClick={() => setStatusFilter('Open')}
                color={statusFilter === 'Open' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 110, height: 44 }}
              />
              <Chip
                label={`Approved (${statusCounts.Approved})`}
                onClick={() => setStatusFilter('Approved')}
                color={statusFilter === 'Approved' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 110, height: 44 }}
              />
              <Chip
                label={`Rejected (${statusCounts.Rejected})`}
                onClick={() => setStatusFilter('Rejected')}
                color={statusFilter === 'Rejected' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 110, height: 44 }}
              />
            </Stack>
          </Stack>

          <DataGrid
            rows={rows}
            columns={columns}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50]}
            getRowId={(row) => row.id}
            onRowClick={handleRowClick}
            disableRowSelectionOnClick
            disableColumnMenu
            hideFooterSelectedRowCount
            initialState={{ sorting: { sortModel: [{ field: 'quote_number', sort: 'desc' }] } }}
            sx={{
              '& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeaderTitle': { fontSize: '1.1rem' },
              '& .MuiDataGrid-cell': { borderBottom: '1px solid rgba(224,224,224,1)' },
              '& .MuiDataGrid-columnHeaders': { backgroundColor: 'background.paper', borderBottom: '2px solid rgba(224,224,224,1)' },
              '& .MuiDataGrid-row': { minHeight: '52px !important', maxHeight: '52px !important' },
              '& .MuiDataGrid-columnHeadersInner': { minHeight: '60px !important', maxHeight: '60px !important' },
              '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' },
              '& .MuiDataGrid-columnSeparator': { display: 'none' },
              cursor: 'pointer',
            }}
          />
        </Box>
      </Paper>

      {/* Snackbars */}
      <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default QuotePage;
