import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  Collapse,
  IconButton
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { toast } from 'react-toastify';
import api from '../api/axios';
import { formatCurrency } from '../utils/formatters';
import { getInventoryForPart } from '../services/inventoryService';

interface AllocationSuggestion {
  sales_order_id: number;
  sales_order_number: string;
  customer_name: string;
  sales_date: string;
  part_number: string;
  current_quantity_needed: number;
  suggested_alloc: number;
  is_needed: boolean;
}

interface PartSuggestion {
  part_number: string;
  part_description: string;
  quantity_ordered: number;
  total_needed: number;
  suggested_allocate: number;
  suggested_surplus: number;
  allocation_suggestions: AllocationSuggestion[];
}

interface AllocationData {
  purchase_order_id: number;
  purchase_order_number: string;
  suggestions: PartSuggestion[];
}

interface AllocationModalProps {
  open: boolean;
  onClose: () => void;
  purchaseOrderId: number;
  onSuccess: () => void;
  onAllocationSaved?: () => void; // New callback for when allocations are saved without closing PO
}

const AllocationModal: React.FC<AllocationModalProps> = ({
  open,
  onClose,
  purchaseOrderId,
  onSuccess,
  onAllocationSaved
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocationData, setAllocationData] = useState<AllocationData | null>(null);
  const [allocations, setAllocations] = useState<{ [key: string]: { [key: number]: number } }>({});
  const [surplusPerPart, setSurplusPerPart] = useState<{ [key: string]: number }>({});
  const [expandedParts, setExpandedParts] = useState<{ [key: string]: boolean }>({});
  const [supplyParts, setSupplyParts] = useState<Set<string>>(new Set());

  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open && purchaseOrderId) {
      // Clear previous state when modal opens
      setAllocationData(null);
      setAllocations({});
      setSurplusPerPart({});
      setExpandedParts({});
      setSupplyParts(new Set());
      setErrors([]);
      fetchAllocationSuggestions();
    }
  }, [open, purchaseOrderId]);

  const fetchAllocationSuggestions = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/purchase-history/${purchaseOrderId}/allocation-suggestions`);
      const data = response.data;
      console.log('Allocation suggestions data:', data); // Debug log
      console.log('Number of suggestions:', data.suggestions?.length);
      data.suggestions?.forEach((suggestion: any, index: number) => {
        console.log(`Suggestion ${index}: ${suggestion.part_number} - ${suggestion.allocation_suggestions?.length} sales orders`);
        suggestion.allocation_suggestions?.forEach((alloc: any, allocIndex: number) => {
          console.log(`  Allocation ${allocIndex}: SO ${alloc.sales_order_number}, current_quantity_needed: ${alloc.current_quantity_needed}, is_needed: ${alloc.is_needed}`);
        });
      });

      // Filter out supply parts
      const supplyPartsSet = new Set<string>();
      const filteredSuggestions = [];

      for (const suggestion of data.suggestions || []) {
        try {
          console.log(`Checking part type for: ${suggestion.part_number}`);
          const partInfo = await getInventoryForPart(suggestion.part_number);
          console.log(`Part info for ${suggestion.part_number}:`, partInfo);
          
          if (partInfo.part_type === 'supply') {
            supplyPartsSet.add(suggestion.part_number);
            console.log(`Filtering out supply part: ${suggestion.part_number}`);
          } else {
            console.log(`Including stock part: ${suggestion.part_number} (type: ${partInfo.part_type})`);
            filteredSuggestions.push(suggestion);
          }
        } catch (error) {
          console.warn(`Could not determine part type for ${suggestion.part_number}, including it:`, error);
          filteredSuggestions.push(suggestion);
        }
      }

      setSupplyParts(supplyPartsSet);
      
      console.log(`Filtering summary: ${supplyPartsSet.size} supply parts filtered out, ${filteredSuggestions.length} stock parts remaining`);
      console.log('Supply parts filtered:', Array.from(supplyPartsSet));
      console.log('Stock parts included:', filteredSuggestions.map(s => s.part_number));
      
      // Update data with filtered suggestions
      const filteredData = {
        ...data,
        suggestions: filteredSuggestions
      };

      setAllocationData(filteredData);

      // Try to load any previously saved allocations and overlay them
      let initialAllocations: { [key: string]: { [key: number]: number } } = {};
      let initialSurplus: { [key: string]: number } = {};

      try {
        const savedRes = await api.get(`/api/purchase-history/${purchaseOrderId}/allocations`);
        const savedAllocations: Array<{ sales_order_id: number; part_number: string; allocate_qty: number }>
          = savedRes.data || [];

        const savedMap: { [key: string]: { [key: number]: number } } = {};
        for (const a of savedAllocations) {
          const part = String(a.part_number).toUpperCase();
          if (!savedMap[part]) savedMap[part] = {};
          savedMap[part][a.sales_order_id] = Number(a.allocate_qty) || 0;
        }

        // Build allocations using saved values when present, otherwise fall back to suggestions
        initialAllocations = {};
        initialSurplus = {};

        filteredSuggestions.forEach((suggestion: PartSuggestion) => {
          const part = suggestion.part_number;
          const savedForPart = savedMap[part] || {};
          const partAlloc: { [key: number]: number } = {};

          suggestion.allocation_suggestions.forEach((alloc: AllocationSuggestion) => {
            const savedQty = savedForPart[alloc.sales_order_id];
            partAlloc[alloc.sales_order_id] = typeof savedQty === 'number' ? savedQty : alloc.suggested_alloc;
          });

          initialAllocations[part] = partAlloc;

          // Surplus = ordered - totalAllocated (recompute to reflect saved values)
          const totalAllocated = Object.values(partAlloc).reduce((sum, v) => sum + (Number(v) || 0), 0);
          initialSurplus[part] = Math.max(0, suggestion.quantity_ordered - totalAllocated);
        });

      } catch (e) {
        // If fetching saved allocations fails, fall back to suggestions
        initialAllocations = {};
        initialSurplus = {};
        filteredSuggestions.forEach((suggestion: PartSuggestion) => {
          initialAllocations[suggestion.part_number] = {};
          suggestion.allocation_suggestions.forEach((alloc: AllocationSuggestion) => {
            initialAllocations[suggestion.part_number][alloc.sales_order_id] = alloc.suggested_alloc;
          });
          const totalAllocated = Object.values(initialAllocations[suggestion.part_number]).reduce((sum, v) => sum + (Number(v) || 0), 0);
          initialSurplus[suggestion.part_number] = Math.max(0, suggestion.quantity_ordered - totalAllocated);
        });
      }

      setAllocations(initialAllocations);
      setSurplusPerPart(initialSurplus);
      setErrors([]);
    } catch (error: any) {
      console.error('Error fetching allocation suggestions:', error);
      toast.error('Failed to load allocation suggestions');
    } finally {
      setLoading(false);
    }
  };

  const validateAllocation = (partNumber: string, salesOrderId: number, value: number) => {
    if (!allocationData) return { valid: true };
    
    const suggestion = allocationData.suggestions.find(s => s.part_number === partNumber);
    if (!suggestion) return { valid: true };
    
    const salesOrderSuggestion = suggestion.allocation_suggestions.find(
      s => s.sales_order_id === salesOrderId
    );
    
    if (!salesOrderSuggestion) return { valid: true };
    
    const quantityToOrder = salesOrderSuggestion.current_quantity_needed;
    const quantityOrdered = suggestion.quantity_ordered;
    
    // Calculate total quantity needed
    const totalNeeded = suggestion.allocation_suggestions
      .filter(alloc => alloc.is_needed)
      .reduce((sum, alloc) => sum + alloc.current_quantity_needed, 0);
    
    const hasSurplus = quantityOrdered >= totalNeeded;
    
    // Check if this would exceed the total ordered quantity
    const currentTotal = getTotalAllocated(partNumber);
    const currentValue = allocations[partNumber]?.[salesOrderId] || 0;
    const maxAllowed = quantityOrdered - (currentTotal - currentValue);
    
    if (value > maxAllowed) {
      return {
        valid: false,
        message: `Cannot allocate more than ${maxAllowed} units (exceeds ordered quantity)`
      };
    }
    
    // When surplus exists, cannot reduce below quantity_to_order for needed items
    if (hasSurplus && salesOrderSuggestion.is_needed && value < quantityToOrder) {
      return {
        valid: false,
        message: `Cannot allocate less than ${quantityToOrder} units when surplus exists`
      };
    }
    
    // When no surplus, can reduce below quantity_to_order (with warning)
    if (!hasSurplus && salesOrderSuggestion.is_needed && value < quantityToOrder) {
      return {
        valid: true,
        warning: `Allocating ${value} units but ${quantityToOrder} units are needed for quantity to order`
      };
    }
    
    return { valid: true };
  };

  const handleAllocationChange = (partNumber: string, salesOrderId: number, value: number) => {
    const newValue = Math.max(0, value);
    
    // Validate the allocation
    const validation = validateAllocation(partNumber, salesOrderId, newValue);
    
    if (!validation.valid) {
      toast.error(validation.message);
      return; // Don't update allocation
    }
    
    if (validation.warning) {
      // Show warning but allow the change
      toast.warning(validation.warning);
    }
    
    // Update allocations and surplus in one go
    setAllocations(prev => {
      const newAllocations = {
        ...prev,
        [partNumber]: {
          ...prev[partNumber],
          [salesOrderId]: newValue
        }
      };
      
      // Calculate new surplus
      if (allocationData) {
        const suggestion = allocationData.suggestions.find(s => s.part_number === partNumber);
        if (suggestion) {
          const partAllocations = newAllocations[partNumber] || {};
          const totalAllocated = Object.values(partAllocations).reduce((sum: number, val: any) => sum + val, 0);
          const newSurplus = Math.max(0, suggestion.quantity_ordered - totalAllocated);
          
          setSurplusPerPart(prev => ({
            ...prev,
            [partNumber]: newSurplus
          }));
        }
      }
      
      return newAllocations;
    });
  };

  const handleAutoAllocate = (partNumber: string) => {
    if (!allocationData) return;
    
    const suggestion = allocationData.suggestions.find(s => s.part_number === partNumber);
    if (!suggestion) return;
    
    const quantityOrdered = suggestion.quantity_ordered;
    
    // Calculate total quantity needed
    const totalNeeded = suggestion.allocation_suggestions
      .filter(alloc => alloc.is_needed)
      .reduce((sum, alloc) => sum + alloc.current_quantity_needed, 0);
    
    const hasSurplus = quantityOrdered >= totalNeeded;
    
    // Sort by sales order number (FIFO)
    const sortedSuggestions = suggestion.allocation_suggestions
      .filter(alloc => alloc.is_needed)
      .sort((a, b) => a.sales_order_number.localeCompare(b.sales_order_number));
    
    const newAllocations: { [key: number]: number } = {};
    let remaining = quantityOrdered;
    
    if (hasSurplus) {
      // We have surplus - fulfill all needs first, then distribute surplus
      for (const alloc of sortedSuggestions) {
        const quantityToOrder = alloc.current_quantity_needed;
        const allocQty = Math.min(quantityToOrder, remaining);
        
        if (allocQty > 0) {
          newAllocations[alloc.sales_order_id] = allocQty;
          remaining -= allocQty;
        }
      }
      
      // Distribute surplus (can go to any sales order, including those with quantity_to_order = 0)
      if (remaining > 0) {
        for (const alloc of suggestion.allocation_suggestions) {
          if (remaining <= 0) break;
          
          const currentAllocated = newAllocations[alloc.sales_order_id] || 0;
          const additionalQty = Math.min(remaining, 1); // Distribute 1 by 1
          
          newAllocations[alloc.sales_order_id] = currentAllocated + additionalQty;
          remaining -= additionalQty;
        }
      }
    } else {
      // No surplus - FIFO allocation until supply is exhausted
      for (const alloc of sortedSuggestions) {
        if (remaining <= 0) break;
        
        const quantityToOrder = alloc.current_quantity_needed;
        const allocQty = Math.min(quantityToOrder, remaining);
        
        if (allocQty > 0) {
          newAllocations[alloc.sales_order_id] = allocQty;
          remaining -= allocQty;
        }
      }
    }
    
    // Update allocations and surplus
    setAllocations(prev => ({
      ...prev,
      [partNumber]: newAllocations
    }));
    
    setSurplusPerPart(prev => ({
      ...prev,
      [partNumber]: remaining
    }));
  };

  const handleAutoAllocateAll = () => {
    if (!allocationData) return;
    
    allocationData.suggestions.forEach(suggestion => {
      handleAutoAllocate(suggestion.part_number);
    });
  };

  // Remove handleSurplusChange since surplus is now calculated automatically

  const validateAllocations = (): boolean => {
    const newErrors: string[] = [];
    
    if (!allocationData) return false;
    
    allocationData.suggestions.forEach((suggestion: PartSuggestion) => {
      const partNumber = suggestion.part_number;
      const quantityOrdered = suggestion.quantity_ordered;
      
      // Calculate total allocated for this part
      const partAllocations = allocations[partNumber] || {};
      const totalAllocated = Object.values(partAllocations).reduce((sum: number, val: any) => sum + val, 0);
      
      // Validate total allocation doesn't exceed ordered quantity
      if (totalAllocated > quantityOrdered) {
        newErrors.push(`Total allocation (${totalAllocated}) exceeds ordered quantity (${quantityOrdered}) for part ${partNumber}`);
      }
      
      // Calculate total quantity needed
      const totalNeeded = suggestion.allocation_suggestions
        .filter(alloc => alloc.is_needed)
        .reduce((sum, alloc) => sum + alloc.current_quantity_needed, 0);
      
      const hasSurplus = quantityOrdered >= totalNeeded;
      
      // When surplus exists, validate minimum allocations
      if (hasSurplus) {
        for (const alloc of suggestion.allocation_suggestions) {
          if (alloc.is_needed) {
            const allocatedQty = partAllocations[alloc.sales_order_id] || 0;
            const quantityToOrder = alloc.current_quantity_needed;
            
            if (allocatedQty < quantityToOrder) {
              newErrors.push(`Sales order ${alloc.sales_order_number} must receive at least ${quantityToOrder} units when surplus exists`);
            }
          }
        }
      }
    });
    
    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSaveAllocations = async () => {
    if (!validateAllocations()) {
      return;
    }
    
    setSaving(true);
    try {
      // Convert allocations to the format expected by the backend
      const allocationArray = [];
      for (const [partNumber, salesOrderAllocations] of Object.entries(allocations)) {
        for (const [salesOrderId, allocateQty] of Object.entries(salesOrderAllocations)) {
          if (allocateQty > 0) {
            allocationArray.push({
              sales_order_id: parseInt(salesOrderId),
              part_number: partNumber,
              allocate_qty: allocateQty
            });
          }
        }
      }
      
      // Save allocations without closing the PO
      const response = await api.post(`/api/purchase-history/${purchaseOrderId}/save-allocations`, {
        allocations: allocationArray,
        surplusPerPart
      });
      
      toast.success('Allocations saved successfully');
      if (onAllocationSaved) {
        onAllocationSaved();
      }
      onClose();
    } catch (error: any) {
      console.error('Error saving allocations:', error);
      const errorMessage = error.response?.data?.error || 'Failed to save allocations';
      toast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseWithAllocations = async () => {
    if (!validateAllocations()) {
      return;
    }
    
    setSaving(true);
    try {
      // Convert allocations to the format expected by the backend
      const allocationArray = [];
      for (const [partNumber, salesOrderAllocations] of Object.entries(allocations)) {
        for (const [salesOrderId, allocateQty] of Object.entries(salesOrderAllocations)) {
          if (allocateQty > 0) {
            allocationArray.push({
              sales_order_id: parseInt(salesOrderId),
              part_number: partNumber,
              allocate_qty: allocateQty
            });
          }
        }
      }
      
      const response = await api.post(`/api/purchase-history/${purchaseOrderId}/close-with-allocations`, {
        allocations: allocationArray,
        surplusPerPart
      });
      
      toast.success('Purchase order closed successfully with allocations');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error closing purchase order:', error);
      const errorMessage = error.response?.data?.error || 'Failed to close purchase order';
      toast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const getTotalAllocated = (partNumber: string): number => {
    const partAllocations = allocations[partNumber] || {};
    return Object.values(partAllocations).reduce((sum: number, val: any) => sum + val, 0);
  };

  const getRemainingQuantity = (partNumber: string): number => {
    if (!allocationData) return 0;
    const suggestion = allocationData.suggestions.find(s => s.part_number === partNumber);
    if (!suggestion) return 0;
    
    const totalAllocated = getTotalAllocated(partNumber);
    return suggestion.quantity_ordered - totalAllocated;
  };

  const togglePartExpansion = (partNumber: string) => {
    setExpandedParts(prev => ({
      ...prev,
      [partNumber]: !prev[partNumber]
    }));
  };

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>Loading Allocation Suggestions...</DialogTitle>
        <DialogContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Allocate Purchase Order: {allocationData?.purchase_order_number}
      </DialogTitle>
      <DialogContent>
        {/* Summary of all parts */}
        {allocationData && allocationData.suggestions.length > 0 && (
          <Paper sx={{ mb: 3, p: 2, backgroundColor: 'grey.50' }}>
            <Typography variant="h6" gutterBottom>
              Purchase Order Summary ({allocationData.suggestions.length} parts)
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
                             {allocationData.suggestions.map((suggestion, index) => (
                 <Chip
                   key={`${suggestion.part_number}-${index}`}
                   label={`${suggestion.part_number}: ${suggestion.quantity_ordered} ordered`}
                   color="primary"
                   variant="outlined"
                   size="small"
                 />
               ))}
            </Box>
          </Paper>
        )}

        {/* Message about filtered supply parts */}
        {supplyParts.size > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Note:</strong> {supplyParts.size} supply part{supplyParts.size > 1 ? 's' : ''} {supplyParts.size > 1 ? 'have' : 'has'} been filtered out from allocation. 
              Supply parts are not tracked for inventory allocation.
            </Typography>
            <Box mt={1}>
              <Typography variant="body2" color="text.secondary">
                Filtered parts: {Array.from(supplyParts).join(', ')}
              </Typography>
            </Box>
          </Alert>
        )}


        {errors.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Please correct the following errors:</Typography>
            {errors.map((error, index) => (
              <Typography key={index} variant="body2">• {error}</Typography>
            ))}
          </Alert>
        )}

        {allocationData?.suggestions.length === 0 ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body1">
              No parts found in this purchase order to allocate.
            </Typography>
          </Alert>
        ) : (
                     allocationData?.suggestions.map((suggestion, index) => (
             <Paper key={`${suggestion.part_number}-${index}`} sx={{ mb: 2, p: 2 }}>
              {/* Main Part Row */}
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={1}>
                  <IconButton
                    size="small"
                    onClick={() => togglePartExpansion(suggestion.part_number)}
                    sx={{ p: 0.5 }}
                  >
                    {expandedParts[suggestion.part_number] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                  <Typography variant="h6">
                    {suggestion.part_number} - {suggestion.part_description}
                  </Typography>
                </Box>
                <Box display="flex" gap={1} alignItems="center">
                  <Chip 
                    label={`Ordered: ${suggestion.quantity_ordered}`} 
                    color="primary" 
                    variant="outlined" 
                    size="small"
                  />
                  <Chip 
                    label={`Total Needed: ${suggestion.total_needed}`} 
                    color="secondary" 
                    variant="outlined" 
                    size="small"
                  />
                  <Chip 
                    label={`Remaining: ${getRemainingQuantity(suggestion.part_number)}`} 
                    color={getRemainingQuantity(suggestion.part_number) < 0 ? "error" : "default"}
                    variant="outlined" 
                    size="small"
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => handleAutoAllocate(suggestion.part_number)}
                  >
                    Auto Allocate (FIFO)
                  </Button>
                </Box>
              </Box>

              {/* Collapsible Sales Orders Table */}
              <Collapse in={expandedParts[suggestion.part_number]}>
                <Box mt={2}>
                  <TableContainer>
                    <Table size="small">
                                             <TableHead>
                         <TableRow>
                           <TableCell>Sales Order</TableCell>
                           <TableCell>Customer</TableCell>
                           <TableCell>Date</TableCell>
                           <TableCell align="right">Quantity to Order</TableCell>
                           <TableCell align="right">Allocate Qty</TableCell>
                           <TableCell>Status</TableCell>
                         </TableRow>
                       </TableHead>
                      <TableBody>
                                                 {suggestion.allocation_suggestions.map((alloc) => {
                           console.log(`Rendering allocation for SO ${alloc.sales_order_number}: current_quantity_needed = ${alloc.current_quantity_needed}, is_needed = ${alloc.is_needed}`);
                           return (
                                                       <TableRow 
                              key={`${suggestion.part_number}-${alloc.sales_order_id}`}
                              sx={{ 
                                backgroundColor: alloc.is_needed ? 'warning.light' : 'grey.50',
                                '&:hover': { 
                                  backgroundColor: alloc.is_needed ? 'warning.main' : 'grey.100'
                                },
                                borderLeft: alloc.is_needed ? '4px solid #ff9800' : '4px solid transparent'
                              }}
                            >
                            <TableCell>
                              <Typography variant="body2" fontWeight="medium">
                                {alloc.sales_order_number}
                              </Typography>
                            </TableCell>
                            <TableCell>{alloc.customer_name}</TableCell>
                            <TableCell>{new Date(alloc.sales_date).toLocaleDateString()}</TableCell>
                                                         <TableCell align="right">
                               <Typography 
                                 variant="body2" 
                                 color="black"
                                 fontWeight={alloc.is_needed ? "bold" : "normal"}
                               >
                                 {alloc.current_quantity_needed || 0}
                               </Typography>
                             </TableCell>
                                                         <TableCell align="right">
                               <TextField
                                 type="number"
                                 value={allocations[suggestion.part_number]?.[alloc.sales_order_id] || 0}
                                 onChange={(e) => {
                                   const newValue = parseFloat(e.target.value) || 0;
                                   handleAllocationChange(
                                     suggestion.part_number, 
                                     alloc.sales_order_id, 
                                     newValue
                                   );
                                 }}
                                 onBlur={(e) => {
                                   // Validate on blur to ensure constraints are met
                                   const newValue = parseFloat(e.target.value) || 0;
                                   const currentTotal = getTotalAllocated(suggestion.part_number);
                                   const currentValue = allocations[suggestion.part_number]?.[alloc.sales_order_id] || 0;
                                   const maxAllowed = suggestion.quantity_ordered - (currentTotal - currentValue);
                                   
                                   if (newValue > maxAllowed) {
                                     // Reset to maximum allowed value
                                     handleAllocationChange(
                                       suggestion.part_number, 
                                       alloc.sales_order_id, 
                                       maxAllowed
                                     );
                                   }
                                 }}
                                 size="small"
                                 sx={{ width: 80 }}
                                 inputProps={{ 
                                   min: 0, 
                                   step: 1,
                                   max: suggestion.quantity_ordered
                                 }}
                               />
                             </TableCell>
                            <TableCell>
                              <Chip 
                                label={alloc.is_needed ? "Needs Part" : "No Need"} 
                                color={alloc.is_needed ? "warning" : "default"}
                                size="small"
                                variant="outlined"
                              />
                                                         </TableCell>
                           </TableRow>
                         );
                         })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Collapse>

            <Box mt={2} display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="body2">
                Total Allocated: {getTotalAllocated(suggestion.part_number)}
              </Typography>
              <Box display="flex" alignItems="center" gap={2}>
                <Typography variant="body2">Surplus to Stock:</Typography>
                <TextField
                  type="number"
                  value={surplusPerPart[suggestion.part_number] || 0}
                  disabled
                  size="small"
                  sx={{ width: 80 }}
                  inputProps={{ 
                    min: 0, 
                    step: 1 
                  }}
                />
                
              </Box>
                         </Box>
           </Paper>
         ))
        )}
      </DialogContent>
             <DialogActions>
         <Button onClick={onClose} disabled={saving}>
           Cancel
         </Button>
         <Button 
           onClick={handleAutoAllocateAll} 
           variant="outlined" 
           disabled={saving}
           sx={{ mr: 'auto' }}
         >
           Auto Allocate All (FIFO)
         </Button>
                   <Button 
            onClick={handleSaveAllocations} 
            variant="contained" 
            disabled={saving || errors.length > 0}
          >
            {saving ? <CircularProgress size={20} /> : 'Save Allocations'}
          </Button>
       </DialogActions>
    </Dialog>
  );
};

export default AllocationModal; 