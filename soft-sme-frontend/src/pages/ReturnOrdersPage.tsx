import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  ReturnOrderSummary,
  ReturnOrderStatus,
  downloadReturnOrderPdf,
  fetchReturnOrders,
} from '../services/returnOrderService';

const statusChips: Array<{ label: string; value: ReturnOrderStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Return Requested', value: 'Requested' },
  { label: 'Returned', value: 'Returned' },
];

const ReturnOrdersPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'Requested' | 'Returned' | 'all'>('Requested');
  const [searchTerm, setSearchTerm] = useState('');
  const [orders, setOrders] = useState<ReturnOrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchReturnOrders(statusFilter);
      setOrders(data);
    } catch (error) {
      console.error('Failed to load return orders', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const term = searchTerm.toLowerCase();
    return orders.filter((order) => {
      return (
        order.return_number?.toLowerCase().includes(term) ||
        order.purchase_number?.toLowerCase().includes(term) ||
        order.vendor_name?.toLowerCase().includes(term)
      );
    });
  }, [orders, searchTerm]);

  const columns: GridColDef[] = [
    {
      field: 'return_number',
      headerName: 'Return #',
      flex: 1,
      minWidth: 150,
      renderCell: (params) => (
        <Typography color="primary" sx={{ cursor: 'pointer' }}>
          {params.value}
        </Typography>
      ),
    },
    {
      field: 'purchase_number',
      headerName: 'Purchase Order',
      flex: 1,
      minWidth: 150,
      renderCell: (params) => (
        <Typography color="primary" sx={{ cursor: 'pointer' }}>
          {params.value || '-'}
        </Typography>
      ),
    },
    {
      field: 'vendor_name',
      headerName: 'Vendor',
      flex: 1.3,
      minWidth: 160,
      valueGetter: (params) => params.value || 'No Vendor',
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.8,
      minWidth: 130,
      renderCell: (params: GridRenderCellParams<ReturnOrderSummary, string>) => (
        <Chip
          label={params.value}
          color={params.value === 'Returned' ? 'success' : 'warning'}
          variant="outlined"
          size="small"
        />
      ),
    },
    {
      field: 'requested_at',
      headerName: 'Requested On',
      flex: 0.9,
      minWidth: 150,
      valueFormatter: (params) =>
        params.value ? dayjs(params.value as string).format('YYYY-MM-DD HH:mm') : '',
    },
    {
      field: 'returned_at',
      headerName: 'Returned On',
      flex: 0.9,
      minWidth: 150,
      valueFormatter: (params) =>
        params.value ? dayjs(params.value as string).format('YYYY-MM-DD HH:mm') : '',
    },
    {
      field: 'total_quantity',
      headerName: 'Total Qty',
      flex: 0.6,
      minWidth: 110,
      type: 'number',
      valueFormatter: (params) => Number(params.value ?? 0).toFixed(2),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      sortable: false,
      filterable: false,
      width: 120,
      renderCell: (params) => (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            startIcon={<DownloadIcon fontSize="small" />}
            onClick={async (event) => {
              event.stopPropagation();
              const ok = await downloadReturnOrderPdf(Number(params.row.return_id));
              if (!ok) {
                toast.error('Failed to download return order PDF. Please try again.');
              }
            }}
          >
            PDF
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Return Orders
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/return-orders/new')}
          >
            New Return Order
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadOrders}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
        <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} sx={{ mb: 3 }}>
              <TextField
                label="Search"
                variant="outlined"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 32 }} />
                    </InputAdornment>
                  ),
                  sx: { fontSize: 22, height: 56 },
                }}
                sx={{
                  minWidth: 340,
                  maxWidth: 400,
                  '& .MuiInputBase-input': { fontSize: 22, py: 2 },
                  '& .MuiInputLabel-root': { fontSize: 20 },
                }}
                size="medium"
              />
              {statusChips.map((chip) => (
                <Chip
                  key={chip.value}
                  label={chip.label}
                  onClick={() => setStatusFilter(chip.value)}
                  color={statusFilter === chip.value ? 'primary' : 'default'}
                  sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
                />
              ))}
            </Stack>
            <DataGrid
              rows={filteredOrders}
              columns={columns}
              loading={loading}
              getRowId={(row) => row.return_id}
              disableRowSelectionOnClick
              onRowClick={(params) => navigate(`/return-orders/${params.row.return_id}`)}
              sx={{
                '& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeaderTitle': {
                  fontSize: '1.1rem',
                },
                '& .MuiDataGrid-cell': {
                  borderBottom: '1px solid rgba(224,224,224,1)',
                  cursor: 'pointer',
                },
                '& .MuiDataGrid-columnHeaders': {
                  backgroundColor: 'background.paper',
                  borderBottom: '2px solid rgba(224,224,224,1)',
                },
                '& .MuiDataGrid-row': { minHeight: '52px !important', maxHeight: '52px !important' },
                '& .MuiDataGrid-columnHeadersInner': { minHeight: '60px !important', maxHeight: '60px !important' },
                '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' },
                cursor: 'pointer',
              }}
            />
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default ReturnOrdersPage;
