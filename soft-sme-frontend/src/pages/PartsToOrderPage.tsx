import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  IconButton,
  Collapse,
  Chip,
  Alert,
  CircularProgress,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Grid
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon,
  ShoppingCart as ShoppingCartIcon,
  AddShoppingCart as AddShoppingCartIcon
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

interface PartsToOrderItem {
  sales_order_id: number;
  sales_order_number: string;
  customer_name: string;
  part_number: string;
  part_description: string;
  quantity_needed: number;
  unit: string;
  unit_price: number;
  line_amount: number;
}

interface AggregatedPart {
  part_number: string;
  part_description: string;
  total_quantity_needed: number;
  unit: string;
  unit_price: number;
  total_line_amount: number;
  sales_orders: PartsToOrderItem[];
}



const PartsToOrderPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [creatingPO, setCreatingPO] = useState(false);
  const [aggregatedParts, setAggregatedParts] = useState<AggregatedPart[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [createPOModalOpen, setCreatePOModalOpen] = useState(false);
  const [selectedPartsForPO, setSelectedPartsForPO] = useState<AggregatedPart[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
    
    // Listen for parts-to-order updates from other pages
    const handlePartsToOrderUpdate = () => {
      console.log('🔄 Parts to order update event received, refreshing data...');
      fetchData();
    };
    
    window.addEventListener('parts-to-order-updated', handlePartsToOrderUpdate);
    
    return () => {
      window.removeEventListener('parts-to-order-updated', handlePartsToOrderUpdate);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/sales-orders/parts-to-order/all');
      const { individualParts, aggregatedParts: backendAggregated } = response.data;
      
      // Use backend aggregated data if available, otherwise aggregate locally
      if (backendAggregated && backendAggregated.length > 0) {
        setAggregatedParts(backendAggregated);
      } else {
        // Fallback to local aggregation
        const aggregated = aggregatePartsToOrder(individualParts);
        setAggregatedParts(aggregated);
      }
    } catch (error: any) {
      console.error('Error fetching parts to order:', error);
      toast.error('Failed to load parts to order data');
    } finally {
      setLoading(false);
    }
  };



  const aggregatePartsToOrder = (individualParts: PartsToOrderItem[]): AggregatedPart[] => {
    const aggregated: { [key: string]: AggregatedPart } = {};

    individualParts.forEach(item => {
      if (!aggregated[item.part_number]) {
        aggregated[item.part_number] = {
          part_number: item.part_number,
          part_description: item.part_description,
          total_quantity_needed: 0,
          unit: item.unit,
          unit_price: item.unit_price,
          total_line_amount: 0,
          sales_orders: []
        };
      }

      aggregated[item.part_number].total_quantity_needed += item.quantity_needed;
      aggregated[item.part_number].total_line_amount += item.line_amount;
      aggregated[item.part_number].sales_orders.push(item);
    });

    return Object.values(aggregated);
  };

  const handleExpandRow = (partNumber: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(partNumber)) {
      newExpanded.delete(partNumber);
    } else {
      newExpanded.add(partNumber);
    }
    setExpandedRows(newExpanded);
  };



  const handleRefresh = () => {
    fetchData();
  };

  const handleSelectPart = (partNumber: string) => {
    setSelectedParts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(partNumber)) {
        newSet.delete(partNumber);
      } else {
        newSet.add(partNumber);
      }
      return newSet;
    });
  };

  const handleSelectAllParts = () => {
    if (selectedParts.size === aggregatedParts.length) {
      setSelectedParts(new Set());
    } else {
      setSelectedParts(new Set(aggregatedParts.map(part => part.part_number)));
    }
  };

  const handleOpenCreatePOModal = () => {
    if (selectedParts.size === 0) {
      toast.warning('Please select at least one part to create a purchase order');
      return;
    }
    
    const selectedPartsData = aggregatedParts.filter(part => selectedParts.has(part.part_number));
    setSelectedPartsForPO(selectedPartsData);
    setCreatePOModalOpen(true);
  };

  const handleCloseCreatePOModal = () => {
    setCreatePOModalOpen(false);
    setSelectedPartsForPO([]);
  };

  const handleCreatePOFromModal = async () => {
    if (selectedPartsForPO.length === 0) {
      toast.warning('No parts selected for purchase order');
      return;
    }

    setCreatingPO(true);
    try {
      const response = await api.post('/api/purchase-orders/auto-create-from-parts-to-order', {
        parts: selectedPartsForPO
      });
      
      if (response.data.success) {
        toast.success(`Purchase order created successfully! PO Number: ${response.data.purchase_order_number}`);
        if (response.data.purchase_orders && response.data.purchase_orders.length === 1) {
          const purchaseOrderId = response.data.purchase_orders[0].purchase_id;
          handleCloseCreatePOModal();
          setSelectedParts(new Set());
          navigate(`/open-purchase-orders/${purchaseOrderId}`);
        } else {
          handleCloseCreatePOModal();
          setSelectedParts(new Set());
          fetchData();
        }
      } else {
        toast.error(response.data.message || 'Failed to create purchase order');
      }
    } catch (error: any) {
      console.error('Error creating purchase order:', error);
      toast.error(error.response?.data?.error || 'Failed to create purchase order');
    } finally {
      setCreatingPO(false);
    }
  };

  const handleCreatePurchaseOrder = async (partNumber?: string) => {
    let partsToOrder = aggregatedParts;
    if (partNumber) {
      const part = aggregatedParts.find(p => p.part_number === partNumber);
      if (!part) {
        toast.warning(`Part ${partNumber} not found for purchase order creation.`);
        return;
      }
      partsToOrder = [part];
    }

    if (partsToOrder.length === 0) {
      toast.warning('No parts to order');
      return;
    }

    setCreatingPO(true);
    try {
      const response = await api.post('/api/purchase-orders/auto-create-from-parts-to-order', {
        parts: partsToOrder
      });
      
      if (response.data.success) {
        toast.success(`Purchase order created successfully! PO Number: ${response.data.purchase_order_number}`);
        if (response.data.purchase_orders && response.data.purchase_orders.length === 1) {
          const purchaseOrderId = response.data.purchase_orders[0].purchase_id;
          navigate(`/open-purchase-orders/${purchaseOrderId}`);
        } else {
          fetchData();
        }
      } else {
        toast.error(response.data.message || 'Failed to create purchase order');
      }
    } catch (error: any) {
      console.error('Error creating purchase order:', error);
      toast.error(error.response?.data?.error || 'Failed to create purchase order');
    } finally {
      setCreatingPO(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h3" component="h1">
          Parts to Order
        </Typography>
        <Box display="flex" gap={2}>
          {selectedParts.size > 0 && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddShoppingCartIcon />}
              onClick={handleOpenCreatePOModal}
              disabled={creatingPO}
            >
              Create PO ({selectedParts.size})
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {aggregatedParts.length === 0 ? (
        <Alert severity="info">
          No parts currently need to be ordered.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table size="medium">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedParts.size > 0 && selectedParts.size < aggregatedParts.length}
                    checked={aggregatedParts.length > 0 && selectedParts.size === aggregatedParts.length}
                    onChange={handleSelectAllParts}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="h6" fontWeight="bold">
                    
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="h6" fontWeight="bold">
                    Part Number
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="h6" fontWeight="bold">
                    Description
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="h6" fontWeight="bold">
                    Quantity to Order
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="h6" fontWeight="bold">
                    Unit
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="h6" fontWeight="bold">
                    Unit Price
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="h6" fontWeight="bold">
                    Total Amount
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="h6" fontWeight="bold">
                    Actions
                  </Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aggregatedParts.map((part) => (
                <React.Fragment key={part.part_number}>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedParts.has(part.part_number)}
                        onChange={() => handleSelectPart(part.part_number)}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => handleExpandRow(part.part_number)}
                      >
                        {expandedRows.has(part.part_number) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body1" fontWeight="medium" fontSize="1.1rem">
                        {part.part_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body1" fontSize="1.1rem">
                        {part.part_description}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontWeight="medium" fontSize="1.1rem">
                        {Number(part.total_quantity_needed) || 0}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontSize="1.1rem">
                        {part.unit}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontSize="1.1rem">
                        ${(Number(part.unit_price) || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body1" fontSize="1.1rem">
                        ${(Number(part.total_line_amount) || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                                              <Button
                          variant="contained"
                          color="primary"
                          size="medium"
                          startIcon={<ShoppingCartIcon />}
                          onClick={() => handleCreatePurchaseOrder(part.part_number)}
                          disabled={creatingPO}
                        >
                          Create PO
                        </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={9}>
                      <Collapse in={expandedRows.has(part.part_number)} timeout="auto" unmountOnExit>
                        <Box sx={{ margin: 1 }}>
                          <Typography variant="h5" gutterBottom component="div">
                            Sales Orders Requiring This Part
                          </Typography>
                          <Table size="medium">
                            <TableHead>
                              <TableRow>
                                <TableCell>
                                  <Typography variant="subtitle1" fontWeight="bold">
                                    Sales Order
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="subtitle1" fontWeight="bold">
                                    Customer
                                  </Typography>
                                </TableCell>
                                <TableCell align="center">
                                  <Typography variant="subtitle1" fontWeight="bold">
                                    Quantity to Order
                                  </Typography>
                                </TableCell>
                                <TableCell align="center">
                                  <Typography variant="subtitle1" fontWeight="bold">
                                    Unit Price
                                  </Typography>
                                </TableCell>
                                <TableCell align="center">
                                  <Typography variant="subtitle1" fontWeight="bold">
                                    Line Amount
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {part.sales_orders.map((so) => (
                                <TableRow key={`${so.sales_order_id}-${so.part_number}`}>
                                  <TableCell>
                                    <Typography variant="body1" fontSize="1rem">
                                      {so.sales_order_number}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body1" fontSize="1rem">
                                      {so.customer_name}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="center">
                                    <Typography variant="body1" fontSize="1rem">
                                      {Number(so.quantity_needed) || 0}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="center">
                                    <Typography variant="body1" fontSize="1rem">
                                      ${(Number(so.unit_price) || 0).toFixed(2)}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="center">
                                    <Typography variant="body1" fontSize="1rem">
                                      ${(Number(so.line_amount) || 0).toFixed(2)}
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create PO Modal */}
      <Dialog 
        open={createPOModalOpen} 
        onClose={handleCloseCreatePOModal}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Create Purchase Order
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Selected parts for purchase order:
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Part Number</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="center">Quantity</TableCell>
                  <TableCell align="center">Unit</TableCell>
                  <TableCell align="center">Unit Price</TableCell>
                  <TableCell align="center">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selectedPartsForPO.map((part) => (
                  <TableRow key={part.part_number}>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {part.part_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {part.part_description}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        {Number(part.total_quantity_needed) || 0}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        {part.unit}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        ${(Number(part.unit_price) || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" fontWeight="medium">
                        ${(Number(part.total_line_amount) || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ mt: 2, p: 2, backgroundColor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="h6" align="right">
              Total Amount: ${selectedPartsForPO.reduce((sum, part) => sum + (Number(part.total_line_amount) || 0), 0).toFixed(2)}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreatePOModal} disabled={creatingPO}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreatePOFromModal} 
            variant="contained" 
            color="primary"
            disabled={creatingPO}
            startIcon={creatingPO ? <CircularProgress size={20} /> : <ShoppingCartIcon />}
          >
            {creatingPO ? 'Creating...' : 'Create Purchase Order'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
};

export default PartsToOrderPage; 