import api from '../api/axios';

export const getInventory = async (partType?: 'stock' | 'supply') => {
  const params = partType ? { partType } : {};
  const response = await api.get('/api/inventory', { params });
  return response.data;
};

export const getStockInventory = async () => {
  return getInventory('stock');
};

export const getSupplyInventory = async () => {
  return getInventory('supply');
};

export const getInventoryForPart = async (partNumber: string) => {
  const response = await api.get(`/api/inventory/${encodeURIComponent(partNumber)}`);
  return response.data;
};

export const cleanupInventorySpaces = async () => {
  const response = await api.post('/api/inventory/cleanup-spaces');
  return response.data;
}; 

export const previewCleanupEnforce = async (partType?: 'stock' | 'supply') => {
  const response = await api.post('/api/inventory/cleanup-enforce', { partType, apply: false });
  return response.data;
};

export const applyCleanupEnforce = async (
  partType: 'stock' | 'supply' | undefined,
  merges: Array<{ keepPartNumber: string; mergePartNumbers: string[] }>
) => {
  const response = await api.post('/api/inventory/cleanup-enforce', { partType, apply: true, merges });
  return response.data;
};

// Vendor mappings
export interface InventoryVendorLink {
  id?: number;
  part_number: string;
  vendor_id: number;
  vendor_name?: string;
  vendor_part_number: string;
  vendor_part_description?: string;
  preferred?: boolean;
  is_active?: boolean;
  usage_count?: number;
  last_used_at?: string;
}

export const getPartVendors = async (partNumber: string): Promise<InventoryVendorLink[]> => {
  const res = await api.get(`/api/inventory/${encodeURIComponent(partNumber)}/vendors`);
  return res.data;
};

export const createPartVendor = async (partNumber: string, payload: Omit<InventoryVendorLink, 'id'|'part_number'>) => {
  const res = await api.post(`/api/inventory/${encodeURIComponent(partNumber)}/vendors`, payload);
  return res.data as InventoryVendorLink;
};

export const updatePartVendor = async (partNumber: string, id: number, payload: Partial<InventoryVendorLink>) => {
  const res = await api.put(`/api/inventory/${encodeURIComponent(partNumber)}/vendors/${id}`, payload);
  return res.data as InventoryVendorLink;
};

export const deletePartVendor = async (partNumber: string, id: number) => {
  const res = await api.delete(`/api/inventory/${encodeURIComponent(partNumber)}/vendors/${id}`);
  return res.data;
};

export const recordVendorUsage = async (partNumber: string, vendorId: number, vendorPartNumber: string) => {
  const res = await api.post('/api/inventory/usage', {
    part_number: partNumber,
    vendor_id: vendorId,
    vendor_part_number: vendorPartNumber,
  });
  return res.data;
};