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
import { useNavigate } from 'react-router-dom';
import { fetchInvoices } from '../services/invoiceService';
import { getCustomers } from '../services/customerService';
import { Invoice } from '../types/invoice';
import { formatCurrency } from '../utils/formatters';

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
  const [customerFilter, setCustomerFilter] = useState('');

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const selected = customers.find((c) => String(c.id) === customerFilter);
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
  }, [customerFilter, customers.length]);

  const columns = useMemo<GridColDef[]>(() => {
    return [
      { field: 'invoice_number', headerName: 'Invoice #', flex: 1, minWidth: 140 },
      { field: 'customer_name', headerName: 'Customer', flex: 1.2, minWidth: 160 },
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

  const totalRows = rows.length;

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} mb={3}>
        <Typography variant="h4">Invoices</Typography>
        <Stack direction="row" spacing={1}>
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
              Customer Filter
            </Typography>
            <TextField
              select
              SelectProps={{ native: true }}
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              fullWidth
              size="small"
            >
              <option value="">All Customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </TextField>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Count
            </Typography>
            <Typography variant="h5">{totalRows}</Typography>
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
    </Container>
  );
};

export default InvoicesPage;
