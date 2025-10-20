import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
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
import {
  ReturnOrderSummary,
  ReturnOrderStatus,
  downloadReturnOrderPdf,
  fetchReturnOrders,
} from '../services/returnOrderService';

const statusTabs: Array<{ label: string; value: ReturnOrderStatus | 'all' }> = [
  { label: 'Return Requested', value: 'Requested' },
  { label: 'Returned', value: 'Returned' },
  { label: 'All', value: 'all' },
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
            onClick={(event) => {
              event.stopPropagation();
              downloadReturnOrderPdf(Number(params.row.return_id));
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
      <Stack spacing={3}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              Return Orders
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Track requested and completed vendor returns linked to purchase orders.
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadOrders}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/return-orders/new')}
            >
              New Return Order
            </Button>
          </Stack>
        </Box>

        <Paper elevation={0} sx={{ width: '100%', overflow: 'hidden' }}>
          <Box sx={{ p: 2 }}>
            <Stack spacing={3}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems={{ xs: 'stretch', lg: 'center' }}>
                <TextField
                  placeholder="Search return #, purchase #, vendor"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  fullWidth
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 32 }} />
                      </InputAdornment>
                    ),
                    sx: { fontSize: 22, height: 56 },
                  }}
                  sx={{
                    maxWidth: 420,
                    '& .MuiInputBase-input': { fontSize: 22, py: 2 },
                    '& .MuiInputLabel-root': { fontSize: 20 },
                  }}
                />

                <Tabs
                  value={statusFilter}
                  onChange={(_, value) => setStatusFilter(value)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ flexGrow: 1, minHeight: 56 }}
                >
                  {statusTabs.map((tab) => (
                    <Tab
                      key={tab.value}
                      label={tab.label}
                      value={tab.value}
                      sx={{ fontSize: 18, minHeight: 48 }}
                    />
                  ))}
                </Tabs>
              </Stack>

              <DataGrid
                rows={filteredOrders}
                columns={columns}
                loading={loading}
                getRowId={(row) => row.return_id}
                disableRowSelectionOnClick
                onRowClick={(params) => navigate(`/return-orders/${params.row.return_id}`)}
                sx={{
                  border: 'none',
                  height: 520,
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
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
};

export default ReturnOrdersPage;
