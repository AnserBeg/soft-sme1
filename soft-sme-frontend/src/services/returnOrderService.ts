import api from '../api/axios';

export type ReturnOrderStatus = 'Requested' | 'Returned';

export interface ReturnOrderSummary {
  return_id: number;
  return_number: string;
  status: ReturnOrderStatus;
  requested_at: string;
  returned_at?: string | null;
  total_quantity: number;
  purchase_id?: number;
  purchase_number?: string;
  vendor_name?: string;
  purchase_status?: string;
}

export interface ReturnOrderLineItem {
  line_item_id?: number;
  return_id?: number;
  purchase_line_item_id?: number | null;
  part_id?: number | null;
  part_number: string;
  part_description?: string;
  quantity: number;
  unit?: string;
  unit_cost?: number | null;
  reason?: string | null;
}

export interface ReturnOrderDetail extends ReturnOrderSummary {
  purchase_status?: string;
  line_items: ReturnOrderLineItem[];
  notes?: string | null;
  requested_by?: string | null;
  available_items?: Array<{
    line_item_id: number;
    part_number: string;
    part_description?: string;
    quantity: number;
    unit?: string;
    unit_cost?: number;
    part_id?: number | null;
    already_requested: number;
    returnable_quantity: number;
  }>;
}

export interface ReturnOrderPayload {
  purchase_id: number;
  status?: ReturnOrderStatus;
  requested_by?: string;
  requested_at?: string;
  notes?: string;
  line_items: Array<{
    purchase_line_item_id: number;
    quantity: number;
    reason?: string;
  }>;
}

export const fetchReturnOrders = async (
  status: 'all' | ReturnOrderStatus = 'all'
): Promise<ReturnOrderSummary[]> => {
  const response = await api.get('/api/return-orders', {
    params: { status },
  });
  return response.data;
};

export const fetchReturnOrderDetail = async (id: number): Promise<ReturnOrderDetail> => {
  const response = await api.get(`/api/return-orders/${id}`);
  return response.data;
};

export const createReturnOrder = async (payload: ReturnOrderPayload): Promise<{ return_id: number; return_number: string }> => {
  const response = await api.post('/api/return-orders', payload);
  return response.data;
};

export const updateReturnOrder = async (
  id: number,
  payload: Omit<ReturnOrderPayload, 'purchase_id'>
): Promise<void> => {
  await api.put(`/api/return-orders/${id}`, payload);
};

export const deleteReturnOrder = async (id: number): Promise<void> => {
  await api.delete(`/api/return-orders/${id}`);
};

export const fetchReturnOrdersForPurchase = async (
  purchaseId: number
): Promise<ReturnOrderSummary[]> => {
  const response = await api.get(`/api/return-orders/by-purchase/${purchaseId}`);
  return response.data;
};

export const fetchReturnableLineItems = async (
  purchaseId: number,
  excludeReturnId?: number
): Promise<ReturnOrderDetail['available_items']> => {
  const response = await api.get(`/api/return-orders/purchase/${purchaseId}/line-items`, {
    params: excludeReturnId ? { excludeReturnId } : undefined,
  });

  const data = response.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.available_items)) {
    return data.available_items;
  }

  return [];
};

const getFilenameFromDisposition = (headerValue?: string | null): string | undefined => {
  if (!headerValue) {
    return undefined;
  }

  const filenameStarMatch = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (filenameStarMatch?.[1]) {
    try {
      return decodeURIComponent(filenameStarMatch[1]);
    } catch {
      return filenameStarMatch[1];
    }
  }

  const filenameMatch = /filename="?([^";]+)"?/i.exec(headerValue);
  return filenameMatch?.[1];
};

export const downloadReturnOrderPdf = async (id: number): Promise<boolean> => {
  try {
    const response = await api.get(`/api/return-orders/${id}/pdf`, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);

    const suggestedFilename =
      getFilenameFromDisposition(response.headers['content-disposition']) || `return-order-${id}.pdf`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', suggestedFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Failed to download return order PDF', error);
    return false;
  }
};
