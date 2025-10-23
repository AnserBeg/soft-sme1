// src/pages/QuoteEditorPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  Grid,
  Autocomplete,
  Snackbar,
  Alert,
  InputAdornment,
  Stack,
  Chip,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import EmailIcon from '@mui/icons-material/Email';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import BlockIcon from '@mui/icons-material/Block';
import TableChartIcon from '@mui/icons-material/TableChart';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/axios';
import { AxiosError } from 'axios';
import EmailModal from '../components/EmailModal';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';
import UnifiedProductDialog, { ProductFormValues } from '../components/UnifiedProductDialog';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import { normalizeQuoteStatus, QuoteStatus } from '../utils/quoteStatus';
import { fuzzySearch } from '../services/searchService';
import QuoteTemplatesDialog, { QuoteDescriptionTemplate } from '../components/QuoteTemplatesDialog';

interface CustomerOption {
  label: string;
  id?: number;
  email?: string;
  score?: number;
  isNew?: boolean;
}

interface ProductOption {
  label: string;
  id?: number;
  description?: string;
  isNew?: boolean;
  inputValue?: string;
}

interface Quote {
  quote_id: number;
  quote_number: string;
  customer_id: number;
  customer_name: string;
  quote_date: string;
  valid_until: string;
  product_name: string;
  product_description: string;
  estimated_cost: number;
  status: QuoteStatus;
  terms?: string;
  customer_po_number?: string;
  vin_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
}

const formatInt = (v: number | string | null | undefined) => {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(n);
};

const input56Sx = {
  '& .MuiOutlinedInput-root': { height: 56, borderRadius: 1 },
  '& .MuiInputBase-input': { py: 1.25, fontSize: 16 },
} as const;

const labelSx = {
  fontSize: 18,
  transform: 'translate(14px, 18px) scale(1)',
  '&.MuiInputLabel-shrink': { fontSize: 14, transform: 'translate(14px, -9px) scale(0.9)' },
} as const;

const normalizeString = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const getStatusChipStyles = (status: QuoteStatus) => {
  switch (status) {
    case 'Approved':
      return { backgroundColor: 'rgba(76, 175, 80, 0.12)', color: '#2e7d32' };
    case 'Rejected':
      return { backgroundColor: 'rgba(244, 67, 54, 0.12)', color: '#c62828' };
    default:
      return { backgroundColor: 'rgba(33, 150, 243, 0.12)', color: '#1565c0' };
  }
};

const QuoteEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isCreationMode = id === 'new';
  const isEditMode = Boolean(id) && !isCreationMode;

  // lists & data
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);

  // form state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [quoteDate, setQuoteDate] = useState<Dayjs | null>(dayjs());
  const [validUntil, setValidUntil] = useState<Dayjs | null>(dayjs().add(30, 'day'));
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [vinNumber, setVinNumber] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');

  // ui
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // autocomplete state (customer)
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerInput, setCustomerInput] = useState('');
  const [customerEnterPressed, setCustomerEnterPressed] = useState(false);
  const customerSearchAbortRef = useRef<AbortController | null>(null);
  const customerSearchTimerRef = useRef<number | null>(null);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const customerInputRef = useRef<HTMLInputElement | null>(null);
  const productDescriptionRef = useRef<HTMLTextAreaElement | null>(null);

  // autocomplete state (product)
  const [productOpen, setProductOpen] = useState(false);
  const [productInput, setProductInput] = useState('');
  const [productTypingTimer, setProductTypingTimer] = useState<number | null>(null);

  // add dialogs
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  // email modal
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);

  // Unsaved changes guard: normalized signature structure
  const [initialSignature, setInitialSignature] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const getNormalizedSignature = useCallback(() => ({
    customer: selectedCustomer?.id || quote?.customer_id || null,
    product: selectedProduct?.label || quote?.product_name || '',
    quoteDate: quoteDate?.toISOString?.() || quote?.quote_date || null,
    validUntil: validUntil?.toISOString?.() || quote?.valid_until || null,
    estimatedCost: estimatedCost ?? quote?.estimated_cost ?? null,
    productDescription: (productDescription || '').trim(),
    terms: (terms || '').trim(),
    customerPoNumber: (customerPoNumber || '').trim(),
    vinNumber: (vinNumber || '').trim(),
    vehicleMake: (vehicleMake || '').trim(),
    vehicleModel: (vehicleModel || '').trim(),
  }), [selectedCustomer, quote, selectedProduct, quoteDate, validUntil, estimatedCost, productDescription, terms, customerPoNumber, vinNumber, vehicleMake, vehicleModel]);

  const handleTemplateInsert = useCallback((template: QuoteDescriptionTemplate) => {
    setProductDescription(template.content);
    setIsTemplateDialogOpen(false);
    setSuccess(`Template "${template.name}" inserted into the description.`);

    window.setTimeout(() => {
      if (productDescriptionRef.current) {
        const textarea = productDescriptionRef.current;
        textarea.focus();
        try {
          const length = template.content.length;
          textarea.setSelectionRange(length, length);
        } catch {
          // Ignore selection errors on unsupported browsers
        }
      }
    }, 0);
  }, [setProductDescription, setIsTemplateDialogOpen, setSuccess]);

  // Set initial signature only once after data is fully loaded
  useEffect(() => {
    if (isDataLoaded && initialSignature === '') {
      const signature = JSON.stringify(getNormalizedSignature());
      setInitialSignature(signature);
      console.log('[QuoteEditor] Initial signature set:', signature);
    }
  }, [isDataLoaded, initialSignature, getNormalizedSignature]);

  const currentSignature = useMemo(() => JSON.stringify(getNormalizedSignature()), [getNormalizedSignature]);
  const isDirty = Boolean(initialSignature) && initialSignature !== currentSignature && !isSaving;

  // Debug logging for signature comparison
  useEffect(() => {
    if (initialSignature) {
      console.log('[QuoteEditor] Signature comparison:', {
        isDirty,
        initialSignature: initialSignature.slice(0, 100) + '...',
        currentSignature: currentSignature.slice(0, 100) + '...',
        signaturesMatch: initialSignature === currentSignature
      });
    }
  }, [isDirty, initialSignature, currentSignature]);

  // load lists
  useEffect(() => {
    fetchProducts();
    if (!isEditMode) {
      setIsDataLoaded(true);
    }
  }, []);

  // load quote for edit
  useEffect(() => {
    if (!isEditMode || !id) return;
    (async () => {
      try {
        const res = await api.get(`/api/quotes/${id}`);
        const q: Quote = {
          ...res.data,
          status: normalizeQuoteStatus(res.data?.status),
        };
        setQuote(q);

        // prefill
        setSelectedCustomer(q.customer_id ? { id: q.customer_id, label: q.customer_name } : null);
        setSelectedProduct({ label: q.product_name });
        setQuoteDate(dayjs(q.quote_date));
        setValidUntil(dayjs(q.valid_until));
        setEstimatedCost(Number(q.estimated_cost ?? 0));
        setProductDescription(q.product_description || '');
        setTerms(q.terms || '');
        setCustomerPoNumber(q.customer_po_number || '');
        setVinNumber(q.vin_number || '');
        setVehicleMake(q.vehicle_make || '');
        setVehicleModel(q.vehicle_model || '');
        setCustomerInput(q.customer_name || '');
        setProductInput(q.product_name || '');
        setIsDataLoaded(true); // Mark data as loaded
      } catch (error) {
        console.error('Failed to load quote:', error);
        setError('Failed to load quote');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEditMode]);

  useEffect(() => {
    return () => {
      if (productTypingTimer) window.clearTimeout(productTypingTimer);
      if (customerSearchTimerRef.current) window.clearTimeout(customerSearchTimerRef.current);
      if (customerSearchAbortRef.current) customerSearchAbortRef.current.abort();
    };
  }, [productTypingTimer]);

  const fetchProducts = async () => {
    try {
      const res = await api.get('/api/products');
      setProducts(
        (res.data || []).map((p: any) => ({
          label: p.product_name,
          id: p.product_id,
          description: p.product_description,
        }))
      );
    } catch {
      setError('Failed to load products');
    }
  };

  const runCustomerSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setCustomerOptions([]);
      setCustomerSearchLoading(false);
      if (customerSearchAbortRef.current) {
        customerSearchAbortRef.current.abort();
        customerSearchAbortRef.current = null;
      }
      return;
    }

    if (customerSearchAbortRef.current) {
      customerSearchAbortRef.current.abort();
    }

    const controller = new AbortController();
    customerSearchAbortRef.current = controller;
    setCustomerSearchLoading(true);

    try {
      const matches = await fuzzySearch('customer', trimmed, {
        limit: 8,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      setCustomerOptions(
        matches.map((match) => ({
          label: match.label,
          id: match.id,
          score: match.score,
          email: typeof (match.extra as any)?.email === 'string' ? (match.extra as any).email : undefined,
        }))
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Customer fuzzy search failed:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setCustomerSearchLoading(false);
        customerSearchAbortRef.current = null;
      }
    }
  }, []);

  const customerAutocompleteOptions = useMemo(() => {
    const base: CustomerOption[] = [...customerOptions];
    if (selectedCustomer && selectedCustomer.id && !base.some((opt) => opt.id === selectedCustomer.id)) {
      base.unshift(selectedCustomer);
    }

    const trimmed = customerInput.trim();
    const hasExact = trimmed
      ? base.some((opt) => normalizeString(opt.label) === normalizeString(trimmed))
      : false;

    if (trimmed && !hasExact) {
      base.push({ label: `Add "${trimmed}" as New Customer`, isNew: true });
    }

    return base;
  }, [customerOptions, customerInput, selectedCustomer]);

  const exactCustomerMatch = useCallback(
    (query: string): CustomerOption | null => {
      const nq = normalizeString(query);
      if (!nq) {
        return null;
      }

      if (selectedCustomer && normalizeString(selectedCustomer.label) === nq) {
        return selectedCustomer;
      }

      return customerOptions.find((c) => normalizeString(c.label) === nq) || null;
    },
    [customerOptions, selectedCustomer]
  );

  const resetForm = () => {
    setSelectedCustomer(null);
    setSelectedProduct(null);
    setQuoteDate(dayjs());
    setValidUntil(dayjs().add(30, 'day'));
    setEstimatedCost(null);
    setProductDescription('');
    setTerms('');
    setCustomerPoNumber('');
    setVinNumber('');
    setVehicleMake('');
    setVehicleModel('');
    setCustomerInput('');
    setProductInput('');
  };

  const handleSaveQuote = async () => {
    if (!selectedCustomer || !selectedProduct || !quoteDate || !validUntil || estimatedCost == null) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setIsSaving(true);
    try {
      const payload = {
        customer_id: selectedCustomer.id,
        product_name: selectedProduct.label.trim(),
        quote_date: quoteDate.format('YYYY-MM-DD'),
        valid_until: validUntil.format('YYYY-MM-DD'),
        estimated_cost: Number(estimatedCost),
        product_description: productDescription,
        terms,
        customer_po_number: customerPoNumber,
        vin_number: vinNumber,
        vehicle_make: vehicleMake.trim(),
        vehicle_model: vehicleModel.trim(),
        status: quote?.status ?? 'Open',
      };

      if (isEditMode && quote) {
        const response = await api.put(`/api/quotes/${quote.quote_id}`, payload);
        setSuccess('Quote updated successfully');
        const updatedData = response?.data;
        if (updatedData) {
          setQuote((prev) =>
            prev
              ? {
                  ...prev,
                  ...updatedData,
                  status: normalizeQuoteStatus(updatedData.status ?? prev.status),
                }
              : prev
          );
        } else {
          setQuote((prev) =>
            prev
              ? {
                  ...prev,
                  ...payload,
                }
              : prev
          );
        }
        // Reset initial signature after successful save - use a more stable approach
        const newSignature = JSON.stringify(getNormalizedSignature());
        setInitialSignature(newSignature);
        console.log('[QuoteEditor] Signature reset after save:', newSignature.slice(0, 100) + '...');
        // Allow immediate navigation after save with a small delay to ensure state updates
        setTimeout(() => {
          (window as any).__unsavedGuardAllowNext = true;
        }, 100);
      } else {
        // Prevent duplicate submission
        if ((window as any).__quoteCreateInFlight) {
          console.log('[QuoteEditor] Skipping duplicate create (in flight)');
          return;
        }
        (window as any).__quoteCreateInFlight = true;
        const res = await api.post('/api/quotes', payload);
        setSuccess('Quote created successfully');

        const data: any = res?.data ?? {};
        const newId = data.quote_id ?? data.quoteId ?? data.id ?? data?.quote?.quote_id;

        if (newId) {
          const newQuote: Quote = {
            quote_id: newId,
            quote_number: data.quote_number || `Q${newId}`,
            customer_id: selectedCustomer.id!,
            customer_name: selectedCustomer.label,
            quote_date: payload.quote_date,
            valid_until: payload.valid_until,
            product_name: payload.product_name,
            product_description: payload.product_description,
            estimated_cost: payload.estimated_cost,
            status: 'Open',
            terms: payload.terms,
            customer_po_number: payload.customer_po_number,
            vin_number: payload.vin_number,
            vehicle_make: payload.vehicle_make,
            vehicle_model: payload.vehicle_model,
          };
          setQuote(newQuote);
          // jump to edit URL for the new quote
          // Bypass guard for this navigation
          (window as any).__unsavedGuardAllowNext = true;
          navigate(`/quotes/${newId}`, { replace: true });
          setInitialSignature(JSON.stringify(getNormalizedSignature()));
          return;
        }
      }
    } catch (e) {
      const axiosError = e as AxiosError;
      const msg =
        axiosError.response?.data &&
        typeof axiosError.response.data === 'object' &&
        'message' in (axiosError.response.data as any)
          ? ((axiosError.response.data as any).message as string)
          : 'Failed to save quote';
      setError(msg);
    } finally {
      setLoading(false);
      setIsSaving(false);
      (window as any).__quoteCreateInFlight = false;
    }
  };

  const handleDownloadPdf = async () => {
    if (!quote) return;
    try {
      const response = await api.get(`/api/quotes/${quote.quote_id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Quote_${quote.quote_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSuccess('PDF downloaded successfully.');
    } catch {
      setError('Failed to download PDF. Please try again.');
    }
  };

  const handleEmailQuoteClick = () => {
    if (!quote?.quote_id) {
      setError('Please save the quote before emailing.');
      return;
    }
    setIsEmailModalOpen(true);
  };

  const handleConvertToSalesOrder = async () => {
    if (!quote?.quote_id) {
      setError('Please save the quote before converting.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/api/quotes/${quote.quote_id}/convert-to-sales-order`);
      setSuccess('Quote converted to sales order successfully!');

      const updatedQuoteData = response?.data?.quote;
      if (updatedQuoteData) {
        setQuote((prev) =>
          prev
            ? {
                ...prev,
                ...updatedQuoteData,
                status: normalizeQuoteStatus(updatedQuoteData.status ?? 'Approved'),
              }
            : prev
        );
      } else {
        setQuote((prev) => (prev ? { ...prev, status: 'Approved' } : prev));
      }

      // Navigate to the specific sales order detail page
      const salesOrderId = response.data.salesOrder?.sales_order_id;
      if (salesOrderId) {
        setTimeout(() => {
          navigate(`/open-sales-orders/${salesOrderId}`);
        }, 1500);
      } else {
        // Fallback to sales orders list if ID is not available
        setTimeout(() => {
          navigate('/open-sales-orders');
        }, 1500);
      }
    } catch (e) {
      const axiosError = e as AxiosError;
      const msg =
        axiosError.response?.data &&
        typeof axiosError.response.data === 'object' &&
        'message' in (axiosError.response.data as any)
          ? ((axiosError.response.data as any).message as string)
          : 'Failed to convert quote to sales order';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerKeyDown = (event: React.KeyboardEvent) => {
    const inputValue = customerInput.trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) { setCustomerOpen(false); return; }
    if (isArrow) return;

    if (isEnter || isTab) {
      if (isEnter && event.ctrlKey && inputValue) {
        event.preventDefault();
        setCustomerEnterPressed(true);
        setNewCustomerName(inputValue);
        setIsAddCustomerModalOpen(true);
        return;
      }
      const match = exactCustomerMatch(inputValue);
      if (customerOpen) return; // let Autocomplete handle highlighted pick
      if (!inputValue) return;

      event.preventDefault();
      if (match) {
        setSelectedCustomer(match);
        setCustomerInput(match.label);
        setCustomerOptions([]);
        setCustomerOpen(false);
      } else {
        setCustomerEnterPressed(true);
        setNewCustomerName(inputValue);
        setIsAddCustomerModalOpen(true);
      }
    }
  };

  const handleProductKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const inputValue = productInput.trim();
      if (!inputValue) return;
      const exact = products.find((p) => p.label.toLowerCase() === inputValue.toLowerCase());
      if (exact) {
        setSelectedProduct(exact);
        setProductInput(exact.label);
      } else {
        setNewProductName(inputValue);
        setIsAddProductModalOpen(true);
      }
    }
  };

  const headerTitle = isEditMode && quote ? `Edit Quote: ${quote.quote_number}` : isEditMode ? 'Edit Quote' : 'New Quote';
  const currentStatus = quote ? quote.status : 'Open';
  const isApproved = currentStatus === 'Approved';
  const isRejected = currentStatus === 'Rejected';

  const handleRejectQuote = async () => {
    if (!quote?.quote_id) {
      setError('Please save the quote before rejecting.');
      return;
    }

    if (!window.confirm('Are you sure you want to mark this quote as rejected?')) {
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/api/quotes/${quote.quote_id}/reject`);
      const updatedQuoteData = response?.data?.quote ?? response?.data;
      if (updatedQuoteData) {
        setQuote((prev) =>
          prev
            ? {
                ...prev,
                ...updatedQuoteData,
                status: normalizeQuoteStatus(updatedQuoteData.status ?? 'Rejected'),
              }
            : prev
        );
      } else {
        setQuote((prev) => (prev ? { ...prev, status: 'Rejected' } : prev));
      }
      setSuccess('Quote marked as rejected.');
    } catch (e) {
      const axiosError = e as AxiosError;
      const msg =
        axiosError.response?.data &&
        typeof axiosError.response.data === 'object' &&
        'message' in (axiosError.response.data as any)
          ? ((axiosError.response.data as any).message as string)
          : 'Failed to reject quote';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <UnsavedChangesGuard when={isDirty} onSave={handleSaveQuote} />
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            maxWidth: 1000,
            mx: 'auto',
            mb: 3,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {headerTitle}
            </Typography>
            {isEditMode && quote && (
              <Chip label={currentStatus} sx={{ fontWeight: 600, ...getStatusChipStyles(currentStatus) }} />
            )}
          </Stack>
          <Stack direction="row" spacing={1.25}>

            <Button variant="contained" color="primary" startIcon={<SaveIcon />} onClick={handleSaveQuote} disabled={loading}>
              {isEditMode ? 'SAVE CHANGES' : 'CREATE QUOTE'}
            </Button>
            {isEditMode && quote && (
              <>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<DoneAllIcon />}
                  onClick={handleConvertToSalesOrder}
                  disabled={loading || isApproved || isRejected}
                >
                  CONVERT TO SO
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<BlockIcon />}
                  onClick={handleRejectQuote}
                  disabled={loading || isApproved || isRejected}
                >
                  MARK REJECTED
                </Button>
                <Button variant="contained" color="primary" startIcon={<DownloadIcon />} onClick={handleDownloadPdf}>
                  DOWNLOAD PDF
                </Button>
                <Button
                  variant="contained"
                  startIcon={<EmailIcon />}
                  sx={{ backgroundColor: '#ff9800', '&:hover': { backgroundColor: '#f57c00' } }}
                  onClick={handleEmailQuoteClick}
                >
                  EMAIL QUOTE
                </Button>
              </>
            )}
          </Stack>
        </Box>

        <Box sx={{ maxWidth: 1000, mx: 'auto', mt: 1.5 }}>
          <Paper sx={{ p: 3, backgroundColor: '#fff' }} elevation={3}>
            <Grid container spacing={2}>
              {/* Customer */}
              <Grid item xs={12} md={4}>
                {selectedCustomer ? (
                  <Stack spacing={0.5} alignItems="flex-start">
                    <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                      Customer
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        color="primary"
                        variant="outlined"
                        label={selectedCustomer.label}
                        onDelete={() => {
                          setSelectedCustomer(null);
                          setCustomerInput('');
                          setCustomerOptions([]);
                          setTimeout(() => {
                            setCustomerOpen(true);
                            customerInputRef.current?.focus();
                          }, 0);
                        }}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedCustomer(null);
                          setCustomerOpen(true);
                          setTimeout(() => customerInputRef.current?.focus(), 0);
                        }}
                      >
                        Change
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Autocomplete<CustomerOption>
                    open={customerOpen}
                    onOpen={() => {
                      setCustomerOpen(true);
                      if (customerInput.trim() && customerOptions.length === 0) {
                        runCustomerSearch(customerInput);
                      }
                    }}
                    onClose={() => setCustomerOpen(false)}
                    autoHighlight
                    loading={customerSearchLoading}
                    options={customerAutocompleteOptions}
                    value={selectedCustomer}
                    filterOptions={(options) => options}
                    onChange={(_, newValue) => {
                      if (customerEnterPressed) {
                        setCustomerEnterPressed(false);
                        return;
                      }
                      if (newValue && (newValue as CustomerOption).isNew) {
                        setIsAddCustomerModalOpen(true);
                        setNewCustomerName(customerInput.trim());
                        setSelectedCustomer(null);
                        setCustomerInput('');
                      } else {
                        setSelectedCustomer(newValue as CustomerOption);
                        setCustomerInput((newValue as CustomerOption | null)?.label ?? '');
                        setCustomerOptions([]);
                        setCustomerOpen(false);
                      }
                    }}
                    inputValue={customerInput}
                    onInputChange={(_, newInputValue, reason) => {
                      if (reason === 'reset') {
                        setCustomerInput(newInputValue);
                        return;
                      }
                      setCustomerInput(newInputValue);
                      if (customerSearchTimerRef.current) {
                        window.clearTimeout(customerSearchTimerRef.current);
                      }
                      const timer = window.setTimeout(() => {
                        runCustomerSearch(newInputValue);
                      }, 250);
                      customerSearchTimerRef.current = timer as unknown as number;
                      setCustomerOpen(Boolean(newInputValue.trim()));
                    }}
                    getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
                    isOptionEqualToValue={(option, value) => option.id === value?.id}
                    renderOption={(props, option) => {
                      const opt = option as CustomerOption;
                      const { key, ...otherProps } = props;
                      const score = typeof opt.score === 'number' ? Math.round(opt.score * 100) : null;
                      return (
                        <li key={key} {...otherProps} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            {opt.isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                            <Typography variant="body2">{opt.label}</Typography>
                          </Box>
                          {!opt.isNew && score !== null && (
                            <Typography variant="caption" color="text.secondary">
                              Score: {score}%
                            </Typography>
                          )}
                        </li>
                      );
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Customer"
                        fullWidth
                        required
                        onKeyDown={handleCustomerKeyDown}
                        inputRef={(el) => {
                          customerInputRef.current = el;
                        }}
                        sx={input56Sx}
                        InputLabelProps={{ ...params.InputLabelProps, sx: labelSx }}
                      />
                    )}
                  />
                )}
              </Grid>

              {/* Customer PO # */}
              <Grid item xs={12} md={4}>
                <TextField
                  label="Customer PO #"
                  fullWidth
                  value={customerPoNumber}
                  onChange={(e) => setCustomerPoNumber(e.target.value)}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                />
              </Grid>

              {/* Estimated Price */}
              <Grid item xs={12} md={4}>
                <TextField
                  label="Estimated Price"
                  type="number"
                  value={estimatedCost ?? ''}
                  onChange={(e) => setEstimatedCost(e.target.value === '' ? null : parseFloat(e.target.value))}
                  fullWidth
                  required
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  inputProps={{ step: '0.01', onWheel: (e: React.WheelEvent<HTMLInputElement>) => (e.currentTarget as HTMLInputElement).blur() }}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                />
              </Grid>

              {/* Product */}
              <Grid item xs={12} md={6}>
                <Autocomplete<ProductOption>
                  disablePortal
                  open={productOpen}
                  onOpen={() => setProductOpen(true)}
                  onClose={() => setProductOpen(false)}
                  autoHighlight
                  options={products}
                  value={selectedProduct}
                  onChange={(_, newValue) => {
                    if (newValue && (newValue as ProductOption).isNew) {
                      const typed = (newValue as any).inputValue?.toString?.() || productInput.trim();
                      setIsAddProductModalOpen(true);
                      setNewProductName(typed);
                      setSelectedProduct(null);
                      setProductInput('');
                      setProductOpen(false);
                    } else {
                      setSelectedProduct(newValue as ProductOption);
                      setProductOpen(false);
                    }
                  }}
                  filterOptions={(options, params) => {
                    const filtered = options.filter(option =>
                      option.label.toLowerCase().includes(params.inputValue.toLowerCase())
                    );
                    if (
                      params.inputValue !== '' &&
                      !options.some(option => option.label.toLowerCase() === params.inputValue.toLowerCase())
                    ) {
                      filtered.push({
                        label: `Add "${params.inputValue}"`,
                        isNew: true,
                        inputValue: params.inputValue,
                      } as any);
                    }
                    return filtered;
                  }}
                  inputValue={productInput}
                  onInputChange={(_, newInputValue, reason) => {
                    setProductInput(newInputValue);
                    setNewProductName(newInputValue);
                    if (productTypingTimer) window.clearTimeout(productTypingTimer);
                    if (reason === 'reset') return;
                    const text = newInputValue.trim();
                    if (text.length > 0) {
                      const t = window.setTimeout(() => setProductOpen(true), 180);
                      setProductTypingTimer(t as unknown as number);
                    } else {
                      setProductOpen(false);
                    }
                  }}
                  getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
                  isOptionEqualToValue={(option, value) => option.id === value?.id}
                  renderInput={(params) => {
                    const hasText = Boolean((params.inputProps as any)?.value);
                    const shrink = Boolean(selectedProduct) || hasText;
                    return (
                      <TextField
                        {...params}
                        label="Product"
                        fullWidth
                        required
                        onKeyDown={handleProductKeyDown}
                        onBlur={() => {
                          if (!selectedProduct) {
                            const inputValue = productInput.trim();
                            if (inputValue) {
                              const match = products.find(p => p.label.toLowerCase() === inputValue.toLowerCase());
                              if (match) {
                                setSelectedProduct(match);
                                setProductInput(match.label);
                              }
                            }
                          }
                        }}
                        sx={input56Sx}
                        InputLabelProps={{ ...params.InputLabelProps, sx: labelSx, shrink }}
                      />
                    );
                  }}
                />
              </Grid>

              {/* VIN */}
              <Grid item xs={12} md={6}>
                <TextField
                  label="VIN #"
                  fullWidth
                  value={vinNumber}
                  onChange={(e) => setVinNumber(e.target.value)}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                  error={vinNumber.length > 0 && vinNumber.length !== 17}
                  helperText={vinNumber.length > 0 && vinNumber.length !== 17 ? 'VIN must be 17 characters' : ''}
                />
              </Grid>

              {/* Vehicle Make */}
              <Grid item xs={12} md={6}>
                <TextField
                  label="Make"
                  fullWidth
                  value={vehicleMake}
                  onChange={(e) => setVehicleMake(e.target.value)}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                />
              </Grid>

              {/* Vehicle Model */}
              <Grid item xs={12} md={6}>
                <TextField
                  label="Model"
                  fullWidth
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                />
              </Grid>

              {/* Quote Date */}
              <Grid item xs={12} md={6}>
                <DatePicker
                  label="Quote Date"
                  value={quoteDate}
                  onChange={(v) => setQuoteDate(v)}
                  slotProps={{ textField: { fullWidth: true, sx: input56Sx, InputLabelProps: { sx: labelSx } } }}
                />
              </Grid>

              {/* Valid Until */}
              <Grid item xs={12} md={6}>
                <DatePicker
                  label="Valid Until"
                  value={validUntil}
                  onChange={(v) => setValidUntil(v)}
                  slotProps={{ textField: { fullWidth: true, sx: input56Sx, InputLabelProps: { sx: labelSx } } }}
                />
              </Grid>

              {/* Product Description */}
              <Grid item xs={12}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Product Description
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<TableChartIcon fontSize="small" />}
                    onClick={() => setIsTemplateDialogOpen(true)}
                  >
                    Templates
                  </Button>
                </Stack>
                <TextField
                  placeholder="Add the quote details here..."
                  fullWidth
                  multiline
                  minRows={6}
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  inputRef={productDescriptionRef}
                  sx={{
                    '& .MuiOutlinedInput-root': { borderRadius: 1 },
                    '& textarea': {
                      fontSize: 15,
                      fontFamily: 'Roboto Mono, Consolas, Menlo, monospace',
                      whiteSpace: 'pre-wrap',
                    },
                  }}
                />
              </Grid>

              {/* Terms */}
              <Grid item xs={12}>
                <TextField
                  label="Terms and Conditions"
                  fullWidth
                  multiline
                  minRows={4}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1 }, '& .MuiOutlinedInput-input': { fontSize: 15 } }}
                  InputLabelProps={{ sx: labelSx, shrink: true }}
                />
              </Grid>
            </Grid>
          </Paper>
        </Box>

        <QuoteTemplatesDialog
          open={isTemplateDialogOpen}
          onClose={() => setIsTemplateDialogOpen(false)}
          onTemplateSelected={handleTemplateInsert}
          onSuccess={(message) => setSuccess(message)}
          onError={(message) => setError(message)}
        />

        {/* Email Modal */}
        <EmailModal
          open={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          type="quote"
          recordId={quote?.quote_id}
          defaultTo={selectedCustomer?.email || ''}
          allowMessageEdit={true}
        />

        {/* Add Customer Dialog */}
        <UnifiedCustomerDialog
          open={isAddCustomerModalOpen}
          onClose={() => setIsAddCustomerModalOpen(false)}
          onSave={async (customer: CustomerFormValues) => {
            try {
              const response = await api.post('/api/customers', customer);
              const newCustomer = response.data;
              const opt = { label: newCustomer.customer_name, id: newCustomer.customer_id, email: newCustomer.email || (customer as any).email };
              setCustomerOptions((prev) => {
                const others = prev.filter((c) => c.id !== opt.id);
                return [opt, ...others];
              });
              setSelectedCustomer(opt);
              setIsAddCustomerModalOpen(false);
              setCustomerInput(opt.label);
              setCustomerOpen(false);
            } catch {
              setError('Failed to add customer');
            }
          }}
          initialCustomer={{ customer_name: newCustomerName }}
          isEditMode={false}
        />

        {/* Add Product Dialog */}
        <UnifiedProductDialog
          open={isAddProductModalOpen}
          onClose={() => setIsAddProductModalOpen(false)}
          onSave={async (product: ProductFormValues) => {
            try {
              const response = await api.post('/api/products', product);
              const newProductOption = { label: product.product_name, id: response.data.product_id, description: product.product_name };
              setProducts((prev) => [...prev, newProductOption]);
              setSelectedProduct(newProductOption);
              setProductInput(newProductOption.label);
              setIsAddProductModalOpen(false);
              setNewProductName('');
            } catch {
              setError('Failed to add product.');
            }
          }}
          initialProduct={{ product_name: newProductName || productInput }}
          isEditMode={false}
        />

        {/* Snackbars */}
        <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width: '100%' }}>
            {success}
          </Alert>
        </Snackbar>
        <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
        </Snackbar>
      </Container>
    </LocalizationProvider>
  );
};

export default QuoteEditorPage;
