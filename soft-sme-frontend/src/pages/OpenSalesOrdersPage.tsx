import React, { useState, useEffect } from 'react';
import { Typography, Box, TextField, Stack, Button, Container, Paper, TableContainer, Table, TableHead, TableRow, TableBody, TableCell, Chip, IconButton, ToggleButton, ToggleButtonGroup, Alert, CircularProgress } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridPaginationModel,
  GridActionsCellItem,
} from '@mui/x-data-grid';
import Papa from 'papaparse';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { toast } from 'react-toastify';
import { AxiosError } from 'axios';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import ReplayIcon from '@mui/icons-material/Replay';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { InputAdornment } from '@mui/material';
import { parseNumericInput } from '../utils/salesOrderCalculations';

const OpenSalesOrdersPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('open');
  const [workInProcessTotal, setWorkInProcessTotal] = useState<number>(0);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [openDialog, setOpenDialog] = useState(false);


  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  const fetchSalesOrders = async (statusFilter = status) => {
    try {
      // For Sales and Purchase users, only fetch open sales orders
      const effectiveStatusFilter = user?.access_role === 'Sales and Purchase' ? 'open' : statusFilter;
      
      const response = await api.get('/api/sales-orders', { params: { status: effectiveStatusFilter } });
      
      // Sort by sequence number (extracted from sales_order_number) with latest on top
      const sortedOrders = response.data.sort((a: any, b: any) => {
        const getSequenceNumber = (salesOrderNumber: string) => {
          const match = salesOrderNumber.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        };
        
        const seqA = getSequenceNumber(a.sales_order_number);
        const seqB = getSequenceNumber(b.sales_order_number);
        return seqB - seqA; // Descending order (latest first)
      });
      
      const ordersWithId = sortedOrders.map((order: any) => ({
        ...order,
        id: order.sales_order_id,
        // Use backend summary fields directly, do not recalculate
        subtotal: order.subtotal,
        total_gst_amount: order.total_gst_amount,
        total_amount: order.total_amount,
      }));
      setRows(ordersWithId);

      // Calculate Work In Process total (sum of subtotals from open orders only)
      if (statusFilter === 'open' || statusFilter === 'all') {
        const openOrders = statusFilter === 'open' ? sortedOrders : sortedOrders.filter((order: any) => order.status === 'Open');
        const total = openOrders.reduce((sum: number, order: any) => {
          const subtotal = parseFloat(order.subtotal) || 0;
          return sum + subtotal;
        }, 0);
        setWorkInProcessTotal(total);
      } else {
        setWorkInProcessTotal(0);
      }
    } catch (error) {
      console.error('Error fetching sales orders:', error);
      setRows([]);
      setWorkInProcessTotal(0);
    }
  };

  useEffect(() => {
    fetchSalesOrders(status);
  }, [status, user?.access_role]);

  const handleCloseOrder = async (salesOrderId: number) => {
    if (window.confirm(`Are you sure you want to close this Sales Order?`)) {
      try {
        // Fetch the full sales order details first
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        // Send all fields, but with status: 'Closed'
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrder,
          status: 'Closed',
          lineItems: lineItems.map((item: any) => ({
            part_number: item.part_number,
            part_description: item.part_description,
            quantity: item.quantity, // or quantity_sold depending on your backend
            unit: item.unit,
            unit_price: item.unit_price,
            line_amount: item.line_amount,
          })),
        });

        toast.success('Sales Order closed successfully!');
        fetchSalesOrders(); // Refresh the list
      } catch (error: any) {
        console.error('Error closing sales order:', error);
        let errorMessage = 'Failed to close sales order.';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.details) {
          errorMessage = error.response.data.details;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        if (
          errorMessage.toLowerCase().includes('insufficient inventory') ||
          errorMessage.toLowerCase().includes('insufficient quantity') ||
          errorMessage.toLowerCase().includes('negative inventory')
        ) {
          toast.error(`Inventory Error: ${errorMessage}`);
        } else {
          toast.error(errorMessage);
        }
      }
    }
  };

  const handleDeleteOrder = async (salesOrderId: number) => {
    if (window.confirm(`Are you sure you want to delete this Sales Order? This action cannot be undone.`)) {
      try {
        await api.delete(`/api/sales-orders/${salesOrderId}`);
        toast.success('Sales Order deleted successfully!');
        fetchSalesOrders(); // Refresh the list
      } catch (error) {
        console.error('Error deleting sales order:', error);
        toast.error('Failed to delete sales order.');
      }
    }
  };

  const handleReopenOrder = async (salesOrderId: number) => {
    if (window.confirm(`Are you sure you want to reopen this Sales Order?`)) {
      try {
        // Fetch the full sales order details first
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        // Send all fields, but with status: 'Open'
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrder,
          sales_order_id: Number(salesOrder.sales_order_id),
          customer_id: Number(salesOrder.customer_id),
          status: 'Open',
          lineItems: lineItems.map((item: any) => ({
            part_number: item.part_number,
            part_description: item.part_description,
            quantity: Number(item.quantity),
            unit: item.unit,
            unit_price: Number(item.unit_price),
            line_amount: Number(item.line_amount),
          })),
        });

        toast.success('Sales Order reopened successfully!');
        fetchSalesOrders(); // Refresh the list
      } catch (error: any) {
        console.error('Error reopening sales order:', error);
        let errorMessage = 'Failed to reopen sales order.';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.details) {
          errorMessage = error.response.data.details;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        if (
          errorMessage.toLowerCase().includes('insufficient inventory') ||
          errorMessage.toLowerCase().includes('insufficient quantity') ||
          errorMessage.toLowerCase().includes('negative inventory')
        ) {
          toast.error(`Inventory Error: ${errorMessage}`);
        } else {
          toast.error(errorMessage);
        }
      }
    }
  };




  const filteredRows = rows.filter((row) =>
    row.sales_order_number?.toLowerCase().includes(search.toLowerCase()) ||
    row.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    row.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    row.product_description?.toLowerCase().includes(search.toLowerCase())
  );

  const columns: GridColDef[] = [
    { field: 'sales_order_number', headerName: 'Sales Order #', flex: 1, minWidth: 120 },
    { field: 'customer_name', headerName: 'Customer', flex: 1.3, minWidth: 150 },
    { field: 'product_name', headerName: 'Product Name', flex: 1, minWidth: 120 },
    { field: 'product_description', headerName: 'Product Description', flex: 1.5, minWidth: 150 },
    { field: 'subtotal', headerName: 'Subtotal', flex: 0.8, minWidth: 100, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
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
      field: 'exported_to_qbo',
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
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {params.row.status !== 'Closed' && (
            <IconButton size="small" color="error" onClick={(e) => {
              e.stopPropagation();
              handleDeleteOrder(params.row.sales_order_id);
            }}>
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      ),
    },
  ];

  const handleRefresh = () => {
    fetchSalesOrders();
  };

  const handleExportCSV = () => {
    // Filter rows based on current status selection
    let exportRows = filteredRows;
    if (status === 'open') {
      exportRows = filteredRows.filter(row => row.status === 'Open');
    } else if (status === 'closed') {
      exportRows = filteredRows.filter(row => row.status === 'Closed');
    }
    // If status is 'all', use all filteredRows

    const csv = Papa.unparse(exportRows.map(row => {
        const csvRow: any = {};
        columns.forEach(col => {
            if (col.field !== 'actions') {
                const value = (row as any)[col.field];
                if (col.field === 'bill_date' || col.field === 'sales_date') {
                     csvRow[col.headerName as string] = value ? new Date(value).toLocaleDateString() : '';
                } else if (col.type === 'number') { 
                     csvRow[col.headerName as string] = value !== undefined && value !== null && !isNaN(parseFloat(String(value))) ? parseFloat(String(value)).toFixed(2) : '';
                } else {
                     csvRow[col.headerName as string] = value !== undefined ? String(value) : '';
                }
            }
        });
        return csvRow;
    }));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'open_sales_orders.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handlePrintPDF = () => {
    // Use backend PDF generation
    const statusParam = status === 'all' ? '' : status;
    const url = `/api/sales-orders/export/pdf?status=${statusParam}`;
    window.open(url, '_blank');
  };

  const handleRowClick = (params: GridRowParams) => {
    console.log('OpenSalesOrdersPage: Row clicked:', params.row);
    console.log('OpenSalesOrdersPage: User role:', user?.access_role);
    console.log('OpenSalesOrdersPage: Sales order ID:', params.row.sales_order_id);
    
    if (user?.access_role === 'Time Tracking') {
      // Redirect time tracking users to the worker sales order page
      const targetPath = `/woker-sales-orders/${params.row.sales_order_id}`;
      console.log('OpenSalesOrdersPage: Navigating time tracking user to:', targetPath);
      navigate(targetPath);
    } else {
      // Regular users go to the normal sales order detail page
      const targetPath = `/open-sales-orders/${params.row.sales_order_id}`;
      console.log('OpenSalesOrdersPage: Navigating regular user to:', targetPath);
      navigate(targetPath);
    }
  };

  if (user?.access_role === 'Time Tracking') {
    // For time tracking users, show all orders but hide delete functionality
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Sales Orders
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            {/* No buttons for time tracking users */}
          </Box>
        </Box>
        <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
              <TextField
                label="Search"
                variant="outlined"
                value={search}
                onChange={e => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 22 }} />
                    </InputAdornment>
                  ),
                }}
                sx={{ minWidth: 340, maxWidth: 400, '& .MuiInputBase-input': { fontSize: 22, py: 2 }, '& .MuiInputLabel-root': { fontSize: 20 } }}
                size="small"
              />
            </Stack>
            <DataGrid
              rows={filteredRows}
              columns={columns.filter(col => col.field !== 'actions')} // Hide actions column for time tracking users
              loading={false}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50]}
              getRowId={(row) => row.id}
              onRowClick={handleRowClick}
              disableRowSelectionOnClick
              initialState={{
                sorting: {
                  sortModel: [{ field: 'sales_order_number', sort: 'desc' }],
                },
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
              }}
            />
          </Box>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {user?.access_role === 'Sales and Purchase' ? 'Sales Orders (Open Only)' : 'Sales Orders'}
        </Typography>
        {(status === 'open' || status === 'all') && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              Work In Process: ${workInProcessTotal.toFixed(2)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total subtotal value of all open sales orders
            </Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Stack direction="row" spacing={2}>
            {user?.access_role !== 'Time Tracking' && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/open-sales-orders/new')}
              >
                New SO
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExportCSV}
            >
              Export CSV
            </Button>
            
          </Stack>
        </Box>
      </Box>
      <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
            <TextField
              label="Search"
              variant="outlined"
              value={search}
              onChange={e => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 22 }} />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 340, maxWidth: 400, '& .MuiInputBase-input': { fontSize: 22, py: 2 }, '& .MuiInputLabel-root': { fontSize: 20 } }}
              size="small"
            />
            {user?.access_role !== 'Sales and Purchase' && (
              <Chip
                label="All"
                onClick={() => setStatus('all')}
                color={status === 'all' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
              />
            )}
            <Chip
              label="Open"
              onClick={() => setStatus('open')}
              color={status === 'open' ? 'primary' : 'default'}
              sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
            />
            {user?.access_role !== 'Sales and Purchase' && (
              <Chip
                label="Closed"
                onClick={() => setStatus('closed')}
                color={status === 'closed' ? 'primary' : 'default'}
                sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 80, height: 44 }}
              />
            )}
          </Stack>
          <DataGrid
            rows={filteredRows}
            columns={columns}
            loading={false}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            pageSizeOptions={[10, 25, 50]}
            getRowId={(row) => row.id}
            onRowClick={handleRowClick}
            disableRowSelectionOnClick
            initialState={{
              sorting: {
                sortModel: [{ field: 'sales_order_number', sort: 'desc' }],
              },
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
            }}
          />
        </Box>
      </Paper>


    </Container>
  );
};

export default OpenSalesOrdersPage;
export { OpenSalesOrdersPage };