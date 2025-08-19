// src/pages/SalesOrderLinesAndPTOPage.tsx
import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography, Box, TextField, Button, Container, Paper, Grid, Alert,
  CircularProgress, Snackbar, Autocomplete
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import { toast } from 'react-toastify';
import api from '../api/axios';
import UnifiedPartDialog, { PartFormValues } from '../components/UnifiedPartDialog';
import PartFinderDialog from '../components/PartFinderDialog';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import { calculateLineAmount, parseNumericInput, SalesOrderLineItem as RobustLineItem } from '../utils/salesOrderCalculations';
import { formatCurrency } from '../utils/formatters';

type PartOption = string | { label: string; isNew?: true; inputValue?: string };
const UNIT_OPTIONS = ['Each', 'cm', 'ft', 'kg', 'pcs', 'hr', 'L'];
const DEFAULT_GST_RATE = 5.0;

interface SalesOrderLineItem {
  line_item_id?: number;
  part_number: string;
  part_description: string;
  quantity: string;
  unit: string;
  unit_price: number;
  gst: number;
  line_amount: number;
}

interface SalesOrder {
  sales_order_id: number;
  sales_order_number: string;
  status: string;
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

const WokerSalesOrderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNumericId = !!id && /^\d+$/.test(id);

  console.log('WokerSalesOrderPage: Component rendered with id:', id, 'isNumericId:', isNumericId);

  // Add component lifecycle logging
  useEffect(() => {
    console.log('WokerSalesOrderPage: Component mounted');
    return () => {
      console.log('WokerSalesOrderPage: Component unmounted');
    };
  }, []);

  // core state
  const [salesOrder, setSalesOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // inventory / pricing helpers
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [marginSchedule, setMarginSchedule] = useState<any[]>([]);
  const [globalLabourRate, setGlobalLabourRate] = useState<number | null>(null);
  const [globalOverheadRate, setGlobalOverheadRate] = useState<number | null>(null);

  // line items + original snapshot for availability deltas
  const [lineItems, setLineItems] = useState<SalesOrderLineItem[]>([]);
  const [originalLineItems, setOriginalLineItems] = useState<SalesOrderLineItem[]>([]);

  // negative availability banners (and transfer)
  const [negativeAvailabilityItems, setNegativeAvailabilityItems] = useState<Array<{
    lineItemIndex: number; partNumber: string; partDescription: string; excessQuantity: number; unit: string;
  }>>([]);

  // parts to order
  const [partsToOrder, setPartsToOrder] = useState<PartsToOrderItem[]>([]);

  // Alert height and offset calculation for smooth page movement
  const alertsContainerRef = useRef<HTMLDivElement | null>(null);
  const previousAlertsHeightRef = useRef<number>(0);
  // Keep the viewport anchored on the line items by scrolling by the change in alert height
  useLayoutEffect(() => {
    const el = alertsContainerRef.current;
    const currentHeight = el ? el.getBoundingClientRect().height : 0;
    const delta = currentHeight - previousAlertsHeightRef.current;
    if (delta !== 0) {
      window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
      previousAlertsHeightRef.current = currentHeight;
    }
  }, [negativeAvailabilityItems.length]);

  // part autocompletes
  const [partOpenIndex, setPartOpenIndex] = useState<number | null>(null);
  const [ptoOpenIndex, setPtoOpenIndex] = useState<number | null>(null);
  const [partTypingTimer, setPartTypingTimer] = useState<number | null>(null);

  // add-new-part dialogs
  const [openPartDialogForLine, setOpenPartDialogForLine] = useState(false);
  const [linePartToAddIndex, setLinePartToAddIndex] = useState<number | null>(null);
  const [linePartNumberForModal, setLinePartNumberForModal] = useState('');
  const [openPartDialogForPTO, setOpenPartDialogForPTO] = useState(false);
  const [ptoPartToAddIndex, setPtoPartToAddIndex] = useState<number | null>(null);
  const [ptoPartNumberForModal, setPtoPartNumberForModal] = useState('');
  // Part finder dialog
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderContext, setFinderContext] = useState<'line' | 'pto'>('line');
  const [finderTargetIndex, setFinderTargetIndex] = useState<number>(0);

  // ---------- helpers ----------
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

  const calculateAvailableQuantity = (item: SalesOrderLineItem, idx: number) => {
    const inv = inventoryItems.find((x:any) => x.part_number.toLowerCase() === item.part_number.toLowerCase());
    if (!inv || inv.part_type === 'supply') return null;

    const onHand = parseFloat(inv.quantity_on_hand) || 0;
    
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

  // Helper function to determine if a line item is the last (bottom) one for its part
  const isLastLineItemForPart = (item: SalesOrderLineItem, idx: number) => {
    const samePartItems = lineItems
      .filter(li => li.part_number.toLowerCase() === item.part_number.toLowerCase());
    
    if (samePartItems.length <= 1) return true;
    
    // Find the last line item with the same part number (highest index)
    const lastIndexForPart = Math.max(...samePartItems.map((_, i) => 
      lineItems.findIndex(li => li.part_number.toLowerCase() === item.part_number.toLowerCase() && 
      lineItems.indexOf(li) === i)
    ));
    
    return idx === lastIndexForPart;
  };

  const robust: RobustLineItem[] = useMemo(() => (
    lineItems.map(li => ({
      part_number: li.part_number,
      part_description: li.part_description,
      quantity: parseNumericInput(li.quantity),
      unit: li.unit,
      unit_price: parseNumericInput(li.unit_price),
    }))
  ), [lineItems]);

  const subtotal = useMemo(
    () => robust.reduce((s, r) => s + calculateLineAmount(r.quantity, r.unit_price), 0),
    [robust]
  );
  const totalGSTAmount = useMemo(() => subtotal * (DEFAULT_GST_RATE / 100), [subtotal]);
  const totalAmount = useMemo(() => subtotal + totalGSTAmount, [subtotal, totalGSTAmount]);
  // Unsaved changes guard setup
  const [initialSignature, setInitialSignature] = useState<string>('');
  useEffect(() => {
    if (salesOrder) {
      setInitialSignature(JSON.stringify({ lineItems, partsToOrder }));
    }
  }, [salesOrder]);
  const isDirty = Boolean(initialSignature) && initialSignature !== JSON.stringify({ lineItems, partsToOrder });

  // ---------- fetches ----------
  useEffect(() => {
    (async () => {
      try {
        const [invRes, marginRes, labRes, ohRes] = await Promise.all([
          api.get('/api/inventory'),
          api.get('/api/margin-schedule'),
          api.get('/api/settings/labour-rate').catch(() => ({ data: { labour_rate: null } })),
          api.get('/api/settings/overhead-rate').catch(() => ({ data: { overhead_rate: null } })),
        ]);
        setInventoryItems(invRes.data);
        setMarginSchedule(marginRes.data);
        setGlobalLabourRate(labRes.data.labour_rate ?? null);
        setGlobalOverheadRate(ohRes.data.overhead_rate ?? null);
      } catch (e) {
        console.error('Prefetch failed', e);
      }
    })();
  }, []);

  useEffect(() => {
    console.log('WokerSalesOrderPage: useEffect triggered with id:', id, 'isNumericId:', isNumericId);
    if (!id || !isNumericId) {
      console.log('WokerSalesOrderPage: Invalid ID, setting error');
      setError('Invalid sales order ID.');
      setLoading(false);
      return;
    }
    (async () => {
      console.log('WokerSalesOrderPage: Fetching sales order data for ID:', id);
      setLoading(true);
      setError(null);
      try {
        console.log('WokerSalesOrderPage: Making API call to /api/sales-orders/${id}');
        const res = await api.get(`/api/sales-orders/${id}`);
        console.log('WokerSalesOrderPage: API response received:', res);
        console.log('WokerSalesOrderPage: API response data:', res.data);
        
        if (!res.data || !res.data.salesOrder) {
          console.error('WokerSalesOrderPage: No sales order data in response');
          setError('Invalid response format from server');
          setLoading(false);
          return;
        }
        
        const so = res.data.salesOrder as SalesOrder;
        console.log('WokerSalesOrderPage: Parsed sales order:', so);
        setSalesOrder({ sales_order_id: so.sales_order_id, sales_order_number: so.sales_order_number, status: so.status });

        // Load existing line items but filter out LABOUR, OVERHEAD, and SUPPLY
        const li = (res.data.lineItems || so?.['line_items'] || [])
          .filter((item: any) => !['LABOUR', 'OVERHEAD', 'SUPPLY'].includes(item.part_number?.toUpperCase()))
          .map((item: any) => ({
            line_item_id: item.line_item_id,
            part_number: item.part_number,
            part_description: item.part_description,
            unit: item.unit,
            unit_price: item.unit_price,
            line_amount: item.line_amount,
            quantity: String(item.quantity_sold ?? item.quantity ?? 0),
            gst: DEFAULT_GST_RATE,
          })) as SalesOrderLineItem[];
        
        console.log('WokerSalesOrderPage: Loaded line items (filtered):', li);
        setLineItems(li);
        setOriginalLineItems(li);

        // Load existing parts to order
        const pto = (res.data.partsToOrder || []).map((p: any) => ({
          sales_order_id: so.sales_order_id,
          part_number: p.part_number,
          part_description: p.part_description,
          quantity_to_order: String(p.quantity_needed ?? p.quantity_to_order ?? ''),
          unit: p.unit || 'Each',
          unit_price: Number(p.unit_price || 0),
          line_amount: Number(p.line_amount || 0),
        })) as PartsToOrderItem[];
        
        console.log('WokerSalesOrderPage: Loaded parts to order:', pto);
        setPartsToOrder(pto);
        console.log('WokerSalesOrderPage: Successfully loaded sales order data');
      } catch (err: any) {
        console.error('WokerSalesOrderPage: Error loading sales order:', err);
        console.error('WokerSalesOrderPage: Error details:', {
          message: err?.message,
          status: err?.response?.status,
          statusText: err?.response?.statusText,
          data: err?.response?.data,
          url: err?.config?.url
        });
        setError(err?.response?.status === 404
          ? 'Sales order not found. It may have been deleted.'
          : 'Failed to load sales order data. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNumericId]);

  // keep LABOUR/OVERHEAD unit price synced to globals if present
  useEffect(() => {
    if (globalLabourRate !== null) {
      setLineItems(prev => prev.map(i => i.part_number === 'LABOUR' ? { ...i, unit_price: globalLabourRate } : i));
    }
  }, [globalLabourRate]);
  useEffect(() => {
    if (globalOverheadRate !== null) {
      setLineItems(prev => prev.map(i => i.part_number === 'OVERHEAD' ? { ...i, unit_price: globalOverheadRate } : i));
    }
  }, [globalOverheadRate]);

                 // recompute negatives - only for the last line item for each part
  useEffect(() => {
    const negatives: typeof negativeAvailabilityItems = [];
    lineItems.forEach((item, index) => {
         // Use the helper function to determine if this is the last line item for its part
         if (isLastLineItemForPart(item, index)) {
      const a = calculateAvailableQuantity(item, index);
      if (a && a.available < 0) {
        negatives.push({ lineItemIndex: index, partNumber: item.part_number, partDescription: item.part_description, excessQuantity: Math.abs(a.available), unit: item.unit });
           }
      }
    });
    setNegativeAvailabilityItems(negatives);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, inventoryItems]);

  // ---------- UI handlers ----------
  const handlePartNumberChange = (idx: number, newValue: string | null) => {
    setLineItems(prev => {
      const updated = [...prev];
      if (!newValue || newValue.trim() === '') {
        updated[idx] = { ...updated[idx], part_number: '', part_description: '', quantity: '', unit: UNIT_OPTIONS[0], unit_price: 0, line_amount: 0 };
      } else {
        const inv = findInventoryPart(newValue);
        if (inv) {
          const lastUnitCost = parseFloat(String(inv.last_unit_cost)) || 0;
          const marginFactor = findMarginFactor(lastUnitCost);
          updated[idx] = {
            ...updated[idx],
            part_number: newValue,
            part_description: inv.part_description || '',
            unit: inv.unit || 'Each',
            unit_price: lastUnitCost * marginFactor
          };
        } else {
          updated[idx] = { ...updated[idx], part_number: newValue, part_description: 'Part not found', unit_price: 0 };
        }
      }
      // recalc line_amount
      const q = parseNumericInput(updated[idx].quantity);
      const up = parseNumericInput(updated[idx].unit_price);
      updated[idx].line_amount = calculateLineAmount(q, up);
      return updated;
    });
  };

  const handleLineItemChange = (idx: number, field: keyof SalesOrderLineItem, value: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const it = { ...updated[idx], [field]: value };

      // auto-remove when qty <= 0
      if (field === 'quantity' && parseFloat(value) <= 0) {
        return updated.filter((_, i) => i !== idx);
      }

      const q = parseNumericInput(it.quantity);
      const up = parseNumericInput(it.unit_price);
      it.line_amount = calculateLineAmount(q, up);
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
      line_amount: 0,
    }]))
  };

  const handleRemoveLineItem = (idx: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  };

  const validateBeforeSave = () => {
    // disallow blank part numbers
    const blanks = lineItems.filter(i => !i.part_number || i.part_number.trim() === '');
    if (blanks.length > 0) {
      toast.error('Line items with blank part numbers are not allowed.');
      return false;
    }
    // allow 0 quantity items on save in worker page (no close action here)
    // invalid/supply items
    const invalids = lineItems.filter(i => {
      const inv = inventoryItems.find((x:any) => x.part_number.toLowerCase() === i.part_number.trim().toLowerCase());
      return !inv || inv.part_type === 'supply';
    });
    if (invalids.length > 0) {
      const msg = invalids.map(i => i.part_number).join(', ');
      toast.error(`Invalid or supply parts (not allowed): ${msg}`);
      return false;
    }
                   // oversell check - only check the last line item for each part
    const oversell = lineItems.some((i, idx) => {
        // Use the helper function to determine if this is the last line item for its part
        if (!isLastLineItemForPart(i, idx)) return false; // Skip non-last items
        
      const a = calculateAvailableQuantity(i, idx);
      return a && a.available < 0;
    });
    if (oversell) {
      toast.error('Insufficient inventory for one or more parts.');
      return false;
    }
    return true;
  };

  const buildPayloadLineItems = (items: SalesOrderLineItem[]) => {
    // Group by part number and merge quantities
    const grouped = items.reduce((acc, item) => {
      const partNumber = item.part_number.trim().toLowerCase();
      if (!acc[partNumber]) {
        acc[partNumber] = {
          part_number: item.part_number.trim(),
          part_description: item.part_description.trim(),
          unit: item.unit.trim(),
          unit_price: item.unit_price != null ? Number(item.unit_price) : 0,
          line_amount: 0,
          quantity_sold: 0,
        };
      }
      
      // Add quantities and line amounts
      // Ensure quantity is a valid number, default to 0 if invalid
      const quantity = parseFloat(String(item.quantity).replace(/[^\d.-]/g, '')) || 0;
      acc[partNumber].quantity_sold += Math.round(quantity);
      acc[partNumber].line_amount += quantity * (item.unit_price || 0);
      
      return acc;
    }, {} as Record<string, any>);
    
    // Convert back to array
    return Object.values(grouped);
  };

  const handleSave = async () => {
    if (!salesOrder) return;
    if (!validateBeforeSave()) return;

    try {
      const payload = {
        // Only what backend needs to update lines & PTO
        lineItems: buildPayloadLineItems(lineItems),
        partsToOrder: partsToOrder
          .filter(it => it.part_number && parseFloat(String(it.quantity_to_order)) > 0)
          .map(it => ({
            sales_order_id: salesOrder.sales_order_id,
            part_number: it.part_number.trim(),
            part_description: it.part_description.trim(),
            quantity_needed: parseFloat(String(it.quantity_to_order)) || 0,
            unit: it.unit.trim(),
            unit_price: it.unit_price,
            line_amount: it.line_amount,
          })),
      };
      await api.put(`/api/sales-orders/${salesOrder.sales_order_id}`, payload);
      setSuccess('Sales Order updated successfully!');
      setInitialSignature(JSON.stringify({ lineItems, partsToOrder }));
      // refresh inventory quietly
      try { const inv = await api.get('/api/inventory'); setInventoryItems(inv.data); } catch {}
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.response?.data?.details || err?.response?.data?.message || 'Failed to save sales order.';
      toast.error(message);
    }
  };

  // ---------- keydown handlers for autocomplete ----------
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
    if (partOpenIndex === idx && (isEnter || isTab)) return;

    if ((isEnter || isTab) && inputValue) {
      if (isEnter && (event as any).ctrlKey) {
        event.preventDefault();
        setLinePartNumberForModal(inputValue.toUpperCase());
        setLinePartToAddIndex(idx);
        setOpenPartDialogForLine(true);
        setPartOpenIndex(null);
        return;
      }
      const match = inventoryItems.find((inv:any) => inv.part_number.toUpperCase() === inputValue.toUpperCase());
      if (!match && isEnter) {
        event.preventDefault();
        setLinePartNumberForModal(inputValue.toUpperCase());
        setLinePartToAddIndex(idx);
        setOpenPartDialogForLine(true);
        setPartOpenIndex(null);
      }
    }
  };

  const handlePtoPartKeyDown = (idx: number, event: React.KeyboardEvent) => {
    const inputValue = (partsToOrder[idx]?.part_number || '').trim();
    const isEnter = event.key === 'Enter';
    const isTab = event.key === 'Tab';
    const isEsc = event.key === 'Escape';
    const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';

    if (isEsc) { setPtoOpenIndex(null); return; }
    if (isArrow) {
      if (event.key === 'ArrowDown' && ptoOpenIndex !== idx) setPtoOpenIndex(idx);
      return;
    }
    if (ptoOpenIndex === idx && (isEnter || isTab)) return;

    if ((isEnter || isTab) && inputValue) {
      if (isEnter && (event as any).ctrlKey) {
        event.preventDefault();
        setPtoPartNumberForModal(inputValue.toUpperCase());
        setPtoPartToAddIndex(idx);
        setOpenPartDialogForPTO(true);
        setPtoOpenIndex(null);
        return;
      }
      const match = inventoryItems.find((inv:any) => inv.part_number.toUpperCase() === inputValue.toUpperCase());
      if (!match && isEnter) {
        event.preventDefault();
        setPtoPartNumberForModal(inputValue.toUpperCase());
        setPtoPartToAddIndex(idx);
        setOpenPartDialogForPTO(true);
        setPtoOpenIndex(null);
      }
    }
  };

  // ---------- rendering guards ----------
  if (loading) {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography>Loading sales order...</Typography>
      </Container>
    );
  }
  if (error) {
    return (
      <Container component="main" maxWidth="md" sx={{ mt: 8, textAlign: 'center' }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="contained" onClick={() => window.location.reload()} sx={{ mr: 2 }}>Retry</Button>
        <Button variant="outlined" onClick={() => navigate('/open-sales-orders')}>Back to Sales Orders</Button>
      </Container>
    );
  }
  if (!salesOrder) return null;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <UnsavedChangesGuard when={isDirty} onSave={handleSave} />
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Edit Lines & Parts to Order — SO {salesOrder.sales_order_number || salesOrder.sales_order_id}
            </Typography>
            <Button variant="contained" onClick={handleSave}>Save Changes</Button>
          </Box>
          
          <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Line Items</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You can add multiple line items with the same part number. They will be automatically merged on save.
          </Typography>
        </Box>

        {/* Negative availability banners in normal flow (pushes content down) */}
        <Box ref={alertsContainerRef} sx={{ mb: negativeAvailabilityItems.length ? 2 : 0, display: negativeAvailabilityItems.length ? 'flex' : 'none', flexDirection: 'column', gap: 1 }}>
          {negativeAvailabilityItems.map((item, i) => {
                // Double-check that this line item is still the last for its part
                const li = lineItems[item.lineItemIndex];
                if (!li) return null;
                
                // Use the helper function to determine if this is still the last line item for its part
                if (!isLastLineItemForPart(li, item.lineItemIndex)) return null;
              
                return (
                  <Alert key={`${item.lineItemIndex}-${i}`} severity="warning" sx={{ 
                    width: '100%',
                    boxShadow: 2,
                    '& .MuiAlert-message': { width: '100%', padding: 0 }
                  }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          Insufficient stock for {item.partNumber}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Excess quantity: {item.excessQuantity} {item.unit}
                        </Typography>
                      </Box>
                      <Button
                        variant="contained" size="small"
                        sx={{ whiteSpace: 'nowrap' }}
                        onClick={() => {
                          const excess = item.excessQuantity;
                          const inv = inventoryItems.find((x:any) => x.part_number.toLowerCase() === li.part_number.toLowerCase());
                          const newItem: PartsToOrderItem = {
                            sales_order_id: salesOrder.sales_order_id,
                            part_number: li.part_number,
                            part_description: li.part_description,
                            quantity_to_order: String(excess),
                            unit: li.unit,
                            unit_price: inv?.last_unit_cost || 0,
                            line_amount: (inv?.last_unit_cost || 0) * excess
                          };
                          setPartsToOrder(prev => [...prev, newItem]);
                          const newQty = Math.max(0, (parseFloat(String(li.quantity).replace(/[^\d.-]/g, '')) || 0) - excess);
                          setLineItems(prev => prev.map((x, idx) => idx === item.lineItemIndex ? { ...x, quantity: String(newQty) } : x));
                          setNegativeAvailabilityItems(prev => prev.filter(n => n.lineItemIndex !== item.lineItemIndex));
                          toast.success(`Transferred ${excess} ${li.unit} of ${li.part_number} to parts to order`);
                        }}
                      >
                        Transfer {item.excessQuantity} to Parts to Order
                      </Button>
                    </Box>
                  </Alert>
                );
              })}
        </Box>

        {/* LINE ITEMS */}
        <Paper sx={{ p: 3, mb: 3 }} elevation={3}>
          <Grid container spacing={2}>
            {lineItems.map((item, idx) => (
              <React.Fragment key={idx}>
                <Grid item xs={12} sm={6} md={3.5}>
                  <Autocomplete<PartOption, false, false, true>
                    open={partOpenIndex === idx}
                    onOpen={() => setPartOpenIndex(idx)}
                    onClose={() => setPartOpenIndex(null)}
                    autoHighlight
                    value={item.part_number}
                                         onChange={(_, newValue) => {
                       if (typeof newValue === 'string') {
                         handlePartNumberChange(idx, newValue);
                         setPartOpenIndex(null);
                       } else if (newValue && typeof newValue === 'object' && 'isNew' in newValue) {
                        const inputValue = (newValue as any).inputValue || '';
                        setLinePartNumberForModal(String(inputValue).toUpperCase());
                        setLinePartToAddIndex(idx);
                        setOpenPartDialogForLine(true);
                        setPartOpenIndex(null);
                      }
                    }}
                    onInputChange={(_, v, reason) => {
                      setLineItems(prev => {
                        const u = [...prev];
                        u[idx] = { ...u[idx], part_number: (v || '').toUpperCase() };
                        return u;
                      });
                      if (partTypingTimer) window.clearTimeout(partTypingTimer);
                      if (reason === 'reset') return;
                      const text = (v || '').trim();
                      if (text.length > 0) {
                        const t = window.setTimeout(() => setPartOpenIndex(idx), 200);
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
                      <TextField {...params} label="Part Number" required fullWidth onKeyDown={(e) => handleLinePartKeyDown(idx, e)} onBlur={() => setPartOpenIndex(null)} />
                    )}
                    onBlur={() => {
                       // Get the current input value from the lineItems state
                       const inputValue = lineItems[idx]?.part_number?.trim().toUpperCase();
                      if (!inputValue) return;
                      const inv = inventoryItems.find((x:any) => x.part_number === inputValue);
                      if (!inv) {
                        setLinePartToAddIndex(idx);
                        setLinePartNumberForModal(inputValue);
                        setOpenPartDialogForLine(true);
                        setPartOpenIndex(null);
                       } else {
                         // Part exists, populate the description and other fields
                         handlePartNumberChange(idx, inputValue);
                      }
                    }}
                  />
                  <Box mt={1}>
                    <Button size="small" variant="outlined" onClick={() => { setFinderContext('line'); setFinderTargetIndex(idx); setFinderOpen(true); }}>Find Part</Button>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6} md={3.5}>
                  <TextField
                    label="Part Description"
                    value={item.part_description}
                    fullWidth
                    InputProps={{ readOnly: true }}
                    sx={{ backgroundColor: '#ffffff' }}
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
                    inputProps={{ step: 1, onWheel: (e:any) => e.target.blur() }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField
                    label="Avail"
                    value={(() => {
                       // Use the helper function to determine if this is the last line item for its part
                       if (!isLastLineItemForPart(item, idx)) return 'N/A';
                       
                      const a = calculateAvailableQuantity(item, idx);
                      if (!a) return 'N/A';
                      return a.available < 0 ? `${a.available} (Insufficient)` : String(a.available);
                    })()}
                    fullWidth
                    InputProps={{ readOnly: true }}
                    sx={{
                      backgroundColor: (() => {
                         // Use the helper function to determine if this is the last line item for its part
                         if (!isLastLineItemForPart(item, idx)) return '#f5f5f5';
                         
                        const a = calculateAvailableQuantity(item, idx);
                        if (!a) return '#f5f5f5';
                        return a.available >= 0 ? '#e8f5e8' : '#ffeaea';
                      })(),
                      '& .MuiInputBase-input': {
                        color: (() => {
                             // Use the helper function to determine if this is the last line item for its part
                             if (!isLastLineItemForPart(item, idx)) return '#666';
                             
                          const a = calculateAvailableQuantity(item, idx);
                          return a?.isNegative ? '#d32f2f' : '#2e7d32';
                        })()
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField
                    label="Unit"
                    value={item.unit}
                    fullWidth
                    InputProps={{ readOnly: true }}
                    sx={{ backgroundColor: '#ffffff' }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1} sx={{ display: 'flex', alignItems: 'stretch' }}>
                  <Button variant="outlined" color="primary" onClick={() => handleRemoveLineItem(idx)} fullWidth sx={{ height: '56px' }}>
                    Remove
                  </Button>
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" color="primary" onClick={handleAddLineItem}>Add Line Item</Button>
          </Box>
        </Paper>

        {/* PARTS TO ORDER */}
        <Paper
          sx={{
            p: 3, mb: 3, border: '2px solid #b8860b',
            '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#b8860b' }, '&:hover fieldset': { borderColor: '#b8860b' } }
          }}
          elevation={0}
        >
          <Typography variant="h6" gutterBottom>Parts to Order</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add parts that need to be ordered for this sales order. These quantities are aggregated across all sales orders.
          </Typography>
          <Grid container spacing={2}>
            {partsToOrder.map((item, idx) => (
              <React.Fragment key={idx}>
                <Grid item xs={12} sm={6} md={3.5}>
                  <Autocomplete<PartOption, false, false, true>
                    open={ptoOpenIndex === idx}
                    onOpen={() => setPtoOpenIndex(idx)}
                    onClose={() => setPtoOpenIndex(null)}
                    autoHighlight
                    value={item.part_number}
                    onChange={(_, v) => {
                      if (!v) {
                      setPartsToOrder(prev => {
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
                          setPartsToOrder(prev => {
                            const u=[...prev]; u[idx]={ ...u[idx], part_number:inv.part_number, part_description:inv.part_description, unit:inv.unit||'Each', unit_price:calcPrice, line_amount:0 }; return u;
                          });
                        } else {
                          setPartsToOrder(prev => {
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
                      setPartsToOrder(prev => {
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
                      const inputValue = (partsToOrder[idx]?.part_number || '').trim().toUpperCase();
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
                  <Box mt={1}>
                    <Button size="small" variant="outlined" onClick={() => { setFinderContext('pto'); setFinderTargetIndex(idx); setFinderOpen(true); }}>Find Part</Button>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6} md={3.5}>
                  <TextField label="Description" value={item.part_description} fullWidth InputProps={{ readOnly:true }} sx={{ backgroundColor:'#f5f5f5' }} />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField
                    label="Qty to Order"
                    value={item.quantity_to_order}
                    onChange={e => {
                      const q = e.target.value;
                      setPartsToOrder(prev => {
                        const u=[...prev]; const qn = parseFloat(q)||0;
                        const price = u[idx].unit_price || 0;
                        u[idx] = { ...u[idx], quantity_to_order:q, line_amount: qn * price };
                        return u;
                      });
                    }}
                    type="number" fullWidth required inputProps={{ step:1, min:0, onWheel:(e:any)=>e.target.blur() }}
                  />
                </Grid>
                <Grid item xs={6} sm={3} md={1.5}>
                  <TextField label="Unit" value={item.unit} fullWidth InputProps={{ readOnly:true }} sx={{ backgroundColor:'#ffffff' }} />
                </Grid>
                <Grid item xs={12} sm={1} md={1} sx={{ display:'flex', alignItems:'stretch', gap:2 }}>
                  <Button variant="outlined" onClick={() => setPartsToOrder(prev => prev.filter((_,i)=>i!==idx))} 
                    sx={{ height: '56px', flexShrink:0, borderColor:'#b8860b', color:'#b8860b', '&:hover':{ borderColor:'#8b6914', backgroundColor:'#fff8dc' } }}>
                    Remove
                  </Button>
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
          <Box sx={{ mt:2 }}>
            <Button variant="outlined" color="primary" onClick={() => setPartsToOrder(prev => [...prev, {
              sales_order_id: salesOrder.sales_order_id, part_number:'', part_description:'', quantity_to_order:'', unit:'Each', unit_price:0, line_amount:0
            }])}>
              Add Parts to Order Item
            </Button>
          </Box>
        </Paper>

        <Box display="flex" justifyContent="flex-end" gap={2}>
          <Button variant="outlined" onClick={() => navigate(`/open-sales-orders/${salesOrder.sales_order_id}`)}>
            Back to SO
          </Button>
          <Button variant="contained" onClick={handleSave}>
            Save Changes
          </Button>
        </Box>

        <Snackbar
          open={!!success}
          autoHideDuration={6000}
          onClose={() => setSuccess(null)}
          anchorOrigin={{ vertical:'top', horizontal:'center' }}
        >
          <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width:'100%' }}>
            {success}
          </Alert>
        </Snackbar>
      </Container>

      {/* Add New Part dialogs */}
      <UnifiedPartDialog
        open={openPartDialogForLine}
        onClose={() => { setOpenPartDialogForLine(false); setLinePartToAddIndex(null); setLinePartNumberForModal(''); }}
        onSave={async (partData: PartFormValues) => {
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
              // recalc amount
              const q = parseNumericInput(updated[linePartToAddIndex].quantity);
              updated[linePartToAddIndex].line_amount = calculateLineAmount(q, unitPrice);
              return updated;
            });
          }
        }}
        title="Add New Part"
        initialPart={{ part_number: linePartNumberForModal.toUpperCase(), category: 'Uncategorized' }}
      />
      <PartFinderDialog
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        onSelect={(part) => {
          if (!salesOrder) return;
          if (finderContext === 'line') {
            const idx = finderTargetIndex;
            setLineItems(prev => {
              const updated = [...prev];
              if (!updated[idx]) return prev;
              updated[idx] = {
                ...updated[idx],
                part_number: part.part_number,
                part_description: part.part_description,
              } as any;
              return updated;
            });
          } else {
            const idx = finderTargetIndex;
            setPartsToOrder(prev => {
              const u = [...prev];
              if (!u[idx]) return prev;
              u[idx] = {
                ...u[idx],
                part_number: part.part_number,
                part_description: part.part_description,
              } as any;
              return u;
            });
          }
        }}
        salesOrderId={salesOrder?.sales_order_id || 0}
        context={finderContext}
        inventoryItems={inventoryItems.map((x:any) => ({ part_number: x.part_number, part_description: x.part_description }))}
      />
      <UnifiedPartDialog
        open={openPartDialogForPTO}
        onClose={() => { setOpenPartDialogForPTO(false); setPtoPartToAddIndex(null); setPtoPartNumberForModal(''); }}
        onSave={async (partData: PartFormValues) => {
          const response = await api.post('/api/inventory', partData);
          const updatedInventory = await api.get('/api/inventory');
          setInventoryItems(updatedInventory.data);
          const addedPart = response.data.item;
          if (ptoPartToAddIndex !== null) {
            setPartsToOrder(prev => {
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
              // recalc amount if qty set
              const qn = parseFloat(String(u[ptoPartToAddIndex].quantity_to_order)) || 0;
              u[ptoPartToAddIndex].line_amount = qn * calcPrice;
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

export default WokerSalesOrderPage;
