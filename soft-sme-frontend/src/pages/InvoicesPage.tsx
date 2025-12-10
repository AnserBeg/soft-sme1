import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
import UploadIcon from '@mui/icons-material/Upload';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import {
  fetchInvoices,
  downloadMonthlyStatements,
  deleteInvoice,
  downloadInvoiceImportTemplate,
  uploadInvoiceCsv,
  uploadInvoiceUnitNumbers,
} from '../services/invoiceService';
import { getCustomers, getCustomer, updateCustomer } from '../services/customerService';
import { Invoice } from '../types/invoice';
import { formatCurrency } from '../utils/formatters';
import Popover from '@mui/material/Popover';
import { Checkbox, FormControlLabel, FormGroup, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import Autocomplete from '@mui/material/Autocomplete';
import { toast } from 'react-toastify';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';
import { Customer } from '../types/customer';

interface CustomerOption {
  id: number;
  label: string;
}

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalReceivables: 0, totalOverdue: 0 });
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const PAGE_SIZE = 200;
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerValue, setCustomerValue] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerDialogSaving, setCustomerDialogSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('unpaid');
  const [statementMonth, setStatementMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [uploading, setUploading] = useState(false);
  const [unitUploading, setUnitUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const unitFileInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    const loadCustomerDetail = async () => {
      if (!customerValue?.id) {
        setSelectedCustomer(null);
        return;
      }
      try {
        const detail = await getCustomer(String(customerValue.id));
        setSelectedCustomer(detail);
      } catch (e) {
        console.error('Failed to load customer detail', e);
        setSelectedCustomer(null);
      }
    };
    loadCustomerDetail();
  }, [customerValue?.id]);

  const handleOpenColumnSelector = (event: React.MouseEvent<HTMLElement>, cols: GridColDef[]) => {
    setColumnSelectorColumns(cols);
    setColumnSelectorAnchor(event.currentTarget);
  };

  const handleCloseColumnSelector = () => setColumnSelectorAnchor(null);

  const statusParam = useMemo(() => {
    if (statusFilter === 'all') return undefined;
    if (statusFilter === 'paid') return 'Paid';
    return 'Unpaid';
  }, [statusFilter]);

  const fetchPage = useCallback(
    async (reset = false) => {
      const nextOffset = reset ? 0 : offsetRef.current;
      if (reset) {
        offsetRef.current = 0;
        setOffset(0);
        setHasMore(true);
      }
      setLoading(true);
      try {
        const data = await fetchInvoices({
          customer_id: customerValue?.id,
          status: statusParam,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        const withId = data.invoices.map((inv: Invoice) => ({
          ...inv,
          id: inv.invoice_id,
        }));
        setRows((prev) => (reset ? withId : [...prev, ...withId]));
        setSummary(data.summary);
        const newOffset = nextOffset + withId.length;
        offsetRef.current = newOffset;
        setOffset(newOffset);
        setHasMore(data.hasMore ?? withId.length === PAGE_SIZE);
      } catch (e) {
        console.error('Failed to load invoices', e);
        if (reset) {
          setRows([]);
          setOffset(0);
        }
        setHasMore(false);
        setSummary({ totalReceivables: 0, totalOverdue: 0 });
      } finally {
        setLoading(false);
      }
    },
    [customerValue?.id, statusParam]
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchInvoices({
        customer_id: customerValue?.id,
        status: statusParam,
      });
      const withId = data.invoices.map((inv: Invoice) => ({
        ...inv,
        id: inv.invoice_id,
      }));
      setRows(withId);
      setSummary(data.summary);
      offsetRef.current = withId.length;
      setOffset(withId.length);
      setHasMore(false);
    } catch (e) {
      console.error('Failed to load all invoices', e);
      toast.error('Failed to load all invoices');
    } finally {
      setLoading(false);
    }
  }, [customerValue?.id, statusParam]);

  useEffect(() => {
    fetchPage(true);
  }, [fetchPage, customerValue?.id, statusParam]);

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
        fetchPage(true);
      } catch (error) {
        console.error('Failed to delete invoice', error);
        toast.error('Failed to delete invoice.');
      }
    },
    [fetchPage]
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
      { field: 'mileage', headerName: 'Mileage', minWidth: 110 },
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
    return rows.filter((row) =>
      [
        row.invoice_number,
        row.sales_order_number,
        row.customer_name,
        row.product_name,
        row.product_description,
        row.vin_number,
        row.unit_number,
        row.mileage,
        row.vehicle_make,
        row.vehicle_model,
        row.invoice_date ? new Date(row.invoice_date).toLocaleDateString() : '',
        row.due_date ? new Date(row.due_date).toLocaleDateString() : '',
      ]
        .filter((value) => value !== undefined && value !== null)
        .some((value) => value.toString().toLowerCase().includes(term))
    );
  }, [rows, search]);

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

  const handleDownloadTemplate = async () => {
    try {
      const response = await downloadInvoiceImportTemplate();
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'invoice_import_template.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Template downloaded.');
    } catch (error) {
      console.error('Error downloading template', error);
      toast.error('Failed to download template.');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUnitUploadClick = () => {
    unitFileInputRef.current?.click();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadInvoiceCsv(file);
      toast.success(`Upload complete. Created: ${result.summary?.invoicesCreated ?? 0}, skipped: ${result.summary?.invoicesSkipped ?? 0}`);
      if (result.warnings?.length) {
        console.warn('Invoice CSV upload warnings:', result.warnings);
      }
      fetchPage(true);
    } catch (error: any) {
      console.error('Error uploading invoice CSV', error);
      const message = error?.response?.data?.error || 'Failed to upload CSV';
      const details = error?.response?.data?.errors?.[0];
      toast.error(details ? `${message}: ${details}` : message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUnitFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUnitUploading(true);
    try {
      const result = await uploadInvoiceUnitNumbers(file);
      const updated = result.summary?.updated ?? 0;
      const missing = result.summary?.missingInvoices ?? result.missingInvoices?.length ?? 0;
      toast.success(
        `Unit upload complete. Updated: ${updated}${missing ? `, missing invoices: ${missing}` : ''}`
      );
      if (result.warnings?.length) {
        console.warn('Invoice unit CSV warnings:', result.warnings);
      }
      fetchPage(true);
    } catch (error: any) {
      console.error('Error uploading invoice unit CSV', error);
      const message = error?.response?.data?.error || 'Failed to upload unit CSV';
      const details = error?.response?.data?.warnings?.[0];
      toast.error(details ? `${message}: ${details}` : message);
    } finally {
      setUnitUploading(false);
      if (unitFileInputRef.current) unitFileInputRef.current.value = '';
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
          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => fetchPage(true)}>
            Refresh
          </Button>
          <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleDownloadTemplate}>
            Download Template
          </Button>
          <Button
            startIcon={<UploadIcon />}
            variant="outlined"
            color="secondary"
            onClick={handleUnitUploadClick}
            disabled={unitUploading}
          >
            {unitUploading ? 'Uploading units...' : 'Upload Unit CSV'}
          </Button>
          <Button
            startIcon={<UploadIcon />}
            variant="outlined"
            color="secondary"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload CSV'}
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
      <input
        type="file"
        accept=".csv,text/csv"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        type="file"
        accept=".csv,text/csv"
        ref={unitFileInputRef}
        style={{ display: 'none' }}
        onChange={handleUnitFileChange}
      />

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

          {selectedCustomer && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mb: 2,
                backgroundColor: '#fafafa',
                borderColor: 'divider',
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1.5, flex: 1 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Email</Typography>
                    <Typography variant="body1">{selectedCustomer.email || '—'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Phone</Typography>
                    <Typography variant="body1">
                      {selectedCustomer.phone || selectedCustomer.phone_number || '—'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Payment Terms</Typography>
                    <Typography variant="body1">
                      {selectedCustomer.default_payment_terms_in_days != null
                        ? `${selectedCustomer.default_payment_terms_in_days} days`
                        : '—'}
                    </Typography>
                  </Box>
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography variant="caption" color="text.secondary">General Notes</Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                      {selectedCustomer.general_notes || '—'}
                    </Typography>
                  </Box>
                </Box>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setCustomerDialogOpen(true);
                  }}
                >
                  Edit Customer
                </Button>
              </Stack>
            </Paper>
          )}

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
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              onClick={() => fetchPage(false)}
              disabled={loading || !hasMore}
            >
              {loading ? 'Loading...' : hasMore ? 'Load More' : 'No more invoices'}
            </Button>
            <Button
              variant="contained"
              onClick={fetchAll}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load All'}
            </Button>
          </Box>
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

      <UnifiedCustomerDialog
        open={customerDialogOpen}
        onClose={() => setCustomerDialogOpen(false)}
        isEditMode
        loading={customerDialogSaving}
        initialCustomer={
          selectedCustomer
            ? {
                customer_id: String(selectedCustomer.customer_id ?? selectedCustomer.id),
                customer_name: selectedCustomer.customer_name,
                contact_person: selectedCustomer.contact_person || '',
                email: selectedCustomer.email || '',
                phone_number: selectedCustomer.phone || selectedCustomer.phone_number || '',
                street_address: selectedCustomer.street_address || selectedCustomer.address || '',
                city: selectedCustomer.city || '',
                province: selectedCustomer.province || selectedCustomer.state || '',
                country: selectedCustomer.country || '',
                postal_code: selectedCustomer.postal_code || '',
                default_payment_terms_in_days: selectedCustomer.default_payment_terms_in_days,
                website: selectedCustomer.website || '',
                general_notes: selectedCustomer.general_notes || '',
              }
            : undefined
        }
        onSave={async (cust: CustomerFormValues) => {
          if (!selectedCustomer) return;
          setCustomerDialogSaving(true);
          const selectedCustomerId = Number(selectedCustomer.customer_id ?? selectedCustomer.id);
          try {
            const updated = await updateCustomer(String(selectedCustomerId), cust);
            setSelectedCustomer(updated as Customer);
            setCustomers((prev) =>
              prev.map((c) =>
                c.id === selectedCustomerId
                  ? { ...c, label: updated.customer_name }
                  : c
              )
            );
            if (customerValue) {
              setCustomerValue({ ...customerValue, label: updated.customer_name });
            }
            fetchPage(true);
            toast.success('Customer updated');
            setCustomerDialogOpen(false);
          } catch (e: any) {
            console.error('Failed to update customer', e);
            const msg = e?.response?.data?.error || 'Failed to update customer';
            toast.error(msg);
          } finally {
            setCustomerDialogSaving(false);
          }
        }}
      />
    </Container>
  );
};

export default InvoicesPage;
