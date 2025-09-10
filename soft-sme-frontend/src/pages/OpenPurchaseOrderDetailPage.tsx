import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography, Box, TextField, Button, MenuItem, Stack, Autocomplete, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions, Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress, Alert, Card, CardContent, DialogContentText, Snackbar, Chip
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import api from '../api/axios';
import { AxiosError } from 'axios';
import SaveIcon from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EmailIcon from '@mui/icons-material/Email';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { createFilterOptions } from '@mui/material/Autocomplete';
import { InputAdornment } from '@mui/material';
import { getLabourLineItems, LabourLineItem } from '../services/timeTrackingService';
import { getPartVendors, recordVendorUsage, InventoryVendorLink } from '../services/inventoryService';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import { VoiceService } from '../services/voiceService';
import { toast } from 'react-toastify';
import { getApiConfig } from '../config/api';
import { formatCurrency, getLogoUrl } from '../utils/formatters';
import UnifiedVendorDialog, { VendorFormValues } from '../components/UnifiedVendorDialog';
import UnifiedPartDialog, { PartFormValues } from '../components/UnifiedPartDialog';
import AllocationModal from '../components/AllocationModal';
import EmailModal from '../components/EmailModal';
import {
  calculateLineAmount,
  calculatePurchaseOrderTotals,
  updateLineItemsWithCalculatedAmounts,
  validatePurchaseOrder,
  validateLineItem,
  parseNumericInput,
  PurchaseOrderLineItem as RobustLineItem
} from '../utils/purchaseOrderCalculations';
import { useAuth } from '../contexts/AuthContext';
import { useDebounce } from '../hooks/useDebounce';

const UNIT_OPTIONS = ['Each', 'cm', 'ft', 'kg', 'pcs', 'L'];
const DEFAULT_GST_RATE = 5.0;
const PART_TYPE_OPTIONS = ['stock', 'supply']; // Define PART_TYPE_OPTIONS

interface PurchaseOrderLineItem {
  line_item_id?: number;
  purchase_id?: number;
  part_number: string;
  part_description: string;
  quantity: string | number;
  unit: string;
  unit_cost: string | number;
  line_amount: number;
  line_total?: number; // Add this field for backend compatibility
  quantity_to_order?: number; // Aggregate quantity from parts to order
}

interface PurchaseOrderData {
  purchase_id: number;
  purchase_number: string;
  vendor_id: number;
  vendor_name: string;
  purchase_date: string;
  bill_number: string;
  total_amount: number;
  subtotal: number;
  total_gst_amount: number;
  status: string;
  lineItems: PurchaseOrderLineItem[];
  global_gst_rate: number;
  pickup_time?: string;
  pickup_location?: string;
  pickup_contact_person?: string;
  pickup_phone?: string;
  pickup_instructions?: string;
  pickup_notes?: string;
  // Order placement tracking fields
  order_placed?: boolean;
  order_placed_at?: string;
  order_placed_by?: number;
  order_placed_method?: string;
  vendor_confirmation_status?: string;
  vendor_confirmation_notes?: string;
  vendor_confirmation_date?: string;
  pricing_updated?: boolean;
  pricing_updated_at?: string;
  pricing_updated_by?: number;
  pricing_updated_method?: string;
  quantity_adjusted?: boolean;
  quantity_adjusted_at?: string;
  quantity_adjusted_by?: number;
  quantity_adjusted_method?: string;
  original_quantities?: any;
  adjusted_quantities?: any;
  vendor_pricing_notes?: string;
  exported_to_qbo?: boolean;
  qbo_export_status?: string;
}

interface VendorOption {
  label: string;
  id?: number;
  isNew?: true;
  email?: string;
}

interface InventoryItem {
  part_number: string;
  part_description: string;
  unit: string;
  last_unit_cost: number;
  quantity_on_hand: number;
}

const OpenPurchaseOrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Check if we're in creation mode
  const isCreationMode = id === 'new';
  console.log('Is creation mode:', isCreationMode, 'ID:', id);

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderData | null>(null);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [billNumber, setBillNumber] = useState('');
  const [liveLineItems, setLiveLineItems] = useState<PurchaseOrderLineItem[]>([]);
  const debouncedLineItems = useDebounce(liveLineItems, 300);
  const [lineItems, setLineItems] = useState<PurchaseOrderLineItem[]>([]);
  const [status, setStatus] = useState<'Open' | 'Closed'>('Open');
  const [globalGstRate, setGlobalGstRate] = useState(DEFAULT_GST_RATE); // Default GST rate
  const [aggregateQuantities, setAggregateQuantities] = useState<{[key: string]: number}>({});

  const [refreshKey, setRefreshKey] = useState(0);

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorInput, setVendorInput] = useState('');
  const vendorInputRef = useRef<HTMLInputElement | null>(null);
  const [vendorOpen, setVendorOpen] = useState<boolean>(false);
  const [vendorTypingTimer, setVendorTypingTimer] = useState<number | null>(null);
  const [highlightedVendor, setHighlightedVendor] = useState<VendorOption | null>(null);
  const [vendorEnterPressed, setVendorEnterPressed] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [vendorPartMap, setVendorPartMap] = useState<Record<string, InventoryVendorLink[]>>({});
  const [callSessionId, setCallSessionId] = useState<number | null>(null);

  // Add loading state to prevent onInputChange during initial load
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  type PartOption = string | { label: string; isNew?: true; inputValue?: string };

  // State for new part modal
  const [openPartDialog, setOpenPartDialog] = useState(false);
  const [partToAddIndex, setPartToAddIndex] = useState<number | null>(null);
  const [partNumberForModal, setPartNumberForModal] = useState(''); // New state for part modal
  // Advanced combobox state for Part Number fields
  const [partOpenIndex, setPartOpenIndex] = useState<number | null>(null);
  const [partTypingTimer, setPartTypingTimer] = useState<number | null>(null);
  const [partEnterPressedIndex, setPartEnterPressedIndex] = useState<number | null>(null);
  const [partInputs, setPartInputs] = useState<Record<number, string>>({});

  const [errors, setErrors] = useState<{ 
    vendor?: string;
    date?: string;
    billNumber?: string;
    lineItems?: Array<{ 
      part_number?: string;
      part_description?: string;
      quantity?: string;
      unit_cost?: string;
    }>;
  }>({});

  // Helper for filtering vendor options
  const filterVendorOptions = useMemo(() => createFilterOptions<VendorOption>(), []);

  const [error, setError] = useState<string | null>(null);

  // State for bill number validation banner
  const [showBillNumberAlert, setShowBillNumberAlert] = useState(false);

  const [success, setSuccess] = useState<string | null>(null);

  const fetchAggregateQuantities = async () => {
    try {
      console.log('Fetching aggregate quantities...');
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await api.get('/api/sales-orders/parts-to-order/all', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const { aggregatedParts } = response.data;
      console.log('Full API response:', response.data);
      console.log('Aggregated parts response:', aggregatedParts);
      
      if (aggregatedParts && aggregatedParts.length > 0) {
        const quantities: {[key: string]: number} = {};
        aggregatedParts.forEach((part: any) => {
          // Store with uppercase key for consistency and ensure value is a number
          const numericQuantity = typeof part.total_quantity_needed === 'string' ? 
            parseFloat(part.total_quantity_needed) : part.total_quantity_needed;
          quantities[part.part_number.toUpperCase()] = numericQuantity;
        });
        console.log('Calculated quantities:', quantities);
        setAggregateQuantities(quantities);
        
        // Update line items with aggregate quantities
        setLineItems(prev => {
          const updated = prev.map(item => ({
            ...item,
            quantity_to_order: quantities[item.part_number] || 0
          }));
          console.log('Updated line items with quantities:', updated);
          return updated;
        });
      } else {
        // If no aggregated parts, clear the quantities
        console.log('No aggregated parts found, clearing quantities');
        setAggregateQuantities({});
        setLineItems(prev => prev.map(item => ({
          ...item,
          quantity_to_order: 0
        })));
      }
    } catch (error: any) {
      console.error('Error fetching aggregate quantities:', error);
      if (error.name === 'AbortError') {
        console.error('Request timed out');
      }
      // Set empty quantities on error to prevent hanging
      setAggregateQuantities({});
      setLineItems(prev => prev.map(item => ({
        ...item,
        quantity_to_order: 0
      })));
    }
  };

  const fetchData = async () => {
    console.log('fetchData called. ID:', id);
    
    // If in creation mode, only fetch vendors and inventory
    if (isCreationMode) {
      try {
        console.log('🔄 Fetching vendors and inventory for creation mode...');
        
        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        const [vendorsRes, inventoryRes] = await Promise.all([
          api.get('/api/vendors', { signal: controller.signal }),
          api.get('/api/inventory', { signal: controller.signal })
        ]);
        
        clearTimeout(timeoutId);
        
        console.log('✅ Vendors and inventory fetched successfully');
        console.log('Raw vendors data:', vendorsRes.data);
        const mappedVendors = vendorsRes.data.map((v: any) => ({ 
          label: v.vendor_name, 
          id: v.vendor_id,
          email: v.email 
        }));
        console.log('Mapped vendors:', mappedVendors);
        setVendors(mappedVendors);
        setInventoryItems(inventoryRes.data);
        
        // Allow creation with zero line items
        setLineItems([]);
        
        // Fetch aggregate quantities for creation mode (with error handling)
        try {
          await fetchAggregateQuantities();
        } catch (aggError) {
          console.error('Error fetching aggregate quantities:', aggError);
          // Continue even if aggregate quantities fail
        }
        
        setIsInitialLoad(false);
        console.log('✅ Creation mode initialization complete');
        return;
      } catch (error: any) {
        console.error('❌ Error fetching vendors/inventory:', error);
        if (error.name === 'AbortError') {
          setError('Request timed out. Please try again.');
        } else {
          setError('Failed to fetch vendors and inventory. Please check your connection and try again.');
        }
        setIsInitialLoad(false);
        return;
      }
    }
    
    try {
      const [response, vendorsRes, inventoryRes] = await Promise.all([
        api.get(`/api/purchase-orders/${id}`),
        api.get('/api/vendors'),
        api.get('/api/inventory')
      ]);
      
      const fetchedOrder: PurchaseOrderData = response.data;
      console.log('Fetched Order Data:', fetchedOrder);
      setPurchaseOrder(fetchedOrder);
      // Only set vendor if we have valid vendor data and don't already have a vendor selected
      if (fetchedOrder.vendor_name && fetchedOrder.vendor_id) {
        // Find the vendor in the vendors list to get the email
        const vendorInList = vendorsRes.data.find((v: any) => v.vendor_id === fetchedOrder.vendor_id);
        setVendor({ 
          label: fetchedOrder.vendor_name, 
          id: fetchedOrder.vendor_id,
          email: vendorInList?.email 
        });
      } else if (fetchedOrder.vendor_id) {
        // If vendor data is missing but we have vendor_id, try to find it in the vendors list
        const vendorInList = vendorsRes.data.find((v: any) => v.vendor_id === fetchedOrder.vendor_id);
        if (vendorInList) {
          setVendor({ 
            label: vendorInList.vendor_name, 
            id: vendorInList.vendor_id,
            email: vendorInList.email 
          });
        } else {
          // Only set to null if we don't already have a vendor selected
          if (!vendor || !vendor.id) {
            setVendor(null);
          }
        }
      } else {
        // Only set to null if we don't already have a vendor selected
        if (!vendor || !vendor.id) {
          setVendor(null);
        }
      }
      setDate(dayjs(fetchedOrder.purchase_date));
      setBillNumber(fetchedOrder.bill_number || '');
      
      // Debug line items mapping
      console.log('Original line items from backend:', fetchedOrder.lineItems);
      const mappedLineItems = fetchedOrder.lineItems.map(item => {
        const mapped = {
          ...item,
          quantity: String(item.quantity || ''),         unit_cost: String(item.unit_cost || ''),       line_amount: parseFloat(String(item.line_amount ?? item.line_total ?? 0)),
          quantity_to_order: 0, // Initialize with 0, will be updated after fetching aggregate quantities
        };
        console.log('Mapped line item:', mapped);
        return mapped;
      });
      console.log('Final mapped line items:', mappedLineItems);
      setLineItems(mappedLineItems);
      setLiveLineItems(mappedLineItems);
      
      const newStatus = fetchedOrder.status === 'Closed' ? 'Closed' : 'Open';
      console.log('Setting purchase order status:', newStatus, 'from fetched status:', fetchedOrder.status);
      setStatus(newStatus);
      setGlobalGstRate(fetchedOrder.global_gst_rate || DEFAULT_GST_RATE);

      console.log('State after setting:', {
        purchaseOrder: fetchedOrder,
        billNumber: fetchedOrder.bill_number || '',
        lineItems: fetchedOrder.lineItems,
        mappedLineItems: mappedLineItems,
        subTotal: parseFloat(String(fetchedOrder.subtotal)) ||0,
        totalGSTAmount: parseFloat(String(fetchedOrder.total_gst_amount)) || 0,
        totalAmount: parseFloat(String(fetchedOrder.total_amount)) || 0,
      });

      console.log('Raw vendors data (edit mode):', vendorsRes.data);
      const mappedVendors = vendorsRes.data.map((v: any) => ({ 
        label: v.vendor_name, 
        id: v.vendor_id,
        email: v.email 
      }));
      console.log('Mapped vendors (edit mode):', mappedVendors);
      setVendors(mappedVendors);
      setInventoryItems(inventoryRes.data);
      
      // Fetch aggregate quantities for quantity to order display
      await fetchAggregateQuantities();
      
      // Mark initial load as complete
      setIsInitialLoad(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      if (error instanceof AxiosError && error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError('An unexpected error occurred');
      }
    }
  };

  useEffect(() => {
    if (id) {
      fetchData();
    }
  }, [id]);

  // Debug useEffect to monitor lineItems state
  useEffect(() => {
    console.log('lineItems state changed:', lineItems);
  }, [lineItems]);

  // Synchronize liveLineItems with lineItems to prevent undefined access errors
  useEffect(() => {
    setLiveLineItems(lineItems);
  }, [lineItems]);

  // Close dropdowns when route changes
  useEffect(() => {
    setVendorOpen(false);
    setPartOpenIndex(null);
  }, [id]);

  const calculateLineItemAmount = (item: PurchaseOrderLineItem) => {
    return calculateLineAmount(parseNumericInput(item.quantity), parseNumericInput(item.unit_cost));
  };

  // Memoized robust line items for calculation
  const robustLineItems: RobustLineItem[] = useMemo(() => (
    debouncedLineItems.map(item => ({
      part_number: item.part_number,
      part_description: item.part_description,
      quantity: parseNumericInput(item.quantity),
      unit: item.unit,
      unit_cost: parseNumericInput(item.unit_cost),
    }))
  ), [debouncedLineItems]);

  // Memoized totals calculation
  const memoizedTotals = useMemo(() => (
    calculatePurchaseOrderTotals(robustLineItems, globalGstRate)
  ), [robustLineItems, globalGstRate]);

  const subTotal = memoizedTotals.subtotal;
  const totalGSTAmount = memoizedTotals.total_gst_amount;
  const totalAmount = memoizedTotals.total_amount;

  // Helper to create a stable signature for line items
  const getLineItemsSignature = useCallback((items: PurchaseOrderLineItem[]) => {
    return JSON.stringify(
      items
        .map(item => ({
          part_number: item.part_number.trim(),
          part_description: item.part_description.trim(),
          quantity: parseFloat(String(item.quantity)),
          unit: item.unit.trim(),
          unit_cost: parseFloat(String(item.unit_cost)),
          // line_amount is derived, so don't include in signature to avoid noise
          // quantity_to_order is also derived/fetched, not user-editable
        }))
        .sort((a, b) => {
          // Stable sort for line items
          if (a.part_number !== b.part_number) return a.part_number.localeCompare(b.part_number);
          return a.quantity - b.quantity; // Assuming quantity is numeric
        })
    );
  }, []);

  const [initialSignature, setInitialSignature] = useState<string>('');
  useEffect(() => {
    // Initialize baseline only once after data loads
    if (!isCreationMode && !isInitialLoad && purchaseOrder && initialSignature === '') {
      console.log('[PO Detail] Setting initial signature for dirty tracking');
      setInitialSignature(JSON.stringify({
        vendor: vendor ? { id: vendor.id, label: vendor.label } : null,
        billNumber: billNumber.trim(),
        date: date?.toISOString(),
        lineItems: getLineItemsSignature(lineItems),
        pickup_time: purchaseOrder.pickup_time || null,
        pickup_location: purchaseOrder.pickup_location || null,
        pickup_contact_person: purchaseOrder.pickup_contact_person || null,
        pickup_phone: purchaseOrder.pickup_phone || null,
        pickup_instructions: purchaseOrder.pickup_instructions || null,
        pickup_notes: purchaseOrder.pickup_notes || null,
        order_placed: purchaseOrder.order_placed || false,
        order_placed_at: purchaseOrder.order_placed_at || null,
        order_placed_by: purchaseOrder.order_placed_by || null,
        order_placed_method: purchaseOrder.order_placed_method || null,
        vendor_confirmation_status: purchaseOrder.vendor_confirmation_status || 'pending',
        vendor_confirmation_notes: purchaseOrder.vendor_confirmation_notes || null,
        vendor_confirmation_date: purchaseOrder.vendor_confirmation_date || null,
        pricing_updated: purchaseOrder.pricing_updated || false,
        pricing_updated_at: purchaseOrder.pricing_updated_at || null,
        pricing_updated_by: purchaseOrder.pricing_updated_by || null,
        pricing_updated_method: purchaseOrder.pricing_updated_method || null,
        quantity_adjusted: purchaseOrder.quantity_adjusted || false,
        quantity_adjusted_at: purchaseOrder.quantity_adjusted_at || null,
        quantity_adjusted_by: purchaseOrder.quantity_adjusted_by || null,
        quantity_adjusted_method: purchaseOrder.quantity_adjusted_method || null,
        original_quantities: purchaseOrder.original_quantities || null,
        adjusted_quantities: purchaseOrder.adjusted_quantities || null,
        vendor_pricing_notes: purchaseOrder.vendor_pricing_notes || null
      }));
    }
  }, [isCreationMode, isInitialLoad, purchaseOrder, vendor, billNumber, date, lineItems]);

  const currentSignature = useMemo(() => JSON.stringify({ 
    vendor: vendor ? { id: vendor.id, label: vendor.label } : null,
    billNumber: billNumber.trim(), 
    date: date?.toISOString(),
    lineItems: getLineItemsSignature(lineItems),
    pickup_time: purchaseOrder?.pickup_time || null,
    pickup_location: purchaseOrder?.pickup_location || null,
    pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
    pickup_phone: purchaseOrder?.pickup_phone || null,
    pickup_instructions: purchaseOrder?.pickup_instructions || null,
    pickup_notes: purchaseOrder?.pickup_notes || null,
    order_placed: purchaseOrder?.order_placed || false,
    order_placed_at: purchaseOrder?.order_placed_at || null,
    order_placed_by: purchaseOrder?.order_placed_by || null,
    order_placed_method: purchaseOrder?.order_placed_method || null,
    vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
    vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
    vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
    pricing_updated: purchaseOrder?.pricing_updated || false,
    pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
    pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
    pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
    quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
    quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
    quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
    quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
    original_quantities: purchaseOrder?.original_quantities || null,
    adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
    vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
  }), [vendor, billNumber, date, lineItems, purchaseOrder]);

  const isDirty = Boolean(initialSignature) && initialSignature !== currentSignature;
  
  // Debug logging for UnsavedChangesGuard
  useEffect(() => {
    console.log('[PO Detail] isDirty changed:', {
      isDirty,
      hasInitialSignature: Boolean(initialSignature),
      signaturesMatch: initialSignature === currentSignature,
      initialSignature: initialSignature.slice(0, 100) + '...',
      currentSignature: currentSignature.slice(0, 100) + '...'
    });
    console.log('[PO Detail] About to render UnsavedChangesGuard with when=', isDirty);
  }, [isDirty, initialSignature, currentSignature]);

  // Update line items with aggregate quantities when they change
  useEffect(() => {
    console.log('Aggregate quantities changed:', aggregateQuantities);
    if (Object.keys(aggregateQuantities).length > 0) {
      setLineItems(prev => {
        const updated = prev.map(item => {
          // Check for case-insensitive match
          const quantityToOrder = aggregateQuantities[item.part_number] || 
                                 aggregateQuantities[item.part_number.toUpperCase()] || 
                                 aggregateQuantities[item.part_number.toLowerCase()] || 0;
          // Ensure quantityToOrder is a number
          const numericQuantityToOrder = typeof quantityToOrder === 'string' ? parseFloat(quantityToOrder) : quantityToOrder;
          return {
            ...item,
            quantity_to_order: numericQuantityToOrder
          };
        });
        console.log('Updated line items from aggregate quantities effect:', updated);
        return updated;
      });
    }
  }, [aggregateQuantities]);

  const handleLineItemChange = (idx: number, field: keyof PurchaseOrderLineItem, value: any) => {
    setLineItems((prev) => {
      const updated = [...prev];

      // Safety check: if item at idx doesn't exist, return unchanged
      if (!updated[idx]) {
        console.log('Item at index', idx, 'not found in handleLineItemChange');
        return prev;
      }

      const item = { ...updated[idx], [field]: value } as PurchaseOrderLineItem;

      // Auto-remove line item if quantity is 0
      if (field === 'quantity' && parseFloat(value) <= 0) {
        return updated.filter((_, i) => i !== idx);
      }

      if (field === 'quantity' || field === 'unit_cost') {
        item.line_amount = calculateLineItemAmount(item);
      }
      updated[idx] = item;
      return updated;
    });
  };

  const handleAddLineItem = () => {
    setLineItems((prev) => ([...prev, {
      part_number: '',
      part_description: '',
      quantity: '',
      unit: UNIT_OPTIONS[0],
      unit_cost: '',
      line_amount: 0,
      quantity_to_order: 0,
    }]));
  };

  // Load vendor mappings for canonical PN if not cached
  const ensureVendorMappings = async (pn: string) => {
    const key = pn.toUpperCase();
    if (vendorPartMap[key]) return;
    try {
      const links = await getPartVendors(key);
      setVendorPartMap(prev => ({ ...prev, [key]: links }));
    } catch {}
  };

  const chooseVendorPN = (canonicalPN: string, vendorId?: number | null): string => {
    const links = vendorPartMap[canonicalPN.toUpperCase()] || [];
    if (links.length === 0) return canonicalPN;
    if (vendorId) {
      const forVendor = links.filter(l => l.vendor_id === vendorId);
      if (forVendor.length > 0) {
        const preferred = forVendor.find(l => l.preferred);
        if (preferred) return preferred.vendor_part_number;
        const mostUsed = [...forVendor].sort((a,b) => (b.usage_count||0)-(a.usage_count||0))[0];
        if (mostUsed) return mostUsed.vendor_part_number;
      }
    }
    const preferredAny = links.find(l => l.preferred);
    if (preferredAny) return preferredAny.vendor_part_number;
    const mostUsedAny = [...links].sort((a,b) => (b.usage_count||0)-(a.usage_count||0))[0];
    return mostUsedAny ? mostUsedAny.vendor_part_number : canonicalPN;
  };

  // When vendor selected/changed, update PNs accordingly
  useEffect(() => {
    if (!vendor) return;
    setLineItems(prev => prev.map(li => {
      const canonicalPN = (li.part_number || '').toUpperCase();
      const links = vendorPartMap[canonicalPN];
      if (!links || links.length === 0) return li;
      const chosen = chooseVendorPN(canonicalPN, vendor?.id || null);
      return { ...li, part_number: chosen };
    }));
  }, [vendor, vendorPartMap]);

  const handleRemoveLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const findInventory = (partNumber: string) =>
    inventoryItems.find((p) => p.part_number === partNumber);

  const handlePartNumberChange = (idx: number, newValue: PartOption | null) => {
    console.log('handlePartNumberChange called:', { idx, newValue, inventoryItemsLength: inventoryItems.length });
    setLiveLineItems((prev) => {
      const updated = [...prev];
      const currentItem = updated[idx];
      console.log('Current item before change:', currentItem);

      // Safety check: if currentItem doesn't exist, create a default one
      if (!currentItem) {
        console.log('Current item not found, creating default item');
        updated[idx] = {
          part_number: '',
          part_description: '',
          quantity: '',
          unit: UNIT_OPTIONS[0],
          unit_cost: '',
          line_amount: 0,
          quantity_to_order: 0,
        };
        return updated;
      }

      if (newValue === null || (typeof newValue === 'string' && newValue.trim() === '')) {
        console.log('Resetting line item to empty values');
        // Only reset if the current item is also empty, otherwise preserve existing data
        if (!currentItem.part_number && !currentItem.part_description && !currentItem.quantity && !currentItem.unit_cost) {
          updated[idx] = {
            ...currentItem,
            part_number: '',
            part_description: '',
            quantity: '',
            unit: UNIT_OPTIONS[0],
            unit_cost: '',
            line_amount: 0,
            quantity_to_order: 0,
          };
        } else {
          console.log('Preserving existing data despite empty input value');
          // Keep existing data unchanged
        }
      } else if (typeof newValue !== 'string' && newValue.isNew) {
        console.log('Opening part dialog for new part');
        setPartToAddIndex(idx);
        setOpenPartDialog(true);
      } else if (typeof newValue === 'string') {
        const inv = findInventory(newValue);
        console.log('Found inventory item:', inv);
        
        // Get the quantity to order for this part (check both exact match and case-insensitive)
        const quantityToOrder = aggregateQuantities[newValue] || 
                               aggregateQuantities[newValue.toUpperCase()] || 
                               aggregateQuantities[newValue.toLowerCase()] || 0;
        // Ensure quantityToOrder is a number
        const numericQuantityToOrder = typeof quantityToOrder === 'string' ? parseFloat(quantityToOrder) : quantityToOrder;
        console.log(`Quantity to order for ${newValue}:`, quantityToOrder, 'as number:', numericQuantityToOrder);
        console.log('Available aggregate quantities keys:', Object.keys(aggregateQuantities));
        console.log('Looking for part:', newValue, 'in aggregate quantities:', aggregateQuantities);
        
        if (inv) {
          // Preserve existing unit_cost if it's already been manually set
          // This allows users to override the default inventory cost with their own value
          const currentUnitCost = currentItem.unit_cost;
          const shouldUseInventoryCost = !currentUnitCost || currentUnitCost === '' || currentUnitCost === '0';
          
          updated[idx] = {
            ...currentItem,
            part_number: newValue,
            part_description: inv.part_description,
            unit: inv.unit,
            unit_cost: shouldUseInventoryCost ? String(inv.last_unit_cost) : currentUnitCost,
            quantity_to_order: numericQuantityToOrder,
          };
        } else {
          // If inventory item not found, preserve existing data but update part_number
          // This prevents resetting line items when inventory isn't loaded yet
          console.log('Inventory item not found, preserving existing data');
          updated[idx] = {
            ...currentItem,
            part_number: newValue,
            quantity_to_order: numericQuantityToOrder,
            // Keep existing part_description, unit, unit_cost, etc.
          };
        }
      }

      updated[idx].line_amount = calculateLineItemAmount(updated[idx]);
      console.log('Updated item after change:', updated[idx]);
      return updated;
    });
    
    // If a part was selected, refresh aggregate quantities to ensure we have the latest data
    if (typeof newValue === 'string' && newValue.trim() !== '') {
      fetchAggregateQuantities();
    }
  };

  const checkDuplicateBillNumber = async (billNumber: string, currentPurchaseId?: number): Promise<boolean> => {
    if (!billNumber || billNumber.trim() === '') {
      return false; // No duplicate if bill number is empty
    }

    try {
      const response = await api.get('/api/purchase-history/check-bill-number', {
        params: {
          bill_number: billNumber.trim(),
          exclude_purchase_id: currentPurchaseId
        }
      });
      return response.data.exists;
    } catch (error) {
      console.error('Error checking duplicate bill number:', error);
      return false; // Assume no duplicate on error
    }
  };

  const validate = (requireBillNumber = false, isClosing = false) => {
    let tempErrors: typeof errors = {};
    if (!vendor) {
      tempErrors.vendor = "Vendor is required.";
    }
    if (!date) {
      tempErrors.date = "Date is required.";
    }
    if (requireBillNumber && !billNumber.trim()) {
      tempErrors.billNumber = "Bill Number is required.";
    }

    // Convert lineItems to robust format for validation
    const robustLineItems: RobustLineItem[] = lineItems.map(item => ({
      part_number: item.part_number,
      part_description: item.part_description,
      quantity: parseNumericInput(item.quantity),
      unit: item.unit,
      unit_cost: parseNumericInput(item.unit_cost),
    }));

    // Use robust validation for line items
    const robustErrors = validatePurchaseOrder(robustLineItems, vendor, isClosing);
    // Only apply line item errors when there are items; allow zero items during creation
    if (robustErrors.lineItems && lineItems.length > 0) {
      tempErrors.lineItems = robustErrors.lineItems;
    }

    setErrors(tempErrors);
    return tempErrors;
  };

  const handleSave = async () => {
    const validationErrors = validate(false, false);
    if (Object.keys(validationErrors).length > 0) {
      toast.error('Please correct the errors before saving.');
      return;
    }

    // Check for duplicate bill number if bill number is provided
    if (billNumber && billNumber.trim()) {
      const isDuplicate = await checkDuplicateBillNumber(billNumber, purchaseOrder?.purchase_id);
      if (isDuplicate) {
        const proceed = window.confirm(
          `Warning: Bill number "${billNumber}" already exists in another purchase order. Do you want to proceed anyway?`
        );
        if (!proceed) {
          return;
        }
      }
    }

    try {
      if (isCreationMode) {
        // Create new purchase order
        const newPurchaseOrder = {
          vendor_id: vendor?.id,
          purchase_date: date?.toISOString(),
          bill_number: billNumber.trim(),
          lineItems: lineItems.map(item => ({
            part_number: item.part_number.trim(),
            part_description: item.part_description.trim(),
            unit: item.unit.trim(),
            quantity: parseFloat(String(item.quantity)),
            unit_cost: parseFloat(String(item.unit_cost)),
            line_amount: parseFloat(String(item.line_amount))
          })),
          status: 'Open',
          subtotal: subTotal,
          total_gst_amount: totalGSTAmount,
          total_amount: totalAmount,
          global_gst_rate: globalGstRate,
          company_id: user?.company_id,
          created_by: user?.id,
          // Include pickup fields
          pickup_time: purchaseOrder?.pickup_time || null,
          pickup_location: purchaseOrder?.pickup_location || null,
          pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
          pickup_phone: purchaseOrder?.pickup_phone || null,
          pickup_instructions: purchaseOrder?.pickup_instructions || null,
          pickup_notes: purchaseOrder?.pickup_notes || null,
          // Include order placement tracking fields
          order_placed: purchaseOrder?.order_placed || false,
          order_placed_at: purchaseOrder?.order_placed_at || null,
          order_placed_by: purchaseOrder?.order_placed_by || null,
          order_placed_method: purchaseOrder?.order_placed_method || null,
          vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
          vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
          vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
          pricing_updated: purchaseOrder?.pricing_updated || false,
          pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
          pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
          pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
          quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
          quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
          quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
          quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
          original_quantities: purchaseOrder?.original_quantities || null,
          adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
          vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
        };

        console.log('Creating new purchase order:', newPurchaseOrder);
        if ((window as any).__poCreateInFlight) {
          console.log('[PO] Skipping duplicate create (in flight)');
          return;
        }
        (window as any).__poCreateInFlight = true;
        const response = await api.post('/api/purchase-orders', newPurchaseOrder);
        
        toast.success('Purchase Order created successfully!');
        
        // Navigate to the newly created purchase order
        const newPurchaseId = response.data.purchase_id;
        (window as any).__unsavedGuardAllowNext = true;
        navigate(`/open-purchase-orders/${newPurchaseId}`);
      } else {
        // Update existing purchase order
        const updatedPurchaseOrder = {
          ...purchaseOrder,
          vendor_id: vendor?.id,
          purchase_date: date?.toISOString(),
          bill_number: billNumber.trim(),
          lineItems: lineItems.map(item => ({
            ...item,
            part_number: item.part_number.trim(),
            part_description: item.part_description.trim(),
            unit: item.unit.trim(),
            quantity: parseFloat(String(item.quantity)),
            unit_cost: parseFloat(String(item.unit_cost)),
            line_amount: parseFloat(String(item.line_amount))
          })),
          status: status,
          subtotal: subTotal,
          total_gst_amount: totalGSTAmount,
          total_amount: totalAmount,
          global_gst_rate: globalGstRate,
          gst_rate: globalGstRate,
          // Include pickup fields
          pickup_time: purchaseOrder?.pickup_time || null,
          pickup_location: purchaseOrder?.pickup_location || null,
          pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
          pickup_phone: purchaseOrder?.pickup_phone || null,
          pickup_instructions: purchaseOrder?.pickup_instructions || null,
          pickup_notes: purchaseOrder?.pickup_notes || null,
          // Include order placement tracking fields
          order_placed: purchaseOrder?.order_placed || false,
          order_placed_at: purchaseOrder?.order_placed_at || null,
          order_placed_by: purchaseOrder?.order_placed_by || null,
          order_placed_method: purchaseOrder?.order_placed_method || null,
          vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
          vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
          vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
          pricing_updated: purchaseOrder?.pricing_updated || false,
          pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
          pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
          pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
          quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
          quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
          quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
          quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
          original_quantities: purchaseOrder?.original_quantities || null,
          adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
          vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
        };

        console.log('Sending to backend (handleSave):', updatedPurchaseOrder);
        const response = await api.put(`/api/purchase-orders/${id}`, updatedPurchaseOrder);
        setSuccess('Purchase Order updated successfully!');
        setInitialSignature(JSON.stringify({ 
          vendor, 
          billNumber, 
          date, 
          lineItems,
          pickup_time: purchaseOrder?.pickup_time,
          pickup_location: purchaseOrder?.pickup_location,
          pickup_contact_person: purchaseOrder?.pickup_contact_person,
          pickup_phone: purchaseOrder?.pickup_phone,
          pickup_instructions: purchaseOrder?.pickup_instructions,
          pickup_notes: purchaseOrder?.pickup_notes,
          // Order placement tracking fields
          order_placed: purchaseOrder?.order_placed,
          order_placed_at: purchaseOrder?.order_placed_at,
          order_placed_by: purchaseOrder?.order_placed_by,
          order_placed_method: purchaseOrder?.order_placed_method,
          vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status,
          vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes,
          vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date,
          pricing_updated: purchaseOrder?.pricing_updated,
          pricing_updated_at: purchaseOrder?.pricing_updated_at,
          pricing_updated_by: purchaseOrder?.pricing_updated_by,
          pricing_updated_method: purchaseOrder?.pricing_updated_method,
          quantity_adjusted: purchaseOrder?.quantity_adjusted,
          quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at,
          quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by,
          quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method,
          original_quantities: purchaseOrder?.original_quantities,
          adjusted_quantities: purchaseOrder?.adjusted_quantities,
          vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes
        }));
      }
    } catch (error) {
      console.error('Error saving Purchase Order:', error);
      if (error instanceof AxiosError && error.response?.data?.error) {
        toast.error(`Error saving Purchase Order: ${error.response.data.error}`);
      } else {
        toast.error('Error saving Purchase Order. Please try again.');
      }
    } finally {
      (window as any).__poCreateInFlight = false;
    }
  };

  const handleExportToQBO = async () => {
    if (!purchaseOrder?.purchase_id) {
      toast.error('Purchase order not loaded. Cannot export.');
      return;
    }

    if (purchaseOrder.status !== 'Closed') {
      toast.error('Only closed purchase orders can be exported to QuickBooks.');
      return;
    }

    if (purchaseOrder.exported_to_qbo) {
      toast.error('Purchase order has already been exported to QuickBooks.');
      return;
    }

    setExportLoading(true);
    try {
      const response = await api.post(`/api/purchase-orders/${purchaseOrder.purchase_id}/export-to-qbo`);
      toast.success('Exported to QuickBooks successfully!');
      setPurchaseOrder(prev => prev ? { ...prev, exported_to_qbo: true } : prev);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || 'Failed to export to QuickBooks.';
      toast.error(errorMessage);
    } finally {
      setExportLoading(false);
    }
  };

  const handleReopenPO = async () => {
    if (!purchaseOrder?.purchase_id) {
      toast.error('Purchase order not loaded. Cannot reopen.');
      return;
    }

    if (window.confirm('Are you sure you want to reopen this purchase order?')) {
      try {
        const updatedPurchaseOrder = {
          ...purchaseOrder,
          vendor_id: vendor?.id,
          purchase_date: date?.toISOString(),
          bill_number: billNumber.trim(),
          lineItems: lineItems.map(item => ({
            ...item,
            part_number: item.part_number.trim(),
            part_description: item.part_description.trim(),
            unit: item.unit.trim(),
            quantity: parseFloat(String(item.quantity)),
            unit_cost: parseFloat(String(item.unit_cost)),
            line_amount: parseFloat(String(item.line_amount))
          })),
          status: 'Open',
          subtotal: subTotal,
          total_gst_amount: totalGSTAmount,
          total_amount: totalAmount,
          global_gst_rate: globalGstRate,
          gst_rate: globalGstRate,
          // Include pickup fields
          pickup_time: purchaseOrder?.pickup_time || null,
          pickup_location: purchaseOrder?.pickup_location || null,
          pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
          pickup_phone: purchaseOrder?.pickup_phone || null,
          pickup_instructions: purchaseOrder?.pickup_instructions || null,
          pickup_notes: purchaseOrder?.pickup_notes || null,
          // Include order placement tracking fields
          order_placed: purchaseOrder?.order_placed || false,
          order_placed_at: purchaseOrder?.order_placed_at || null,
          order_placed_by: purchaseOrder?.order_placed_by || null,
          order_placed_method: purchaseOrder?.order_placed_method || null,
          vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
          vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
          vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
          pricing_updated: purchaseOrder?.pricing_updated || false,
          pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
          pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
          pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
          quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
          quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
          quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
          quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
          original_quantities: purchaseOrder?.original_quantities || null,
          adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
          vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
        };

        await api.put(`/api/purchase-orders/${purchaseOrder.purchase_id}`, updatedPurchaseOrder);
        
        toast.success('Purchase Order reopened successfully!');
        // Update local state to reflect the open status
        setPurchaseOrder(prev => prev ? { ...prev, status: 'Open' } : prev);
        setStatus('Open');
        navigate(`/open-purchase-orders/${purchaseOrder.purchase_id}`);
      } catch (error) {
        console.error('Error reopening purchase order:', error);
        if (error instanceof AxiosError && error.response?.data?.error) {
          // Handle backend validation errors
          const errorMessage = error.response.data.error;
          if (errorMessage.toLowerCase().includes('negative quantity') || 
              errorMessage.toLowerCase().includes('insufficient inventory') ||
              errorMessage.toLowerCase().includes('inventory constraint')) {
            toast.error(`Cannot reopen: ${errorMessage}`);
          } else {
            toast.error(`Error reopening PO: ${errorMessage}`);
          }
        } else {
          toast.error('Failed to reopen purchase order. Please try again.');
        }
      }
    }
  };

  const handleClosePurchaseOrder = async () => {
    if (!purchaseOrder?.purchase_id) return;

    // Close the purchase order directly without showing allocation popup
    await closePurchaseOrderDirectly();
  };

  const closePurchaseOrderDirectly = async () => {
    if (!purchaseOrder?.purchase_id) return;

    const validationErrors = validate(true, true);
    if (Object.keys(validationErrors).length > 0) {
      const hasUnitCostError = validationErrors.lineItems?.some(item => item.unit_cost);
      if (hasUnitCostError) {
        toast.error('Unit cost is required for all line items before closing a purchase order.');
      } else {
        setShowBillNumberAlert(true);
        toast.error('A bill number is required to close the purchase order.');
      }
      return;
    }

    // Check for duplicate bill number
    const isDuplicate = await checkDuplicateBillNumber(billNumber, purchaseOrder.purchase_id);
    if (isDuplicate) {
      const proceed = window.confirm(
        `Warning: Bill number "${billNumber}" already exists in another purchase order. Do you want to proceed with closing this purchase order anyway?`
      );
      if (!proceed) {
        return;
      }
    }

    try {
      // Include the current line items with updated unit costs when closing the PO
      const updatedPOData = {
        ...purchaseOrder,
        vendor_id: vendor?.id,
        purchase_date: date?.toISOString(),
        bill_number: billNumber.trim(),
        lineItems: lineItems.map(item => ({
          ...item,
          part_number: item.part_number.trim(),
          part_description: item.part_description.trim(),
          unit: item.unit.trim(),
          quantity: parseFloat(String(item.quantity)),
          unit_cost: parseFloat(String(item.unit_cost)),
          line_amount: parseFloat(String(item.line_amount))
        })),
        status: 'Closed',
        subtotal: subTotal,
        total_gst_amount: totalGSTAmount,
        total_amount: totalAmount,
        global_gst_rate: globalGstRate,
        gst_rate: globalGstRate,
        // Include pickup fields
        pickup_time: purchaseOrder?.pickup_time || null,
        pickup_location: purchaseOrder?.pickup_location || null,
        pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
        pickup_phone: purchaseOrder?.pickup_phone || null,
        pickup_instructions: purchaseOrder?.pickup_instructions || null,
        pickup_notes: purchaseOrder?.pickup_notes || null,
        // Include order placement tracking fields
        order_placed: purchaseOrder?.order_placed || false,
        order_placed_at: purchaseOrder?.order_placed_at || null,
        order_placed_by: purchaseOrder?.order_placed_by || null,
        order_placed_method: purchaseOrder?.order_placed_method || null,
        vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
        vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
        vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
        pricing_updated: purchaseOrder?.pricing_updated || false,
        pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
        pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
        pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
        quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
        quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
        quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
        quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
        original_quantities: purchaseOrder?.original_quantities || null,
        adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
        vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
      };

      const response = await api.put(`/api/purchase-orders/${purchaseOrder.purchase_id}`, updatedPOData);

      if (response.status === 200) {
        console.log('Purchase Order closed:', response.data);
        toast.success('Purchase Order closed successfully!');
        // Update local state to reflect the closed status
        setPurchaseOrder(prev => prev ? { ...prev, status: 'Closed' } : prev);
        setStatus('Closed');
        // Navigate to the detail view of the closed purchase order
        navigate(`/open-purchase-orders/${purchaseOrder.purchase_id}`);
      } else {
        toast.error('Failed to close purchase order');
      }
    } catch (error) {
      console.error('Error closing purchase order:', error);
      if (error instanceof AxiosError && error.response?.data?.error) {
        // Handle backend validation errors
        const errorMessage = error.response.data.error;
        if (errorMessage.toLowerCase().includes('negative quantity') || 
            errorMessage.toLowerCase().includes('insufficient inventory') ||
            errorMessage.toLowerCase().includes('inventory constraint')) {
          toast.error(`Cannot close: ${errorMessage}`);
        } else {
          toast.error(`Error closing PO: ${errorMessage}`);
        }
      } else {
        toast.error('Failed to close purchase order. Please try again.');
      }
    }
  };

  const handleAllocationSuccess = () => {
    // Navigate to the detail view of the closed purchase order
    navigate(`/open-purchase-orders/${purchaseOrder?.purchase_id}`);
  };

  const handleAllocationSaved = () => {
    // Refresh the data to show updated allocation status
    fetchData();
    toast.success('Allocation changes saved successfully. Purchase order remains open.');
  };

  const handleOpenAllocationModal = async () => {
    // First save any current changes to the purchase order
    if (!validate(false)) {
      toast.error('Please correct the errors before proceeding with allocation.');
      return;
    }

    try {
      // Save the current state of the purchase order
      const updatedPurchaseOrder = {
        ...purchaseOrder,
        vendor_id: vendor?.id,
        purchase_date: date?.toISOString(),
        bill_number: billNumber.trim(),
        lineItems: lineItems.map(item => ({
          ...item,
          part_number: item.part_number.trim(),
          part_description: item.part_description.trim(),
          unit: item.unit.trim(),
          quantity: parseFloat(String(item.quantity)),
          unit_cost: parseFloat(String(item.unit_cost)),
          line_amount: parseFloat(String(item.line_amount))
        })),
        subtotal: subTotal,
        total_gst_amount: totalGSTAmount,
        total_amount: totalAmount,
        global_gst_rate: globalGstRate,
        gst_rate: globalGstRate,
        // Include pickup fields
        pickup_time: purchaseOrder?.pickup_time || null,
        pickup_location: purchaseOrder?.pickup_location || null,
        pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
        pickup_phone: purchaseOrder?.pickup_phone || null,
        pickup_instructions: purchaseOrder?.pickup_instructions || null,
        pickup_notes: purchaseOrder?.pickup_notes || null,
        // Include order placement tracking fields
        order_placed: purchaseOrder?.order_placed || false,
        order_placed_at: purchaseOrder?.order_placed_at || null,
        order_placed_by: purchaseOrder?.order_placed_by || null,
        order_placed_method: purchaseOrder?.order_placed_method || null,
        vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
        vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
        vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
        pricing_updated: purchaseOrder?.pricing_updated || false,
        pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
        pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
        pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
        quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
        quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
        quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
        quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
        original_quantities: purchaseOrder?.original_quantities || null,
        adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
        vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
      };

      await api.put(`/api/purchase-orders/${purchaseOrder.purchase_id}`, updatedPurchaseOrder);
      
      // Update local state with the saved data
      setPurchaseOrder(updatedPurchaseOrder);
      
      // Now open the allocation modal
      setIsAllocationModalOpen(true);
      
      toast.success('Changes saved successfully. Opening allocation modal...');
    } catch (error: any) {
      console.error('Error saving changes before allocation:', error);
      if (error instanceof AxiosError && error.response?.data?.error) {
        toast.error(`Error saving changes: ${error.response.data.error}`);
      } else {
        toast.error('Failed to save changes before allocation. Please try again.');
      }
    }
  };

  const handleDownloadPdf = async () => {
    if (!purchaseOrder?.purchase_id) {
      toast.error('Purchase order not loaded. Cannot download PDF.');
      return;
    }
    try {
      const response = await api.get(`/api/purchase-orders/${purchaseOrder.purchase_id}/pdf`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `purchase_order_${purchaseOrder.purchase_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF. Please try again.');
    }
  };

  const handleSaveAndDownloadPdf = async () => {
    // Save/update the purchase order first
    let hadError = false;
    await handleSave();
    // If there is an error, do not proceed
    // (handleSave already shows toast errors)
    // We can check for errors by inspecting the toast or by tracking a state, but for now, just proceed if no exception
    if (Object.keys(errors).length > 0) {
      hadError = true;
      return;
    }
    // Download PDF if save was successful
    await handleDownloadPdf();
  };

  // handleCallVendor removed per request

  const handleQuantityAdjustment = () => {
    if (!purchaseOrder) return;
    
    // Store original quantities before adjustment
    const originalQty = lineItems.map(item => item.quantity);
    
    // Show dialog to adjust quantities based on vendor confirmation
    const newQuantities = prompt(
      'Enter adjusted quantities (comma-separated, e.g., 50,100,25):\n' +
      'Current quantities: ' + originalQty.join(', ') + '\n' +
      'Note: Adjust based on vendor minimum orders (e.g., sold by 10ft packs)'
    );
    
    if (newQuantities) {
      try {
        const adjustedQty = newQuantities.split(',').map(q => parseFloat(q.trim()));
        
        if (adjustedQty.length !== lineItems.length) {
          toast.error('Number of quantities must match number of line items');
          return;
        }
        
        // Update line items with adjusted quantities
        setLineItems(prev => prev.map((item, idx) => ({
          ...item,
          quantity: adjustedQty[idx]
        })));
        
        // Update purchase order with adjustment tracking
        setPurchaseOrder(prev => prev ? {
          ...prev,
          quantity_adjusted: true,
          quantity_adjusted_at: new Date().toISOString(),
          quantity_adjusted_by: Number(user?.id),
          quantity_adjusted_method: 'manual',
          original_quantities: originalQty,
          adjusted_quantities: adjustedQty
        } : prev);
        
        toast.success('Quantities adjusted based on vendor confirmation');
      } catch (error) {
        toast.error('Invalid quantity format. Please use numbers separated by commas.');
      }
    }
  };

  // Add state for allocation modal
  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);

  // Add state for email modal
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [vendorEmail, setVendorEmail] = useState<string>('');
  const [exportLoading, setExportLoading] = useState(false);

  // Allocations modal state (read-only display for closed POs)
  const [isAllocationsModalOpen, setIsAllocationsModalOpen] = useState(false);
  const [allocations, setAllocations] = useState<Array<{ allocation_id: number; purchase_id: number; sales_order_id: number; part_number: string; part_description?: string; allocate_qty: number; created_at?: string }>>([]);
  const [allocationsLoading, setAllocationsLoading] = useState(false);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [salesOrderNumbers, setSalesOrderNumbers] = useState<Record<number, string>>({});

  const openAllocationsModal = async () => {
    if (!purchaseOrder?.purchase_id) return;
    setAllocationsLoading(true);
    setAllocationsError(null);
    try {
      const res = await api.get(`/api/purchase-history/${purchaseOrder.purchase_id}/allocations`);
      setAllocations(res.data || []);
      // Fetch sales order numbers for unique IDs
      const uniqueSoIds = Array.from(new Set((res.data || []).map((a: any) => a.sales_order_id).filter(Boolean)));
      if (uniqueSoIds.length > 0) {
        try {
          const results = await Promise.all(uniqueSoIds.map((soId: number) => api.get(`/api/sales-orders/${soId}`)));
          const map: Record<number, string> = {};
          results.forEach((resp: any, idx: number) => {
            const id = uniqueSoIds[idx];
            const number = resp.data?.salesOrder?.sales_order_number || resp.data?.salesOrder?.sales_number || '';
            if (number) map[id] = number;
          });
          setSalesOrderNumbers(map);
        } catch (subErr) {
          console.warn('Unable to fetch one or more sales order numbers:', subErr);
        }
      }
      setIsAllocationsModalOpen(true);
    } catch (e: any) {
      console.error('Error fetching allocations:', e);
      setAllocationsError('Failed to load allocations.');
      setIsAllocationsModalOpen(true);
    } finally {
      setAllocationsLoading(false);
    }
  };

  // Add state for new vendor modal fields
  const [isAddVendorModalOpen, setIsAddVendorModalOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorContact, setNewVendorContact] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorStreetAddress, setNewVendorStreetAddress] = useState('');
  const [newVendorCity, setNewVendorCity] = useState('');
  const [newVendorProvince, setNewVendorProvince] = useState('');
  const [newVendorCountry, setNewVendorCountry] = useState('');
  const [newVendorPostalCode, setNewVendorPostalCode] = useState('');
  const [newVendorWebsite, setNewVendorWebsite] = useState('');

  // Normalization and ranking helpers for vendor combobox
  const normalizeString = (value: string): string => {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  };

  const rankAndFilterVendors = (options: VendorOption[], query: string): VendorOption[] => {
    const q = normalizeString(query);
    if (!q) return options.slice(0, 8);
    const scored = options
      .map((opt) => {
        const labelNorm = normalizeString(opt.label);
        let score = -1;
        if (labelNorm.startsWith(q)) score = 3;
        else if (labelNorm.split(' ').some(w => w.startsWith(q))) score = 2;
        else if (labelNorm.includes(q)) score = 1;
        return { opt, score };
      })
      .filter((x) => x.score >= 0);
    scored.sort((a, b) => b.score - a.score || a.opt.label.localeCompare(b.opt.label));
    return scored.slice(0, 8).map((x) => x.opt);
  };

  const exactVendorMatch = (query: string): VendorOption | null => {
    const nq = normalizeString(query);
    return vendors.find((v) => normalizeString(v.label) === nq) || null;
  };

  // Parts combobox helpers
  const rankAndFilterParts = (options: string[], query: string): string[] => {
    const q = normalizeString(query);
    if (!q) return options.slice(0, 20); // show more for parts
    const scored = options
      .map((opt) => {
        const labelNorm = normalizeString(opt);
        let score = -1;
        if (labelNorm.startsWith(q)) score = 3;
        else if (labelNorm.split(' ').some(w => w.startsWith(q))) score = 2;
        else if (labelNorm.includes(q)) score = 1;
        return { opt, score };
      })
      .filter((x) => x.score >= 0);
    scored.sort((a, b) => b.score - a.score || a.opt.localeCompare(b.opt));
    return scored.slice(0, 20).map((x) => x.opt);
  };

  const exactPartMatch = (query: string): string | null => {
    const nq = normalizeString(query);
    const found = inventoryItems.find(inv => normalizeString(inv.part_number) === nq);
    return found ? found.part_number : null;
  };

  // Vendor key handler implementing Enter/Tab/Escape and Ctrl+Enter force-create
  const handleVendorKeyDown = (event: React.KeyboardEvent) => {
    const inputValue = vendorInput.trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) {
      setVendorOpen(false);
      return;
    }
    if (isArrow) {
      if (event.key === 'ArrowDown' && !vendorOpen) {
        setVendorOpen(true);
      }
      return;
    }

    if (isEnter || isTab) {
      if (isEnter && event.ctrlKey && inputValue) {
        event.preventDefault();
        setVendorEnterPressed(true);
        setNewVendorName(inputValue);
        setIsAddVendorModalOpen(true);
        setVendorOpen(false);
        return;
      }

      // When the list is open, respect the highlighted option.
      if (vendorOpen) {
        if (isEnter) {
          const opt = highlightedVendor as VendorOption | null;
          if (opt && (opt as any).isNew) {
            // Open the add-new modal only when the highlighted row is the special Add row
            event.preventDefault();
            setVendorEnterPressed(true);
            setNewVendorName(inputValue);
            setIsAddVendorModalOpen(true);
            setVendorOpen(false);
          }
          // Otherwise, allow Autocomplete to handle selecting the highlighted vendor
        }
        return;
      }

      const match = exactVendorMatch(inputValue);

      if (!inputValue) return;
      event.preventDefault();
      if (match) {
        setVendor(match);
        setVendorInput(match.label);
      } else {
        setVendorEnterPressed(true);
        setNewVendorName(inputValue);
        setIsAddVendorModalOpen(true);
        setVendorOpen(false);
      }
    }
  };

  // Part number key handler implementing Enter/Tab/Escape and Ctrl+Enter force-create
  const handlePartKeyDown = (idx: number, event: React.KeyboardEvent) => {
    const inputValue = (lineItems[idx]?.part_number || '').trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) {
      setPartOpenIndex(null);
      return;
    }
    if (isArrow) {
      if (event.key === 'ArrowDown' && partOpenIndex !== idx) {
        setPartOpenIndex(idx);
      }
      return;
    }

    // If the list is open for this row, let Autocomplete handle Enter/Tab selection of the highlighted option.
    if (partOpenIndex === idx && (isEnter || isTab)) {
      return; // do not preventDefault; allow native Autocomplete behavior
    }

    if (isEnter || isTab) {
      if (isEnter && event.ctrlKey && inputValue) {
        event.preventDefault();
        setPartEnterPressedIndex(idx);
        setPartNumberForModal(inputValue);
        setPartToAddIndex(idx);
        setOpenPartDialog(true);
        setPartOpenIndex(null);
        return;
      }

      const match = exactPartMatch(inputValue);
      if (!inputValue) return;
      event.preventDefault();
      if (match) {
        handlePartNumberChange(idx, match);
      } else {
        setPartEnterPressedIndex(idx);
        setPartNumberForModal(inputValue);
        setPartToAddIndex(idx);
        setOpenPartDialog(true);
        setPartOpenIndex(null);
      }
    }
  };

  const handleClosePartDialog = () => {
    setOpenPartDialog(false);
    setPartToAddIndex(null); // Ensure partToAddIndex is reset on close
  };

  // Function to get vendor email when vendor is selected
  const getVendorEmail = (vendorId: number): string => {
    const selectedVendor = vendors.find(v => v.id === vendorId);
    console.log('Getting vendor email for vendor ID:', vendorId);
    console.log('Selected vendor:', selectedVendor);
    console.log('Vendor email:', selectedVendor?.email);
    return selectedVendor?.email || '';
  };

  // Function to handle email button click
  const handleEmailClick = async () => {
    if (!vendor?.id) {
      toast.error('Please select a vendor first');
      return;
    }
    
    if (isCreationMode) {
      // Validate before creating
      if (!validate(false)) {
        toast.error('Please correct the errors before sending email.');
        return;
      }

      try {
        // Create new purchase order
        const newPurchaseOrder = {
          vendor_id: vendor?.id,
          purchase_date: date?.toISOString(),
          bill_number: billNumber.trim(),
          lineItems: lineItems.map(item => ({
            part_number: item.part_number.trim(),
            part_description: item.part_description.trim(),
            unit: item.unit.trim(),
            quantity: parseFloat(String(item.quantity)),
            unit_cost: parseFloat(String(item.unit_cost)),
            line_amount: parseFloat(String(item.line_amount))
          })),
          status: 'Open',
          subtotal: subTotal,
          total_gst_amount: totalGSTAmount,
          total_amount: totalAmount,
          global_gst_rate: globalGstRate,
          company_id: user?.company_id,
          created_by: user?.id,
          // Include pickup fields
          pickup_time: purchaseOrder?.pickup_time || null,
          pickup_location: purchaseOrder?.pickup_location || null,
          pickup_contact_person: purchaseOrder?.pickup_contact_person || null,
          pickup_phone: purchaseOrder?.pickup_phone || null,
          pickup_instructions: purchaseOrder?.pickup_instructions || null,
          pickup_notes: purchaseOrder?.pickup_notes || null,
          // Include order placement tracking fields
          order_placed: purchaseOrder?.order_placed || false,
          order_placed_at: purchaseOrder?.order_placed_at || null,
          order_placed_by: purchaseOrder?.order_placed_by || null,
          order_placed_method: purchaseOrder?.order_placed_method || null,
          vendor_confirmation_status: purchaseOrder?.vendor_confirmation_status || 'pending',
          vendor_confirmation_notes: purchaseOrder?.vendor_confirmation_notes || null,
          vendor_confirmation_date: purchaseOrder?.vendor_confirmation_date || null,
          pricing_updated: purchaseOrder?.pricing_updated || false,
          pricing_updated_at: purchaseOrder?.pricing_updated_at || null,
          pricing_updated_by: purchaseOrder?.pricing_updated_by || null,
          pricing_updated_method: purchaseOrder?.pricing_updated_method || null,
          quantity_adjusted: purchaseOrder?.quantity_adjusted || false,
          quantity_adjusted_at: purchaseOrder?.quantity_adjusted_at || null,
          quantity_adjusted_by: purchaseOrder?.quantity_adjusted_by || null,
          quantity_adjusted_method: purchaseOrder?.quantity_adjusted_method || null,
          original_quantities: purchaseOrder?.original_quantities || null,
          adjusted_quantities: purchaseOrder?.adjusted_quantities || null,
          vendor_pricing_notes: purchaseOrder?.vendor_pricing_notes || null
        };

        console.log('Creating new purchase order for email:', newPurchaseOrder);
        const response = await api.post('/api/purchase-orders', newPurchaseOrder);
        
        // Set state with the created purchase order
        const createdPO = response.data;
        setPurchaseOrder(createdPO);
        
        // Navigate to the newly created purchase order
        const newPurchaseId = createdPO.purchase_id;
        navigate(`/open-purchase-orders/${newPurchaseId}`);
        
        // Open email modal
    const email = getVendorEmail(vendor.id);
    setVendorEmail(email);
    setIsEmailModalOpen(true);
        
        toast.success('Purchase Order created and email modal opened!');
      } catch (error) {
        console.error('Error creating Purchase Order for email:', error);
        if (error instanceof AxiosError && error.response?.data?.error) {
          toast.error(`Error creating Purchase Order: ${error.response.data.error}`);
        } else {
          toast.error('Error creating Purchase Order. Please try again.');
        }
      }
    } else {
      // Edit mode - just open email modal
    const email = getVendorEmail(vendor.id);
      console.log('Email button clicked - vendor ID:', vendor.id);
      console.log('Retrieved email:', email);
    setVendorEmail(email);
    setIsEmailModalOpen(true);
    }
  };

  // Debug effect for part modal
  useEffect(() => {
    console.log('Part modal state changed - openPartDialog:', openPartDialog, 'partNumberForModal:', partNumberForModal, 'partToAddIndex:', partToAddIndex);
  }, [openPartDialog, partNumberForModal, partToAddIndex]);

  // Ensure part dropdown closes when the Add New Part dialog opens
  useEffect(() => {
    if (openPartDialog) {
      setPartOpenIndex(null);
    }
  }, [openPartDialog]);

  // Update vendorEmail when vendor changes
  useEffect(() => {
    if (vendor?.id) {
      const email = getVendorEmail(vendor.id);
      console.log('Vendor changed - updating email:', email);
      setVendorEmail(email);
    } else {
      setVendorEmail('');
    }
  }, [vendor, vendors]);

  // ---------- Closed read-only view ----------
  const renderReadOnly = () => {
    if (!purchaseOrder) return null;
    const all = lineItems || [];
    let sub = all.reduce((s, i) => s + (Number(i.line_amount) || 0), 0);
    let gst = sub * (purchaseOrder.global_gst_rate || 5) / 100, tot = sub + gst;
    if (isNaN(sub)) sub = 0; if (isNaN(gst)) gst = 0; if (isNaN(tot)) tot = 0;
    
    return (
      <Box p={{ xs:2, md:4 }} maxWidth={1000} mx="auto">
        <Typography variant="h4" gutterBottom>
          Purchase Order Details
        </Typography>
        <Card variant="outlined" sx={{ mb:3 }}>
          <CardContent>
            <Grid container spacing={{ xs:2, md:3 }}>
              <Grid item xs={12} sm={6}><b>Purchase Order #:</b> {purchaseOrder.purchase_number}</Grid>
              <Grid item xs={12} sm={6}><b>Vendor:</b> {purchaseOrder.vendor_name || 'N/A'}</Grid>
              <Grid item xs={12} sm={6}><b>Purchase Date:</b> {purchaseOrder.purchase_date ? new Date(purchaseOrder.purchase_date).toLocaleDateString() : ''}</Grid>
              <Grid item xs={12} sm={6}><b>Status:</b> {purchaseOrder.status?.toUpperCase() || 'N/A'}</Grid>
              <Grid item xs={12} sm={6}><b>Bill Number:</b> {purchaseOrder.bill_number || 'N/A'}</Grid>
              <Grid item xs={12} sm={6}><b>GST Rate:</b> {(purchaseOrder.global_gst_rate || 5).toFixed(2)}%</Grid>
              <Grid item xs={12} sm={6}><b>QuickBooks Export:</b> {purchaseOrder.exported_to_qbo ? 'Exported' : purchaseOrder.qbo_export_status ? `Error: ${purchaseOrder.qbo_export_status}` : 'Not Exported'}</Grid>
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
                <Grid item xs={4} sm={2} md={1.5}>{formatCurrency(Number(it.unit_cost) || 0)}</Grid>
                <Grid item xs={4} sm={2} md={1}>{formatCurrency(Number(it.line_amount) || 0)}</Grid>
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
          <Button variant="contained" color="primary" startIcon={<DownloadIcon />} onClick={handleSaveAndDownloadPdf}>Download PDF</Button>
          
          {/* QuickBooks Export Button - Admin users get full functionality */} 
          {!purchaseOrder?.exported_to_qbo && user?.access_role === 'Admin' && (
            <Button 
              variant="contained" 
              color="success" 
              startIcon={<CloudUploadIcon />} 
              onClick={handleExportToQBO}
              disabled={exportLoading}
            >
              {exportLoading ? 'Exporting...' : 'Export to QuickBooks'}
            </Button>
          )} 
          
          {/* Reopen PO button - for admin and purchase/sales users */} 
          {(user?.access_role === 'Admin' || user?.access_role === 'Sales and Purchase') && (
            <Button variant="contained" color="primary" onClick={handleReopenPO}>Reopen PO</Button>
          )}
          {/* View Allocations (read-only) */}
          <Button variant="outlined" color="primary" onClick={openAllocationsModal}>View Allocations</Button>
        </Box>
        {/* Allocations Modal (read-only) */}
        <Dialog open={isAllocationsModalOpen} onClose={() => setIsAllocationsModalOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>Allocations</DialogTitle>
          <DialogContent dividers>
            {allocationsLoading && (
              <Box display="flex" justifyContent="center" alignItems="center" py={4}>
                <CircularProgress />
              </Box>
            )}
            {!allocationsLoading && allocationsError && (
              <Alert severity="error">{allocationsError}</Alert>
            )}
            {!allocationsLoading && !allocationsError && (
              (() => {
                if (!allocations || allocations.length === 0) {
                  return <Typography variant="body2">No allocations were saved for this purchase order.</Typography>;
                }
                // Group by part number
                const grouped = allocations.reduce((acc: Record<string, typeof allocations>, a) => {
                  const key = (a.part_number || '').toString();
                  if (!acc[key]) acc[key] = [] as any;
                  acc[key].push(a);
                  return acc;
                }, {} as Record<string, typeof allocations>);
                const partNumbers = Object.keys(grouped).sort();
                return (
                  <Stack spacing={3}>
                    {partNumbers.map((pn) => {
                      const rows = grouped[pn];
                      const description = rows.find(r => r.part_description)?.part_description || '';
                      const totalAllocated = rows.reduce((s, r) => s + (Number(r.allocate_qty) || 0), 0);
                      return (
                        <Box key={pn}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                            {pn} {description ? `- ${description}` : ''}
                          </Typography>
                          <TableContainer component={Paper} sx={{ mt: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Sales Order</TableCell>
                                  <TableCell>Sales Order Number</TableCell>
                                  <TableCell align="right">Allocated Qty</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {rows.map(r => (
                                  <TableRow key={r.allocation_id}>
                                    <TableCell>#{r.sales_order_id}</TableCell>
                                    <TableCell>{salesOrderNumbers[r.sales_order_id] ? `SO-${salesOrderNumbers[r.sales_order_id]}` : '-'}</TableCell>
                                    <TableCell align="right">{Number(r.allocate_qty || 0).toFixed(2)}</TableCell>
                                  </TableRow>
                                ))}
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600 }}>{totalAllocated.toFixed(2)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      );
                    })}
                  </Stack>
                );
              })()
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsAllocationsModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  };

  // Show loading state only if we're not in creation mode and purchaseOrder is null
  if (!isCreationMode && !purchaseOrder) {
    return (
      <Box p={4}>
        <Typography variant="h5">Loading Purchase Order...</Typography>
      </Box>
    );
  }

  // Show loading state if we're still in initial load
  if (isInitialLoad) {
    return (
      <Box p={4}>
        <Typography variant="h5">Loading...</Typography>
      </Box>
    );
  }

  // Show read-only view for closed purchase orders (all users)
  if (!isCreationMode && status === 'Closed') {
    return renderReadOnly();
  }

  return (
    <>
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <UnsavedChangesGuard when={isDirty} onSave={handleSave} />
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                {isCreationMode ? 'Create New Purchase Order' : `Edit Purchase Order: ${purchaseOrder?.purchase_number}`}
              </Typography>
              {!isCreationMode && purchaseOrder && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                  <Chip
                    label={purchaseOrder.order_placed ? 'Order Placed' : 'Order Not Placed'}
                    color={purchaseOrder.order_placed ? 'success' : 'warning'}
                    variant="outlined"
                    size="small"
                  />
                  <Chip
                    label={`Vendor: ${purchaseOrder.vendor_confirmation_status || 'pending'}`}
                    color={
                      purchaseOrder.vendor_confirmation_status === 'confirmed' ? 'success' :
                      purchaseOrder.vendor_confirmation_status === 'partial' ? 'warning' :
                      purchaseOrder.vendor_confirmation_status === 'unavailable' ? 'error' : 'default'
                    }
                    variant="outlined"
                    size="small"
                  />
                  {purchaseOrder.pricing_updated && (
                    <Chip
                      label="Pricing Updated"
                      color="info"
                      variant="outlined"
                      size="small"
                    />
                  )}
                  {purchaseOrder.quantity_adjusted && (
                    <Chip
                      label="Quantities Adjusted"
                      color="secondary"
                      variant="outlined"
                      size="small"
                    />
                  )}
                </Box>
              )}
            </Box>
            <Stack direction="row" spacing={1}> 
              <Button variant="contained" color="primary" onClick={handleSave} startIcon={<SaveIcon />}>
                {isCreationMode ? 'Create Purchase Order' : 'Save Changes'}
              </Button>
              {!isCreationMode && (
                <>
                  <Button variant="contained" color="primary" onClick={handleClosePurchaseOrder} startIcon={<DoneAllIcon />}>Close PO</Button>
                  <Button variant="contained" color="primary" onClick={handleSaveAndDownloadPdf} startIcon={<DownloadIcon />}>Download PDF</Button>
                  <Button variant="contained" onClick={handleEmailClick} startIcon={<EmailIcon />} sx={{ backgroundColor: '#ff9800', '&:hover': { backgroundColor: '#f57c00' } }}>Email Vendor</Button>
                </>
              )}
            </Stack>
          </Box>

          {/* Bill Number Alert Banner */} 
          {showBillNumberAlert && (
            <Alert 
              severity="warning" 
              sx={{ mb: 3 }}
              onClose={() => setShowBillNumberAlert(false)}
            >
              <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                Bill Number Required
              </Typography>
              <Typography variant="body2">
                A bill number is required to close this purchase order. Please enter a bill number before closing.
              </Typography>
            </Alert>
          )}

          <Paper sx={{ p: 3 }}>
            <Grid container spacing={3}> 
              {/* Purchase Order fields: Vendor, Bill Number, GST Rate */} 
              <Grid item xs={12} sm={4}> 
                <Autocomplete<VendorOption, false, false, true>
                  disablePortal={false}
                  open={vendorOpen}
                  onOpen={() => setVendorOpen(true)}
                  onClose={() => setVendorOpen(false)}
                  autoHighlight
                  value={vendor}
                  onChange={(_, newValue) => {
                    if (vendorEnterPressed) {
                      setVendorEnterPressed(false);
                      return;
                    }
                    if (newValue && (newValue as VendorOption).isNew) {
                      setIsAddVendorModalOpen(true);
                      setNewVendorName(vendorInput);
                      setVendor(null);
                      setVendorInput('');
                    setVendorOpen(false);
                    } else {
                      setVendor(newValue as VendorOption);
                      setVendorOpen(false);
                    }
                  }}
                  filterOptions={(options, params) => {
                    const ranked = rankAndFilterVendors(options, params.inputValue || '');
                    const hasExact = !!exactVendorMatch(params.inputValue || '');
                    const result: any[] = [...ranked];
                    if ((params.inputValue || '').trim() !== '' && !hasExact) {
                      result.push({
                        label: `Add "${params.inputValue}" as New Vendor`,
                        isNew: true,
                      });
                    }
                    if (ranked.length === 0 && (params.inputValue || '').trim() !== '' && !hasExact) {
                      return result;
                    }
                    return result;
                  }}
                  inputValue={vendorInput}
                  onInputChange={(_, newInputValue, reason) => {
                    setVendorInput(newInputValue);
                    if (reason === 'reset') return;
                    const text = (newInputValue || '').trim();
                    if (!text) setVendorOpen(false);
                  }}
                  options={vendors}
                  getOptionLabel={option => typeof option === 'string' ? option : option.label}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  onHighlightChange={(_, opt) => setHighlightedVendor(opt as VendorOption)}
                  ListboxProps={{ role: 'listbox', style: { maxHeight: 320, overflowY: 'auto' } }}
                  renderOption={(props, option) => {
                    const isNew = (option as VendorOption).isNew;
                    const { key, ...otherProps } = props;
                    return (
                      <li key={key} {...otherProps} style={{ display: 'flex', alignItems: 'center', opacity: isNew ? 0.9 : 1 }}>
                        {isNew && <AddCircleOutlineIcon fontSize="small" style={{ marginRight: 8, color: '#666' }} />}
                        <span>{(option as VendorOption).label}</span>
                      </li>
                    );
                  }}
                  renderInput={params => (
                    <TextField 
                      {...params} 
                      label="Vendor" 
                      error={!!errors.vendor} 
                      helperText={errors.vendor}
                      onKeyDown={handleVendorKeyDown}
                      onBlur={() => {
                        setVendorOpen(false);
                        if (!vendor) {
                          const inputValue = vendorInput.trim();
                          if (inputValue) {
                            const match = exactVendorMatch(inputValue);
                            if (match) {
                              setVendor(match);
                              setVendorInput(match.label);
                            }
                          }
                        }
                      }}
                      inputRef={(el) => { vendorInputRef.current = el; }}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={4}> 
                <TextField
                  label="Bill Number"
                  value={billNumber}
                  onChange={(e) => {
                    setBillNumber(e.target.value);
                    if (e.target.value.trim() !== '') {
                      setShowBillNumberAlert(false);
                    }
                  }}
                  fullWidth
                  error={!!errors.billNumber}
                  helperText={errors.billNumber}
                />
              </Grid>
              <Grid item xs={12} sm={4}> 
                <TextField
                  label="GST Rate (%)"
                  type="number"
                  value={globalGstRate}
                  onChange={e => setGlobalGstRate(Number(e.target.value))}
                  fullWidth
                  inputProps={{ 
                    min: 0, 
                    max: 100, 
                    step: '0.01',
                    readOnly: status === 'Closed',
                    onWheel: (e) => e.currentTarget.blur()
                  }}
                  helperText="Change GST rate if needed (default 5%). This will affect GST and total calculations."
                  disabled={status === 'Closed'}
                />
              </Grid>
            </Grid>
          </Paper>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, mb: 2 }}>
            <Typography variant="h6">Line Items</Typography>
            <Button
  variant="contained"
  onClick={handleOpenAllocationModal}
  startIcon={<DoneAllIcon />}
  sx={{
    backgroundColor: isCreationMode ? '#e0e0e0' : '#ff9800',
    color: '#fff',
    '&:hover': { backgroundColor: isCreationMode ? '#e0e0e0' : '#f57c00' },
    '&.Mui-disabled': { color: '#fff' } // keep text white when disabled
  }}
  disabled={isCreationMode}
>  Allocate Parts
            </Button>
          </Box>
          <Paper sx={{ p: 3, mb: 3, mt: 0 }} elevation={3}>
            <Grid container spacing={2}> 
              {lineItems.map((item, idx) => (
                <React.Fragment key={idx}> 
                  <Grid item xs={12} sm={6} md={3}> 
                    <Autocomplete<PartOption, false, false, true>
                      disablePortal={false}
                      open={partOpenIndex === idx}
                      onOpen={() => setPartOpenIndex(idx)}
                      onClose={() => setPartOpenIndex(null)}
                      autoHighlight
                      value={item.part_number}
                      inputValue={partInputs[idx] ?? item.part_number}
                      onInputChange={(_, newInputValue, reason) => {
                        setPartInputs(prev => ({ ...prev, [idx]: newInputValue }));
                        if (reason === 'reset') return;
                        const text = (newInputValue || '').trim();
                        if (!text) setPartOpenIndex(null);
                      }}
                      onChange={(_, newValue) => {
                        if (typeof newValue === 'string') {
                          const selected = newValue;
                          // Update both UI state and calc state immediately
                          const inv = inventoryItems.find(inv => inv.part_number === selected);
                          const quantityToOrder = aggregateQuantities[selected] || 
                                                  aggregateQuantities[selected?.toUpperCase?.() || ''] || 
                                                  aggregateQuantities[selected?.toLowerCase?.() || ''] || 0;
                          const numericQto = typeof quantityToOrder === 'string' ? parseFloat(quantityToOrder) : quantityToOrder;
                          setLineItems(prev => {
                            const updated = [...prev];
                            const current = updated[idx];
                             if (inv) {
                              const currentUnitCost = (current as any).unit_cost;
                              const shouldUseInventoryCost = !currentUnitCost || currentUnitCost === '' || currentUnitCost === '0';
                              const unitCost = shouldUseInventoryCost ? String(inv.last_unit_cost) : String(currentUnitCost);
                              const item = {
                                ...current,
                                 part_number: selected,
                                part_description: inv.part_description,
                                unit: inv.unit,
                                unit_cost: unitCost,
                                quantity_to_order: numericQto,
                              } as any;
                              item.line_amount = calculateLineItemAmount(item);
                               updated[idx] = item;
                               // Ensure vendor mappings loaded and swap PN if vendor selected
                               ensureVendorMappings(inv.part_number);
                               if (vendor?.id) {
                                 const chosen = (() => {
                                   const links = (vendorPartMap[inv.part_number.toUpperCase()] || []);
                                   if (links.length === 0) return null;
                                   const forVendor = links.filter(l => l.vendor_id === vendor.id);
                                   if (forVendor.length > 0) {
                                     const pref = forVendor.find(l => l.preferred);
                                     if (pref) return pref.vendor_part_number;
                                     const mu = [...forVendor].sort((a,b) => (b.usage_count||0)-(a.usage_count||0))[0];
                                     if (mu) return mu.vendor_part_number;
                                   }
                                   const prefAny = links.find(l => l.preferred);
                                   if (prefAny) return prefAny.vendor_part_number;
                                   const muAny = [...links].sort((a,b) => (b.usage_count||0)-(a.usage_count||0))[0];
                                   return muAny ? muAny.vendor_part_number : null;
                                 })();
                                 if (chosen) updated[idx].part_number = chosen;
                               }
                            } else {
                              updated[idx] = { ...current, part_number: selected } as any;
                            }
                            return updated;
                          });
                          handlePartNumberChange(idx, selected);
                          setPartOpenIndex(null);
                          setPartInputs(prev => ({ ...prev, [idx]: '' }));
                        } else if (newValue && typeof newValue === 'object' && 'isNew' in newValue) {
                          const inputValue = (newValue as any).inputValue || '';
                          setPartNumberForModal(inputValue);
                          setPartToAddIndex(idx);
                          setOpenPartDialog(true);
                          setPartOpenIndex(null);
                          setPartInputs(prev => ({ ...prev, [idx]: '' }));
                        }
                      }}
                      options={inventoryItems.map(inv => inv.part_number)}
                      freeSolo
                      selectOnFocus
                      clearOnBlur
                      handleHomeEndKeys
                      getOptionLabel={(option) => (typeof option === 'string' ? option : (option as any).label)}
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
                        const result: PartOption[] = [...filtered] as any;
                        if (text && !hasExact) {
                          result.push({ inputValue: params.inputValue, label: `Add "${params.inputValue}" as New Part`, isNew: true });
                        }
                        return result as any;
                      }}
                      ListboxProps={{ role: 'listbox', style: { maxHeight: 320, overflowY: 'auto' } }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Part Number"
                          fullWidth
                          required
                          error={!!errors.lineItems?.[idx]?.part_number}
                          helperText={errors.lineItems?.[idx]?.part_number}
                          onKeyDown={(e) => handlePartKeyDown(idx, e)}
                          onBlur={() => {
                            // Close dropdown and do not show "Add "" as New Part" on empty blur
                            setPartOpenIndex(null);
                            const raw = (lineItems[idx]?.part_number || '');
                            const inputValue = raw.trim();
                            if (!inputValue) return;
                            const match = exactPartMatch(inputValue);
                            if (match) {
                              // Mirror selection in both states so it persists
                              const inv = inventoryItems.find(inv => inv.part_number === match);
                              const quantityToOrder = aggregateQuantities[match] || 
                                                      aggregateQuantities[match?.toUpperCase?.() || ''] || 
                                                      aggregateQuantities[match?.toLowerCase?.() || ''] || 0;
                              const numericQto = typeof quantityToOrder === 'string' ? parseFloat(quantityToOrder) : quantityToOrder;
                              setLineItems(prev => {
                                const updated = [...prev];
                                const current = updated[idx];
                                if (inv) {
                                  const currentUnitCost = (current as any).unit_cost;
                                  const shouldUseInventoryCost = !currentUnitCost || currentUnitCost === '' || currentUnitCost === '0';
                                  const unitCost = shouldUseInventoryCost ? String(inv.last_unit_cost) : String(currentUnitCost);
                                  const item = {
                                    ...current,
                                    part_number: match,
                                    part_description: inv.part_description,
                                    unit: inv.unit,
                                    unit_cost: unitCost,
                                    quantity_to_order: numericQto,
                                  } as any;
                                  item.line_amount = calculateLineItemAmount(item);
                                  updated[idx] = item;
                                } else {
                                  updated[idx] = { ...current, part_number: match } as any;
                                }
                                return updated;
                              });
                              handlePartNumberChange(idx, match);
                            }
                          }}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}> 
                    <TextField
                      label="Part Description"
                      value={item.part_description}
                      InputProps={{ readOnly: true }}
                      fullWidth
                      error={!!errors.lineItems?.[idx]?.part_description}
                      helperText={errors.lineItems?.[idx]?.part_description}
                    />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1}> 
                    <TextField
                      label="Qty"
                      value={item.quantity}
                      onChange={(e) => handleLineItemChange(idx, 'quantity', e.target.value)}
                      type="number"
                      fullWidth
                      required
                      error={!!errors.lineItems?.[idx]?.quantity}
                      helperText={errors.lineItems?.[idx]?.quantity}
                      inputProps={{ 
                        step: "1",
                        onWheel: (e) => e.currentTarget.blur()
                      }}
                    />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1}> 
                    <TextField
                      label="Unit"
                      value={item.unit}
                      select
                      fullWidth
                      disabled
                      InputProps={{ readOnly: true }}
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  <Grid item xs={6} sm={3} md={1.5}> 
                    <TextField
                      label="Unit Cost"
                      value={item.unit_cost}
                      onChange={(e) => handleLineItemChange(idx, 'unit_cost', e.target.value)}
                      type="number"
                      fullWidth
                      error={!!errors.lineItems?.[idx]?.unit_cost}
                      helperText={errors.lineItems?.[idx]?.unit_cost}
                      inputProps={{ 
                        step: "0.01",
                        onWheel: (e) => e.currentTarget.blur()
                      }}
                    />
                  </Grid>
                  <Grid item xs={6} sm={3} md={1.5}> 
                    <TextField
                      label="Amount"
                      value={item.line_amount != null && !isNaN(Number(item.line_amount)) ? Number(item.line_amount).toFixed(2) : '0.00'}
                      InputProps={{ readOnly: true }}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={1} md={1} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                      variant="outlined"
                      color="primary"
                      onClick={() => handleRemoveLineItem(idx)}
                      sx={{ flexShrink: 0 }}
                    >
                      Remove
                    </Button>
                    {(() => {
                      // In creation mode, treat status as 'Open' for the purpose of showing quantity to order
                      const effectiveStatus = isCreationMode ? 'Open' : status;
                      const shouldShow = effectiveStatus === 'Open' && typeof item.quantity_to_order === 'number' && item.quantity_to_order > 0;
                      console.log(`Rendering Qty to Order for ${item.part_number}:`, {
                        status,
                        isCreationMode,
                        effectiveStatus,
                        quantity_to_order: item.quantity_to_order,
                        type: typeof item.quantity_to_order,
                        shouldShow
                      });
                      return shouldShow ? (
                        <TextField
                          label="Qty to Order"
                          value={item.quantity_to_order}
                          size="small"
                          InputProps={{ readOnly: true }}
                          sx={{ 
                            backgroundColor: '#fff3cd',
                            minWidth: '120px',
                            '& .MuiOutlinedInput-root': {
                              '& fieldset': {
                                borderColor: '#ffc107',
                              },
                              '&:hover fieldset': {
                                borderColor: '#ffc107',
                              },
                            },
                          }}
                        />
                      ) : null;
                    })()}
                  </Grid>
                </React.Fragment>
              ))}
            </Grid>
            <Box sx={{ mt: 2 }}>
              <Button variant="outlined" color="primary" onClick={handleAddLineItem}>Add Line Item</Button>
            </Box>
          </Paper>

          <Paper sx={{ p: 3, mb: 3 }} elevation={3}> 
            <Grid container spacing={2}> 
              <Grid item xs={12} sm={4}> 
                <Typography variant="subtitle1">Subtotal: ${subTotal != null && !isNaN(Number(subTotal)) ? Number(subTotal).toFixed(2) : '0.00'}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}> 
                <Typography variant="subtitle1">Total GST: ${totalGSTAmount != null && !isNaN(Number(totalGSTAmount)) ? Number(totalGSTAmount).toFixed(2) : '0.00'}</Typography>
              </Grid>
              <Grid item xs={12} sm={4}> 
                <Typography variant="h6">Total Amount: ${totalAmount != null && !isNaN(Number(totalAmount)) ? Number(totalAmount).toFixed(2) : '0.00'}</Typography>
              </Grid>
            </Grid>
          </Paper>

          {/* Pickup Details Section */} 
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, mb: 2 }}>
            <Typography variant="h6">Pickup Details for Drivers</Typography>
          </Box>
          <Paper sx={{ p: 3, mb: 3 }} elevation={3}> 
            <Grid container spacing={3}> 
              <Grid item xs={12} sm={6}> 
                <TextField
                  label="Pickup Time"
                  placeholder="e.g., tomorrow at 2 PM, Friday morning"
                  value={purchaseOrder?.pickup_time || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_time: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  helperText="When to pick up the order"
                />
              </Grid>
              <Grid item xs={12} sm={6}> 
                <TextField
                  label="Pickup Location"
                  placeholder="e.g., 123 Main St, Building A, Loading Dock"
                  value={purchaseOrder?.pickup_location || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_location: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  helperText="Where to pick up the order"
                />
              </Grid>
              <Grid item xs={12} sm={6}> 
                <TextField
                  label="Contact Person"
                  placeholder="e.g., John Smith, Warehouse Manager"
                  value={purchaseOrder?.pickup_contact_person || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_contact_person: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  helperText="Name of person to contact at pickup location"
                />
              </Grid>
              <Grid item xs={12} sm={6}> 
                <TextField
                  label="Contact Phone"
                  placeholder="e.g., (555) 123-4567"
                  value={purchaseOrder?.pickup_phone || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_phone: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  helperText="Phone number for pickup contact person"
                />
              </Grid>
              <Grid item xs={12}> 
                <TextField
                  label="Pickup Instructions"
                  placeholder="e.g., Use loading dock on east side, call 15 minutes before arrival, parking available in lot B"
                  value={purchaseOrder?.pickup_instructions || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_instructions: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  multiline
                  rows={3}
                  helperText="Special instructions for pickup (parking, loading dock, etc.)"
                />
              </Grid>
              <Grid item xs={12}> 
                <TextField
                  label="Pickup Notes"
                  placeholder="e.g., After-hours pickup available, bring ID, parts are in warehouse section C"
                  value={purchaseOrder?.pickup_notes || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        pickup_notes: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  multiline
                  rows={2}
                  helperText="General notes about pickup for drivers"
                />
              </Grid>
            </Grid>
          </Paper>

          {/* Order Placement Tracking Section */} 
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, mb: 2 }}>
            <Typography variant="h6">Order Placement Tracking</Typography>
          </Box>
          <Paper sx={{ p: 3, mb: 3 }} elevation={3}> 
            <Grid container spacing={3}> 
              {/* Order Placed Status */} 
              <Grid item xs={12} sm={6}> 
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input
                    type="checkbox"
                    checked={purchaseOrder?.order_placed || false}
                    onChange={(e) => {
                      if (purchaseOrder) {
                        setPurchaseOrder({
                          ...purchaseOrder,
                          order_placed: e.target.checked,
                          order_placed_at: e.target.checked ? new Date().toISOString() : undefined,
                          order_placed_by: e.target.checked ? Number(user?.id) : undefined,
                          order_placed_method: e.target.checked ? 'manual' : undefined
                        });
                      }
                    }}
                    style={{ transform: 'scale(1.5)' }}
                  />
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      Order Placed with Vendor
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {purchaseOrder?.order_placed ? 
                        `Placed on ${new Date(purchaseOrder.order_placed_at || '').toLocaleDateString()}` : 
                        'Order not yet placed'
                      }
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              
              {/* Vendor Confirmation Status */} 
              <Grid item xs={12} sm={6}> 
                <TextField
                  select
                  label="Vendor Confirmation Status"
                  value={purchaseOrder?.vendor_confirmation_status || 'pending'}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        vendor_confirmation_status: e.target.value,
                        vendor_confirmation_date: e.target.value !== 'pending' ? new Date().toISOString() : undefined
                      });
                    }
                  }}
                  fullWidth
                  helperText="Current vendor confirmation status"
                >
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="confirmed">Confirmed</MenuItem>
                  <MenuItem value="partial">Partially Available</MenuItem>
                  <MenuItem value="unavailable">Unavailable</MenuItem>
                </TextField>
              </Grid>

              {/* Vendor Confirmation Notes */} 
              <Grid item xs={12}> 
                <TextField
                  label="Vendor Confirmation Notes"
                  placeholder="e.g., Parts available, pricing confirmed, minimum order 10ft packs"
                  value={purchaseOrder?.vendor_confirmation_notes || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        vendor_confirmation_notes: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  multiline
                  rows={2}
                  helperText="Notes from vendor about order confirmation, availability, and pricing"
                />
              </Grid>

              {/* Pricing and Quantity Updates */} 
              <Grid item xs={12} sm={6}> 
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input
                    type="checkbox"
                    checked={purchaseOrder?.pricing_updated || false}
                    onChange={(e) => {
                      if (purchaseOrder) {
                        setPurchaseOrder({
                          ...purchaseOrder,
                          pricing_updated: e.target.checked,
                          pricing_updated_at: e.target.checked ? new Date().toISOString() : undefined,
                          pricing_updated_by: e.target.checked ? Number(user?.id) : undefined,
                          pricing_updated_method: e.target.checked ? 'manual' : undefined
                        });
                      }
                    }}
                    style={{ transform: 'scale(1.5)' }}
                  />
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      Pricing Updated
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {purchaseOrder?.pricing_updated ? 
                        `Updated on ${new Date(purchaseOrder.pricing_updated_at || '').toLocaleDateString()}` : 
                        'Pricing not yet updated'
                      }
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              <Grid item xs={12} sm={6}> 
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input
                    type="checkbox"
                    checked={purchaseOrder?.quantity_adjusted || false}
                    onChange={(e) => {
                      if (purchaseOrder) {
                        setPurchaseOrder({
                          ...purchaseOrder,
                          quantity_adjusted: e.target.checked,
                          quantity_adjusted_at: e.target.checked ? new Date().toISOString() : undefined,
                          quantity_adjusted_by: e.target.checked ? Number(user?.id) : undefined,
                          quantity_adjusted_method: e.target.checked ? 'manual' : undefined
                        });
                      }
                    }}
                    style={{ transform: 'scale(1.5)' }}
                  />
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      Quantities Adjusted
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {purchaseOrder?.quantity_adjusted ? 
                        `Adjusted on ${new Date(purchaseOrder.quantity_adjusted_at || '').toLocaleDateString()}` : 
                        'Quantities not yet adjusted'
                      }
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              {/* Vendor Pricing Notes */} 
              <Grid item xs={12}> 
                <TextField
                  label="Vendor Pricing Structure Notes"
                  placeholder="e.g., Sold by 10ft packs, minimum order 50ft, bulk pricing available over 100ft"
                  value={purchaseOrder?.vendor_pricing_notes || ''}
                  onChange={(e) => {
                    if (purchaseOrder) {
                      setPurchaseOrder({
                        ...purchaseOrder,
                        vendor_pricing_notes: e.target.value
                      });
                    }
                  }}
                  fullWidth
                  multiline
                  rows={2}
                  helperText="Notes about vendor pricing structure, minimum orders, and packaging units"
                />
              </Grid>

              {/* Quantity Adjustment Button */} 
              <Grid item xs={12}> 
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handleQuantityAdjustment}
                    disabled={!purchaseOrder || lineItems.length === 0}
                    sx={{ minWidth: '200px' }}
                  >
                    Adjust Quantities (Vendor Confirmation)
                  </Button>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 1 }}>
                  Use this when vendor confirms different quantities (e.g., sold by 10ft packs)
                </Typography>
              </Grid>

              {/* Original vs Adjusted Quantities Display */} 
              {(purchaseOrder?.original_quantities || purchaseOrder?.adjusted_quantities) && (
                <Grid item xs={12}> 
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2 }}>
                    Quantity Adjustments
                  </Typography>
                  <Grid container spacing={2}> 
                    {lineItems.map((item, idx) => {
                      const originalQty = purchaseOrder?.original_quantities?.[idx] || item.quantity;
                      const adjustedQty = purchaseOrder?.adjusted_quantities?.[idx] || item.quantity;
                      const hasAdjustment = originalQty !== adjustedQty;
                      
                      return hasAdjustment ? (
                        <Grid item xs={12} sm={6} key={idx}> 
                          <Paper sx={{ p: 2, backgroundColor: '#f5f5f5' }} elevation={1}> 
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                              {item.part_number}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Original: {originalQty} → Adjusted: {adjustedQty}
                            </Typography>
                          </Paper>
                        </Grid>
                      ) : null;
                    })}
                  </Grid>
                </Grid>
              )}
            </Grid>
          </Paper>

          <UnifiedPartDialog
            open={openPartDialog}
            onClose={() => {
              setOpenPartDialog(false);
              setPartToAddIndex(null);
              setPartNumberForModal('');
            }}
            onSave={async (partData: PartFormValues) => {
              try {
                const response = await api.post('/api/inventory', partData);
                console.log('New part added successfully:', response.data);
                
                // Update the inventory list and wait for it to complete
                const updatedInventory = await api.get('/api/inventory');
                setInventoryItems(updatedInventory.data);
                
                const addedPart = response.data.item;
                
                // Update the line item with the new part
                if (partToAddIndex !== null) {
                  setLineItems(prev => {
                    const updated = [...prev];
                    updated[partToAddIndex] = {
                      ...updated[partToAddIndex],
                      part_number: addedPart.part_number,
                      part_description: addedPart.part_description,
                      unit: addedPart.unit,
                      unit_cost: String(addedPart.last_unit_cost),
                      quantity: updated[partToAddIndex].quantity,
                    };
                    updated[partToAddIndex].line_amount = calculateLineItemAmount(updated[partToAddIndex]);
                    return updated;
                  });
                }
                setPartToAddIndex(null);
                setPartNumberForModal('');
              } catch (error) {
                throw error; // Let the dialog handle the error
              }
            }}
            title="Add New Part"
            initialPart={{ part_number: partNumberForModal.toUpperCase(), category: 'Uncategorized' }}
          />

          <UnifiedVendorDialog
            open={isAddVendorModalOpen}
            onClose={() => setIsAddVendorModalOpen(false)}
            onSave={async (vendor: VendorFormValues) => {
              try {
                const response = await api.post('/api/vendors', vendor);
                const newVendor = response.data.vendor;
                
                // Update vendors list
                setVendors(prev => [...prev, { label: newVendor.vendor_name, id: newVendor.vendor_id }]);
                
                // Set the new vendor as selected
                setVendor({ label: newVendor.vendor_name, id: newVendor.vendor_id });
                
                // If we're editing an existing purchase order, update the purchase order data
                if (!isCreationMode && purchaseOrder) {
                  setPurchaseOrder(prev => prev ? {
                    ...prev,
                    vendor_id: newVendor.vendor_id,
                    vendor_name: newVendor.vendor_name
                  } : prev);
                }
                
                setIsAddVendorModalOpen(false);
                toast.success('Vendor added successfully!');
              } catch (err) {
                toast.error('Failed to add vendor.');
              }
            }}
            initialVendor={{ vendor_name: newVendorName }}
            isEditMode={false}
          />

          <AllocationModal
            open={isAllocationModalOpen}
            onClose={() => setIsAllocationModalOpen(false)}
            purchaseOrderId={purchaseOrder?.purchase_id || 0}
            onSuccess={handleAllocationSuccess}
            onAllocationSaved={handleAllocationSaved}
          />

          <EmailModal
            open={isEmailModalOpen}
            onClose={() => setIsEmailModalOpen(false)}
            type="purchase-order"
            recordId={purchaseOrder?.purchase_id}
            defaultTo={vendorEmail}
            allowMessageEdit={true}
          />
          {/* Debug info */} 
          {isEmailModalOpen && (
            <div style={{ display: 'none' }}>
              Debug: vendorEmail = {vendorEmail}, vendor = {JSON.stringify(vendor)}
            </div>
          )}
        </Container>
      </LocalizationProvider>
      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
    </>
  );
};

export default OpenPurchaseOrderDetailPage;