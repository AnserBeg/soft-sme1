import api from '../api/axios';

export const getQuotes = async () => {
  const response = await api.get('/api/quotes');
  return response.data;
}; 

export const convertQuoteToSalesOrder = async (quoteId: number) => {
  const response = await api.post(`/api/quotes/${quoteId}/convert-to-sales-order`);
  return response.data;
}; 