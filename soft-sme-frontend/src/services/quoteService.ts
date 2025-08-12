import api from '../api/axios';

export const getQuotes = async () => {
  const response = await api.get('/api/quotes');
  return response.data;
}; 