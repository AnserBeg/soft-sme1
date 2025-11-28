import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Divider,
  InputAdornment,
} from '@mui/material';
import dayjs, { Dayjs } from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { toast } from 'react-toastify';
import { getCustomers } from '../services/customerService';
import { createInvoice, getInvoice, updateInvoice } from '../services/invoiceService';
import { InvoiceLineItem } from '../types/invoice';
import { formatCurrency } from '../utils/formatters';
import api from '../api/axios';

interface CustomerOption {
  id: number;
  label: string;
  defaultTerms?: number;
}

const defaultLineItem = (): InvoiceLineItem => ({
  part_number: '',
  part_description: '',
  quantity: 1,
  unit: '',
  unit_price: 0,
  line_amount: 0,
});

const InvoiceDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<any>({ status: 'Unpaid' });
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([defaultLineItem()]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [invoiceDate, setInvoiceDate] = useState<Dayjs | null>(dayjs());
  const [dueDate, setDueDate] = useState<Dayjs | null>(dayjs().add(30, 'day'));
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => sum + (Number(item.line_amount) || 0), 0);
    const gst = Math.round(subtotal * 0.05 * 100) / 100;
    const total = Math.round((subtotal + gst) * 100) / 100;
    return { subtotal, gst, total };
  }, [lineItems]);

  useEffect(() => {
    (async () => {
      try {
        const customerData = await getCustomers();
        const options = customerData.map((c: any) => ({
          id: c.customer_id || c.id,
          label: c.customer_name,
          defaultTerms: Number(c.default_payment_terms_in_days) || 30,
        }));
        setCustomers(options);
      } catch (e) {
        console.error('Failed to load customers', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isNew && id) {
      (async () => {
        setLoading(true);
        try {
          const res = await getInvoice(id);
          const header = res.invoice;
          const items = (res.lineItems || []).map((li: any) => ({
            invoice_line_item_id: li.invoice_line_item_id,
            part_number: li.part_number || '',
            part_description: li.part_description || '',
            quantity: Number(li.quantity) || 0,
            unit: li.unit || '',
            unit_price: Number(li.unit_price) || 0,
            line_amount: Number(li.line_amount) || 0,
          })) as InvoiceLineItem[];
          setInvoice(header);
          setLineItems(items.length ? items : [defaultLineItem()]);
          const match = customers.find((c) => c.id === header.customer_id);
          const option =
            match ||
            (header.customer_id
              ? {
                  id: header.customer_id,
                  label: header.customer_name || `Customer ${header.customer_id}`,
                  defaultTerms:
                    Number(header.payment_terms_in_days) ||
                    Number(header.default_payment_terms_in_days) ||
                    30,
                }
              : null);
          setCustomer(option || null);
          setInvoiceDate(header.invoice_date ? dayjs(header.invoice_date) : dayjs());
          setDueDate(header.due_date ? dayjs(header.due_date) : dayjs().add(option?.defaultTerms || 30, 'day'));
        } catch (e) {
          console.error('Failed to load invoice', e);
          setError('Failed to load invoice');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [id, isNew, customers]);

  useEffect(() => {
    if (isNew && !dueDateTouched && invoiceDate && customer?.defaultTerms) {
      setDueDate(invoiceDate.add(customer.defaultTerms, 'day'));
    }
  }, [customer, invoiceDate, dueDateTouched, isNew]);

  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: any) => {
    setLineItems((prev) => {
      const clone = [...prev];
      const target = { ...clone[index] };
      if (field === 'quantity' || field === 'unit_price') {
        const numeric = Number(value);
        target[field] = Number.isFinite(numeric) ? numeric : 0;
        target.line_amount = Math.round((Number(target.quantity) * Number(target.unit_price)) * 100) / 100;
      } else if (field === 'line_amount') {
        const numeric = Number(value);
        target.line_amount = Number.isFinite(numeric) ? numeric : 0;
      } else {
        (target as any)[field] = value;
      }
      clone[index] = target;
      return clone;
    });
  };

  const addLineItem = () => setLineItems((prev) => [...prev, defaultLineItem()]);
  const removeLineItem = (index: number) => setLineItems((prev) => prev.filter((_, idx) => idx !== index));

  const handleSave = async () => {
    if (!customer && !invoice.customer_id) {
      toast.error('Please select a customer');
      return;
    }
    const payload = {
      customer_id: customer?.id ?? invoice.customer_id,
      invoice_date: invoiceDate ? invoiceDate.toISOString() : undefined,
      due_date: dueDate ? dueDate.toISOString() : undefined,
      status: invoice.status || 'Unpaid',
      payment_terms_in_days: invoice.payment_terms_in_days ?? customer?.defaultTerms,
      notes: invoice.notes,
      sales_order_id: invoice.sales_order_id ?? null,
      source_sales_order_number: invoice.source_sales_order_number ?? null,
      line_items: lineItems.map((li) => ({
        invoice_line_item_id: li.invoice_line_item_id,
        part_id: li.part_id,
        part_number: li.part_number,
        part_description: li.part_description,
        quantity: Number(li.quantity) || 0,
        unit: li.unit,
        unit_price: Number(li.unit_price) || 0,
        line_amount: Number(li.line_amount) || Math.round((Number(li.quantity) * Number(li.unit_price)) * 100) / 100,
      })),
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await createInvoice(payload);
        toast.success('Invoice created');
        navigate(`/invoices/${created.invoice_id}`);
      } else {
        await updateInvoice(invoice.invoice_id, payload);
        toast.success('Invoice updated');
      }
    } catch (e) {
      console.error('Failed to save invoice', e);
      toast.error('Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (isNew || !invoice.invoice_id) return;
    setDownloading(true);
    try {
      const res = await api.get(`/api/invoices/${invoice.invoice_id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number || 'invoice'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to download invoice PDF', e);
      toast.error('Failed to download invoice PDF');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ mt: 6, textAlign: 'center' }}>
        <Typography>Loading invoice...</Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ mt: 6, textAlign: 'center' }}>
        <Typography color="error">{error}</Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </Container>
    );
  }

  const isOverdue = invoice.status === 'Unpaid' && dueDate && dueDate.isBefore(dayjs(), 'day');

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h4">
              {isNew ? 'New Invoice' : `Invoice ${invoice.invoice_number || ''}`}
            </Typography>
            {invoice.source_sales_order_number && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="body1">Source Sales Order:</Typography>
                <Button
                  variant="text"
                  size="small"
                  startIcon={<ReceiptLongIcon />}
                  onClick={() => navigate(`/open-sales-orders/${invoice.sales_order_id}`)}
                >
                  {invoice.source_sales_order_number}
                </Button>
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            {isOverdue && <Chip color="error" label="Overdue" />}
            <Chip
              color={invoice.status === 'Paid' ? 'success' : 'default'}
              label={invoice.status || 'Unpaid'}
              onClick={() =>
                setInvoice((prev: any) => ({
                  ...prev,
                  status: prev.status === 'Paid' ? 'Unpaid' : 'Paid',
                }))
              }
            />
            <Button variant="outlined" startIcon={<ReceiptLongIcon />} onClick={handleDownloadPDF} disabled={downloading || isNew}>
              {downloading ? 'Downloading...' : 'Download PDF'}
            </Button>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </Stack>
        </Box>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                SelectProps={{ native: true }}
                label="Customer"
                value={customer?.id || invoice.customer_id || ''}
                onChange={(e) => {
                  const idVal = Number(e.target.value);
                  const found = customers.find((c) => c.id === idVal) || null;
                  setCustomer(found);
                  setInvoice((prev: any) => ({ ...prev, customer_id: idVal }));
                }}
                fullWidth
              >
                <option value=""></option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={3}>
              <DatePicker
                label="Invoice Date"
                value={invoiceDate}
                onChange={(val) => setInvoiceDate(val)}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <DatePicker
                label="Due Date"
                value={dueDate}
                onChange={(val) => {
                  setDueDate(val);
                  setDueDateTouched(true);
                }}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                multiline
                minRows={2}
                fullWidth
                value={invoice.notes || ''}
                onChange={(e) => setInvoice((prev: any) => ({ ...prev, notes: e.target.value }))}
              />
            </Grid>
          </Grid>
        </Paper>

        <Typography variant="h6" sx={{ mt: 2, mb: 0.5 }}>Line Items</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each part number can only appear once. Edit existing line items to change quantities.
        </Typography>
        <Paper sx={{ p: 3, mb: 3 }} elevation={3}>
          <Grid container spacing={2}>
            {lineItems.map((item, idx) => (
              <React.Fragment key={idx}>
                <Grid item xs={12} sm={6} md={2.5}>
                  <TextField
                    label="Part Number *"
                    value={item.part_number}
                    onChange={(e) => updateLineItem(idx, 'part_number', e.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3.5}>
                  <TextField
                    label="Part Description *"
                    value={item.part_description}
                    onChange={(e) => updateLineItem(idx, 'part_description', e.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.2}>
                  <TextField
                    label="Qty"
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                    fullWidth
                    inputProps={{ step: 0.01 }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1}>
                  <TextField
                    label="Unit"
                    value={item.unit}
                    onChange={(e) => updateLineItem(idx, 'unit', e.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField
                    label="Unit Price"
                    type="number"
                    value={item.unit_price}
                    onChange={(e) => updateLineItem(idx, 'unit_price', e.target.value)}
                    fullWidth
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField
                    label="Amount"
                    type="number"
                    value={item.line_amount}
                    onChange={(e) => updateLineItem(idx, 'line_amount', e.target.value)}
                    fullWidth
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                </Grid>
                <Grid item xs={12} sm={3} md={1} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => removeLineItem(idx)}
                    startIcon={<DeleteIcon />}
                    fullWidth
                  >
                    Remove
                  </Button>
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" color="primary" onClick={addLineItem} startIcon={<AddIcon />}>
              Add Line Item
            </Button>
          </Box>
        </Paper>

        <Paper sx={{ p: 3, mb: 3 }} elevation={3}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1">Subtotal: {formatCurrency(totals.subtotal)}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1">Total GST: {formatCurrency(totals.gst)}</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="h6">Total Amount: {formatCurrency(totals.total)}</Typography>
            </Grid>
          </Grid>
        </Paper>

        <Divider sx={{ my: 3 }} />
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" onClick={() => navigate('/invoices')}>Back to Invoices</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Invoice'}
          </Button>
        </Stack>
      </Container>
    </LocalizationProvider>
  );
};

export default InvoiceDetailPage;
