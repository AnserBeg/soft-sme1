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