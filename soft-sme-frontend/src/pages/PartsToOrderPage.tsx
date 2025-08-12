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
  CircularProgress
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon,
  ShoppingCart as ShoppingCartIcon
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
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
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
                    <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={8}>
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

    </Box>
  );
};

export default PartsToOrderPage; 