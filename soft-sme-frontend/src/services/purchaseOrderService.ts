import api from '../api/axios';
import dayjs from 'dayjs';

// Define the interface for a single purchase order
export interface PurchaseOrder {
  purchase_id: number;
  purchase_number: string;
  vendor_name: string;
  bill_date: string;
  bill_number: string;
  date?: string;
  subtotal: number;
  total_gst_amount: number;
  total_amount: number;
  status: string;
  created_at?: string;
  exported_to_qbo?: boolean;
  qbo_exported_at?: string | null;
  qbo_export_status?: string | null;
  return_requested_count?: number;
  return_returned_count?: number;
  has_returns?: boolean;
}

// Define the interface for the filter parameters
interface PurchaseOrderFilters {
  startDate?: string;
  endDate?: string;
  status?: 'open' | 'closed' | 'all';
  searchTerm?: string;
}

// Function to fetch purchase orders with filters
export const getPurchaseOrders = async (filters: PurchaseOrderFilters): Promise<PurchaseOrder[]> => {
  try {
    const response = await api.get('/api/purchase-history', { params: filters });
    return response.data;
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    throw error;
  }
};

/**
 * Fetches all open purchase orders from the backend.
 * @returns {Promise<any[]>} A promise that resolves to an array of open purchase orders.
 */
export const getOpenPurchaseOrders = async (params: {
  startDate: string;
  endDate: string;
  status: string;
  searchTerm: string;
}): Promise<any[]> => {
  try {
    const response = await api.get('/api/purchase-orders/open', { params });
    console.log("Response from getOpenPurchaseOrders:", response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching open purchase orders:', error);
    return [];
  }
};

export const deletePurchaseOrder = async (id: number): Promise<void> => {
  await api.delete(`/api/purchase-orders/${id}`);
};

export const getLatestPurchaseOrderNumber = async (): Promise<string | null> => {
  try {
    const response = await api.get('/api/purchase-history/latest-po-number');
    return response.data.latestPurchaseNumber;
  } catch (error) {
    console.error('Failed to fetch latest PO number', error);
    throw new Error('Failed to fetch latest PO number');
  }
};

/**
 * Manually trigger recalculation of purchase order totals
 * @param purchaseOrderId - ID of the purchase order to recalculate
 * @returns Promise with updated totals
 */
export const recalculatePurchaseOrderTotals = async (purchaseOrderId: number): Promise<any> => {
  try {
    const response = await api.post(`/api/purchase-orders/${purchaseOrderId}/recalculate`);
    return response.data;
  } catch (error) {
    console.error('Failed to recalculate purchase order totals', error);
    throw new Error('Failed to recalculate purchase order totals');
  }
};

export const downloadPurchaseOrderImportTemplate = async () => {
  return api.get('/api/purchase-history/csv-template', { responseType: 'blob' });
};

export const uploadPurchaseOrderCsv = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/api/purchase-history/upload-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};
