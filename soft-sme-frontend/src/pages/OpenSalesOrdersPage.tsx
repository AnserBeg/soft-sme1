import React, { useState, useEffect } from 'react';
import { Typography, Box, TextField, Stack, Button, Container, Paper, TableContainer, Table, TableHead, TableRow, TableBody, TableCell, Chip, IconButton, ToggleButton, ToggleButtonGroup, Alert, CircularProgress } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridPaginationModel,
  GridActionsCellItem,
  GridColumnVisibilityModel,
} from '@mui/x-data-grid';
import Papa from 'papaparse';
import { useNavigate, useLocation } from 'react-router-dom';
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
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { InputAdornment } from '@mui/material';
import { parseNumericInput } from '../utils/salesOrderCalculations';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { Checkbox, FormControlLabel, FormGroup, Popover } from '@mui/material';

const normalizeInvoiceStatus = (value: any): '' | 'needed' | 'done' => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['needed', 'need', 'required', 'pending'].includes(normalized)) return 'needed';
    if (['done', 'complete', 'completed', 'sent'].includes(normalized)) return 'done';
    if (['true', 't', 'yes', 'y', '1', 'on'].includes(normalized)) return 'needed';
    if (['false', 'f', 'no', 'n', '0', 'off', ''].includes(normalized)) return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'needed' : '';
  }
  return '';
};

const isActiveSalesOrderStatus = (value?: string) => {
  const normalized = String(value || '').toLowerCase();
  return normalized === 'open' || normalized === 'in progress' || normalized === 'completed';
};

const OpenSalesOrdersPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState<'all' | 'open' | 'in_progress' | 'completed' | 'closed'>('open');
  const [workInProcessTotal, setWorkInProcessTotal] = useState<number>(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [openDialog, setOpenDialog] = useState(false);
  const COLUMN_VISIBILITY_STORAGE_KEY = 'openSalesOrders.columnVisibility';
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<GridColumnVisibilityModel>(() => {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (error) {
        console.warn('Failed to parse column visibility model, resetting to defaults', error);
      }
    }
    return {};
  });
  const [columnSelectorAnchor, setColumnSelectorAnchor] = useState<HTMLElement | null>(null);
  const [columnSelectorColumns, setColumnSelectorColumns] = useState<GridColDef[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibilityModel));
    }
  }, [columnVisibilityModel]);

  const handleOpenColumnSelector = (event: React.MouseEvent<HTMLElement>, availableColumns: GridColDef[]) => {
    setColumnSelectorColumns(availableColumns);
    setColumnSelectorAnchor(event.currentTarget);
  };

  const handleCloseColumnSelector = () => setColumnSelectorAnchor(null);

  const ColumnSelectorPopover = (
    <Popover
      open={Boolean(columnSelectorAnchor)}
      anchorEl={columnSelectorAnchor}
      onClose={handleCloseColumnSelector}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box sx={{ p: 2, maxWidth: 280 }}>
        <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
          Show / Hide Columns
        </Typography>
        <FormGroup>
          {columnSelectorColumns
            .filter((col) => col.field !== 'actions')
            .map((col) => (
              <FormControlLabel
                key={col.field}
                control={
                  <Checkbox
                    size="small"
                    checked={columnVisibilityModel[col.field] !== false}
                    onChange={(e) =>
                      setColumnVisibilityModel((prev) => ({
                        ...prev,
                        [col.field]: e.target.checked,
                      }))
                    }
                  />
                }
                label={col.headerName || col.field}
              />
            ))}
        </FormGroup>
      </Box>
    </Popover>
  );


  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: 10,
  });

  const fetchSalesOrders = async (statusFilter = status) => {
    try {
      const role = user?.access_role;
      const isTimeTrackingUser = role === 'Time Tracking';
      const requestedStatus = isTimeTrackingUser ? 'in_progress' : statusFilter;

      const isSalesPurchaseUser = role === 'Sales and Purchase';
      const allowedSalesPurchaseStatuses = new Set(['open', 'in_progress', 'completed']);
      const effectiveStatusFilter =
        isSalesPurchaseUser && !allowedSalesPurchaseStatuses.has(requestedStatus)
          ? 'open'
          : requestedStatus;

      // Add cache-busting parameter to ensure fresh data
      const response = await api.get('/api/sales-orders', { 
        params: { 
          status: effectiveStatusFilter, 
          _ts: Date.now() 
        } 
      });
      
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
        // Ensure numeric totals (backend may return strings)
        subtotal: Number(order.subtotal) || 0,
        total_gst_amount: Number(order.total_gst_amount) || 0,
        total_amount: Number(order.total_amount) || 0,
        invoice_status: normalizeInvoiceStatus(order.invoice_status ?? order.invoice_required),
      }));
      setRows(ordersWithId);

      // Calculate Work In Process total (sum of subtotals from active orders only)
      if (effectiveStatusFilter === 'open' || effectiveStatusFilter === 'in_progress' || effectiveStatusFilter === 'completed' || effectiveStatusFilter === 'all') {
        const activeOrders = sortedOrders.filter((order: any) => isActiveSalesOrderStatus(order.status));
        const total = activeOrders.reduce((sum: number, order: any) => {
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

  // Refetch when route location changes (e.g., back from detail page)
  useEffect(() => {
    // Add a delay to ensure backend transactions are committed
    setTimeout(() => {
      fetchSalesOrders(status);
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Refresh when the window/tab regains focus or becomes visible
  useEffect(() => {
    const onFocus = () => fetchSalesOrders(status);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchSalesOrders(status);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status]);

  const buildLineItemsPayload = (items: any[]) =>
    (items || []).map((it: any) => {
      const pn = String(it.part_number || '').toUpperCase();

      const base = {
        part_number: String(it.part_number || ''),
        part_description: String(it.part_description || ''),
        unit: String(it.unit || ''),
        // For SUPPLY we always force 0; backend should ignore this anyway.
        unit_price: pn === 'SUPPLY' ? 0 : (Number(it.unit_price) || 0),
        // Always preserve the UI/server computed amount
        line_amount: Number(it.line_amount) || 0,
        ...(it.part_id ? { part_id: Number(it.part_id) } : {}),
      };

      if (pn === 'SUPPLY') {
        // SUPPLY is % of LABOUR: quantity 1, unit Each, unit_price 0
        return { ...base, unit: 'Each', quantity: 1 };
      }

      if (pn === 'LABOUR' || pn === 'OVERHEAD') {
        // Hours come from quantity/quantity_sold; preserve the exact line_amount
        const hours = Number(it.quantity_sold ?? it.quantity ?? 0) || 0;
        return { ...base, quantity: hours };
      }

      // Normal inventory part
      return {
        ...base,
        quantity: Number(it.quantity_sold ?? it.quantity ?? 0) || 0,
      };
    });

  const handleCloseOrder = async (salesOrderId: number) => {
    if (window.confirm(`Are you sure you want to close this Sales Order?`)) {
      try {
        // Fetch the full sales order details first
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        // Send all fields, but with status: 'Closed'
        const { subtotal, total_gst_amount, total_amount, ...salesOrderWithoutTotals } = salesOrder;
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrderWithoutTotals,
          status: 'Closed',
          lineItems: buildLineItemsPayload(lineItems || []),
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

  const handleStartOrder = async (salesOrderId: number) => {
    if (window.confirm(`Move this Sales Order to In Progress?`)) {
      try {
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        const { subtotal, total_gst_amount, total_amount, ...salesOrderWithoutTotals } = salesOrder;
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrderWithoutTotals,
          status: 'In Progress',
          lineItems: buildLineItemsPayload(lineItems || []),
        });

        toast.success('Sales Order moved to In Progress!');
        fetchSalesOrders();
      } catch (error: any) {
        console.error('Error moving sales order to in progress:', error);
        let errorMessage = 'Failed to move sales order to In Progress.';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.details) {
          errorMessage = error.response.data.details;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        toast.error(errorMessage);
      }
    }
  };

  const handleCompleteOrder = async (salesOrderId: number) => {
    if (window.confirm(`Mark this Sales Order as completed?`)) {
      try {
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        const { subtotal, total_gst_amount, total_amount, ...salesOrderWithoutTotals } = salesOrder;
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrderWithoutTotals,
          status: 'Completed',
          lineItems: buildLineItemsPayload(lineItems || []),
        });

        toast.success('Sales Order marked as completed!');
        fetchSalesOrders();
      } catch (error: any) {
        console.error('Error completing sales order:', error);
        let errorMessage = 'Failed to mark sales order as completed.';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.details) {
          errorMessage = error.response.data.details;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        toast.error(errorMessage);
      }
    }
  };

  const handleBackStage = async (salesOrderId: number, currentStatus: string) => {
    const normalized = String(currentStatus || '').toLowerCase();
    const targetStatus = normalized === 'in progress'
      ? 'Open'
      : normalized === 'completed'
        ? 'In Progress'
        : normalized === 'closed'
          ? 'Completed'
          : null;
    if (!targetStatus) return;

    if (window.confirm(`Move this Sales Order back to ${targetStatus}?`)) {
      try {
        const response = await api.get(`/api/sales-orders/${salesOrderId}`);
        const { salesOrder, lineItems } = response.data;

        const { subtotal, total_gst_amount, total_amount, ...salesOrderWithoutTotals } = salesOrder;
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrderWithoutTotals,
          status: targetStatus,
          lineItems: buildLineItemsPayload(lineItems || []),
        });

        toast.success(`Sales Order moved back to ${targetStatus}!`);
        fetchSalesOrders();
      } catch (error: any) {
        console.error('Error moving sales order back a stage:', error);
        let errorMessage = 'Failed to move sales order back a stage.';
        if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        } else if (error.response?.data?.details) {
          errorMessage = error.response.data.details;
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        toast.error(errorMessage);
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
        const { subtotal, total_gst_amount, total_amount, ...salesOrderWithoutTotals } = salesOrder;
        await api.put(`/api/sales-orders/${salesOrderId}`, {
          ...salesOrderWithoutTotals,
          sales_order_id: Number(salesOrder.sales_order_id),
          customer_id: Number(salesOrder.customer_id),
          status: 'Open',
          lineItems: buildLineItemsPayload(lineItems || []),
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




  const searchTerm = search.toLowerCase();

  const filteredRows = rows.filter((row) =>
    [
      row.sales_order_number,
      row.customer_name,
      row.product_name,
      row.product_description,
      row.unit_number,
      row.mileage,
      row.vin_number,
      row.vehicle_year,
      row.sales_date ? new Date(row.sales_date).toLocaleDateString() : '',
      row.wanted_by_date ? new Date(row.wanted_by_date).toLocaleDateString() : '',
      row.wanted_by_time_of_day,
    ]
      .filter((value) => value !== undefined && value !== null)
      .some((value) => value.toString().toLowerCase().includes(searchTerm))
  );
  const isTimeTrackingUser = user?.access_role === 'Time Tracking';
  const timeTrackingRows = isTimeTrackingUser
    ? filteredRows.filter((row) => String(row.status || '').toLowerCase() === 'in progress')
    : filteredRows;

  const columns: GridColDef[] = [
    { field: 'sales_order_number', headerName: 'Sales Order #', flex: 1, minWidth: 120, valueFormatter: (params) => params.value ? String(params.value).replace('SO-', '') : '' },
    { field: 'sales_date', headerName: 'Sales Date', flex: 0.9, minWidth: 130, valueFormatter: (params) => params.value ? new Date(params.value as string).toLocaleDateString() : '' },
    { field: 'wanted_by_date', headerName: 'Wanted By Date', flex: 0.9, minWidth: 140, valueFormatter: (params) => params.value ? new Date(params.value as string).toLocaleDateString() : '' },
    { field: 'wanted_by_time_of_day', headerName: 'Wanted Time', flex: 0.8, minWidth: 120, valueFormatter: (params) => params.value ? `${String(params.value).charAt(0).toUpperCase()}${String(params.value).slice(1)}` : '' },
    { field: 'customer_name', headerName: 'Customer', flex: 1.3, minWidth: 150 },
    { field: 'product_name', headerName: 'Product Name', flex: 1, minWidth: 120 },
    { field: 'product_description', headerName: 'Product Description', flex: 1.5, minWidth: 150 },
    { field: 'unit_number', headerName: 'Unit #', flex: 0.9, minWidth: 110 },
    { field: 'mileage', headerName: 'Mileage', flex: 0.8, minWidth: 100 },
    { field: 'vin_number', headerName: 'VIN #', flex: 1, minWidth: 140 },
    { field: 'vehicle_year', headerName: 'Year', flex: 0.7, minWidth: 90 },
    { field: 'subtotal', headerName: 'Subtotal', flex: 0.8, minWidth: 100, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
    { field: 'total_amount', headerName: 'Total', flex: 0.8, minWidth: 100, valueFormatter: (params) => params.value != null && !isNaN(Number(params.value)) ? `$${Number(params.value).toFixed(2)}` : '$0.00' },
    { field: 'status', headerName: 'Status', flex: 0.8, minWidth: 100,
      renderCell: (params) => {
        const normalized = String(params.value || '').toLowerCase();
        const color = normalized === 'open'
          ? 'success'
          : normalized === 'in progress'
            ? 'info'
            : normalized === 'completed'
              ? 'warning'
              : 'error';
        return (
          <Chip
            label={params.value}
            color={color}
            size="small"
            variant="outlined"
          />
        );
      }
    },
    {
      field: 'invoice_status',
      headerName: 'Invoice',
      flex: 0.6,
      minWidth: 90,
      valueFormatter: (params) => {
        if (params.value === 'done') return 'Done';
        if (params.value === 'needed') return 'Needed';
        return '';
      },
      renderCell: (params) => {
        if (params.value === 'done') {
          return <CheckCircleIcon color="success" titleAccess="Invoice done" />;
        }
        if (params.value === 'needed') {
          return <CancelIcon color="error" titleAccess="Invoice needed" />;
        }
        return null;
      },
      sortable: false,
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
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {String(params.row.status || '').toLowerCase() === 'open' && (
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleStartOrder(params.row.sales_order_id);
              }}
              aria-label="Move to in progress"
            >
              <PlayArrowIcon />
            </IconButton>
          )}
          {String(params.row.status || '').toLowerCase() === 'in progress' && (
            <IconButton
              size="small"
              color="success"
              onClick={(e) => {
                e.stopPropagation();
                handleCompleteOrder(params.row.sales_order_id);
              }}
              aria-label="Mark completed"
            >
              <DoneAllIcon />
            </IconButton>
          )}
          {String(params.row.status || '').toLowerCase() === 'completed' && (
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseOrder(params.row.sales_order_id);
              }}
              aria-label="Close sales order"
            >
              <CloseIcon />
            </IconButton>
          )}
          {['in progress', 'completed', 'closed'].includes(String(params.row.status || '').toLowerCase()) && (
            <IconButton
              size="small"
              color="secondary"
              onClick={(e) => {
                e.stopPropagation();
                handleBackStage(params.row.sales_order_id, params.row.status);
              }}
              aria-label="Move back a stage"
            >
              <ReplayIcon />
            </IconButton>
          )}
          {String(params.row.status || '').toLowerCase() !== 'closed' && (
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
    // Add a delay to ensure backend transactions are committed
    setTimeout(() => {
      fetchSalesOrders();
    }, 500);
  };

  const handleExportCSV = () => {
    // Filter rows based on current status selection
    let exportRows = filteredRows;
    if (status === 'open') {
      exportRows = filteredRows.filter((row) => String(row.status || '').toLowerCase() === 'open');
    } else if (status === 'in_progress') {
      exportRows = filteredRows.filter((row) => String(row.status || '').toLowerCase() === 'in progress');
    } else if (status === 'completed') {
      exportRows = filteredRows.filter((row) => String(row.status || '').toLowerCase() === 'completed');
    } else if (status === 'closed') {
      exportRows = filteredRows.filter((row) => String(row.status || '').toLowerCase() === 'closed');
    }
    // If status is 'all', use all filteredRows

    const csv = Papa.unparse(exportRows.map(row => {
        const csvRow: any = {};
        columns.forEach(col => {
            if (col.field !== 'actions') {
                const value = (row as any)[col.field];
                if (col.field === 'bill_date' || col.field === 'sales_date' || col.field === 'wanted_by_date') {
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
    
    const targetPath = `/open-sales-orders/${params.row.sales_order_id}`;
    console.log('OpenSalesOrdersPage: Navigating user to:', targetPath);
    navigate(targetPath);
  };

  if (user?.access_role === 'Time Tracking') {
    // For time tracking users, show only in progress orders and hide delete functionality
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Sales Orders
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<ViewColumnIcon />}
            sx={{ mr: 1 }}
            onClick={(event) => handleOpenColumnSelector(event, columns.filter((col) => col.field !== 'actions'))}
          >
            Columns
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ mr: 1 }}
            onClick={() => navigate('/open-sales-orders/new')}
          >
            New Sales Order
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
          >
            Refresh
            </Button>
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
              rows={timeTrackingRows}
              columns={columns.filter(col => col.field !== 'actions')} // Hide actions column for time tracking users
              loading={false}
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
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
      {ColumnSelectorPopover}
    </Container>
  );
}

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Sales Orders
        </Typography>
        {(status === 'open' || status === 'in_progress' || status === 'completed' || status === 'all') && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              Work In Process: ${workInProcessTotal.toFixed(2)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total subtotal value of all active sales orders
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
              startIcon={<ViewColumnIcon />}
              onClick={(event) => handleOpenColumnSelector(event, columns)}
            >
              Columns
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExportCSV}
            >
              Export CSV
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={handleRefresh}
            >
              Refresh
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
            <Chip
              label="In Progress"
              onClick={() => setStatus('in_progress')}
              color={status === 'in_progress' ? 'primary' : 'default'}
              sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 130, height: 44 }}
            />
            <Chip
              label="Completed"
              onClick={() => setStatus('completed')}
              color={status === 'completed' ? 'primary' : 'default'}
              sx={{ fontSize: 18, px: 3, py: 1.5, minWidth: 110, height: 44 }}
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
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model)}
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

      {ColumnSelectorPopover}
    </Container>
  );
};

export default OpenSalesOrdersPage;
export { OpenSalesOrdersPage };
