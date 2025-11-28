import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Container,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
  Chip,
} from '@mui/material';
import { DataGrid, GridColDef, GridEventListener } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { useNavigate } from 'react-router-dom';
import { fetchInvoices } from '../services/invoiceService';
import { getCustomers } from '../services/customerService';
import { Invoice } from '../types/invoice';
import { formatCurrency } from '../utils/formatters';
import Autocomplete from '@mui/material/Autocomplete';
import Popover from '@mui/material/Popover';
import { Checkbox, FormControlLabel, FormGroup } from '@mui/material';

interface CustomerOption {
  id: number;
  label: string;
  defaultTerms?: number;
}

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalReceivables: 0, totalOverdue: 0 });
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerValue, setCustomerValue] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState('');
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibilityModel));
    }
  }, [columnVisibilityModel]);

  const handleOpenColumnSelector = (event: React.MouseEvent<HTMLElement>, cols: GridColDef[]) => {
    setColumnSelectorColumns(cols);
    setColumnSelectorAnchor(event.currentTarget);
  };

  const handleCloseColumnSelector = () => setColumnSelectorAnchor(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const selected = customerValue;
      const data = await fetchInvoices(selected ? { customer_id: selected.id } : undefined);
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
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerValue?.id, customers.length]);

  const columns = useMemo<GridColDef[]>(() => {
    return [
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
        field: 'due_date',
        headerName: 'Due Date',
        minWidth: 130,
        renderCell: (params) => {
          const isOverdue = params.row.status === 'Unpaid' && params.value && new Date(params.value) < new Date();
          return (
            <Stack direction="row" spacing={1} alignItems="center">
              <span>{params.value ? new Date(params.value).toLocaleDateString() : ''}</span>
              {isOverdue && <WarningAmberIcon color="error" fontSize="small" />}
            </Stack>
          );
        },
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
  }, []);

  const onRowClick: GridEventListener<'rowClick'> = (params) => {
    navigate(`/invoices/${params.row.invoice_id}`);
  };

  const overdueCount = useMemo(
    () =>
      rows.filter((r) => {
        const due = r.due_date ? new Date(r.due_date) : null;
        return r.status === 'Unpaid' && due && due < new Date();
      }).length,
    [rows]
  );

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} mb={3}>
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
        </Stack>
      </Stack>

      <Grid container spacing={2} mb={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Total Receivables
            </Typography>
            <Typography variant="h5">{formatCurrency(summary.totalReceivables)}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Total Overdue
            </Typography>
            <Typography variant="h5" color={summary.totalOverdue > 0 ? 'error' : 'inherit'}>
              {formatCurrency(summary.totalOverdue)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Customer
            </Typography>
            <Autocomplete
              options={customers}
              getOptionLabel={(option) => option.label}
              value={customerValue}
              inputValue={customerInput}
              onInputChange={(_, val) => setCustomerInput(val)}
              onChange={(_, val) => setCustomerValue(val)}
              renderInput={(params) => <TextField {...params} size="small" placeholder="Type or select a customer" />}
              clearOnBlur={false}
              sx={{ mt: 1 }}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Overdue Invoices
            </Typography>
            <Typography variant="h5">{overdueCount}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ height: 520 }}>
        <DataGrid
          rows={rows}
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
          sx={{
            '& .overdue-row': {
              backgroundColor: '#fff5f5',
            },
          }}
        />
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
