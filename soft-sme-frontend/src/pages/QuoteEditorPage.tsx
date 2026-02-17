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
import CircularProgress from '@mui/material/CircularProgress';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/axios';
import { AxiosError } from 'axios';
import EmailModal from '../components/EmailModal';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';
import UnifiedProductDialog, { ProductFormValues } from '../components/UnifiedProductDialog';
import UnifiedSalesPersonDialog, { SalesPersonFormValues } from '../components/UnifiedSalesPersonDialog';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import { normalizeQuoteStatus, QuoteStatus } from '../utils/quoteStatus';
import QuoteTemplatesDialog, { QuoteDescriptionTemplate } from '../components/QuoteTemplatesDialog';
import QuoteDescriptionTableEditor from '../components/QuoteDescriptionTableEditor';
import {
  createDefaultTwoColumnTable,
  tableToMarkdown,
  tryParseSingleMarkdownTable,
} from '../utils/quoteDescriptionTable';

interface CustomerOption {
  label: string;
  id?: number;
  email?: string;
  isNew?: boolean;
}

interface ProductOption {
  label: string;
  id?: number;
  description?: string;
  isNew?: boolean;
  inputValue?: string;
}

interface SalesPersonOption {
  label: string;
  id?: number;
  email?: string;
  isNew?: boolean;
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
  vehicle_year?: number | null;
  vehicle_make?: string;
  vehicle_model?: string;
  sales_person_id?: number | null;
  sales_person_name?: string | null;
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

const rankAndFilterCustomers = (options: CustomerOption[], query: string): CustomerOption[] => {
  const q = normalizeString(query);
  if (!q) return options.slice(0, 8);
  const scored = options
    .map((opt) => {
      const labelNorm = normalizeString(opt.label);
      let score = -1;
      if (labelNorm.startsWith(q)) score = 3;
      else if (labelNorm.split(' ').some((w) => w.startsWith(q))) score = 2;
      else if (labelNorm.includes(q)) score = 1;
      return { opt, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.opt.label.localeCompare(b.opt.label));
  return scored.slice(0, 8).map((x) => x.opt);
};

const rankAndFilterSalesPeople = (options: SalesPersonOption[], query: string): SalesPersonOption[] => {
  const q = normalizeString(query);
  if (!q) return options.slice(0, 8);
  const scored = options
    .map((opt) => {
      const labelNorm = normalizeString(opt.label);
      let score = -1;
      if (labelNorm.startsWith(q)) score = 3;
      else if (labelNorm.split(' ').some((w) => w.startsWith(q))) score = 2;
      else if (labelNorm.includes(q)) score = 1;
      return { opt, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.opt.label.localeCompare(b.opt.label));
  return scored.slice(0, 8).map((x) => x.opt);
};

const QuoteEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isCreationMode = id === 'new';
  const isEditMode = Boolean(id) && !isCreationMode;

  // lists & data
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [salesPeople, setSalesPeople] = useState<SalesPersonOption[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);

  // form state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [selectedSalesPerson, setSelectedSalesPerson] = useState<SalesPersonOption | null>(null);
  const [quoteDate, setQuoteDate] = useState<Dayjs | null>(dayjs());
  const [validUntil, setValidUntil] = useState<Dayjs | null>(dayjs().add(30, 'day'));
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [vinNumber, setVinNumber] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');

  // ui
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // autocomplete state (customer)
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerInput, setCustomerInput] = useState('');
  const [customerTypingTimer, setCustomerTypingTimer] = useState<number | null>(null);
  const [customerEnterPressed, setCustomerEnterPressed] = useState(false);
  const [salesPersonOpen, setSalesPersonOpen] = useState(false);
  const [salesPersonInput, setSalesPersonInput] = useState('');
  const [salesPersonTypingTimer, setSalesPersonTypingTimer] = useState<number | null>(null);
  const [salesPersonEnterPressed, setSalesPersonEnterPressed] = useState(false);
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
  const [isAddSalesPersonModalOpen, setIsAddSalesPersonModalOpen] = useState(false);
  const [newSalesPersonName, setNewSalesPersonName] = useState('');

  // email modal
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [forceTextDescription, setForceTextDescription] = useState(false);

  // Unsaved changes guard: normalized signature structure
  const [initialSignature, setInitialSignature] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const getNormalizedSignature = useCallback(() => ({
    customer: selectedCustomer?.id || quote?.customer_id || null,
    salesPerson: selectedSalesPerson?.id || quote?.sales_person_id || null,
    product: selectedProduct?.label || quote?.product_name || '',
    quoteDate: quoteDate?.toISOString?.() || quote?.quote_date || null,
    validUntil: validUntil?.toISOString?.() || quote?.valid_until || null,
    estimatedCost: estimatedCost ?? quote?.estimated_cost ?? null,
    productDescription: (productDescription || '').trim(),
    terms: (terms || '').trim(),
    customerPoNumber: (customerPoNumber || '').trim(),
    vinNumber: (vinNumber || '').trim(),
    vehicleYear: (vehicleYear || '').trim(),
    vehicleMake: (vehicleMake || '').trim(),
    vehicleModel: (vehicleModel || '').trim(),
  }), [selectedCustomer, selectedSalesPerson, quote, selectedProduct, quoteDate, validUntil, estimatedCost, productDescription, terms, customerPoNumber, vinNumber, vehicleYear, vehicleMake, vehicleModel]);

  const handleTemplateInsert = useCallback((template: QuoteDescriptionTemplate) => {
    setProductDescription(template.content);
    setForceTextDescription(false);
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

  const handleInsertDescriptionTable = useCallback(() => {
    setProductDescription(tableToMarkdown(createDefaultTwoColumnTable(18)));
    setForceTextDescription(false);
  }, [productDescription]);

  const parsedSingleTable = useMemo(() => tryParseSingleMarkdownTable(productDescription), [productDescription]);
  const isTableMode = Boolean(parsedSingleTable) && !forceTextDescription;
  const currentTable = parsedSingleTable ?? createDefaultTwoColumnTable(18);

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
    fetchCustomers();
    fetchProducts();
    fetchSalesPeople();
    // For creation mode, mark as loaded after lists are fetched
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
        setSelectedCustomer(null); // set after customers load
        setSelectedProduct({ label: q.product_name });
        setQuoteDate(dayjs(q.quote_date));
        setValidUntil(dayjs(q.valid_until));
        setEstimatedCost(Number(q.estimated_cost ?? 0));
        setProductDescription(q.product_description || '');
        setTerms(q.terms || '');
        setCustomerPoNumber(q.customer_po_number || '');
        setVinNumber(q.vin_number || '');
        setVehicleYear(q.vehicle_year ? String(q.vehicle_year) : '');
        setVehicleMake(q.vehicle_make || '');
        setVehicleModel(q.vehicle_model || '');
        setCustomerInput(q.customer_name || '');
        setProductInput(q.product_name || '');
        setSalesPersonInput(q.sales_person_name || '');
        setIsDataLoaded(true); // Mark data as loaded
      } catch (error) {
        console.error('Failed to load quote:', error);
        setError('Failed to load quote');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEditMode]);

  // after customers arrive, map selectedCustomer with email
  useEffect(() => {
    if (quote && customers.length > 0) {
      const customerWithEmail = customers.find((c) => c.id === quote.customer_id);
      if (customerWithEmail) {
        setSelectedCustomer(customerWithEmail);
      }
    }
  }, [customers, quote]);

  useEffect(() => {
    if (quote && salesPeople.length > 0) {
      const salesPerson = salesPeople.find((sp) => sp.id === quote.sales_person_id);
      if (salesPerson) {
        setSelectedSalesPerson(salesPerson);
        if (!salesPersonInput) {
          setSalesPersonInput(salesPerson.label);
        }
      }
    }
  }, [salesPeople, quote, salesPersonInput]);

  useEffect(() => {
    return () => {
      if (customerTypingTimer) window.clearTimeout(customerTypingTimer);
      if (productTypingTimer) window.clearTimeout(productTypingTimer);
      if (salesPersonTypingTimer) window.clearTimeout(salesPersonTypingTimer);
    };
  }, [customerTypingTimer, productTypingTimer, salesPersonTypingTimer]);

  const fetchCustomers = async () => {
    try {
      const res = await api.get('/api/customers');
      const mapped = (res.data || []).map((c: any) => ({
        label: c.customer_name,
        id: c.customer_id,
        email: c.email,
      }));
      setCustomers(mapped);
    } catch {
      setError('Failed to load customers');
    }
  };

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

  const fetchSalesPeople = async () => {
    try {
      const res = await api.get('/api/sales-people');
      const mapped = (res.data || [])
        .filter((sp: any) => sp.is_active !== false)
        .map((sp: any) => ({
          label: sp.sales_person_name,
          id: sp.sales_person_id,
          email: sp.email,
        }));
      setSalesPeople(mapped);
    } catch {
      setError('Failed to load sales people');
    }
  };

  const exactCustomerMatch = (query: string): CustomerOption | null => {
    const nq = normalizeString(query);
    return customers.find((c) => normalizeString(c.label) === nq) || null;
  };

  const exactSalesPersonMatch = (query: string): SalesPersonOption | null => {
    const nq = normalizeString(query);
    return salesPeople.find((s) => normalizeString(s.label) === nq) || null;
  };

  const resetForm = () => {
    setSelectedCustomer(null);
    setSelectedProduct(null);
    setSelectedSalesPerson(null);
    setQuoteDate(dayjs());
    setValidUntil(dayjs().add(30, 'day'));
    setEstimatedCost(null);
    setProductDescription('');
    setTerms('');
    setCustomerPoNumber('');
    setVinNumber('');
    setVehicleYear('');
    setVehicleMake('');
    setVehicleModel('');
    setCustomerInput('');
    setProductInput('');
    setSalesPersonInput('');
  };

  const handleSaveQuote = async () => {
    if (!selectedCustomer || !selectedProduct || !quoteDate || !validUntil || estimatedCost == null) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setIsSaving(true);
    try {
      const vehicleYearValue = vehicleYear.trim();
      const vehicleYearNumber = vehicleYearValue ? Number(vehicleYearValue) : null;
      const payload = {
        customer_id: selectedCustomer.id,
        sales_person_id: selectedSalesPerson?.id ?? null,
        product_name: selectedProduct.label.trim(),
        quote_date: quoteDate.format('YYYY-MM-DD'),
        valid_until: validUntil.format('YYYY-MM-DD'),
        estimated_cost: Number(estimatedCost),
        product_description: productDescription,
        terms,
        customer_po_number: customerPoNumber,
        vin_number: vinNumber,
        vehicle_year: Number.isFinite(vehicleYearNumber) ? vehicleYearNumber : null,
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
            sales_person_id: selectedSalesPerson?.id ?? null,
            sales_person_name: selectedSalesPerson?.label ?? null,
            quote_date: payload.quote_date,
            valid_until: payload.valid_until,
            product_name: payload.product_name,
            product_description: payload.product_description,
            estimated_cost: payload.estimated_cost,
            status: 'Open',
            terms: payload.terms,
            customer_po_number: payload.customer_po_number,
            vin_number: payload.vin_number,
            vehicle_year: payload.vehicle_year,
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

  const generateEstimatePdf = () => {
    const doc = new jsPDF({ unit: 'pt' });

    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - margin * 2;

    const title = 'Estimate Cost';
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin, 40);

    // Optional: show quote/product context when available
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    let yMeta = 58;
    if (quote?.quote_number) {
      doc.text(`Quote: ${quote.quote_number}`, margin, yMeta);
      yMeta += 14;
    }
    if (selectedCustomer?.label) {
      doc.text(`Customer: ${selectedCustomer.label}`, margin, yMeta);
      yMeta += 14;
    }
    if (selectedProduct?.label) {
      doc.text(`Product: ${selectedProduct.label}`, margin, yMeta);
      yMeta += 14;
    }

    const head = [[
      'SN',
      'Item Code',
      'Description',
      'Qty',
      'Unit',
      'Unit Price',
      'Line Total',
    ]];

    const body = [
      ['1', 'LABOUR', 'Labour Hours', '52.41', 'hr', '40.00', '2096.40'],
      ['2', '1705110', '48" ALUM UNDERBODY TOOLBOX', '2', 'Each', '1246.94', '2493.88'],
      ['3', '3X(3/8)', 'Flatbar', '75', 'ft', '3.91', '293.25'],
      ['4', '2X2X(3/16)AG L', 'Angle', '10', 'ft', '2.68', '26.80'],
      ['5', '(3/4)(A36/44W)', 'HR ROUND - ASTM A36/44W', '10', 'ft', '1.67', '16.70'],
      ['6', '5X3X(1/4)ANG LE3', 'HEAT # 52118708', '20', 'ft', '7.01', '140.20'],
      ['7', '(4-1)(A36/44W)', 'CHANNEL ASTM A36/44W', '100', 'ft', '4.14', '414.00'],
      ['8', '83021K05', 'CLOVAPRIME 21 EPOXY PRIM GREY 5 GAL KIT', '1', 'Each', '441.29', '441.29'],
      ['9', '83904K05', 'GEMINI AMOURSHIELD BLACK 5G KIT', '2', 'Each', '639.73', '1279.46'],
      ['10', 'CLS-AS2620C', 'CR ANTI SAIL BRACKET', '3', 'Each', '8.70', '26.10'],
      ['11', 'AUP-IMXGT-2436CD', '1/4" RUBBER BLACK CHEVRO', '3', 'Each', '19.53', '58.59'],
      ['12', 'SUPPLY', 'Supply', '1', 'Each', '209.64', '209.64'],
      ['13', 'OVERHEAD', 'Overhead Hours', '52.41', 'hr', '30.00', '1572.30'],
    ];

    // Define fixed widths for non-description cols; make description fill remaining space
    const widths = {
      sn: 26,
      code: 80,
      qty: 44,
      unit: 40,
      unitPrice: 72,
      lineTotal: 80,
    };
    const nonDescTotal = widths.sn + widths.code + widths.qty + widths.unit + widths.unitPrice + widths.lineTotal;
    const descWidth = Math.max(140, usableWidth - nonDescTotal);

    autoTable(doc, {
      head,
      body,
      startY: Math.max(110, yMeta + 10),
      margin: { left: margin, right: margin },
      tableWidth: usableWidth,
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [33, 150, 243], halign: 'center' },
      columnStyles: {
        0: { cellWidth: widths.sn, halign: 'right' },
        1: { cellWidth: widths.code },
        2: { cellWidth: descWidth },
        3: { cellWidth: widths.qty, halign: 'right' },
        4: { cellWidth: widths.unit },
        5: { cellWidth: widths.unitPrice, halign: 'right' },
        6: { cellWidth: widths.lineTotal, halign: 'right' },
      },
      theme: 'striped',
      didParseCell: (data) => {
        if (data.section === 'body' && [0, 3, 5, 6].includes(data.column.index)) {
          data.cell.styles.halign = 'right';
        }
      },
    });

    const afterTableY = (doc as any).lastAutoTable?.finalY || 110;
    const subtotal = 'Sub Total: 9068.61';
    const gst = 'Total GST: 453.43';
    const total = 'Total: 9522.04';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const rightX = pageWidth - margin;
    doc.text(subtotal, rightX, afterTableY + 24, { align: 'right' });
    doc.text(gst, rightX, afterTableY + 44, { align: 'right' });
    doc.setFontSize(12);
    doc.text(total, rightX, afterTableY + 70, { align: 'right' });

    const filenameBase = quote?.quote_number ? `Estimate_${quote.quote_number}` : 'Estimate_Cost';
    doc.save(`${filenameBase}.pdf`);
  };

  const handleEstimateCost = () => {
    if (isEstimating) return;
    setIsEstimating(true);
    window.setTimeout(() => {
      setIsEstimating(false);
      try {
        generateEstimatePdf();
        setSuccess('Estimate generated successfully.');
      } catch {
        setError('Failed to generate estimate PDF.');
      }
    }, 15000);
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
      } else {
        setCustomerEnterPressed(true);
        setNewCustomerName(inputValue);
        setIsAddCustomerModalOpen(true);
      }
    }
  };

  const handleSalesPersonKeyDown = (event: React.KeyboardEvent) => {
    const inputValue = salesPersonInput.trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) { setSalesPersonOpen(false); return; }
    if (isArrow) return;

    if (isEnter || isTab) {
      if (isEnter && event.ctrlKey && inputValue) {
        event.preventDefault();
        setSalesPersonEnterPressed(true);
        setNewSalesPersonName(inputValue);
        setIsAddSalesPersonModalOpen(true);
        return;
      }
      const match = exactSalesPersonMatch(inputValue);
      if (salesPersonOpen) return;
      if (!inputValue) return;

      event.preventDefault();
      if (match) {
        setSelectedSalesPerson(match);
        setSalesPersonInput(match.label);
      } else {
        setSalesPersonEnterPressed(true);
        setNewSalesPersonName(inputValue);
        setIsAddSalesPersonModalOpen(true);
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
              <Grid item xs={12} md={3}>
                <Autocomplete<CustomerOption>
                  open={customerOpen}
                  onOpen={() => setCustomerOpen(true)}
                  onClose={() => setCustomerOpen(false)}
                  autoHighlight
                  options={customers}
                  value={selectedCustomer}
                  onChange={(_, newValue) => {
                    if (customerEnterPressed) { setCustomerEnterPressed(false); return; }
                    if (newValue && (newValue as CustomerOption).isNew) {
                      setIsAddCustomerModalOpen(true);
                      setNewCustomerName(customerInput);
                      setSelectedCustomer(null);
                      setCustomerInput('');
                    } else {
                      setSelectedCustomer(newValue as CustomerOption);
                    }
                  }}
                  filterOptions={(options, params) => {
                    const ranked = rankAndFilterCustomers(options as CustomerOption[], params.inputValue || '');
                    const hasExact = !!(params.inputValue && customers.some(c => normalizeString(c.label) === normalizeString(params.inputValue)));
                    const result: any[] = [...ranked];
                    if ((params.inputValue || '').trim() !== '' && !hasExact) {
                      result.push({ label: `Add "${params.inputValue}" as New Customer`, isNew: true });
                    }
                    if (ranked.length === 0 && (params.inputValue || '').trim() !== '' && !hasExact) {
                      return result;
                    }
                    return result;
                  }}
                  inputValue={customerInput}
                  onInputChange={(_, newInputValue, reason) => {
                    setCustomerInput(newInputValue);
                    if (customerTypingTimer) window.clearTimeout(customerTypingTimer);
                    if (reason === 'reset') return;
                    const text = newInputValue.trim();
                    if (text.length > 0) {
                      const t = window.setTimeout(() => setCustomerOpen(true), 180);
                      setCustomerTypingTimer(t as unknown as number);
                    } else {
                      setCustomerOpen(false);
                    }
                  }}
                  getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
                  isOptionEqualToValue={(option, value) => option.id === value?.id}
                  renderOption={(props, option) => {
                    const isNew = (option as CustomerOption).isNew;
                    const { key, ...otherProps } = props;
                    return (
                      <li key={key} {...otherProps} style={{ display: 'flex', alignItems: 'center', opacity: isNew ? 0.9 : 1 }}>
                        {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                        <span>{(option as CustomerOption).label}</span>
                      </li>
                    );
                  }}
                  renderInput={(params) => {
                    const hasText = Boolean((params.inputProps as any)?.value);
                    const shrink = Boolean(selectedCustomer) || hasText;
                    return (
                      <TextField
                        {...params}
                        label="Customer"
                        fullWidth
                        required
                        onKeyDown={handleCustomerKeyDown}
                        onBlur={() => {
                          if (!selectedCustomer) {
                            const inputValue = customerInput.trim();
                            if (inputValue) {
                              const match = exactCustomerMatch(inputValue);
                              if (match) {
                                setSelectedCustomer(match);
                                setCustomerInput(match.label);
                              }
                            }
                          }
                        }}
                        inputRef={(el) => { customerInputRef.current = el; }}
                        sx={input56Sx}
                        InputLabelProps={{ ...params.InputLabelProps, sx: labelSx, shrink }}
                      />
                    );
                  }}
                />
              </Grid>

              {/* Sales Person */}
              <Grid item xs={12} md={3}>
                <Autocomplete<SalesPersonOption>
                  open={salesPersonOpen}
                  onOpen={() => setSalesPersonOpen(true)}
                  onClose={() => setSalesPersonOpen(false)}
                  autoHighlight
                  options={salesPeople}
                  value={selectedSalesPerson}
                  onChange={(_, newValue) => {
                    if (salesPersonEnterPressed) { setSalesPersonEnterPressed(false); return; }
                    if (newValue && (newValue as SalesPersonOption).isNew) {
                      setIsAddSalesPersonModalOpen(true);
                      setNewSalesPersonName(salesPersonInput);
                      setSelectedSalesPerson(null);
                      setSalesPersonInput('');
                    } else {
                      const chosen = newValue as SalesPersonOption | null;
                      setSelectedSalesPerson(chosen);
                      setSalesPersonInput(chosen?.label ?? '');
                    }
                  }}
                  filterOptions={(options, params) => {
                    const ranked = rankAndFilterSalesPeople(options as SalesPersonOption[], params.inputValue || '');
                    const hasExact = !!(params.inputValue && salesPeople.some(s => normalizeString(s.label) === normalizeString(params.inputValue)));
                    const result: any[] = [...ranked];
                    if ((params.inputValue || '').trim() !== '' && !hasExact) {
                      result.push({ label: `Add "${params.inputValue}" as New Sales Person`, isNew: true });
                    }
                    if (ranked.length === 0 && (params.inputValue || '').trim() !== '' && !hasExact) {
                      return result;
                    }
                    return result;
                  }}
                  inputValue={salesPersonInput}
                  onInputChange={(_, newInputValue, reason) => {
                    setSalesPersonInput(newInputValue);
                    if (salesPersonTypingTimer) window.clearTimeout(salesPersonTypingTimer);
                    if (reason === 'reset') return;
                    const text = newInputValue.trim();
                    if (text.length > 0) {
                      const t = window.setTimeout(() => setSalesPersonOpen(true), 180);
                      setSalesPersonTypingTimer(t as unknown as number);
                    } else {
                      setSalesPersonOpen(false);
                    }
                  }}
                  getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
                  isOptionEqualToValue={(option, value) => option.id === value?.id}
                  ListboxProps={{ onMouseDown: (event) => event.preventDefault() }}
                  renderOption={(props, option) => {
                    const isNew = (option as SalesPersonOption).isNew;
                    const { key, ...otherProps } = props;
                    return (
                      <li key={key} {...otherProps} style={{ display: 'flex', alignItems: 'center', opacity: isNew ? 0.9 : 1 }}>
                        {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                        <span>{(option as SalesPersonOption).label}</span>
                      </li>
                    );
                  }}
                  renderInput={(params) => {
                    const hasText = Boolean((params.inputProps as any)?.value);
                    const shrink = Boolean(selectedSalesPerson) || hasText;
                    return (
                      <TextField
                        {...params}
                        label="Sales Person"
                        fullWidth
                        onKeyDown={handleSalesPersonKeyDown}
                        onBlur={() => {
                          if (!selectedSalesPerson) {
                            const inputValue = salesPersonInput.trim();
                            if (inputValue) {
                              const match = exactSalesPersonMatch(inputValue);
                              if (match) {
                                setSelectedSalesPerson(match);
                                setSalesPersonInput(match.label);
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

              {/* Customer PO # */}
              <Grid item xs={12} md={3}>
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
              <Grid item xs={12} md={3}>
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
                  placeholder="Optional"
                  value={vinNumber}
                  onChange={(e) => setVinNumber(e.target.value)}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
                />
              </Grid>

              {/* Vehicle Year */}
              <Grid item xs={12} md={6}>
                <TextField
                  label="Year"
                  fullWidth
                  placeholder="Optional"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  inputProps={{ inputMode: 'numeric', maxLength: 4 }}
                  sx={input56Sx}
                  InputLabelProps={{ sx: labelSx }}
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
                  <Stack direction="row" spacing={1}>
                    <Button variant="outlined" size="small" onClick={() => setIsTemplateDialogOpen(true)}>
                      Templates
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<TableChartIcon fontSize="small" />}
                      onClick={handleInsertDescriptionTable}
                    >
                      Insert Table
                    </Button>
                    {isTableMode && (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setForceTextDescription(true)}
                      >
                        Edit As Text
                      </Button>
                    )}
                  </Stack>
                </Stack>
                {isTableMode ? (
                  <QuoteDescriptionTableEditor
                    value={currentTable}
                    onChange={(next) => setProductDescription(tableToMarkdown(next))}
                    disableColumnEditing={false}
                  />
                ) : (
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
                )}
                <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleEstimateCost}
                    disabled={isEstimating}
                  >
                    ESTIMATE COST
                  </Button>
                  {isEstimating && (
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <CircularProgress size={22} />
                      <Typography variant="body2" color="text.secondary">Generating estimate…</Typography>
                    </Stack>
                  )}
                </Box>
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
              setCustomers((prev) => [...prev, opt]);
              setSelectedCustomer(opt);
              setIsAddCustomerModalOpen(false);
              setCustomerInput(opt.label);
            } catch {
              setError('Failed to add customer');
            }
          }}
          initialCustomer={{ customer_name: newCustomerName }}
          isEditMode={false}
        />

        {/* Add Sales Person Dialog */}
        <UnifiedSalesPersonDialog
          open={isAddSalesPersonModalOpen}
          onClose={() => setIsAddSalesPersonModalOpen(false)}
          onSave={async (person: SalesPersonFormValues) => {
            try {
              const response = await api.post('/api/sales-people', person);
              const newPerson = response.data;
              const opt = { label: newPerson.sales_person_name, id: newPerson.sales_person_id, email: newPerson.email || (person as any).email };
              setSalesPeople((prev) => [...prev, opt]);
              setSelectedSalesPerson(opt);
              setIsAddSalesPersonModalOpen(false);
              setSalesPersonInput(opt.label);
            } catch {
              setError('Failed to add sales person');
            }
          }}
          initialSalesPerson={{ sales_person_name: newSalesPersonName }}
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
