import React, { useState, useEffect } from 'react';
import { Typography, Box, TextField, Stack, Button, Container, Paper, Chip, IconButton, InputAdornment, CircularProgress, Alert } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridPaginationModel,
  GridRenderCellParams,
  GridTreeNodeWithRender,
} from '@mui/x-data-grid';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axios';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { toast } from 'react-toastify';
import { AxiosError } from 'axios';
import dayjs from 'dayjs';
import Papa from 'papaparse';
import { getPurchaseOrders, PurchaseOrder } from '../services/purchaseOrderService';
import { useAuth } from '../contexts/AuthContext';

const OpenPurchaseOrdersPage: React.FC = () => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'open' | 'closed'>('open');
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const fetchPurchaseOrders = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/purchase-history', {
        params: {
          status: selectedStatus,
          searchTerm: searchTerm || undefined,
        },
      });
      
      // Sort by sequence number (extracted from purchase_number) with latest on top
      const sortedOrders = response.data.sort((a: any, b: any) => {
        const getSequenceNumber = (purchaseNumber: string) => {
          const match = purchaseNumber.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };
        
        const seqA = getSequenceNumber(a.purchase_number);
        const seqB = getSequenceNumber(b.purchase_number);
        return seqB - seqA; // Descending order (latest first)
      });
      
      setPurchaseOrders(sortedOrders);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      setPurchaseOrders([]);
      toast.error('Failed to fetch purchase orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPurchaseOrders();
  }, [selectedStatus, searchTerm]);

  const handleDelete = (id: number) => {
    if (window.confirm('Are you sure you want to delete this purchase order?')) {
      handleDeleteConfirmed(id);
    }
  };

  const handleDeleteConfirmed = async (id: number) => {
    try {
      await api.delete(`/api/purchase-orders/${id}`);
      toast.success('Purchase order deleted successfully');
      fetchPurchaseOrders();
    } catch (error) {
      console.error('Error deleting purchase order:', error);
      toast.error('Failed to delete purchase order');
    }
  };



  const handleExportCSV = () => {
    // Filter orders based on current status selection
    let exportOrders = purchaseOrders;
    if (selectedStatus === 'open') {
      exportOrders = purchaseOrders.filter(order => order.status === 'Open');
    } else if (selectedStatus === 'closed') {
      exportOrders = purchaseOrders.filter(order => order.status === 'Closed');
    }
    // If selectedStatus is 'all', use all purchaseOrders

    const csv = Papa.unparse(exportOrders);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `purchase_orders_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    // Use backend PDF generation
    const statusParam = selectedStatus === 'all' ? '' : selectedStatus;
    const url = `/api/purchase-history/export/pdf?status=${statusParam}`;
    window.open(url, '_blank');
  };

  const columns: GridColDef[] = [
    { field: 'purchase_number', headerName: 'Purchase #', flex: 1, minWidth: 120, valueFormatter: (params) => params.value ? String(params.value).replace('PO-', '') : '' },
    { field: 'vendor_name', headerName: 'Vendor', flex: 1.3, minWidth: 150 },
    {
      field: 'created_at',
      headerName: 'Created On',
      flex: 0.9,
      minWidth: 130,
      valueFormatter: (params) => params.value ? new Date(params.value as string).toLocaleDateString() : '',
    },
    { field: 'bill_number', headerName: 'Bill #', flex: 0.9, minWidth: 100 },
    { field: 'subtotal', headerName: 'Subtotal', flex: 0.8, minWidth: 100, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
    { field: 'gst_rate', headerName: 'GST Rate (%)', flex: 0.7, minWidth: 80, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `${Number(params.value).toFixed(2)}%` : '5.00%' },
    { field: 'total_gst_amount', headerName: 'GST', flex: 0.7, minWidth: 80, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
    { field: 'total_amount', headerName: 'Total', flex: 0.8, minWidth: 100, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
    { field: 'status', headerName: 'Status', flex: 0.8, minWidth: 100, 
      renderCell: (params) => (
        <Chip 
          label={params.value} 
          color={params.value === 'Open' ? 'success' : 'error'}
          size="small"
          variant="outlined"
        />
      )
    },
    {
      field: 'qbo_exported',
      headerName: 'QBO Exported',
      flex: 0.8,
      minWidth: 120,
      renderCell: (params) => {
        if (params.row.exported_to_qbo) {
          return <CheckCircleIcon color="success" titleAccess="Exported to QuickBooks" />;
        } else if (params.row.qbo_export_status) {
          return <ErrorIcon color="error" titleAccess={`QBO Export Error: ${params.row.qbo_export_status}`} />;
        } else if (params.row.status === 'Closed') {
          return <HourglassEmptyIcon color="warning" titleAccess="Not exported to QuickBooks" />;
        } else {
          return null;
        }
      }
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 100,
      sortable: false,
      renderCell: (params: GridRenderCellParams<PurchaseOrder, any, any, GridTreeNodeWithRender>) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {params.row.status !== 'Closed' && (
            <IconButton
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(params.row.purchase_id);
              }}
            >
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      ),
    },
  ];

  return (
    <Container maxWidth="xl" sx={{ mt: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {selectedStatus === 'open' 
            ? 'Open Purchase Orders' 
            : selectedStatus === 'closed' 
              ? 'Purchase Order History' 
              : 'All Purchase Orders'
            }
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/open-purchase-orders/new')}
          >
            New PO
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
          >
            Export CSV
          </Button>
        </Stack>
        <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} sx={{ mb: 3 }}>
              <TextField
                label="Search"
                variant="outlined"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 32 }} />
                    </InputAdornment>
                  ),
                  sx: { fontSize: 22, height: 56 }
                }}
                sx={{ minWidth: 340, maxWidth: 400, '& .MuiInputBase-input': { fontSize: 22, py: 2 }, '& .MuiInputLabel-root': { fontSize: 20 } }}
                size="medium"
              />
              <Chip
                label="All"
                onClick={() => setSelectedStatus('all')}
                color={selectedStatus === 'all' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
              />
              <Chip
                label="Open"
                onClick={() => setSelectedStatus('open')}
                color={selectedStatus === 'open' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
              />
              <Chip
                label="Closed"
                onClick={() => setSelectedStatus('closed')}
                color={selectedStatus === 'closed' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
              />
            </Stack>
            <DataGrid
              rows={purchaseOrders}
              columns={columns}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50]}
              getRowId={(row) => row.purchase_id}
              disableRowSelectionOnClick
              initialState={{
                sorting: {
                  sortModel: [{ field: 'purchase_number', sort: 'desc' }],
                },
              }}
              onRowClick={(params) => {
                // For purchase and sales users, always route to the main detail page
                // For other users, route closed orders to read-only view
                const status = params.row.status?.toLowerCase();
                if (status === 'closed') {
                  navigate(`/purchase-order/${params.row.purchase_id}`);
                } else {
                  navigate(`/open-purchase-orders/${params.row.purchase_id}`);
                }
              }}
              sx={{
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
                cursor: 'pointer',
              }}
            />
          </Box>
        </Paper>
      </Box>


    </Container>
  );
};

export default OpenPurchaseOrdersPage; 