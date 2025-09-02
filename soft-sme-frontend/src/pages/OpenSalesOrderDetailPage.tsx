// src/pages/SalesOrderDetailPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography, Box, TextField, Button, MenuItem, Stack, Autocomplete, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions, Container, Paper, Alert,
  Card, CardContent, CircularProgress, InputAdornment, Snackbar
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import SaveIcon from '@mui/icons-material/Save';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DownloadIcon from '@mui/icons-material/Download';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { toast } from 'react-toastify';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import UnifiedProductDialog, { ProductFormValues } from '../components/UnifiedProductDialog';
import UnifiedPartDialog, { PartFormValues } from '../components/UnifiedPartDialog';
import UnifiedCustomerDialog, { CustomerFormValues } from '../components/UnifiedCustomerDialog';
import {
  parseNumericInput,
  SalesOrderLineItem as RobustLineItem
} from '../utils/salesOrderCalculations';
import { formatCurrency } from '../utils/formatters';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';

const UNIT_OPTIONS = ['Each', 'cm', 'ft', 'kg', 'pcs', 'hr', 'L'];
type PartOption = string | { label: string; isNew?: true; inputValue?: string };
const DEFAULT_GST_RATE = 5.0;

interface CustomerOption { label: string; id?: number; isNew?: true; }
interface ProductOption { label: string; id?: number; description?: string; isNew?: true; }

interface SalesOrderLineItem {
  line_item_id?: number;
  part_number: string;
  part_description: string;
  quantity: string;
  unit: string;
  unit_price: number;
  gst: number;
  line_amount: number;
  // Optional canonical identifier used for backend validation and saving
  part_id?: number;
}

interface SalesOrder {
  sales_order_id: number;
  sales_order_number: string;
  customer_id: number;
  customer_name: string;
  subtotal: number | null;
  gst_amount: number | null;
  total_amount: number | null;
  sales_date: string;
  product_name: string;
  product_description: string;
  terms: string;
  estimated_cost: number | null;
  status: string;
  exported_to_qbo?: boolean;
  qbo_invoice_id?: string;
  qbo_export_date?: string;
  qbo_export_status?: string;
}

interface PartsToOrderItem {
  sales_order_id: number;
  part_number: string;
  part_description: string;
  quantity_to_order: string;
  unit: string;
  unit_price: number;
  line_amount: number;
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ')
   .replace(/\s+/g, ' ').trim().toUpperCase();

const rankAndFilter = <T extends { label: string }>(options: T[], query: string, limit = 8) => {
  const q = normalize(query);
  if (!q) return options.slice(0, limit);
  const scored = options.map(opt => {
    const labelNorm = normalize(opt.label);
    let score = -1;
    if (labelNorm.startsWith(q)) score = 3;
    else if (labelNorm.split(' ').some(w => w.startsWith(q))) score = 2;
    else if (labelNorm.includes(q)) score = 1;
    return { opt, score };
  }).filter(x => x.score >= 0);
  scored.sort((a,b) => b.score - a.score || a.opt.label.localeCompare(b.opt.label));
  return scored.slice(0, limit).map(x => x.opt);
};

const SalesOrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isCreationMode = id === 'new';
  const isNumericId = !!id && /^\d+$/.test(id);

  const navigate = useNavigate();
  const { user } = useAuth();
  const isSalesPurchaseUser = user?.access_role === 'Sales and Purchase';

  // Shared state
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [marginSchedule, setMarginSchedule] = useState<any[]>([]);
  const [globalLabourRate, setGlobalLabourRate] = useState<number | null>(null);
  const [globalOverheadRate, setGlobalOverheadRate] = useState<number | null>(null);
  const [globalSupplyRate, setGlobalSupplyRate] = useState<number | null>(null);

  // Create/Edit common form state
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerTypingTimer, setCustomerTypingTimer] = useState<number | null>(null);
  const [customerEnterPressed, setCustomerEnterPressed] = useState(false);
  const customerInputRef = useRef<HTMLInputElement | null>(null);

  const [product, setProduct] = useState<ProductOption | null>(null);
  const [productInput, setProductInput] = useState('');
  const [productOpen, setProductOpen] = useState(false);
  const [productTypingTimer, setProductTypingTimer] = useState<number | null>(null);

  const [salesDate, setSalesDate] = useState<Dayjs | null>(dayjs());
  const [productDescription, setProductDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [customerPoNumber, setCustomerPoNumber] = useState('');
  const [vinNumber, setVinNumber] = useState('');
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  const [lineItems, setLineItems] = useState<SalesOrderLineItem[]>([]);

  const robust: RobustLineItem[] = useMemo(() => (
    lineItems.map(li => ({
      part_number: li.part_number,
      part_description: li.part_description,
      quantity: parseNumericInput(li.quantity),
      unit: li.unit,
      unit_price: li.unit_price,
    }))
  ), [lineItems]);

  // Calculate totals from all visible line items (including LABOUR/OVERHEAD from backend)
  const totals = useMemo(() => {
    // If no line items, return zero totals
    if (!lineItems || lineItems.length === 0) {
      return {
        subtotal: 0,
        total_gst_amount: 0,
        total_amount: 0
      };
    }
    
    const subtotal = lineItems.reduce((sum, item) => {
      const itemAmount = item.line_amount || 0;
      return sum + itemAmount;
    }, 0);
    
    const total_gst_amount = subtotal * 0.05;
    const total_amount = subtotal + total_gst_amount;
    
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      total_gst_amount: Math.round(total_gst_amount * 100) / 100,
      total_amount: Math.round(total_amount * 100) / 100
    };
  }, [lineItems]);
  
  const subtotal = totals.subtotal;
  const totalGSTAmount = totals.total_gst_amount;
  const totalAmount = totals.total_amount;

  // Edit-only state
  const [salesOrder, setSalesOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState<boolean>(!isCreationMode);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [quantityToOrderItems, setQuantityToOrderItems] = useState<PartsToOrderItem[]>([]);
  // Unsaved changes guard (normalize header + stable line items signature; exclude derived quantityToOrderItems)
  const [initialSignature, setInitialSignature] = useState<string>('');
  const [isDataFullyLoaded, setIsDataFullyLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const getLineItemsSignature = useCallback((items: SalesOrderLineItem[]) => {
    return JSON.stringify(
      (items || [])
        .map(it => ({
          part_number: (it.part_number || '').trim(),
          part_description: (it.part_description || '').trim(),
          quantity: parseNumericInput(it.quantity),
          unit: (it.unit || '').trim(),
          unit_price: parseNumericInput(it.unit_price),
        }))
        .sort((a, b) => {
          if (a.part_number !== b.part_number) return a.part_number.localeCompare(b.part_number);
          return a.quantity - b.quantity;
        })
    );
  }, []);

  const getHeaderSignature = useCallback(() => ({
    customer: customer ? { id: customer.id, label: customer.label } : null,
    product: product ? { id: product.id, label: product.label } : null,
    salesDate: salesDate ? salesDate.toISOString() : null,
    terms: (terms || '').trim(),
    customerPoNumber: (customerPoNumber || '').trim(),
    vinNumber: (vinNumber || '').trim(),
    estimatedCost: estimatedCost != null ? Number(estimatedCost) : null,
  }), [customer, product, salesDate, terms, customerPoNumber, vinNumber, estimatedCost]);

  // Set initial signature only once after data is fully loaded
  useEffect(() => {
    if (isDataFullyLoaded && initialSignature === '') {
      const signature = JSON.stringify({ 
        header: getHeaderSignature(), 
        lineItems: getLineItemsSignature(lineItems) 
      });
      setInitialSignature(signature);
    }
  }, [isDataFullyLoaded, initialSignature, getHeaderSignature, getLineItemsSignature, lineItems]);

  const currentSignature = useMemo(() => JSON.stringify({ 
    header: getHeaderSignature(), 
    lineItems: getLineItemsSignature(lineItems) 
  }), [getHeaderSignature, getLineItemsSignature, lineItems]);

  const isDirty = Boolean(initialSignature) && initialSignature !== currentSignature && !isSaving;
  const isClosed = !!salesOrder && salesOrder.status?.toLowerCase() === 'closed';
  const [originalLineItems, setOriginalLineItems] = useState<SalesOrderLineItem[]>([]);
  const [negativeAvailabilityItems, setNegativeAvailabilityItems] = useState<Array<{
    lineItemIndex: number; partNumber: string; partDescription: string; excessQuantity: number; unit: string;
  }>>([]);
  const [transferDialogItem, setTransferDialogItem] = useState<{
    lineItemIndex: number; partNumber: string; partDescription: string; excessQuantity: number; unit: string;
  } | null>(null);
  // Part combobox UX (similar to PO page)
  const [partOpenIndex, setPartOpenIndex] = useState<number | null>(null);
  const [partTypingTimer, setPartTypingTimer] = useState<number | null>(null);
  const [partEnterPressedIndex, setPartEnterPressedIndex] = useState<number | null>(null);
  const [ptoOpenIndex, setPtoOpenIndex] = useState<number | null>(null);
  const [ptoEnterPressedIndex, setPtoEnterPressedIndex] = useState<number | null>(null);

  // Add New Part dialog state (for line items and parts-to-order)
  const [openPartDialogForLine, setOpenPartDialogForLine] = useState(false);
  const [linePartToAddIndex, setLinePartToAddIndex] = useState<number | null>(null);
  const [linePartNumberForModal, setLinePartNumberForModal] = useState('');
  const [openPartDialogForPTO, setOpenPartDialogForPTO] = useState(false);
  const [ptoPartToAddIndex, setPtoPartToAddIndex] = useState<number | null>(null);
  const [ptoPartNumberForModal, setPtoPartNumberForModal] = useState('');
  const alertHeightPx = 64; // approximate banner height
  const activeAlertOffset = negativeAvailabilityItems.length > 0 ? (8 + alertHeightPx * negativeAvailabilityItems.length) : 0;

  // Line items signature for change detection - no debouncing needed
  const lineItemsSignature = useMemo(() => {
    return JSON.stringify(
      lineItems.map(li => ({
        part_number: li.part_number,
        part_description: li.part_description,
        quantity: li.quantity,
        unit: li.unit,
        unit_price: li.unit_price,
        line_amount: li.line_amount,
      }))
    );
  }, [lineItems]);

  // Handle Ctrl+Enter and Enter/Tab on part input similar to PO page
  const handleLinePartKeyDown = (idx: number, event: React.KeyboardEvent) => {
    const inputValue = (lineItems[idx]?.part_number || '').trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) { setPartOpenIndex(null); return; }
    if (isArrow) {
      if (event.key === 'ArrowDown' && partOpenIndex !== idx) setPartOpenIndex(idx);
      return;
    }
    if (partOpenIndex === idx && (isEnter || isTab)) {
      return; // let Autocomplete handle highlighted selection
    }
    if ((isEnter || isTab) && inputValue) {
      if (isEnter && (event as any).ctrlKey) {
        event.preventDefault();
        setPartEnterPressedIndex(idx);
        setLinePartNumberForModal(inputValue.toUpperCase());
        setLinePartToAddIndex(idx);
        setOpenPartDialogForLine(true);
        setPartOpenIndex(null);
        return;
      }
      // If exact match exists, let onBlur handle it; otherwise open dialog on Enter
      const match = inventoryItems.find((inv:any) => inv.part_number.toUpperCase() === inputValue.toUpperCase());
      if (!match && isEnter) {
        event.preventDefault();
        setPartEnterPressedIndex(idx);
        setLinePartNumberForModal(inputValue.toUpperCase());
        setLinePartToAddIndex(idx);
        setOpenPartDialogForLine(true);
        setPartOpenIndex(null);
      }
    }
  };

  const handlePtoPartKeyDown = (idx: number, event: React.KeyboardEvent) => {
    const inputValue = (quantityToOrderItems[idx]?.part_number || '').trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) { setPtoOpenIndex(null); return; }
    if (isArrow) {
      if (event.key === 'ArrowDown' && ptoOpenIndex !== idx) setPtoOpenIndex(idx);
      return;
    }
    if (ptoOpenIndex === idx && (isEnter || isTab)) { return; }
    if ((isEnter || isTab) && inputValue) {
      if (isEnter && (event as any).ctrlKey) {
        event.preventDefault();
        setPtoEnterPressedIndex(idx);
        setPtoPartNumberForModal(inputValue.toUpperCase());
        setPtoPartToAddIndex(idx);
        setOpenPartDialogForPTO(true);
        setPtoOpenIndex(null);
        return;
      }
      const match = inventoryItems.find((inv:any) => inv.part_number.toUpperCase() === inputValue.toUpperCase());
      if (!match && isEnter) {
        event.preventDefault();
        setPtoEnterPressedIndex(idx);
        setPtoPartNumberForModal(inputValue.toUpperCase());
        setPtoPartToAddIndex(idx);
        setOpenPartDialogForPTO(true);
        setPtoOpenIndex(null);
      }
    }
  };

  // Shared UI helpers
  const exactCustomerMatch = (q: string) => customers.find(c => normalize(c.label) === normalize(q)) || null;

  // Dialogs (shared)
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  // Import dialog (both modes)
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [allSalesOrders, setAllSalesOrders] = useState<any[]>([]);
  const [selectedImportSO, setSelectedImportSO] = useState<any | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Export/QBO (edit only)
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const [inventoryAlert, setInventoryAlert] = useState<string | null>(null);

  // ---------- Shared fetches ----------
  useEffect(() => {
    (async () => {
      try {
        const [custRes, prodRes, invRes, marginRes] = await Promise.all([
          api.get('/api/customers'),
          api.get('/api/products'),
          api.get('/api/inventory'),
          api.get('/api/margin-schedule'),
        ]);
        setCustomers(custRes.data.map((c: any) => ({ label: c.customer_name, id: c.customer_id })));
        setProducts(prodRes.data.map((p: any) => ({ label: p.product_name, id: p.product_id, description: p.product_description })));
        setInventoryItems(invRes.data);
        setMarginSchedule(marginRes.data);
        
        // For creation mode, mark as loaded after lists are fetched
        if (isCreationMode) {
          setIsDataFullyLoaded(true);
        }
      } catch (e) {
        console.error('Prefetch failed', e);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [lab, oh, sup] = await Promise.all([
          api.get('/api/settings/labour-rate').catch(() => ({ data: { labour_rate: null } })),
          api.get('/api/settings/overhead-rate').catch(() => ({ data: { overhead_rate: null } })),
          api.get('/api/settings/supply-rate').catch(() => ({ data: { supply_rate: null } })),
        ]);
        setGlobalLabourRate(lab.data.labour_rate ?? null);
        setGlobalOverheadRate(oh.data.overhead_rate ?? null);
        setGlobalSupplyRate(sup.data.supply_rate ?? null);
      } catch {}
    })();
  }, []);

  // ---------- Mode-specific fetch ----------
  useEffect(() => {
    // If no id yet or we are in creation mode or id is not numeric, do not fetch by id
    if (!id || isCreationMode || !isNumericId) {
      if (isCreationMode) {
        // Init one empty row in create mode
        setLineItems([{
          part_number: '',
          part_description: '',
          quantity: '',
          unit: UNIT_OPTIONS[0],
          unit_price: 0,
          gst: DEFAULT_GST_RATE,
          line_amount: 0,
        }]);
        setIsDataFullyLoaded(true); // Mark data as loaded for creation mode
      }
      return;
    }
    // EDIT MODE: load existing SO
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/api/sales-orders/${id}`);
        const data = res.data;
        setSalesOrder(data.salesOrder);
        
        const li = (data.lineItems || data.salesOrder?.line_items || []).map((item: any) => ({
          part_number: item.part_number,
          part_description: item.part_description,
          unit: item.unit,
          unit_price: item.unit_price,
          line_amount: Number(item.line_amount || 0), // Ensure line_amount is always a number
          // For LABOUR/OVERHEAD, use the quantity from backend (time entries)
          // For SUPPLY, use 1 as quantity
          // For other items, use quantity_sold or quantity
          quantity: item.part_number === 'SUPPLY' ? '1' : 
                   ['LABOUR', 'OVERHEAD'].includes(item.part_number) ? 
                   String(item.quantity_sold || 0) :  // Use quantity_sold for LABOUR/OVERHEAD (hours from time entries)
                   String(item.quantity_sold ?? item.quantity ?? 0),
          gst: DEFAULT_GST_RATE,
          part_id: item.part_id ?? undefined,
        })) as SalesOrderLineItem[];
        
        console.log('[SalesOrderDetail] Raw line items from backend:', data.lineItems);
        console.log('[SalesOrderDetail] Mapped line items:', li);
        
        setLineItems(li);
        setOriginalLineItems(li);
        
        // Load parts to order data
        const partsToOrder = (data.partsToOrder || []).map((item: any) => ({
          sales_order_id: parseInt(id),
          part_number: item.part_number,
          part_description: item.part_description,
          quantity_to_order: String(item.quantity_needed || 0),
          unit: item.unit || 'Each',
          unit_price: Number(item.unit_price || 0),
          line_amount: Number(item.line_amount || 0),
        })) as PartsToOrderItem[];
        setQuantityToOrderItems(partsToOrder);
        
        setSalesDate(dayjs(data.salesOrder?.sales_date));
        setEstimatedCost(data.salesOrder?.estimated_cost || 0);
        setProductDescription(data.salesOrder?.product_description || '');
        setTerms(data.salesOrder?.terms || '');
        setCustomerPoNumber(data.salesOrder?.customer_po_number || '');
        setVinNumber(data.salesOrder?.vin_number || '');
        
        // hydrate dropdown selections
        const cust = customers.find(c => c.id === data.salesOrder?.customer_id) ||
                     { label: data.salesOrder?.customer_name || '', id: data.salesOrder?.customer_id };
        setCustomer(cust?.id ? cust : null);
        
        const prod = products.find(p => p.label === data.salesOrder?.product_name) ||
                     { label: data.salesOrder?.product_name || '' };
        setProduct(prod?.label ? prod : null);
      } catch (err: any) {
        console.error(err);
        setError(err?.response?.status === 404
          ? 'Sales order not found. It may have been deleted.'
          : 'Failed to load sales order data. Please try again.');
      } finally {
        setLoading(false);
        setIsDataFullyLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isCreationMode, isNumericId]);

  // debouncedLineItems derives from lineItems directly

  // Auto-update LABOUR/OVERHEAD rates when global changes - REMOVED CALCULATIONS
  useEffect(() => {
    // Don't run rate updates until data is fully loaded from backend
    if (!isDataFullyLoaded) return;
    
    if (globalLabourRate !== null) {
      setLineItems(prev => prev.map(i => {
        if (i.part_number !== 'LABOUR') return i;
        // Only update unit_price if it's different - no calculations
        if (i.unit_price !== globalLabourRate) {
          return { ...i, unit_price: globalLabourRate };
        }
        return i;
      }));
    }
  }, [globalLabourRate, isDataFullyLoaded]);
  
  useEffect(() => {
    // Don't run rate updates until data is fully loaded from backend
    if (!isDataFullyLoaded) return;
    
    if (globalOverheadRate !== null) {
      setLineItems(prev => prev.map(i => {
        if (i.part_number !== 'OVERHEAD') return i;
        // Only update unit_price if it's different - no calculations
        if (i.unit_price !== globalOverheadRate) {
          return { ...i, unit_price: globalOverheadRate };
        }
        return i;
      }));
    }
  }, [globalOverheadRate, isDataFullyLoaded]);

  // SUPPLY line management (only when labour exists and supply rate > 0) - REMOVED CALCULATIONS
  useEffect(() => {
    // Don't run SUPPLY logic until data is fully loaded from backend
    if (!isDataFullyLoaded) return;
    
    setLineItems(prev => {
      const hasLabour = prev.some(i => i.part_number === 'LABOUR');
      const hasSupply = prev.some(i => i.part_number === 'SUPPLY');
      if (globalSupplyRate && globalSupplyRate > 0) {
        if (hasLabour && !hasSupply) {
          return [...prev, {
            part_number: 'SUPPLY',
            part_description: 'Supply',
            quantity: isCreationMode ? '' : '1',
            unit: isCreationMode ? '' : 'Each',
            unit_price: 0,
            gst: DEFAULT_GST_RATE,
            line_amount: 0, // Will be calculated by backend
          }];
        } else if (!hasLabour && hasSupply) {
          return prev.filter(i => i.part_number !== 'SUPPLY');
        }
      } else if (hasSupply) {
        return prev.filter(i => i.part_number !== 'SUPPLY');
      }
      return prev;
    });
  }, [globalSupplyRate, lineItems, isDataFullyLoaded, isCreationMode]);

  // SUPPLY amount calculation - REMOVED, backend handles this

  // ---------- Helpers ----------
  const findMarginFactor = (cost: number) => {
    const sorted = [...marginSchedule].sort((a, b) => a.cost_lower_bound - b.cost_lower_bound);
    for (const entry of sorted) {
      const lower = +entry.cost_lower_bound;
      const upper = entry.cost_upper_bound == null ? null : +entry.cost_upper_bound;
      const factor = +entry.margin_factor;
      if (cost >= lower && (upper === null || cost < upper)) return factor;
    }
    return 1.0;
  };

  const findInventoryPart = (partNumber: string) =>
    inventoryItems.find((p: any) => p.part_number === partNumber);

  const handlePartNumberChange = (idx: number, newValue: string | null) => {
    setLineItems(prev => {
      const updated = [...prev];
      if (!newValue || newValue.trim() === '') {
        updated[idx] = { ...updated[idx], part_number: '', part_description: '', quantity: '', unit: UNIT_OPTIONS[0], unit_price: 0, line_amount: 0 };
      } else if (newValue.toUpperCase() === 'LABOUR') {
        updated[idx] = { ...updated[idx], part_number: 'LABOUR', part_description: 'Labour', unit: 'hr', unit_price: globalLabourRate ?? 0, line_amount: 0 };
      } else if (newValue.toUpperCase() === 'OVERHEAD') {
        updated[idx] = { ...updated[idx], part_number: 'OVERHEAD', part_description: 'Overhead', unit: 'hr', unit_price: globalOverheadRate ?? 0, line_amount: 0 };
      } else if (newValue.toUpperCase() === 'SUPPLY') {
        updated[idx] = { ...updated[idx], part_number: 'SUPPLY', part_description: 'Supply', unit: isCreationMode ? '' : 'Each', unit_price: 0, line_amount: 0 };
      } else {
        const inv = findInventoryPart(newValue);
        if (inv) {
          const lastUnitCost = parseFloat(String(inv.last_unit_cost)) || 0;
          const marginFactor = findMarginFactor(lastUnitCost);
          updated[idx] = { ...updated[idx],
            part_number: newValue, part_description: inv.part_description || '',
            unit: inv.unit, unit_price: lastUnitCost * marginFactor, line_amount: 0
          };
        } else {
          updated[idx] = { ...updated[idx], part_number: newValue, part_description: 'Part not found', unit_price: 0, line_amount: 0 };
        }
      }
      return updated;
    });
  };

  const handleLineItemChange = (idx: number, field: keyof SalesOrderLineItem, value: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx], [field]: value };

      // auto-remove when qty <= 0 (except special rows)
      if (field === 'quantity' && parseFloat(value) <= 0 && it.part_number !== 'SUPPLY') {
        return updated.filter((_, i) => i !== idx);
      }

      // For LABOUR/OVERHEAD, only update unit_price if needed - no calculations
      if (['LABOUR', 'OVERHEAD'].includes(it.part_number)) {
        if (field === 'unit_price') {
          const globalRate = it.part_number === 'LABOUR' ? globalLabourRate : globalOverheadRate;
          if (globalRate !== null && it.unit_price !== globalRate) {
            it.unit_price = globalRate;
          }
        }
        // Keep existing line_amount - backend will recalculate on save
        updated[idx] = it;
        return updated;
      }

      // For other items, only update unit_price - no line_amount calculations
      if (field === 'unit_price') {
        it.unit_price = parseNumericInput(value);
      }
      // Keep existing line_amount - backend will recalculate on save
      updated[idx] = it;
      return updated;
    });
  };

  const handleAddLineItem = () => {
    setLineItems(prev => ([...prev, {
      part_number: '',
      part_description: '',
      quantity: '',
      unit: UNIT_OPTIONS[0],
      unit_price: 0,
      gst: DEFAULT_GST_RATE,
      line_amount: 0, // Will be calculated by backend
    }]));
  };

  const handleRemoveLineItem = (idx: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  };

  const calculateAvailableQuantity = (item: SalesOrderLineItem, idx: number) => {
    if (['LABOUR','OVERHEAD','SUPPLY'].includes(item.part_number)) return null;
    const inv = inventoryItems.find((x:any) => x.part_number.toLowerCase() === item.part_number.toLowerCase());
    if (!inv || inv.part_type === 'supply') return null;

    const onHand = parseFloat(inv.quantity_on_hand) || 0;
    
    if (isCreationMode) {
      // Calculate total quantity for this part across ALL line items (including this one)
      const totalQuantityForPart = lineItems
        .filter(li => li.part_number.toLowerCase() === item.part_number.toLowerCase())
        .reduce((sum, li) => sum + (parseFloat(String(li.quantity).replace(/[^\d.-]/g, '')) || 0), 0);
      
      const available = onHand - totalQuantityForPart;
      return { 
        available: available < 0 ? Math.floor(available) : Math.round(available), 
        isNegative: available < 0, 
        currentStock: onHand, 
        changeInQuantity: totalQuantityForPart,
        totalQuantityForPart,
        totalOriginalQuantityForPart: 0
      };
    }

    // Calculate total quantity for this part across ALL line items (including this one)
    const totalQuantityForPart = lineItems
      .filter(li => li.part_number.toLowerCase() === item.part_number.toLowerCase())
      .reduce((sum, li) => sum + (parseFloat(String(li.quantity).replace(/[^\d.-]/g, '')) || 0), 0);

    // Calculate total quantity from original line items for this part
    const totalOriginalQuantityForPart = originalLineItems
      .filter(li => li.part_number.toLowerCase() === item.part_number.toLowerCase())
      .reduce((sum, li) => sum + (parseFloat(String(li.quantity).replace(/[^\d.-]/g, '')) || 0), 0);

    // Calculate the delta: how much more/less we're using now vs originally
    const delta = totalQuantityForPart - totalOriginalQuantityForPart;
    const available = onHand - delta;
    const rounded = available < 0 ? Math.floor(available) : Math.round(available);
    
    return { 
      available: rounded, 
      isNegative: rounded < 0, 
      currentStock: onHand, 
      changeInQuantity: delta,
      totalQuantityForPart,
      totalOriginalQuantityForPart
    };
  };

  // Memoize availability per index for this render to avoid repeated recomputation
  const availabilityByIndex = useMemo(() => {
    return lineItems.map((item, idx) => calculateAvailableQuantity(item, idx));
  }, [lineItems, inventoryItems, originalLineItems, isCreationMode]);

  // Check negatives (edit mode banners)
  useEffect(() => {
    if (isCreationMode) return;
    const negatives: typeof negativeAvailabilityItems = [];
    lineItems.forEach((item, index) => {
      const a = calculateAvailableQuantity(item, index);
      if (a && a.available < 0) {
        negatives.push({ lineItemIndex: index, partNumber: item.part_number, partDescription: item.part_description, excessQuantity: Math.abs(a.available), unit: item.unit });
      }
    });
    setNegativeAvailabilityItems(negatives);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, inventoryItems, isCreationMode]);

  // ---------- Validation ----------
  const validateBeforeSave = () => {
    // VIN optional but must be 17 if present
    if (vinNumber && vinNumber.trim() !== '' && vinNumber.trim().length !== 17) {
      toast.error('VIN must be 17 characters');
      return false;
    }

    // disallow blank part numbers
    const blanks = lineItems.filter(i => !i.part_number || i.part_number.trim() === '');
    if (blanks.length > 0) {
      toast.error('Line items with blank part numbers are not allowed.');
      return false;
    }

    // Allow duplicate part numbers - they will be merged on save
    // allow 0 quantity items on save in open detail page; enforce on close instead

    // invalid/supply items
    const invalids = lineItems.filter(i => {
      // Allow special non-inventory items
      if (['LABOUR','OVERHEAD','SUPPLY'].includes(String(i.part_number).toUpperCase())) return false;

      const pid = (i as any).part_id as number | undefined;

      // If part_id present, prefer it. If not found in cache, do NOT block; server will verify.
      if (pid) {
        const invById = (inventoryItems || []).find((x:any) => x.part_id === pid);
        if (!invById) return false; // allow when cache is stale
        return invById.part_type === 'supply';
      }

      // Fall back to part_number lookup if no part_id
      const invByPn = (inventoryItems || []).find((x:any) => String(x.part_number).toUpperCase() === String(i.part_number).trim().toUpperCase());
      return !invByPn || invByPn.part_type === 'supply';
    });
    if (invalids.length > 0) {
      const msg = invalids.map(i => i.part_number).join(', ');
      toast.error(`Invalid or supply parts (not allowed): ${msg}`);
      return false;
    }

    // oversell check
    const oversell = lineItems.some((i, idx) => {
      const a = calculateAvailableQuantity(i, idx);
      return a && a.available < 0;
    });
    if (oversell) {
      setInventoryAlert('Insufficient inventory for one or more parts.');
      return false;
    }

    setInventoryAlert(null);
    return true;
  };

  // ---------- Save / Update ----------
  const buildPayloadLineItems = (items: SalesOrderLineItem[]) => {
    // Group by part number and merge quantities
    const grouped = items.reduce((acc, item) => {
      const partNumber = item.part_number.trim().toLowerCase();
      if (!acc[partNumber]) {
        // Try to resolve part_id from current inventory cache for non-special items
        const invMatch = ['LABOUR','OVERHEAD','SUPPLY'].includes(item.part_number.toUpperCase())
          ? null
          : (inventoryItems || []).find((x: any) => String(x.part_number).toUpperCase() === item.part_number.trim().toUpperCase());

        acc[partNumber] = {
          part_number: item.part_number.trim(),
          part_description: item.part_description.trim(),
          unit: item.unit.trim(),
          unit_price: item.unit_price != null ? Number(item.unit_price) : 0,
          line_amount: 0,
          quantity_sold: 0,
          // Include part_id for backend to use canonical identifier (prefer existing line item's part_id)
          ...(((item as any).part_id)
              ? { part_id: (item as any).part_id }
              : (invMatch && invMatch.part_id ? { part_id: invMatch.part_id } : {})),
        };
      }
      
      // Add quantities and line amounts
      if (item.part_number.toUpperCase() === 'SUPPLY') {
        // Always include SUPPLY with quantity 1 and use its computed line_amount from UI
        acc[partNumber].quantity_sold = 1;
        acc[partNumber].unit = 'Each';
        acc[partNumber].unit_price = 0;
        acc[partNumber].line_amount += Number(item.line_amount || 0);
      } else if (['LABOUR', 'OVERHEAD'].includes(item.part_number.toUpperCase())) {
        // For LABOUR/OVERHEAD, use the actual line_amount from UI and quantity from UI
        const quantity = parseFloat(String(item.quantity).replace(/[^\d.-]/g, '')) || 0;
        acc[partNumber].quantity_sold = quantity;
        acc[partNumber].line_amount = Number(item.line_amount || 0); // Use actual line_amount, don't sum
      } else {
        // Ensure quantity is a valid number, default to 0 if invalid
        const quantity = parseFloat(String(item.quantity).replace(/[^\d.-]/g, '')) || 0;
        acc[partNumber].quantity_sold += Math.round(quantity);
        acc[partNumber].line_amount += quantity * (item.unit_price || 0);
      }
      
      return acc;
    }, {} as Record<string, any>);
    
    // Convert back to array
    return Object.values(grouped);
  };

  const handleSave = async () => {
    if (!customer || !salesDate || !product) {
      toast.error('Please fill in required fields.');
      return;
    }
    if (!validateBeforeSave()) return;

    const payload = {
      customer_id: customer?.id,
      sales_date: salesDate ? salesDate.toISOString() : new Date().toISOString(),
      product_name: product?.label?.trim(),
      product_description: productDescription.trim(),
      terms: terms.trim(),
      customer_po_number: customerPoNumber.trim(),
      vin_number: vinNumber.trim(),
      status: isCreationMode ? 'Open' : (salesOrder?.status || 'Open'),
      estimated_cost: estimatedCost != null ? Number(estimatedCost) : 0,
      lineItems: buildPayloadLineItems(lineItems),
    };

    setIsSaving(true);
    try {
      if (isCreationMode) {
        if ((window as any).__soCreateInFlight) {
          console.log('[SO] Skipping duplicate create (in flight)');
          return;
        }
        (window as any).__soCreateInFlight = true;
        const res = await api.post('/api/sales-orders', payload);
        toast.success('Sales Order created successfully!');
        (window as any).__unsavedGuardAllowNext = true;
        navigate(`/open-sales-orders/${res.data.sales_order_id}`);
      } else {
        // Include Parts to Order only on edit mode
        const partsToOrder = quantityToOrderItems
          .filter(it => it.part_number && parseFloat(String(it.quantity_to_order)) > 0)
          .map(it => ({
            sales_order_id: Number(id),
            part_number: it.part_number.trim(),
            part_description: it.part_description.trim(),
            quantity_needed: parseFloat(String(it.quantity_to_order)) || 0,
            unit: it.unit.trim(),
            unit_price: it.unit_price,
            line_amount: it.line_amount,
          }));
        await api.put(`/api/sales-orders/${id}`, { ...payload, partsToOrder });
        setSuccess('Sales Order updated successfully!');
        // Allow immediate navigation after save with a small delay to ensure state updates
        setTimeout(() => {
          (window as any).__unsavedGuardAllowNext = true;
        }, 100);
        setInitialSignature(JSON.stringify({
          header: { customer, product, salesDate, terms, customerPoNumber, vinNumber, estimatedCost },
          lineItems,
          quantityToOrderItems,
        }));
        // Refresh SO and inventory so availability deltas use latest baseline
        try {
          const [soRes, inv] = await Promise.all([
            api.get(`/api/sales-orders/${id}`),
            api.get('/api/inventory')
          ]);
          const data = soRes.data;
          

          
          const li = (data.lineItems || data.salesOrder?.line_items || []).map((item: any) => ({
            part_number: item.part_number,
            part_description: item.part_description,
            unit: item.unit,
            unit_price: item.unit_price,
            line_amount: Number(item.line_amount || 0), // Ensure line_amount is always a number
            quantity: item.part_number === 'SUPPLY' ? '1' : 
                     ['LABOUR', 'OVERHEAD'].includes(item.part_number) ? 
                     String(item.quantity_sold || 0) :  // Use quantity_sold for LABOUR/OVERHEAD (hours from time entries)
                     String(item.quantity_sold ?? item.quantity ?? 0),
            gst: DEFAULT_GST_RATE,
            part_id: item.part_id ?? undefined,
          })) as SalesOrderLineItem[];
          setLineItems(li);
          setOriginalLineItems(li);
          setInventoryItems(inv.data);
        } catch {}
      }
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.details || err?.response?.data?.message || 'Failed to save sales order.';
      setInventoryAlert(message);
    } finally {
      setIsSaving(false);
      (window as any).__soCreateInFlight = false;
    }
  };

  // ---------- Close / Reopen / PDF / QBO (edit only) ----------
  const handleCloseSO = async () => {
    if (isCreationMode || !salesOrder) return;
    // Disallow close if any non-special line has 0 quantity
    const zeros = lineItems.filter(i => !['LABOUR','OVERHEAD','SUPPLY'].includes(i.part_number) && (parseFloat(String(i.quantity).replace(/[^\d.-]/g, '')) || 0) === 0);
    if (zeros.length > 0) {
      toast.error(`Cannot close: line items with 0 quantity: ${zeros.map(i => i.part_number).join(', ')}`);
      return;
    }
    if (quantityToOrderItems.some(i => parseFloat(String(i.quantity_to_order)) > 0)) {
      const parts = quantityToOrderItems.filter(i => parseFloat(String(i.quantity_to_order)) > 0)
        .map(i => `${i.part_number} (${i.quantity_to_order})`).join(', ');
      toast.error(`Cannot close: parts still need to be ordered: ${parts}`);
      return;
    }
    try {
      await api.put(`/api/sales-orders/${salesOrder.sales_order_id}`, {
        customer_id: salesOrder.customer_id,
        sales_date: salesOrder.sales_date,
        product_name: product?.label?.trim() || salesOrder.product_name,
        product_description: productDescription.trim(),
        terms: terms.trim(),
        status: 'Closed',
        estimated_cost: estimatedCost ?? salesOrder.estimated_cost,
        lineItems: buildPayloadLineItems(lineItems),
      });
      toast.success('Sales Order closed successfully!');
      setSalesOrder(prev => prev ? { ...prev, status: 'Closed' } : prev);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.details || err?.response?.data?.message || 'Failed to close sales order.';
      setInventoryAlert(message);
    }
  };

  const handleReopenSO = async () => {
    if (isCreationMode || !salesOrder) return;
    try {
      await api.put(`/api/sales-orders/${salesOrder.sales_order_id}`, {
        customer_id: salesOrder.customer_id,
        sales_date: salesOrder.sales_date,
        product_name: product?.label?.trim() || salesOrder.product_name,
        product_description: productDescription.trim(),
        terms: terms.trim(),
        status: 'Open',
        estimated_cost: estimatedCost ?? salesOrder.estimated_cost,
        lineItems: buildPayloadLineItems(lineItems),
      });
      toast.success('Sales Order reopened successfully!');
      setSalesOrder(prev => prev ? { ...prev, status: 'Open' } : prev);
      navigate(`/open-sales-orders/${salesOrder.sales_order_id}`);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.details || err?.response?.data?.message || 'Failed to reopen sales order.';
      setInventoryAlert(message);
    }
  };

  const handleDownloadPDF = async () => {
    if (isCreationMode) {
      const ok = await (async () => { await handleSave(); return true; })();
      if (!ok) return;
      return; // navigation will move to edit page where they can download
    }
    if (!salesOrder) return;
    try {
      // Save first if open
      if (salesOrder.status?.toLowerCase() !== 'closed') await handleSave();
      const res = await api.get(`/api/sales-orders/${salesOrder.sales_order_id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `sales_order_${salesOrder.sales_order_number}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(salesOrder.status?.toLowerCase() === 'closed' ? 'PDF downloaded.' : 'Saved and downloaded PDF.');
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.details || err?.response?.data?.message || 'Failed to save or download PDF.';
      setInventoryAlert(message);
    }
  };

  const handleExportToQBO = async () => {
    if (isCreationMode || !salesOrder) return;
    if (quantityToOrderItems.some(i => parseFloat(String(i.quantity_to_order)) > 0)) {
      const parts = quantityToOrderItems.filter(i => parseFloat(String(i.quantity_to_order)) > 0)
        .map(i => `${i.part_number} (${i.quantity_to_order})`).join(', ');
      toast.error(`Cannot export to QuickBooks: parts to order exist: ${parts}`);
      return;
    }
    setExportLoading(true); setExportError(null); setExportSuccess(null);
    try {
      const res = await api.post(`/api/sales-orders/${salesOrder.sales_order_id}/export-to-qbo`);
      setExportSuccess('Sales Order exported to QuickBooks successfully!');
      setSalesOrder(prev => prev ? { ...prev, exported_to_qbo: true, qbo_invoice_id: res.data.qbo_invoice_id, qbo_export_date: new Date().toISOString(), qbo_export_status: 'Success' } : prev);
      toast.success('Exported to QuickBooks.');
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === 'CUSTOMER_NOT_FOUND') {
        const shouldCreate = window.confirm(
          `Customer '${data.customerName}' does not exist in QuickBooks.\nCreate it and export the Sales Order?`
        );
        if (shouldCreate) {
          try {
            const r = await api.post(`/api/sales-orders/${salesOrder.sales_order_id}/export-to-qbo-with-customer`, { customerData: data.customerData });
            toast.success('Customer created and Sales Order exported.');
            setExportSuccess('Customer created and Sales Order exported.');
            setSalesOrder(prev => prev ? { ...prev, exported_to_qbo: true, qbo_invoice_id: r.data.qbo_invoice_id, qbo_export_date: new Date().toISOString(), qbo_export_status: 'Success' } : prev);
          } catch (e: any) {
            const m = e?.response?.data?.error || 'Failed to create customer and export to QuickBooks.';
            setExportError(m); toast.error(m);
          }
        } else {
          setExportError('Export cancelled. Customer must exist in QuickBooks.');
        }
      } else {
        const m = data?.error || data?.message || 'Failed to export to QuickBooks.';
        setExportError(m); toast.error(m);
      }
    } finally {
      setExportLoading(false);
    }
  };

  // ---------- Import ----------
  const fetchAllSalesOrders = async () => {
    setImportLoading(true);
    try { const res = await api.get('/api/sales-orders'); setAllSalesOrders(res.data); }
    catch { toast.error('Failed to fetch sales orders for import'); }
    finally { setImportLoading(false); }
  };
  const handleOpenImportDialog = () => { setImportDialogOpen(true); fetchAllSalesOrders(); };
  const handleImportLineItems = async () => {
    if (!selectedImportSO) return;
    setImportLoading(true);
    try {
      const res = await api.get(`/api/sales-orders/${selectedImportSO.sales_order_id}`);
      const from = res.data.lineItems || res.data.salesOrder?.line_items || [];
      const filtered = from.filter((it: any) => (it.part_number || '').toUpperCase() !== 'LABOUR');
      const mapped = filtered.map((it: any) => ({
        part_number: it.part_number,
        part_description: it.part_description,
        quantity: String(isCreationMode ? it.quantity : (it.quantity_sold ?? it.quantity ?? 0)),
        unit: it.unit,
        unit_price: it.unit_price,
        gst: DEFAULT_GST_RATE,
        line_amount: it.line_amount,
        part_id: it.part_id ?? undefined,
      })) as SalesOrderLineItem[];
      setLineItems(mapped);
      setImportDialogOpen(false);
      setSelectedImportSO(null);
      toast.success('Line items imported!');
    } catch {
      toast.error('Failed to import line items');
    } finally { setImportLoading(false); }
  };

  // ---------- Customer/Product keydowns ----------
  const handleCustomerKeyDown = (e: React.KeyboardEvent) => {
    const inputValue = customerInput.trim();
    const isEnter = e.key === 'Enter', isTab = e.key === 'Tab', isEsc = e.key === 'Escape';
    if (isEsc) { setCustomerOpen(false); return; }
    if (isEnter || isTab) {
      if (isEnter && (e as any).ctrlKey && inputValue) {
        e.preventDefault(); setCustomerEnterPressed(true); setNewCustomerName(inputValue); setIsAddCustomerModalOpen(true); return;
      }
      if (customerOpen) return; // let Autocomplete handle highlighted selection
      if (!inputValue) return;
      e.preventDefault();
      const match = exactCustomerMatch(inputValue);
      if (match) { setCustomer(match); setCustomerInput(match.label); }
      else { setCustomerEnterPressed(true); setNewCustomerName(inputValue); setIsAddCustomerModalOpen(true); }
    }
  };
  const handleProductKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputValue = productInput.trim();
    if (!inputValue) return;
    const exact = products.find(p => p.label.toLowerCase() === inputValue.toLowerCase());
    if (exact) { setProduct(exact); setProductInput(exact.label); }
    else { setNewProductName(inputValue); setIsAddProductModalOpen(true); }
  };

  // ---------- Closed read-only ----------
  const renderReadOnly = () => {
    if (!salesOrder) return null;
    const all = lineItems || [];
    let sub = all.reduce((s, i) => s + (Number(i.line_amount) || 0), 0);
    let gst = sub * 0.05, tot = sub + gst;
    if (isNaN(sub)) sub = 0; if (isNaN(gst)) gst = 0; if (isNaN(tot)) tot = 0;
    return (
      <Box p={{ xs:2, md:4 }} maxWidth={1000} mx="auto">
        {exportSuccess && <Alert severity="success" sx={{ mb:2 }} onClose={() => setExportSuccess(null)}>{exportSuccess}</Alert>}
        {exportError && <Alert severity="error" sx={{ mb:2 }} onClose={() => setExportError(null)}>{exportError}</Alert>}
        <Typography variant="h4" gutterBottom>Sales Order Details</Typography>
        <Card variant="outlined" sx={{ mb:3 }}>
          <CardContent>
            <Grid container spacing={{ xs:2, md:3 }}>
              <Grid item xs={12} sm={6}><b>Sales Order #:</b> {salesOrder.sales_order_number}</Grid>
              <Grid item xs={12} sm={6}><b>Customer:</b> {salesOrder.customer_name || 'N/A'}</Grid>
              <Grid item xs={12} sm={6}><b>Sales Date:</b> {salesOrder.sales_date ? new Date(salesOrder.sales_date).toLocaleDateString() : ''}</Grid>
              <Grid item xs={12} sm={6}><b>Status:</b> {salesOrder.status?.toUpperCase() || 'N/A'}</Grid>
              <Grid item xs={12}><b>Estimated Price:</b> {formatCurrency(salesOrder.estimated_cost || 0)}</Grid>
              <Grid item xs={12}><b>Product Description:</b> {salesOrder.product_description || 'N/A'}</Grid>
              <Grid item xs={12}><b>Terms:</b> {salesOrder.terms || 'N/A'}</Grid>
              {salesOrder.exported_to_qbo && (
                <Grid item xs={12}><b>QBO Export:</b> Exported
                  {salesOrder.qbo_invoice_id && ` (Invoice ID: ${salesOrder.qbo_invoice_id})`}
                  {salesOrder.qbo_export_date && ` on ${new Date(salesOrder.qbo_export_date).toLocaleDateString()}`}
                </Grid>
              )}
            </Grid>
          </CardContent>
        </Card>

        <Typography variant="h5" gutterBottom>Items</Typography>
        <Card variant="outlined">
          <CardContent>
            {all.map((it, idx) => (
              <Grid container spacing={2} key={idx}>
                <Grid item xs={6} sm={3} md={2}>{it.part_number}</Grid>
                <Grid item xs={6} sm={5} md={4}>{it.part_description}</Grid>
                <Grid item xs={4} sm={2} md={1.5}>{it.quantity}</Grid>
                <Grid item xs={4} sm={2} md={1.5}>{it.unit}</Grid>
                <Grid item xs={4} sm={2} md={1.5}>{formatCurrency(it.unit_price)}</Grid>
                <Grid item xs={4} sm={2} md={1}>{formatCurrency(it.line_amount)}</Grid>
              </Grid>
            ))}
          </CardContent>
        </Card>

        <Box mt={4} display="flex" flexDirection="column" alignItems="flex-end">
          <Typography variant="h6">Subtotal: {formatCurrency(sub)}</Typography>
          <Typography variant="h6">Total GST: {formatCurrency(gst)}</Typography>
          <Typography variant="h6">Total Amount: {formatCurrency(tot)}</Typography>
        </Box>

        <Box mt={4} display="flex" justifyContent={{ xs:'center', sm:'flex-end' }} gap={2}>
          <Button variant="contained" color="primary" startIcon={<DownloadIcon />} onClick={handleDownloadPDF}>Download PDF</Button>
          {!salesOrder.exported_to_qbo && (
            <Button variant="contained" color="success" startIcon={<CloudUploadIcon />} disabled={exportLoading} onClick={handleExportToQBO}>
              {exportLoading ? 'Exporting...' : 'Export to QuickBooks'}
            </Button>
          )}
          {user?.access_role !== 'Sales and Purchase' && (
            <Button variant="contained" color="primary" onClick={handleReopenSO}>Reopen SO</Button>
          )}
        </Box>
      </Box>
    );
  };

  // ---------- Loading / Error ----------
  if (!isCreationMode && loading) {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography>Loading sales order...</Typography>
      </Container>
    );
  }
  if (!isCreationMode && error) {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="contained" onClick={() => window.location.reload()} sx={{ mr: 2 }}>Retry</Button>
        <Button variant="outlined" onClick={() => navigate('/open-sales-orders')}>Back to Sales Orders</Button>
      </Container>
    );
  }
  // Prevent Sales and Purchase users from accessing closed sales orders
  if (!isCreationMode && isClosed && user?.access_role === 'Sales and Purchase') {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Access Denied: Sales and Purchase users cannot view closed sales orders.
        </Alert>
        <Button variant="outlined" onClick={() => navigate('/open-sales-orders')}>Back to Sales Orders</Button>
      </Container>
    );
  }
  
  if (!isCreationMode && isClosed) return renderReadOnly();

  // ---------- Main form (Create + Edit Open) ----------
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <UnsavedChangesGuard when={isDirty} onSave={handleSave} />
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:3 }}>
          <Typography variant="h4" component="h1">
            {isCreationMode ? 'Create Sales Order' : `Edit Sales Order${salesOrder?.sales_order_number ? `: ${salesOrder.sales_order_number}` : ''}`}
          </Typography>
          <Stack direction="row" spacing={1}>
            {isCreationMode && <Button variant="outlined" onClick={() => {
              // reset to pristine
              setCustomer(null); setCustomerInput(''); setSalesDate(dayjs());
              setProduct(null); setProductInput(''); setProductDescription('');
              setTerms(''); setCustomerPoNumber(''); setVinNumber('');
              setEstimatedCost(null);
              setLineItems([{
                part_number: '', part_description: '', quantity: '',
                unit: UNIT_OPTIONS[0], unit_price: 0, gst: DEFAULT_GST_RATE, line_amount: 0
              }]);
              setInventoryAlert(null);
            }}>Reset</Button>}
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
              {isCreationMode ? 'Save Sales Order' : 'Save Changes'}
            </Button>
            {!isCreationMode && (
              <>
                {user?.access_role !== 'Sales and Purchase' && (
                  <Button variant="contained" startIcon={<DoneAllIcon />} onClick={handleCloseSO}>Close SO</Button>
                )}
                <Button variant="contained" startIcon={<DownloadIcon />} onClick={handleDownloadPDF}>Download PDF</Button>
              </>
            )}
          </Stack>
        </Box>

        {/* Import Line Items */}
        <Box sx={{ mb: 2 }}>
          <Button variant="outlined" color="secondary" onClick={handleOpenImportDialog}>Import Line Items</Button>
        </Box>
        <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Import Line Items from Sales Order</DialogTitle>
          <DialogContent>
            {importLoading ? (
              <Box display="flex" alignItems="center" justifyContent="center" minHeight={120}><CircularProgress /></Box>
            ) : (
              <Autocomplete
                options={allSalesOrders}
                getOptionLabel={(so:any) => {
                  if (!so) return '';
                  const num = so.sales_order_number || '';
                  const cust = so.customer_name || '';
                  const st = so.status || '';
                  return `${num} - ${cust}${st ? ` (${st})` : ''}`;
                }}
                value={selectedImportSO}
                onChange={(_, val) => setSelectedImportSO(val)}
                renderInput={params => <TextField {...params} label="Select Sales Order" fullWidth />}
                isOptionEqualToValue={(o:any, v:any) => o.sales_order_id === v?.sales_order_id}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleImportLineItems} disabled={!selectedImportSO || importLoading} variant="contained">Import</Button>
          </DialogActions>
        </Dialog>

        {inventoryAlert && (
          <Alert severity="warning" sx={{ mb: 3 }} onClose={() => setInventoryAlert(null)}>
            <Typography variant="body1" sx={{ fontWeight: 'medium' }}>Inventory Error</Typography>
            <Typography variant="body2">{inventoryAlert}</Typography>
          </Alert>
        )}

        {/* Top form card - shift up when alerts are visible */}
        <Paper sx={{ p: 3, mb: 3, transform: activeAlertOffset ? `translateY(-${activeAlertOffset}px)` : 'none', transition:'transform 200ms ease' }} elevation={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={4}>
              <Autocomplete<CustomerOption, false, false, true>
                open={customerOpen}
                onOpen={() => setCustomerOpen(true)}
                onClose={() => setCustomerOpen(false)}
                autoHighlight
                value={customer}
                onChange={(_, newValue) => {
                  if (customerEnterPressed) { setCustomerEnterPressed(false); return; }
                  if (newValue && (newValue as any).isNew) {
                    setIsAddCustomerModalOpen(true);
                    setNewCustomerName(customerInput);
                    setCustomer(null);
                    setCustomerInput('');
                    setCustomerOpen(false);
                  } else {
                    setCustomer(newValue as CustomerOption);
                    setCustomerOpen(false);
                  }
                }}
                inputValue={customerInput}
                onInputChange={(_, v, reason) => {
                  setCustomerInput(v);
                  if (customerTypingTimer) window.clearTimeout(customerTypingTimer);
                  if (reason === 'reset') return;
                  const text = (v || '').trim();
                  if (text.length > 0) {
                    const t = window.setTimeout(() => setCustomerOpen(true), 200);
                    setCustomerTypingTimer(t as unknown as number);
                  } else {
                    setCustomerOpen(false);
                  }
                }}
                options={customers}
                filterOptions={(options, params) => {
                  const ranked = rankAndFilter(options, params.inputValue || '');
                  const hasExact = !!exactCustomerMatch(params.inputValue || '');
                  const out:any[] = [...ranked];
                  if ((params.inputValue || '').trim() !== '' && !hasExact) {
                    out.push({ label: `Add "${params.inputValue}" as New Customer`, isNew: true } as any);
                  }
                  return out;
                }}
                getOptionLabel={o => typeof o === 'string' ? o : o.label}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                renderOption={(props, option) => {
                  const isNew = (option as any).isNew;
                  const { key, ...other } = props;
                  return (
                    <li key={key} {...other} style={{ display:'flex', alignItems:'center', opacity: isNew ? 0.9 : 1 }}>
                      {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight:8, color:'#666' }} />}
                      <span>{(option as any).label}</span>
                    </li>
                  );
                }}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Customer"
                    required
                    onKeyDown={handleCustomerKeyDown}
                    onBlur={() => {
                      if (!customer) {
                        const input = customerInput.trim();
                        if (input) {
                          const match = exactCustomerMatch(input);
                          if (match) { setCustomer(match); setCustomerInput(match.label); }
                        }
                      }
                    }}
                    inputRef={el => { customerInputRef.current = el; }}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Customer PO #" value={customerPoNumber} onChange={e => setCustomerPoNumber(e.target.value)} fullWidth placeholder="Optional" />
            </Grid>
              {!isSalesPurchaseUser && (
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Quoted Price"
                    type="number"
                    value={estimatedCost ?? ''}
                    onChange={e => setEstimatedCost(e.target.value ? parseFloat(e.target.value) : null)}
                    fullWidth
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    inputProps={{ onWheel: (e) => (e.currentTarget as HTMLInputElement).blur() }}
                  />
                </Grid>
              )}

            <Grid item xs={12} sm={4}>
              <Autocomplete<ProductOption>
                disablePortal
                open={productOpen}
                onOpen={() => setProductOpen(true)}
                onClose={() => setProductOpen(false)}
                autoHighlight
                value={product}
                onChange={(_, newValue) => {
                  if (newValue && (newValue as any).isNew) {
                    const typed = (newValue as any).inputValue?.toString?.() || productInput.trim();
                    setIsAddProductModalOpen(true); setNewProductName(typed);
                    setProduct(null); setProductInput(''); setProductOpen(false);
                  } else {
                    setProduct(newValue as ProductOption); setProductOpen(false);
                  }
                }}
                inputValue={productInput}
                onInputChange={(_, v, reason) => {
                  setProductInput(v); setNewProductName(v);
                  if (productTypingTimer) window.clearTimeout(productTypingTimer);
                  if (reason === 'reset') return;
                  const text = (v || '').trim();
                  if (text.length > 0) {
                    const t = window.setTimeout(() => setProductOpen(true), 200);
                    setProductTypingTimer(t as unknown as number);
                  } else {
                    setProductOpen(false);
                  }
                }}
                options={products}
                filterOptions={(options, params) => {
                  const filtered = options.filter(o => o.label.toLowerCase().includes((params.inputValue||'').toLowerCase()));
                  if ((params.inputValue||'') !== '' && !options.some(o => o.label.toLowerCase() === (params.inputValue||'').toLowerCase())) {
                    filtered.push({ label: `Add "${params.inputValue}"`, isNew: true, inputValue: params.inputValue } as any);
                  }
                  return filtered;
                }}
                getOptionLabel={o => typeof o === 'string' ? o : o.label}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Product Name"
                    required
                    onKeyDown={handleProductKeyDown}
                    onBlur={() => {
                      setProductOpen(false);
                      if (!product) {
                        const input = productInput.trim();
                        if (input) {
                          const match = products.find(p => p.label.toLowerCase() === input.toLowerCase());
                          if (match) { setProduct(match); setProductInput(match.label); }
                        }
                      }
                    }}
                  />
                )}
                disabled={false}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="VIN #"
                value={vinNumber}
                onChange={e => setVinNumber(e.target.value)}
                fullWidth
                placeholder="Optional"
                error={!!(vinNumber && vinNumber.trim() !== '' && vinNumber.trim().length !== 17)}
                helperText={(vinNumber && vinNumber.trim() !== '' && vinNumber.trim().length !== 17) ? 'VIN must be 17 characters' : ''}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <DatePicker
                label="Sales Date"
                value={salesDate}
                onChange={setSalesDate}
                sx={{ width:'100%' }}
                slotProps={{ textField: { required: true } }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Product Description" value={productDescription} onChange={e => setProductDescription(e.target.value)} fullWidth multiline minRows={2} maxRows={6} sx={{ mt:1 }} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Terms" value={terms} onChange={e => setTerms(e.target.value)} fullWidth multiline minRows={3} maxRows={8} sx={{ mt:1 }} placeholder="Enter payment/delivery terms, etc." />
            </Grid>
          </Grid>
        </Paper>

        <Box sx={{ position:'relative', zIndex: 1000, transform: activeAlertOffset ? `translateY(-${activeAlertOffset}px)` : 'none', transition: 'transform 200ms ease' }}>
          <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Line Items</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each part number can only appear once. Edit existing line items to change quantities.
          </Typography>
        </Box>
        {/* Negative availability banners (edit mode) - render just above the line item box without shifting layout */}
        <Box sx={{ position:'relative', mb:3 }}>
        {!isCreationMode && negativeAvailabilityItems.length > 0 && (
          <Box sx={{ position:'absolute', bottom: 'calc(100% + 8px)', left:0, right:0, zIndex:500, display:'flex', flexDirection:'column', gap:1, pointerEvents:'none' }}>
            {negativeAvailabilityItems.map((item, i) => (
              <Alert key={`${item.lineItemIndex}-${i}`} severity="warning" sx={{ width: '100%', boxShadow:2, pointerEvents:'auto', '& .MuiAlert-message': { width: '100%', padding: 0 } }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">Insufficient stock for {item.partNumber}</Typography>
                    <Typography variant="body2" color="text.secondary">Excess quantity: {item.excessQuantity} {item.unit}</Typography>
                  </Box>
                  <Button
                    variant="contained" size="small" sx={{ whiteSpace:'nowrap' }}
                    onClick={() => setTransferDialogItem(item)}
                  >
                    Transfer {item.excessQuantity} to Parts to Order
                  </Button>
                </Box>
              </Alert>
            ))}
          </Box>
        )}

        <Dialog open={!!transferDialogItem} onClose={() => setTransferDialogItem(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Transfer to Parts to Order</DialogTitle>
          <DialogContent>
            {transferDialogItem && (
              <Typography variant="body2">
                Transfer {transferDialogItem.excessQuantity} {transferDialogItem.unit} of {transferDialogItem.partNumber} to Parts to Order?
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTransferDialogItem(null)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => {
                if (!transferDialogItem) return;
                const item = transferDialogItem;
                const li = lineItems[item.lineItemIndex];
                const excess = item.excessQuantity;
                const inv = inventoryItems.find((x:any) => x.part_number.toLowerCase() === li.part_number.toLowerCase());
                const newItem: PartsToOrderItem = {
                  sales_order_id: salesOrder?.sales_order_id || 0,
                  part_number: li.part_number,
                  part_description: li.part_description,
                  quantity_to_order: String(excess),
                  unit: li.unit,
                  unit_price: inv?.last_unit_cost || 0,
                  line_amount: (inv?.last_unit_cost || 0) * excess
                };
                setQuantityToOrderItems(prev => [...prev, newItem]);
                const newQty = Math.max(0, (parseFloat(String(li.quantity).replace(/[^\d.-]/g, '')) || 0) - excess);
                setLineItems(prev => prev.map((x, idx) => idx === item.lineItemIndex ? { ...x, quantity: String(newQty) } : x));
                setNegativeAvailabilityItems(prev => prev.filter(n => n.lineItemIndex !== item.lineItemIndex));
                setTransferDialogItem(null);
                toast.success(`Transferred ${excess} ${li.unit} of ${li.part_number} to parts to order`);
              }}
            >
              Confirm
            </Button>
          </DialogActions>
        </Dialog>
        <Paper sx={{ p:3, mb:3 }} elevation={3}>
          <Grid container spacing={2}>
            {lineItems
              .map((item, originalIndex) => ({ item, originalIndex }))
              .sort((a,b) => {
                const aS = ['LABOUR','OVERHEAD','SUPPLY'].includes(a.item.part_number);
                const bS = ['LABOUR','OVERHEAD','SUPPLY'].includes(b.item.part_number);
                if (aS && !bS) return 1;
                if (!aS && bS) return -1;
                return 0;
              })
              .map(({ item, originalIndex }) => (
              <React.Fragment key={originalIndex}>
                <Grid item xs={12} sm={6} md={2.5}>
                  <Autocomplete<PartOption, false, false, true>
                    open={partOpenIndex === originalIndex}
                    onOpen={() => setPartOpenIndex(originalIndex)}
                    onClose={() => setPartOpenIndex(null)}
                    autoHighlight
                    inputValue={item.part_number}
                    onChange={(_, newValue) => {
                      if (typeof newValue === 'string') {
                        // Check if this part number already exists in another line item
                        const existingIndex = lineItems.findIndex((item, idx) => 
                          idx !== originalIndex && 
                          item.part_number.trim().toLowerCase() === newValue.trim().toLowerCase()
                        );
                        
                        if (existingIndex !== -1) {
                          toast.error(`Part "${newValue}" already exists as line item ${existingIndex + 1}. Edit that line item instead.`);
                          // Clear the part number field immediately
                          setLineItems(prev => prev.map((item, idx) => 
                            idx === originalIndex ? { ...item, part_number: '', part_description: '' } : item
                          ));
                          setPartOpenIndex(null);
                          return;
                        }
                        
                        handlePartNumberChange(originalIndex, newValue);
                        setPartOpenIndex(null);
                      } else if (newValue && typeof newValue === 'object' && 'isNew' in newValue) {
                        const inputValue = (newValue as any).inputValue || '';
                        setLinePartNumberForModal(String(inputValue).toUpperCase());
                        setLinePartToAddIndex(originalIndex);
                        setOpenPartDialogForLine(true);
                        setPartOpenIndex(null);
                      }
                    }}
                    onInputChange={(_, v, reason) => {
                      // Update the line item's part_number as user types
                      if (reason === 'reset') return;
                      const text = (v || '').trim();
                      
                      // Update the line item state immediately
                      setLineItems(prev => prev.map((item, idx) => 
                        idx === originalIndex ? { ...item, part_number: text } : item
                      ));
                      
                      // Control dropdown visibility with debouncing
                      if (partTypingTimer) window.clearTimeout(partTypingTimer);
                      if (text.length > 0) {
                        const t = window.setTimeout(() => setPartOpenIndex(originalIndex), 200);
                        setPartTypingTimer(t as unknown as number);
                      } else {
                        setPartOpenIndex(null);
                      }
                    }}
                    options={inventoryItems.filter((inv:any) => inv.part_type !== 'supply').map((inv:any) => inv.part_number)}
                    freeSolo selectOnFocus clearOnBlur handleHomeEndKeys
                    filterOptions={(options, params) => {
                      const text = (params.inputValue || '').toUpperCase();
                      // Filter by both part number and description
                      const filtered = (options as string[]).filter(partNumber => {
                        const inv = inventoryItems.find(inv => inv.part_number === partNumber);
                        if (!inv) return String(partNumber).toUpperCase().includes(text);
                        return String(partNumber).toUpperCase().includes(text) || 
                               String(inv.part_description || '').toUpperCase().includes(text);
                      });
                      const hasExact = filtered.some(o => String(o).toUpperCase() === text);
                      const out: PartOption[] = [...filtered] as any;
                      if (text && !hasExact) {
                        out.push({ label: `Add "${params.inputValue}" as New Part`, isNew: true, inputValue: params.inputValue } as any);
                      }
                      return out as any;
                    }}
                    renderOption={(props, option) => {
                      const isNew = typeof option === 'object' && (option as any).isNew;
                      const label = typeof option === 'string' ? option : (option as any).label;
                      const { key, ...otherProps } = props;
                      return (
                        <li key={key} {...otherProps}>
                          {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                          {typeof option === 'string' ? (
                            <Box>
                              <Typography variant="body2">{option}</Typography>
                              {(() => {
                                const inv = inventoryItems.find(inv => inv.part_number === option);
                                return inv?.part_description ? (
                                  <Typography variant="caption" color="text.secondary">
                                    {inv.part_description}
                                  </Typography>
                                ) : null;
                              })()}
                            </Box>
                          ) : (
                            label
                          )}
                        </li>
                      );
                    }}
                    renderInput={params => (
                      <TextField {...params} label="Part Number" required fullWidth onKeyDown={(e) => handleLinePartKeyDown(originalIndex, e)} onBlur={() => setPartOpenIndex(null)} />
                    )}
                    onBlur={() => {
                      // Get the current input value from the lineItems state
                      const inputValue = lineItems[originalIndex]?.part_number?.trim().toUpperCase();
                      if (!inputValue) return;
                      const inv = inventoryItems.find((x:any) => x.part_number === inputValue);
                      if (!inv) {
                        setLinePartToAddIndex(originalIndex);
                        setLinePartNumberForModal(inputValue);
                        setOpenPartDialogForLine(true);
                        setPartOpenIndex(null);
                      } else {
                        // Part exists, populate the description and other fields
                        handlePartNumberChange(originalIndex, inputValue);
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={2.5}>
                  <TextField label="Part Description" value={item.part_description} fullWidth required InputProps={{ readOnly: true }} sx={{ backgroundColor:'#ffffff' }} />
                </Grid>
                <Grid item xs={6} sm={3} md={1}>
                  <TextField
                    label="Qty"
                    value={item.quantity}
                    onChange={(e) => handleLineItemChange(originalIndex, 'quantity', e.target.value)}
                    type="number" fullWidth required
                    InputProps={{ readOnly: ['SUPPLY','LABOUR','OVERHEAD'].includes(item.part_number), disabled: ['SUPPLY','LABOUR','OVERHEAD'].includes(item.part_number) }}
                    inputProps={{ step:1, onWheel: (e:any) => e.target.blur() }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1}>
                  <TextField
                    label="Avail"
                    value={(() => {
                      const a = availabilityByIndex[originalIndex];
                      if (!a) return 'N/A';
                      return a.available < 0 ? `${a.available} (Insufficient)` : String(a.available);
                    })()}
                    fullWidth InputProps={{ readOnly: true }}
                    sx={{
                      backgroundColor: (() => {
                        const a = availabilityByIndex[originalIndex];
                        if (!a) return '#f5f5f5';
                        return a.available >= 0 ? '#e8f5e8' : '#ffeaea';
                      })(),
                      '& .MuiInputBase-input': {
                        color: (() => {
                          const a = availabilityByIndex[originalIndex];
                          return a?.isNegative ? '#d32f2f' : '#2e7d32';
                        })()
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1}>
                  <TextField label="Unit" value={item.part_number === 'SUPPLY' ? '' : item.unit} fullWidth InputProps={{ readOnly: true }} sx={{ backgroundColor:'#ffffff' }} />
                </Grid>
                <Grid item xs={12} sm={2} md={1.5}>
                  <TextField
                    label="Unit Cost"
                    value={item.part_number === 'LABOUR' ? (globalLabourRate ?? 0) : item.part_number === 'OVERHEAD' ? (globalOverheadRate ?? 0) : item.part_number === 'SUPPLY' ? '' : item.unit_price}
                    type="number" fullWidth
                    InputProps={{
                      readOnly: true,
                      startAdornment: item.part_number !== 'SUPPLY' ? <InputAdornment position="start">$</InputAdornment> : undefined,
                      disabled: ['LABOUR','OVERHEAD','SUPPLY'].includes(item.part_number)
                    }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField label="Amount" value={item.line_amount != null && !isNaN(Number(item.line_amount)) ? Number(item.line_amount).toFixed(2) : '0.00'} InputProps={{ readOnly: true }} fullWidth />
                </Grid>
                <Grid item xs={6} sm={3} md={1} sx={{ display:'flex', alignItems:'center' }}>
                  <Button variant="outlined" color="primary" onClick={() => handleRemoveLineItem(originalIndex)} fullWidth>Remove</Button>
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
          <Box sx={{ mt:2 }}>
            <Button variant="outlined" color="primary" onClick={handleAddLineItem}>Add Line Item</Button>
          </Box>
        </Paper>
        </Box>

        <Paper sx={{ p:3, mb:3 }} elevation={3}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}><Typography variant="subtitle1">Subtotal: {formatCurrency(subtotal)}</Typography></Grid>
            <Grid item xs={12} sm={4}><Typography variant="subtitle1">Total GST: {formatCurrency(totalGSTAmount)}</Typography></Grid>
            <Grid item xs={12} sm={4}><Typography variant="h6">Total Amount: {formatCurrency(totalAmount)}</Typography></Grid>
          </Grid>
        </Paper>

        {/* Parts to Order (edit mode only) */}
        {!isCreationMode && (
          <Paper sx={{
            p:3, mb:3, elevation:3, border:'2px solid #b8860b',
            '& .MuiOutlinedInput-root': { '& fieldset': { borderColor:'#b8860b' }, '&:hover fieldset': { borderColor:'#b8860b' } }
          }}>
            <Typography variant="h6" gutterBottom>Parts to Order</Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb:2 }}>
              Add parts that need to be ordered for this sales order. These quantities are aggregated across all sales orders.
            </Typography>
            <Grid container spacing={2}>
              {quantityToOrderItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  <Grid item xs={12} sm={6} md={3}>
                      <Autocomplete<PartOption, false, false, true>
                       open={ptoOpenIndex === idx}
                       onOpen={() => setPtoOpenIndex(idx)}
                       onClose={() => setPtoOpenIndex(null)}
                       autoHighlight
                       value={item.part_number}
                      onChange={(_, v) => {
                         if (!v) {
                          setQuantityToOrderItems(prev => {
                            const u=[...prev]; u[idx] = { ...u[idx], part_number:'', part_description:'', unit:'Each', unit_price:0, line_amount:0 }; return u;
                          });
                          return;
                         }
                         if (typeof v === 'string') {
                           const inv = inventoryItems.find((x:any)=>x.part_number===v);
                           if (inv) {
                          const lastUnitCost = parseFloat(String(inv.last_unit_cost)) || 0;
                          const marginFactor = findMarginFactor(lastUnitCost);
                          const calcPrice = lastUnitCost * marginFactor;
                          setQuantityToOrderItems(prev => {
                            const u=[...prev]; u[idx]={ ...u[idx], part_number:inv.part_number, part_description:inv.part_description, unit:inv.unit||'Each', unit_price:calcPrice, line_amount:0 }; return u;
                          });
                           } else {
                             setQuantityToOrderItems(prev => {
                               const u=[...prev]; u[idx]={ ...u[idx], part_number:v, part_description:'', unit:'Each', unit_price:0, line_amount:0 }; return u;
                             });
                             const typed = String(v).toUpperCase();
                             setPtoPartToAddIndex(idx);
                             setPtoPartNumberForModal(typed);
                             setOpenPartDialogForPTO(true);
                           }
                         } else if (v && typeof v === 'object' && 'isNew' in v) {
                           const typed = String((v as any).inputValue || '').toUpperCase();
                           setPtoPartToAddIndex(idx);
                           setPtoPartNumberForModal(typed);
                           setOpenPartDialogForPTO(true);
                        }
                      }}
                        onInputChange={(_, v, reason) => {
                        setQuantityToOrderItems(prev => {
                          const u=[...prev]; u[idx] = { ...u[idx], part_number:(v||'').toUpperCase() }; return u;
                        });
                         if (partTypingTimer) window.clearTimeout(partTypingTimer);
                         if (reason === 'reset') return;
                         const text = (v || '').trim();
                         if (text.length > 0) {
                           const t = window.setTimeout(() => setPtoOpenIndex(idx), 200);
                           setPartTypingTimer(t as unknown as number);
                         } else {
                           setPtoOpenIndex(null);
                         }
                      }}
                      options={inventoryItems.filter((inv:any)=>inv.part_type!=='supply').map((inv:any)=>inv.part_number)}
                      freeSolo selectOnFocus clearOnBlur
                       filterOptions={(options, params) => {
                         const text = (params.inputValue || '').toUpperCase();
                         // Filter by both part number and description
                         const filtered = (options as string[]).filter(partNumber => {
                           const inv = inventoryItems.find(inv => inv.part_number === partNumber);
                           if (!inv) return String(partNumber).toUpperCase().includes(text);
                           return String(partNumber).toUpperCase().includes(text) || 
                                  String(inv.part_description || '').toUpperCase().includes(text);
                         });
                         const hasExact = filtered.some(o => String(o).toUpperCase() === text);
                         const out: PartOption[] = [...filtered] as any;
                         if (text && !hasExact) {
                           out.push({ label: `Add "${params.inputValue}" as New Part`, isNew: true, inputValue: params.inputValue } as any);
                         }
                         return out as any;
                       }}
                        renderOption={(props, option) => {
                          const isNew = typeof option === 'object' && (option as any).isNew;
                          const label = typeof option === 'string' ? option : (option as any).label;
                          const { key, ...otherProps } = props;
                          return (
                            <li key={key} {...otherProps}>
                              {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                              {typeof option === 'string' ? (
                                <Box>
                                  <Typography variant="body2">{option}</Typography>
                                  {(() => {
                                    const inv = inventoryItems.find(inv => inv.part_number === option);
                                    return inv?.part_description ? (
                                      <Typography variant="caption" color="text.secondary">
                                        {inv.part_description}
                                      </Typography>
                                    ) : null;
                                  })()}
                                </Box>
                              ) : (
                                label
                              )}
                            </li>
                          );
                        }}
                        renderInput={p => <TextField {...p} label="Part Number" fullWidth required onKeyDown={(e)=>handlePtoPartKeyDown(idx, e)} onBlur={() => setPtoOpenIndex(null)} />}
                       onBlur={() => {
                         const inputValue = (quantityToOrderItems[idx]?.part_number || '').trim().toUpperCase();
                         if (!inputValue) return;
                         const inv = inventoryItems.find((x:any) => x.part_number === inputValue);
                         if (!inv) {
                           setPtoPartToAddIndex(idx);
                           setPtoPartNumberForModal(inputValue);
                           setOpenPartDialogForPTO(true);
                           setPtoOpenIndex(null);
                         }
                       }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <TextField label="Description" value={item.part_description} fullWidth InputProps={{ readOnly:true }} sx={{ backgroundColor:'#f5f5f5' }} />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1}>
                    <TextField
                      label="Qty to Order"
                      value={item.quantity_to_order}
                      onChange={e => {
                        const q = e.target.value;
                        setQuantityToOrderItems(prev => {
                          const u=[...prev]; const qn = parseFloat(q)||0;
                          const price = u[idx].unit_price || 0;
                          u[idx] = { ...u[idx], quantity_to_order:q, line_amount: qn * price };
                          return u;
                        });
                      }}
                      type="number" fullWidth required inputProps={{ step:1, min:0, onWheel:(e:any)=>e.target.blur() }}
                    />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1}>
                    <TextField label="Unit" value={item.unit} fullWidth InputProps={{ readOnly:true }} sx={{ backgroundColor:'#ffffff' }} />
                  </Grid>
                  <Grid item xs={12} sm={1.5}>
                    <TextField label="Unit Price" value={item.unit_price} type="number" fullWidth InputProps={{ readOnly:true, startAdornment:<InputAdornment position="start">$</InputAdornment> }} sx={{ backgroundColor:'#f5f5f5' }} />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1.5}>
                    <TextField label="Amount" value={item.line_amount} InputProps={{ readOnly:true }} fullWidth />
                  </Grid>
                  <Grid item xs={12} sm={1} md={1} sx={{ display:'flex', alignItems:'center', gap:2 }}>
                    <Button variant="outlined" onClick={() => setQuantityToOrderItems(prev => prev.filter((_,i)=>i!==idx))}
                      sx={{ flexShrink:0, borderColor:'#b8860b', color:'#b8860b', '&:hover':{ borderColor:'#8b6914', backgroundColor:'#fff8dc' } }}>
                      Remove
                    </Button>
                  </Grid>
                </React.Fragment>
              ))}
            </Grid>
            <Box sx={{ mt:2 }}>
              <Button variant="outlined" color="primary" onClick={() => setQuantityToOrderItems(prev => [...prev, {
                sales_order_id: Number(id) || 0, part_number:'', part_description:'', quantity_to_order:'', unit:'Each', unit_price:0, line_amount:0
              }])}>
                Add Parts to Order Item
              </Button>
            </Box>
          </Paper>
        )}

        {/* Add dialogs */}
        <UnifiedCustomerDialog
          open={isAddCustomerModalOpen}
          onClose={() => setIsAddCustomerModalOpen(false)}
          onSave={async (cust: CustomerFormValues) => {
            try {
              const res = await api.post('/api/customers', cust);
              const opt = { label: cust.customer_name, id: res.data.customer_id };
              setCustomers(prev => [...prev, opt]);
              setCustomer(opt);
              setIsAddCustomerModalOpen(false);
              toast.success('Customer added successfully!');
            } catch { toast.error('Failed to add customer.'); }
          }}
          initialCustomer={{ customer_name: newCustomerName }}
          isEditMode={false}
        />
        <UnifiedProductDialog
          open={isAddProductModalOpen}
          onClose={() => setIsAddProductModalOpen(false)}
          onSave={async (p: ProductFormValues) => {
            try {
              const res = await api.post('/api/products', p);
              const opt = { label: p.product_name, id: res.data.product_id, description: p.product_name };
              setProducts(prev => [...prev, opt]); setProduct(opt); setProductInput(opt.label);
              setIsAddProductModalOpen(false); setNewProductName('');
              toast.success('Product added successfully!');
            } catch { toast.error('Failed to add product.'); }
          }}
          initialProduct={{ product_name: newProductName || productInput }}
          isEditMode={false}
        />

        {/* QBO export + success snackbar (edit only, closed SOs only) */}
        {!isCreationMode && (
          <>
            {exportError && <Alert severity="error" sx={{ mb:2 }} onClose={() => setExportError(null)}>{exportError}</Alert>}
            <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess(null)} anchorOrigin={{ vertical:'top', horizontal:'center' }}>
              <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width:'100%' }}>{success}</Alert>
            </Snackbar>
            {!salesOrder?.exported_to_qbo && salesOrder?.status?.toLowerCase() === 'closed' && (
              <Box display="flex" justifyContent="flex-end" gap={2} mb={2}>
                <Button variant="contained" color="success" startIcon={<CloudUploadIcon />} disabled={exportLoading} onClick={handleExportToQBO}>
                  {exportLoading ? 'Exporting...' : 'Export to QuickBooks'}
                </Button>
                {user?.access_role !== 'Sales and Purchase' && (
                  <Button variant="outlined" onClick={handleReopenSO}>Reopen SO</Button>
                )}
              </Box>
            )}
          </>
        )}
      </Container>
      {/* Add New Part dialogs */}
      <UnifiedPartDialog
        open={openPartDialogForLine}
        onClose={() => {
          setOpenPartDialogForLine(false);
          setLinePartToAddIndex(null);
          setLinePartNumberForModal('');
        }}
        onSave={async (partData: PartFormValues) => {
          // Create part then update inventory and the specific line item
          const response = await api.post('/api/inventory', partData);
          const updatedInventory = await api.get('/api/inventory');
          setInventoryItems(updatedInventory.data);
          const addedPart = response.data.item;
          if (linePartToAddIndex !== null) {
            setLineItems(prev => {
              const updated = [...prev];
              const lastUnitCost = parseFloat(String(addedPart.last_unit_cost)) || 0;
              const marginFactor = findMarginFactor(lastUnitCost);
              const unitPrice = lastUnitCost * marginFactor;
              updated[linePartToAddIndex] = {
                ...updated[linePartToAddIndex],
                part_number: addedPart.part_number,
                part_description: addedPart.part_description,
                unit: addedPart.unit || updated[linePartToAddIndex].unit,
                unit_price: unitPrice,
              } as any;
              return updated;
            });
          }
        }}
        title="Add New Part"
        initialPart={{ part_number: linePartNumberForModal.toUpperCase(), category: 'Uncategorized' }}
      />
      <UnifiedPartDialog
        open={openPartDialogForPTO}
        onClose={() => {
          setOpenPartDialogForPTO(false);
          setPtoPartToAddIndex(null);
          setPtoPartNumberForModal('');
        }}
        onSave={async (partData: PartFormValues) => {
          // Create part then update inventory and the specific parts-to-order item
          const response = await api.post('/api/inventory', partData);
          const updatedInventory = await api.get('/api/inventory');
          setInventoryItems(updatedInventory.data);
          const addedPart = response.data.item;
          if (ptoPartToAddIndex !== null) {
            setQuantityToOrderItems(prev => {
              const u = [...prev];
              const lastUnitCost = parseFloat(String(addedPart.last_unit_cost)) || 0;
              const marginFactor = findMarginFactor(lastUnitCost);
              const calcPrice = lastUnitCost * marginFactor;
              u[ptoPartToAddIndex] = {
                ...u[ptoPartToAddIndex],
                part_number: addedPart.part_number,
                part_description: addedPart.part_description,
                unit: addedPart.unit || 'Each',
                unit_price: calcPrice,
              } as any;
              return u;
            });
          }
        }}
        title="Add New Part"
        initialPart={{ part_number: ptoPartNumberForModal.toUpperCase(), category: 'Uncategorized' }}
      />
    </LocalizationProvider>
  );
};

export default SalesOrderDetailPage;
