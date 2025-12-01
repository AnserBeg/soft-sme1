import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, GridColDef, GridEventListener, GridActionsCellItem } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import { fetchInvoices, downloadMonthlyStatements, deleteInvoice } from '../services/invoiceService';
import { getCustomers } from '../services/customerService';
import { Invoice } from '../types/invoice';
import { formatCurrency } from '../utils/formatters';
import Popover from '@mui/material/Popover';
import { Checkbox, FormControlLabel, FormGroup, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import Autocomplete from '@mui/material/Autocomplete';
import { toast } from 'react-toastify';

interface CustomerOption {
  id: number;
  label: string;
}

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalReceivables: 0, totalOverdue: 0 });
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerValue, setCustomerValue] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('unpaid');
  const [statementMonth, setStatementMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const COLUMN_VISIBILITY_STORAGE_KEY = 'invoices.columnVisibility';
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    const stored = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (stored) {
      try { return JSON.parse(stored); } catch {}
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

  useEffect(() => {
    (async () => {
      try {
        const data = await getCustomers();
        setCustomers(
          data.map((c: any) => ({
            id: c.customer_id || c.id,
            label: c.customer_name,
          }))
        );
      } catch (e) {
        console.error('Failed to load customers', e);
      }
    })();
  }, []);

  const handleOpenColumnSelector = (event: React.MouseEvent<HTMLElement>, cols: GridColDef[]) => {
    setColumnSelectorColumns(cols);
    setColumnSelectorAnchor(event.currentTarget);
  };

  const handleCloseColumnSelector = () => setColumnSelectorAnchor(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchInvoices(customerValue ? { customer_id: customerValue.id } : undefined);
      const withId = data.invoices.map((inv: Invoice) => ({
        ...inv,
        id: inv.invoice_id,
      }));
      setRows(withId);
      setSummary(data.summary);
    } catch (e) {
      console.error('Failed to load invoices', e);
      setRows([]);
      setSummary({ totalReceivables: 0, totalOverdue: 0 });
    } finally {
      setLoading(false);
    }
  }, [customerValue?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRowClick: GridEventListener<'rowClick'> = (params) => {
    navigate(`/invoices/${params.row.invoice_id}`);
  };

  const handleDeleteInvoice = useCallback(
    async (invoiceId: number) => {
      if (!invoiceId) return;
      if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
      try {
        await deleteInvoice(invoiceId);
        toast.success('Invoice deleted.');
        fetchData();
      } catch (error) {
        console.error('Failed to delete invoice', error);
        toast.error('Failed to delete invoice.');
      }
    },
    [fetchData]
  );

  const columns = useMemo<GridColDef[]>(() => {
    const base: GridColDef[] = [
      { field: 'invoice_number', headerName: 'Invoice #', flex: 1, minWidth: 140 },
      { field: 'customer_name', headerName: 'Customer', flex: 1.2, minWidth: 160 },
      { field: 'sales_order_number', headerName: 'SO #', minWidth: 140, flex: 1 },
      { field: 'product_name', headerName: 'Product', minWidth: 140, flex: 1.1 },
      { field: 'product_description', headerName: 'Product Description', minWidth: 200, flex: 1.5 },
      { field: 'vin_number', headerName: 'VIN #', minWidth: 120 },
      { field: 'unit_number', headerName: 'Unit #', minWidth: 120 },
      { field: 'vehicle_make', headerName: 'Make', minWidth: 120 },
      { field: 'vehicle_model', headerName: 'Model', minWidth: 120 },
      {
        field: 'invoice_date',
        headerName: 'Invoice Date',
        minWidth: 130,
        valueFormatter: (params) => (params.value ? new Date(params.value).toLocaleDateString() : ''),
      },
      {
        field: 'due_in',
        headerName: 'Due In',
        minWidth: 140,
        renderCell: (params) => {
          const due = params.row.due_date ? new Date(params.row.due_date) : null;
          if (!due) return '';
          const today = new Date();
          const diffMs = due.getTime() - today.getTime();
          const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const isOverdue = days < 0;
          const label = `${days} day${Math.abs(days) === 1 ? '' : 's'}`;
          return (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography color={isOverdue ? 'error' : 'success.main'} fontWeight={600}>
                {label}
              </Typography>
              {isOverdue && <WarningAmberIcon color="error" fontSize="small" />}
            </Stack>
          );
        },
        valueGetter: (params) => params.row.due_date || null,
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            label={params.value}
            color={params.value === 'Paid' ? 'success' : 'default'}
            size="small"
          />
        ),
      },
      {
        field: 'total_amount',
        headerName: 'Total',
        minWidth: 120,
        valueFormatter: (params) => formatCurrency(Number(params.value) || 0),
      },
    ];
    const actions: GridColDef = {
      field: 'actions',
      headerName: 'Actions',
      type: 'actions',
      width: 90,
      getActions: (params) => {
        if (String(params.row.status || '').toLowerCase() !== 'unpaid') return [];
        return [
          <GridActionsCellItem
            key="delete"
            icon={<DeleteIcon color="error" />}
            label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteInvoice(params.row.invoice_id);
            }}
            showInMenu={false}
          />,
        ];
      },
    };
    return [...base, actions];
  }, [handleDeleteInvoice]);

  const filteredRows = useMemo(() => {
    const term = search.toLowerCase();
    return rows
      .filter((row) => {
        const statusValue = String(row.status || '').toLowerCase();
        if (statusFilter === 'unpaid') return statusValue === 'unpaid';
        if (statusFilter === 'paid') return statusValue === 'paid';
        return true;
      })
      .filter((row) =>
        [
          row.invoice_number,
          row.sales_order_number,
          row.customer_name,
          row.product_name,
          row.product_description,
          row.vin_number,
          row.unit_number,
          row.vehicle_make,
          row.vehicle_model,
          row.invoice_date ? new Date(row.invoice_date).toLocaleDateString() : '',
          row.due_date ? new Date(row.due_date).toLocaleDateString() : '',
        ]
          .filter((value) => value !== undefined && value !== null)
          .some((value) => value.toString().toLowerCase().includes(term))
      );
  }, [rows, search, statusFilter]);

  const overdueCount = useMemo(
    () =>
      rows.filter((r) => {
        const due = r.due_date ? new Date(r.due_date) : null;
        return r.status === 'Unpaid' && due && due < new Date();
      }).length,
    [rows]
  );

  const handleDownloadStatements = async () => {
    if (!statementMonth) {
      toast.error('Select a month for the statement.');
      return;
    }
    try {
      const response = await downloadMonthlyStatements({
        month: statementMonth,
        customer_id: customerValue?.id,
      });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const namePart = customerValue?.label ? customerValue.label.replace(/\s+/g, '_') : 'all-customers';
      link.download = `statement-${namePart}-${statementMonth}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Statement downloaded.');
    } catch (error) {
      console.error('Error downloading statements', error);
      toast.error('Failed to download statement.');
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        mb={3}
      >
        <Typography variant="h4">Invoices</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<ViewColumnIcon />}
            variant="outlined"
            onClick={(e) => handleOpenColumnSelector(e, columns)}
          >
            Columns
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={fetchData}>
            Refresh
          </Button>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => navigate('/invoices/new')}>
            New Invoice
          </Button>
          <Button
            startIcon={<DownloadIcon />}
            variant="outlined"
            onClick={handleDownloadStatements}
          >
            Download Statement
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="flex-start">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              Total Receivables: {formatCurrency(summary.totalReceivables)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total value of all unpaid invoices
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle1">Overdue</Typography>
            <Typography variant="h6" color={summary.totalOverdue > 0 ? 'error' : 'inherit'}>
              {formatCurrency(summary.totalOverdue)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle1">Overdue Count</Typography>
            <Typography variant="h6">{overdueCount}</Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ width: '100%', overflow: 'hidden', mb: 3 }}>
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={3} sx={{ mb: 2 }} flexWrap="wrap">
            <TextField
              label="Search"
              variant="outlined"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 22 }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                minWidth: 300,
                maxWidth: 380,
                '& .MuiInputBase-input': { fontSize: 18, py: 1.5 },
                '& .MuiInputLabel-root': { fontSize: 16 },
              }}
              size="small"
            />
            <TextField
              label="Statement Month"
              type="month"
              value={statementMonth}
              onChange={(e) => setStatementMonth(e.target.value)}
              size="small"
              sx={{ minWidth: 170 }}
              InputLabelProps={{ shrink: true }}
            />
            <Autocomplete
              options={customers}
              getOptionLabel={(option) => option.label}
              value={customerValue}
              inputValue={customerInput}
              onInputChange={(_, val) => setCustomerInput(val)}
              onChange={(_, val) => setCustomerValue(val)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Customer (optional)"
                  size="small"
                  placeholder="Choose customer or leave empty for all"
                  sx={{ minWidth: 260 }}
                />
              )}
              clearOnBlur={false}
            />
            <Chip
              label="All"
              onClick={() => setStatusFilter('all')}
              color={statusFilter === 'all' ? 'primary' : 'default'}
              sx={{ fontSize: 16, px: 3, py: 1, minWidth: 80, height: 40 }}
            />
            <Chip
              label="Unpaid"
              onClick={() => setStatusFilter('unpaid')}
              color={statusFilter === 'unpaid' ? 'primary' : 'default'}
              sx={{ fontSize: 16, px: 3, py: 1, minWidth: 90, height: 40 }}
            />
            <Chip
              label="Paid"
              onClick={() => setStatusFilter('paid')}
              color={statusFilter === 'paid' ? 'primary' : 'default'}
              sx={{ fontSize: 16, px: 3, py: 1, minWidth: 80, height: 40 }}
            />
            <Box sx={{ flexGrow: 1 }} />
          </Stack>

          <DataGrid
            rows={filteredRows}
            columns={columns}
            loading={loading}
            density="comfortable"
            onRowClick={onRowClick}
            columnVisibilityModel={columnVisibilityModel}
            onColumnVisibilityModelChange={(model) => setColumnVisibilityModel(model as any)}
            getRowClassName={(params) => {
              const due = params.row.due_date ? new Date(params.row.due_date) : null;
              const overdue = params.row.status === 'Unpaid' && due && due < new Date();
              return overdue ? 'overdue-row' : '';
            }}
            initialState={{
              sorting: {
                sortModel: [{ field: 'invoice_number', sort: 'desc' }],
              },
            }}
            sx={{
              '& .overdue-row': {
                backgroundColor: '#fff5f5',
              },
              '& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeaderTitle': {
                fontSize: '1.05rem',
              },
              '& .MuiDataGrid-cell': {
                borderBottom: '1px solid rgba(224, 224, 224, 1)',
              },
              '& .MuiDataGrid-columnHeaders': {
                backgroundColor: 'background.paper',
                borderBottom: '2px solid rgba(224, 224, 224, 1)',
              },
              '& .MuiDataGrid-row:hover': {
                backgroundColor: 'action.hover',
              },
            }}
          />
        </Box>
      </Paper>
      <Popover
        open={Boolean(columnSelectorAnchor)}
        anchorEl={columnSelectorAnchor}
        onClose={handleCloseColumnSelector}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, maxWidth: 320 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            Show / Hide Columns
          </Typography>
          <FormGroup>
            {columnSelectorColumns
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
    </Container>
  );
};

export default InvoicesPage;
