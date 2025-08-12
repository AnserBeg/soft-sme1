import api from '../api/axios';

export const getVendors = async () => {
  const response = await api.get('/api/vendors');
  return response.data;
}; 